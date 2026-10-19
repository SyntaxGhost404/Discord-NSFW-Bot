import { MediaProviderError } from './errors.js';

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_MINIMUM_OPEN_MS = 30_000;
const DEFAULT_MAXIMUM_OPEN_MS = 120_000;

// The provider answered (or was never contacted because of local
// configuration), so these outcomes count as healthy.
const HEALTHY_FAILURE_CODES = new Set([
  'PROVIDER_DISABLED',
  'TOO_LARGE',
  'UNKNOWN_PROVIDER',
]);

// Local cancellation and per-invocation budgets say nothing about the
// provider, so they leave its circuit untouched.
const NEUTRAL_FAILURE_CODES = new Set([
  'ABORTED',
  'BUDGET_EXHAUSTED',
  'DEADLINE_EXCEEDED',
]);

function closedState() {
  return {
    failures: 0,
    openUntil: 0,
    probeInFlight: false,
  };
}

// Circuit state lives in isolate memory. Workers isolates are not shared, so
// each isolate learns independently; that is acceptable because a circuit only
// saves wasted upstream attempts and never affects correctness.
export class ProviderCircuitBreaker {
  constructor({
    logger,
    now = Date.now,
    random = Math.random,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    minimumOpenMs = DEFAULT_MINIMUM_OPEN_MS,
    maximumOpenMs = DEFAULT_MAXIMUM_OPEN_MS,
  }) {
    this.logger = logger.child({ subsystem: 'provider-circuit-breaker' });
    this.now = now;
    this.random = random;
    this.failureThreshold = failureThreshold;
    this.minimumOpenMs = minimumOpenMs;
    this.maximumOpenMs = maximumOpenMs;
    this.providers = new Map();
  }

  acquire(provider) {
    const state = this.#state(provider);
    const now = this.now();
    if (state.openUntil > now) throw this.#openError(provider, state.openUntil);
    if (state.openUntil > 0) {
      if (state.probeInFlight) throw this.#openError(provider, state.openUntil);
      state.probeInFlight = true;
      this.logger.event('Allowing one real request as a provider recovery probe.', { provider });
      return Object.freeze({ provider, probe: true });
    }
    return Object.freeze({ provider, probe: false });
  }

  success(permit) {
    const state = this.#state(permit.provider);
    const recovered = state.openUntil > 0 || permit.probe;
    state.failures = 0;
    state.openUntil = 0;
    state.probeInFlight = false;
    if (recovered) this.logger.success('Media provider circuit recovered and closed.', { provider: permit.provider });
  }

  failure(permit, error) {
    const state = this.#state(permit.provider);
    if (HEALTHY_FAILURE_CODES.has(error?.code)) {
      this.success(permit);
      return;
    }
    if (permit.probe) state.probeInFlight = false;
    if (NEUTRAL_FAILURE_CODES.has(error?.code)) return;
    state.failures += 1;
    if (permit.probe || state.failures >= this.failureThreshold) this.#open(permit.provider, state);
  }

  snapshot(provider) {
    return Object.freeze({ ...this.#state(provider) });
  }

  #open(provider, state) {
    const spread = Math.max(0, this.maximumOpenMs - this.minimumOpenMs);
    const duration = this.minimumOpenMs + Math.floor(this.random() * (spread + 1));
    state.openUntil = this.now() + duration;
    state.probeInFlight = false;
    this.logger.warn('Media provider circuit opened after consecutive failures.', {
      provider,
      failures: state.failures,
      retryInMs: duration,
    });
  }

  #openError(provider, retryAt) {
    return new MediaProviderError('Provider circuit is temporarily open.', {
      code: 'CIRCUIT_OPEN',
      provider,
      retryAt,
    });
  }

  #state(provider) {
    let state = this.providers.get(provider);
    if (!state) {
      state = closedState();
      this.providers.set(provider, state);
    }
    return state;
  }
}

export const circuitBreakerDefaults = Object.freeze({
  failureThreshold: DEFAULT_FAILURE_THRESHOLD,
  minimumOpenMs: DEFAULT_MINIMUM_OPEN_MS,
  maximumOpenMs: DEFAULT_MAXIMUM_OPEN_MS,
});
