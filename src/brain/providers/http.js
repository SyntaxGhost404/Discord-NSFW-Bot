import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { MediaProviderError } from './errors.js';

function validateUrl(value) {
  const url = value instanceof URL ? new URL(value) : new URL(String(value));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MediaProviderError(`Unsupported media URL protocol: ${url.protocol}`, { code: 'INVALID_URL' });
  }
  return url;
}

function assertAllowedHost(value, allowedHosts, allowSubdomains = true) {
  if (!allowedHosts?.length) return;
  const hostname = validateUrl(value).hostname.toLowerCase();
  const allowed = allowedHosts.some((entry) => {
    const normalized = String(entry).toLowerCase().replace(/^\./, '');
    return hostname === normalized || (allowSubdomains && hostname.endsWith(`.${normalized}`));
  });
  if (!allowed) {
    throw new MediaProviderError(`Provider returned an unexpected media host: ${hostname}`, { code: 'UNEXPECTED_HOST' });
  }
}

function assertSize(response, maximumBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new MediaProviderError(`Media exceeds the ${maximumBytes}-byte download limit.`, { code: 'TOO_LARGE' });
  }
}

function networkErrorMessage(error) {
  const message = error?.message || 'Media request failed.';
  const code = error?.cause?.code || error?.code;
  return code && !message.includes(String(code)) ? `${message} (${code})` : message;
}

export class MediaHttpClient {
  constructor({ timeoutMs, maximumBytes, logger, fetchImpl = globalThis.fetch, signal = null }) {
    this.timeoutMs = timeoutMs;
    this.maximumBytes = maximumBytes;
    this.logger = logger.child({ subsystem: 'media-http' });
    this.fetch = fetchImpl;
    this.signal = signal;
  }

  async json(url, options = {}) {
    return this.#request(url, options, async (response) => {
      try {
        return await response.json();
      } catch (error) {
        throw new MediaProviderError('Provider returned invalid JSON.', { code: 'INVALID_RESPONSE', cause: error });
      }
    });
  }

  withMaximumBytes(maximumBytes) {
    const bounded = Math.min(this.maximumBytes, maximumBytes);
    return {
      json: this.json.bind(this),
      text: (url, options = {}) => this.text(url, {
        ...options,
        maximumBytes: Math.min(options.maximumBytes ?? bounded, bounded),
      }),
      buffer: (url, options = {}) => this.buffer(url, { ...options, maximumBytes: Math.min(options.maximumBytes ?? bounded, bounded) }),
      expiredCertificateHttpsBuffer: (url, options = {}) => this.expiredCertificateHttpsBuffer(url, {
        ...options,
        maximumBytes: Math.min(options.maximumBytes ?? bounded, bounded),
      }),
    };
  }

  async text(url, options = {}) {
    return this.#request(url, options, async (response) => {
      const maximumBytes = options.maximumBytes ?? this.maximumBytes;
      assertSize(response, maximumBytes);
      const text = await response.text();
      if (Buffer.byteLength(text) > maximumBytes) {
        throw new MediaProviderError(`Provider response exceeds the ${maximumBytes}-byte limit.`, {
          code: 'TOO_LARGE',
        });
      }
      return text;
    });
  }

  async buffer(url, options = {}) {
    const maximumBytes = options.maximumBytes ?? this.maximumBytes;
    return this.#request(url, options, async (response) => {
      assertSize(response, maximumBytes);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maximumBytes) {
        throw new MediaProviderError(`Media exceeds the ${maximumBytes}-byte download limit.`, { code: 'TOO_LARGE' });
      }
      if (buffer.length < (options.minimumBytes ?? 1)) {
        throw new MediaProviderError('Provider returned an empty or invalid media payload.', { code: 'INVALID_RESPONSE' });
      }
      return {
        buffer,
        contentType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
        finalUrl: response.url || String(url),
      };
    });
  }

  async expiredCertificateHttpsBuffer(url, options = {}) {
    const parsed = validateUrl(url);
    assertAllowedHost(parsed, options.allowedHosts, options.allowSubdomains);
    if (parsed.protocol !== 'https:') {
      throw new MediaProviderError('Expired-certificate compatibility requires HTTPS.', {
        code: 'INVALID_URL',
      });
    }
    return requestHttpsBuffer({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      servername: parsed.hostname,
      allowExpiredCertificate: true,
      headers: options.headers,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      maximumBytes: options.maximumBytes ?? this.maximumBytes,
      minimumBytes: options.minimumBytes ?? 1,
      finalUrl: parsed.toString(),
      signal: options.signal ?? this.signal,
    });
  }

  async #request(url, options, consume) {
    const parsed = validateUrl(url);
    assertAllowedHost(parsed, options.allowedHosts, options.allowSubdomains);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) parsed.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    let timedOut = false;
    const externalSignal = options.signal ?? this.signal;
    const abort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? this.timeoutMs);
    try {
      const response = await this.fetch(parsed, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        redirect: options.redirect ?? 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new MediaProviderError(`Provider returned HTTP ${response.status}.`, {
          code: 'HTTP_ERROR',
          status: response.status,
        });
      }
      assertAllowedHost(response.url || parsed, options.allowedHosts, options.allowSubdomains);
      return await consume(response);
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw new MediaProviderError(
          timedOut ? 'Media request timed out.' : 'Media request was cancelled during shutdown.',
          { code: timedOut ? 'TIMEOUT' : 'ABORTED', cause: error },
        );
      }
      if (error instanceof MediaProviderError) throw error;
      throw new MediaProviderError(networkErrorMessage(error), {
        code: 'NETWORK_ERROR',
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abort);
    }
  }
}

function authorizationErrorCode(value) {
  if (!value) return null;
  return value.code || String(value);
}

export function validateTlsSocket(socket, servername, {
  allowExpiredCertificate = false,
  checkIdentity = checkServerIdentity,
} = {}) {
  if (!allowExpiredCertificate) return;
  const certificate = socket.getPeerCertificate?.(true);
  if (!certificate || Object.keys(certificate).length === 0) {
    throw new MediaProviderError('TLS peer did not provide a certificate.', {
      code: 'TLS_CERTIFICATE_ERROR',
    });
  }
  const identityError = checkIdentity(servername, certificate);
  if (identityError) {
    throw new MediaProviderError('TLS certificate does not match the requested media host.', {
      code: 'TLS_IDENTITY_ERROR',
      cause: identityError,
    });
  }
  if (socket.authorized) return;
  const authorizationError = authorizationErrorCode(socket.authorizationError);
  if (authorizationError !== 'CERT_HAS_EXPIRED') {
    throw new MediaProviderError('TLS certificate validation failed for the media host.', {
      code: 'TLS_CERTIFICATE_ERROR',
      cause: new Error(authorizationError || 'unknown TLS authorization error'),
    });
  }
}

export function requestHttpsBuffer({
  hostname,
  port = 443,
  path,
  servername,
  allowExpiredCertificate = false,
  headers = {},
  timeoutMs,
  maximumBytes,
  minimumBytes = 1,
  finalUrl,
  signal,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const request = https.request({
      hostname,
      port,
      path,
      method: 'GET',
      servername,
      rejectUnauthorized: !allowExpiredCertificate,
      ...(allowExpiredCertificate ? { agent: false } : {}),
      headers,
    });

    if (allowExpiredCertificate) {
      request.on('socket', (socket) => {
        const validate = () => {
          try {
            validateTlsSocket(socket, servername || hostname, { allowExpiredCertificate });
          } catch (error) {
            request.destroy(error);
          }
        };
        if (socket.connecting) socket.once('secureConnect', validate);
        else validate();
      });
    }

    const abort = () => request.destroy(new MediaProviderError(
      'Media request was cancelled during shutdown.',
      { code: 'ABORTED', cause: signal?.reason },
    ));
    request.on('error', (error) => finish(reject,
      error instanceof MediaProviderError
        ? error
        : new MediaProviderError(error.message, { code: 'NETWORK_ERROR', cause: error }),
    ));
    timeout = setTimeout(() => {
      request.destroy(new MediaProviderError('Media request timed out.', { code: 'TIMEOUT' }));
    }, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    request.on('response', (response) => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        finish(reject, new MediaProviderError(`Provider returned HTTP ${response.statusCode}.`, {
          code: 'HTTP_ERROR',
          status: response.statusCode,
        }));
        return;
      }

      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        response.destroy();
        finish(reject, new MediaProviderError('Media payload is too large.', { code: 'TOO_LARGE' }));
        return;
      }

      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > maximumBytes) {
          response.destroy(new MediaProviderError('Media payload is too large.', { code: 'TOO_LARGE' }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', (error) => finish(reject, error));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length < minimumBytes) {
          finish(reject, new MediaProviderError('Provider returned an empty or invalid media payload.', { code: 'INVALID_RESPONSE' }));
          return;
        }
        finish(resolve, {
          buffer,
          contentType: String(response.headers['content-type'] || 'application/octet-stream').split(';')[0],
          finalUrl,
        });
      });
    });
    request.end();
  });
}
