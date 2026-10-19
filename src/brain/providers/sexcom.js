import { ProviderEndpoint, SexComNiches } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';
import { choose, randomInteger } from '../../lib/random.js';

export async function fetchSexCom(source, context) {
  const provider = 'sex.com';
  const niche = source.niche || choose(source.niches || SexComNiches);
  try {
    const payload = await context.http.json(ProviderEndpoint.SEX_COM_SEARCH, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      query: {
        'sexual-orientation': 'straight',
        order: 'likeCount',
        search: niche,
        page: randomInteger(1, 10),
        limit: 40,
      },
    });
    const item = choose(payload?.data ?? []);
    if (!item?.uri) throw new MediaProviderError('Sex.com response did not contain a media URI.', { code: 'INVALID_RESPONSE' });
    const uri = item.uri.endsWith('.webp') ? `${item.uri.slice(0, -5)}.gif` : item.uri;
    const url = `${ProviderEndpoint.SEX_COM_CDN.replace('{uri}', '')}${uri}`;
    return mediaResult({
      provider,
      id: item.id,
      url,
      watchUrl: ProviderEndpoint.SEX_COM_WATCH.replace('{id}', String(item.id)),
    });
  } catch (error) {
    throw providerError(error, provider);
  }
}
