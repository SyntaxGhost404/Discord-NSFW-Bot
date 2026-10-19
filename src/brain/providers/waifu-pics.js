import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

export async function fetchWaifuPics(source, context) {
  const provider = 'waifu.pics';
  if (!context.config.waifuPicsEnabled) {
    throw new MediaProviderError('Waifu.pics is disabled by WAIFU_PICS.', { code: 'PROVIDER_DISABLED', provider });
  }
  try {
    const payload = await context.http.json(source.endpoint);
    if (!payload?.url) throw new MediaProviderError('Waifu.pics response did not contain a URL.', { code: 'INVALID_RESPONSE' });
    return mediaResult({ provider, url: payload.url });
  } catch (error) {
    throw providerError(error, provider);
  }
}
