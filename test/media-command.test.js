import assert from 'node:assert/strict';
import test from 'node:test';
import breeding from '../src/commands/breeding.js';
import pussylick from '../src/commands/pussylick.js';
import { Logger } from '../src/lib/logger.js';

function responder() {
  const calls = [];
  return {
    calls,
    async defer() { calls.push({ method: 'defer' }); },
    async deferUpdate() { calls.push({ method: 'deferUpdate' }); },
    async editOriginal(body, files = []) { calls.push({ method: 'editOriginal', body, files }); },
  };
}

function context(commandResponder, http, source = 'command') {
  return {
    source,
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

test('media commands defer before provider work and render URL results', async () => {
  const response = responder();
  await pussylick.execute(context(response, {
    async json() { return { link: 'https://cdn.example/media.gif' }; },
  }));
  assert.equal(response.calls[0].method, 'defer');
  const edit = response.calls[1];
  assert.equal(edit.method, 'editOriginal');
  assert.equal(edit.body.embeds[0].image.url, 'https://cdn.example/media.gif');
  assert.deepEqual(edit.body.embeds[0].footer, {
    text: 'tester',
    icon_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
  });
  assert.ok(!edit.body.embeds[0].footer.text.includes('purrbot.site'));
  assert.ok(!edit.body.embeds[0].footer.text.includes('•'));
  assert.ok(!Number.isNaN(Date.parse(edit.body.embeds[0].timestamp)));
  assert.equal(edit.body.components[0].components[0].custom_id, 'm:pussylick');
  assert.equal(edit.body.components[0].components.length, 2);
  assert.match(edit.body.components[0].components[0].label, /Refresh/);
  assert.match(edit.body.components[0].components[1].label, /Link/);
  assert.equal(edit.body.components[0].components[1].style, 5);
  assert.equal(edit.body.components[0].components[1].url, 'https://cdn.example/media.gif');
  assert.deepEqual(edit.body.attachments, []);
  assert.deepEqual(edit.files, []);
});

test('media refreshes defer message updates and replace native attachments', async () => {
  const response = responder();
  const bytes = Buffer.from('animated-media');
  await breeding.execute(context(response, {
    async json() {
      return { url_japan: 'https://n-sfw.ap-osaka-1.s3.ink/media.webp' };
    },
    async expiredCertificateHttpsBuffer() {
      return { buffer: bytes, contentType: 'image/webp' };
    },
  }, 'component'));
  assert.equal(response.calls[0].method, 'deferUpdate');
  const edit = response.calls[1];
  assert.equal(edit.body.embeds[0].image.url, 'attachment://media.webp');
  assert.deepEqual(edit.body.attachments, [{ id: 0, filename: 'media.webp' }]);
  assert.equal(edit.files.length, 1);
  assert.equal(edit.files[0].data, bytes);
  assert.equal(edit.files[0].contentType, 'image/webp');
  assert.equal(edit.body.components[0].components.length, 2);
  assert.match(edit.body.components[0].components[0].label, /Refresh/);
  assert.match(edit.body.components[0].components[1].label, /Link/);
  assert.equal(edit.body.components[0].components[1].style, 5);
  assert.equal(
    edit.body.components[0].components[1].url,
    'https://n-sfw.ap-osaka-1.s3.ink/media.webp',
  );
});
