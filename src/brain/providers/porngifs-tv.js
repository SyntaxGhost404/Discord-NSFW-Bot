import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';
import { choose, randomInteger } from '../../lib/random.js';

export async function fetchPorngifsTv(_source, context) {
  const provider = 'porngifs.tv';
  let lastError;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const page = randomInteger(1, 2_603);
    const endpoint = ProviderEndpoint.PORNGIFS_TV.replace('{page}', String(page));
    try {
      const html = await context.http.text(endpoint, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });
      const urls = [...html.matchAll(/data-webp=["']([^"']+\.(?:webp|gif)(?:\?[^"']*)?)["']/gi)]
        .map((match) => match[1]);
      const url = choose(urls);
      if (!url) throw new MediaProviderError('Porngifs.tv page did not contain WebP or GIF media.', { code: 'INVALID_RESPONSE' });
      const download = await context.http.buffer(url, {
        minimumBytes: 1_025,
        allowedHosts: ['porngifs.tv'],
      });
      return mediaResult({ provider, id: String(page), url, download });
    } catch (error) {
      lastError = error;
    }
  }
  throw providerError(lastError || new MediaProviderError('No valid Porngifs.tv media was found.'), provider);
}
