import { describe, expect, it } from 'vitest';
import { feedPath, homeState, readFeedState, sameFeed } from '../public/js/feed.js';
import { DEFAULT_PROVIDER, PROVIDERS, providerById, providerTitle } from '../public/js/providers.js';
import { day, photos, RANGE_LABELS, RANGED_SORTS, results, SORT_GROUPS, SORT_LABELS } from '../public/js/text.js';
import { RANGES, SORTS } from '../src/source.js';

const HCX = { provider: 'hcx' };

describe('feed address', () => {
  it('reads the sort, range, and search from the address', () => {
    expect(readFeedState('')).toEqual({ ...HCX, q: '', sort: 'recent', range: 'all' });
    expect(readFeedState('?sort=likes&range=week')).toEqual({ ...HCX, q: '', sort: 'likes', range: 'week' });
    expect(readFeedState('?sort=popular&range=week')).toEqual({ ...HCX, q: '', sort: 'popular', range: 'all' });
    expect(readFeedState('?sort=nope&range=decade')).toEqual({ ...HCX, q: '', sort: 'recent', range: 'all' });
    expect(readFeedState('?sort=__proto__')).toEqual({ ...HCX, q: '', sort: 'recent', range: 'all' });
    expect(readFeedState('?q=%20%20fern%20%20frieren%20&sort=likes')).toEqual({ ...HCX, q: 'fern frieren', sort: 'recent', range: 'all' });
    expect(readFeedState(`?q=${'a'.repeat(200)}`).q).toHaveLength(80);
  });

  it('reads the provider, and ignores sorts and searches for one without a source', () => {
    expect(readFeedState('?provider=placeholder')).toEqual(homeState('placeholder'));
    expect(readFeedState('?provider=placeholder&sort=likes&range=week&q=fern')).toEqual(homeState('placeholder'));
    expect(readFeedState('?provider=hcx&sort=likes')).toEqual({ ...HCX, q: '', sort: 'likes', range: 'all' });
    expect(readFeedState('?provider=nope')).toEqual(homeState());
    expect(readFeedState('?provider=__proto__')).toEqual(homeState());
  });

  it('writes the shortest address and reads it back', () => {
    const states = [
      { ...HCX, q: '', sort: 'recent', range: 'all' },
      { ...HCX, q: '', sort: 'likes', range: 'month' },
      { ...HCX, q: '', sort: 'popular-videos', range: 'all' },
      { ...HCX, q: 'fern & frieren', sort: 'recent', range: 'all' },
      homeState('placeholder'),
    ];
    expect(states.map(feedPath)).toEqual(['/', '/?sort=likes&range=month', '/?sort=popular-videos', '/?q=fern+%26+frieren', '/?provider=placeholder']);
    for (const state of states) expect(readFeedState(feedPath(state).slice(1))).toEqual(state);
    expect(sameFeed(states[1], { ...states[1] })).toBe(true);
    expect(sameFeed(states[1], { ...states[1], range: 'day' })).toBe(false);
    expect(sameFeed(homeState(), homeState('placeholder'))).toBe(false);
  });
});

describe('providers', () => {
  it('starts on Hentai Cosplay and names it by its address in the header', () => {
    expect(DEFAULT_PROVIDER).toBe('hcx');
    expect(PROVIDERS.map((provider) => provider.name)).toEqual(['Hentai Cosplay', 'Placeholder']);
    expect(new Set(PROVIDERS.map((provider) => provider.id)).size).toBe(PROVIDERS.length);
    expect(providerTitle(providerById('hcx'))).toBe('hentai-cosplay-xxx.com');
    expect(providerTitle(providerById('placeholder'))).toBe('Placeholder');
    expect(providerById('nope').id).toBe(DEFAULT_PROVIDER);
  });

  it('has a source only for the default provider so far', () => {
    expect(PROVIDERS.filter((provider) => provider.connected).map((provider) => provider.id)).toEqual(['hcx']);
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
