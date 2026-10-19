import assert from 'node:assert/strict';
import test from 'node:test';
import cosplay from '../src/commands/cosplay.js';
import { MediaProviderError } from '../src/brain/providers/errors.js';
import { Logger } from '../src/lib/logger.js';

const primaryFeed = `
  <ul id="image-list">
    <li><img src="https://static17.hentai-cosplay-xxx.com/upload/20260608/1/p=700/primary.webp"></li>
  </ul>
  <a class="last" href="/search/page/2/">Last</a>
`;

const fallbackFeed = `
  <a href="https://ahottie.top/albums/example">
    <img src="https://images2.imgbox.com/aa/bb/fallback.jpg">
  </a>
  <a href="/tags/Cosplay?page=2">Last</a>
`;

function responder() {
  const calls = [];
  return {
    calls,
    async defer() { calls.push({ method: 'defer' }); },
    async editOriginal(body, files = []) { calls.push({ method: 'editOriginal', body, files }); },
  };
}

function commandContext(commandResponder, http) {
  return {
    source: 'command',
    responder: commandResponder,
    interaction: {
      id: '123456789012345678',
      data: { options: [] },
      user: { id: '234567890123456789', username: 'tester', discriminator: '0', avatar: null },
    },
    http,
    config: {},
    maxMediaBytes: 10 * 1024 * 1024,
    logger: new Logger('error'),
  };
}

test('cosplay uses its primary feed first and renders native media with Refresh and direct Link', async () => {
  const response = responder();
  const requests = [];
  await cosplay.execute(commandContext(response, {
    async text(url) {
      requests.push(url);
      assert.ok(url.startsWith('https://hentai-cosplay-xxx.com/search/page/'));
      return primaryFeed;
    },
    async buffer(url) {
      requests.push(url);
      return { buffer: Buffer.from('media'), contentType: 'image/webp', finalUrl: url };
    },
  }));

  const edit = response.calls[1];
  assert.equal(edit.body.embeds[0].image.url, 'attachment://media.webp');
  assert.equal(edit.body.components[0].components.length, 2);
  assert.match(edit.body.components[0].components[0].label, /Refresh/);
  assert.equal(edit.body.components[0].components[0].custom_id, 'm:cosplay');
  assert.match(edit.body.components[0].components[1].label, /Link/);
  assert.equal(
    edit.body.components[0].components[1].url,
    'https://static17.hentai-cosplay-xxx.com/upload/20260608/1/primary.webp',
  );
  assert.equal(requests.some((url) => url.startsWith('https://ahottie.top/')), false);
});

test('cosplay contacts Ahottie only after the primary provider fails', async () => {
  const response = responder();
  const requests = [];
  await cosplay.execute(commandContext(response, {
    async text(url) {
      requests.push(url);
      if (url.startsWith('https://hentai-cosplay-xxx.com/')) {
        throw new MediaProviderError('primary unavailable', { code: 'HTTP_ERROR' });
      }
      return fallbackFeed;
    },
    async buffer(url) {
      requests.push(url);
      return { buffer: Buffer.from('fallback'), contentType: 'image/jpeg', finalUrl: url };
    },
  }));

  assert.ok(requests[0].startsWith('https://hentai-cosplay-xxx.com/'));
  assert.ok(requests[1].startsWith('https://ahottie.top/'));
  assert.equal(requests.some((url) => url.includes('/albums/')), false);
  const edit = response.calls[1];
  assert.equal(edit.body.embeds[0].image.url, 'attachment://media.jpg');
  assert.equal(edit.body.components[0].components.length, 2);
  assert.equal(edit.body.components[0].components[1].url, 'https://images2.imgbox.com/aa/bb/fallback.jpg');
});
