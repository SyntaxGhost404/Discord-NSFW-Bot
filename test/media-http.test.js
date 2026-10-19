import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaHttpClient, validateTlsSocket } from '../src/brain/providers/http.js';
import { Logger } from '../src/lib/logger.js';

function client(fetchImpl, maximumBytes = 1024) {
  return new MediaHttpClient({
    timeoutMs: 1_000,
    maximumBytes,
    logger: new Logger('error'),
    fetchImpl,
  });
}

test('media HTTP client returns bounded buffers and content types', async () => {
  const http = client(async () => new Response(Buffer.from('media'), {
    status: 200,
    headers: { 'content-type': 'image/gif', 'content-length': '5' },
  }));
  const result = await http.buffer('https://cdn.example/media.gif', {
    allowedHosts: ['cdn.example'],
  });
  assert.equal(result.buffer.toString(), 'media');
  assert.equal(result.contentType, 'image/gif');
});

test('media HTTP client rejects unexpected hosts before fetching', async () => {
  let fetched = false;
  const http = client(async () => {
    fetched = true;
    return new Response('media');
  });
  await assert.rejects(
    http.buffer('https://internal.example/media.gif', { allowedHosts: ['cdn.example'] }),
    (error) => error.code === 'UNEXPECTED_HOST',
  );
  assert.equal(fetched, false);
});

test('media HTTP client can require an exact allowlisted hostname', async () => {
  let fetched = false;
  const http = client(async () => {
    fetched = true;
    return new Response('media');
  });
  await assert.rejects(
    http.buffer('https://child.cdn.example/media.gif', {
      allowedHosts: ['cdn.example'],
      allowSubdomains: false,
    }),
    (error) => error.code === 'UNEXPECTED_HOST',
  );
  assert.equal(fetched, false);
});

test('expired-certificate compatibility never downgrades to plaintext HTTP', async () => {
  const http = client(async () => new Response('media'));
  await assert.rejects(
    http.expiredCertificateHttpsBuffer('http://media.example/file.png', {
      allowedHosts: ['media.example'],
      allowSubdomains: false,
    }),
    (error) => error.code === 'INVALID_URL',
  );
});

test('expired-certificate policy still requires hostname identity and rejects every other TLS error', () => {
  const certificate = { subject: { CN: 'media.example' } };
  const matchingIdentity = () => undefined;
  assert.doesNotThrow(() => validateTlsSocket({
    authorized: false,
    authorizationError: 'CERT_HAS_EXPIRED',
    getPeerCertificate: () => certificate,
  }, 'media.example', {
    allowExpiredCertificate: true,
    checkIdentity: matchingIdentity,
  }));

  assert.throws(() => validateTlsSocket({
    authorized: false,
    authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    getPeerCertificate: () => certificate,
  }, 'media.example', {
    allowExpiredCertificate: true,
    checkIdentity: matchingIdentity,
  }), (error) => error.code === 'TLS_CERTIFICATE_ERROR');

  assert.throws(() => validateTlsSocket({
    authorized: false,
    authorizationError: 'CERT_HAS_EXPIRED',
    getPeerCertificate: () => certificate,
  }, 'wrong.example', {
    allowExpiredCertificate: true,
    checkIdentity: () => new Error('hostname mismatch'),
  }), (error) => error.code === 'TLS_IDENTITY_ERROR');
});

test('media HTTP client enforces declared and scoped size limits', async () => {
  const http = client(async () => new Response(Buffer.alloc(20), {
    status: 200,
    headers: { 'content-length': '20' },
  }), 100);
  await assert.rejects(
    http.withMaximumBytes(10).buffer('https://cdn.example/media.gif'),
    (error) => error.code === 'TOO_LARGE',
  );
});

test('media HTTP client bounds HTML feed bodies as well as binary downloads', async () => {
  const http = client(async () => new Response('feed-body-too-large', {
    status: 200,
  }), 100);
  await assert.rejects(
    http.withMaximumBytes(10).text('https://feed.example/page'),
    (error) => error.code === 'TOO_LARGE',
  );
});

test('media HTTP client reports invalid JSON explicitly', async () => {
  const http = client(async () => new Response('not-json', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  await assert.rejects(
    http.json('https://api.example/data'),
    (error) => error.code === 'INVALID_RESPONSE',
  );
});

test('media HTTP client preserves the underlying network error code in diagnostics', async () => {
  const cause = Object.assign(new Error('socket reset by peer'), { code: 'ECONNRESET' });
  const http = new MediaHttpClient({
    timeoutMs: 1_000,
    maximumBytes: 1_024,
    logger: new Logger('error'),
    async fetchImpl() {
      throw new TypeError('fetch failed', { cause });
    },
  });

  await assert.rejects(
    http.buffer('https://cdn.example/media.jpg', { allowedHosts: ['cdn.example'] }),
    (error) => error.code === 'NETWORK_ERROR'
      && error.message === 'fetch failed (ECONNRESET)'
      && error.cause?.cause === cause,
  );
});

test('media HTTP client propagates graceful-shutdown cancellation', async () => {
  const shutdown = new AbortController();
  const http = new MediaHttpClient({
    timeoutMs: 1_000,
    maximumBytes: 1_024,
    logger: new Logger('error'),
    signal: shutdown.signal,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(
        options.signal.reason ?? new DOMException('Aborted', 'AbortError'),
      ), { once: true });
    }),
  });
  const request = http.buffer('https://cdn.example/media.gif');
  shutdown.abort(new Error('application shutdown'));
  await assert.rejects(request, (error) => error.code === 'ABORTED');
});

test('media timeout remains active while a response body is being consumed', async () => {
  let requestSignal;
  const http = new MediaHttpClient({
    timeoutMs: 5,
    maximumBytes: 1_024,
    logger: new Logger('error'),
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      return {
        ok: true,
        status: 200,
        url: 'https://cdn.example/media.gif',
        headers: new Headers({ 'content-type': 'image/gif' }),
        arrayBuffer: async () => new Promise((_resolve, reject) => {
          const fail = () => reject(requestSignal.reason ?? new DOMException('Aborted', 'AbortError'));
          if (requestSignal.aborted) fail();
          else requestSignal.addEventListener('abort', fail, { once: true });
        }),
      };
    },
  });
  await assert.rejects(
    http.buffer('https://cdn.example/media.gif'),
    (error) => error.code === 'TIMEOUT',
  );
});
