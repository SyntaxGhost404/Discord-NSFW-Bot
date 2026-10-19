import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

export async function fetchWaifuIm(source, context) {
  const provider = 'waifu.im';
  if (!context.config.waifuImKey) {
    throw new MediaProviderError('WAIFU_IM_KEY is not configured.', { code: 'PROVIDER_DISABLED', provider });
  }
  try {
    const payload = await context.http.json(ProviderEndpoint.WAIFU_IM, {
      query: {
        IncludedTags: source.tag,
        IsNsfw: source.isNsfw === false ? 'False' : 'True',
      },
      headers: {
        Authorization: `ApiKey ${context.config.waifuImKey}`,
        'Accept-Version': 'v7',
      },
    });
    const url = payload?.items?.[0]?.url;
    if (!url) throw new MediaProviderError('Waifu.im response did not contain an item URL.', { code: 'INVALID_RESPONSE' });
    return mediaResult({ provider, url });
  } catch (error) {
    throw providerError(error, provider);
  }
}
