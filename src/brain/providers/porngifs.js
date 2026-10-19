import dns from 'node:dns/promises';
import { ProviderEndpoint } from './manifest.js';
import { mediaResult } from './media-result.js';
import { MediaProviderError, providerError } from './errors.js';
import { randomInteger } from '../../lib/random.js';
import { requestHttpsBuffer } from './http.js';

const defaultDependencies = Object.freeze({
  lookup: dns.lookup,
  randomInteger,
  requestHttpsBuffer,
});

function withShutdownSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new MediaProviderError('Provider lookup was cancelled during shutdown.', {
      code: 'ABORTED',
      cause: signal.reason,
    }));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new MediaProviderError('Provider lookup was cancelled during shutdown.', {
      code: 'ABORTED',
      cause: signal.reason,
    }));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export async function fetchPorngifs(_source, context, dependencies = defaultDependencies) {
  const provider = 'porngifs.com';
  try {
    const { address } = await withShutdownSignal(
      dependencies.lookup('porngifs.com'),
      context.signal,
    );
    let lastError;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const id = dependencies.randomInteger(1, 39_239);
      const targetUrl = ProviderEndpoint.PORNGIFS_MEDIA.replace('{id}', String(id));
      try {
        const download = await dependencies.requestHttpsBuffer({
          hostname: address,
          path: `/img/${id}`,
          servername: 'cdn.porngifs.com',
          headers: {
            Host: 'cdn.porngifs.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            Referer: 'https://porngifs.com/',
            Accept: 'image/*',
          },
          timeoutMs: context.config.mediaTimeoutMs,
          maximumBytes: context.maxMediaBytes,
          minimumBytes: 1_025,
          finalUrl: targetUrl,
          ...(context.signal ? { signal: context.signal } : {}),
        });
        return mediaResult({ provider, id: String(id), url: targetUrl, download });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new MediaProviderError('No valid Porngifs media was found.', { code: 'INVALID_RESPONSE' });
  } catch (error) {
    throw providerError(error, provider);
  }
}
