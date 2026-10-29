import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';
import {
  cleanHentaiCosplayUrl,
  downloadCosplayImage,
  extractHentaiCosplayMedia,
  HENTAI_HOST,
  hentaiCosplayMaximumPage,
  hostIsFailing,
  readFeedCeiling,
  readFeedPage,
  STOP_CODES,
} from './cosplay-feed.js';
import { choose, randomInteger } from '../../lib/random.js';

const PROVIDER = 'hentai-cosplay-xxx.com';
// Images tried per request, and listings read to find them. Several of the
// site's image servers answer 502 for every file, and a listing's images
// usually sit on one server, so a failed server means reading a new listing.
const MAXIMUM_DOWNLOADS = 3;
const MAXIMUM_LISTINGS = 3;
// The image sitemaps list every image of 500 albums each, in upload order,
// and are cached at the edge; feed pages are built on demand and take
// 0.5-4.5 seconds. A sitemap unpacks to about 5 MB, so only its start is
// read: about 2 ms of CPU for a few hundred images from 5-15 albums.
const SITEMAP_FILES = 708;
const SITEMAP_PREFIX_BYTES = 96 * 1024;
const SITEMAP_IMAGE = /<image:loc>\s*([^<\s]+)\s*<\/image:loc>/g;
const SITEMAP_HEADERS = Object.freeze({
  Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
});
const DEAD_HOST_MS = 10 * 60 * 1_000;
const MAXIMUM_DEAD_HOSTS = 64;
const CEILING_TTL_MS = 60 * 60 * 1_000;

const defaultDependencies = Object.freeze({ choose, randomInteger });

// /search/page/1/ redirects to /search/, and each redirect hop counts as a
// subrequest, so the first page is requested at its final address.
function feedPageUrl(page) {
  return page === 1
    ? ProviderEndpoint.HENTAI_COSPLAY_FIRST_PAGE
    : ProviderEndpoint.HENTAI_COSPLAY_FEED.replace('{page}', String(page));
}

const HENTAI_COSPLAY_FEED = Object.freeze({
  provider: PROVIDER,
  pageUrl: feedPageUrl,
  maximumPage: hentaiCosplayMaximumPage,
  extractMedia: extractHentaiCosplayMedia,
  feedHosts: Object.freeze([HENTAI_HOST]),
  mediaHosts: Object.freeze([HENTAI_HOST]),
  mediaReferer: `https://${HENTAI_HOST}/`,
  // Deep feed pages can take over four seconds to start.
  headersTimeoutMs: 8_000,
});

// Learned only from this isolate's own requests: image servers that recently
// failed, and the feed's page count for the fallback path.
const deadHosts = new Map();
let feedCeiling = null;

export function resetHentaiCosplayStateForTests() {
  deadHosts.clear();
  feedCeiling = null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isDead(url, now) {
  const host = hostOf(url);
  const until = deadHosts.get(host);
  if (until === undefined) return false;
  if (until > now) return true;
  deadHosts.delete(host);
  return false;
}

function markDead(url, now) {
  const host = hostOf(url);
  if (!host) return;
  deadHosts.delete(host);
  deadHosts.set(host, now + DEAD_HOST_MS);
  if (deadHosts.size > MAXIMUM_DEAD_HOSTS) deadHosts.delete(deadHosts.keys().next().value);
}

async function readSitemapImages(http, dependencies) {
  const file = dependencies.randomInteger(1, SITEMAP_FILES);
  const url = ProviderEndpoint.HENTAI_COSPLAY_SITEMAP.replace('{file}', String(file));
  const text = await http.textPrefix(url, {
    length: SITEMAP_PREFIX_BYTES,
    headers: SITEMAP_HEADERS,
    allowedHosts: [HENTAI_HOST],
    allowSubdomains: false,
  });
  const urls = new Set();
  for (const match of text.matchAll(SITEMAP_IMAGE)) {
    const image = cleanHentaiCosplayUrl(match[1], url);
    if (image) urls.add(image);
  }
  return { listing: `sitemap ${file}`, urls: [...urls] };
}

async function readFeedImages(http, dependencies) {
  if (!feedCeiling || Date.now() - feedCeiling.at > CEILING_TTL_MS) {
    const { ceiling } = await readFeedCeiling(http, HENTAI_COSPLAY_FEED);
    feedCeiling = { value: ceiling, at: Date.now() };
  }
  const page = dependencies.randomInteger(1, feedCeiling.value);
  return { listing: `feed page ${page}`, urls: await readFeedPage(http, HENTAI_COSPLAY_FEED, page) };
}

// Finds a random image in a random image sitemap, falling back to the feed
// pages if the sitemaps are missing or change format, and downloads and checks
// it before use. Gallery pages are never opened.
export async function fetchHentaiCosplayXxx(_source, context, dependencies = defaultDependencies) {
  try {
    const attempted = new Set();
    let useSitemaps = true;
    let listings = 0;
    let downloads = 0;
    let listing = null;
    let candidates = [];
    let lastError = null;
    const leaveSitemaps = (fields) => {
      if (useSitemaps) context.logger?.warn('Cosplay sitemaps are unavailable; reading feed pages instead.', { provider: PROVIDER, ...fields });
      useSitemaps = false;
    };
    while (downloads < MAXIMUM_DOWNLOADS) {
      const usable = () => candidates.filter((url) => !attempted.has(url) && !isDead(url, Date.now()));
      if (usable().length === 0) {
        if (listings >= MAXIMUM_LISTINGS) break;
        listings += 1;
        try {
          ({ listing, urls: candidates } = useSitemaps
            ? await readSitemapImages(context.http, dependencies)
            : await readFeedImages(context.http, dependencies));
        } catch (error) {
          lastError = error;
          if (STOP_CODES.has(error?.code)) break;
          leaveSitemaps({ code: error?.code, status: error?.status });
          continue;
        }
        if (candidates.length === 0) {
          leaveSitemaps({ listing, code: 'INVALID_RESPONSE' });
          lastError = new MediaProviderError(`${PROVIDER} ${listing} listed no usable image.`, { code: 'INVALID_RESPONSE' });
          continue;
        }
        if (usable().length === 0) continue;
      }
      const url = dependencies.choose(usable());
      attempted.add(url);
      downloads += 1;
      try {
        const image = await downloadCosplayImage(context, HENTAI_COSPLAY_FEED, url);
        return mediaResult({ provider: PROVIDER, id: listing, url: image.url, watchUrl: image.url, download: image.download });
      } catch (error) {
        lastError = error;
        if (STOP_CODES.has(error?.code)) break;
        if (hostIsFailing(error)) markDead(url, Date.now());
        context.logger?.debug('Rejected a cosplay image; trying another.', {
          provider: PROVIDER,
          listing,
          code: error?.code,
          reason: error?.message,
        });
      }
    }
    throw lastError ?? new MediaProviderError(`${PROVIDER} returned no usable image.`, { code: 'INVALID_RESPONSE' });
  } catch (error) {
    throw providerError(error, PROVIDER);
  }
}
