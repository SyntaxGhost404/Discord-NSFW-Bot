import { parseListing, parseStory, parseVideo } from './parse.js';
import {
  albumUrl,
  feedUrl,
  isSlug,
  MAXIMUM_PAGE,
  normalizeQuery,
  RANGES,
  searchUrl,
  SORTS,
  SOURCE_HOST,
  videoUrl,
} from './source.js';

// The browser loads the app as static files and calls these routes, which
// read the source site and answer with plain JSON:
//
//   GET /api/feed?sort=<sort>&range=<day|week|month|year>&page=<n>
//   GET /api/search?q=<text>&page=<n>
//   GET /api/album/<slug>
//   GET /api/video/<slug>
//
// Only fixed paths on the source site are ever requested, so the Worker is
// never an open proxy.

const UPSTREAM_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.8',
  // The desktop layout lists 20 albums per page; the mobile layout lists 10.
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
});
const UPSTREAM_TIMEOUT_MS = 9_000;
// Seconds that browsers and Cloudflare may reuse an answer.
const LIST_TTL = 120;
const ITEM_TTL = 86_400;
const API_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
});

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(body, status = 200, ttl = 0, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...API_HEADERS, 'Cache-Control': ttl > 0 ? `public, max-age=${ttl}` : 'no-store', ...extra },
  });
}

async function upstream(url, ttl) {
  let response;
  try {
    response = await fetch(url, {
      headers: UPSTREAM_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cf: { cacheTtl: ttl, cacheEverything: true },
    });
  } catch (error) {
    throw new HttpError(504, error?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
  if (new URL(response.url || url).hostname !== SOURCE_HOST) {
    await response.body?.cancel();
    throw new HttpError(502, 'upstream');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status === 404 ? 404 : 502, response.status === 404 ? 'not_found' : 'upstream');
  }
  return response.text();
}

function pageOf(url) {
  const raw = url.searchParams.get('page') ?? '1';
  const page = /^\d{1,5}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(page >= 1 && page <= MAXIMUM_PAGE)) throw new HttpError(400, 'bad_page');
  return page;
}

// A listing the site does not have (past its last page, or an unknown
// search) is an empty list rather than an error.
async function listing(source, page) {
  try {
    const { items, more, total } = parseListing(await upstream(source, LIST_TTL));
    return json({ page, items, more, total }, 200, LIST_TTL);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return json({ page, items: [], more: false, total: null }, 200, LIST_TTL);
    throw error;
  }
}

async function route(url) {
  const { pathname } = url;
  if (pathname === '/api/feed') {
    const sort = url.searchParams.get('sort') || 'recent';
    if (!Object.hasOwn(SORTS, sort)) throw new HttpError(400, 'bad_sort');
    const requested = url.searchParams.get('range');
    const range = requested && requested !== 'all' ? requested : null;
    if (range && (!SORTS[sort].ranged || !RANGES.includes(range))) throw new HttpError(400, 'bad_range');
    const page = pageOf(url);
    return listing(feedUrl(sort, range, page), page);
  }
  if (pathname === '/api/search') {
    const query = normalizeQuery(url.searchParams.get('q'));
    if (!query) throw new HttpError(400, 'bad_query');
    const page = pageOf(url);
    return listing(searchUrl(query, page), page);
  }
  const item = pathname.match(/^\/api\/(album|video)\/([^/]+)$/);
  if (item) {
    const [, kind, slug] = item;
    if (!isSlug(slug)) throw new HttpError(400, 'bad_slug');
    if (kind === 'album') {
      const album = parseStory(await upstream(albumUrl(slug), ITEM_TTL));
      if (!album) throw new HttpError(404, 'not_found');
      return json({ slug, title: album.title, base: album.base, files: album.files }, 200, ITEM_TTL);
    }
    const video = parseVideo(await upstream(videoUrl(slug), ITEM_TTL));
    if (!video) throw new HttpError(404, 'not_found');
    return json({ slug, ...video }, 200, ITEM_TTL);
  }
  throw new HttpError(404, 'not_found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405, 0, { Allow: 'GET, HEAD' });
    }
    try {
      return await route(url);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      console.error(JSON.stringify({ message: 'Unexpected API error.', path: url.pathname, error: String(error?.stack ?? error) }));
      return json({ error: 'internal' }, 500);
    }
  },
};
