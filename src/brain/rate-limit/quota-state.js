import { MINUTE_WINDOW_MS, limitsFor } from './limits.js';

// A reservation that is neither committed nor rolled back (for example when a
// Worker invocation is cancelled) stops holding capacity after this long.
export const RESERVATION_TTL_MS = 2 * 60_000;

export function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function nextUtcDay(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function freshState(now) {
  return {
    day: utcDay(now),
    daily: 0,
    minute: [],
    utilityAt: null,
    reservations: {},
  };
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

// Accepts whatever storage returned (including nothing) and produces a valid
// state, so a corrupted record degrades to a fresh quota instead of failing.
export function normalizeState(saved, now) {
  const state = freshState(now);
  if (!saved || typeof saved !== 'object') return state;
  if (typeof saved.day === 'string') state.day = saved.day;
  state.daily = nonNegativeInteger(saved.daily);
  state.utilityAt = Number.isFinite(saved.utilityAt) ? saved.utilityAt : null;
  state.minute = Array.isArray(saved.minute)
    ? saved.minute.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
    : [];
  if (saved.reservations && typeof saved.reservations === 'object') {
    for (const [id, createdAt] of Object.entries(saved.reservations)) {
      if (Number.isFinite(createdAt)) state.reservations[id] = createdAt;
    }
  }
  refresh(state, now);
  return state;
}

export function refresh(state, now) {
  const day = utcDay(now);
  if (state.day !== day) {
    state.day = day;
    state.daily = 0;
  }
  const windowStart = now - MINUTE_WINDOW_MS;
  while (state.minute.length > 0 && state.minute[0] <= windowStart) state.minute.shift();
  for (const [id, createdAt] of Object.entries(state.reservations)) {
    if (now - createdAt >= RESERVATION_TTL_MS) delete state.reservations[id];
  }
  return state;
}

function pendingCount(state) {
  return Object.keys(state.reservations).length;
}

// Capacity is reserved before any provider is contacted, so concurrent
// requests cannot overshoot the limits, but nothing is charged until commit.
export function reserve(state, { premium, now, id }) {
  refresh(state, now);
  const limits = limitsFor(premium);
  const pending = pendingCount(state);
  if (state.daily + pending >= limits.daily) {
    return { allowed: false, releaseAt: nextUtcDay(now) };
  }
  if (limits.minute !== null && state.minute.length + pending >= limits.minute) {
    const releaseAt = state.minute.length > 0 ? state.minute[0] + MINUTE_WINDOW_MS : now + MINUTE_WINDOW_MS;
    return { allowed: false, releaseAt };
  }
  state.reservations[id] = now;
  return { allowed: true, reservationId: id };
}

export function commit(state, { id, premium, now }) {
  if (!Object.hasOwn(state.reservations, id)) return false;
  delete state.reservations[id];
  refresh(state, now);
  state.daily += 1;
  if (!premium) state.minute.push(now);
  return true;
}

export function rollback(state, { id }) {
  if (!Object.hasOwn(state.reservations, id)) return false;
  delete state.reservations[id];
  return true;
}

export function consumeUtility(state, { premium, now }) {
  refresh(state, now);
  const limits = limitsFor(premium);
  if (state.utilityAt !== null && limits.utilityCooldownMs > 0) {
    const releaseAt = state.utilityAt + limits.utilityCooldownMs;
    if (now < releaseAt) return { allowed: false, releaseAt };
  }
  state.utilityAt = now;
  return { allowed: true };
}

export function snapshot(state, { premium, now, userId }) {
  refresh(state, now);
  const limits = limitsFor(premium);
  const pending = pendingCount(state);
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

export function serialize(state) {
  return {
    day: state.day,
    daily: state.daily,
    minute: [...state.minute],
    utilityAt: state.utilityAt,
    reservations: { ...state.reservations },
  };
}
