import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

const PROVIDER = 'waifu archive';
const ARCHIVE_HOST = new URL(ProviderEndpoint.WAIFU_ARCHIVE).hostname;
const IMAGE_PATH = /^\/\d+\.(?:gif|jpe?g|png|webp)$/i;

function archiveImageUrl(value) {
  try {
    const url = new URL(value);
    const valid = url.protocol === 'https:' && url.hostname === ARCHIVE_HOST
      && !url.port && !url.username && !url.password && IMAGE_PATH.test(url.pathname);
    return valid ? url.toString() : null;
  } catch {
    return null;
  }
}

// Self-hosted copy of the Waifu.im library, which replaced the Waifu.im API
// when that service shut down in October 2026. It answers Waifu.im v7-style
// tag searches with up to five random matches and serves the files from its
// own host, so a match is embedded by URL.
export async function fetchWaifuArchive(source, context) {
  try {
    const payload = await context.http.json(ProviderEndpoint.WAIFU_ARCHIVE, {
      query: {
        IncludedTags: source.tag,
        IsNsfw: source.isNsfw === false ? 'False' : 'True',
      },
      allowedHosts: [ARCHIVE_HOST],
      allowSubdomains: false,
    });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const item = items.find((entry) => archiveImageUrl(entry?.url));
    if (!item) {
      throw new MediaProviderError('The Waifu archive returned no usable image for this tag.', { code: 'INVALID_RESPONSE' });
    }
    return mediaResult({
      provider: PROVIDER,
      id: item.id === undefined ? undefined : String(item.id),
      url: archiveImageUrl(item.url),
    });
  } catch (error) {
    throw providerError(error, PROVIDER);
  }
}
