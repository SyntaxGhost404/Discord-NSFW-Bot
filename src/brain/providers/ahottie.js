import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';
import {
  AHOTTIE_HOST,
  ahottieMaximumPage,
  extractAhottieMedia,
  fetchRandomCosplayAttachment,
} from './cosplay-feed.js';

const PROVIDER = 'ahottie.top';

// Ahottie's images are hosted on imgbox, which in October 2026 answered every
// request with its "Thumbnail Temporarily Unavailable" placeholder, so the
// source is off unless AHOTTIE is set. Its pages are over a megabyte, so a
// retry uses another image from the page already parsed instead of reading a
// new one.
export async function fetchAhottie(_source, context, dependencies) {
  if (!context.config.ahottieEnabled) {
    throw new MediaProviderError('Ahottie is disabled by AHOTTIE.', { code: 'PROVIDER_DISABLED', provider: PROVIDER });
  }
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
