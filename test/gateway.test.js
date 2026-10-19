import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDisposition,
  gatewayFetchUrl,
  identifyBlockedUntil,
  identifyPayload,
  LOCAL_IDENTIFY_LIMIT,
  reconnectDelay,
  serializePayload,
} from '../src/gateway/protocol.js';
import { isExactBotMention } from '../src/gateway/mention.js';
import { MENTION_GATEWAY_INTENTS } from '../src/discord/constants.js';
import { installFetchMock, json } from './helpers/fetch-mock.js';

const BOT_ID = '111111111111111111';
let mock;
let servers;
let replies;
let shardSequence = 0;

// A fake Discord Gateway: every upgrade request gets a fresh WebSocketPair and
// the test drives the server end like Discord would.
function installFakeDiscord({ sessionStartsRemaining = 999 } = {}) {
  servers = [];
  replies = [];
  mock = installFetchMock([
    ['GET https://discord.com/api/v10/gateway/bot', () => json({
      url: 'wss://gateway.discord.gg',
      shards: 1,
      session_start_limit: { total: 1_000, remaining: sessionStartsRemaining, reset_after: 3_600_000, max_concurrency: 1 },
    })],
    [(request) => request.headers.get('upgrade') === 'websocket', (request) => {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      const connection = { url: request.url, server, messages: [], waiters: [], closed: null };
      server.addEventListener('message', (event) => {
        const payload = JSON.parse(event.data);
        connection.messages.push(payload);
        connection.waiters = connection.waiters.filter((waiter) => !waiter(payload));
      });
      server.addEventListener('close', (event) => {
        connection.closed = { code: event.code, reason: event.reason };
      });
      servers.push(connection);
      return new Response(null, { status: 101, webSocket: client });
    }],
    // Bodies are read here, inside the requesting object's I/O context.
    ['POST https://discord.com/api/v10/channels/', async (request) => {
      replies.push({ url: request.url, authorization: request.headers.get('authorization'), body: await request.json() });
      return json({ id: '1' });
    }],
  ]);
}

function nextMessage(connection, predicate, timeoutMs = 2_000) {
  const existing = connection.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a Gateway payload.')), timeoutMs);
    connection.waiters.push((payload) => {
      if (!predicate(payload)) return false;
      clearTimeout(timer);
      resolve(payload);
      return true;
    });
  });
}

async function eventually(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Condition was not met in time.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// The fake socket was created inside the Gateway object's I/O context, and
// Workers only lets that context touch it, so the test acts from inside.
function send(connection, payload) {
  return runInDurableObject(connection.stub, () => connection.server.send(JSON.stringify(payload)));
}

function closeFromDiscord(connection, code, reason) {
  return runInDurableObject(connection.stub, () => connection.server.close(code, reason));
}

async function startShard() {
  shardSequence += 1;
  // A unique object per test keeps sessions and identify budgets isolated.
  const stub = env.GATEWAY.getByName(`test-shard-${shardSequence}`);
  await stub.ensureRunning({ shardId: 0, shardCount: 1 });
  const connection = await eventually(() => servers.at(-1));
  connection.stub = stub;
  return { stub, connection };
}

async function identifyAndReady(connection) {
  await send(connection, { op: 10, d: { heartbeat_interval: 60_000 } });
  const identify = await nextMessage(connection, (payload) => payload.op === 2);
  await send(connection, {
    op: 0,
    t: 'READY',
    s: 1,
    d: {
      session_id: 'session-abc',
      resume_gateway_url: 'wss://resume.discord.gg',
      user: { id: BOT_ID, username: 'Breaking Bad', avatar: null, discriminator: '1302' },
      guilds: [{ id: '1', unavailable: true }, { id: '2', unavailable: true }],
    },
  });
  return identify;
}

describe('Gateway protocol helpers', () => {
  it('builds IDENTIFY with intents, shard, and presence under 4 KiB', () => {
    const payload = identifyPayload({ token: 't', intents: MENTION_GATEWAY_INTENTS, shardId: 1, shardCount: 2, activity: '/help' });
    expect(payload.d).toMatchObject({ intents: 4608, shard: [1, 2], presence: { status: 'online', activities: [{ type: 4, state: '/help' }] } });
    expect(() => serializePayload(payload)).not.toThrow();
    expect(() => serializePayload({ op: 3, d: 'x'.repeat(5_000) })).toThrow(/4096/);
  });

  it('classifies close codes and pins the Gateway URL', () => {
    expect(closeDisposition(4004)).toBe('fatal');
    expect(closeDisposition(4014)).toBe('fatal');
    expect(closeDisposition(4009)).toBe('identify');
    expect(closeDisposition(1006)).toBe('resume');
    expect(gatewayFetchUrl('wss://resume.discord.gg/?compress=zlib-stream')).toBe('https://resume.discord.gg/?v=10&encoding=json');
  });

  it('protects the token with local and remote IDENTIFY budgets', () => {
    const now = Date.now();
    expect(identifyBlockedUntil([], now)).toBeNull();
    const full = Array.from({ length: LOCAL_IDENTIFY_LIMIT }, (_value, index) => now - index * 1_000);
    expect(identifyBlockedUntil(full, now)).toBeGreaterThan(now);
    expect(identifyBlockedUntil([], now, { remaining: 3, reset_after: 120_000 })).toBe(now + 120_000);
    expect(reconnectDelay(10, () => 0.5)).toBe(60_000);
  });

  it('answers only exact, human mentions', () => {
    expect(isExactBotMention({ author: { id: '1' }, content: ` <@${BOT_ID}> ` }, BOT_ID)).toBe(true);
    expect(isExactBotMention({ author: { id: '1' }, content: `<@!${BOT_ID}>` }, BOT_ID)).toBe(true);
    expect(isExactBotMention({ author: { id: '1' }, content: `hey <@${BOT_ID}>` }, BOT_ID)).toBe(false);
    expect(isExactBotMention({ author: { id: '1', bot: true }, content: `<@${BOT_ID}>` }, BOT_ID)).toBe(false);
    expect(isExactBotMention({ author: { id: '1' }, webhook_id: '5', content: `<@${BOT_ID}>` }, BOT_ID)).toBe(false);
  });
});

describe('DiscordGateway Durable Object', () => {
  beforeEach(() => installFakeDiscord());
  afterEach(() => mock.restore());

  it('identifies, becomes ready, and replies to an exact mention', async () => {
    const { stub, connection } = await startShard();
    expect(connection.url).toBe('https://gateway.discord.gg/?v=10&encoding=json');
    const identify = await identifyAndReady(connection);
    expect(identify.d).toMatchObject({ token: 'test-bot-token', intents: MENTION_GATEWAY_INTENTS, shard: [0, 1] });

    const status = await eventually(async () => {
      const current = await stub.status();
      return current.connected ? current : null;
    });
    expect(status).toMatchObject({ state: 'ready', guilds: 2, user: { id: BOT_ID } });

    await send(connection, { op: 0, t: 'MESSAGE_CREATE', s: 2, d: { id: '900', channel_id: '901', guild_id: '902', author: { id: '903' }, content: `hey <@${BOT_ID}>` } });
    await send(connection, { op: 0, t: 'MESSAGE_CREATE', s: 3, d: { id: '910', channel_id: '901', guild_id: '902', author: { id: '903' }, content: `<@${BOT_ID}>` } });
    const reply = await eventually(() => replies[0]);
    expect(reply.url).toBe('https://discord.com/api/v10/channels/901/messages');
    expect(reply.authorization).toBe('Bot test-bot-token');
    const { body } = reply;
    expect(body.message_reference).toMatchObject({ message_id: '910', channel_id: '901', guild_id: '902', fail_if_not_exists: false });
    expect(body.allowed_mentions).toEqual({ parse: [], replied_user: false });
    expect(body.embeds[0].title).toContain('Welcome to Breaking Bad');
    expect(body.components[0].components.map((item) => item.custom_id)).toEqual(['intro:features', 'intro:support']);
    expect(replies).toHaveLength(1);

    await send(connection, { op: 1, d: null });
    const heartbeat = await nextMessage(connection, (payload) => payload.op === 1);
    expect(heartbeat.d).toBe(3);
  });

  it('resumes on the resume URL after Discord asks it to reconnect', async () => {
    const { stub, connection } = await startShard();
    await identifyAndReady(connection);
    await eventually(async () => (await stub.status()).connected);

    await send(connection, { op: 0, t: 'MESSAGE_CREATE', s: 7, d: { id: '1', channel_id: '2', author: { id: '3' }, content: 'hello' } });
    await send(connection, { op: 7, d: null });
    await eventually(() => connection.closed);
    expect(connection.closed.code).toBe(4000);

    const resumed = await eventually(() => (servers.length >= 2 ? servers.at(-1) : null));
    resumed.stub = stub;
    expect(resumed.url).toBe('https://resume.discord.gg/?v=10&encoding=json');
    await send(resumed, { op: 10, d: { heartbeat_interval: 60_000 } });
    const resume = await nextMessage(resumed, (payload) => payload.op === 6);
    expect(resume.d).toEqual({ token: 'test-bot-token', session_id: 'session-abc', seq: 7 });
    expect(mock.callsTo('GET https://discord.com/api/v10/gateway/bot')).toHaveLength(1);

    await send(resumed, { op: 0, t: 'RESUMED', s: 8, d: {} });
    await eventually(async () => (await stub.status()).connected);
  });

  it('stops for good on a fatal close code and records why', async () => {
    const { stub, connection } = await startShard();
    await identifyAndReady(connection);
    await closeFromDiscord(connection, 4014, 'Disallowed intent(s).');
    const status = await eventually(async () => {
      const current = await stub.status();
      return current.state === 'failed' ? current : null;
    });
    expect(status.fatal).toMatchObject({ code: 4014 });

    await stub.ensureRunning({ shardId: 0, shardCount: 1 });
    expect(servers).toHaveLength(1);
  });

  it('refuses to IDENTIFY once the local daily budget is spent', async () => {
    shardSequence += 1;
    const stub = env.GATEWAY.getByName(`test-shard-${shardSequence}`);
    await runInDurableObject(stub, async (instance, state) => {
      const now = Date.now();
      instance.identifies = Array.from({ length: LOCAL_IDENTIFY_LIMIT }, (_value, index) => now - index);
      await state.storage.put('identifies', instance.identifies);
    });
    const status = await env.GATEWAY.getByName(`test-shard-${shardSequence}`).ensureRunning({ shardId: 0, shardCount: 1 });
    expect(status.state).toBe('throttled');
    expect(servers).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  it('refuses to IDENTIFY when Discord reports few session starts left', async () => {
    mock.restore();
    installFakeDiscord({ sessionStartsRemaining: 5 });
    shardSequence += 1;
    const status = await env.GATEWAY.getByName(`test-shard-${shardSequence}`).ensureRunning({ shardId: 0, shardCount: 1 });
    expect(status.state).toBe('throttled');
    expect(servers).toHaveLength(0);
  });
});
