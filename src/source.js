// Addresses on the source site. Every listing is a path whose first page has
// no suffix (a /page/1/ suffix redirects) and whose later pages end in
// /page/<n>/.

export const ORIGIN = 'https://hentai-cosplay-xxx.com';
export const SOURCE_HOST = new URL(ORIGIN).hostname;

// The site's sort orders and rankings. `ranged` rankings also come per day,
// week, month, or year.
export const SORTS = Object.freeze({
  recent: { path: '/search/' },
  popular: { path: '/ranking/' },
  downloads: { path: '/ranking-download/', ranged: true },
  likes: { path: '/ranking-like/', ranged: true },
  bookmarks: { path: '/ranking-bookmark/', ranged: true },
  'recently-popular': { path: '/recently/' },
  'recent-downloads': { path: '/recently-download/' },
  'recent-likes': { path: '/recently-like/' },
  'recent-bookmarks': { path: '/recently-bookmark/' },
  videos: { path: '/search-video/' },
  'popular-videos': { path: '/ranking-video/' },
});

export const RANGES = Object.freeze(['day', 'week', 'month', 'year']);
export const MAXIMUM_PAGE = 5_000;
export const MAXIMUM_QUERY_LENGTH = 80;
const SLUG = /^[a-z0-9_-]{1,320}$/;

export function isSlug(value) {
  return SLUG.test(String(value ?? ''));
}

function listing(path, page) {
  return page > 1 ? `${ORIGIN}${path}page/${page}/` : `${ORIGIN}${path}`;
}

export function feedUrl(sort, range, page) {
  const entry = SORTS[sort];
  const path = entry.ranged && range ? `${entry.path}type/${range}/` : entry.path;
  return listing(path, page);
}

// The site's own search form turns spaces into "+".
export function searchUrl(query, page) {
  return listing(`/search/keyword/${encodeURIComponent(query).replace(/%20/g, '+')}/`, page);
}

// The story view lists every image of an album on one page, in order, where
// the regular album page shows 100 at a time.
export function albumUrl(slug) {
  return `${ORIGIN}/story/${slug}/`;
}

export function videoUrl(slug) {
  return `${ORIGIN}/video/${slug}/`;
}

export function normalizeQuery(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAXIMUM_QUERY_LENGTH);
}
