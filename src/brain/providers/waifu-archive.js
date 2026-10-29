import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';
import { ARCHIVE_IMAGES, ARCHIVE_TAGS } from './waifu-archive-index.js';
import { choose } from '../../lib/random.js';

const PROVIDER = 'waifu archive';
const ARCHIVE_HOST = new URL(ProviderEndpoint.WAIFU_ARCHIVE).hostname;
const ARCHIVE_ORIGIN = new URL(ProviderEndpoint.WAIFU_ARCHIVE).origin;
const IMAGE_PATH = /^\/\d+\.(?:gif|jpe?g|png|webp)$/i;
// Problems with one file, after which another match is tried. Anything else
// (a timeout, a 5xx) means the archive itself is struggling.
const ITEM_FAILURES = new Set(['TOO_LARGE', 'INVALID_RESPONSE', 'PLACEHOLDER_IMAGE']);

const defaultDependencies = Object.freeze({ choose });

function itemFailure(error) {
  return ITEM_FAILURES.has(error?.code) || (error?.code === 'HTTP_ERROR' && error.status === 404);
}

// The archive is frozen, so its index ships with the bot
// (scripts/build-waifu-archive-index.mjs) and is parsed on first use.
let imagesByTag = null;

function indexedImages(tag) {
  if (!imagesByTag) {
    imagesByTag = new Map(ARCHIVE_TAGS.map((name) => [name, []]));
    for (const entry of ARCHIVE_IMAGES.split(' ')) {
      const [file, kib, mask] = entry.split(':');
      const bits = Number.parseInt(mask, 36);
      const image = { file, id: file.slice(0, file.indexOf('.')), bytes: Number(kib) * 1_024 };
      ARCHIVE_TAGS.forEach((name, index) => {
        if (bits & (1 << index)) imagesByTag.get(name).push(image);
      });
    }
  }
  return imagesByTag.get(tag) ?? [];
}

function downloadArchiveImage(context, url) {
  return context.http.buffer(url, {
    allowedHosts: [ARCHIVE_HOST],
    allowSubdomains: false,
    minimumBytes: 1_024,
    expectImage: true,
  });
}

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
// when that service shut down in October 2026. An image is picked from the
// bundled index, which needs no search request and never picks a file too
// large to upload. If the archive no longer serves that file, its Waifu.im
// v7-style search answers instead, with up to five random matches.
//
// The file is downloaded and uploaded to Discord rather than embedded by URL.
// Discord cannot read an archive image's size while it posts the message, so
// a linked image showed a loading spinner until a background job finished,
// which took from seconds to minutes. An uploaded original renders at once.
export async function fetchWaifuArchive(source, context, dependencies = defaultDependencies) {
  try {
    if (source.isNsfw !== false) {
      const image = dependencies.choose(indexedImages(source.tag).filter((entry) => entry.bytes <= context.maxMediaBytes));
      if (image) {
        const url = `${ARCHIVE_ORIGIN}/${image.file}`;
        try {
          return mediaResult({ provider: PROVIDER, id: image.id, url, download: await downloadArchiveImage(context, url) });
        } catch (error) {
          if (!itemFailure(error)) throw error;
        }
      }
    }
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
        return mediaResult({
          provider: PROVIDER,
          id: item.id === undefined ? undefined : String(item.id),
          url: item.url,
          download: await downloadArchiveImage(context, item.url),
        });
      } catch (error) {
        lastError = error;
        if (!itemFailure(error)) break;
      }
    }
    throw lastError;
  } catch (error) {
    throw providerError(error, PROVIDER);
  }
}
