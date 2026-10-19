import { ProviderEndpoint } from './manifest.js';
import { EMBEDDABLE_IMAGE_TYPES } from './http.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

const PROVIDER = 'n-sfw.com';
const API_HOST = 'api.n-sfw.com';
const MEDIA_HOST = ProviderEndpoint.N_SFW_MEDIA_HOST;
const MAXIMUM_DOWNLOAD_TIMEOUT_MS = 6_000;

function validatedMediaUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new MediaProviderError('N-SFW returned a malformed media URL.', { code: 'INVALID_URL', cause });
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new MediaProviderError('N-SFW media URLs must use plain HTTPS.', { code: 'INVALID_URL' });
  }
  if (url.hostname !== MEDIA_HOST) {
    throw new MediaProviderError(`N-SFW returned an unexpected media host: ${url.hostname}`, { code: 'UNEXPECTED_HOST' });
  }
  if (!url.pathname.startsWith('/nsfw/')) {
    throw new MediaProviderError('N-SFW returned media outside the NSFW catalogue.', { code: 'INVALID_URL' });
  }
  url.hash = '';
  return url;
}

// GET https://api.n-sfw.com/nsfw/{category} returns one image object whose
// `url` lives on data.n-sfw.com. The bytes are downloaded and re-uploaded as a
// native attachment so a slow or failing image host is detected here, letting
// the command fall back instead of posting a broken embed.
export async function fetchAbd(source, context) {
  try {
    const payload = await context.http.json(source.endpoint, {
      allowedHosts: [API_HOST],
      allowSubdomains: false,
    });
    if (typeof payload?.url !== 'string' || !payload.url.trim()) {
      throw new MediaProviderError('N-SFW response did not contain a media URL.', { code: 'INVALID_RESPONSE' });
    }
    const url = validatedMediaUrl(payload.url.trim());
    const mime = typeof payload.mime === 'string' ? payload.mime.toLowerCase() : '';
    if (mime && !EMBEDDABLE_IMAGE_TYPES.has(mime)) {
      throw new MediaProviderError(`N-SFW returned an unsupported media type: ${mime}`, { code: 'INVALID_RESPONSE' });
    }
    if (Number.isFinite(payload.size) && payload.size > context.maxMediaBytes) {
      throw new MediaProviderError('N-SFW media exceeds the attachment limit.', { code: 'TOO_LARGE' });
    }

    const download = await context.http.buffer(url.toString(), {
      allowedHosts: [MEDIA_HOST],
      allowSubdomains: false,
      minimumBytes: 1_024,
      expectImage: true,
      timeoutMs: Math.min(context.config.mediaTimeoutMs, MAXIMUM_DOWNLOAD_TIMEOUT_MS),
    });
    return mediaResult({
      provider: PROVIDER,
      id: typeof payload.name === 'string' ? payload.name : undefined,
      url: url.toString(),
      watchUrl: url.toString(),
      download,
    });
  } catch (error) {
    throw providerError(error, PROVIDER);
  }
}

export { API_HOST as ABD_API_HOST, MEDIA_HOST as ABD_MEDIA_HOST };
