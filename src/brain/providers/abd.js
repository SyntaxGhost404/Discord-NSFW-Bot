import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

const PROVIDER = 'n-sfw.com';
const OSAKA_MEDIA_HOST = 'n-sfw.ap-osaka-1.s3.ink';
const ABD_MEDIA_HOSTS = Object.freeze([OSAKA_MEDIA_HOST]);
const MAXIMUM_OSAKA_TIMEOUT_MS = 5_000;

function nativeResult(url, download) {
  return mediaResult({
    provider: PROVIDER,
    url,
    watchUrl: url,
    download,
  });
}

function validatedOsakaUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new MediaProviderError('N-SFW returned a malformed media URL.', {
      code: 'INVALID_URL',
      cause,
    });
  }
  if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443')) {
    throw new MediaProviderError('N-SFW media URLs must use HTTPS on the standard port.', {
      code: 'INVALID_URL',
    });
  }
  if (parsed.hostname !== OSAKA_MEDIA_HOST) {
    throw new MediaProviderError(`N-SFW returned an unexpected media host: ${parsed.hostname}`, {
      code: 'UNEXPECTED_HOST',
    });
  }
  return parsed;
}

function downloadOptions(context) {
  return {
    minimumBytes: 1_024,
    allowedHosts: ABD_MEDIA_HOSTS,
    allowSubdomains: false,
    timeoutMs: Math.min(
      context.config?.mediaTimeoutMs ?? MAXIMUM_OSAKA_TIMEOUT_MS,
      MAXIMUM_OSAKA_TIMEOUT_MS,
    ),
  };
}

export async function fetchAbd(source, context) {
  try {
    const payload = await context.http.json(source.endpoint);
    if (typeof payload?.url_japan !== 'string' || !payload.url_japan.trim()) {
      throw new MediaProviderError('N-SFW response did not contain an Osaka media URL.', {
        code: 'INVALID_RESPONSE',
      });
    }

    const parsed = validatedOsakaUrl(payload.url_japan);
    const download = await context.http.expiredCertificateHttpsBuffer(
      parsed.toString(),
      downloadOptions(context),
    );
    return nativeResult(parsed.toString(), download);
  } catch (error) {
    throw providerError(error, PROVIDER);
  }
}

export {
  ABD_MEDIA_HOSTS,
  OSAKA_MEDIA_HOST,
};
