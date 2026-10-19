import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';
import { randomInteger } from '../../lib/random.js';

const MAXIMUM_ID = 39_239;
const MAXIMUM_ATTEMPTS = 4;
const MEDIA_HEADERS = Object.freeze({
  Accept: 'image/*',
  Referer: 'https://porngifs.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
});

const defaultDependencies = Object.freeze({ randomInteger });

// Some IDs in the CDN range are gaps, so a few fresh IDs are tried. Attempts
// stop early when the invocation's time or subrequest budget runs out.
export async function fetchPorngifs(_source, context, dependencies = defaultDependencies) {
  const provider = 'porngifs.com';
  let lastError;
  for (let attempt = 0; attempt < MAXIMUM_ATTEMPTS; attempt += 1) {
    const id = dependencies.randomInteger(1, MAXIMUM_ID);
    const url = ProviderEndpoint.PORNGIFS_MEDIA.replace('{id}', String(id));
    try {
      const download = await context.http.buffer(url, {
        headers: MEDIA_HEADERS,
        allowedHosts: ['cdn.porngifs.com'],
        allowSubdomains: false,
        minimumBytes: 1_025,
        expectImage: true,
      });
      return mediaResult({ provider, id: String(id), url, download });
    } catch (error) {
      lastError = error;
      if (['BUDGET_EXHAUSTED', 'DEADLINE_EXCEEDED', 'ABORTED'].includes(error?.code)) break;
    }
  }
  throw providerError(lastError ?? new MediaProviderError('No valid Porngifs media was found.', {
    code: 'INVALID_RESPONSE',
  }), provider);
}
