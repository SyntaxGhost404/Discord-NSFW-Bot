import { readId } from '../public/js/snowflake.js';
import { pause } from './pause.js';

// The page is static files. This Worker runs only for /api/* and answers one
// route, which asks the Discord API for a user and returns its answer:
//
//   GET /api/users/<id>
//
// Only GET /users/{id} is ever requested from Discord, with the bot token
// from the DISCORD_BOT_TOKEN secret, which never leaves the Worker.

const DISCORD_API = 'https://discord.com/api/v10';
// Discord asks every client for "DiscordBot ($url, $versionNumber)".
const USER_AGENT = 'DiscordBot (https://github.com/SyntaxGhost404/Discord-NSFW-Bot, 1.0.0)';
const TIMEOUT_MS = 8_000;
// Seconds a profile is kept, at the edge and in the browser. An ID without an
// account is kept for a minute.
const FOUND_TTL = 300;
const UNKNOWN_TTL = 60;
// How long to stop asking Discord after it rejects the bot token, and how
// long to wait on a 429 that gives no time.
const BAD_TOKEN_PAUSE_MS = 60_000;
const DEFAULT_RETRY_SECONDS = 5;
// The per-visitor limit's window, from wrangler.jsonc.
const LIMIT_PERIOD_SECONDS = 60;
const API_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
});

// `detail` goes into the error answer as is, such as { retry_after: 12 }.
class LookupError extends Error {
  constructor(status, code, detail = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function json(body, status = 200, ttl = 0, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...API_HEADERS, 'Cache-Control': ttl > 0 ? `public, max-age=${ttl}` : 'no-store', ...extra },
  });
}

async function askDiscord(id, token) {
  let response;
  try {
    response = await fetch(`${DISCORD_API}/users/${id}`, {
      headers: { Authorization: `Bot ${token}`, 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new LookupError(504, error?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
  const body = await response.json().catch(() => null);
  if (response.ok) {
    if (typeof body?.id !== 'string' || body.id !== id) throw new LookupError(502, 'unreadable');
    return body;
  }
  // 10013, Unknown user: no account has this ID.
  if (response.status === 404) throw new LookupError(404, 'unknown_user');
  if (response.status === 429) {
    const seconds = Number(body?.retry_after ?? response.headers.get('Retry-After'));
    const wait = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_SECONDS;
    pause.start('discord_busy', wait * 1000);
    throw new LookupError(429, 'discord_busy', { retry_after: Math.ceil(wait) });
  }
  if (response.status === 401) {
    pause.start('bad_token', BAD_TOKEN_PAUSE_MS);
    console.error(JSON.stringify({ message: 'Discord rejected the bot token.' }));
    throw new LookupError(503, 'bad_token');
  }
  console.warn(JSON.stringify({ message: 'Discord error.', status: response.status, code: body?.code ?? null }));
  throw new LookupError(502, response.status === 403 ? 'forbidden' : 'discord_error', { upstream: response.status });
}

async function lookup(request, env, ctx, raw) {
  const checked = readId(raw);
  if (checked.error) throw new LookupError(400, 'bad_id', { reason: checked.error });
  const { id } = checked;
  // Answers are kept under the plain address of the ID, so any way of
  // writing it shares them.
  const cache = caches.default;
  const key = new Request(new URL(`/api/users/${id}`, request.url));
  const kept = await cache.match(key);
  if (kept) return kept;
  if (env.LOOKUPS) {
    const { success } = await env.LOOKUPS.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'anonymous' });
    if (!success) throw new LookupError(429, 'slow_down', { retry_after: LIMIT_PERIOD_SECONDS });
  }
  if (!env.DISCORD_BOT_TOKEN) throw new LookupError(503, 'no_token');
  const paused = pause.current();
  if (paused) throw new LookupError(paused.error === 'bad_token' ? 503 : 429, paused.error, paused.error === 'bad_token' ? {} : { retry_after: paused.seconds });
  let answer;
  try {
    const user = await askDiscord(id, env.DISCORD_BOT_TOKEN);
    answer = json({ user, fetched_at: new Date().toISOString() }, 200, FOUND_TTL);
  } catch (error) {
    if (!(error instanceof LookupError) || error.code !== 'unknown_user') throw error;
    answer = json({ error: 'unknown_user' }, 404, UNKNOWN_TTL);
  }
  ctx.waitUntil(cache.put(key, answer.clone()));
  return answer;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405, 0, { Allow: 'GET, HEAD' });
    }
    try {
      const match = url.pathname.match(/^\/api\/users\/([^/]{1,64})$/);
      if (!match) throw new LookupError(404, 'not_found');
      let raw = '';
      try {
        raw = decodeURIComponent(match[1]);
      } catch {
        raw = match[1];
      }
      return await lookup(request, env, ctx, raw);
    } catch (error) {
      if (error instanceof LookupError) {
        const retry = error.detail.retry_after ? { 'Retry-After': String(error.detail.retry_after) } : {};
        return json({ error: error.code, ...error.detail }, error.status, 0, retry);
      }
      console.error(JSON.stringify({ message: 'Unexpected API error.', path: url.pathname, error: String(error?.stack ?? error) }));
      return json({ error: 'internal' }, 500);
    }
  },
};
