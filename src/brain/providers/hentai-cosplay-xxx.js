import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { providerError } from './errors.js';
import {
  extractHentaiCosplayMedia,
  fetchRandomCosplayAttachment,
  HENTAI_HOST,
  hentaiCosplayMaximumPage,
} from './cosplay-feed.js';

const PROVIDER = 'hentai-cosplay-xxx.com';

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
export async function fetchHentaiCosplayXxx(_source, context, dependencies) {
  try {
    const result = await fetchRandomCosplayAttachment({
      provider: PROVIDER,
      pageUrl: feedPageUrl,
      maximumPage: hentaiCosplayMaximumPage,
      extractMedia: extractHentaiCosplayMedia,
      feedHosts: [HENTAI_HOST],
      mediaHosts: [HENTAI_HOST],
      mediaReferer: `https://${HENTAI_HOST}/`,
      freshPagePerAttempt: true,
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
