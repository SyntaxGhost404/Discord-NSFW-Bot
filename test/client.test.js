import { describe, expect, it } from 'vitest';
import { feedPath, homeState, readFeedState, sameFeed } from '../public/js/feed.js';
import { DEFAULT_PROVIDER, PROVIDERS, providerById, providerByPath, providerTitle } from '../public/js/providers.js';
import { day, photos, RANGE_LABELS, RANGED_SORTS, results, SORT_GROUPS, SORT_LABELS, XH_RANGE_LABELS, XH_RANGED_SORTS, XH_SORT_GROUPS, XH_SORT_LABELS } from '../public/js/text.js';
import { RANGES, SORTS } from '../src/source.js';
import { XH_RANGES, XH_SORTS } from '../src/xh.js';

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

  it('reads the provider with its own sorts and ranges', () => {
    const XH = { provider: 'xh' };
    expect(homeState('xh')).toEqual({ ...XH, q: '', sort: 'best', range: 'all' });
    expect(readFeedState('?provider=xh')).toEqual(homeState('xh'));
    expect(readFeedState('?provider=xh&sort=rated&range=week')).toEqual({ ...XH, q: '', sort: 'rated', range: 'week' });
    // Another provider's sorts and ranges mean nothing here.
    expect(readFeedState('?provider=xh&sort=likes&range=week')).toEqual(homeState('xh'));
    expect(readFeedState('?provider=xh&sort=viewed&range=day')).toEqual({ ...XH, q: '', sort: 'viewed', range: 'all' });
    expect(readFeedState('?provider=xh&sort=newest&range=week')).toEqual({ ...XH, q: '', sort: 'newest', range: 'all' });
    expect(readFeedState('?provider=xh&q=red%20dress&sort=rated')).toEqual({ ...XH, q: 'red dress', sort: 'best', range: 'all' });
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
      homeState('xh'),
      { provider: 'xh', q: '', sort: 'newest', range: 'all' },
      { provider: 'xh', q: '', sort: 'rated', range: 'month' },
      { provider: 'xh', q: 'red dress', sort: 'best', range: 'all' },
    ];
    expect(states.map(feedPath)).toEqual([
      '/', '/?sort=likes&range=month', '/?sort=popular-videos', '/?q=fern+%26+frieren',
      '/?provider=xh', '/?provider=xh&sort=newest', '/?provider=xh&sort=rated&range=month', '/?provider=xh&q=red+dress',
    ]);
    for (const state of states) expect(readFeedState(feedPath(state).slice(1))).toEqual(state);
    expect(sameFeed(states[1], { ...states[1] })).toBe(true);
    expect(sameFeed(states[1], { ...states[1], range: 'day' })).toBe(false);
    expect(sameFeed(homeState(), homeState('xh'))).toBe(false);
  });
});

describe('providers', () => {
  it('starts on Hentai Cosplay, offers xHamster, and names each by its address', () => {
    expect(DEFAULT_PROVIDER).toBe('hcx');
    expect(PROVIDERS.map((provider) => provider.name)).toEqual(['Hentai Cosplay', 'xHamster']);
    expect(new Set(PROVIDERS.map((provider) => provider.id)).size).toBe(PROVIDERS.length);
    expect(providerTitle(providerById('hcx'))).toBe('hentai-cosplay-xxx.com');
    expect(providerTitle(providerById('xh'))).toBe('xhamster.com');
    expect(providerById('nope').id).toBe(DEFAULT_PROVIDER);
  });

  it('gives each provider its own routes, and keeps old album links working', () => {
    expect(PROVIDERS.map((provider) => [provider.id, provider.api, provider.path])).toEqual([['hcx', '/api', ''], ['xh', '/api/xh', '/xh']]);
    expect(providerByPath('/xh').id).toBe('xh');
    expect(providerByPath('')).toBeNull();
    expect(providerByPath('/nope')).toBeNull();
  });

  it('offers xHamster exactly the sorts and ranges the Worker accepts', () => {
    expect(Object.keys(XH_SORT_LABELS).sort()).toEqual(Object.keys(XH_SORTS).sort());
    expect(XH_SORT_GROUPS.flatMap((group) => group.sorts).sort()).toEqual(Object.keys(XH_SORTS).sort());
    expect([...XH_RANGED_SORTS].sort()).toEqual(Object.keys(XH_SORTS).filter((sort) => XH_SORTS[sort].ranked).sort());
    expect(Object.keys(XH_RANGE_LABELS)).toEqual(['all', ...Object.keys(XH_RANGES)]);
    expect(providerById('xh').sortLabels[providerById('xh').defaultSort]).toBe('Best');
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
