import { describe, expect, it } from 'vitest';
import { listOutcome, problem, searchable } from '../public/js/notices.js';
import { NOTICE } from '../public/js/text.js';

describe('problem', () => {
  it('names the failure and offers to try again only where that can help', () => {
    expect(problem({ code: 'offline' })).toEqual({ ...NOTICE.errors.offline, retry: true });
    expect(problem({ code: 'blocked' })).toEqual({ ...NOTICE.errors.blocked, retry: true });
    expect(problem({ code: 'timeout' }, 'video')).toEqual({ ...NOTICE.errors.timeout, retry: true });
    expect(problem({ code: 'unreadable' }, 'album')).toEqual({ ...NOTICE.errors.unreadable, retry: true });
  });

  it('says a removed album or video is gone, with nothing to retry', () => {
    expect(problem({ code: 'not_found' }, 'album')).toEqual({ ...NOTICE.gone.album, retry: false });
    expect(problem({ code: 'not_found' }, 'video')).toEqual({ ...NOTICE.gone.video, retry: false });
    expect(problem({ code: 'bad_slug' }, 'album')).toEqual({ ...NOTICE.invalid, retry: false });
  });

  it('treats a failure it has no name for as one that may pass', () => {
    expect(problem({ code: 'something_new' })).toEqual({ ...NOTICE.errors.server, retry: true });
    expect(problem(new Error('plain'))).toEqual({ ...NOTICE.errors.server, retry: true });
    expect(problem(null)).toEqual({ ...NOTICE.errors.server, retry: true });
  });
});

describe('listOutcome', () => {
  it('says the site refused a search, with a hint that fits the query', () => {
    expect(listOutcome('refused', { q: 'Hane Ame' })).toEqual({ title: NOTICE.search.refused('Hane Ame'), hint: NOTICE.search.fewerOrDifferent, retry: false });
    expect(listOutcome('refused', { q: 'Hane' }).hint).toBe(NOTICE.search.different);
  });

  it('explains a search without results by what was typed', () => {
    expect(listOutcome('empty', { q: 'Z' })).toEqual({ title: NOTICE.search.empty('Z'), hint: NOTICE.search.longer, retry: false });
    expect(listOutcome('empty', { q: 'C++' }).hint).toBe(NOTICE.search.symbols);
    expect(listOutcome('empty', { q: '100%' }).hint).toBe(NOTICE.search.symbols);
    expect(listOutcome('empty', { q: 'fern frieren' }).hint).toBe(NOTICE.search.fewer);
    expect(listOutcome('empty', { q: 'frieren' }).hint).toBe(NOTICE.search.spelling);
    expect(listOutcome('empty', { q: 're:zero' }).hint).toBe(NOTICE.search.spelling);
    expect(listOutcome('empty', { q: '猫' }).hint).toBe(NOTICE.search.spelling);
    expect(listOutcome('nothing', { q: '!!!' })).toEqual({ ...NOTICE.search.nothing, retry: false });
  });

  it('explains an empty sort or ranking in its own terms', () => {
    expect(listOutcome('empty', { sort: 'likes', range: 'day' })).toEqual({ title: NOTICE.feed.ranged('today'), hint: NOTICE.feed.longerRange, retry: false });
    expect(listOutcome('empty', { sort: 'downloads', range: 'year' }).title).toBe(NOTICE.feed.ranged('this year'));
    expect(listOutcome('empty', { sort: 'popular-videos' })).toEqual({ ...NOTICE.feed.noVideos, retry: false });
    expect(listOutcome('empty', { sort: 'recent' })).toEqual({ ...NOTICE.feed.empty, retry: false });
    expect(listOutcome('missing', { sort: 'likes' })).toEqual({ ...NOTICE.feed.missing, retry: true });
  });

  it('says a provider without a source is not connected, with nothing to retry', () => {
    expect(listOutcome('unconnected', { sort: 'recent' })).toEqual({ ...NOTICE.provider.unconnected, retry: false });
  });

  it('offers to read a page again when it could not be read', () => {
    expect(listOutcome('unreadable', { q: 'frieren' })).toEqual({ ...NOTICE.errors.unreadable, retry: true });
    expect(listOutcome('unreadable')).toEqual({ ...NOTICE.errors.unreadable, retry: true });
  });
});

describe('searchable', () => {
  it('needs a letter or a number in any script', () => {
    expect(['!!!', '?', '  ', '#+%'].map(searchable)).toEqual([false, false, false, false]);
    expect(['2b', 'a', '女仆', 'メイド', '메이드', 'Hane Ame'].map(searchable)).toEqual([true, true, true, true, true, true]);
  });
});
