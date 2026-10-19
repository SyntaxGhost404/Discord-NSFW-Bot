import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderCircuitBreaker } from '../src/brain/providers/circuit-breaker.js';
import { MediaProviderError } from '../src/brain/providers/errors.js';
import { fetchMedia } from '../src/brain/providers/index.js';
import { Logger } from '../src/lib/logger.js';

function breaker(overrides = {}) {
  return new ProviderCircuitBreaker({
    logger: new Logger('error'),
    random: () => 0,
    ...overrides,
  });
}

test('three consecutive provider failures open the circuit without redundant fetches', async () => {
  let clock = 1_000;
  let calls = 0;
  const circuitBreaker = breaker({ now: () => clock });
  const context = {
    circuitBreaker,
    http: {
      async json() {
        calls += 1;
        throw new MediaProviderError('upstream offline', { code: 'NETWORK_ERROR' });
      },
    },
  };
  const source = { provider: 'purrbot', endpoint: 'https://api.example/media' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(fetchMedia(source, context), (error) => error.code === 'NETWORK_ERROR');
  }
  await assert.rejects(fetchMedia(source, context), (error) => error.code === 'CIRCUIT_OPEN');
  assert.equal(calls, 3, 'an open circuit must not issue a speculative provider request');
  assert.equal(circuitBreaker.snapshot('purrbot').openUntil, clock + 30_000);
});

test('half-open state permits exactly one real recovery probe', () => {
  let clock = 10_000;
  const circuitBreaker = breaker({ now: () => clock, failureThreshold: 1 });
  const failed = circuitBreaker.acquire('provider');
  circuitBreaker.failure(failed, new MediaProviderError('offline', { code: 'TIMEOUT' }));
  clock += 30_000;

  const probe = circuitBreaker.acquire('provider');
  assert.equal(probe.probe, true);
  assert.throws(
    () => circuitBreaker.acquire('provider'),
    (error) => error.code === 'CIRCUIT_OPEN',
  );
  circuitBreaker.success(probe);
  assert.equal(circuitBreaker.acquire('provider').probe, false);
  assert.equal(circuitBreaker.snapshot('provider').failures, 0);
});

test('shutdown cancellation and local size limits do not poison provider health', () => {
  const circuitBreaker = breaker({ failureThreshold: 1 });
  for (const code of ['ABORTED', 'TOO_LARGE', 'PROVIDER_DISABLED']) {
    const permit = circuitBreaker.acquire(code);
    circuitBreaker.failure(permit, new MediaProviderError(code, { code }));
    assert.equal(circuitBreaker.snapshot(code).openUntil, 0);
  }
});
