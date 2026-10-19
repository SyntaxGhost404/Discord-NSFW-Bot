import assert from 'node:assert/strict';
import test from 'node:test';
import buttplug from '../src/commands/buttplug.js';
import {
  extractPornPicsCovers,
  fetchPornPics,
  highResolutionPornPicsCover,
  parsePornPicsOffsetPayload,
  pornPicsItemCeiling,
  PORNPICS_MAXIMUM_FEED_BYTES,
  PORNPICS_MAXIMUM_OFFSET_BYTES,
} from '../src/brain/providers/pornpics.js';
import { MediaProviderError } from '../src/brain/providers/errors.js';
import { Logger } from '../src/lib/logger.js';

const CATEGORY_URL = 'https://www.pornpics.com/butt-plug/';

function thumbnail(width, index) {
  const id = 15_496_500 + index;
  return `https://cdni.pornpics.com/${width}/3/17/${id}/${id}_007_ea75.jpg`;
}

function categoryPage({ itemCount = 20, pageCount = 100 } = {}) {
  const images = Array.from({ length: itemCount }, (_value, index) => `
    <a class="thumb" href="https://www.pornpics.com/galleries/gallery-${index}/">
      <img src="${thumbnail(300, index)}" data-src="${thumbnail(460, index)}">
    </a>
  `).join('');
  return `
    <html><body>
      <script>var P_MAX = ${pageCount};</script>
      <main>${images}</main>
    </body></html>
  `;
}

function providerContext(http) {
  return {
    http,
    config: { mediaTimeoutMs: 15_000 },
    maxMediaBytes: 10 * 1024 * 1024,
  };
}

function jpegDownload(url, size = 2_048) {
  return {
    buffer: Buffer.alloc(size, 0xff),
    contentType: 'image/jpeg',
    finalUrl: url,
  };
}

function commandResponder() {
  const calls = [];
  return {
    calls,
    async defer() { calls.push({ method: 'defer' }); },
    async deferUpdate() { calls.push({ method: 'deferUpdate' }); },
    async editOriginal(body, files = []) { calls.push({ method: 'editOriginal', body, files }); },
  };
}

function commandContext(responder, http, { source = 'command', style } = {}) {
  return {
    source,
    responder,
    interaction: {
      id: '123456789012345678',
      data: { options: style ? [{ name: 'style', value: style }] : [] },
      user: { id: '234567890123456789', username: 'tester', discriminator: '0', avatar: null },
    },
    http,
    config: { mediaTimeoutMs: 15_000 },
    maxMediaBytes: 10 * 1024 * 1024,
    logger: new Logger('error'),
  };
}

test('PornPics discovers the complete item range and promotes only exact CDN covers to 1280px', () => {
  const html = `${categoryPage({ itemCount: 3 })}
    <img src="https://cdni.pornpics.com/460/9/8/7/unrelated.webp">`;
  assert.equal(pornPicsItemCeiling(html), 1_000);
  assert.deepEqual(extractPornPicsCovers(html), [
    thumbnail(1280, 0),
    thumbnail(1280, 1),
    thumbnail(1280, 2),
  ]);
  assert.deepEqual(extractPornPicsCovers(`
    <script>{"t_url_460":"https:\\/\\/cdni.pornpics.com\\/460\\/9\\/8\\/7\\/escaped.webp"}</script>
  `), ['https://cdni.pornpics.com/1280/9/8/7/escaped.webp']);
  assert.equal(highResolutionPornPicsCover(thumbnail(460, 0)), thumbnail(1280, 0));
  assert.equal(highResolutionPornPicsCover(thumbnail(300, 0)), thumbnail(1280, 0));
  assert.equal(highResolutionPornPicsCover(thumbnail(1280, 0)), thumbnail(1280, 0));
  assert.equal(highResolutionPornPicsCover('https://evil.example/460/image.jpg'), null);
  assert.equal(highResolutionPornPicsCover('http://cdni.pornpics.com/460/image.jpg'), null);
  assert.equal(highResolutionPornPicsCover('https://user@cdni.pornpics.com/460/image.jpg'), null);
  assert.throws(() => pornPicsItemCeiling('<html>missing ceiling</html>'), (error) => error.code === 'INVALID_RESPONSE');
});

test('PornPics uses the already-loaded initial feed for offsets below twenty', async () => {
  const requests = [];
  const result = await fetchPornPics({ endpoint: CATEGORY_URL }, providerContext({
    async text(url, options) {
      requests.push({ method: 'text', url, options });
      return categoryPage();
    },
    async buffer(url, options) {
      requests.push({ method: 'buffer', url, options });
      return jpegDownload(url);
    },
  }), {
    randomInteger(minimum, maximum) {
      assert.deepEqual([minimum, maximum], [0, 999]);
      return 7;
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, 'text');
  assert.equal(requests[0].url, CATEGORY_URL);
  assert.equal(requests[0].options.maximumBytes, PORNPICS_MAXIMUM_FEED_BYTES);
  assert.deepEqual(requests[0].options.allowedHosts, ['pornpics.com']);
  assert.equal(requests[1].method, 'buffer');
  assert.equal(requests[1].url, thumbnail(1280, 7));
  assert.deepEqual(requests[1].options.allowedHosts, ['cdni.pornpics.com']);
  assert.equal(requests[1].options.allowSubdomains, false);
  assert.equal(requests[1].options.minimumBytes, 1_024);
  assert.equal(requests[1].options.headers.Referer, CATEGORY_URL);
  assert.match(requests[1].options.headers.Accept, /^image\//);
  assert.equal(result.id, '7');
  assert.equal(result.url, thumbnail(1280, 7));
  assert.equal(result.watchUrl, thumbnail(1280, 7));
  assert.equal(result.buffer.length, 2_048);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.fileName, 'media.jpg');
});

test('PornPics retries one transient media network failure without repeating feed discovery', async () => {
  let feedRequests = 0;
  let mediaRequests = 0;
  const result = await fetchPornPics(
    { endpoint: CATEGORY_URL },
    providerContext({
      async text() {
        feedRequests += 1;
        return categoryPage({ itemCount: 1, pageCount: 1 });
      },
      async buffer(url) {
        mediaRequests += 1;
        if (mediaRequests === 1) {
          throw Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' });
        }
        return jpegDownload(url);
      },
    }),
    { randomInteger() { return 0; } },
  );

  assert.equal(feedRequests, 1);
  assert.equal(mediaRequests, 2);
  assert.equal(result.url, thumbnail(1280, 0));
  assert.equal(result.fileName, 'media.jpg');
});

test('PornPics limits persistent network failures to two media attempts', async () => {
  let mediaRequests = 0;
  await assert.rejects(fetchPornPics(
    { endpoint: CATEGORY_URL },
    providerContext({
      async text() { return categoryPage({ itemCount: 1, pageCount: 1 }); },
      async buffer() {
        mediaRequests += 1;
        throw new MediaProviderError('fetch failed', { code: 'NETWORK_ERROR' });
      },
    }),
    { randomInteger() { return 0; } },
  ), (error) => error.code === 'NETWORK_ERROR');
  assert.equal(mediaRequests, 2);
});

test('PornPics aligns a high random offset to the first JSON item without gallery navigation', async () => {
  const requests = [];
  const offsetItem = {
    mid: '15496516_115679360',
    g_url: 'https://www.pornpics.com/galleries/never-request-this/',
    t_url: thumbnail(300, 43),
    t_url_460: thumbnail(460, 43),
  };
  const result = await fetchPornPics({ endpoint: CATEGORY_URL }, providerContext({
    async text(url, options) {
      requests.push({ method: 'text', url, options });
      return url === CATEGORY_URL ? categoryPage() : JSON.stringify([offsetItem]);
    },
    async buffer(url, options) {
      requests.push({ method: 'buffer', url, options });
      return jpegDownload(url);
    },
  }), {
    randomInteger(minimum, maximum) {
      assert.deepEqual([minimum, maximum], [0, 999]);
      return 543;
    },
  });

  assert.deepEqual(requests.map(({ url }) => url), [
    CATEGORY_URL,
    `${CATEGORY_URL}?offset=543`,
    thumbnail(1280, 43),
  ]);
  assert.equal(requests.some(({ url }) => url.includes('/galleries/')), false);
  assert.equal(requests[1].options.maximumBytes, PORNPICS_MAXIMUM_OFFSET_BYTES);
  assert.deepEqual(requests[1].options.allowedHosts, ['pornpics.com']);
  assert.deepEqual(requests[2].options.allowedHosts, ['cdni.pornpics.com']);
  assert.equal(result.id, offsetItem.mid);
  assert.equal(result.url, thumbnail(1280, 43));
  assert.equal(result.watchUrl, thumbnail(1280, 43));
  assert.equal(result.fileName, 'media.jpg');
});

test('PornPics uses the same exact-offset JSON route when an initial thumbnail is absent', async () => {
  const requests = [];
  const result = await fetchPornPics({ endpoint: CATEGORY_URL }, providerContext({
    async text(url) {
      requests.push(url);
      if (url === CATEGORY_URL) return categoryPage({ itemCount: 1 });
      return JSON.stringify([{ gid: 77, t_url_460: thumbnail(460, 77) }]);
    },
    async buffer(url) {
      requests.push(url);
      return jpegDownload(url);
    },
  }), {
    randomInteger() { return 7; },
  });

  assert.deepEqual(requests, [
    CATEGORY_URL,
    `${CATEGORY_URL}?offset=7`,
    thumbnail(1280, 77),
  ]);
  assert.equal(result.id, '77');
  assert.equal(result.url, thumbnail(1280, 77));
  assert.equal(result.fileName, 'media.jpg');
});

test('PornPics rejects anti-bot HTML, empty arrays, and foreign cover hosts', async () => {
  assert.throws(
    () => parsePornPicsOffsetPayload('<html>challenge</html>', 500),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  assert.throws(
    () => parsePornPicsOffsetPayload('[]', 500),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  assert.throws(
    () => parsePornPicsOffsetPayload(JSON.stringify([{ t_url_460: 'https://evil.example/460/image.jpg' }]), 500),
    (error) => error.code === 'INVALID_RESPONSE',
  );

  await assert.rejects(fetchPornPics({ endpoint: 'https://evil.example/butt-plug/' }, providerContext({
    async text() { assert.fail('an invalid category URL must be rejected before network I/O'); },
  })), (error) => error.code === 'INVALID_URL');
});

test('PornPics rejects CDN block pages and insecure or foreign media redirects', async () => {
  let mediaRequests = 0;
  const fetchWithDownload = (download) => fetchPornPics(
    { endpoint: CATEGORY_URL },
    providerContext({
      async text() { return categoryPage({ itemCount: 1, pageCount: 1 }); },
      async buffer(url) {
        mediaRequests += 1;
        return download(url);
      },
    }),
    { randomInteger() { return 0; } },
  );

  await assert.rejects(fetchWithDownload((url) => ({
    buffer: Buffer.from('<html><body>Site Unavailable</body></html>'),
    contentType: 'text/html',
    finalUrl: url,
  })), (error) => error.code === 'INVALID_RESPONSE');
  assert.equal(mediaRequests, 1, 'an HTML policy block must never be retried');

  for (const finalUrl of [
    'http://cdni.pornpics.com/1280/3/17/1/image.jpg',
    'https://evil.example/1280/3/17/1/image.jpg',
  ]) {
    await assert.rejects(
      fetchWithDownload(() => ({ ...jpegDownload(finalUrl), finalUrl })),
      (error) => error.code === 'INVALID_URL',
    );
  }
  assert.equal(mediaRequests, 3, 'invalid redirect responses must never be retried');
});

test('/buttplug isolates explicit Real and Anime selections and preserves them in Refresh state', async () => {
  assert.deepEqual(buttplug.data.options[0].choices, [
    { name: 'Anime', value: 'Anime' },
    { name: 'Real', value: 'Real' },
  ]);
  assert.equal(buttplug.media.optionName, 'style');
  assert.equal(buttplug.media.randomGroups, undefined);
  assert.deepEqual(buttplug.media.groups, {
    Anime: [{ provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/buttplug' }],
    Real: [{ provider: 'pornpics', endpoint: CATEGORY_URL }],
  });

  const realResponder = commandResponder();
  await buttplug.execute(commandContext(realResponder, {
    async text() { return categoryPage({ itemCount: 10, pageCount: 1 }); },
    async buffer(url) { return jpegDownload(url); },
    async json() { assert.fail('Real style must not call the Anime ABD API'); },
  }, { style: 'Real' }));
  const realEdit = realResponder.calls[1];
  const realUrl = realEdit.body.components[0].components[1].url;
  assert.equal(realEdit.body.embeds[0].image.url, 'attachment://media.jpg');
  assert.deepEqual(realEdit.body.attachments, [{ id: 0, filename: 'media.jpg' }]);
  assert.equal(realEdit.files[0].contentType, 'image/jpeg');
  assert.equal(realEdit.files[0].data.length, 2_048);
  assert.match(realUrl, /^https:\/\/cdni\.pornpics\.com\/1280\//);
  assert.equal(realEdit.body.components[0].components[0].custom_id, 'm:buttplug:style=Real');

  const refreshResponder = commandResponder();
  await buttplug.execute(commandContext(refreshResponder, {
    async text() { return categoryPage({ itemCount: 10, pageCount: 1 }); },
    async buffer(url) { return jpegDownload(url); },
    async json() { assert.fail('a Real refresh must not call the Anime ABD API'); },
  }, { source: 'component' }), { style: 'Real' });
  assert.equal(refreshResponder.calls[0].method, 'deferUpdate');
  assert.equal(
    refreshResponder.calls[1].body.components[0].components[0].custom_id,
    'm:buttplug:style=Real',
  );
  assert.equal(refreshResponder.calls[1].body.embeds[0].image.url, 'attachment://media.jpg');
  assert.equal(refreshResponder.calls[1].body.components[0].components[1].url.startsWith(
    'https://cdni.pornpics.com/1280/',
  ), true);

  const animeResponder = commandResponder();
  const osakaUrl = 'https://n-sfw.ap-osaka-1.s3.ink/buttplug.webp';
  await buttplug.execute(commandContext(animeResponder, {
    async text() { assert.fail('Anime style must not call the Real PornPics feed'); },
    async json(url) {
      assert.equal(url, 'https://api.n-sfw.com/nsfw/buttplug');
      return { url_japan: osakaUrl };
    },
    async expiredCertificateHttpsBuffer(url) {
      assert.equal(url, osakaUrl);
      return { buffer: Buffer.from('anime'), contentType: 'image/webp', finalUrl: url };
    },
  }, { style: 'Anime' }));
  const animeEdit = animeResponder.calls[1];
  assert.equal(animeEdit.body.embeds[0].image.url, 'attachment://media.webp');
  assert.equal(animeEdit.body.components[0].components[0].custom_id, 'm:buttplug:style=Anime');
  assert.equal(animeEdit.body.components[0].components[1].url, osakaUrl);
});

test('/buttplug without a style uses the same flattened fallback pool as /ass and /anal', async () => {
  const attempted = [];
  const responder = commandResponder();
  await buttplug.execute(commandContext(responder, {
    async text() {
      attempted.push('Real');
      throw Object.assign(new Error('PornPics unavailable'), { code: 'HTTP_ERROR' });
    },
    async json() {
      attempted.push('Anime');
      throw Object.assign(new Error('ABD unavailable'), { code: 'HTTP_ERROR' });
    },
  }));

  assert.deepEqual(attempted.sort(), ['Anime', 'Real']);
  assert.equal(responder.calls[0].method, 'defer');
  assert.equal(responder.calls[1].body.embeds[0].description, 'No media source returned a usable result. Please try again.');
});
