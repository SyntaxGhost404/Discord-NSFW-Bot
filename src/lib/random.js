const UINT32_RANGE = 2 ** 32;

// Uniform integer in [0, limit) from Web Crypto, using rejection sampling so
// no value is favoured when 2^32 is not a multiple of the limit.
function randomBelow(limit) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > UINT32_RANGE) {
    throw new RangeError(`Random limit must be an integer from 1 to ${UINT32_RANGE}.`);
  }
  const ceiling = UINT32_RANGE - (UINT32_RANGE % limit);
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < ceiling) return buffer[0] % limit;
  }
}

export function choose(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[randomBelow(items.length)];
}

export function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomBelow(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function randomColor() {
  return randomBelow(0x1000000);
}

export function randomInteger(minimum, maximum) {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
    throw new RangeError('randomInteger requires an integer range with maximum >= minimum.');
  }
  return minimum + randomBelow(maximum - minimum + 1);
}

export function randomFraction() {
  return randomBelow(UINT32_RANGE) / UINT32_RANGE;
}
