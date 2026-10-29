import { fetchAbd } from './abd.js';
import { fetchAhottie } from './ahottie.js';
import { fetchHentaiCosplayXxx } from './hentai-cosplay-xxx.js';
import { fetchNekoBot } from './nekobot.js';
import { fetchNekosV4 } from './nekos-v4.js';
import { fetchOBoobs, fetchOButts } from './obru.js';
import { fetchPornPics } from './pornpics.js';
import { fetchPorngifs } from './porngifs.js';
import { fetchPorngifsTv } from './porngifs-tv.js';
import { fetchPurrbot } from './purrbot.js';
import { fetchSexCom } from './sexcom.js';
import { fetchWaifuArchive } from './waifu-archive.js';
import { fetchWaifuPics } from './waifu-pics.js';
import { MediaProviderError } from './errors.js';

// Providers that are dead stay off unless their variable is "true":
// WAIFU_PICS for Waifu.pics and AHOTTIE for Ahottie. A source whose provider
// is off is skipped before any request.
const SWITCHED_PROVIDERS = Object.freeze({
  ahottie: 'ahottieEnabled',
  waifupics: 'waifuPicsEnabled',
});

export function providerEnabled(provider, config) {
  const flag = SWITCHED_PROVIDERS[provider];
  return !flag || config?.[flag] === true;
}

const providers = Object.freeze({
  abd: fetchAbd,
  ahottie: fetchAhottie,
  hentaicosplayxxx: fetchHentaiCosplayXxx,
  nekobot: fetchNekoBot,
  nekosv4: fetchNekosV4,
  oboobs: fetchOBoobs,
  obutts: fetchOButts,
  pornpics: fetchPornPics,
  porngifs: fetchPorngifs,
  porngifstv: fetchPorngifsTv,
  purrbot: fetchPurrbot,
  sexcom: fetchSexCom,
  waifuarchive: fetchWaifuArchive,
  waifupics: fetchWaifuPics,
});

export async function fetchMedia(source, context) {
  const fetcher = providers[source.provider];
  if (!fetcher) {
    throw new MediaProviderError(`Unknown media provider: ${source.provider}`, {
      code: 'UNKNOWN_PROVIDER',
      provider: source.provider,
    });
  }
  const permit = context.circuitBreaker?.acquire(source.provider);
  try {
    const result = await fetcher(source, context);
    if (permit) context.circuitBreaker.success(permit);
    return result;
  } catch (error) {
    if (permit) context.circuitBreaker.failure(permit, error);
    throw error;
  }
}

export const providerNames = Object.freeze(Object.keys(providers));
