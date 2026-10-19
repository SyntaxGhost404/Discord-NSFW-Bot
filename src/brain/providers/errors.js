export class MediaProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', provider, cause, status, retryAt } = {}) {
    super(message, { cause });
    this.name = 'MediaProviderError';
    this.code = code;
    this.provider = provider;
    this.status = status;
    this.retryAt = retryAt;
  }
}

export function providerError(error, provider) {
  if (error instanceof MediaProviderError) {
    if (!error.provider) error.provider = provider;
    return error;
  }
  return new MediaProviderError(error?.message || 'Media provider failed.', {
    code: error?.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_ERROR',
    provider,
    cause: error,
  });
}
