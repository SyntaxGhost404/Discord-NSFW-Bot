import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter, once } from 'node:events';
import {
  DiscordGatewayClient,
  closeDisposition,
  gatewayUrl,
  identifyPayload,
  resumePayload,
} from '../src/discord/gateway-client.js';
import { Logger } from '../src/lib/logger.js';

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    });
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }

  terminate() {
    this.close(1006, 'terminated');
  }
}

function gatewayClient() {
  FakeWebSocket.instances.length = 0;
  return new DiscordGatewayClient({
    token: 'token',
    intents: 4_609,
    rest: {
      async get(route) {
        assert.equal(route, '/gateway/bot');
        return {
          url: 'wss://gateway.discord.gg',
          session_start_limit: { remaining: 100, reset_after: 0 },
        };
      },
    },
    logger: new Logger('error'),
    WebSocketImpl: FakeWebSocket,
  });
}

test('gateway URLs always request API v10 JSON without transport compression', () => {
  const url = new URL(gatewayUrl('wss://resume.discord.gg/?v=9&encoding=etf&compress=zlib-stream'));
  assert.equal(url.searchParams.get('v'), '10');
  assert.equal(url.searchParams.get('encoding'), 'json');
  assert.equal(url.searchParams.has('compress'), false);
});

test('identify payload contains the configured intents and no privileged token leak elsewhere', () => {
  const payload = identifyPayload('token', 4609);
  assert.equal(payload.op, 2);
  assert.equal(payload.d.token, 'token');
  assert.equal(payload.d.intents, 4609);
  assert.equal(payload.d.compress, undefined);
});

test('resume payload preserves session and sequence', () => {
  assert.deepEqual(resumePayload('token', 'session', 42), {
    op: 6,
    d: { token: 'token', session_id: 'session', seq: 42 },
  });
});

test('gateway close codes select the documented recovery path', () => {
  assert.equal(closeDisposition(4004), 'fatal');
  assert.equal(closeDisposition(4014), 'fatal');
  assert.equal(closeDisposition(4007), 'identify');
  assert.equal(closeDisposition(4009), 'identify');
  assert.equal(closeDisposition(1006), 'resume');
});

test('gateway client identifies, records READY state, heartbeats, and stops cleanly', async () => {
  const client = gatewayClient();
  await client.connect();
  await new Promise((resolve) => queueMicrotask(resolve));
  const socket = FakeWebSocket.instances[0];
  socket.emit('message', JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }), false);
  assert.equal(socket.sent[0].op, 2);
  assert.equal(socket.sent[0].d.intents, 4_609);

  const readyEvent = once(client, 'ready');
  socket.emit('message', JSON.stringify({
    op: 0,
    s: 7,
    t: 'READY',
    d: {
      session_id: 'session',
      resume_gateway_url: 'wss://resume.discord.gg',
      user: { id: '123', username: 'bot' },
      guilds: [{ id: '1' }, { id: '2' }],
    },
  }), false);
  await readyEvent;
  assert.equal(client.sessionId, 'session');
  assert.equal(client.sequence, 7);
  assert.equal(client.guildCount, 2);

  socket.emit('message', JSON.stringify({ op: 1, d: null }), false);
  assert.equal(socket.sent.at(-1).op, 1);
  assert.equal(socket.sent.at(-1).d, 7);
  socket.emit('message', JSON.stringify({ op: 11, d: null }), false);
  assert.ok(client.ping >= 0);
  await client.stop();
  assert.equal(client.stopped, true);
});

test('fatal Gateway close codes stop the reconnect loop', async () => {
  const client = gatewayClient();
  await client.connect();
  await new Promise((resolve) => queueMicrotask(resolve));
  const fatal = once(client, 'fatal');
  FakeWebSocket.instances[0].close(4004, 'authentication failed');
  const [error] = await fatal;
  assert.equal(error.code, 4004);
  await client.stop();
});
