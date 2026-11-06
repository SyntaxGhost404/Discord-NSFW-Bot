import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { parseXhGallery, parseXhList, readInitials, XH_SORTS } from '../src/xh.js';
import { html, installFetchMock, redirected } from './helpers/fetch-mock.js';
import { XH_IMAGE, xhGallery, xhGalleryPage, xhListPage, xhPhoto, xhRanked, xhSearchPage, xhTopPage } from './helpers/xh-pages.js';

const SITE = 'https://xhamster.com';
const LIST = xhListPage({ items: [xhGallery({ id: 101, title: 'First gallery', count: 16 }), xhGallery({ id: 102, title: 'Second gallery' })], last: 3 });

let mock = null;

afterEach(() => {
  mock?.restore();
  mock = null;
});

const get = (path) => worker.fetch(new Request(`https://viewer.example${path}`), env);

function site(respond = () => html(LIST)) {
  mock = installFetchMock([[`${SITE}/*`, respond]]);
  return mock.calls;
}

describe('xHamster lists', () => {
  it('reads Best with the largest covers the site serves, as plain JSON', async () => {
    const calls = site();
    const response = await get('/api/xh/feed');
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([`${SITE}/photos`]);
    expect(calls[0].headers['user-agent']).toBe('Mozilla/5.0 (compatible; personal photo viewer)');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=120');
    expect(await response.json()).toEqual({
      page: 1,
      more: true,
      total: null,
      state: 'ok',
      limited: false,
      items: [
        { kind: 'album', slug: 'first-gallery-101', title: 'First gallery', date: null, count: 16, cover: { large: `${XH_IMAGE}/101_1000.jpg` } },
        { kind: 'album', slug: 'second-gallery-102', title: 'Second gallery', date: null, count: 12, cover: { large: `${XH_IMAGE}/102_1000.jpg` } },
      ],
    });
  });

  it('maps every sort, range, and page to the straight photo section', async () => {
    const calls = site();
    for (const sort of Object.keys(XH_SORTS)) expect((await get(`/api/xh/feed?sort=${sort}`)).status).toBe(200);
    await get('/api/xh/feed?sort=best&page=2');
    await get('/api/xh/feed?sort=newest&page=3');
    await get('/api/xh/feed?sort=rated&range=week');
    await get('/api/xh/feed?sort=viewed&range=month');
    await get('/api/xh/feed?sort=commented&range=all');
    expect(calls.map((call) => call.url.slice(SITE.length))).toEqual([
      '/photos', '/photos/newest', '/photos/top/rated', '/photos/top/viewed', '/photos/top/commented',
      '/photos/2', '/photos/newest/3', '/photos/top/rated/weekly', '/photos/top/viewed/monthly', '/photos/top/commented',
    ]);
  });

  it('ends a Top list after its one page without asking the site', async () => {
    const calls = site();
    expect(await (await get('/api/xh/feed?sort=rated&range=week&page=2')).json()).toEqual({ page: 2, items: [], more: false, total: null, state: 'end', limited: false });
    expect(calls).toHaveLength(0);
  });

  it('rejects unknown sorts, ranges, and pages without calling the site', async () => {
    const calls = site();
    const cases = [
      ['/api/xh/feed?sort=likes', 'bad_sort'],
      ['/api/xh/feed?sort=__proto__', 'bad_sort'],
      ['/api/xh/feed?sort=best&range=week', 'bad_range'],
      ['/api/xh/feed?sort=rated&range=day', 'bad_range'],
      ['/api/xh/feed?sort=rated&range=year', 'bad_range'],
      ['/api/xh/feed?page=0', 'bad_page'],
      ['/api/xh/search?q=%20', 'bad_query'],
    ];
    for (const [path, error] of cases) {
      const response = await get(path);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ error });
    }
    expect((await get('/api/xh/unknown')).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('leaves out galleries that would not open, and images from anywhere else', async () => {
    site(() => html(xhListPage({
      items: [
        xhGallery({ id: 1, title: 'Shown' }),
        xhGallery({ id: 2, title: 'Private', isPublic: false }),
        xhGallery({ id: 3, title: 'Blocked here', isGeoBlocked: true }),
        { ...xhGallery({ id: 4, title: 'Elsewhere' }), link: 'https://evil.example/photos/gallery/elsewhere-4' },
        xhGallery({ id: 5, title: 'Odd cover', image: 'https://evil.example/5_1000.jpg' }),
      ],
    })));
    const { items, state } = await (await get('/api/xh/feed')).json();
    expect(state).toBe('ok');
    expect(items.map((item) => [item.slug, item.cover])).toEqual([['shown-1', { large: `${XH_IMAGE}/1_1000.jpg` }], ['odd-cover-5', null]]);
  });

  it('shows each ranked photo as its gallery, once', async () => {
    site(() => html(xhTopPage({ photos: [xhRanked({ id: 11, galleryId: 7, alt: 'Seven' }), xhRanked({ id: 12, galleryId: 8 }), xhRanked({ id: 13, galleryId: 7, alt: 'Seven' })] })));
    const body = await (await get('/api/xh/feed?sort=rated&range=week')).json();
    expect(body).toMatchObject({ state: 'ok', more: false });
    expect(body.items).toEqual([
      { kind: 'album', slug: '7', title: 'Seven', date: null, count: null, cover: { large: `${XH_IMAGE}/11_1000.jpg` } },
      { kind: 'album', slug: '8', title: 'Gallery 8', date: null, count: null, cover: { large: `${XH_IMAGE}/12_1000.jpg` } },
    ]);
  });

  it('cleans titles the way the rest of the viewer does', async () => {
    const dash = String.fromCharCode(0x2014);
    site(() => html(xhListPage({ items: [xhGallery({ id: 9, title: `Red  dress ${dash} part 2` })] })));
    const { items } = await (await get('/api/xh/feed')).json();
    expect(items[0].title).toBe('Red dress · part 2');
  });

  it('passes on the status xHamster refused with', async () => {
    site(() => html('Bad request', { status: 400 }));
    const response = await get('/api/xh/feed');
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream', upstream: 400 });
  });

  it('says when a page is past the end, missing, or cannot be read', async () => {
    site(() => html('Not found', { status: 404 }));
    expect(await (await get('/api/xh/feed?page=2000')).json()).toMatchObject({ state: 'end', items: [] });
    expect(await (await get('/api/xh/feed')).json()).toMatchObject({ state: 'missing' });
    site(() => html('<html><body>No data</body></html>'));
    const response = await get('/api/xh/feed');
    expect(await response.json()).toMatchObject({ state: 'unreadable', items: [] });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('xHamster search', () => {
  it('searches the way the site\'s own form does, with its total', async () => {
    const calls = site(() => html(xhSearchPage({ items: [xhGallery({ id: 21, title: 'Red dress' })], pages: 16, summary: '865 Results' })));
    const response = await get(`/api/xh/search?q=${encodeURIComponent('  Red \n dress ')}`);
    expect(calls[0].url).toBe(`${SITE}/photos/search/Red+dress`);
    expect(await response.json()).toMatchObject({ state: 'ok', more: true, total: 865, items: [{ slug: 'red-dress-21', title: 'Red dress', count: 12 }] });
    await get('/api/xh/search?q=red&page=3');
    expect(calls[1].url).toBe(`${SITE}/photos/search/red?page=3`);
  });

  it('answers a search without results as empty, the way the site means it', async () => {
    site(() => html('Not found', { status: 404 }));
    expect(await (await get('/api/xh/search?q=qqzzxx')).json()).toEqual({ page: 1, items: [], more: false, total: 0, state: 'empty', limited: false });
    expect(await (await get('/api/xh/search?q=red&page=17')).json()).toMatchObject({ state: 'end', total: null });
  });
});

describe('xHamster galleries', () => {
  const KEY = 'blonde-in-a-red-dress-16612090';
  const FIRST = xhGalleryPage({
    key: KEY,
    title: 'Blonde in a red dress',
    count: 97,
    pages: 2,
    photos: [xhPhoto(1), xhPhoto(2, { width: 1333, height: 2000 }), xhPhoto(3, { src: 'https://evil.example/3_1000.jpg' }), xhPhoto(4, { isGeoBlocked: true })],
  });

  it('returns a page of photos at the largest size the site serves', async () => {
    const calls = site(() => html(FIRST));
    const response = await get(`/api/xh/album/${KEY}`);
    expect(calls[0].url).toBe(`${SITE}/photos/gallery/${KEY}`);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(await response.json()).toEqual({
      slug: KEY,
      key: KEY,
      title: 'Blonde in a red dress',
      date: '2026-10-21',
      count: 97,
      page: 1,
      pages: 2,
      photos: [
        { src: `${XH_IMAGE}/1_1000.jpg`, width: 2000, height: 1333 },
        { src: `${XH_IMAGE}/2_1000.jpg`, width: 1333, height: 2000 },
      ],
    });
  });

  it('asks for later pages by the full name, and opens a gallery by its number', async () => {
    const calls = site(() => html(xhGalleryPage({ key: KEY, page: 2, pages: 2, count: 97, photos: [xhPhoto(61)] })));
    expect(await (await get(`/api/xh/album/${KEY}?page=2`)).json()).toMatchObject({ page: 2, pages: 2, photos: [{ src: `${XH_IMAGE}/61_1000.jpg` }] });
    expect(calls[0].url).toBe(`${SITE}/photos/gallery/${KEY}/2`);
    site(() => redirected(html(FIRST), `${SITE}/photos/gallery/${KEY}`));
    expect(await (await get('/api/xh/album/16612090')).json()).toMatchObject({ slug: '16612090', key: KEY, pages: 2 });
  });

  it('answers a page past the last with no photos', async () => {
    site(() => html(FIRST));
    expect(await (await get(`/api/xh/album/${KEY}?page=9`)).json()).toMatchObject({ page: 9, pages: 2, photos: [] });
  });

  it('accepts only gallery names and numbers', async () => {
    const calls = site();
    for (const key of ['UPPER-1', 'no-number', 'a.b-1', '-', `${'x'.repeat(301)}-1`, '1234567890123']) {
      expect((await get(`/api/xh/album/${key}`)).status, key).toBe(400);
    }
    expect(await (await get('/api/xh/album/16612090?page=2')).json()).toEqual({ error: 'bad_page' });
    expect(calls).toHaveLength(0);
  });

  it('tells a removed gallery from a page it cannot read', async () => {
    site(() => html('Not found', { status: 404 }));
    expect(await (await get(`/api/xh/album/${KEY}`)).json()).toEqual({ error: 'not_found' });
    site(() => html('<html><body>Changed</body></html>'));
    const response = await get(`/api/xh/album/${KEY}`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'unreadable' });
  });

  it('accepts answers from the site and its language subdomains only', async () => {
    site(() => redirected(html(FIRST), `https://de.xhamster.com/photos/gallery/${KEY}`));
    expect((await get(`/api/xh/album/${KEY}`)).status).toBe(200);
    for (const elsewhere of ['https://xhamster.evil.example/photos/gallery/x-1', 'https://evilxhamster.com/photos/gallery/x-1']) {
      site(() => redirected(html(FIRST), elsewhere));
      expect(await (await get(`/api/xh/album/${KEY}`)).json(), elsewhere).toEqual({ error: 'moved' });
    }
  });
});

describe('reading xHamster pages', () => {
  it('reads the data a page carries for its scripts, and nothing else', () => {
    expect(readInitials('<script>window.initials = {"a":"b\\/c"};</script>')).toEqual({ a: 'b/c' });
    expect(readInitials('<script>window.initials={"a":1}\n</script>')).toEqual({ a: 1 });
    expect(readInitials('<script>window.initials = {"a":1}; evil();</script>')).toBeNull();
    expect(readInitials('<script>window.other = {"a":1};</script>')).toBeNull();
    expect(readInitials('<script>window.initials = 5;</script>')).toBeNull();
  });

  it('finds no list or gallery on pages without one', () => {
    expect(parseXhList('<html></html>')).toBeNull();
    expect(parseXhList('<script>window.initials = {"photosPage":{}};</script>')).toBeNull();
    expect(parseXhGallery('<script>window.initials = {"galleryPage":{"photoItems":null}};</script>')).toBeNull();
  });
});
