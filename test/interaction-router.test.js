import assert from 'node:assert/strict';
import test from 'node:test';
import { InteractionRouter } from '../src/brain/interaction-router.js';
import { DiscordRestError } from '../src/discord/rest-client.js';
import { Logger } from '../src/lib/logger.js';

const silentLogger = {
  child() { return this; },
  debug() {},
  boot() {},
  event() {},
  info() {},
  success() {},
  warn() {},
  error() {},
};

function fixture(commands, overrides = {}) {
  const requests = [];
  const rest = overrides.rest ?? {
    async post(route, options) { requests.push({ method: 'POST', route, options }); return null; },
    async patch(route, options) { requests.push({ method: 'PATCH', route, options }); return null; },
  };
  const router = new InteractionRouter({
    commands,
    rest,
    gateway: {},
    config: { maxMediaBytes: 10 * 1024 * 1024 },
    mediaHttp: { withMaximumBytes: () => ({}) },
    rateLimiter: overrides.rateLimiter,
    circuitBreaker: overrides.circuitBreaker,
    interactionConflictMonitor: overrides.interactionConflictMonitor,
    shutdownSignal: overrides.shutdownSignal,
    logger: overrides.logger ?? new Logger('error'),
    now: overrides.now,
    random: overrides.random,
  });
  return { requests, router };
}

function interaction(type, data, overrides = {}) {
  return {
    id: '123456789012345678',
    application_id: '234567890123456789',
    token: 'interaction-token',
    type,
    data,
    user: { id: '345678901234567890', username: 'tester' },
    attachment_size_limit: 10 * 1024 * 1024,
    ...overrides,
  };
}

test('router rejects media commands outside guild NSFW channels before execution', async () => {
  let executed = false;
  const commands = new Map([['media', {
    data: { name: 'media', nsfw: true },
    async execute() { executed = true; },
  }]]);
  const { requests, router } = fixture(commands);
  await router.handle(interaction(2, { name: 'media' }, {
    guild_id: '456789012345678901',
    channel: { type: 0, nsfw: false },
  }));
  assert.equal(executed, false);
  assert.equal(requests[0].options.body.type, 4);
  assert.equal(requests[0].options.body.data.flags, 64);
});

test('cooldown rejection happens before media execution and has no footer', async () => {
  let executed = false;
  const rateLimiter = {
    reserveMedia() { return { allowed: false, releaseAt: 65_000 }; },
  };
  const commands = new Map([['media', {
    kind: 'media',
    data: { name: 'media', nsfw: true },
    async execute() { executed = true; },
  }]]);
  const { requests, router } = fixture(commands, { rateLimiter, random: () => 0 });
  await router.handle(interaction(2, { name: 'media' }, { channel: { type: 1 } }));
  assert.equal(executed, false);
  const response = requests[0].options.body.data;
  assert.equal(response.flags, 64);
  assert.equal(response.embeds[0].title, 'Woah now, slow it down');
  assert.match(response.embeds[0].description, /<t:65:R>/);
  assert.match(response.embeds[0].description, /60 requests per 60 seconds/);
  assert.equal('footer' in response.embeds[0], false);
});

test('media reservations commit only after displayed success and otherwise roll back', async () => {
  const events = [];
  const rateLimiter = {
    reserveMedia() {
      const reservation = { id: String(events.length), userId: '345678901234567890' };
      events.push('reserve');
      return { allowed: true, reservation };
    },
    commit() { events.push('commit'); },
    rollback() { events.push('rollback'); },
  };
  let succeeds = true;
  const commands = new Map([['media', {
    kind: 'media',
    data: { name: 'media', nsfw: true },
    async execute(context) {
      await context.responder.defer();
      return { mediaDisplayed: succeeds };
    },
  }]]);
  const { router } = fixture(commands, { rateLimiter });
  await router.handle(interaction(2, { name: 'media' }, {
    id: '123456789012345679',
    channel: { type: 1 },
  }));
  succeeds = false;
  await router.handle(interaction(2, { name: 'media' }, {
    id: '123456789012345680',
    channel: { type: 1 },
  }));
  assert.deepEqual(events, ['reserve', 'commit', 'reserve', 'rollback']);
});

test('router rejects new interactions after shutdown begins', async () => {
  let executed = false;
  const commands = new Map([['ping', {
    data: { name: 'ping', nsfw: false },
    async execute() { executed = true; },
  }]]);
  const { requests, router } = fixture(commands);
  router.stopAccepting();
  await router.handle(interaction(2, { name: 'ping' }));
  assert.equal(executed, false);
  assert.equal(requests[0].options.body.data.flags, 64);
  assert.match(requests[0].options.body.data.content, /restarting/);
});

test('router decodes media component state and executes the target command', async () => {
  let captured;
  const commands = new Map([['anal', {
    data: { name: 'anal', nsfw: true },
    async execute(context, state) {
      captured = { source: context.source, state };
      await context.responder.reply({ content: 'ok', flags: 64 });
    },
  }]]);
  const { requests, router } = fixture(commands);
  await router.handle(interaction(3, { custom_id: 'm:anal:style=Anime' }, {
    channel: { type: 1 },
  }));
  assert.deepEqual(captured, { source: 'component', state: { style: 'Anime' } });
  assert.equal(requests[0].options.body.data.content, 'ok');
});

test('premium refresh components use utility cooldowns and preserve component state', async () => {
  const events = [];
  const customId = 'premium:refresh:345678901234567890:345678901234567890';
  const rateLimiter = {
    consumeUtility(userId) {
      events.push({ type: 'cooldown', userId });
      return { allowed: true };
    },
  };
  const commands = new Map([['premium', {
    kind: 'utility',
    rateLimitComponents: true,
    data: { name: 'premium', nsfw: false },
    async execute(context, state) {
      events.push({ type: 'execute', source: context.source, state });
      await context.responder.deferUpdate();
    },
  }]]);
  const { requests, router } = fixture(commands, { rateLimiter });
  await router.handle(interaction(3, { custom_id: customId }, {
    id: '123456789012345681',
  }));
  assert.deepEqual(events, [
    { type: 'cooldown', userId: '345678901234567890' },
    { type: 'execute', source: 'component', state: { customId } },
  ]);
  assert.equal(requests[0].options.body.type, 6);
});

test('stale autocomplete interactions receive an empty autocomplete result', async () => {
  const { requests, router } = fixture(new Map());
  await router.handle(interaction(4, {
    name: 'missing',
    options: [{ name: 'query', value: 'a', focused: true }],
  }));
  assert.equal(requests[0].options.body.type, 8);
  assert.deepEqual(requests[0].options.body.data.choices, []);
});

test('legacy refresh buttons remain compatible with modern command state', async () => {
  let captured;
  const commands = new Map([['anal', {
    data: { name: 'anal', nsfw: true },
    media: { optionName: 'style' },
    async execute(context, state) {
      captured = { source: context.source, state };
      await context.responder.deferUpdate();
    },
  }]]);
  const { requests, router } = fixture(commands);
  await router.handle(interaction(3, { custom_id: 'refresh_anal_Anime' }, {
    channel: { type: 1 },
  }));
  assert.deepEqual(captured, { source: 'component', state: { style: 'Anime' } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.body.type, 6);
});

test('duplicate Gateway dispatches execute an interaction at most once', async () => {
  let executions = 0;
  const commands = new Map([['ping', {
    data: { name: 'ping', nsfw: false },
    async execute(context) {
      executions += 1;
      await context.responder.defer();
    },
  }]]);
  const { requests, router } = fixture(commands);
  const payload = interaction(2, { name: 'ping' });
  await Promise.all([router.handle(payload), router.handle(payload)]);
  assert.equal(executions, 1);
  assert.equal(requests.length, 1);
});

test('already-acknowledged and expired interactions are terminal, not re-acknowledged', async () => {
  let calls = 0;
  const diagnostics = [];
  const rest = {
    async post() {
      calls += 1;
      throw new DiscordRestError('Interaction has already been acknowledged.', {
        status: 400,
        code: 40060,
        details: { code: 40060 },
        method: 'POST',
        route: '/interactions/:id/token/callback',
      });
    },
  };
  const interactionConflictMonitor = {
    record(details) { diagnostics.push(details); },
  };
  const { router } = fixture(new Map(), {
    rest,
    logger: silentLogger,
    interactionConflictMonitor,
  });
  await router.handle(interaction(3, { custom_id: 'unknown:component' }));
  assert.equal(calls, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].error.code, 40060);
  assert.equal(diagnostics[0].responseState, 'unavailable');
});

test('ambiguous callback transport failures do not trigger a second acknowledgement', async () => {
  let calls = 0;
  const rest = {
    async post() {
      calls += 1;
      throw new TypeError('connection reset after write');
    },
  };
  const commands = new Map([['ping', {
    data: { name: 'ping', nsfw: false },
    async execute(context) { await context.responder.defer(); },
  }]]);
  const { router } = fixture(commands, { rest, logger: silentLogger });
  await router.handle(interaction(2, { name: 'ping' }));
  assert.equal(calls, 1);
});
