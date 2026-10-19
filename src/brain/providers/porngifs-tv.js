import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';
import { choose, randomInteger } from '../../lib/random.js';

const MAXIMUM_PAGE = 2_603;
const MAXIMUM_ATTEMPTS = 3;
const FEED_HEADERS = Object.freeze({
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
});
// The feed mixes WebM clips into `data-webp`; only formats that Discord can
// show inside an embed are kept.
const PREVIEW_PATTERN = /data-webp=["']([^"']+\.(?:webp|gif)(?:\?[^"']*)?)["']/gi;

const defaultDependencies = Object.freeze({ choose, randomInteger });

export function extractPorngifsTvMedia(html) {
  return [...String(html).matchAll(PREVIEW_PATTERN)].map((match) => match[1]);
}

export async function fetchPorngifsTv(_source, context, dependencies = defaultDependencies) {
  const provider = 'porngifs.tv';
  let lastError;
  for (let attempt = 0; attempt < MAXIMUM_ATTEMPTS; attempt += 1) {
    const page = dependencies.randomInteger(1, MAXIMUM_PAGE);
    const endpoint = ProviderEndpoint.PORNGIFS_TV.replace('{page}', String(page));
    try {
      const html = await context.http.text(endpoint, {
        headers: FEED_HEADERS,
        allowedHosts: ['porngifs.tv'],
      });
      const url = dependencies.choose(extractPorngifsTvMedia(html));
      if (!url) {
        throw new MediaProviderError('Porngifs.tv page did not contain WebP or GIF media.', { code: 'INVALID_RESPONSE' });
      }
      const download = await context.http.buffer(url, {
        minimumBytes: 1_025,
        allowedHosts: ['porngifs.tv'],
        expectImage: true,
      });
      return mediaResult({ provider, id: String(page), url, download });
    } catch (error) {
      lastError = error;
      if (['BUDGET_EXHAUSTED', 'DEADLINE_EXCEEDED', 'ABORTED'].includes(error?.code)) break;
    }
  }
  throw providerError(lastError ?? new MediaProviderError('No valid Porngifs.tv media was found.', {
    code: 'INVALID_RESPONSE',
  }), provider);
}
