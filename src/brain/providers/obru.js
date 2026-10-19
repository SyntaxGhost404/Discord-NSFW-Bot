import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';

async function fetchRussianMedia(kind, source, context) {
  const isBoobs = kind === 'boobs';
  const provider = isBoobs ? 'oboobs.ru' : 'obutts.ru';
  try {
    const id = source.id;
    const endpoint = id !== undefined && id !== null && Number.isFinite(Number(id))
      ? (isBoobs ? ProviderEndpoint.OBOOBS_BY_ID : ProviderEndpoint.OBUTTS_BY_ID).replace('{id}', String(id))
      : (isBoobs ? ProviderEndpoint.OBOOBS_RANDOM : ProviderEndpoint.OBUTTS_RANDOM);
    const payload = await context.http.json(endpoint);
    const item = Array.isArray(payload) ? payload[0] : null;
    if (!item?.preview) throw new MediaProviderError(`${provider} response did not contain preview media.`, { code: 'INVALID_RESPONSE' });
    const template = isBoobs ? ProviderEndpoint.OBOOBS_MEDIA : ProviderEndpoint.OBUTTS_MEDIA;
    return mediaResult({
      provider,
      id: item.id,
      url: template.replace('{preview}', item.preview),
    });
  } catch (error) {
    throw providerError(error, provider);
  }
}

export function fetchOBoobs(source, context) {
  return fetchRussianMedia('boobs', source, context);
}

export function fetchOButts(source, context) {
  return fetchRussianMedia('butts', source, context);
}
