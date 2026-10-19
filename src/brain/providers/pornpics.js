import { randomInteger } from '../../lib/random.js';
import { decodeHtml } from './cosplay-feed.js';
import { MediaProviderError, providerError } from './errors.js';
import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';

const PROVIDER = 'pornpics.com';
const FEED_HOST = 'pornpics.com';
const MEDIA_HOST = 'cdni.pornpics.com';
const ITEMS_PER_ROTATOR_PAGE = 10;
const INITIAL_FEED_ITEMS = 20;
const MAXIMUM_ITEM_COUNT = 1_000_000;
const MAXIMUM_FEED_BYTES = 2 * 1024 * 1024;
const MAXIMUM_OFFSET_BYTES = 512 * 1024;
const MEDIA_DOWNLOAD_ATTEMPTS = 2;
const IMAGE_PATH = /\.(?:avif|jpe?g|png|webp)$/i;
const DISCORD_IMAGE_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/x-png',
]);
const P_MAX_PATTERN = /\bP_MAX\s*=\s*["']?(\d{1,7})["']?/g;
const IMAGE_ATTRIBUTE_PATTERN = /\b(?:data-full|data-original|data-lazy-src|data-src|srcset|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const COVER_FIELD_PATTERN = /["']?t_url(?:_460)?["']?\s*:\s*(?:"([^"]*)"|'([^']*)')/gi;

const HTML_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
});

const JSON_HEADERS = Object.freeze({
  Accept: 'application/json,text/plain;q=0.9,*/*;q=0.1',
  'User-Agent': HTML_HEADERS['User-Agent'],
});

const MEDIA_HEADERS = Object.freeze({
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  Referer: ProviderEndpoint.PORNPICS_BUTTPLUG_FEED,
  'User-Agent': HTML_HEADERS['User-Agent'],
});

const defaultDependencies = Object.freeze({ randomInteger });

function invalidResponse(message, cause) {
  return new MediaProviderError(message, {
    code: 'INVALID_RESPONSE',
    cause,
  });
}

function categoryUrl(value) {
  let url;
  try {
    url = new URL(value || ProviderEndpoint.PORNPICS_BUTTPLUG_FEED);
  } catch (cause) {
    throw new MediaProviderError('PornPics category URL is malformed.', {
      code: 'INVALID_URL',
      cause,
    });
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'www.pornpics.com'
    || url.port
    || url.username
    || url.password
    || url.pathname !== '/butt-plug/'
  ) {
    throw new MediaProviderError('PornPics category URL is outside the supported feed.', {
      code: 'INVALID_URL',
    });
  }
  url.search = '';
  url.hash = '';
  return url;
}

function decodedReference(value) {
  return decodeHtml(String(value ?? ''))
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .trim();
}

export function highResolutionPornPicsCover(value, baseUrl = ProviderEndpoint.PORNPICS_BUTTPLUG_FEED) {
  let url;
  try {
    const reference = decodedReference(value);
    url = new URL(reference.startsWith('//') ? `https:${reference}` : reference, baseUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== MEDIA_HOST
    || url.port
    || url.username
    || url.password
    || !IMAGE_PATH.test(url.pathname)
    || !/^\/(?:300|460|1280)\//.test(url.pathname)
  ) {
    return null;
  }
  url.pathname = url.pathname.replace(/^\/(?:300|460)\//, '/1280/');
  url.hash = '';
  return url.toString();
}

function srcsetReferences(value) {
  return decodedReference(value)
    .split(',')
    .map((entry) => entry.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag).match(new RegExp(
    `\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ));
  return decodedReference(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function galleryAnchor(block, pageUrl) {
  const openingTag = String(block).match(/^<a\b[^>]*>/i)?.[0];
  if (!openingTag) return false;
  try {
    const href = new URL(attribute(openingTag, 'href'), pageUrl);
    return href.protocol === 'https:'
      && href.hostname === 'www.pornpics.com'
      && !href.port
      && !href.username
      && !href.password
      && href.pathname.startsWith('/galleries/');
  } catch {
    return false;
  }
}

function imageReferences(markup) {
  const references = [];
  for (const tagMatch of String(markup).matchAll(/<img\b[^>]*>/gi)) {
    const tag = tagMatch[0];
    for (const attributeMatch of tag.matchAll(IMAGE_ATTRIBUTE_PATTERN)) {
      const value = attributeMatch[1] ?? attributeMatch[2] ?? '';
      if (/\bsrcset\s*=/i.test(attributeMatch[0])) references.push(...srcsetReferences(value));
      else references.push(value);
    }
  }
  return references;
}

export function extractPornPicsCovers(html, pageUrl = ProviderEndpoint.PORNPICS_BUTTPLUG_FEED) {
  const references = [];
  for (const match of String(html).matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    if (galleryAnchor(match[0], pageUrl)) references.push(...imageReferences(match[0]));
  }
  if (references.length === 0) {
    for (const match of String(html).matchAll(COVER_FIELD_PATTERN)) {
      references.push(match[1] ?? match[2] ?? '');
    }
  }

  const covers = [];
  const seen = new Set();
  for (const reference of references) {
    const value = Array.isArray(reference) ? reference[0] : reference;
    const cover = highResolutionPornPicsCover(value, pageUrl);
    if (cover && !seen.has(cover)) {
      seen.add(cover);
      covers.push(cover);
    }
  }
  return covers;
}

export function pornPicsItemCeiling(html) {
  const matches = [...String(html).matchAll(P_MAX_PATTERN)];
  if (matches.length === 0) {
    throw invalidResponse('PornPics feed did not expose its P_MAX item ceiling.');
  }
  const pageCount = Number.parseInt(matches[0][1], 10);
  const itemCount = pageCount * ITEMS_PER_ROTATOR_PAGE;
  if (!Number.isSafeInteger(itemCount) || itemCount < 1 || itemCount > MAXIMUM_ITEM_COUNT) {
    throw invalidResponse('PornPics feed exposed an invalid P_MAX item ceiling.');
  }
  return itemCount;
}

export function parsePornPicsOffsetPayload(body, offset) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (cause) {
    throw invalidResponse('PornPics offset endpoint returned invalid JSON.', cause);
  }
  const item = Array.isArray(payload) ? payload[0] : null;
  if (!item || typeof item !== 'object') {
    throw invalidResponse('PornPics offset endpoint returned no gallery cover.');
  }
  const url = [item.t_url_460, item.t_url]
    .map((value) => highResolutionPornPicsCover(value))
    .find(Boolean);
  if (!url) {
    throw invalidResponse('PornPics offset item did not contain a usable cover URL.');
  }
  return {
    id: String(item.mid ?? item.gid ?? offset),
    url,
  };
}

async function offsetCover(category, offset, context) {
  const endpoint = new URL(category);
  endpoint.searchParams.set('offset', String(offset));
  const body = await context.http.text(endpoint.toString(), {
    headers: JSON_HEADERS,
    allowedHosts: [FEED_HOST],
    maximumBytes: MAXIMUM_OFFSET_BYTES,
  });
  return parsePornPicsOffsetPayload(body, offset);
}

async function downloadCover(url, context) {
  let lastError;
  for (let attempt = 1; attempt <= MEDIA_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await context.http.buffer(url, {
        headers: MEDIA_HEADERS,
        allowedHosts: [MEDIA_HOST],
        allowSubdomains: false,
        minimumBytes: 1_024,
      });
    } catch (error) {
      lastError = error;
      if (error?.code !== 'NETWORK_ERROR' || attempt === MEDIA_DOWNLOAD_ATTEMPTS) throw error;
    }
  }
  throw lastError;
}

export async function fetchPornPics(source, context, dependencies = defaultDependencies) {
  try {
    const category = categoryUrl(source?.endpoint);
    const discoveryHtml = await context.http.text(category.toString(), {
      headers: HTML_HEADERS,
      allowedHosts: [FEED_HOST],
      maximumBytes: MAXIMUM_FEED_BYTES,
    });
    const itemCount = pornPicsItemCeiling(discoveryHtml);
    const selectedOffset = dependencies.randomInteger(0, itemCount - 1);
    if (!Number.isInteger(selectedOffset) || selectedOffset < 0 || selectedOffset >= itemCount) {
      throw invalidResponse('PornPics random offset was outside the discovered item range.');
    }

    let selected = null;
    if (selectedOffset < Math.min(INITIAL_FEED_ITEMS, itemCount)) {
      const covers = extractPornPicsCovers(discoveryHtml, category.toString());
      if (covers[selectedOffset]) selected = { id: String(selectedOffset), url: covers[selectedOffset] };
    }
    selected ??= await offsetCover(category, selectedOffset, context);

    const download = await downloadCover(selected.url, context);
    const contentType = String(download.contentType).toLowerCase();
    if (!DISCORD_IMAGE_TYPES.has(contentType)) {
      throw invalidResponse('PornPics CDN returned a non-image media payload.');
    }
    const resolvedUrl = highResolutionPornPicsCover(download.finalUrl || selected.url);
    if (!resolvedUrl) {
      throw new MediaProviderError('PornPics media redirected to an insecure or invalid URL.', {
        code: 'INVALID_URL',
      });
    }

    return mediaResult({
      provider: PROVIDER,
      id: selected.id,
      url: resolvedUrl,
      watchUrl: selected.url,
      download: { ...download, contentType },
    });
  } catch (error) {
    throw providerError(error, PROVIDER);
  }
}

export {
  FEED_HOST as PORNPICS_FEED_HOST,
  MEDIA_HOST as PORNPICS_MEDIA_HOST,
  MAXIMUM_FEED_BYTES as PORNPICS_MAXIMUM_FEED_BYTES,
  MAXIMUM_OFFSET_BYTES as PORNPICS_MAXIMUM_OFFSET_BYTES,
};
