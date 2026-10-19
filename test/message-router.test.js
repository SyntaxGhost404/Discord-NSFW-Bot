import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageRouter } from '../src/brain/message-router.js';
import { Logger } from '../src/lib/logger.js';

test('an exact bot mention receives the introduction message', async () => {
  const requests = [];
  const router = new MessageRouter({
    rest: {
      async post(route, options) { requests.push({ route, body: options.body }); },
    },
    gateway: {
      user: { id: '123456789012345678', username: 'MediaBot', discriminator: '0', avatar: null },
    },
    logger: new Logger('error'),
  });
  await router.handle({
    id: '234567890123456789',
    channel_id: '345678901234567890',
    guild_id: '456789012345678901',
    content: '<@123456789012345678>',
    author: { id: '567890123456789012', bot: false },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, '/channels/345678901234567890/messages');
  assert.equal(requests[0].body.message_reference.message_id, '234567890123456789');
  assert.equal(requests[0].body.components[0].components[0].custom_id, 'intro:features');
});

test('ordinary messages and bot messages are ignored', async () => {
  let calls = 0;
  const router = new MessageRouter({
    rest: { async post() { calls += 1; } },
    gateway: { user: { id: '123456789012345678' } },
    logger: new Logger('error'),
  });
  await router.handle({ content: 'hello', author: { bot: false } });
  await router.handle({ content: '<@123456789012345678>', author: { bot: true } });
  assert.equal(calls, 0);
});
