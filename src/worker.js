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
// Seconds that browsers and Cloudflare may reuse an answer. A page the site
// says it does not have is kept only briefly, so a passing problem on the
// site never sticks.
const LIST_TTL = 120;
const ITEM_TTL = 86_400;
const MISSING_TTL = 60;
// The site lists 20 albums a page. For some searches it sends only a couple
// a page while claiming thousands of results, a total that also changes
// from page to page; such a list is `limited` and its total is not shown.
// (Rankings link a next page even when it is empty, so a short ranking page
// alone proves nothing.)
const PAGE_SIZE = 20;
const LIMITED_PAGE = 5;
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
      // Pages are kept for `ttl`, "not found" for a minute, and refusals and
      // errors not at all.
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, 404: MISSING_TTL, '400-403': 0, '405-599': 0 } },
    });
  } catch (error) {
    throw new HttpError(504, error?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
  if (new URL(response.url || url).hostname !== SOURCE_HOST) {
    await response.body?.cancel();
    throw new HttpError(502, 'moved');
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) throw new HttpError(404, 'not_found');
    // The site's firewall turns requests away with 403 or 429, or with a
    // challenge page.
    const blocked = response.status === 403 || response.status === 429 || response.headers.get('cf-mitigated') === 'challenge';
    throw new HttpError(502, blocked ? 'blocked' : 'upstream');
  }
  return response.text();
}

function pageOf(url) {
  const raw = url.searchParams.get('page') ?? '1';
  const page = /^\d{1,5}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(page >= 1 && page <= MAXIMUM_PAGE)) throw new HttpError(400, 'bad_page');
  return page;
}

// A list answer says what the site gave back, so the app can say so too:
//
//   ok          albums (`limited` when the site sends only a few per page)
//   empty       the site found nothing, as for a search without matches
//   end         past the last page
//   refused     the site answered this search with "not found"
//   missing     the site answered this sort or ranking with "not found"
//   unreadable  a page came back, but its list could not be read
function listAnswer(body) {
  const ttl = { ok: LIST_TTL, empty: LIST_TTL, end: LIST_TTL, refused: MISSING_TTL, missing: MISSING_TTL }[body.state] ?? 0;
  return json(body, 200, ttl);
}

async function listing(source, page, kind) {
  let html;
  try {
    html = await upstream(source, LIST_TTL);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    const state = page > 1 ? 'end' : kind === 'search' ? 'refused' : 'missing';
    return listAnswer({ page, items: [], more: false, total: null, state, limited: false });
  }
  const { items, more, total, found, entries } = parseListing(html);
  let state = 'ok';
  if (!found || (entries > 0 && items.length === 0) || (entries === 0 && page === 1 && total > 0)) state = 'unreadable';
  else if (entries === 0) state = page > 1 ? 'end' : 'empty';
  if (state === 'unreadable') console.warn(JSON.stringify({ message: 'Unreadable list page.', source, found, entries, total }));
  const limited = state === 'ok' && more && items.length <= LIMITED_PAGE && total !== null && total > page * PAGE_SIZE;
  return listAnswer({ page, items, more: state === 'ok' && more, total: limited ? null : total, state, limited });
}

// The site sent a page, but not one the parser understands: most likely its
// markup changed. Logged, so the change gets noticed.
function unreadable(kind, slug) {
  console.warn(JSON.stringify({ message: 'Unreadable page.', kind, slug }));
  throw new HttpError(502, 'unreadable');
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
    return listing(feedUrl(sort, range, page), page, 'feed');
  }
  if (pathname === '/api/search') {
    const query = normalizeQuery(url.searchParams.get('q'));
    if (!query) throw new HttpError(400, 'bad_query');
    const page = pageOf(url);
    return listing(searchUrl(query, page), page, 'search');
  }
  const item = pathname.match(/^\/api\/(album|video)\/([^/]+)$/);
  if (item) {
    const [, kind, slug] = item;
    if (!isSlug(slug)) throw new HttpError(400, 'bad_slug');
    if (kind === 'album') {
      const album = parseStory(await upstream(albumUrl(slug), ITEM_TTL));
      if (!album) unreadable('album', slug);
      return json({ slug, title: album.title, base: album.base, files: album.files }, 200, album.files.length > 0 ? ITEM_TTL : MISSING_TTL);
    }
    const video = parseVideo(await upstream(videoUrl(slug), ITEM_TTL));
    if (!video) unreadable('video', slug);
    return json({ slug, ...video }, 200, video.stream ? ITEM_TTL : MISSING_TTL);
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
