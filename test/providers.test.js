import { beforeEach, describe, expect, it } from 'vitest';
import { fetchAbd } from '../src/brain/providers/abd.js';
import { fetchAhottie } from '../src/brain/providers/ahottie.js';
import { albumsFromSitemap, catalogText, createCosplayCatalog } from '../src/brain/providers/cosplay-catalog.js';
import bundledCosplayCatalog from '../src/brain/providers/cosplay-catalog.txt';
import { ahottieMaximumPage, extractAhottieMedia, extractHentaiCosplayMedia, hentaiCosplayMaximumPage } from '../src/brain/providers/cosplay-feed.js';
import { fetchHentaiCosplayXxx, resetHentaiCosplayStateForTests } from '../src/brain/providers/hentai-cosplay-xxx.js';
import { KNOWN_PLACEHOLDERS, MediaHttpClient, SubrequestBudget, imageDimensions, sniffImageType } from '../src/brain/providers/http.js';
import { fetchNekoBot } from '../src/brain/providers/nekobot.js';
import { fetchOBoobs } from '../src/brain/providers/obru.js';
import { fetchPorngifs } from '../src/brain/providers/porngifs.js';
import { extractPorngifsTvMedia, fetchPorngifsTv } from '../src/brain/providers/porngifs-tv.js';
import { extractPornPicsCovers, fetchPornPics, highResolutionPornPicsCover, pornPicsItemCeiling, resetPornPicsStateForTests } from '../src/brain/providers/pornpics.js';
import { fetchSexCom } from '../src/brain/providers/sexcom.js';
import { fetchWaifuArchive } from '../src/brain/providers/waifu-archive.js';
import { randomInteger } from '../src/lib/random.js';
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
    config: { mediaTimeoutMs: 5_000, nekoBotAuthorization: 'auth', ...config },
  };
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Returns the given values in order, for code that draws several random
// numbers.
function sequence(...values) {
  let next = 0;
  return () => values[next++ % values.length];
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

  it('fails over quickly when a provider never starts responding, without cutting a slow body short', async () => {
    const silent = new MediaHttpClient({ timeoutMs: 5_000, headersTimeoutMs: 30, maximumBytes: 100, fetchImpl: hangingFetch() });
    await expect(silent.json('https://a.example/')).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'Provider did not start responding within 30 ms.',
    });

    // Headers arrive at once; the body takes longer than the first-byte timeout.
    const encoder = new TextEncoder();
    const slowBody = new MediaHttpClient({
      timeoutMs: 5_000,
      headersTimeoutMs: 30,
      maximumBytes: 100,
      fetchImpl: async () => new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('{"ok":'));
          await new Promise((resolve) => setTimeout(resolve, 100));
          controller.enqueue(encoder.encode('true}'));
          controller.close();
        },
      })),
    });
    await expect(slowBody.json('https://a.example/')).resolves.toEqual({ ok: true });
  });

  it('reads only the start of a text file, unpacking gzip on the way', async () => {
    const text = 'a'.repeat(50_000) + 'b'.repeat(50_000);
    const packed = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let cancelled = false;
    const ctx = context([
      ['GET https://a.example/plain', () => new Response(text)],
      // Never closes: only cancelling ends the transfer.
      ['GET https://a.example/packed', () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(packed);
        },
        cancel() {
          cancelled = true;
        },
      }))],
    ]);
    expect(await ctx.http.textPrefix('https://a.example/plain', { length: 10 })).toBe('a'.repeat(10));
    expect(await ctx.http.textPrefix('https://a.example/packed', { length: 60_000 })).toBe('a'.repeat(50_000) + 'b'.repeat(10_000));
    expect(cancelled).toBe(true);
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

  it('reads pixel sizes from every embeddable format without decoding', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(imageDimensions(imageBytes(type, 2_048, { width: 640, height: 960 }))).toEqual({ width: 640, height: 960 });
    }
    // A progressive JPEG whose frame header follows an EXIF segment.
    const progressive = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66,
      0xff, 0xc2, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03,
    ]);
    expect(imageDimensions(progressive)).toEqual({ width: 1280, height: 720 });
    // Lossy (VP8) and lossless (VP8L) WebP headers.
    const lossy = imageBytes('image/webp', 64);
    lossy.set([0x56, 0x50, 0x38, 0x20], 12);
    lossy.set([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x20, 0x03, 0x58, 0x02], 20);
    expect(imageDimensions(lossy)).toEqual({ width: 800, height: 600 });
    const lossless = imageBytes('image/webp', 64);
    lossless.set([0x56, 0x50, 0x38, 0x4c], 12);
    lossless.set([0x2f, 0x3f, 0x1f, 0x1d, 0x00], 20);
    expect(imageDimensions(lossless)).toEqual({ width: 8_000, height: 117 });
    expect(imageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]))).toBeNull();
    expect(imageDimensions(new TextEncoder().encode('<!doctype html>'))).toBeNull();
  });

  it('rejects known placeholders, too-small images, and unreadable headers', async () => {
    expect(KNOWN_PLACEHOLDERS).toContainEqual({ bytes: 8_091, sha256: 'c0ff95f9ec7fea007b8236e8efddfcc6c0dfdd56f8e4c38c8ffed8fde655d8a7' });
    const standIn = imageBytes('image/jpeg', 1_500);
    const ctx = context([
      ['GET https://cdn.example/stand-in.jpg', () => new Response(standIn)],
      ['GET https://cdn.example/same-length.jpg', () => image('image/jpeg', 1_500, { width: 1_000 })],
      ['GET https://cdn.example/icon.png', () => image('image/png', 2_048, { width: 240, height: 240 })],
      ['GET https://cdn.example/broken.jpg', () => new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, ...new Uint8Array(2_000)]))],
      ['GET https://cdn.example/photo.webp', () => image('image/webp', 2_048, { width: 1_280, height: 1_920 })],
    ], { http: { placeholders: [{ bytes: 1_500, sha256: await sha256(standIn) }] } });
    const photo = { expectImage: true, minimumDimension: 300 };

    await expect(ctx.http.buffer('https://cdn.example/stand-in.jpg', { expectImage: true })).rejects.toMatchObject({ code: 'PLACEHOLDER_IMAGE' });
    await expect(ctx.http.buffer('https://cdn.example/same-length.jpg', { expectImage: true })).resolves.toMatchObject({ contentType: 'image/jpeg' });
    await expect(ctx.http.buffer('https://cdn.example/icon.png', photo)).rejects.toMatchObject({ code: 'IMAGE_TOO_SMALL' });
    await expect(ctx.http.buffer('https://cdn.example/broken.jpg', photo)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(ctx.http.buffer('https://cdn.example/photo.webp', photo)).resolves.toMatchObject({ contentType: 'image/webp' });
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

  it('uploads an indexed Waifu archive original without a search request', async () => {
    const archive = 'https://waifu-im-shim.trinitymoin.workers.dev';
    const offered = [];
    const ctx = context([[`GET ${archive}/`, () => image('image/jpeg', 4_096)]], { maxMediaBytes: 2 * 1024 * 1024 });
    const result = await fetchWaifuArchive({ tag: 'uniform', isNsfw: true }, ctx, {
      choose: (items) => { offered.push(...items); return items[0]; },
    });
    expect(offered.length).toBeGreaterThan(200);
    expect(offered.every((entry) => entry.bytes <= 2 * 1024 * 1024)).toBe(true);
    expect(result).toMatchObject({ provider: 'waifu archive', id: offered[0].id, url: `${archive}/${offered[0].file}`, contentType: 'image/jpeg' });
    expect(ctx.calls).toHaveLength(1);
  });

  it('falls back to the archive search when an indexed file is missing', async () => {
    const archive = 'https://waifu-im-shim.trinitymoin.workers.dev';
    const missing = { choose: () => ({ file: '99999.jpeg', id: '99999', bytes: 1_024 }) };
    const ctx = context([
      [`GET ${archive}/99999.jpeg`, () => new Response('not found', { status: 404 })],
      [`GET ${archive}/images?IncludedTags=maid&IsNsfw=True`, (request) => {
        expect(request.headers.get('authorization')).toBeNull();
        expect(request.headers.get('accept-version')).toBeNull();
        return json({ items: [
          { id: 9, url: 'https://cdn.waifu.im/9.png', is_nsfw: true },
          { id: 8610, url: `${archive}/8610.png`, is_nsfw: true },
          { id: 2949, url: `${archive}/2949.png`, is_nsfw: true },
        ] });
      }],
      [`GET ${archive}/8610.png`, () => new Response('x', { headers: { 'Content-Length': '15154809' } })],
      [`GET ${archive}/2949.png`, () => image('image/png', 4_096)],
    ]);
    expect(await fetchWaifuArchive({ tag: 'maid', isNsfw: true }, ctx, missing)).toMatchObject({
      provider: 'waifu archive', id: '2949', url: `${archive}/2949.png`, watchUrl: `${archive}/2949.png`, contentType: 'image/png', fileName: 'media.png',
    });
    expect(ctx.calls.map((request) => new URL(request.url).pathname)).toEqual(['/99999.jpeg', '/images', '/8610.png', '/2949.png']);

    for (const items of [[], [{ id: 1, url: 'http://waifu-im-shim.trinitymoin.workers.dev/1.png' }], [{ id: 1, url: `${archive}/notes.txt` }]]) {
      const empty = context([[`GET ${archive}/99999.jpeg`, () => new Response('', { status: 404 })], [`GET ${archive}/images?`, () => json({ items })]]);
      await expect(fetchWaifuArchive({ tag: 'maid', isNsfw: true }, empty, missing)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', provider: 'waifu archive' });
    }
  });

  it('stops at once when the Waifu archive itself is struggling', async () => {
    const struggling = context([['GET https://waifu-im-shim.trinitymoin.workers.dev/', () => new Response('busy', { status: 503 })]]);
    await expect(fetchWaifuArchive({ tag: 'maid', isNsfw: true }, struggling)).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503, provider: 'waifu archive' });
    expect(struggling.calls).toHaveLength(1);
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

describe('cosplay catalog', () => {
  const upload = (host, path) => `https://${host}.hentai-cosplay-xxx.com/upload/${path}`;
  // A sitemap with every image of each album, as the site serves it.
  const albumSitemap = (albums) => `<?xml version="1.0"?><urlset>${albums.map((urls) => (
    `<url><loc>https://hentai-cosplay-xxx.com/image/a/</loc>${urls.map((url) => (
      `<image:image><image:loc>${url}</image:loc><image:title><![CDATA[t]]></image:title></image:image>`
    )).join('')}</url>`
  )).join('')}</urlset>`;
  const xml = albumSitemap([
    [1, 2, 3].map((n) => upload('static6', `20220124/285/291755/${n}.jpg`)),
    [upload('static6', '20220125/285/291760/5.webp'), upload('static6', '20220125/285/291760/6.webp'), upload('static6', '20220125/285/291760/7.jpg')],
    [upload('static6', '20220125/286/291761/2.jpeg'), 'https://evil.example/upload/20220125/286/291761/3.jpg', upload('static6', '20220125/286/291761/p=160x200/4.jpg')],
    Array.from({ length: 30 }, (_, index) => upload('static17', `20261026/448/458355/${index + 1}.png`)),
    // The sitemaps continue a large album in another entry.
    Array.from({ length: 10 }, (_, index) => upload('static17', `20261026/448/458355/${index + 31}.png`)),
  ]);

  it('turns sitemap albums into catalog lines and back into the same image URLs', () => {
    const albums = albumsFromSitemap(xml);
    expect(albums.map((album) => album.runs)).toEqual([
      [{ first: 1, count: 3, extension: 'jpg' }],
      [{ first: 5, count: 2, extension: 'webp' }, { first: 7, count: 1, extension: 'jpg' }],
      [{ first: 2, count: 1, extension: 'jpeg' }],
      [{ first: 1, count: 40, extension: 'png' }],
    ]);
    const text = catalogText(albums, ['a comment']);
    expect(text.split('\n').filter((line) => line.startsWith('static'))).toHaveLength(2);
    const catalog = createCosplayCatalog(text);
    expect(catalog.albums).toBe(4);
    // Each pick draws a line, a position on it, then an image of that album.
    expect(catalog.pick(sequence(0, 0, 0))).toEqual({ url: upload('static6', '20220124/285/291755/1.jpg'), album: 291755 });
    expect(catalog.pick(sequence(0, 1, 1)).url).toBe(upload('static6', '20220125/285/291760/6.webp'));
    expect(catalog.pick(sequence(0, 1, 2)).url).toBe(upload('static6', '20220125/285/291760/7.jpg'));
    expect(catalog.pick(sequence(0, 2, 0)).url).toBe(upload('static6', '20220125/286/291761/2.jpeg'));
    expect(catalog.pick(sequence(1, 0, 39))).toEqual({ url: upload('static17', '20261026/448/458355/40.png'), album: 458355 });
    // A position past the end of a line is drawn again.
    expect(catalog.pick(sequence(0, 5, 1, 0, 9)).url).toBe(upload('static17', '20261026/448/458355/10.png'));
  });

  it('keeps lines short, so a pick decodes at most 32 albums', () => {
    const albums = Array.from({ length: 70 }, (_, index) => ({
      host: 'static3', date: '20200101', group: 10, id: 1_000 + index, runs: [{ first: 1, count: 1, extension: 'jpg' }],
    }));
    const text = catalogText(albums);
    expect(text.split('\n').filter((line) => line.startsWith('static3')).map((line) => line.split(' ').length - 1)).toEqual([32, 32, 6]);
    const catalog = createCosplayCatalog(text);
    expect(catalog.albums).toBe(70);
    expect(catalog.pick(sequence(2, 5, 0))).toEqual({ url: 'https://static3.hentai-cosplay-xxx.com/upload/20200101/10/1069/1.jpg', album: 1_069 });
  });

  it('lets the caller turn picks down, and gives up after twenty draws', () => {
    const catalog = createCosplayCatalog(catalogText(albumsFromSitemap(xml)));
    const onlyStatic17 = (url) => url.includes('//static17.');
    expect(catalog.pick(sequence(0, 0, 0, 1, 0, 5), onlyStatic17).url).toBe(upload('static17', '20261026/448/458355/6.png'));
    expect(catalog.pick(() => 0, onlyStatic17)).toBeNull();
    expect(createCosplayCatalog('').pick(() => 0)).toBeNull();
    expect(createCosplayCatalog('# no index line\n').albums).toBe(0);
    // Changed line endings would shift every offset, so such a file reads as empty.
    expect(createCosplayCatalog(catalogText(albumsFromSitemap(xml)).replaceAll('\n', '\r\n')).albums).toBe(0);
  });

  it('ships a catalog of every album, each pick a valid image URL', () => {
    const catalog = createCosplayCatalog(bundledCosplayCatalog);
    expect(catalog.albums).toBeGreaterThan(300_000);
    for (let index = 0; index < 200; index += 1) {
      expect(catalog.pick(randomInteger).url).toMatch(/^https:\/\/static\d*\.hentai-cosplay-xxx\.com\/upload\/(?:200|201|202)\d[01]\d[0-3]\d\/\d+\/\d+\/\d+\.(?:jpg|jpeg|png|gif|webp)$/);
    }
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

  const cover = (host, album, file) => `https://${host}.hentai-cosplay-xxx.com/upload/2026/1/${album}/${file}.jpg`;
  // An image sitemap: every image of each album, as the site serves it.
  const sitemap = (urls) => `<?xml version="1.0"?><urlset>${urls.map((url) => (
    `<url><loc>https://hentai-cosplay-xxx.com/image/a/</loc><image:image><image:loc>${url}</image:loc></image:image></url>`
  )).join('')}</urlset>`;
  async function gzip(text) {
    return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  }
  const sitemapUrl = (file) => `https://hentai-cosplay-xxx.com/sitemap_images_detail_${file}.xml.gz`;
  const nextFiles = (first) => {
    let file = first;
    return { randomInteger: () => file++, choose: (items) => items[0] };
  };

  beforeEach(() => resetHentaiCosplayStateForTests());

  it('picks an image from a gzipped image sitemap and sends a same-site Referer', async () => {
    const photo = cover('static17', 457942, 5);
    const ctx = context([
      [`GET ${sitemapUrl(42)}`, async () => new Response(await gzip(sitemap([photo, cover('evil', 1, 1).replace('hentai-cosplay-xxx.com', 'evil.example')])), {
        headers: { 'Content-Type': 'text/plain' },
      })],
      [`GET ${photo}`, (request) => {
        expect(request.headers.get('referer')).toBe('https://hentai-cosplay-xxx.com/');
        return image('image/jpeg');
      }],
    ]);
    const result = await fetchHentaiCosplayXxx({}, ctx, { randomInteger: () => 42, choose: (items) => items[0] });
    expect(result).toMatchObject({ id: 'sitemap 42', url: photo, contentType: 'image/jpeg', fileName: 'media.jpg' });
    expect(ctx.calls.map((request) => request.url)).toEqual([sitemapUrl(42), photo]);
  });

  it('reads only the start of a sitemap', async () => {
    const early = cover('static5', 1, 1);
    const late = cover('static5', 2, 1);
    const ctx = context([
      [`GET ${sitemapUrl(3)}`, () => new Response(sitemap([early]) + ' '.repeat(200_000) + sitemap([late]))],
      [`GET ${early}`, () => image('image/jpeg')],
    ]);
    const chosen = [];
    await fetchHentaiCosplayXxx({}, ctx, { randomInteger: () => 3, choose: (items) => { chosen.push(...items); return items[0]; } });
    expect(chosen).toEqual([early]);
  });

  it('moves to another sitemap when an image server is down, and skips that server afterwards', async () => {
    const dead = [cover('static11', 300, 1), cover('static11', 300, 2)];
    const alive = cover('static5', 200, 1);
    const routes = [
      [`GET ${sitemapUrl(7)}`, () => new Response(sitemap(dead))],
      [`GET ${sitemapUrl(8)}`, () => new Response(sitemap([dead[1]]))],
      [`GET ${sitemapUrl(9)}`, () => new Response(sitemap([alive]))],
      ['GET https://static11.hentai-cosplay-xxx.com/', () => new Response('error code: 502', { status: 502 })],
      [`GET ${alive}`, () => image('image/jpeg')],
    ];
    const first = context(routes);
    expect(await fetchHentaiCosplayXxx({}, first, nextFiles(7))).toMatchObject({ id: 'sitemap 9', url: alive });
    expect(first.calls.map((request) => request.url)).toEqual([sitemapUrl(7), dead[0], sitemapUrl(8), sitemapUrl(9), alive]);

    const second = context(routes);
    expect(await fetchHentaiCosplayXxx({}, second, nextFiles(8))).toMatchObject({ url: alive });
    expect(second.calls.map((request) => request.url)).toEqual([sitemapUrl(8), sitemapUrl(9), alive]);
  });

  it('falls back to feed pages when the sitemaps are unavailable', async () => {
    const ctx = context([
      ['GET https://hentai-cosplay-xxx.com/sitemap_images_detail_', () => new Response('not found', { status: 404 })],
      ['GET https://static1.hentai-cosplay-xxx.com/upload/2026/1/42.webp', () => image('image/webp')],
      ['GET https://hentai-cosplay-xxx.com/search/page/', (request) => new Response(feedPage(request.url.match(/page\/(\d+)/)[1]))],
      ['GET https://hentai-cosplay-xxx.com/search/', () => new Response(feedPage(1))],
    ]);
    const result = await fetchHentaiCosplayXxx({}, ctx, { randomInteger: () => 42, choose: (items) => items[0] });
    expect(result).toMatchObject({ id: 'feed page 42', url: 'https://static1.hentai-cosplay-xxx.com/upload/2026/1/42.webp' });
    expect(ctx.calls.map((request) => new URL(request.url).pathname)).toEqual([
      '/sitemap_images_detail_42.xml.gz', '/search/', '/search/page/42/', '/upload/2026/1/42.webp',
    ]);
  });

  const catalogOf = (albums) => createCosplayCatalog(catalogText(albums));
  const album = (host, id, count) => ({ host, date: '20240107', group: 364, id, runs: [{ first: 1, count, extension: 'jpg' }] });
  const albumImage = (host, id, n) => `https://${host}.hentai-cosplay-xxx.com/upload/20240107/364/${id}/${n}.jpg`;

  it('picks a random catalog album without reading any listing', async () => {
    const photo = albumImage('static5', 372226, 27);
    const ctx = context([[`GET ${photo}`, (request) => {
      expect(request.headers.get('referer')).toBe('https://hentai-cosplay-xxx.com/');
      return image('image/jpeg');
    }]]);
    const result = await fetchHentaiCosplayXxx({}, { ...ctx, cosplayCatalog: catalogOf([album('static5', 372226, 30)]) }, { randomInteger: sequence(0, 0, 26), choose: (items) => items[0] });
    expect(result).toMatchObject({ id: 'album 372226', url: photo, contentType: 'image/jpeg' });
    expect(ctx.calls.map((request) => request.url)).toEqual([photo]);
  });

  it('skips catalog albums on a server that just failed', async () => {
    const catalog = catalogOf([album('static11', 1, 1), album('static5', 2, 1)]);
    const ctx = context([
      ['GET https://static11.hentai-cosplay-xxx.com/', () => new Response('error code: 502', { status: 502 })],
      [`GET ${albumImage('static5', 2, 1)}`, () => image('image/jpeg')],
    ]);
    // Line 0 holds the album on the failing server; drawing it again is turned down.
    const result = await fetchHentaiCosplayXxx({}, ctx, { catalog, randomInteger: sequence(0, 0, 0, 0, 0, 0, 1, 0, 0), choose: (items) => items[0] });
    expect(result).toMatchObject({ id: 'album 2' });
    expect(ctx.calls.map((request) => request.url)).toEqual([albumImage('static11', 1, 1), albumImage('static5', 2, 1)]);
  });

  it('says once when the bundled catalog cannot be read, then uses the sitemaps', async () => {
    const photo = cover('static5', 9, 1);
    const routes = [[`GET ${sitemapUrl(42)}`, () => new Response(sitemap([photo]))], [`GET ${photo}`, () => image('image/jpeg')]];
    const warnings = [];
    const logger = { warn: (message) => warnings.push(message), debug() {} };
    for (let run = 0; run < 2; run += 1) {
      const ctx = context(routes);
      const result = await fetchHentaiCosplayXxx({}, { ...ctx, logger, cosplayCatalog: createCosplayCatalog('corrupt') }, { randomInteger: () => 42, choose: (items) => items[0] });
      expect(result).toMatchObject({ id: 'sitemap 42' });
    }
    expect(warnings).toEqual(['The bundled cosplay catalog is empty or unreadable; reading the sitemaps instead.']);
  });

  it('reads the live sitemaps when catalog images are gone from the site', async () => {
    const photo = cover('static5', 9, 1);
    const ctx = context([
      ['GET https://static5.hentai-cosplay-xxx.com/upload/20240107/', () => new Response('not found', { status: 404 })],
      [`GET ${sitemapUrl(42)}`, () => new Response(sitemap([photo]))],
      [`GET ${photo}`, () => image('image/jpeg')],
    ]);
    const warnings = [];
    const logger = { warn: (message) => warnings.push(message), debug() {} };
    const catalog = catalogOf([album('static5', 1, 1), album('static5', 2, 1)]);
    const result = await fetchHentaiCosplayXxx({}, { ...ctx, logger }, { catalog, randomInteger: sequence(0, 0, 0, 0, 1, 0, 42), choose: (items) => items[0] });
    expect(result).toMatchObject({ id: 'sitemap 42', url: photo });
    expect(ctx.calls.map((request) => request.url)).toEqual([albumImage('static5', 1, 1), albumImage('static5', 2, 1), sitemapUrl(42), photo]);
    expect(warnings).toEqual(['Cosplay catalog images are missing on the site; reading the sitemaps instead.']);
  });

  it('gives up after three images, or at once when the budget runs out', async () => {
    const routes = [
      ['GET https://hentai-cosplay-xxx.com/sitemap_images_detail_', (request) => {
        const file = request.url.match(/detail_(\d+)/)[1];
        return new Response(sitemap([cover(`static${file}`, file, 1)]));
      }],
      ['GET https://static', () => new Response('error code: 502', { status: 502 })],
    ];
    const exhausted = context(routes);
    await expect(fetchHentaiCosplayXxx({}, exhausted, nextFiles(20))).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 502, provider: 'hentai-cosplay-xxx.com' });
    expect(exhausted.calls).toHaveLength(6);

    resetHentaiCosplayStateForTests();
    const budgeted = context(routes, { http: { budget: new SubrequestBudget(3) } });
    await expect(fetchHentaiCosplayXxx({}, budgeted, nextFiles(20))).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(budgeted.calls).toHaveLength(3);
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

  it('leaves Ahottie untouched unless AHOTTIE is set', async () => {
    const ctx = context([]);
    await expect(fetchAhottie({}, ctx)).rejects.toMatchObject({ code: 'PROVIDER_DISABLED', provider: 'ahottie.top' });
    expect(ctx.calls).toHaveLength(0);
  });

  it('skips imgbox placeholders and tiny images using the page already read', async () => {
    const albums = ['A', 'B', 'C'].map((id) => `<a href="https://ahottie.top/albums/${id}"><img src="https://images2.imgbox.com/aa/bb/${id}_o.jpg"></a>`);
    const placeholder = imageBytes('image/jpeg', 1_200, { width: 240, height: 240 });
    const ctx = context([
      ['GET https://ahottie.top/tags/Cosplay?page=1', () => new Response(`<a href="?page=82">82</a>${albums.join('')}`)],
      ['GET https://images2.imgbox.com/aa/bb/A_o.jpg', () => new Response(placeholder)],
      ['GET https://images2.imgbox.com/aa/bb/B_o.jpg', () => image('image/jpeg', 2_048, { width: 120, height: 900 })],
      ['GET https://images2.imgbox.com/aa/bb/C_o.jpg', () => image('image/jpeg', 2_048, { width: 900, height: 1_350 })],
    ], { config: { ahottieEnabled: true }, http: { placeholders: [{ bytes: 1_200, sha256: await sha256(placeholder) }] } });
    const result = await fetchAhottie({}, ctx, { randomInteger: () => 1, choose: (items) => items[0] });
    expect(result).toMatchObject({ provider: 'ahottie.top', url: 'https://images2.imgbox.com/aa/bb/C_o.jpg', contentType: 'image/jpeg' });
    expect(ctx.calls).toHaveLength(4);
  });
});

describe('PornPics cover feed', () => {
  beforeEach(() => resetPornPicsStateForTests());

  it('promotes covers to /1280/ and reads the item ceiling', () => {
    expect(highResolutionPornPicsCover('https://cdni.pornpics.com/460/7/94/87445724/87445724_095_f50d.jpg'))
      .toBe('https://cdni.pornpics.com/1280/7/94/87445724/87445724_095_f50d.jpg');
    expect(highResolutionPornPicsCover('https://evil.example/460/a.jpg')).toBeNull();
    expect(pornPicsItemCeiling('<script>var P_MAX = 100;</script>')).toBe(1_000);
    const html = '<a href="/galleries/x-1/"><img data-src="https://cdni.pornpics.com/460/1/2/3/3_1.jpg"></a>';
    expect(extractPornPicsCovers(html)).toEqual(['https://cdni.pornpics.com/1280/1/2/3/3_1.jpg']);
  });

  it('reads the category page once, then picks a random offset directly', async () => {
    const category = 'https://www.pornpics.com/butt-plug/';
    const offsetUrl = (offset) => `${category}?offset=${offset}`;
    const coverUrl = (offset, size) => `https://cdni.pornpics.com/${size}/1/2/${offset}/${offset}_1.jpg`;
    const ctx = context([
      [`GET ${category}?offset=`, (request) => {
        const offset = new URL(request.url).searchParams.get('offset');
        return json([{ gid: Number(offset), t_url_460: coverUrl(offset, 460) }]);
      }],
      [`GET ${category}`, () => new Response('<script>var P_MAX = 100;</script>')],
      ['GET https://cdni.pornpics.com/1280/', () => image('image/jpeg')],
    ]);
    const ranges = [];
    const offsets = [500, 7];
    const dependencies = {
      randomInteger: (minimum, maximum) => {
        ranges.push([minimum, maximum]);
        return offsets.shift();
      },
    };

    expect(await fetchPornPics({ endpoint: category }, ctx, dependencies)).toMatchObject({ id: '500', url: coverUrl(500, 1280) });
    expect(await fetchPornPics({ endpoint: category }, ctx, dependencies)).toMatchObject({ id: '7', url: coverUrl(7, 1280) });
    // Offset 0 is the category page itself, so the cached range starts at 1.
    expect(ranges).toEqual([[0, 999], [1, 999]]);
    expect(ctx.calls.map((request) => request.url)).toEqual([
      category, offsetUrl(500), coverUrl(500, 1280),
      offsetUrl(7), coverUrl(7, 1280),
    ]);
  });

  it('counts the galleries again when a remembered offset no longer exists', async () => {
    const category = 'https://www.pornpics.com/butt-plug/';
    const coverUrl = (offset, size) => `https://cdni.pornpics.com/${size}/1/2/${offset}/${offset}_1.jpg`;
    let pages = 100;
    const ctx = context([
      [`GET ${category}?offset=`, (request) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        return json(offset < pages * 10 ? [{ gid: offset, t_url_460: coverUrl(offset, 460) }] : []);
      }],
      [`GET ${category}`, () => new Response(`<script>var P_MAX = ${pages};</script>`)],
      ['GET https://cdni.pornpics.com/1280/', () => image('image/jpeg')],
    ]);
    const offsets = [500, 900, 300];
    const dependencies = { randomInteger: () => offsets.shift() };

    await fetchPornPics({ endpoint: category }, ctx, dependencies);
    pages = 50;
    expect(await fetchPornPics({ endpoint: category }, ctx, dependencies)).toMatchObject({ id: '300' });
    expect(ctx.calls.slice(3).map((request) => request.url)).toEqual([
      `${category}?offset=900`, category, `${category}?offset=300`, coverUrl(300, 1280),
    ]);
  });
});
