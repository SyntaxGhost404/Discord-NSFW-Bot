const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/i;
const encoder = new TextEncoder();
const keyCache = new Map();

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function verificationKey(publicKeyHex) {
  let key = keyCache.get(publicKeyHex);
  if (!key) {
    key = crypto.subtle.importKey('raw', hexToBytes(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
    // A failed import must not poison the cache for later requests.
    key.catch(() => keyCache.delete(publicKeyHex));
    keyCache.set(publicKeyHex, key);
  }
  return key;
}

// Verifies Discord's Ed25519 signature over the exact timestamp + raw body
// bytes. Returns the decoded body only when the signature is valid.
export async function verifyDiscordRequest(request, publicKeyHex) {
  const signature = request.headers.get('X-Signature-Ed25519') ?? '';
  const timestamp = request.headers.get('X-Signature-Timestamp') ?? '';
  const body = new Uint8Array(await request.arrayBuffer());
  if (!SIGNATURE_PATTERN.test(signature) || !timestamp) return { valid: false, body: null };

  const timestampBytes = encoder.encode(timestamp);
  const message = new Uint8Array(timestampBytes.length + body.length);
  message.set(timestampBytes, 0);
  message.set(body, timestampBytes.length);

  let valid = false;
  try {
    valid = await crypto.subtle.verify({ name: 'Ed25519' }, await verificationKey(publicKeyHex), hexToBytes(signature), message);
  } catch {
    valid = false;
  }
  return { valid, body: valid ? new TextDecoder().decode(body) : null };
}
