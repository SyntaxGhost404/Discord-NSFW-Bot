import { API_BASE_URL, UNAVAILABLE_INTERACTION_CODES, USER_AGENT } from './constants.js';
import { sleep } from '../lib/time.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_RETRIES = 2;
const DEFAULT_MAX_RETRY_AFTER_MS = 10_000;

export class DiscordRestError extends Error {
  constructor(message, { status, code, details, method, route, retryAfterMs } = {}) {
    super(message);
    this.name = 'DiscordRestError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.method = method;
    this.route = route;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isInteractionUnavailableError(error) {
  return error instanceof DiscordRestError && UNAVAILABLE_INTERACTION_CODES.has(Number(error.code));
}

// Normalises a path for logs and rate-limit keys: snowflakes become `:id` and
// interaction/webhook tokens are replaced so they never reach log storage.
export function routeTemplate(method, path) {
  const parts = path.split('?')[0].split('/').filter(Boolean);
  const tokenRoute = parts[0] === 'interactions' || parts[0] === 'webhooks';
  const normalized = parts.map((part, index) => {
    if (tokenRoute && index === 2) return ':token';
    return /^\d{17,20}$/.test(part) ? ':id' : part;
  });
  return `${method.toUpperCase()} /${normalized.join('/')}`;
}

function majorParameter(path) {
  const parts = path.split('?')[0].split('/').filter(Boolean);
  if ((parts[0] === 'webhooks' || parts[0] === 'interactions') && parts[1]) return `${parts[0]}:${parts[1]}:${parts[2] ?? ''}`;
  for (const resource of ['channels', 'guilds']) {
    const index = parts.indexOf(resource);
    if (index !== -1 && parts[index + 1]) return `${resource}:${parts[index + 1]}`;
  }
  return 'global';
}

export function multipartBody(body, files) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(body ?? {}));
  files.forEach((file, index) => {
    form.append(`files[${index}]`, new Blob([file.data], { type: file.contentType || 'application/octet-stream' }), file.name);
  });
  return form;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return { message: text.slice(0, 500) };
    }
  }
  return text.slice(0, 2_000);
}

// Per-isolate memory of exhausted buckets. Workers isolates are short-lived
// and not shared, so this only prevents bursts from one isolate; Discord's
// 429 response remains the authoritative signal.
const exhaustedRoutes = new Map();

export class DiscordRest {
  constructor({ token = null, fetchImpl = (...args) => fetch(...args), logger = null, now = Date.now, baseUrl = API_BASE_URL } = {}) {
    this.token = token;
    this.fetch = fetchImpl;
    this.logger = logger?.child?.({ subsystem: 'discord-rest' }) ?? null;
    this.now = now;
    this.baseUrl = baseUrl;
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, options) { return this.request('POST', path, options); }
  put(path, options) { return this.request('PUT', path, options); }
  patch(path, options) { return this.request('PATCH', path, options); }
  delete(path, options) { return this.request('DELETE', path, options); }

  async request(method, path, options = {}) {
    if (!path.startsWith('/')) throw new Error(`Discord route must begin with "/": ${path}`);
    const route = routeTemplate(method, path);
    const limitKey = `${route}|${majorParameter(path)}`;
    const maxRetries = options.rateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES;
    const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;

    for (let attempt = 0; ; attempt += 1) {
      const resetAt = exhaustedRoutes.get(limitKey) ?? 0;
      const wait = resetAt - this.now();
      if (wait > 0) {
        if (wait > maxRetryAfterMs) {
          throw new DiscordRestError('Discord rate limit bucket is exhausted.', { status: 429, method, route, retryAfterMs: wait });
        }
        await sleep(wait, options.signal);
      }

      const response = await this.#send(method, path, options);
      this.#rememberBucket(limitKey, response);
      const payload = await parseResponse(response);

      if (response.status === 429) {
        const retryAfterSeconds = Number(payload?.retry_after ?? response.headers.get('retry-after') ?? 1);
        const retryAfterMs = Math.ceil((Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds : 1) * 1_000) + 50;
        this.logger?.warn('Discord rate limit encountered.', {
          route,
          retryAfterMs,
          global: Boolean(payload?.global),
          scope: response.headers.get('x-ratelimit-scope'),
        });
        if (attempt < maxRetries && retryAfterMs <= maxRetryAfterMs) {
          await sleep(retryAfterMs, options.signal);
          continue;
        }
        throw new DiscordRestError(payload?.message || 'Discord rate limited the request.', {
          status: 429, code: payload?.code, details: payload, method, route, retryAfterMs,
        });
      }
      if (!response.ok) {
        throw new DiscordRestError(
          typeof payload === 'object' && payload?.message ? payload.message : `Discord returned HTTP ${response.status}.`,
          { status: response.status, code: typeof payload === 'object' ? payload?.code : undefined, details: payload, method, route },
        );
      }
      return payload;
    }
  }

  async #send(method, path, options) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = new Headers(options.headers);
    headers.set('User-Agent', USER_AGENT);
    if (options.auth !== false) {
      if (!this.token) throw new Error('A Discord bot token is required for this request.');
      headers.set('Authorization', `Bot ${this.token}`);
    }

    let body;
    const files = options.files ?? [];
    if (files.length > 0) {
      body = multipartBody(options.body, files);
    } else if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const signals = [AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)];
    if (options.signal) signals.push(options.signal);
    return this.fetch(url.toString(), {
      method,
      headers,
      body,
      signal: AbortSignal.any(signals),
    });
  }

  #rememberBucket(limitKey, response) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const resetAfter = Number(response.headers.get('x-ratelimit-reset-after'));
    if (remaining === '0' && Number.isFinite(resetAfter)) {
      exhaustedRoutes.set(limitKey, this.now() + Math.ceil(resetAfter * 1_000) + 50);
    } else if (exhaustedRoutes.has(limitKey) && exhaustedRoutes.get(limitKey) <= this.now()) {
      exhaustedRoutes.delete(limitKey);
    }
  }
}

// ctx.waitUntil() keeps a Worker alive for 30 s after the response; edits are
// bounded to finish inside that window instead of being cancelled midway.
const WAIT_UNTIL_WINDOW_MS = 29_000;

// Interaction webhooks are authenticated by the interaction token itself, so
// the bot token is never sent on these routes.
export class InteractionWebhook {
  constructor({ rest, applicationId, token, receivedAt = Date.now(), now = Date.now }) {
    this.rest = rest;
    this.applicationId = applicationId;
    this.token = token;
    this.receivedAt = receivedAt;
    this.now = now;
  }

  get originalPath() {
    return `/webhooks/${this.applicationId}/${this.token}/messages/@original`;
  }

  async editOriginal(body, files = []) {
    // An inline deferred response is processed by Discord after our HTTP reply
    // is delivered. A very fast follow-up can therefore arrive before the
    // placeholder exists; retry that narrow window instead of failing.
    for (let attempt = 0; ; attempt += 1) {
      const timeoutMs = Math.min(15_000, Math.max(2_000, this.receivedAt + WAIT_UNTIL_WINDOW_MS - this.now()));
      try {
        return await this.rest.patch(this.originalPath, { body, files, auth: false, rateLimitRetries: 3, timeoutMs });
      } catch (error) {
        const early = this.now() - this.receivedAt < 5_000;
        const missing = error instanceof DiscordRestError && (error.code === 10015 || error.code === 10008 || error.status === 404);
        if (!(early && missing && attempt < 2)) throw error;
        await sleep(attempt === 0 ? 250 : 750);
      }
    }
  }

  followup(body, files = []) {
    return this.rest.post(`/webhooks/${this.applicationId}/${this.token}`, {
      body,
      files,
      auth: false,
      query: { wait: true },
    });
  }
}
