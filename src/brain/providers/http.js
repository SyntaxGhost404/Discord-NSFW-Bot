import { MediaProviderError } from './errors.js';

const DEFAULT_JSON_BYTES = 1024 * 1024;
const DEFAULT_TEXT_BYTES = 2 * 1024 * 1024;
// A provider that has not started answering by now is treated as down, so
// the next source gets its turn instead of waiting out the full timeout.
const DEFAULT_HEADERS_TIMEOUT_MS = 4_000;

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

const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function fourCc(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

// Walks the JPEG segments up to the first frame header, which holds the size.
function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
    } else if (marker === 0xd9 || marker === 0xda) {
      return null;
    } else if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 8 >= bytes.length) return null;
      return { width: (bytes[offset + 7] << 8) | bytes[offset + 8], height: (bytes[offset + 5] << 8) | bytes[offset + 6] };
    } else {
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 30) return null;
  const chunk = fourCc(bytes, 12);
  if (chunk === 'VP8X') {
    return {
      width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    };
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

// Reads an image's pixel size from its header without decoding it. Returns
// null when the header is missing or malformed.
export function imageDimensions(bytes) {
  switch (sniffImageType(bytes)) {
    case 'image/jpeg':
      return jpegDimensions(bytes);
    case 'image/png': {
      if (bytes.length < 24 || fourCc(bytes, 12) !== 'IHDR') return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    case 'image/gif':
      return bytes.length < 10 ? null : { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
    case 'image/webp':
      return webpDimensions(bytes);
    default:
      return null;
  }
}

// Stand-in pictures that image hosts serve with status 200 in place of a
// missing or withheld file. Only downloads of exactly the same length are
// hashed, so the check costs nothing for real media.
export const KNOWN_PLACEHOLDERS = Object.freeze([
  // imgbox "Thumbnail Temporarily Unavailable", a 240x240 JPEG.
  Object.freeze({ bytes: 8_091, sha256: 'c0ff95f9ec7fea007b8236e8efddfcc6c0dfdd56f8e4c38c8ffed8fde655d8a7' }),
]);

async function isKnownPlaceholder(bytes, placeholders) {
  const sameLength = placeholders.filter((placeholder) => placeholder.bytes === bytes.byteLength);
  if (sameLength.length === 0) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return sameLength.some((placeholder) => placeholder.sha256 === hex);
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

// Reads at most `length` bytes from a stream and then cancels it, so only
// the start of a large file is ever transferred.
async function readPrefix(stream, length) {
  const reader = stream.getReader();
  const bytes = new Uint8Array(length);
  let received = 0;
  while (received < length) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.byteLength, length - received);
    bytes.set(value.subarray(0, take), received);
    received += take;
  }
  await reader.cancel().catch(() => {});
  return bytes.subarray(0, received);
}

// Some servers send a .gz file as is, without Content-Encoding. Its first
// bytes decide whether the body is unpacked on the way.
async function readTextPrefix(response, length) {
  if (!response.body) return new Uint8Array(0);
  const source = response.body.getReader();
  try {
    const first = await source.read();
    if (first.done) return new Uint8Array(0);
    let stream = new ReadableStream({
      start(controller) {
        controller.enqueue(first.value);
      },
      async pull(controller) {
        const { done, value } = await source.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return source.cancel(reason);
      },
    });
    if (first.value[0] === 0x1f && first.value[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    return await readPrefix(stream, length);
  } finally {
    // Cancelling the unpacked side does not reliably reach the download, so
    // the download itself is cancelled once the prefix is read.
    await source.cancel().catch(() => {});
  }
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
    placeholders = KNOWN_PLACEHOLDERS,
    headersTimeoutMs = DEFAULT_HEADERS_TIMEOUT_MS,
    onDownload = null,
  }) {
    this.timeoutMs = timeoutMs;
    this.maximumBytes = maximumBytes;
    this.deadline = deadline;
    this.budget = budget;
    this.signal = signal;
    this.fetch = fetchImpl;
    this.now = now;
    this.placeholders = placeholders;
    this.headersTimeoutMs = headersTimeoutMs;
    this.onDownload = onDownload;
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

  // Reads only the first `length` bytes of a text file, unpacking it first
  // when it is gzip, and cancels the rest of the transfer.
  async textPrefix(url, options = {}) {
    const { bytes } = await this.#request(url, options, (response) => readTextPrefix(response, options.length ?? 64 * 1024));
    return new TextDecoder().decode(bytes);
  }

  // Downloads media for re-upload. With `expectImage`, the bytes must be an
  // image format Discord can show inside an embed and must not be a known
  // placeholder; `minimumDimension` also requires a readable header with at
  // least that many pixels in each direction. `onDownload` hears about each
  // download as it starts, since the result will most likely be a file.
  async buffer(url, options = {}) {
    this.onDownload?.();
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
      if (await isKnownPlaceholder(bytes, this.placeholders)) {
        throw new MediaProviderError('Provider returned a known "image unavailable" placeholder.', { code: 'PLACEHOLDER_IMAGE' });
      }
      if (options.minimumDimension) {
        const size = imageDimensions(bytes);
        if (!size) {
          throw new MediaProviderError('Provider returned an image with an unreadable header.', { code: 'INVALID_RESPONSE' });
        }
        if (size.width < options.minimumDimension || size.height < options.minimumDimension) {
          throw new MediaProviderError(`Provider returned a ${size.width}x${size.height} image, below the ${options.minimumDimension}px minimum.`, {
            code: 'IMAGE_TOO_SMALL',
          });
        }
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
    const headersTimeout = options.headersTimeoutMs ?? this.headersTimeoutMs;
    this.budget?.take();

    const timeoutSignal = AbortSignal.timeout(timeout);
    // The first-byte timeout stops at the response headers; the full timeout
    // still bounds reading a large body.
    const headersController = new AbortController();
    const headersTimer = headersTimeout < timeout
      ? setTimeout(() => headersController.abort(new Error('No response headers in time.')), headersTimeout)
      : null;
    const signals = [timeoutSignal, headersController.signal];
    if (this.signal) signals.push(this.signal);
    const signal = AbortSignal.any(signals);
    try {
      const response = await this.fetch(parsed.toString(), {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        redirect: 'follow',
        signal,
      });
      clearTimeout(headersTimer);
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
      clearTimeout(headersTimer);
      if (error instanceof MediaProviderError) throw error;
      if (headersController.signal.aborted && !timeoutSignal.aborted) {
        throw new MediaProviderError(`Provider did not start responding within ${headersTimeout} ms.`, { code: 'TIMEOUT', cause: error });
      }
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
