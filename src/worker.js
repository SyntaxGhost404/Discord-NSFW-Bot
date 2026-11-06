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
import { isGalleryKey, isNamedGallery, parseXhGallery, parseXhList, XH_HOST, XH_RANGES, XH_SORTS, xhFeedUrl, xhGalleryUrl, xhSearchUrl } from './xh.js';

// The browser loads the app as static files and calls these routes, which
// read a source site and answer with plain JSON. Hentai Cosplay:
//
//   GET /api/feed?sort=<sort>&range=<day|week|month|year>&page=<n>
//   GET /api/search?q=<text>&page=<n>
//   GET /api/album/<slug>
//   GET /api/video/<slug>
//
// xHamster's photo section:
//
//   GET /api/xh/feed?sort=<sort>&range=<week|month>&page=<n>
//   GET /api/xh/search?q=<text>&page=<n>
//   GET /api/xh/album/<gallery>?page=<n>
//
// Only fixed paths on the source sites are ever requested, so the Worker is
// never an open proxy.

const UPSTREAM_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.8',
  // The desktop layout lists 20 albums per page; the mobile layout lists 10.
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
});
// xHamster sends its full pages to a client that names itself plainly.
const XH_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (compatible; personal photo viewer)',
});
// Each site's request headers, and the hosts its answers may come from
// (xHamster may answer from a language subdomain).
const HCX = Object.freeze({ headers: UPSTREAM_HEADERS, accepts: (host) => host === SOURCE_HOST });
const XH = Object.freeze({ headers: XH_HEADERS, accepts: (host) => host === XH_HOST || host.endsWith(`.${XH_HOST}`) });
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

// `detail` goes into the error answer as is, such as the status a site
// answered with ({ upstream: 520 }).
class HttpError extends Error {
  constructor(status, code, detail = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

// The start of a page, for the logs. Only the first chunk is read.
async function opening(response, limit = 300) {
  try {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const { value } = await reader.read();
    await reader.cancel();
    return new TextDecoder().decode(value ?? new Uint8Array()).replace(/\s+/g, ' ').slice(0, limit);
  } catch {
    return '';
  }
}

function json(body, status = 200, ttl = 0, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...API_HEADERS, 'Cache-Control': ttl > 0 ? `public, max-age=${ttl}` : 'no-store', ...extra },
  });
}

async function upstream(url, ttl, site = HCX) {
  let response;
  try {
    response = await fetch(url, {
      headers: site.headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // Pages are kept for `ttl`, "not found" for a minute, and refusals and
      // errors not at all.
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, 404: MISSING_TTL, '400-403': 0, '405-599': 0 } },
    });
  } catch (error) {
    throw new HttpError(504, error?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
  if (!site.accepts(new URL(response.url || url).hostname)) {
    await response.body?.cancel();
    throw new HttpError(502, 'moved');
  }
  if (!response.ok) {
    const { status, headers } = response;
    if (status === 404 || status === 410) {
      await response.body?.cancel();
      throw new HttpError(404, 'not_found');
    }
    // Any other refusal is logged with the start of the page, so its cause
    // can be read in the Worker's logs, and the answer names the status.
    console.warn(JSON.stringify({ message: 'Upstream error.', url, status, server: headers.get('server'), ray: headers.get('cf-ray'), mitigated: headers.get('cf-mitigated'), type: headers.get('content-type'), page: await opening(response) }));
    // The site's firewall turns requests away with 403 or 429, or with a
    // challenge page; 451 means the site does not serve this region.
    const blocked = status === 403 || status === 429 || headers.get('cf-mitigated') === 'challenge';
    throw new HttpError(502, blocked ? 'blocked' : status === 451 ? 'unavailable' : 'upstream', { upstream: status });
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

// The same states for xHamster. It answers a search without results with
// "not found" and an empty list, and a page past the last with "not found".
async function xhListing(source, page, kind) {
  let html;
  try {
    html = await upstream(source, LIST_TTL, XH);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    const state = page > 1 ? 'end' : kind === 'search' ? 'empty' : 'missing';
    return listAnswer({ page, items: [], more: false, total: kind === 'search' && page === 1 ? 0 : null, state, limited: false });
  }
  const list = parseXhList(html);
  if (!list) {
    console.warn(JSON.stringify({ message: 'Unreadable list page.', source }));
    return listAnswer({ page, items: [], more: false, total: null, state: 'unreadable', limited: false });
  }
  const state = list.entries > 0 ? 'ok' : page > 1 ? 'end' : 'empty';
  return listAnswer({ page, items: list.items, more: state === 'ok' && list.more, total: list.total, state, limited: false });
}

// The site sent a page, but not one the parser understands: most likely its
// markup changed. Logged, so the change gets noticed.
function unreadable(kind, slug) {
  console.warn(JSON.stringify({ message: 'Unreadable page.', kind, slug }));
  throw new HttpError(502, 'unreadable');
}

async function xhRoute(url) {
  const { pathname } = url;
  if (pathname === '/api/xh/feed') {
    const sort = url.searchParams.get('sort') || 'best';
    if (!Object.hasOwn(XH_SORTS, sort)) throw new HttpError(400, 'bad_sort');
    const requested = url.searchParams.get('range');
    const range = requested && requested !== 'all' ? requested : null;
    if (range && (!XH_SORTS[sort].ranked || !Object.hasOwn(XH_RANGES, range))) throw new HttpError(400, 'bad_range');
    const page = pageOf(url);
    // A Top list is a single page.
    if (XH_SORTS[sort].ranked && page > 1) return listAnswer({ page, items: [], more: false, total: null, state: 'end', limited: false });
    return xhListing(xhFeedUrl(sort, range, page), page, 'feed');
  }
  if (pathname === '/api/xh/search') {
    const query = normalizeQuery(url.searchParams.get('q'));
    if (!query) throw new HttpError(400, 'bad_query');
    const page = pageOf(url);
    return xhListing(xhSearchUrl(query, page), page, 'search');
  }
  const album = pathname.match(/^\/api\/xh\/album\/([^/]+)$/);
  if (album) {
    const key = album[1];
    if (!isGalleryKey(key)) throw new HttpError(400, 'bad_slug');
    const page = pageOf(url);
    if (page > 1 && !isNamedGallery(key)) throw new HttpError(400, 'bad_page');
    const gallery = parseXhGallery(await upstream(xhGalleryUrl(key, page), ITEM_TTL, XH));
    if (!gallery) unreadable('xh album', key);
    // Past the last page the site shows another page of the gallery.
    if (gallery.page !== page) return json({ slug: key, ...gallery, page, photos: [] }, 200, ITEM_TTL);
    return json({ slug: key, ...gallery }, 200, gallery.photos.length > 0 ? ITEM_TTL : MISSING_TTL);
  }
  throw new HttpError(404, 'not_found');
}

async function route(url) {
  const { pathname } = url;
  if (pathname.startsWith('/api/xh/')) return xhRoute(url);
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
      if (error instanceof HttpError) return json({ error: error.code, ...error.detail }, error.status);
      console.error(JSON.stringify({ message: 'Unexpected API error.', path: url.pathname, error: String(error?.stack ?? error) }));
      return json({ error: 'internal' }, 500);
    }
  },
};
