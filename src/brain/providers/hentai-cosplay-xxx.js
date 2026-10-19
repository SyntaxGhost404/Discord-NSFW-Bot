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

export async function fetchHentaiCosplayXxx(_source, context, dependencies) {
  try {
    const result = await fetchRandomCosplayAttachment({
      provider: PROVIDER,
      pageUrl: (page) => ProviderEndpoint.HENTAI_COSPLAY_FEED.replace('{page}', String(page)),
      maximumPage: hentaiCosplayMaximumPage,
      extractMedia: extractHentaiCosplayMedia,
      feedHosts: [HENTAI_HOST],
      mediaHosts: [HENTAI_HOST],
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
