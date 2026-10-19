import { MediaProviderError } from './errors.js';

const DEFAULT_JSON_BYTES = 1024 * 1024;
const DEFAULT_TEXT_BYTES = 2 * 1024 * 1024;

// Discord renders attachment:// images in embeds only for these formats.
export const EMBEDDABLE_IMAGE_TYPES = Object.freeze(new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]));

export function validateUrl(value) {
  let url;
  try {
    url = value instanceof URL ? new URL(value) : new URL(String(value));
  } catch (cause) {
    throw new MediaProviderError('Provider returned a malformed URL.', { code: 'INVALID_URL', cause });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MediaProviderError(`Unsupported media URL protocol: ${url.protocol}`, { code: 'INVALID_URL' });
  }
  return url;
}

export function hostAllowed(value, allowedHosts, allowSubdomains = true) {
  if (!allowedHosts?.length) return true;
  const hostname = validateUrl(value).hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const normalized = String(entry).toLowerCase().replace(/^\./, '');
    return hostname === normalized || (allowSubdomains && hostname.endsWith(`.${normalized}`));
  });
}

function assertAllowedHost(value, allowedHosts, allowSubdomains) {
  if (!hostAllowed(value, allowedHosts, allowSubdomains)) {
    throw new MediaProviderError(`Provider returned an unexpected host: ${validateUrl(value).hostname}`, {
      code: 'UNEXPECTED_HOST',
    });
  }
}

// Identifies an image by its magic bytes so CDN block pages served with a
// 200 status and a misleading Content-Type are never uploaded to Discord.
export function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

async function readBounded(response, maximumBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel();
    throw new MediaProviderError(`Response exceeds the ${maximumBytes}-byte limit.`, { code: 'TOO_LARGE' });
  }
  if (!response.body) return new Uint8Array(0);

  // Streamed with a running total: Content-Length can be absent, and a
  // compressed body may inflate well past its declared size.
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new MediaProviderError(`Response exceeds the ${maximumBytes}-byte limit.`, { code: 'TOO_LARGE' });
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class SubrequestBudget {
  constructor(limit) {
    this.limit = limit;
    this.used = 0;
  }

  get remaining() {
    return Math.max(0, this.limit - this.used);
  }

  take() {
    if (this.used >= this.limit) {
      throw new MediaProviderError('The per-invocation subrequest budget is exhausted.', { code: 'BUDGET_EXHAUSTED' });
    }
    this.used += 1;
  }
}

export class MediaHttpClient {
  constructor({
    timeoutMs,
    maximumBytes,
    deadline = Number.POSITIVE_INFINITY,
    budget = null,
    signal = null,
    fetchImpl = (...args) => fetch(...args),
    now = Date.now,
  }) {
    this.timeoutMs = timeoutMs;
    this.maximumBytes = maximumBytes;
    this.deadline = deadline;
    this.budget = budget;
    this.signal = signal;
    this.fetch = fetchImpl;
    this.now = now;
  }

  remainingTime() {
    return this.deadline - this.now();
  }

  async json(url, options = {}) {
    const { bytes } = await this.#request(url, options, (response) => readBounded(
      response,
      options.maximumBytes ?? DEFAULT_JSON_BYTES,
    ));
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (cause) {
      throw new MediaProviderError('Provider returned invalid JSON.', { code: 'INVALID_RESPONSE', cause });
    }
  }

  async text(url, options = {}) {
    const { bytes } = await this.#request(url, options, (response) => readBounded(
      response,
      options.maximumBytes ?? DEFAULT_TEXT_BYTES,
    ));
    return new TextDecoder().decode(bytes);
  }

  // Downloads media for re-upload. With `expectImage`, the bytes must be an
  // image format Discord can show inside an embed.
  async buffer(url, options = {}) {
    const maximumBytes = Math.min(options.maximumBytes ?? this.maximumBytes, this.maximumBytes);
    const result = await this.#request(url, options, (response) => readBounded(response, maximumBytes));
    const { bytes, response } = result;
    if (bytes.length < (options.minimumBytes ?? 1)) {
      throw new MediaProviderError('Provider returned an empty or truncated media payload.', { code: 'INVALID_RESPONSE' });
    }
    const declaredType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    let contentType = declaredType;
    if (options.expectImage) {
      const sniffed = sniffImageType(bytes);
      if (!sniffed || !EMBEDDABLE_IMAGE_TYPES.has(sniffed)) {
        throw new MediaProviderError(`Provider returned a non-image payload (${declaredType}).`, { code: 'INVALID_RESPONSE' });
      }
      contentType = sniffed;
    }
    return {
      buffer: bytes,
      contentType,
      finalUrl: response.url || String(url),
    };
  }

  async #request(url, options, consume) {
    const parsed = validateUrl(url);
    assertAllowedHost(parsed, options.allowedHosts, options.allowSubdomains);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) parsed.searchParams.set(key, String(value));
    }

    const configuredTimeout = options.timeoutMs ?? this.timeoutMs;
    const remaining = this.remainingTime();
    if (remaining <= 0) {
      throw new MediaProviderError('The media deadline elapsed before the request started.', { code: 'DEADLINE_EXCEEDED' });
    }
    const timeout = Math.min(configuredTimeout, remaining);
    const clippedByDeadline = timeout < configuredTimeout;
    this.budget?.take();

    const timeoutSignal = AbortSignal.timeout(timeout);
    const signal = this.signal ? AbortSignal.any([timeoutSignal, this.signal]) : timeoutSignal;
    try {
      const response = await this.fetch(parsed.toString(), {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        redirect: 'follow',
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new MediaProviderError(`Provider returned HTTP ${response.status}.`, {
          code: 'HTTP_ERROR',
          status: response.status,
        });
      }
      assertAllowedHost(response.url || parsed, options.allowedHosts, options.allowSubdomains);
      const bytes = await consume(response);
      return { bytes, response };
    } catch (error) {
      if (error instanceof MediaProviderError) throw error;
      if (timeoutSignal.aborted) {
        throw new MediaProviderError(
          clippedByDeadline ? 'The media deadline elapsed during the request.' : 'Media request timed out.',
          { code: clippedByDeadline ? 'DEADLINE_EXCEEDED' : 'TIMEOUT', cause: error },
        );
      }
      if (this.signal?.aborted) {
        throw new MediaProviderError('Media request was cancelled.', { code: 'ABORTED', cause: error });
      }
      throw new MediaProviderError(error?.message || 'Media request failed.', { code: 'NETWORK_ERROR', cause: error });
    }
  }
}
