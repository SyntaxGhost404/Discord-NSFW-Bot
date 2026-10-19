import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ABD_MEDIA_HOSTS,
  fetchAbd,
  OSAKA_MEDIA_HOST,
} from '../src/brain/providers/abd.js';
import { fetchNekosV4 } from '../src/brain/providers/nekos-v4.js';
import { fetchOBoobs, fetchOButts } from '../src/brain/providers/obru.js';
import { fetchPorngifs } from '../src/brain/providers/porngifs.js';
import { fetchPorngifsTv } from '../src/brain/providers/porngifs-tv.js';
import { fetchPurrbot } from '../src/brain/providers/purrbot.js';
import { fetchSexCom } from '../src/brain/providers/sexcom.js';
import { fetchWaifuPics } from '../src/brain/providers/waifu-pics.js';

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function context(http, config = {}) {
  return {
    http,
    logger,
    maxMediaBytes: 10 * 1024 * 1024,
    config: {
      mediaTimeoutMs: 15_000,
      waifuPicsEnabled: true,
      ...config,
    },
  };
}

test('Purrbot, Waifu.pics, and Nekos v4 retain their archived response contracts', async () => {
  const purrbotEndpoint = 'https://purrbot.site/api/img/nsfw/anal/gif';
  const purrbot = await fetchPurrbot({ endpoint: purrbotEndpoint }, context({
    async json(url) {
      assert.equal(url, purrbotEndpoint);
      return { link: 'https://cdn.example/purr.gif' };
    },
  }));
  assert.equal(purrbot.url, 'https://cdn.example/purr.gif');

  const waifuEndpoint = 'https://api.waifu.pics/nsfw/waifu';
  const waifu = await fetchWaifuPics({ endpoint: waifuEndpoint }, context({
    async json(url) {
      assert.equal(url, waifuEndpoint);
      return { url: 'https://cdn.example/waifu.png' };
    },
  }));
  assert.equal(waifu.url, 'https://cdn.example/waifu.png');

  const nekosEndpoint = 'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=maid';
  const nekos = await fetchNekosV4({ endpoint: nekosEndpoint }, context({
    async json(url) {
      assert.equal(url, nekosEndpoint);
      return [{ url: 'https://cdn.example/nekos.webp' }];
    },
  }));
  assert.equal(nekos.url, 'https://cdn.example/nekos.webp');
});

test('N-SFW exclusively downloads url_japan from the exact Osaka host', async () => {
  const endpoint = 'https://api.n-sfw.com/nsfw/anal';
  const osakaUrl = `https://${OSAKA_MEDIA_HOST}/media.gif`;
  const calls = [];
  const result = await fetchAbd({ endpoint }, context({
    async json(url) {
      calls.push({ method: 'json', url });
      return {
        url: 'https://cdn.n-sfw.com/media.gif',
        url_cdn: 'https://n-sfw.cdn.s3.ink/media.gif',
        url_usa: 'https://n-sfw.us-phoenix-1.s3.ink/media.gif',
        url_japan: osakaUrl,
      };
    },
    async buffer() {
      assert.fail('ABD must not contact non-Osaka mirrors');
    },
    async expiredCertificateHttpsBuffer(url, options) {
      calls.push({ method: 'osaka', url, options });
      return { buffer: Buffer.from('media'), contentType: 'image/gif', finalUrl: url };
    },
  }));
  assert.deepEqual(calls[0], { method: 'json', url: endpoint });
  assert.deepEqual(calls[1], {
    method: 'osaka',
    url: osakaUrl,
    options: {
      minimumBytes: 1_024,
      allowedHosts: ABD_MEDIA_HOSTS,
      allowSubdomains: false,
      timeoutMs: 5_000,
    },
  });
  assert.equal(result.url, osakaUrl);
  assert.equal(result.watchUrl, osakaUrl);
  assert.equal(result.fileName, 'media.gif');
  assert.equal(result.buffer.toString(), 'media');
});

test('N-SFW requires url_japan even when other mirrors are present', async () => {
  let downloaded = false;
  await assert.rejects(fetchAbd({ endpoint: 'https://api.n-sfw.com/nsfw/breeding' }, context({
    async json() {
      return {
        url: 'https://cdn.n-sfw.com/media.png',
        url_cdn: 'https://n-sfw.cdn.s3.ink/media.png',
        url_usa: 'https://n-sfw.us-phoenix-1.s3.ink/media.png',
      };
    },
    async expiredCertificateHttpsBuffer() {
      downloaded = true;
    },
  })), (error) => error.code === 'INVALID_RESPONSE');
  assert.equal(downloaded, false);
});

test('N-SFW rejects a substituted Osaka hostname before the expiry compatibility path', async () => {
  let downloaded = false;
  await assert.rejects(fetchAbd({ endpoint: 'https://api.n-sfw.com/nsfw/anal' }, context({
    async json() {
      return { url_japan: 'https://attacker.s3.ink/media.png' };
    },
    async expiredCertificateHttpsBuffer() {
      downloaded = true;
    },
  })), (error) => error.code === 'UNEXPECTED_HOST');
  assert.equal(downloaded, false);
});

test('N-SFW never returns an unverified direct URL when every native download fails', async () => {
  await assert.rejects(fetchAbd({ endpoint: 'https://api.n-sfw.com/nsfw/anal' }, context({
    async json() {
      return { url_japan: `https://${OSAKA_MEDIA_HOST}/media.png` };
    },
    async expiredCertificateHttpsBuffer() {
      throw Object.assign(new Error('upstream unavailable'), { code: 'HTTP_ERROR' });
    },
  })), (error) => error.code === 'PROVIDER_ERROR');
});

test('Oboobs and Obutts retain random, by-ID, and media URL templates', async () => {
  const calls = [];
  const http = {
    async json(url) {
      calls.push(url);
      return [{ id: 42, preview: 'preview/path.jpg' }];
    },
  };
  const boobs = await fetchOBoobs({}, context(http));
  const butts = await fetchOButts({ id: 42 }, context(http));
  assert.deepEqual(calls, [
    'http://api.oboobs.ru/boobs/0/1/random/',
    'http://api.obutts.ru/butts/get/42/',
  ]);
  assert.equal(boobs.url, 'http://media.oboobs.ru/preview/path.jpg');
  assert.equal(butts.url, 'http://media.obutts.ru/preview/path.jpg');
});

test('Sex.com retains every query field, the exact browser header, and URL conversion', async () => {
  let request;
  const result = await fetchSexCom({ niche: 'Toys' }, context({
    async json(url, options) {
      request = { url, options };
      return { data: [{ id: 987, uri: '/images/example.webp' }] };
    },
  }));
  assert.equal(request.url, 'https://www.sex.com/portal/api/gifs/search');
  assert.equal(
    request.options.headers['User-Agent'],
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  );
  const { page, ...query } = request.options.query;
  assert.ok(Number.isInteger(page) && page >= 1 && page <= 10);
  assert.deepEqual(query, {
    'sexual-orientation': 'straight',
    order: 'likeCount',
    search: 'Toys',
    limit: 40,
  });
  assert.equal(result.url, 'https://imagex1.sx.cdn.live/images/example.gif');
  assert.equal(result.watchUrl, 'https://www.sex.com/pin/987/');
});

test('Porngifs.com retains DNS/SNI routing, headers, ranges, and retry count', async () => {
  const requests = [];
  const dependencies = {
    async lookup(hostname) {
      assert.equal(hostname, 'porngifs.com');
      return { address: '203.0.113.10' };
    },
    randomInteger(minimum, maximum) {
      assert.deepEqual([minimum, maximum], [1, 39_239]);
      return 321;
    },
    async requestHttpsBuffer(options) {
      requests.push(options);
      return {
        buffer: Buffer.from('porngif'),
        contentType: 'image/gif',
        finalUrl: options.finalUrl,
      };
    },
  };
  const result = await fetchPorngifs({}, context({}), dependencies);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    hostname: '203.0.113.10',
    path: '/img/321',
    servername: 'cdn.porngifs.com',
    headers: {
      Host: 'cdn.porngifs.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Referer: 'https://porngifs.com/',
      Accept: 'image/*',
    },
    timeoutMs: 15_000,
    maximumBytes: 10 * 1024 * 1024,
    minimumBytes: 1_025,
    finalUrl: 'https://cdn.porngifs.com/img/321',
  });
  assert.equal(result.id, '321');
  assert.equal(result.fileName, 'media.gif');

  let attempts = 0;
  await assert.rejects(fetchPorngifs({}, context({}), {
    ...dependencies,
    async requestHttpsBuffer() {
      attempts += 1;
      throw new Error('unavailable');
    },
  }));
  assert.equal(attempts, 15);
});

test('Porngifs.com DNS lookup yields promptly to graceful shutdown', async () => {
  const shutdown = new AbortController();
  const providerContext = context({});
  providerContext.signal = shutdown.signal;
  let downloadCalls = 0;
  const request = fetchPorngifs({}, providerContext, {
    lookup: async () => new Promise(() => {}),
    randomInteger: () => 1,
    async requestHttpsBuffer() { downloadCalls += 1; },
  });
  shutdown.abort(new Error('application shutdown'));
  await assert.rejects(request, (error) => error.code === 'ABORTED');
  assert.equal(downloadCalls, 0);
});

test('Porngifs.tv retains its AJAX contract and bounded CDN attachment flow', async () => {
  let pageRequest;
  let mediaRequest;
  const result = await fetchPorngifsTv({}, context({
    async text(url, options) {
      pageRequest = { url, options };
      return '<a data-webp="https://content.porngifs.tv/media/example.webp"></a>';
    },
    async buffer(url, options) {
      mediaRequest = { url, options };
      return { buffer: Buffer.from('media'), contentType: 'image/webp', finalUrl: url };
    },
  }));
  const endpoint = new URL(pageRequest.url);
  const page = Number(endpoint.searchParams.get('from'));
  assert.equal(endpoint.origin, 'https://porngifs.tv');
  assert.deepEqual(Object.fromEntries(endpoint.searchParams), {
    action: 'ajax',
    mode: 'async',
    function: 'get_block',
    block_id: 'list_videos_most_recent_videos',
    sort_by: 'post_date',
    from: String(page),
  });
  assert.ok(Number.isInteger(page) && page >= 1 && page <= 2_603);
  assert.deepEqual(pageRequest.options.headers, {
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  });
  assert.deepEqual(mediaRequest, {
    url: 'https://content.porngifs.tv/media/example.webp',
    options: { minimumBytes: 1_025, allowedHosts: ['porngifs.tv'] },
  });
  assert.equal(result.fileName, 'media.webp');
});
