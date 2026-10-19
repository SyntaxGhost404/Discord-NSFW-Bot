import assert from 'node:assert/strict';
import test from 'node:test';
import { BotApplication } from '../src/application.js';
import { DiscordRestError } from '../src/discord/rest-client.js';
import { Logger } from '../src/lib/logger.js';

function application(overrides = {}) {
  const app = new BotApplication({
    config: {
      botToken: 'token',
      gatewayIntents: 4_609,
      shutdownDrainMs: overrides.shutdownDrainMs ?? 20,
      shutdownSettleMs: overrides.shutdownSettleMs ?? 20,
      shutdownHardTimeoutMs: overrides.shutdownHardTimeoutMs ?? 200,
    },
    logger: new Logger('error'),
  });
  const events = [];
  app.gateway = { stop() { events.push('gateway-stop'); } };
  app.interactionRouter = { stopAccepting() { events.push('reject-new-work'); } };
  app.rateLimiter = { async flush() { events.push('quota-flush'); } };
  return { app, events };
}

test('graceful shutdown rejects new work, closes transports, and flushes quota state', async () => {
  const { app, events } = application();
  await app.shutdown({ reason: 'test' });
  assert.equal(app.stopping, true);
  assert.equal(app.providerAbortController.signal.aborted, true);
  assert.equal(app.discordAbortController.signal.aborted, true);
  assert.deepEqual(events, ['reject-new-work', 'gateway-stop', 'quota-flush']);
});

test('provider work is aborted after the drain window before Discord closes', async () => {
  const { app, events } = application({ shutdownDrainMs: 5, shutdownSettleMs: 50 });
  let task;
  task = new Promise((resolve) => {
    app.providerAbortController.signal.addEventListener('abort', () => {
      events.push('provider-abort');
      app.activeTasks.delete(task);
      resolve();
    }, { once: true });
  });
  app.activeTasks.add(task);
  await app.shutdown({ reason: 'test drain' });
  assert.deepEqual(events, [
    'reject-new-work',
    'provider-abort',
    'gateway-stop',
    'quota-flush',
  ]);
});

test('a confirmed competing interaction consumer gracefully yields this Gateway session', async () => {
  const { app, events } = application();
  app.instanceLease = {
    async release() { events.push('lease-release'); },
  };
  const error = new DiscordRestError('Interaction has already been acknowledged.', {
    status: 400,
    code: 40060,
    details: { code: 40060 },
    method: 'POST',
    route: 'POST /interactions/:id/:token/callback',
  });

  app.interactionConflictMonitor.record({
    error,
    command: 'boobs',
    source: 'command',
    interactionId: '1525275540641288323',
    responseState: 'unavailable',
    elapsedMs: 327,
    interactionAgeMs: 576,
  });
  await app.shutdownPromise;

  assert.equal(app.stopping, true);
  assert.deepEqual(events, ['reject-new-work', 'gateway-stop', 'quota-flush', 'lease-release']);
});
