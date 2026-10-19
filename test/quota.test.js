import { evictDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import * as quota from '../src/brain/rate-limit/quota-state.js';
import { QuotaClient } from '../src/brain/rate-limit/quota-client.js';
import { Logger } from '../src/lib/logger.js';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const silentLogger = new Logger('error', {}, { output: { log() {}, warn() {}, error() {}, debug() {} } });

function reserveAndCommit(state, count, { premium = false, now = NOW } = {}) {
  for (let index = 0; index < count; index += 1) {
    const { reservationId } = quota.reserve(state, { premium, now, id: `r${index}` });
    quota.commit(state, { id: reservationId, premium, now });
  }
}

describe('quota state', () => {
  it('allows 60 free media requests per rolling minute', () => {
    const state = quota.freshState(NOW);
    reserveAndCommit(state, 60);
    const denied = quota.reserve(state, { premium: false, now: NOW + 1_000, id: 'x' });
    expect(denied).toEqual({ allowed: false, releaseAt: NOW + 60_000 });
    expect(quota.reserve(state, { premium: false, now: NOW + 60_001, id: 'y' }).allowed).toBe(true);
  });

  it('counts pending reservations so concurrent requests cannot overshoot', () => {
    const state = quota.freshState(NOW);
    for (let index = 0; index < 60; index += 1) {
      expect(quota.reserve(state, { premium: false, now: NOW, id: `p${index}` }).allowed).toBe(true);
    }
    expect(quota.reserve(state, { premium: false, now: NOW, id: 'over' }).allowed).toBe(false);
    expect(quota.snapshot(state, { premium: false, now: NOW, userId: '1' }).minuteRemaining).toBe(0);
  });

  it('charges only committed requests and releases rolled-back or expired reservations', () => {
    const state = quota.freshState(NOW);
    const first = quota.reserve(state, { premium: false, now: NOW, id: 'a' });
    expect(quota.rollback(state, { id: first.reservationId })).toBe(true);
    expect(quota.rollback(state, { id: first.reservationId })).toBe(false);
    quota.reserve(state, { premium: false, now: NOW, id: 'b' });
    quota.refresh(state, NOW + quota.RESERVATION_TTL_MS);
    expect(quota.snapshot(state, { premium: false, now: NOW + quota.RESERVATION_TTL_MS, userId: '1' }).dailyUsed).toBe(0);
    expect(quota.commit(state, { id: 'b', premium: false, now: NOW })).toBe(false);
  });

  it('caps free accounts at 1,000 per UTC day and resets at midnight', () => {
    const state = quota.freshState(NOW);
    state.daily = 1_000;
    const denied = quota.reserve(state, { premium: false, now: NOW, id: 'x' });
    expect(denied).toEqual({ allowed: false, releaseAt: Date.UTC(2026, 9, 20) });
    expect(quota.reserve(state, { premium: false, now: Date.UTC(2026, 9, 20, 0, 0, 1), id: 'y' }).allowed).toBe(true);
  });

  it('gives Premium no minute ceiling and a 5,000 daily cap', () => {
    const state = quota.freshState(NOW);
    reserveAndCommit(state, 120, { premium: true });
    expect(state.minute).toHaveLength(0);
    expect(quota.snapshot(state, { premium: true, now: NOW, userId: '1' })).toMatchObject({
      premium: true,
      minuteLimit: null,
      minuteRemaining: null,
      dailyUsed: 120,
      dailyRemaining: 4_880,
    });
    state.daily = 5_000;
    expect(quota.reserve(state, { premium: true, now: NOW, id: 'cap' }).allowed).toBe(false);
  });

  it('applies the two-second utility cooldown to free users only', () => {
    const state = quota.freshState(NOW);
    expect(quota.consumeUtility(state, { premium: false, now: NOW })).toEqual({ allowed: true });
    expect(quota.consumeUtility(state, { premium: false, now: NOW + 500 })).toEqual({ allowed: false, releaseAt: NOW + 2_000 });
    expect(quota.consumeUtility(state, { premium: false, now: NOW + 2_000 }).allowed).toBe(true);
    expect(quota.consumeUtility(state, { premium: true, now: NOW + 2_001 }).allowed).toBe(true);
  });

  it('normalizes corrupted storage records into a valid state', () => {
    const state = quota.normalizeState({ day: 7, daily: -4, minute: ['x', NOW - 1_000], reservations: { a: 'bad', b: NOW } }, NOW);
    expect(state).toEqual({ day: '2026-10-19', daily: 0, minute: [NOW - 1_000], utilityAt: null, reservations: { b: NOW } });
    expect(quota.normalizeState(null, NOW)).toEqual(quota.freshState(NOW));
  });
});

describe('UserQuota Durable Object', () => {
  it('reserves, commits, rolls back, and survives eviction', async () => {
    const userId = '880000000000000001';
    const stub = env.USER_QUOTA.getByName(userId);
    const first = await stub.reserveMedia({ userId });
    expect(first.allowed).toBe(true);
    expect(await stub.commitMedia({ userId, reservationId: first.reservationId })).toBe(true);
    const second = await stub.reserveMedia({ userId });
    expect(await stub.rollbackMedia({ userId, reservationId: second.reservationId })).toBe(true);

    await evictDurableObject(stub);
    const snapshot = await env.USER_QUOTA.getByName(userId).snapshot({ userId });
    expect(snapshot).toMatchObject({ userId, dailyUsed: 1, minuteUsed: 1, minuteRemaining: 59 });
  });
});

describe('QuotaClient', () => {
  it('wraps the Durable Object and decides Premium from the allowlist', async () => {
    const client = new QuotaClient({ namespace: env.USER_QUOTA, premiumUserIds: ['880000000000000003'], logger: silentLogger });
    const gate = await client.reserveMedia('880000000000000002');
    expect(gate).toMatchObject({ allowed: true, reservation: { userId: '880000000000000002' } });
    expect(await client.commit(gate.reservation)).toBe(true);
    expect((await client.snapshot('880000000000000002')).dailyUsed).toBe(1);
    expect((await client.snapshot('880000000000000003')).premium).toBe(true);
  });

  it('fails open when the quota store is missing, slow, or broken', async () => {
    expect(await new QuotaClient({ namespace: undefined, logger: silentLogger }).reserveMedia('1')).toEqual({ allowed: true, reservation: null });

    const slow = { getByName: () => ({ reserveMedia: () => new Promise(() => {}) }) };
    const slowClient = new QuotaClient({ namespace: slow, logger: silentLogger, timeoutMs: 20 });
    expect(await slowClient.reserveMedia('1')).toEqual({ allowed: true, reservation: null });

    const broken = { getByName: () => ({ consumeUtility: () => Promise.reject(new Error('storage offline')) }) };
    const brokenClient = new QuotaClient({ namespace: broken, logger: silentLogger });
    expect(await brokenClient.consumeUtility('1')).toEqual({ allowed: true });
    expect(await brokenClient.snapshot('1')).toBeNull();
  });
});
