import { describe, expect, it } from 'vitest';
import { fetchAbd } from '../src/brain/providers/abd.js';
import { ahottieMaximumPage, extractAhottieMedia, extractHentaiCosplayMedia, hentaiCosplayMaximumPage } from '../src/brain/providers/cosplay-feed.js';
import { fetchHentaiCosplayXxx } from '../src/brain/providers/hentai-cosplay-xxx.js';
import { MediaHttpClient, SubrequestBudget, sniffImageType } from '../src/brain/providers/http.js';
import { fetchNekoBot } from '../src/brain/providers/nekobot.js';
import { fetchOBoobs } from '../src/brain/providers/obru.js';
import { fetchPorngifs } from '../src/brain/providers/porngifs.js';
import { extractPorngifsTvMedia, fetchPorngifsTv } from '../src/brain/providers/porngifs-tv.js';
import { extractPornPicsCovers, highResolutionPornPicsCover, pornPicsItemCeiling } from '../src/brain/providers/pornpics.js';
import { fetchSexCom } from '../src/brain/providers/sexcom.js';
import { fetchWaifuIm } from '../src/brain/providers/waifu-im.js';
import { image, imageBytes, json } from './helpers/fetch-mock.js';

function router(routes) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const request = new Request(input, init);
    calls.push(request);
    for (const [prefix, handler] of routes) {
      if (`${request.method} ${request.url}`.startsWith(prefix)) return handler(request);
    }
    throw new Error(`Unexpected request: ${request.url}`);
  };
  return { calls, fetchImpl };
}

function context(routes, { maxMediaBytes = 1_000_000, config = {}, http = {} } = {}) {
  const { calls, fetchImpl } = router(routes);
  return {
    calls,
    http: new MediaHttpClient({ timeoutMs: 5_000, maximumBytes: maxMediaBytes, fetchImpl, ...http }),
    maxMediaBytes,
    config: { mediaTimeoutMs: 5_000, nekoBotAuthorization: 'auth', waifuImKey: null, ...config },
  };
}

function hangingFetch() {
  return (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
}

describe('MediaHttpClient', () => {
  it('enforces byte limits from Content-Length and from the streamed body', async () => {
    const declared = context([['GET https://a.example/', () => new Response('x'.repeat(10), { headers: { 'Content-Length': '999999' } })]], { maxMediaBytes: 100 });
    await expect(declared.http.buffer('https://a.example/')).rejects.toMatchObject({ code: 'TOO_LARGE' });

    const streamed = context([['GET https://a.example/', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(80));
        controller.enqueue(new Uint8Array(80));
        controller.close();
      },
    }))]], { maxMediaBytes: 100 });
    await expect(streamed.http.buffer('https://a.example/')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('distinguishes a provider timeout from the invocation deadline', async () => {
    const timeout = new MediaHttpClient({ timeoutMs: 30, maximumBytes: 100, fetchImpl: hangingFetch() });
    await expect(timeout.json('https://a.example/')).rejects.toMatchObject({ code: 'TIMEOUT' });

    const deadline = new MediaHttpClient({ timeoutMs: 5_000, maximumBytes: 100, deadline: Date.now() + 30, fetchImpl: hangingFetch() });
    await expect(deadline.json('https://a.example/')).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });

    const expired = new MediaHttpClient({ timeoutMs: 5_000, maximumBytes: 100, deadline: Date.now() - 1, fetchImpl: hangingFetch() });
    await expect(expired.json('https://a.example/')).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
  });

  it('stops at the subrequest budget', async () => {
    const { fetchImpl } = router([['GET https://a.example/', () => json({ ok: true })]]);
    const http = new MediaHttpClient({ timeoutMs: 1_000, maximumBytes: 100, budget: new SubrequestBudget(2), fetchImpl });
    await http.json('https://a.example/');
    await http.json('https://a.example/');
    await expect(http.json('https://a.example/')).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
  });

  it('validates hosts, HTTP status, and image signatures', async () => {
    const ctx = context([
      ['GET https://good.example/html', () => new Response('<html>blocked</html>'.padEnd(2_000), { headers: { 'Content-Type': 'image/jpeg' } })],
      ['GET https://good.example/png', () => new Response(imageBytes('image/png'), { headers: { 'Content-Type': 'application/octet-stream' } })],
      ['GET https://good.example/missing', () => new Response('nope', { status: 404 })],
    ]);
    await expect(ctx.http.buffer('https://evil.example/x', { allowedHosts: ['good.example'] })).rejects.toMatchObject({ code: 'UNEXPECTED_HOST' });
    await expect(ctx.http.buffer('https://good.example/html', { expectImage: true })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(ctx.http.buffer('https://good.example/missing')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 404 });
    const png = await ctx.http.buffer('https://good.example/png', { expectImage: true });
    expect(png.contentType).toBe('image/png');
    expect(ctx.calls).toHaveLength(3);
  });

  it('recognises every embeddable image format by magic bytes', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(sniffImageType(imageBytes(type))).toBe(type);
    }
    expect(sniffImageType(new TextEncoder().encode('<!doctype html>'))).toBeNull();
  });
});

describe('N-SFW (ABD) provider', () => {
  const source = { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/legs' };
  const payload = (overrides = {}) => ({
    uploaded: '2026-10-03T14:18:04Z',
    name: 'KmY_HwXT.jpg',
    type: 'legs',
    nsfw: true,
    mime: 'image/jpeg',
    size: 2_048,
    url: 'https://data.n-sfw.com/nsfw/legs/KmY_HwXT.jpg',
    ...overrides,
  });

  it('downloads the data.n-sfw.com image as a native attachment', async () => {
    const ctx = context([
      ['GET https://api.n-sfw.com/nsfw/legs', () => json(payload())],
      ['GET https://data.n-sfw.com/nsfw/legs/KmY_HwXT.jpg', () => image('image/jpeg')],
    ]);
    const result = await fetchAbd(source, ctx);
    expect(result).toMatchObject({
      provider: 'n-sfw.com',
      url: 'https://data.n-sfw.com/nsfw/legs/KmY_HwXT.jpg',
      watchUrl: 'https://data.n-sfw.com/nsfw/legs/KmY_HwXT.jpg',
      contentType: 'image/jpeg',
      fileName: 'media.jpg',
    });
    expect(result.buffer.byteLength).toBe(2_048);
  });

  it('rejects foreign hosts, non-NSFW paths, unsupported types, and missing URLs', async () => {
    const cases = [
      [payload({ url: 'https://evil.example/nsfw/legs/a.jpg' }), 'UNEXPECTED_HOST'],
      [payload({ url: 'https://data.n-sfw.com/sfw/sao/a.png' }), 'INVALID_URL'],
      [payload({ url: 'http://data.n-sfw.com/nsfw/legs/a.jpg' }), 'INVALID_URL'],
      [payload({ mime: 'video/mp4' }), 'INVALID_RESPONSE'],
      [payload({ url: undefined }), 'INVALID_RESPONSE'],
    ];
    for (const [body, code] of cases) {
      const ctx = context([['GET https://api.n-sfw.com/nsfw/legs', () => json(body)]]);
      await expect(fetchAbd(source, ctx)).rejects.toMatchObject({ code, provider: 'n-sfw.com' });
      expect(ctx.calls).toHaveLength(1);
    }
  });

  it('skips the download when the advertised size exceeds the attachment limit', async () => {
    const ctx = context([['GET https://api.n-sfw.com/nsfw/legs', () => json(payload({ size: 5_000_000 }))]], { maxMediaBytes: 1_000_000 });
    await expect(fetchAbd(source, ctx)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(ctx.calls).toHaveLength(1);
  });

  it('caps the image download timeout so a stalled image host fails over quickly', async () => {
    const { fetchImpl } = router([['GET https://api.n-sfw.com/nsfw/legs', () => json(payload())]]);
    const slowImage = hangingFetch();
    const http = new MediaHttpClient({
      timeoutMs: 60_000,
      maximumBytes: 1_000_000,
      fetchImpl: (input, init) => (String(input).startsWith('https://data.') ? slowImage(input, init) : fetchImpl(input, init)),
    });
    const startedAt = Date.now();
    await expect(fetchAbd(source, { http, maxMediaBytes: 1_000_000, config: { mediaTimeoutMs: 50 } })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});

describe('JSON API providers', () => {
  it('sends the NekoBot authorization and requires success=true', async () => {
    const ok = context([['GET https://nekobot.xyz/api/image?type=hthigh', (request) => {
      expect(request.headers.get('authorization')).toBe('auth');
      return json({ success: true, message: 'https://i0.nekobot.xyz/x.png' });
    }]]);
    expect((await fetchNekoBot({ type: 'hthigh' }, ok)).url).toBe('https://i0.nekobot.xyz/x.png');

    const failed = context([['GET https://nekobot.xyz/', () => json({ success: false, message: 'nope' })]]);
    await expect(fetchNekoBot({ type: 'hthigh' }, failed)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const disabled = context([], { config: { nekoBotAuthorization: null } });
    await expect(fetchNekoBot({ type: 'hthigh' }, disabled)).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
  });

  it('adds the Waifu.im key only when configured', async () => {
    const ctx = context([['GET https://api.waifu.im/images?IncludedTags=maid&IsNsfw=True', (request) => {
      expect(request.headers.get('authorization')).toBe('ApiKey secret');
      expect(request.headers.get('accept-version')).toBe('v7');
      return json({ items: [{ url: 'https://cdn.waifu.im/2.png' }] });
    }]], { config: { waifuImKey: 'secret' } });
    expect((await fetchWaifuIm({ tag: 'maid', isNsfw: true }, ctx)).url).toBe('https://cdn.waifu.im/2.png');
  });

  it('converts Sex.com WebP URIs to GIFs on the CDN and links the pin', async () => {
    const ctx = context([['GET https://www.sex.com/portal/api/gifs/search?', (request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get('sexual-orientation')).toBe('straight');
      expect(url.searchParams.get('order')).toBe('likeCount');
      expect(url.searchParams.get('search')).toBe('Hentai');
      expect(url.searchParams.get('limit')).toBe('40');
      expect(Number(url.searchParams.get('page'))).toBeGreaterThanOrEqual(1);
      return json({ data: [{ id: 1831, uri: '/images/pinporn/2013/06/29/3061475.webp' }] });
    }]]);
    expect(await fetchSexCom({ niche: 'Hentai' }, ctx)).toMatchObject({
      url: 'https://imagex1.sx.cdn.live/images/pinporn/2013/06/29/3061475.gif',
      watchUrl: 'https://www.sex.com/pin/1831/',
    });
  });

  it('builds Oboobs media URLs over plain HTTP', async () => {
    const ctx = context([['GET http://api.oboobs.ru/boobs/0/1/random/', () => json([{ id: 9, preview: 'boobs_preview/09999.jpg' }])]]);
    expect((await fetchOBoobs({}, ctx)).url).toBe('http://media.oboobs.ru/boobs_preview/09999.jpg');
  });
});

describe('scraped GIF providers', () => {
  it('retries Porngifs IDs until a real image arrives', async () => {
    let attempt = 0;
    const ctx = context([['GET https://cdn.porngifs.com/img/', (request) => {
      expect(request.headers.get('referer')).toBe('https://porngifs.com/');
      attempt += 1;
      return attempt === 1 ? new Response('<html>gone</html>'.padEnd(2_000)) : image('image/gif');
    }]]);
    const ids = [11, 22];
    const result = await fetchPorngifs({}, ctx, { randomInteger: () => ids.shift() });
    expect(result).toMatchObject({ url: 'https://cdn.porngifs.com/img/22', contentType: 'image/gif', fileName: 'media.gif' });
  });

  it('keeps only WebP and GIF previews from Porngifs.tv', async () => {
    const html = [
      '<div data-webp="https://content.porngifs.tv/a/clip.webm"></div>',
      '<div data-webp="https://content.porngifs.tv/a/still.webp"></div>',
      "<div data-webp='https://content.porngifs.tv/b/anim.gif?x=1'></div>",
    ].join('');
    expect(extractPorngifsTvMedia(html)).toEqual([
      'https://content.porngifs.tv/a/still.webp',
      'https://content.porngifs.tv/b/anim.gif?x=1',
    ]);
    const ctx = context([
      ['GET https://porngifs.tv/?action=ajax', (request) => {
        expect(request.headers.get('x-requested-with')).toBe('XMLHttpRequest');
        return new Response(html);
      }],
      ['GET https://content.porngifs.tv/a/still.webp', () => image('image/webp')],
    ]);
    const result = await fetchPorngifsTv({}, ctx, { randomInteger: () => 7, choose: (items) => items[0] });
    expect(result).toMatchObject({ id: '7', contentType: 'image/webp', fileName: 'media.webp' });
  });
});

describe('cosplay feeds', () => {
  const feedPage = (page) => `
    <a class="last" href="/search/page/15608/">Last</a>
    <ul id="image-list">
      <li><a href="/image/x/"><img src="https://static1.hentai-cosplay-xxx.com/upload/2026/1/p=160x200/${page}.webp"></a></li>
      <li><a href="/image/y/"><img src="https://evil.example/p=160x200/2.webp"></a></li>
    </ul>`;

  it('reads the pagination ceiling and strips thumbnail wrappers', () => {
    expect(hentaiCosplayMaximumPage(feedPage(1))).toBe(15608);
    expect(extractHentaiCosplayMedia(feedPage(3), 'https://hentai-cosplay-xxx.com/search/page/3/'))
      .toEqual(['https://static1.hentai-cosplay-xxx.com/upload/2026/1/3.webp']);
  });

  it('sends a same-site Referer when downloading from the primary CDN', async () => {
    const ctx = context([
      ['GET https://hentai-cosplay-xxx.com/search/page/1/', () => new Response(feedPage(1))],
      ['GET https://hentai-cosplay-xxx.com/search/page/42/', () => new Response(feedPage(42))],
      ['GET https://static1.hentai-cosplay-xxx.com/upload/2026/1/42.webp', (request) => {
        expect(request.headers.get('referer')).toBe('https://hentai-cosplay-xxx.com/');
        return image('image/webp');
      }],
    ]);
    const result = await fetchHentaiCosplayXxx({}, ctx, { randomInteger: () => 42, choose: (items) => items[0] });
    expect(result).toMatchObject({ id: '42', url: 'https://static1.hentai-cosplay-xxx.com/upload/2026/1/42.webp', fileName: 'media.webp' });
  });

  it('extracts Ahottie album covers even with malformed closing tags', () => {
    const html = `
      <a href="https://ahottie.top/tags/Cosplay?page=2">2</a><a href="https://ahottie.top/tags/Cosplay?page=82">82</a>
      <div><a href="https://ahottie.top/albums/abc" target="_blank">
        <img src="https://thumbs2.imgbox.com/a6/e9/WWEJ8KMs_t.jpg" alt="x">
      </>
      <a href="https://ahottie.top/albums/abc"><h2>Title</h2></a>
      <a href="https://ahottie.top/other"><img src="https://images3.imgbox.com/zz/yy/ignored_o.jpg"></a></div>`;
    expect(ahottieMaximumPage(html)).toBe(82);
    expect(extractAhottieMedia(html, 'https://ahottie.top/tags/Cosplay?page=1')).toEqual(['https://images2.imgbox.com/a6/e9/WWEJ8KMs_o.jpg']);
  });
});

describe('PornPics cover feed', () => {
  it('promotes covers to /1280/ and reads the item ceiling', () => {
    expect(highResolutionPornPicsCover('https://cdni.pornpics.com/460/7/94/87445724/87445724_095_f50d.jpg'))
      .toBe('https://cdni.pornpics.com/1280/7/94/87445724/87445724_095_f50d.jpg');
    expect(highResolutionPornPicsCover('https://evil.example/460/a.jpg')).toBeNull();
    expect(pornPicsItemCeiling('<script>var P_MAX = 100;</script>')).toBe(1_000);
    const html = '<a href="/galleries/x-1/"><img data-src="https://cdni.pornpics.com/460/1/2/3/3_1.jpg"></a>';
    expect(extractPornPicsCovers(html)).toEqual(['https://cdni.pornpics.com/1280/1/2/3/3_1.jpg']);
  });
});
