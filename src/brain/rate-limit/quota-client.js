import { withTimeout } from '../../lib/time.js';

const DEFAULT_TIMEOUT_MS = 1_500;
const TIMED_OUT = Symbol('quota-timeout');

// Wraps the UserQuota Durable Object for the interaction path. Gate checks run
// before Discord's three-second acknowledgement deadline, so a slow or
// failing quota store fails open (the request proceeds unmetered) instead of
// leaving the user with "The application did not respond".
export class QuotaClient {
  constructor({ namespace, premiumUserIds = [], logger, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.namespace = namespace ?? null;
    this.premiumUserIds = new Set(premiumUserIds);
    this.logger = logger.child({ subsystem: 'quota' });
    this.timeoutMs = timeoutMs;
  }

  get enabled() {
    return Boolean(this.namespace);
  }

  isPremium(userId) {
    return this.premiumUserIds.has(String(userId));
  }

  async reserveMedia(userId) {
    const result = await this.#call(userId, 'reserveMedia');
    if (!result) return { allowed: true, reservation: null };
    if (!result.allowed) return { allowed: false, releaseAt: result.releaseAt, snapshot: result.snapshot };
    return {
      allowed: true,
      reservation: Object.freeze({ id: result.reservationId, userId: String(userId) }),
      snapshot: result.snapshot,
    };
  }

  async commit(reservation) {
    if (!reservation) return false;
    return Boolean(await this.#call(reservation.userId, 'commitMedia', { reservationId: reservation.id }, { timeoutMs: 5_000 }));
  }

  async rollback(reservation) {
    if (!reservation) return false;
    return Boolean(await this.#call(reservation.userId, 'rollbackMedia', { reservationId: reservation.id }, { timeoutMs: 5_000 }));
  }

  async consumeUtility(userId) {
    const result = await this.#call(userId, 'consumeUtility');
    if (!result) return { allowed: true };
    return result.allowed ? { allowed: true, snapshot: result.snapshot } : { allowed: false, releaseAt: result.releaseAt };
  }

  // Returns null when usage cannot be read, so callers can render a notice.
  snapshot(userId) {
    return this.#call(userId, 'snapshot');
  }

  async #call(userId, method, extra = {}, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.namespace || !userId) return null;
    const key = String(userId);
    try {
      const stub = this.namespace.getByName(key);
      const result = await withTimeout(stub[method]({ userId: key, premium: this.isPremium(key), ...extra }), timeoutMs, TIMED_OUT);
      if (result === TIMED_OUT) {
        this.logger.warn('Quota store did not answer in time; continuing without metering.', { method, timeoutMs });
        return null;
      }
      return result;
    } catch (error) {
      this.logger.error('Quota store call failed; continuing without metering.', { method, error });
      return null;
    }
  }
}
