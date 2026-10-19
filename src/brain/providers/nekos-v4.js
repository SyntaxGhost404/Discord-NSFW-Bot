import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

export async function fetchNekosV4(source, context) {
  const provider = 'nekosapi.com';
  try {
    const payload = await context.http.json(source.endpoint);
    const url = Array.isArray(payload) ? payload[0]?.url : null;
    if (!url) throw new MediaProviderError('Nekos API response did not contain a URL.', { code: 'INVALID_RESPONSE' });
    return mediaResult({ provider, url });
  } catch (error) {
    throw providerError(error, provider);
  }
}
