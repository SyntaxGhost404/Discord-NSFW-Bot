import { describe, expect, it } from 'vitest';
import { feedPath, readFeedState, sameFeed } from '../public/js/feed.js';
import { day, photos, RANGE_LABELS, RANGED_SORTS, results, SORT_GROUPS, SORT_LABELS } from '../public/js/text.js';
import { RANGES, SORTS } from '../src/source.js';

describe('feed address', () => {
  it('reads the sort, range, and search from the address', () => {
    expect(readFeedState('')).toEqual({ q: '', sort: 'recent', range: 'all' });
    expect(readFeedState('?sort=likes&range=week')).toEqual({ q: '', sort: 'likes', range: 'week' });
    expect(readFeedState('?sort=popular&range=week')).toEqual({ q: '', sort: 'popular', range: 'all' });
    expect(readFeedState('?sort=nope&range=decade')).toEqual({ q: '', sort: 'recent', range: 'all' });
    expect(readFeedState('?sort=__proto__')).toEqual({ q: '', sort: 'recent', range: 'all' });
    expect(readFeedState('?q=%20%20fern%20%20frieren%20&sort=likes')).toEqual({ q: 'fern frieren', sort: 'recent', range: 'all' });
    expect(readFeedState(`?q=${'a'.repeat(200)}`).q).toHaveLength(80);
  });

  it('writes the shortest address and reads it back', () => {
    const states = [
      { q: '', sort: 'recent', range: 'all' },
      { q: '', sort: 'likes', range: 'month' },
      { q: '', sort: 'popular-videos', range: 'all' },
      { q: 'fern & frieren', sort: 'recent', range: 'all' },
    ];
    expect(states.map(feedPath)).toEqual(['/', '/?sort=likes&range=month', '/?sort=popular-videos', '/?q=fern+%26+frieren']);
    for (const state of states) expect(readFeedState(feedPath(state).slice(1))).toEqual(state);
    expect(sameFeed(states[1], { ...states[1] })).toBe(true);
    expect(sameFeed(states[1], { ...states[1], range: 'day' })).toBe(false);
  });
});

describe('sort options', () => {
  it('match the sorts and ranges the Worker accepts', () => {
    expect(Object.keys(SORT_LABELS).sort()).toEqual(Object.keys(SORTS).sort());
    expect(SORT_GROUPS.flatMap((group) => group.sorts).sort()).toEqual(Object.keys(SORTS).sort());
    expect([...RANGED_SORTS].sort()).toEqual(Object.keys(SORTS).filter((sort) => SORTS[sort].ranged).sort());
    expect(Object.keys(RANGE_LABELS)).toEqual(['all', ...RANGES]);
  });
});

describe('copy helpers', () => {
  it('formats counts and dates', () => {
    expect(photos(1)).toBe('1 photo');
    expect(photos(1626)).toBe(`${(1626).toLocaleString()} photos`);
    expect(results(0)).toBe('0 results');
    const expected = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2026, 9, 30));
    expect(day('2026-10-30')).toBe(expected);
    expect(day('')).toBe('');
    expect(day('not-a-date')).toBe('');
  });
});
