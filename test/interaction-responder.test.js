import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InteractionResponder,
  InteractionResponseState,
} from '../src/discord/interaction-responder.js';
import { DiscordRestError } from '../src/discord/rest-client.js';

function fixture() {
  const requests = [];
  const rest = {
    async post(route, options) { requests.push({ method: 'POST', route, options }); return null; },
    async patch(route, options) { requests.push({ method: 'PATCH', route, options }); return { id: 'message' }; },
  };
  const interaction = {
    id: '123456789012345678',
    application_id: '234567890123456789',
    token: 'interaction-token',
  };
  return { requests, responder: new InteractionResponder({ interaction, rest }) };
}

test('interaction replies use the raw callback endpoint exactly once', async () => {
  const { requests, responder } = fixture();
  await responder.reply({ content: 'hello', flags: 64 });
  assert.equal(responder.acknowledged, true);
  assert.deepEqual(requests[0], {
    method: 'POST',
    route: '/interactions/123456789012345678/interaction-token/callback',
    options: {
      body: { type: 4, data: { content: 'hello', flags: 64 } },
      auth: false,
      query: { with_response: false },
      retryTransient: false,
    },
  });
  await assert.rejects(responder.defer(), /only be acknowledged once/);
});

test('deferred interactions edit the original webhook response with files', async () => {
  const { requests, responder } = fixture();
  await responder.deferUpdate();
  const files = [{ name: 'media.gif', data: Buffer.from('gif') }];
  await responder.editOriginal({ attachments: [{ id: 0, filename: 'media.gif' }] }, files);
  assert.equal(requests[0].options.body.type, 6);
  assert.deepEqual(requests[1], {
    method: 'PATCH',
    route: '/webhooks/234567890123456789/interaction-token/messages/@original',
    options: {
      body: { attachments: [{ id: 0, filename: 'media.gif' }] },
      files,
      auth: false,
    },
  });
});

test('followup message POSTs explicitly use at-most-once delivery', async () => {
  const { requests, responder } = fixture();
  await responder.defer();
  await responder.followup({ content: 'one followup' });
  assert.equal(requests[1].route, '/webhooks/234567890123456789/interaction-token');
  assert.equal(requests[1].options.retryTransient, false);
  assert.deepEqual(requests[1].options.query, { wait: true });
});

test('interaction acknowledgements lock before the callback request settles', async () => {
  let release;
  const firstRequest = new Promise((resolve) => { release = resolve; });
  const interaction = {
    id: '123456789012345678',
    application_id: '234567890123456789',
    token: 'interaction-token',
  };
  const responder = new InteractionResponder({
    interaction,
    rest: { async post() { return firstRequest; } },
  });

  const first = responder.defer();
  assert.equal(responder.responseState, InteractionResponseState.ACKNOWLEDGING);
  await assert.rejects(responder.reply({ content: 'duplicate' }), /state: acknowledging/);
  release(null);
  await first;
  assert.equal(responder.acknowledged, true);
});

test('Discord error 40060 makes an interaction terminal without a second acknowledgement', async () => {
  let calls = 0;
  const responder = new InteractionResponder({
    interaction: {
      id: '123456789012345678',
      application_id: '234567890123456789',
      token: 'interaction-token',
    },
    rest: {
      async post() {
        calls += 1;
        throw new DiscordRestError('Interaction has already been acknowledged.', {
          status: 400,
          code: 40060,
          details: { code: 40060 },
          method: 'POST',
          route: '/interactions/:id/token/callback',
        });
      },
    },
  });

  await assert.rejects(responder.defer(), (error) => error.code === 40060);
  assert.equal(calls, 1);
  assert.equal(responder.acknowledged, false);
  assert.equal(responder.canAcknowledge, false);
  assert.equal(responder.responseState, InteractionResponseState.UNAVAILABLE);
});
