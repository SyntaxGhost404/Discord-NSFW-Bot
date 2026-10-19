import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyInteractionFailure,
  InteractionConflictMonitor,
  InteractionFailureKind,
} from '../src/brain/interaction-conflict-monitor.js';
import { DiscordRestError } from '../src/discord/rest-client.js';

function discordError(code, message = 'Discord rejected the interaction.') {
  return new DiscordRestError(message, {
    status: 400,
    code,
    details: { code },
    method: 'POST',
    route: 'POST /interactions/:id/:token/callback',
  });
}

function captureLogger() {
  const records = [];
  return {
    records,
    child() { return this; },
    debug(message, data) { records.push({ level: 'debug', message, data }); },
    warn(message, data) { records.push({ level: 'warn', message, data }); },
    error(message, data) { records.push({ level: 'error', message, data }); },
  };
}

function failure(error, elapsedMs) {
  return {
    error,
    command: 'boobs',
    source: 'command',
    interactionId: '1525275540641288323',
    responseState: 'unavailable',
    elapsedMs,
    interactionAgeMs: elapsedMs + 200,
  };
}

test('interaction failure classification separates ownership conflicts from missed deadlines', () => {
  assert.equal(classifyInteractionFailure(discordError(40060), {
    responseState: 'unavailable',
    elapsedMs: 350,
  }).kind, InteractionFailureKind.COMPETING_CONSUMER);
  assert.equal(classifyInteractionFailure(discordError(10062), {
    responseState: 'unavailable',
    elapsedMs: 500,
    interactionAgeMs: 700,
  }).kind, InteractionFailureKind.POSSIBLE_COMPETING_CONSUMER);
  assert.equal(classifyInteractionFailure(discordError(10062), {
    responseState: 'unavailable',
    elapsedMs: 3_100,
    interactionAgeMs: 3_300,
  }).kind, InteractionFailureKind.MISSED_DEADLINE);
  assert.equal(classifyInteractionFailure(discordError(10015), {
    responseState: 'acknowledged',
    elapsedMs: 20_000,
  }).kind, InteractionFailureKind.EXPIRED_WEBHOOK);
});

test('an old interaction is a deadline miss even when local callback work was fast', () => {
  assert.equal(classifyInteractionFailure(discordError(10062), {
    responseState: 'unavailable',
    elapsedMs: 300,
    interactionAgeMs: 3_200,
  }).kind, InteractionFailureKind.MISSED_DEADLINE);
});

test('40060 yields the losing Gateway session exactly once without logging an error stack', () => {
  const logger = captureLogger();
  const conflicts = [];
  const monitor = new InteractionConflictMonitor({
    logger,
    onConflict: (diagnostic) => conflicts.push(diagnostic),
  });

  monitor.record(failure(discordError(40060), 327));
  monitor.record(failure(discordError(40060), 340));

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].code, 40060);
  assert.equal(logger.records.filter((record) => record.level === 'warn').length, 1);
  assert.equal(logger.records.some((record) => record.data?.error instanceof Error), false);
});

test('two fresh 10062 responses in one window confirm a competing consumer', () => {
  const logger = captureLogger();
  const conflicts = [];
  let now = 1_000;
  const monitor = new InteractionConflictMonitor({
    logger,
    now: () => now,
    onConflict: (diagnostic) => conflicts.push(diagnostic),
  });

  monitor.record(failure(discordError(10062), 400));
  now += 5_000;
  monitor.record(failure(discordError(10062), 450));

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].confirmed, true);
  assert.equal(logger.records.filter((record) => record.level === 'warn').length, 2);
});

test('a normal three-second expiry is reported but does not stop the session', () => {
  const logger = captureLogger();
  let conflicts = 0;
  const monitor = new InteractionConflictMonitor({
    logger,
    onConflict: () => { conflicts += 1; },
  });

  monitor.record(failure(discordError(10062), 3_100));

  assert.equal(conflicts, 0);
  assert.match(logger.records[0].message, /invalidated/);
  assert.equal(logger.records[0].data.deadlineMs, 3_000);
});
