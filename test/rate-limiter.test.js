import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GlobalRateLimiter } from '../src/brain/rate-limit/global-rate-limiter.js';
import { Logger } from '../src/lib/logger.js';

const FREE_USER = '123456789012345678';
const PREMIUM_USER = '234567890123456789';

function limiter({ now, stateFile = null } = {}) {
  return new GlobalRateLimiter({
    premiumUserIds: [PREMIUM_USER],
    stateFile,
    logger: new Logger('error'),
    now,
  });
}

function successfulMedia(rateLimiter, userId) {
  const gate = rateLimiter.reserveMedia(userId);
  assert.equal(gate.allowed, true);
  assert.equal(rateLimiter.commit(gate.reservation), true);
}

test('free media quotas use a global sliding 60-per-minute window', () => {
  let clock = Date.UTC(2026, 0, 1, 12);
  const rateLimiter = limiter({ now: () => clock });
  for (let index = 0; index < 60; index += 1) successfulMedia(rateLimiter, FREE_USER);

  const blocked = rateLimiter.reserveMedia(FREE_USER);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.releaseAt, clock + 60_000);
  assert.equal(blocked.snapshot.minuteRemaining, 0);
  assert.equal(blocked.snapshot.dailyRemaining, 940);

  clock += 60_001;
  assert.equal(rateLimiter.reserveMedia(FREE_USER).allowed, true);
});

test('failed media executions roll back and concurrent reservations cannot overshoot', () => {
  const clock = Date.UTC(2026, 0, 1, 12);
  const rateLimiter = limiter({ now: () => clock });
  const reservations = [];
  for (let index = 0; index < 60; index += 1) {
    const gate = rateLimiter.reserveMedia(FREE_USER);
    assert.equal(gate.allowed, true);
    reservations.push(gate.reservation);
  }
  assert.equal(rateLimiter.reserveMedia(FREE_USER).allowed, false);
  assert.equal(rateLimiter.rollback(reservations.pop()), true);
  assert.equal(rateLimiter.reserveMedia(FREE_USER).allowed, true);
  assert.equal(rateLimiter.snapshot(FREE_USER).dailyUsed, 60, 'pending work is reserved but not committed');
});

test('utility cooldown is two seconds for free users and zero for premium users', () => {
  let clock = Date.UTC(2026, 0, 1, 12);
  const rateLimiter = limiter({ now: () => clock });
  assert.equal(rateLimiter.consumeUtility(FREE_USER).allowed, true);
  const blocked = rateLimiter.consumeUtility(FREE_USER);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.releaseAt, clock + 2_000);
  clock += 2_000;
  assert.equal(rateLimiter.consumeUtility(FREE_USER).allowed, true);
  assert.equal(rateLimiter.consumeUtility(PREMIUM_USER).allowed, true);
  assert.equal(rateLimiter.consumeUtility(PREMIUM_USER).allowed, true);
});

test('premium removes the minute limit but retains the 5,000-request daily ceiling', () => {
  const clock = Date.UTC(2026, 0, 1, 12);
  const rateLimiter = limiter({ now: () => clock });
  for (let index = 0; index < 5_000; index += 1) successfulMedia(rateLimiter, PREMIUM_USER);
  const snapshot = rateLimiter.snapshot(PREMIUM_USER);
  assert.equal(snapshot.minuteLimit, null);
  assert.equal(snapshot.minuteRemaining, null);
  assert.equal(snapshot.dailyRemaining, 0);
  assert.equal(rateLimiter.reserveMedia(PREMIUM_USER).allowed, false);
});

test('successful quota state persists atomically across process restarts', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-rate-limit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'usage.json');
  const clock = Date.UTC(2026, 0, 1, 12);
  const first = limiter({ now: () => clock, stateFile });
  await first.initialize();
  successfulMedia(first, FREE_USER);
  await first.flush();

  const second = limiter({ now: () => clock, stateFile });
  await second.initialize();
  const snapshot = second.snapshot(FREE_USER);
  assert.equal(snapshot.minuteUsed, 1);
  assert.equal(snapshot.dailyUsed, 1);
  assert.equal(snapshot.dailyRemaining, 999);
});
