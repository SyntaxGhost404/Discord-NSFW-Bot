import { randomInt } from 'node:crypto';

export function choose(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[randomInt(items.length)];
}

export function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function randomColor() {
  return randomInt(0x1000000);
}

export function randomInteger(minimum, maximum) {
  return randomInt(minimum, maximum + 1);
}
