import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAhottie } from '../src/brain/providers/ahottie.js';
import {
  ahottieMaximumPage,
  cleanHentaiCosplayUrl,
  cleanImgboxUrl,
  extractAhottieMedia,
  extractHentaiCosplayMedia,
  hentaiCosplayMaximumPage,
} from '../src/brain/providers/cosplay-feed.js';
import { fetchHentaiCosplayXxx } from '../src/brain/providers/hentai-cosplay-xxx.js';

const primaryPage = `
  <html><body>
    <ul id="image-list">
      <li><a href="/image/gallery-one/"><img
        src="https://static17.hentai-cosplay-xxx.com/upload/20260608/441/450585/p=160x200/1.webp"
        data-original="https://static17.hentai-cosplay-xxx.com/upload/20260608/441/450585/p=700/1.webp"
      ></a></li>
      <li><a href="/image/gallery-two/"><img
        srcset="//static18.hentai-cosplay-xxx.com/upload/20260609/442/450586/p=160x200/2.webp 160w,
          //static18.hentai-cosplay-xxx.com/upload/20260609/442/450586/p=700/2.webp 700w"
      ></a></li>
      <li><img src="https://static18.hentai-cosplay-xxx.com/upload/20260609/442/450586/p=700/2.webp"></li>
    </ul>
    <nav><a class="next last" href="/search/page/18104/">Last</a></nav>
  </body></html>
`;

const ahottiePage = `
  <html><body>
    <a href="https://ahottie.top/albums/first">
      <img src="https://thumbs2.imgbox.com/aa/bb/cosplay-one_t.jpg">
    </a>
    <a href="https://ahottie.top/albums/second">
      <img data-src="https://images3.imgbox.com/cc/dd/cosplay-two.webp">
    </a>
    <a href="https://ads.example/campaign">
      <img src="https://images9.imgbox.com/ad/ad/not-cosplay.jpg">
    </a>
    <nav>
      <a href="/tags/Cosplay?page=2">2</a>
      <a href="/tags/Cosplay?sort=new&amp;page=82">Last</a>
    </nav>
  </body></html>
`;

function providerContext(http) {
  return {
    http,
    config: { mediaTimeoutMs: 15_000 },
    maxMediaBytes: 10 * 1024 * 1024,
  };
}

test('primary cosplay feed discovers all pages and extracts cleaned media without gallery navigation', async () => {
  const requests = [];
  const expectedCandidates = [
    'https://static17.hentai-cosplay-xxx.com/upload/20260608/441/450585/1.webp',
    'https://static18.hentai-cosplay-xxx.com/upload/20260609/442/450586/2.webp',
  ];
  const result = await fetchHentaiCosplayXxx({}, providerContext({
    async text(url, options) {
      requests.push({ method: 'text', url, options });
      return primaryPage;
    },
    async buffer(url, options) {
      requests.push({ method: 'buffer', url, options });
      return {
        buffer: Buffer.from('primary-media'),
        contentType: 'image/webp',
        finalUrl: url,
      };
    },
  }), {
    randomInteger(minimum, maximum) {
      assert.deepEqual([minimum, maximum], [1, 18_104]);
      return 12_345;
    },
    choose(items) {
      assert.deepEqual(items, expectedCandidates);
      return items[1];
    },
  });

  assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [
    { method: 'text', url: 'https://hentai-cosplay-xxx.com/search/page/1/' },
    { method: 'text', url: 'https://hentai-cosplay-xxx.com/search/page/12345/' },
    { method: 'buffer', url: expectedCandidates[1] },
  ]);
  assert.equal(requests.some(({ url }) => url.includes('/image/')), false);
  assert.equal(requests[0].options.maximumBytes, 2 * 1024 * 1024);
  assert.deepEqual(requests[2].options.allowedHosts, ['hentai-cosplay-xxx.com']);
  assert.equal(result.url, expectedCandidates[1]);
  assert.equal(result.watchUrl, expectedCandidates[1]);
  assert.equal(result.buffer.toString(), 'primary-media');
  assert.equal(result.fileName, 'media.webp');
});

test('primary cosplay page and candidate offsets are recalculated on every execution', async () => {
  const selectedPages = [17, 9_001];
  const requestedPages = [];
  const dependencies = {
    randomInteger() { return selectedPages.shift(); },
    choose(items) { return items[0]; },
  };
  const http = {
    async text(url) {
      requestedPages.push(url);
      return primaryPage;
    },
    async buffer(url) {
      return { buffer: Buffer.from('media'), contentType: 'image/webp', finalUrl: url };
    },
  };

  await fetchHentaiCosplayXxx({}, providerContext(http), dependencies);
  await fetchHentaiCosplayXxx({}, providerContext(http), dependencies);

  assert.deepEqual(requestedPages, [
    'https://hentai-cosplay-xxx.com/search/page/1/',
    'https://hentai-cosplay-xxx.com/search/page/17/',
    'https://hentai-cosplay-xxx.com/search/page/1/',
    'https://hentai-cosplay-xxx.com/search/page/9001/',
  ]);
  assert.deepEqual(selectedPages, []);
});

test('Ahottie fallback extracts and promotes direct Imgbox media from the index feed only', async () => {
  const requests = [];
  const expectedCandidates = [
    'https://images2.imgbox.com/aa/bb/cosplay-one_o.jpg',
    'https://images3.imgbox.com/cc/dd/cosplay-two.webp',
  ];
  const result = await fetchAhottie({}, providerContext({
    async text(url) {
      requests.push({ method: 'text', url });
      return ahottiePage;
    },
    async buffer(url, options) {
      requests.push({ method: 'buffer', url, options });
      return { buffer: Buffer.from('fallback-media'), contentType: 'image/jpeg', finalUrl: url };
    },
  }), {
    randomInteger(minimum, maximum) {
      assert.deepEqual([minimum, maximum], [1, 82]);
      return 41;
    },
    choose(items) {
      assert.deepEqual(items, expectedCandidates);
      return items[0];
    },
  });

  assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [
    { method: 'text', url: 'https://ahottie.top/tags/Cosplay?page=1' },
    { method: 'text', url: 'https://ahottie.top/tags/Cosplay?page=41' },
    { method: 'buffer', url: expectedCandidates[0] },
  ]);
  assert.equal(requests.some(({ url }) => url.includes('/albums/')), false);
  assert.deepEqual(requests[2].options.allowedHosts, ['imgbox.com']);
  assert.equal(result.url, expectedCandidates[0]);
  assert.equal(result.watchUrl, expectedCandidates[0]);
  assert.equal(result.fileName, 'media.jpg');
});

test('cosplay HTML parsers reject stale ceilings, unrelated hosts, and duplicate candidates', () => {
  assert.equal(hentaiCosplayMaximumPage(primaryPage), 18_104);
  assert.equal(ahottieMaximumPage(ahottiePage), 82);
  assert.deepEqual(
    extractHentaiCosplayMedia(primaryPage, 'https://hentai-cosplay-xxx.com/search/page/1/'),
    [
      'https://static17.hentai-cosplay-xxx.com/upload/20260608/441/450585/1.webp',
      'https://static18.hentai-cosplay-xxx.com/upload/20260609/442/450586/2.webp',
    ],
  );
  assert.deepEqual(
    extractAhottieMedia(ahottiePage, 'https://ahottie.top/tags/Cosplay?page=1'),
    [
      'https://images2.imgbox.com/aa/bb/cosplay-one_o.jpg',
      'https://images3.imgbox.com/cc/dd/cosplay-two.webp',
    ],
  );
  assert.equal(cleanHentaiCosplayUrl('https://evil.example/p=700/image.webp', 'https://hentai-cosplay-xxx.com/'), null);
  assert.equal(cleanImgboxUrl('https://evil.example/image.jpg', 'https://ahottie.top/'), null);
  assert.throws(() => hentaiCosplayMaximumPage('<html>no pagination</html>'), (error) => error.code === 'INVALID_RESPONSE');
  assert.throws(() => ahottieMaximumPage('<html>no pagination</html>'), (error) => error.code === 'INVALID_RESPONSE');
});

test('cosplay providers reject successful anti-bot HTML responses as non-image media', async () => {
  await assert.rejects(fetchHentaiCosplayXxx({}, providerContext({
    async text() { return primaryPage; },
    async buffer(url) {
      return { buffer: Buffer.from('<html>challenge</html>'), contentType: 'text/html', finalUrl: url };
    },
  }), {
    randomInteger() { return 1; },
    choose(items) { return items[0]; },
  }), (error) => error.code === 'INVALID_RESPONSE');
});

test('cosplay providers reject insecure media redirects before exposing a Link button', async () => {
  await assert.rejects(fetchHentaiCosplayXxx({}, providerContext({
    async text() { return primaryPage; },
    async buffer(url) {
      return {
        buffer: Buffer.from('media'),
        contentType: 'image/webp',
        finalUrl: url.replace('https:', 'http:'),
      };
    },
  }), {
    randomInteger() { return 1; },
    choose(items) { return items[0]; },
  }), (error) => error.code === 'INVALID_URL');
});
