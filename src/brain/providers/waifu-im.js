import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

// Waifu.im answers anonymous requests, so WAIFU_IM_KEY only adds the
// Authorization header when it is configured.
export async function fetchWaifuIm(source, context) {
  const provider = 'waifu.im';
  try {
    const headers = { 'Accept-Version': 'v7' };
    if (context.config.waifuImKey) headers.Authorization = `ApiKey ${context.config.waifuImKey}`;
    const payload = await context.http.json(ProviderEndpoint.WAIFU_IM, {
      query: {
        IncludedTags: source.tag,
        IsNsfw: source.isNsfw === false ? 'False' : 'True',
      },
      headers,
    });
    const url = payload?.items?.[0]?.url;
    if (!url) throw new MediaProviderError('Waifu.im response did not contain an item URL.', { code: 'INVALID_RESPONSE' });
    return mediaResult({ provider, url });
  } catch (error) {
    throw providerError(error, provider);
  }
}
