import { MediaProviderError } from './errors.js';

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_MINIMUM_OPEN_MS = 30_000;
const DEFAULT_MAXIMUM_OPEN_MS = 120_000;
const IGNORED_FAILURE_CODES = new Set([
  'ABORTED',
  'PROVIDER_DISABLED',
  'TOO_LARGE',
  'UNKNOWN_PROVIDER',
]);

function closedState() {
  return {
    failures: 0,
    openUntil: 0,
    probeInFlight: false,
  };
}

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
    state.probeInFlight = false;
    if (IGNORED_FAILURE_CODES.has(error?.code)) {
      if (error?.code !== 'ABORTED') this.success(permit);
      return;
    }
    state.failures += 1;
    if (permit.probe || state.failures >= this.failureThreshold) this.#open(permit.provider, state);
  }

  snapshot(provider) {
    const state = this.#state(provider);
    return Object.freeze({ ...state });
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
