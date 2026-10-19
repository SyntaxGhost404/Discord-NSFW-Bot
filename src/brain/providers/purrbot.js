import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

export async function fetchPurrbot(source, context) {
  const provider = 'purrbot.site';
  try {
    const payload = await context.http.json(source.endpoint);
    if (payload?.error || !payload?.link) {
      throw new MediaProviderError('Purrbot response did not contain a media link.', { code: 'INVALID_RESPONSE' });
    }
    return mediaResult({ provider, url: payload.link });
  } catch (error) {
    throw providerError(error, provider);
  }
}
