import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { providerError } from './errors.js';
import {
  AHOTTIE_HOST,
  ahottieMaximumPage,
  extractAhottieMedia,
  fetchRandomCosplayAttachment,
} from './cosplay-feed.js';

const PROVIDER = 'ahottie.top';

export async function fetchAhottie(_source, context, dependencies) {
  try {
    const result = await fetchRandomCosplayAttachment({
      provider: PROVIDER,
      pageUrl: (page) => ProviderEndpoint.AHOTTIE_COSPLAY_FEED.replace('{page}', String(page)),
      maximumPage: ahottieMaximumPage,
      extractMedia: extractAhottieMedia,
      feedHosts: [AHOTTIE_HOST],
      mediaHosts: ['imgbox.com'],
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
