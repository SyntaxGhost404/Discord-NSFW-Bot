import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { SORTS } from '../src/source.js';
import { html, installFetchMock, redirected } from './helpers/fetch-mock.js';
import { IMAGE_HOST, item, listingPage, storyPage, videoPage } from './helpers/pages.js';

const SITE = 'https://hentai-cosplay-xxx.com';
const FOLDER = `${IMAGE_HOST}/upload/20260827/445/454887/`;
const LISTING = listingPage({
  count: 2,
  next: true,
  items: [item({ slug: 'koneko-maru-frieren', title: 'Koneko Maru - Frieren', image: `${FOLDER}p=160x200/31.webp` })],
});

let mock = null;

afterEach(() => {
  mock?.restore();
  mock = null;
});

const get = (path, init) => worker.fetch(new Request(`https://viewer.example${path}`, init), env);

// Answers every request to the source site with `respond` and returns the
// URLs that were asked for.
function site(respond = () => html(LISTING)) {
  mock = installFetchMock([[`${SITE}/*`, respond]]);
  return mock.calls;
}

describe('feed', () => {
  it('reads the newest albums and answers plain JSON', async () => {
    const calls = site();
    const response = await get('/api/feed');
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([`${SITE}/search/`]);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=120');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    const body = await response.json();
    expect(body).toMatchObject({ page: 1, more: true, total: 2 });
    expect(body.items).toEqual([expect.objectContaining({ slug: 'koneko-maru-frieren', title: 'Koneko Maru \u00b7 Frieren' })]);
  });

  it('maps every sort, range, and page to the site', async () => {
    const calls = site();
    for (const sort of Object.keys(SORTS)) expect((await get(`/api/feed?sort=${sort}`)).status).toBe(200);
    expect(calls.map((call) => call.url.slice(SITE.length))).toEqual([
      '/search/', '/ranking/', '/ranking-download/', '/ranking-like/', '/ranking-bookmark/', '/recently/',
      '/recently-download/', '/recently-like/', '/recently-bookmark/', '/search-video/', '/ranking-video/',
    ]);
    calls.length = 0;
    await get('/api/feed?sort=likes&range=week&page=3');
    await get('/api/feed?sort=downloads&range=all&page=2');
    await get('/api/feed?sort=bookmarks&range=day');
    expect(calls.map((call) => call.url.slice(SITE.length))).toEqual([
      '/ranking-like/type/week/page/3/', '/ranking-download/page/2/', '/ranking-bookmark/type/day/',
    ]);
  });

  it('sends the desktop page request the parser expects', async () => {
    const calls = site();
    await get('/api/feed');
    expect(calls[0].headers['user-agent']).toMatch(/Windows NT/);
    expect(calls[0].headers.accept).toContain('text/html');
  });

  it('rejects unknown sorts, ranges, and pages without calling the site', async () => {
    const calls = site();
    const cases = [
      ['/api/feed?sort=https://evil.example/', 'bad_sort'],
      ['/api/feed?sort=__proto__', 'bad_sort'],
      ['/api/feed?sort=recent&range=week', 'bad_range'],
      ['/api/feed?sort=likes&range=decade', 'bad_range'],
      ['/api/feed?page=0', 'bad_page'],
      ['/api/feed?page=5001', 'bad_page'],
      ['/api/feed?page=1.5', 'bad_page'],
      ['/api/feed?page=-2', 'bad_page'],
      ['/api/feed?page=two', 'bad_page'],
    ];
    for (const [path, error] of cases) {
      const response = await get(path);
      expect(response.status, path).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ error });
    }
    expect(calls).toHaveLength(0);
  });

  it('answers an empty list past the last page', async () => {
    site(() => html('Not found', { status: 404 }));
    const response = await get('/api/feed?page=900');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ page: 900, items: [], more: false, total: null });
  });

  it('reports site failures without passing them on', async () => {
    site(() => html('<h1>Server error</h1><script>evil()</script>', { status: 500 }));
    let response = await get('/api/feed');
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream' });

    site(() => redirected(html(LISTING), 'https://evil.example/search/'));
    response = await get('/api/feed');
    expect(response.status).toBe(502);

    site(() => {
      throw new TypeError('Network connection lost.');
    });
    response = await get('/api/feed');
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'unreachable' });

    site(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    expect(await (await get('/api/feed')).json()).toEqual({ error: 'timeout' });
  });
});

describe('search', () => {
  it('searches by keyword the way the site\'s own form does', async () => {
    const calls = site();
    const response = await get(`/api/search?q=${encodeURIComponent('  Fern \n &  Frieren ')}&page=2`);
    expect(response.status).toBe(200);
    expect(calls[0].url).toBe(`${SITE}/search/keyword/Fern+%26+Frieren/page/2/`);
  });

  it('keeps queries short and refuses empty ones', async () => {
    const calls = site();
    await get(`/api/search?q=${'a'.repeat(200)}`);
    expect(calls[0].url).toBe(`${SITE}/search/keyword/${'a'.repeat(80)}/`);
    expect((await get('/api/search?q=%20%20')).status).toBe(400);
    expect((await get('/api/search')).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('answers an empty list when nothing matches', async () => {
    site(() => html(listingPage({ title: 'zzqq Search Results', main: false })));
    expect(await (await get('/api/search?q=zzqq')).json()).toEqual({ page: 1, items: [], more: false, total: null });
  });
});

describe('album and video', () => {
  it('returns every photo of an album from its story page', async () => {
    const calls = site(() => html(storyPage({ title: 'Koneko Maru - Frieren', poster: `${FOLDER}1.webp`, images: [`${FOLDER}1.webp`, `${FOLDER}2.webp`] })));
    const response = await get('/api/album/koneko-maru-frieren');
    expect(calls[0].url).toBe(`${SITE}/story/koneko-maru-frieren/`);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(await response.json()).toEqual({ slug: 'koneko-maru-frieren', title: 'Koneko Maru \u00b7 Frieren', base: FOLDER, files: ['1.webp', '2.webp'] });
  });

  it('returns a video\'s stream and poster', async () => {
    const stream = 'https://video16.videos-uploader.com/video/2026/1022/rLNoAx/video.m3u8';
    const calls = site(() => html(videoPage({ title: 'Cosplay 888', stream })));
    expect(await (await get('/api/video/cosplay-888')).json()).toEqual({ slug: 'cosplay-888', title: 'Cosplay 888', poster: null, stream });
    expect(calls[0].url).toBe(`${SITE}/video/cosplay-888/`);
  });

  it('answers 404 for pages without an album or video', async () => {
    site(() => html('<html><body>Removed</body></html>'));
    expect((await get('/api/album/removed')).status).toBe(404);
    expect((await get('/api/video/removed')).status).toBe(404);
    site(() => html('Not found', { status: 404 }));
    expect(await (await get('/api/album/missing')).json()).toEqual({ error: 'not_found' });
  });

  it('accepts only plain slugs', async () => {
    const calls = site();
    for (const slug of ['UPPER', 'a%2Fb', 'a.b', 'a%20b', 'x'.repeat(321)]) {
      expect((await get(`/api/album/${slug}`)).status, slug).toBe(400);
    }
    // Dot segments are resolved before routing, so these never name an album.
    for (const path of ['/api/album/a/b', '/api/album/..', '/api/album/%2e%2e']) {
      expect((await get(path)).status, path).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('routing', () => {
  it('allows only GET and HEAD on the API', async () => {
    site();
    const response = await get('/api/feed', { method: 'POST', body: 'x' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect((await get('/api/feed', { method: 'HEAD' })).status).toBe(200);
  });

  it('answers 404 JSON for unknown API paths', async () => {
    site();
    const response = await get('/api/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('serves the app for every other path', async () => {
    const response = await get('/album/koneko-maru-frieren');
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('<div id="app"></div>');
    expect(page).toContain('<script type="module" src="/js/app.js"></script>');
  });
});
