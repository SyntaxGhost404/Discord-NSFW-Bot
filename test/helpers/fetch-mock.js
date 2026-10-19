import { vi } from 'vitest';

// A strict global fetch replacement. Routes are matched in order; any request
// without a route fails loudly so no test can silently reach the network.
export function installFetchMock(routes = []) {
  const calls = [];
  const table = [...routes];

  async function mockFetch(input, init) {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init);
    const record = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      request: request.clone(),
    };
    calls.push(record);
    for (const [matcher, handler] of table) {
      const matched = typeof matcher === 'function'
        ? matcher(request)
        : matcher instanceof RegExp
          ? matcher.test(`${request.method} ${request.url}`)
          : `${request.method} ${request.url}`.startsWith(matcher);
      if (matched) return handler(request, record);
    }
    throw new Error(`Unexpected outbound request in test: ${request.method} ${request.url}`);
  }

  vi.stubGlobal('fetch', mockFetch);
  return {
    calls,
    route(matcher, handler) {
      table.unshift([matcher, handler]);
    },
    callsTo(prefix) {
      return calls.filter((call) => `${call.method} ${call.url}`.startsWith(prefix));
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}

export function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

// Smallest valid images for each embeddable format, so magic-byte sniffing
// sees real signatures.
export const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export function imageBytes(type = 'image/jpeg', size = 2_048) {
  const bytes = new Uint8Array(size);
  const signatures = {
    'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    'image/webp': [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  };
  bytes.set(signatures[type]);
  return bytes;
}

export function image(type = 'image/jpeg', size = 2_048, init = {}) {
  return new Response(imageBytes(type, size), {
    status: 200,
    headers: { 'Content-Type': type, ...(init.headers ?? {}) },
  });
}
