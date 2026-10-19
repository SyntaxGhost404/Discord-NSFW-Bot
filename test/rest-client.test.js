import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordRestClient, DiscordRestError, normalizeRoute } from '../src/discord/rest-client.js';
import { Logger } from '../src/lib/logger.js';

function client(fetchImpl, overrides = {}) {
  return new DiscordRestClient({
    token: 'secret-token',
    logger: new Logger('error'),
    fetchImpl,
    ...overrides,
  });
}

test('REST requests use API v10 and bot authorization', async () => {
  let request;
  const rest = client(async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const result = await rest.get('/gateway/bot');
  assert.deepEqual(result, { ok: true });
  assert.equal(request.url.toString(), 'https://discord.com/api/v10/gateway/bot');
  assert.equal(request.options.headers.get('Authorization'), 'Bot secret-token');
});

test('unauthenticated interaction callbacks omit bot authorization', async () => {
  let authorization;
  const rest = client(async (_url, options) => {
    authorization = options.headers.get('Authorization');
    return new Response(null, { status: 204 });
  });
  await rest.post('/interactions/123/token/callback', { auth: false, body: { type: 1 } });
  assert.equal(authorization, null);
});

test('429 responses honor retry_after and retry once', async () => {
  let calls = 0;
  let clock = 0;
  const waits = [];
  const rest = client(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: 'rate limited', retry_after: 0.01, global: false }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }, {
    now: () => clock,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
  });
  assert.deepEqual(await rest.get('/gateway/bot'), { success: true });
  assert.equal(calls, 2);
  assert.ok(waits.some((milliseconds) => milliseconds >= 10));
});

test('Discord API errors expose status and JSON code without retries', async () => {
  let calls = 0;
  const rest = client(async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: '401: Unauthorized', code: 0 }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  });
  await assert.rejects(
    rest.get('/users/@me'),
    (error) => error instanceof DiscordRestError && error.status === 401 && error.code === 0,
  );
  assert.equal(calls, 1);
});

test('non-idempotent requests can disable ambiguous transport and server retries', async () => {
  let transportCalls = 0;
  const transportClient = client(async () => {
    transportCalls += 1;
    throw new TypeError('socket closed after request write');
  });
  await assert.rejects(
    transportClient.post('/interactions/123456789012345678/token/callback', {
      body: { type: 5 },
      retryTransient: false,
    }),
    /socket closed/,
  );
  assert.equal(transportCalls, 1);

  let serverCalls = 0;
  const serverClient = client(async () => {
    serverCalls += 1;
    return new Response(JSON.stringify({ message: 'temporary failure' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  });
  await assert.rejects(
    serverClient.post('/interactions/123456789012345678/token/callback', {
      body: { type: 5 },
      retryTransient: false,
    }),
    (error) => error.status === 502,
  );
  assert.equal(serverCalls, 1);
});

test('POST requests default to at-most-once behavior after ambiguous failures', async () => {
  let transportCalls = 0;
  const transportClient = client(async () => {
    transportCalls += 1;
    throw new TypeError('socket closed after write');
  });
  await assert.rejects(
    transportClient.post('/channels/123456789012345678/messages', { body: { content: 'hello' } }),
    /socket closed/,
  );
  assert.equal(transportCalls, 1);

  let serverCalls = 0;
  const serverClient = client(async () => {
    serverCalls += 1;
    return new Response(JSON.stringify({ message: 'temporary failure' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  });
  await assert.rejects(
    serverClient.post('/webhooks/123456789012345678/sensitive-token', { body: { content: 'hello' } }),
    (error) => error.status === 503,
  );
  assert.equal(serverCalls, 1);
});

test('normalized routes and Discord errors never expose interaction or webhook tokens', async () => {
  const secret = 'sensitive.interaction-token';
  assert.equal(
    normalizeRoute('POST', `/interactions/123456789012345678/${secret}/callback`),
    'POST /interactions/:id/:token/callback',
  );
  assert.equal(
    normalizeRoute('PATCH', `/webhooks/234567890123456789/${secret}/messages/@original`),
    'PATCH /webhooks/:id/:token/messages/@original',
  );

  const rest = client(async () => new Response(JSON.stringify({ message: 'bad request', code: 50_035 }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  }));
  await assert.rejects(
    rest.post(`/interactions/123456789012345678/${secret}/callback`, { body: { type: 5 } }),
    (error) => {
      assert.equal(error.route, 'POST /interactions/:id/:token/callback');
      assert.doesNotMatch(error.route, new RegExp(secret.replace('.', '\\.')));
      return true;
    },
  );
});

test('internal queue and bucket routing keys use token fingerprints only', async () => {
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  const rest = client(async () => response);
  const secret = 'never-log-this-webhook-token';
  const request = rest.patch(`/webhooks/234567890123456789/${secret}/messages/@original`, {
    body: { content: 'hello' },
  });
  const routingKeys = [...rest.routeQueues.keys()].join('\n');
  assert.doesNotMatch(routingKeys, new RegExp(secret));
  assert.match(routingKeys, /major:webhooks:234567890123456789:[a-f0-9]{16}/);
  release(new Response(null, { status: 204 }));
  await request;
});

test('Discord bucket hashes coordinate rate limits across learned routes', async () => {
  let clock = 0;
  let call = 0;
  const waits = [];
  const rest = client(async () => {
    call += 1;
    const headers = {
      'content-type': 'application/json',
      'x-ratelimit-bucket': 'shared-interaction-bucket',
      'x-ratelimit-remaining': call === 2 ? '0' : '1',
      'x-ratelimit-reset-after': '0.01',
    };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }, {
    now: () => clock,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
  });
  const token = 'same-interaction-token';
  await rest.patch(`/webhooks/123456789012345678/${token}/messages/@original`, { body: { content: 'one' } });
  await rest.post(`/webhooks/123456789012345678/${token}`, { body: { content: 'two' } });
  await rest.patch(`/webhooks/123456789012345678/${token}/messages/@original`, { body: { content: 'three' } });
  assert.equal(call, 3);
  assert.ok(waits.some((milliseconds) => milliseconds >= 60));
});

test('shutdown abort cancels Discord retries and rate-limit waits immediately', async () => {
  const shutdown = new AbortController();
  let calls = 0;
  const rest = client(async () => {
    calls += 1;
    return new Response(JSON.stringify({ retry_after: 30, global: false }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }, { signal: shutdown.signal });
  const request = rest.get('/gateway/bot');
  await new Promise((resolve) => setImmediate(resolve));
  shutdown.abort(new Error('application shutdown'));
  await assert.rejects(request, /application shutdown/);
  assert.equal(calls, 1);
});
