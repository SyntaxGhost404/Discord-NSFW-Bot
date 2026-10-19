import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

export async function fetchNekoBot(source, context) {
  const provider = 'nekobot.xyz';
  if (!context.config.nekoBotAuthorization) {
    throw new MediaProviderError('NEKOBOT_AUTHORIZATION is not configured.', { code: 'PROVIDER_DISABLED', provider });
  }
  try {
    const endpoint = ProviderEndpoint.NEKOBOT.replace('{type}', encodeURIComponent(source.type));
    const payload = await context.http.json(endpoint, {
      headers: { Authorization: context.config.nekoBotAuthorization },
    });
    if (!payload?.success || !payload?.message) {
      throw new MediaProviderError('NekoBot response did not contain a successful media URL.', { code: 'INVALID_RESPONSE' });
    }
    return mediaResult({ provider, url: payload.message });
  } catch (error) {
    throw providerError(error, provider);
  }
}
