import { MediaProviderError } from './errors.js';
import { choose, randomInteger } from '../../lib/random.js';

const MAXIMUM_FEED_BYTES = 2 * 1024 * 1024;
const MAXIMUM_PAGE_DEPTH = 1_000_000;
const IMAGE_PATH = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const HENTAI_PAGE_PATH = /\/search\/page\/(\d+)\/?(?:[?#]|$)/i;
const AHOTTIE_PAGE_QUERY = /[?&]page=(\d+)(?:[&#]|$)/i;
const HENTAI_HOST = 'hentai-cosplay-xxx.com';
const AHOTTIE_HOST = 'ahottie.top';
const IMGBOX_IMAGE_HOST = /^images(\d*)\.imgbox\.com$/i;
const IMGBOX_THUMB_HOST = /^thumbs(\d*)\.imgbox\.com$/i;
const DISCORD_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/x-png',
]);

const HTML_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
});

const MEDIA_HEADERS = Object.freeze({
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
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

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag).match(new RegExp(
    `\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ));
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function anchors(html) {
  return [...String(html).matchAll(/<a\b[^>]*>/gi)].map((match) => match[0]);
}

function pageFromHref(href, pattern) {
  const value = Number.parseInt(String(href).match(pattern)?.[1], 10);
  return Number.isInteger(value) && value >= 1 && value <= MAXIMUM_PAGE_DEPTH ? value : null;
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
  const lastPages = feedAnchors
    .filter((tag) => attribute(tag, 'class').split(/\s+/).includes('last'))
    .map((tag) => pageFromHref(attribute(tag, 'href'), HENTAI_PAGE_PATH))
    .filter(Boolean);
  if (lastPages.length > 0) return maximumPage(lastPages, HENTAI_HOST);
  return maximumPage(feedAnchors
    .map((tag) => pageFromHref(attribute(tag, 'href'), HENTAI_PAGE_PATH))
    .filter(Boolean), HENTAI_HOST);
}

export function ahottieMaximumPage(html) {
  return maximumPage(anchors(html)
    .map((tag) => pageFromHref(attribute(tag, 'href'), AHOTTIE_PAGE_QUERY))
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
    const tag = match[0];
    const original = attribute(tag, 'data-original') || attribute(tag, 'data-full');
    const srcset = attribute(tag, 'data-srcset') || attribute(tag, 'srcset');
    const lazy = attribute(tag, 'data-lazy-src') || attribute(tag, 'data-src');
    const selected = original || largestSrcsetUrl(srcset) || lazy || attribute(tag, 'src');
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

export function extractAhottieMedia(html, pageUrl) {
  const urls = [];
  for (const match of String(html).matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const block = match[0];
    const href = httpsUrl(attribute(block.match(/^<a\b[^>]*>/i)?.[0], 'href'), pageUrl);
    if (!href || !hasHost(href, AHOTTIE_HOST) || !href.pathname.startsWith('/albums/')) continue;
    for (const value of imageElementUrls(block)) {
      const media = cleanImgboxUrl(value, pageUrl);
      if (media) urls.push(media);
    }
  }
  return [...new Set(urls)];
}

export async function fetchRandomCosplayAttachment({
  provider,
  pageUrl,
  maximumPage: readMaximumPage,
  extractMedia,
  feedHosts,
  mediaHosts,
}, context, dependencies = defaultDependencies) {
  const discoveryUrl = pageUrl(1);
  const requestOptions = {
    headers: HTML_HEADERS,
    allowedHosts: feedHosts,
    maximumBytes: MAXIMUM_FEED_BYTES,
  };
  const discoveryHtml = await context.http.text(discoveryUrl, requestOptions);
  const pageCeiling = readMaximumPage(discoveryHtml);
  const selectedPage = dependencies.randomInteger(1, pageCeiling);
  const selectedPageUrl = pageUrl(selectedPage);
  const feedHtml = selectedPage === 1
    ? discoveryHtml
    : await context.http.text(selectedPageUrl, requestOptions);
  const candidates = extractMedia(feedHtml, selectedPageUrl);
  const selectedUrl = dependencies.choose(candidates);
  if (!selectedUrl) {
    throw new MediaProviderError(`${provider} feed did not contain a usable direct image.`, {
      code: 'INVALID_RESPONSE',
    });
  }

  const download = await context.http.buffer(selectedUrl, {
    headers: MEDIA_HEADERS,
    allowedHosts: mediaHosts,
    minimumBytes: 1_024,
  });
  const contentType = String(download.contentType).toLowerCase();
  const resolvedUrl = httpsUrl(download.finalUrl || selectedUrl, selectedUrl);
  if (!resolvedUrl) {
    throw new MediaProviderError(`${provider} media redirected to an insecure or invalid URL.`, {
      code: 'INVALID_URL',
    });
  }
  if (!DISCORD_IMAGE_TYPES.has(contentType)) {
    throw new MediaProviderError(`${provider} returned a non-image media payload.`, {
      code: 'INVALID_RESPONSE',
    });
  }
  return {
    page: selectedPage,
    url: resolvedUrl.toString(),
    download: { ...download, contentType },
  };
}

export {
  AHOTTIE_HOST,
  HENTAI_HOST,
  HTML_HEADERS,
  MAXIMUM_FEED_BYTES,
};
