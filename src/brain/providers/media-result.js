const MIME_EXTENSION = Object.freeze({
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
});

export function extensionFor(url, contentType, fallback = 'gif') {
  const mimeExtension = MIME_EXTENSION[contentType?.toLowerCase()];
  if (mimeExtension) return mimeExtension;
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    // The fallback is used for malformed provider URLs.
  }
  return fallback;
}

export function mediaResult({ provider, url, watchUrl = url, id, download }) {
  if (!url) return null;
  if (!download) return { provider, url, watchUrl, id };
  const extension = extensionFor(url, download.contentType);
  return {
    provider,
    url,
    watchUrl,
    id,
    buffer: download.buffer,
    contentType: download.contentType,
    fileName: `media.${extension}`,
  };
}
