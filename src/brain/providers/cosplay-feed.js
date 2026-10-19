import { MediaProviderError } from './errors.js';
import { choose, randomInteger } from '../../lib/random.js';

const MAXIMUM_FEED_BYTES = 3 * 1024 * 1024;
const MAXIMUM_PAGE_DEPTH = 1_000_000;
const ALBUM_IMAGE_WINDOW = 2_000;
const IMAGE_PATH = /\.(?:gif|jpe?g|png|webp)$/i;
const HENTAI_PAGE_PATH = /\/search\/page\/(\d+)\/?(?:[?#]|$)/i;
const AHOTTIE_PAGE_QUERY = /[?&](?:amp;)?page=(\d+)/gi;
const HENTAI_HOST = 'hentai-cosplay-xxx.com';
const AHOTTIE_HOST = 'ahottie.top';
const IMGBOX_IMAGE_HOST = /^images(\d*)\.imgbox\.com$/i;
const IMGBOX_THUMB_HOST = /^thumbs(\d*)\.imgbox\.com$/i;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

const HTML_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml',
  'User-Agent': USER_AGENT,
});

const defaultDependencies = Object.freeze({ choose, randomInteger });

function codePoint(value, radix) {
  const parsed = Number.parseInt(value, radix);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0x10ffff) return '';
  return String.fromCodePoint(parsed);
}

export function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);?/gi, (_match, number) => codePoint(number, 16))
    .replace(/&#(\d+);?/g, (_match, number) => codePoint(number, 10))
    .replace(/&(amp|quot|apos|lt|gt);/gi, (_match, name) => ({
      amp: '&',
      quot: '"',
      apos: "'",
      lt: '<',
      gt: '>',
    })[name.toLowerCase()]);
}

const ATTRIBUTE_PATTERN = /\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

// One pass over a tag's attributes; values stay HTML-encoded until read.
function tagAttributes(tag) {
  const attributes = new Map();
  for (const match of String(tag).matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function attribute(tag, name) {
  return decodeHtml(tagAttributes(tag).get(name.toLowerCase()) ?? '');
}

function anchors(html) {
  return [...String(html).matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]);
}

function validPage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isInteger(page) && page >= 1 && page <= MAXIMUM_PAGE_DEPTH ? page : null;
}

function maximumPage(values, provider) {
  if (values.length === 0) {
    throw new MediaProviderError(`${provider} feed did not expose a pagination ceiling.`, {
      code: 'INVALID_RESPONSE',
    });
  }
  return Math.max(...values);
}

export function hentaiCosplayMaximumPage(html) {
  const feedAnchors = anchors(html);
  const pageOf = (tag) => validPage(attribute(tag, 'href').match(HENTAI_PAGE_PATH)?.[1]);
  const lastPages = feedAnchors
    .filter((tag) => attribute(tag, 'class').split(/\s+/).includes('last'))
    .map(pageOf)
    .filter(Boolean);
  if (lastPages.length > 0) return maximumPage(lastPages, HENTAI_HOST);
  return maximumPage(feedAnchors.map(pageOf).filter(Boolean), HENTAI_HOST);
}

// Ahottie pages are over a megabyte, so the ceiling is read with one flat
// regex instead of parsing every anchor tag.
export function ahottieMaximumPage(html) {
  return maximumPage([...String(html).matchAll(AHOTTIE_PAGE_QUERY)]
    .map((match) => validPage(match[1]))
    .filter(Boolean), AHOTTIE_HOST);
}

function largestSrcsetUrl(value) {
  const entries = String(value).split(',').map((entry, index) => {
    const [url, descriptor = ''] = entry.trim().split(/\s+/, 2);
    const amount = Number.parseFloat(descriptor);
    const score = Number.isFinite(amount)
      ? amount * (descriptor.endsWith('x') ? 1_000_000 : 1)
      : index;
    return { url, score, index };
  }).filter((entry) => entry.url);
  entries.sort((left, right) => right.score - left.score || right.index - left.index);
  return entries[0]?.url ?? '';
}

function imageElementUrls(html) {
  const urls = [];
  for (const match of String(html).matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    const read = (name) => decodeHtml(attributes.get(name) ?? '');
    const original = read('data-original') || read('data-full');
    const srcset = read('data-srcset') || read('srcset');
    const lazy = read('data-lazy-src') || read('data-src');
    const selected = original || largestSrcsetUrl(srcset) || lazy || read('src');
    if (selected) urls.push(selected);
  }
  return urls;
}

function httpsUrl(value, baseUrl) {
  try {
    const normalized = decodeHtml(value).replace(/\\\//g, '/').trim();
    const url = new URL(normalized.startsWith('//') ? `https:${normalized}` : normalized, baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function hasHost(url, hostname) {
  return url.hostname === hostname || url.hostname.endsWith(`.${hostname}`);
}

function imageUrl(url) {
  return IMAGE_PATH.test(url.pathname);
}

function sectionById(html, tagName, id) {
  const opening = new RegExp(`<${tagName}\\b[^>]*\\bid\\s*=\\s*(?:"${id}"|'${id}'|${id})[^>]*>`, 'i')
    .exec(String(html));
  if (!opening) return '';
  const start = opening.index + opening[0].length;
  const end = String(html).toLowerCase().indexOf(`</${tagName.toLowerCase()}>`, start);
  return end < 0 ? '' : String(html).slice(start, end);
}

export function cleanHentaiCosplayUrl(value, baseUrl) {
  const url = httpsUrl(value, baseUrl);
  if (!url || !hasHost(url, HENTAI_HOST)) return null;
  url.pathname = url.pathname.replace(/\/p=\d+(?:x\d+)?\//gi, '/');
  return imageUrl(url) ? url.toString() : null;
}

export function extractHentaiCosplayMedia(html, pageUrl) {
  const imageList = sectionById(html, 'ul', 'image-list');
  if (!imageList) return [];
  return [...new Set(imageElementUrls(imageList)
    .map((value) => cleanHentaiCosplayUrl(value, pageUrl))
    .filter(Boolean))];
}

export function cleanImgboxUrl(value, baseUrl) {
  const url = httpsUrl(value, baseUrl);
  if (!url) return null;
  const thumbnail = url.hostname.match(IMGBOX_THUMB_HOST);
  if (thumbnail) {
    url.hostname = `images${thumbnail[1]}.imgbox.com`;
    url.pathname = url.pathname.replace(/_t(?=\.[^./]+$)/i, '_o');
  } else if (!IMGBOX_IMAGE_HOST.test(url.hostname)) {
    return null;
  }
  return imageUrl(url) ? url.toString() : null;
}

// Finds `<a href=".../albums/...">` openings with native indexOf and reads
// only a bounded window after each one, keeping CPU flat on huge pages. The
// window ends at the next anchor boundary, so each image stays tied to the
// album link that contains it.
export function extractAhottieMedia(html, pageUrl) {
  const source = String(html);
  const urls = [];
  let cursor = 0;
  for (;;) {
    const marker = source.indexOf('/albums/', cursor);
    if (marker < 0) break;
    cursor = marker + 8;
    const tagStart = source.lastIndexOf('<a', marker);
    const tagEnd = source.indexOf('>', marker);
    if (tagStart < 0 || tagEnd < 0 || source.lastIndexOf('>', marker) > tagStart) continue;
    const openingTag = source.slice(tagStart, tagEnd + 1);
    if (!/^<a\b/i.test(openingTag)) continue;
    const href = httpsUrl(attribute(openingTag, 'href'), pageUrl);
    if (!href || !hasHost(href, AHOTTIE_HOST) || !href.pathname.startsWith('/albums/')) continue;

    let window = source.slice(tagEnd + 1, tagEnd + 1 + ALBUM_IMAGE_WINDOW);
    const boundary = window.search(/<\/a\s*>|<\/>|<a\b/i);
    if (boundary >= 0) window = window.slice(0, boundary);
    for (const value of imageElementUrls(window)) {
      const media = cleanImgboxUrl(value, pageUrl);
      if (media) urls.push(media);
    }
    cursor = tagEnd + 1;
  }
  return [...new Set(urls)];
}

// Album covers on these feeds are often dead: an image server answers 502, a
// file is empty, or a host substitutes a stand-in picture. Every download is
// checked before use, and a rejected one is replaced by another image.
const MAXIMUM_ATTEMPTS = 3;
// Real cosplay photos are hundreds of pixels on each side; "image
// unavailable" stand-ins and icons are smaller.
const MINIMUM_PHOTO_DIMENSION = 300;
const STOP_CODES = new Set(['BUDGET_EXHAUSTED', 'DEADLINE_EXCEEDED', 'ABORTED']);

// Reads the pagination ceiling, picks a random feed page, and downloads one
// direct image from it without ever opening a gallery. Up to three images are
// tried. With `freshPagePerAttempt`, every retry reads a new random page,
// which escapes a feed page whose image server is down; otherwise retries use
// other images from the same page, which avoids parsing another large page.
export async function fetchRandomCosplayAttachment({
  provider,
  pageUrl,
  maximumPage: readMaximumPage,
  extractMedia,
  feedHosts,
  mediaHosts,
  mediaReferer,
  freshPagePerAttempt = false,
}, context, dependencies = defaultDependencies) {
  const requestOptions = {
    headers: HTML_HEADERS,
    allowedHosts: feedHosts,
    maximumBytes: MAXIMUM_FEED_BYTES,
  };
  const discoveryHtml = await context.http.text(pageUrl(1), requestOptions);
  const pageCeiling = readMaximumPage(discoveryHtml);

  const mediaHeaders = {
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'User-Agent': USER_AGENT,
  };
  // hentai-cosplay-xxx.com's CDN answers 403 to hotlinks without a Referer.
  if (mediaReferer) mediaHeaders.Referer = mediaReferer;

  const attempted = new Set();
  let page = null;
  let candidates = [];
  let lastError = null;
  for (let attempt = 0; attempt < MAXIMUM_ATTEMPTS; attempt += 1) {
    try {
      let remaining = candidates.filter((url) => !attempted.has(url));
      if (page === null || freshPagePerAttempt || remaining.length === 0) {
        const nextPage = dependencies.randomInteger(1, pageCeiling);
        const selectedPageUrl = pageUrl(nextPage);
        const feedHtml = nextPage === 1 ? discoveryHtml : await context.http.text(selectedPageUrl, requestOptions);
        candidates = extractMedia(feedHtml, selectedPageUrl);
        page = nextPage;
        remaining = candidates.filter((url) => !attempted.has(url));
      }
      const selectedUrl = dependencies.choose(remaining);
      if (!selectedUrl) {
        throw new MediaProviderError(`${provider} feed did not contain a usable direct image.`, {
          code: 'INVALID_RESPONSE',
        });
      }
      attempted.add(selectedUrl);
      const download = await context.http.buffer(selectedUrl, {
        headers: mediaHeaders,
        allowedHosts: mediaHosts,
        minimumBytes: 1_024,
        expectImage: true,
        minimumDimension: MINIMUM_PHOTO_DIMENSION,
      });
      const resolvedUrl = httpsUrl(download.finalUrl || selectedUrl, selectedUrl);
      if (!resolvedUrl) {
        throw new MediaProviderError(`${provider} media redirected to an insecure or invalid URL.`, {
          code: 'INVALID_URL',
        });
      }
      return {
        page,
        url: resolvedUrl.toString(),
        download,
      };
    } catch (error) {
      lastError = error;
      if (STOP_CODES.has(error?.code)) break;
      context.logger?.debug('Rejected a cosplay image; trying another.', {
        provider,
        page,
        attempt: attempt + 1,
        code: error?.code,
        reason: error?.message,
      });
    }
  }
  throw lastError;
}

export {
  AHOTTIE_HOST,
  HENTAI_HOST,
  HTML_HEADERS,
  MAXIMUM_FEED_BYTES,
};
