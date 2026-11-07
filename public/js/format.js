// Dates in the visitor's own language and time zone.

const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'medium' });
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS = [['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]];

export const dateTime = (ms) => DATE_TIME.format(new Date(ms));

// "3 years ago", in whole units, never rounded up.
export function ago(ms, now = Date.now()) {
  const seconds = (ms - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') return RELATIVE.format(Math.trunc(seconds / size), unit);
  }
  return '';
}
