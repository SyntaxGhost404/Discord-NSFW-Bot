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

// A complete, valid 1x1 PNG, for tests where a real decoder reads the file.
export const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const be16 = (value) => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value) => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const le16 = (value) => [value & 0xff, (value >> 8) & 0xff];
const le24 = (value) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];

// A zero-filled file with a real header for the format, including its pixel
// size, so signature sniffing and dimension checks both see valid data.
export function imageBytes(type = 'image/jpeg', size = 2_048, { width = 800, height = 1_200 } = {}) {
  const bytes = new Uint8Array(size);
  const headers = {
    // SOI, a JFIF APP0 segment, then the SOF0 frame header.
    'image/jpeg': [
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(height), ...be16(width), 0x03,
    ],
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height)],
    'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(width), ...le16(height)],
    // RIFF/WEBP with an extended (VP8X) header holding the canvas size.
    'image/webp': [
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, ...le24(width - 1), ...le24(height - 1),
    ],
  };
  bytes.set(headers[type]);
  return bytes;
}

export function image(type = 'image/jpeg', size = 2_048, init = {}) {
  return new Response(imageBytes(type, size, init), {
    status: 200,
    headers: { 'Content-Type': type, ...(init.headers ?? {}) },
  });
}
