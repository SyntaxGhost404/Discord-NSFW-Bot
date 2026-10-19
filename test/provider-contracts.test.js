import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNekoBot } from '../src/brain/providers/nekobot.js';
import { fetchWaifuIm } from '../src/brain/providers/waifu-im.js';

function context(http, config = {}) {
  return {
    http,
    config: {
      nekoBotAuthorization: 'legacy-auth-value',
      waifuImKey: 'waifu-key',
      ...config,
    },
  };
}

test('NekoBot retains its Authorization header and type parameter', async () => {
  let captured;
  const result = await fetchNekoBot({ type: 'pgif' }, context({
    async json(url, options) {
      captured = { url, options };
      return { success: true, message: 'https://cdn.example/media.gif' };
    },
  }));
  assert.equal(captured.url, 'https://nekobot.xyz/api/image?type=pgif');
  assert.equal(captured.options.headers.Authorization, 'legacy-auth-value');
  assert.equal(result.url, 'https://cdn.example/media.gif');
});

test('Waifu.im retains v7 headers and exact query parameter names', async () => {
  let captured;
  const result = await fetchWaifuIm({ tag: 'oppai', isNsfw: true }, context({
    async json(url, options) {
      captured = { url, options };
      return { items: [{ url: 'https://cdn.example/waifu.png' }] };
    },
  }));
  assert.equal(captured.url, 'https://api.waifu.im/images');
  assert.deepEqual(captured.options.query, { IncludedTags: 'oppai', IsNsfw: 'True' });
  assert.deepEqual(captured.options.headers, {
    Authorization: 'ApiKey waifu-key',
    'Accept-Version': 'v7',
  });
  assert.equal(result.url, 'https://cdn.example/waifu.png');
});
