import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FREE_DAILY_LIMIT,
  FREE_MINUTE_LIMIT,
  MINUTE_WINDOW_MS,
  PREMIUM_DAILY_LIMIT,
  limitsFor,
} from './limits.js';

const RESERVATION_TTL_MS = 20 * 60_000;
const SAVE_DEBOUNCE_MS = 250;

function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function nextUtcDay(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function freshState(timestamp) {
  return {
    day: utcDay(timestamp),
    daily: 0,
    minute: [],
    utilityAt: null,
    reservations: new Map(),
  };
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export class GlobalRateLimiter {
  constructor({
    premiumUserIds = [],
    stateFile = null,
    logger,
    now = Date.now,
  }) {
    this.premiumUserIds = new Set(premiumUserIds);
    this.stateFile = stateFile ? path.resolve(stateFile) : null;
    this.logger = logger.child({ subsystem: 'rate-limiter' });
    this.now = now;
    this.users = new Map();
    this.nextReservationId = 1;
    this.saveTimer = null;
    this.savePromise = Promise.resolve();
    this.dirty = false;
  }

  async initialize() {
    if (!this.stateFile) return;
    try {
      const payload = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      const now = this.now();
      for (const [userId, saved] of Object.entries(payload?.users ?? {})) {
        if (!/^\d{17,20}$/.test(userId) || !saved || typeof saved !== 'object') continue;
        const state = freshState(now);
        state.day = typeof saved.day === 'string' ? saved.day : state.day;
        state.daily = nonNegativeInteger(saved.daily);
        state.utilityAt = Number.isFinite(saved.utilityAt) ? saved.utilityAt : null;
        state.minute = Array.isArray(saved.minute)
          ? saved.minute.filter((value) => Number.isFinite(value) && now - value < MINUTE_WINDOW_MS)
          : [];
        this.#refresh(state, now);
        this.users.set(userId, state);
      }
      this.logger.success('Restored persisted user quota state.', { users: this.users.size });
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn('Could not restore rate-limit state; starting with an empty store.', { error });
      }
    }
  }

  isPremium(userId) {
    return this.premiumUserIds.has(String(userId));
  }

  consumeUtility(userId) {
    const now = this.now();
    const state = this.#state(userId, now);
    const limits = limitsFor(this.isPremium(userId));
    const releaseAt = (state.utilityAt ?? now) + limits.utilityCooldownMs;
    if (state.utilityAt !== null && limits.utilityCooldownMs > 0 && now < releaseAt) {
      return { allowed: false, releaseAt, snapshot: this.snapshot(userId) };
    }
    state.utilityAt = now;
    this.#scheduleSave();
    return { allowed: true, snapshot: this.snapshot(userId) };
  }

  reserveMedia(userId) {
    const now = this.now();
    const state = this.#state(userId, now);
    const limits = limitsFor(this.isPremium(userId));
    this.#pruneReservations(state, now);
    const pending = state.reservations.size;

    if (state.daily + pending >= limits.daily) {
      return { allowed: false, releaseAt: nextUtcDay(now), snapshot: this.snapshot(userId) };
    }
    if (limits.minute !== null && state.minute.length + pending >= limits.minute) {
      const releaseAt = state.minute.length > 0
        ? state.minute[0] + MINUTE_WINDOW_MS
        : now + MINUTE_WINDOW_MS;
      return { allowed: false, releaseAt, snapshot: this.snapshot(userId) };
    }

    const id = `${now.toString(36)}-${this.nextReservationId.toString(36)}`;
    this.nextReservationId += 1;
    state.reservations.set(id, now);
    return {
      allowed: true,
      reservation: Object.freeze({ id, userId: String(userId) }),
      snapshot: this.snapshot(userId),
    };
  }

  commit(reservation) {
    const state = this.users.get(String(reservation?.userId));
    if (!state || !state.reservations.delete(reservation?.id)) return false;
    const now = this.now();
    this.#refresh(state, now);
    state.daily += 1;
    if (!this.isPremium(reservation.userId)) state.minute.push(now);
    this.#scheduleSave();
    return true;
  }

  rollback(reservation) {
    const state = this.users.get(String(reservation?.userId));
    return Boolean(state?.reservations.delete(reservation?.id));
  }

  snapshot(userId) {
    const now = this.now();
    const state = this.#state(userId, now);
    this.#pruneReservations(state, now);
    const limits = limitsFor(this.isPremium(userId));
    const pending = state.reservations.size;
    const minuteUsed = state.minute.length + pending;
    const dailyUsed = state.daily + pending;
    return Object.freeze({
      userId: String(userId),
      premium: limits.premium,
      minuteLimit: limits.minute,
      minuteUsed,
      minuteRemaining: limits.minute === null ? null : Math.max(0, limits.minute - minuteUsed),
      dailyLimit: limits.daily,
      dailyUsed,
      dailyRemaining: Math.max(0, limits.daily - dailyUsed),
      day: state.day,
    });
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) this.#queueSave();
    await this.savePromise;
  }

  #state(userId, now) {
    const key = String(userId);
    let state = this.users.get(key);
    if (!state) {
      state = freshState(now);
      this.users.set(key, state);
    }
    this.#refresh(state, now);
    return state;
  }

  #refresh(state, now) {
    const day = utcDay(now);
    if (state.day !== day) {
      state.day = day;
      state.daily = 0;
    }
    const windowStart = now - MINUTE_WINDOW_MS;
    while (state.minute.length > 0 && state.minute[0] <= windowStart) state.minute.shift();
    this.#pruneReservations(state, now);
  }

  #pruneReservations(state, now) {
    for (const [id, createdAt] of state.reservations) {
      if (now - createdAt < RESERVATION_TTL_MS) break;
      state.reservations.delete(id);
    }
  }

  #scheduleSave() {
    if (!this.stateFile) return;
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.#queueSave();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  #queueSave() {
    if (!this.stateFile || !this.dirty) return;
    this.dirty = false;
    const serialized = JSON.stringify({
      version: 1,
      users: Object.fromEntries([...this.users].map(([userId, state]) => [userId, {
        day: state.day,
        daily: state.daily,
        minute: state.minute,
        utilityAt: state.utilityAt,
      }])),
    });
    this.savePromise = this.savePromise
      .catch(() => undefined)
      .then(async () => {
        const directory = path.dirname(this.stateFile);
        const temporary = `${this.stateFile}.${process.pid}.tmp`;
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, this.stateFile);
      })
      .catch((error) => {
        this.dirty = true;
        this.logger.error('Failed to persist rate-limit state.', { error });
      });
  }
}

export const quotaDefaults = Object.freeze({
  freeMinute: FREE_MINUTE_LIMIT,
  freeDaily: FREE_DAILY_LIMIT,
  premiumDaily: PREMIUM_DAILY_LIMIT,
});
