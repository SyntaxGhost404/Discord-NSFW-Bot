import { createHash } from 'node:crypto';
import { API_BASE_URL } from './constants.js';
import { sleep as defaultSleep } from '../lib/time.js';

const MAX_RETRIES = 5;

export class DiscordRestError extends Error {
  constructor(message, { status, code, details, method, route }) {
    super(message);
    this.name = 'DiscordRestError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.method = method;
    this.route = route;
  }
}

function tokenFingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function routeMetadata(method, route) {
  const pathname = route.split('?')[0];
  const parts = pathname.split('/').filter(Boolean);
  const tokenIndexes = new Set();
  let major = 'none';

  if (parts[0] === 'interactions' && parts[2]) {
    tokenIndexes.add(2);
    major = `interactions:${tokenFingerprint(parts[2])}`;
  } else if (parts[0] === 'webhooks' && parts[1]) {
    if (parts[2]) tokenIndexes.add(2);
    major = `webhooks:${parts[1]}:${parts[2] ? tokenFingerprint(parts[2]) : 'authenticated'}`;
  } else {
    for (const resource of ['channels', 'guilds']) {
      const index = parts.indexOf(resource);
      if (index !== -1 && parts[index + 1]) {
        major = `${resource}:${parts[index + 1]}`;
        break;
      }
    }
  }

  const normalized = parts.map((part, index) => {
    if (tokenIndexes.has(index)) return ':token';
    if (!/^\d{17,20}$/.test(part)) return part;
    return ':id';
  });
  const template = `${method.toUpperCase()} /${normalized.join('/')}`;
  return Object.freeze({ template, major });
}

function normalizeRoute(method, route) {
  return routeMetadata(method, route).template;
}

function parseBody(response, text) {
  if (!text) return null;
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }
  return text;
}

function makeMultipart(body, files) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(body ?? {}));
  files.forEach((file, index) => {
    const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const blob = new Blob([bytes], { type: file.contentType || 'application/octet-stream' });
    form.append(`files[${index}]`, blob, file.name);
  });
  return form;
}

export class DiscordRestClient {
  constructor({ token, logger, fetchImpl = globalThis.fetch, sleep = defaultSleep, now = Date.now, signal = null }) {
    if (typeof fetchImpl !== 'function') throw new Error('A Fetch API implementation is required.');
    this.token = token;
    this.logger = logger.child({ subsystem: 'discord-rest' });
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.now = now;
    this.signal = signal;
    this.routeQueues = new Map();
    this.routeLimits = new Map();
    this.bucketHashes = new Map();
    this.globalResetAt = 0;
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, options) { return this.request('POST', path, options); }
  put(path, options) { return this.request('PUT', path, options); }
  patch(path, options) { return this.request('PATCH', path, options); }
  delete(path, options) { return this.request('DELETE', path, options); }

  async request(method, route, options = {}) {
    if (!route.startsWith('/')) throw new Error(`Discord route must begin with "/": ${route}`);
    const metadata = routeMetadata(method, route);
    return this.#enqueue(this.#limitKey(metadata), () => (
      this.#requestWithRetries(method, route, metadata, options)
    ));
  }

  async #enqueue(routeKey, operation) {
    const previous = this.routeQueues.get(routeKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.routeQueues.set(routeKey, current);
    try {
      return await current;
    } finally {
      if (this.routeQueues.get(routeKey) === current) this.routeQueues.delete(routeKey);
    }
  }

  async #requestWithRetries(method, route, metadata, options) {
    const retryTransient = options.retryTransient ?? method.toUpperCase() !== 'POST';
    const signal = options.signal ?? this.signal;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.#waitForRateLimit(metadata, signal);

      let response;
      try {
        response = await this.#fetch(method, route, options);
      } catch (error) {
        if (signal?.aborted || !retryTransient || attempt === MAX_RETRIES) throw error;
        const delay = Math.min(1_000 * (2 ** attempt), 10_000);
        this.logger.warn('Discord request failed before receiving a response; retrying.', {
          method,
          route: metadata.template,
          attempt: attempt + 1,
          delay,
          error,
        });
        await this.#pause(delay, signal);
        continue;
      }

      const text = await response.text();
      const payload = parseBody(response, text);
      this.#captureRateLimit(metadata, response);

      if (response.status === 429) {
        if (attempt === MAX_RETRIES) {
          throw this.#errorFromResponse(method, metadata, response, payload);
        }
        const advertisedRetryAfter = Number(payload?.retry_after ?? response.headers.get('retry-after') ?? 1);
        const retryAfterSeconds = Number.isFinite(advertisedRetryAfter) && advertisedRetryAfter >= 0
          ? advertisedRetryAfter
          : 1;
        const retryAfterMs = Math.max(0, Math.ceil(retryAfterSeconds * 1_000)) + 50;
        if (payload?.global || response.headers.get('x-ratelimit-global') === 'true') {
          this.globalResetAt = Math.max(this.globalResetAt, this.now() + retryAfterMs);
        } else {
          const limitKey = this.#limitKey(metadata);
          this.routeLimits.set(limitKey, this.now() + retryAfterMs);
        }
        this.logger.warn('Discord rate limit encountered; honoring retry_after.', {
          route: metadata.template,
          retryAfterMs,
          global: Boolean(payload?.global),
        });
        await this.#pause(retryAfterMs, signal);
        continue;
      }

      if (retryTransient && response.status >= 500 && response.status <= 599 && attempt < MAX_RETRIES) {
        const delay = Math.min(500 * (2 ** attempt), 8_000);
        await this.#pause(delay, signal);
        continue;
      }

      if (!response.ok) throw this.#errorFromResponse(method, metadata, response, payload);
      return payload;
    }
    throw new Error(`Discord request exhausted retries: ${metadata.template}`);
  }

  async #fetch(method, route, options) {
    const url = new URL(`${API_BASE_URL}${route}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    headers.set('User-Agent', 'DiscordBot (https://github.com/SyntaxGhost404/Discord-NSFW-Bot, 2.0.0)');
    if (options.auth !== false) headers.set('Authorization', `Bot ${this.token}`);

    const files = options.files ?? [];
    let body;
    if (files.length > 0) {
      body = makeMultipart(options.body, files);
    } else if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }

    return this.fetch(url, {
      method,
      headers,
      body,
      signal: options.signal ?? this.signal,
    });
  }

  #captureRateLimit(metadata, response) {
    const bucket = response.headers.get('x-ratelimit-bucket');
    if (bucket) this.bucketHashes.set(metadata.template, bucket);
    const remainingHeader = response.headers.get('x-ratelimit-remaining');
    const resetAfterHeader = response.headers.get('x-ratelimit-reset-after');
    const remaining = Number(remainingHeader);
    const resetAfter = Number(resetAfterHeader);
    if (remainingHeader !== null && resetAfterHeader !== null
      && remaining === 0 && Number.isFinite(resetAfter)) {
      const limitKey = this.#limitKey(metadata);
      this.routeLimits.set(limitKey, this.now() + Math.ceil(resetAfter * 1_000) + 50);
    }
  }

  async #waitForRateLimit(metadata, signal) {
    const limitKey = this.#limitKey(metadata);
    const resetAt = Math.max(this.globalResetAt, this.routeLimits.get(limitKey) ?? 0);
    const wait = resetAt - this.now();
    if (wait > 0) await this.#pause(wait, signal);
    if ((this.routeLimits.get(limitKey) ?? 0) <= this.now()) this.routeLimits.delete(limitKey);
  }

  #limitKey(metadata) {
    const bucket = this.bucketHashes.get(metadata.template);
    return bucket
      ? `bucket:${bucket}:major:${metadata.major}`
      : `route:${metadata.template}:major:${metadata.major}`;
  }

  #pause(milliseconds, signal) {
    if (!signal) return this.sleep(milliseconds);
    if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, milliseconds);
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  #errorFromResponse(method, metadata, response, payload) {
    const message = typeof payload === 'object' && payload?.message
      ? payload.message
      : `Discord returned HTTP ${response.status}.`;
    return new DiscordRestError(message, {
      status: response.status,
      code: typeof payload === 'object' ? payload?.code : undefined,
      details: payload,
      method,
      route: metadata.template,
    });
  }
}

export { normalizeRoute };
