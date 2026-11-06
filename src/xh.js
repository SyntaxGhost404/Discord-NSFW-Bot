import { cleanText } from './parse.js';

// xHamster's photo section: its addresses, and how its pages are read.
//
// Only the straight section is ever asked for: /photos and the paths under
// it, never the gay or trans sections. Every page carries its own data as
// JSON for its scripts (`window.initials = {...}`), which is read instead of
// the markup. Images are passed on exactly as the site serves them, since
// its addresses are signed: the copies its own pages and photo viewer use
// (named "_1000") are the original files, 2000 pixels wide for many
// galleries, and the largest it has.

export const XH_ORIGIN = 'https://xhamster.com';
export const XH_HOST = 'xhamster.com';

// Galleries by Best (the site's own order) and Newest, many pages deep. The
// Top lists rank single photos, the top 50 of the last 7 days, 30 days, or
// all time on one page; a ranked photo is shown as a card for its gallery.
export const XH_SORTS = Object.freeze({
  best: { path: '/photos' },
  newest: { path: '/photos/newest' },
  rated: { path: '/photos/top/rated', ranked: true },
  viewed: { path: '/photos/top/viewed', ranked: true },
  commented: { path: '/photos/top/commented', ranked: true },
});
// The viewer's ranges and the site's names for them; all time has none.
export const XH_RANGES = Object.freeze({ week: 'weekly', month: 'monthly' });

// A gallery is named by its address ("<title>-<number>") or by its number
// alone, which the site redirects to the full address. Later pages of a
// gallery need the full address.
const GALLERY_KEY = /^(?:[a-z0-9-]{1,300}-)?\d{1,12}$/;
const GALLERY_LINK = /^https:\/\/(?:[a-z0-9-]+\.)?xhamster\.com\/photos\/gallery\/([a-z0-9-]{1,300}-\d{1,12})\/?$/;
// Images come from the site's image servers over HTTPS, nowhere else.
const IMAGE = /^https:\/\/(?:[a-z0-9-]+\.)+xhcdn\.com\/[^\s"'<>\\]+$/i;
const INITIALS = /window\.initials\s*=\s*\{/;
// Dates before 2100, in seconds.
const LATEST_TIME = 4_102_444_800;

export const isGalleryKey = (value) => GALLERY_KEY.test(String(value ?? ''));
export const isNamedGallery = (key) => key.includes('-');

export function xhFeedUrl(sort, range, page) {
  const { path, ranked } = XH_SORTS[sort];
  if (ranked) return `${XH_ORIGIN}${path}${range ? `/${XH_RANGES[range]}` : ''}`;
  return page > 1 ? `${XH_ORIGIN}${path}/${page}` : `${XH_ORIGIN}${path}`;
}

// The site's own search form turns spaces into "+".
export function xhSearchUrl(query, page) {
  const path = `${XH_ORIGIN}/photos/search/${encodeURIComponent(query).replace(/%20/g, '+')}`;
  return page > 1 ? `${path}?page=${page}` : path;
}

export function xhGalleryUrl(key, page) {
  return page > 1 ? `${XH_ORIGIN}/photos/gallery/${key}/${page}` : `${XH_ORIGIN}/photos/gallery/${key}`;
}

// The JSON a page carries for its scripts: `window.initials = {...};`, the
// last statement of its script element.
export function readInitials(html) {
  const match = INITIALS.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  const end = html.indexOf('</script>', start);
  if (end === -1) return null;
  try {
    const data = JSON.parse(html.slice(start, end).trimEnd().replace(/;$/, ''));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

const image = (value) => (typeof value === 'string' && IMAGE.test(value) ? value : null);

function whole(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// "865 Results"; a search without results says just "Results".
function resultTotal(text) {
  const digits = String(text ?? '').match(/^\s*(\d[\d,]*)/)?.[1].replace(/,/g, '');
  return digits ? Number(digits) : null;
}

// A gallery in Best, Newest, or search results. Private, removed, and
// region-blocked galleries would not open, so they are left out.
function galleryCard(entry) {
  const slug = String(entry?.link ?? entry?.pageURL ?? '').match(GALLERY_LINK)?.[1];
  if (!slug || entry.isPublic === false || entry.isGeoBlocked || entry.isDeleted) return null;
  const cover = image(entry.imgSrc ?? entry.imageURL);
  return {
    kind: 'album',
    slug,
    title: cleanText(entry.title ?? entry.titleLocalized),
    date: null,
    count: whole(entry.photosCount ?? entry.imgCount),
    cover: cover ? { large: cover } : null,
  };
}

// A ranked photo, as a card for the gallery it belongs to.
function photoCard(entry) {
  const id = whole(entry?.galleryId);
  if (!id || entry.isGeoBlocked) return null;
  const cover = image(entry.imgSrc);
  return { kind: 'album', slug: String(id), title: cleanText(entry.alt), date: null, count: null, cover: cover ? { large: cover } : null };
}

// One card per gallery: a Top list can rank several photos of one gallery.
function unique(cards) {
  const seen = new Set();
  return cards.filter((card) => card && !seen.has(card.slug) && seen.add(card.slug));
}

// A list page: Best or Newest, search results, or a Top list. `entries` is
// how many the site listed, before any were left out. Null when the page
// holds none of these lists, which means the site changed its pages.
export function parseXhList(html) {
  const data = readInitials(html);
  if (!data) return null;
  const listing = data.photosPage;
  if (Array.isArray(listing?.galleriesItems)) {
    const pages = listing.paginationProps ?? {};
    return {
      entries: listing.galleriesItems.length,
      items: unique(listing.galleriesItems.map(galleryCard)),
      more: Number(pages.currentPageNumber) < Number(pages.lastPageNumber),
      total: null,
    };
  }
  const results = data.searchResultsPhotoComponent;
  if (Array.isArray(results?.list)) {
    const pages = results.pagination ?? {};
    return {
      entries: results.list.length,
      items: unique(results.list.map(galleryCard)),
      more: Number(pages.active) < Number(pages.maxPages),
      total: resultTotal(data.searchTitleSummaryComponent?.resultCount),
    };
  }
  const ranked = data.layoutPage?.photoListProps?.items;
  if (Array.isArray(ranked)) return { entries: ranked.length, items: unique(ranked.map(photoCard)), more: false, total: null };
  return null;
}

// One page of a gallery, up to 60 photos, with the gallery's title, date,
// size, and full address. Each photo's original size gives its shape. Null
// when the page holds no gallery.
export function parseXhGallery(html) {
  const gallery = readInitials(html)?.galleryPage;
  if (!gallery || !Array.isArray(gallery.photoItems)) return null;
  const pages = gallery.paginationProps ?? {};
  const crumbs = gallery.breadCrumbsProps?.breadCrumbs;
  const created = Number(gallery.infoProps?.authorInfoProps?.createdDate);
  const photos = [];
  for (const item of gallery.photoItems) {
    const src = image(item?.imgSrc);
    if (!src || item.isGeoBlocked) continue;
    const width = whole(item.originWidth);
    const height = whole(item.originHeight);
    photos.push(width && height ? { src, width, height } : { src });
  }
  return {
    key: String(pages.pageLinkFirst ?? '').match(GALLERY_LINK)?.[1] ?? null,
    title: cleanText(Array.isArray(crumbs) && crumbs.length > 0 ? crumbs.at(-1)?.name : gallery.photoItems[0]?.alt),
    date: created > 0 && created < LATEST_TIME ? new Date(created * 1000).toISOString().slice(0, 10) : null,
    count: whole(gallery.photosCount) ?? photos.length,
    page: whole(pages.currentPageNumber) ?? 1,
    pages: whole(pages.lastPageNumber) ?? 1,
    photos,
  };
}
