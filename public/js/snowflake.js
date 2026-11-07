// Discord IDs are snowflakes: 64-bit numbers sent as strings. The top 42 bits
// are milliseconds since the Discord epoch (the first second of 2015), then
// 5 bits of internal worker ID, 5 bits of internal process ID, and a 12-bit
// increment. Used by the page and the Worker alike.

export const DISCORD_EPOCH = 1_420_070_400_000;
// An ID may be a little ahead of this clock.
const CLOCK_SKEW_MS = 5 * 60_000;
const LARGEST = (1n << 64n) - 1n;

export function snowflakeParts(id) {
  const value = BigInt(id);
  return {
    timestamp: Number(value >> 22n) + DISCORD_EPOCH,
    worker: Number((value & 0x3e0000n) >> 17n),
    process: Number((value & 0x1f000n) >> 12n),
    increment: Number(value & 0xfffn),
  };
}

// Reads what someone typed or pasted: spaces are dropped, and a mention like
// <@80351110224678912> gives its ID. Returns { id } or { error }, where the
// error is 'empty', 'format', 'large', or 'future'.
export function readId(text, now = Date.now()) {
  const value = String(text ?? '').replace(/\s+/g, '').replace(/^<@!?(\d+)>$/, '$1');
  if (value === '') return { error: 'empty' };
  if (!/^\d{15,20}$/.test(value)) return { error: 'format' };
  if (BigInt(value) > LARGEST) return { error: 'large' };
  if (snowflakeParts(value).timestamp > now + CLOCK_SKEW_MS) return { error: 'future' };
  return { id: BigInt(value).toString() };
}
