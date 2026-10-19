import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { providerError } from './errors.js';
import {
  extractHentaiCosplayMedia,
  fetchRandomCosplayAttachment,
  HENTAI_HOST,
  hentaiCosplayMaximumPage,
} from './cosplay-feed.js';
import { withTimeout } from '../../lib/time.js';

const PROVIDER = 'hentai-cosplay-xxx.com';
// The pool is an optimisation, so a slow or failing pool never delays a
// request by more than this before the feed is read directly.
const POOL_TIMEOUT_MS = 1_000;
const TIMED_OUT = Symbol('timed out');

// /search/page/1/ redirects to /search/, and each redirect hop counts as a
// subrequest, so the first page is requested at its final address.
function feedPageUrl(page) {
  return page === 1
    ? ProviderEndpoint.HENTAI_COSPLAY_FIRST_PAGE
    : ProviderEndpoint.HENTAI_COSPLAY_FEED.replace('{page}', String(page));
}

// Each feed page's album covers usually live on one image server, and some of
// those servers answer 502 for every file. A retry therefore reads a new
// random page; the pages are small, so this costs little CPU.
export const HENTAI_COSPLAY_FEED = Object.freeze({
  provider: PROVIDER,
  pageUrl: feedPageUrl,
  maximumPage: hentaiCosplayMaximumPage,
  extractMedia: extractHentaiCosplayMedia,
  feedHosts: Object.freeze([HENTAI_HOST]),
  mediaHosts: Object.freeze([HENTAI_HOST]),
  mediaReferer: `https://${HENTAI_HOST}/`,
  freshPagePerAttempt: true,
});

// The site builds every feed page on demand, which takes 0.5-4.5 s, so the
// CosplayPool Durable Object keeps image links from random pages ready.
function candidatePool(context) {
  const namespace = context.env?.COSPLAY_POOL;
  if (!namespace) return null;
  const stub = namespace.getByName(PROVIDER);
  const call = async (method, ...args) => {
    const pending = Promise.resolve().then(() => stub[method](...args));
    // A call that fails after the timeout must not become an unhandled rejection.
    pending.catch(() => {});
    try {
      const result = await withTimeout(pending, POOL_TIMEOUT_MS, TIMED_OUT);
      if (result !== TIMED_OUT) return result;
      context.logger?.warn('Cosplay pool did not answer in time; reading the feed directly.', { method, timeoutMs: POOL_TIMEOUT_MS });
    } catch (error) {
      context.logger?.warn('Cosplay pool call failed; reading the feed directly.', { method, error });
    }
    return null;
  };
  return {
    take: () => call('take'),
    reportDeadHost: (url) => call('reportDeadHost', url),
  };
}

export async function fetchHentaiCosplayXxx(_source, context, dependencies) {
  try {
    const result = await fetchRandomCosplayAttachment({
      ...HENTAI_COSPLAY_FEED,
      pool: candidatePool(context),
    }, context, dependencies);
    return mediaResult({
      provider: PROVIDER,
      id: String(result.page),
      url: result.url,
      watchUrl: result.url,
      download: result.download,
    });
  } catch (error) {
    throw providerError(error, PROVIDER);
  }
}
