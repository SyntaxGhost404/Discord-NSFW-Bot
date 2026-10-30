import { vi } from 'vitest';

// A strict replacement for the global fetch. Routes match in order, by exact
// URL, URL prefix, regular expression, or function; a request without a
// route fails the test, so no suite can reach the network.
export function installFetchMock(routes = []) {
  const calls = [];
  const table = [...routes];

  async function mockFetch(input, init) {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init);
    calls.push({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers) });
    for (const [matcher, handler] of table) {
      const matched = typeof matcher === 'function'
        ? matcher(request)
        : matcher instanceof RegExp
          ? matcher.test(request.url)
          : request.url === matcher || (matcher.endsWith('*') && request.url.startsWith(matcher.slice(0, -1)));
      if (matched) return handler(request);
    }
    throw new Error(`Unexpected outbound request in test: ${request.method} ${request.url}`);
  }

  vi.stubGlobal('fetch', mockFetch);
  return {
    calls,
    restore() {
      vi.unstubAllGlobals();
    },
  };
}

export function html(body, init = {}) {
  return new Response(body, { status: init.status ?? 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// A response that claims to come from another address, as after a redirect.
export function redirected(response, url) {
  Object.defineProperty(response, 'url', { value: url });
  return response;
}
