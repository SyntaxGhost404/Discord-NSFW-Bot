import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

const PROVIDER = 'waifu archive';
const ARCHIVE_HOST = new URL(ProviderEndpoint.WAIFU_ARCHIVE).hostname;
const IMAGE_PATH = /^\/\d+\.(?:gif|jpe?g|png|webp)$/i;
// Problems with one file, after which another match is tried. Anything else
// (a timeout, a 5xx) means the archive itself is struggling.
const ITEM_FAILURES = new Set(['TOO_LARGE', 'INVALID_RESPONSE', 'PLACEHOLDER_IMAGE']);

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
// tag searches with up to five random matches.
//
// The file is downloaded and uploaded to Discord rather than embedded by URL.
// Discord cannot read an archive image's size while it posts the message, so
// a linked image showed a loading spinner until a background job finished,
// which took from seconds to minutes. An uploaded original renders at once.
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
    const items = (Array.isArray(payload?.items) ? payload.items : [])
      .map((entry) => ({ id: entry?.id, url: archiveImageUrl(entry?.url) }))
      .filter((entry) => entry.url);
    let lastError = new MediaProviderError('The Waifu archive returned no usable image for this tag.', { code: 'INVALID_RESPONSE' });
    for (const item of items) {
      try {
        const download = await context.http.buffer(item.url, {
          allowedHosts: [ARCHIVE_HOST],
          allowSubdomains: false,
          minimumBytes: 1_024,
          expectImage: true,
        });
        return mediaResult({
          provider: PROVIDER,
          id: item.id === undefined ? undefined : String(item.id),
          url: item.url,
          download,
        });
      } catch (error) {
        lastError = error;
        if (!ITEM_FAILURES.has(error?.code) && !(error?.code === 'HTTP_ERROR' && error.status === 404)) break;
      }
    }
    throw lastError;
  } catch (error) {
    throw providerError(error, PROVIDER);
  }
}
