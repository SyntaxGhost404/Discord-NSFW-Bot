import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pause } from '../src/pause.js';
import worker from '../src/worker.js';
import { installFetchMock } from './helpers/fetch-mock.js';

const DISCORD = 'https://discord.com/api/v10/users/';
let mock = null;
let serial = 0n;

afterEach(() => {
  mock?.restore();
  mock = null;
  pause.clear();
});

// A fresh, valid ID for each lookup, so answers kept by earlier tests never
// stand in for this one.
const freshId = () => (80351110224678912n + (serial += 1n) * 4096n).toString();

const userFor = (id, extra = {}) => ({ id, username: 'nelly', discriminator: '0', global_name: 'Nelly', avatar: null, public_flags: 64, ...extra });

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// Answers every request to Discord's user route with `respond`.
function discord(respond = (request) => json(userFor(request.url.slice(DISCORD.length)))) {
  mock = installFetchMock([[`${DISCORD}*`, respond]]);
  return mock.calls;
}

// Each visitor gets its own address unless one is given, so the per-visitor
// limit only matters in its own test.
async function get(path, { ip = `203.0.113.${Number(serial % 250n) + 1}`, bindings = env, method = 'GET' } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://lookup.example${path}`, { method, headers: { 'CF-Connecting-IP': ip } }), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('lookups', () => {
  it('asks Discord with the bot token and returns the user', async () => {
    const calls = discord();
    const id = freshId();
    const response = await get(`/api/users/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    const body = await response.json();
    expect(body.user).toEqual(userFor(id));
    expect(Date.parse(body.fetched_at)).toBeGreaterThan(0);
    expect(calls.map((call) => call.url)).toEqual([`${DISCORD}${id}`]);
    expect(calls[0].headers.authorization).toBe('Bot test-token');
    expect(calls[0].headers['user-agent']).toMatch(/^DiscordBot \(https:\/\/github\.com\/.+, \d+\.\d+\.\d+\)$/);
  });

  it('keeps a profile, so a second lookup does not ask Discord again', async () => {
    const calls = discord();
    const id = freshId();
    expect((await get(`/api/users/${id}`)).status).toBe(200);
    const again = await get(`/api/users/${id}`);
    expect(again.status).toBe(200);
    expect((await again.json()).user.id).toBe(id);
    expect(calls).toHaveLength(1);
  });

  it('reads a pasted mention or spaced digits as the ID', async () => {
    const calls = discord();
    const id = freshId();
    expect((await get(`/api/users/${encodeURIComponent(`<@${id}>`)}`)).status).toBe(200);
    expect(calls[0].url).toBe(`${DISCORD}${id}`);
  });

  it('says when no account has the ID, and keeps that for a minute', async () => {
    const calls = discord(() => json({ message: 'Unknown User', code: 10013 }, 404));
    const id = freshId();
    const response = await get(`/api/users/${id}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(await response.json()).toEqual({ error: 'unknown_user' });
    expect((await get(`/api/users/${id}`)).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('refuses what is not an ID without asking Discord', async () => {
    const calls = discord();
    for (const [raw, reason] of [['abc', 'format'], ['12345', 'format'], ['99999999999999999999', 'large'], [`${(1n << 63n).toString()}`, 'future']]) {
      const response = await get(`/api/users/${raw}`);
      expect(response.status, raw).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'bad_id', reason });
    }
    expect(calls).toHaveLength(0);
  });
});

describe('Discord failures', () => {
  it('waits as long as Discord says before asking again', async () => {
    const calls = discord(() => json({ message: 'You are being rate limited.', retry_after: 3.2, global: false }, 429));
    const first = await get(`/api/users/${freshId()}`);
    expect(first.status).toBe(429);
    expect(first.headers.get('Retry-After')).toBe('4');
    expect(await first.json()).toEqual({ error: 'discord_busy', retry_after: 4 });
    const second = await get(`/api/users/${freshId()}`);
    expect(second.status).toBe(429);
    expect((await second.json()).error).toBe('discord_busy');
    expect(calls).toHaveLength(1);
  });

  it('stops asking when Discord rejects the token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = discord(() => json({ message: '401: Unauthorized', code: 0 }, 401));
    expect(await (await get(`/api/users/${freshId()}`)).json()).toEqual({ error: 'bad_token' });
    const again = await get(`/api/users/${freshId()}`);
    expect(again.status).toBe(503);
    expect(await again.json()).toEqual({ error: 'bad_token' });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('test-token');
    error.mockRestore();
  });

  it('names each failure, caches none of them, and asks again next time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases = [
      [() => json({ message: 'Server error' }, 500), 502, { error: 'discord_error', upstream: 500 }],
      [() => json({ message: 'Missing Access', code: 50001 }, 403), 502, { error: 'forbidden', upstream: 403 }],
      [() => json({ id: '1', username: 'someone else' }), 502, { error: 'unreadable' }],
      [() => new Response('<html>Bad gateway</html>', { status: 200 }), 502, { error: 'unreadable' }],
      [() => {
        throw new TypeError('Network connection lost.');
      }, 504, { error: 'unreachable' }],
      [() => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }, 504, { error: 'timeout' }],
    ];
    for (const [respond, status, body] of cases) {
      const calls = discord(respond);
      const id = freshId();
      const response = await get(`/api/users/${id}`);
      expect(response.status, body.error).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual(body);
      await get(`/api/users/${id}`);
      expect(calls, body.error).toHaveLength(2);
    }
    warn.mockRestore();
  });

  it('says when there is no bot token, without asking Discord', async () => {
    const calls = discord();
    const response = await get(`/api/users/${freshId()}`, { bindings: { ...env, DISCORD_BOT_TOKEN: undefined } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'no_token' });
    expect(calls).toHaveLength(0);
  });
});

describe('limits and routing', () => {
  it('limits lookups per visitor', async () => {
    discord();
    const statuses = [];
    for (let index = 0; index < 22; index += 1) statuses.push((await get(`/api/users/${freshId()}`, { ip: '198.51.100.7' })).status);
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const limited = await get(`/api/users/${freshId()}`, { ip: '198.51.100.7' });
    expect(await limited.json()).toEqual({ error: 'slow_down', retry_after: 60 });
    expect((await get(`/api/users/${freshId()}`, { ip: '198.51.100.8' })).status).toBe(200);
  });

  it('allows only GET and HEAD, and knows only its own route', async () => {
    discord();
    expect((await get(`/api/users/${freshId()}`, { method: 'POST' })).status).toBe(405);
    expect((await get('/api/users')).status).toBe(404);
    expect(await (await get('/api/guilds/1')).json()).toEqual({ error: 'not_found' });
  });

  it('serves the page for every other path', async () => {
    discord();
    const response = await get('/80351110224678912');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="app"');
  });
});
