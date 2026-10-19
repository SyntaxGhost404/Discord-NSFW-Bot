import assert from 'node:assert/strict';
import test from 'node:test';
import help from '../src/commands/help.js';
import ping from '../src/commands/ping.js';

function responseRecorder() {
  const calls = [];
  return {
    calls,
    async defer() { calls.push({ method: 'defer' }); },
    async deferUpdate() { calls.push({ method: 'deferUpdate' }); },
    async editOriginal(body) { calls.push({ method: 'editOriginal', body }); },
    async modal(data) { calls.push({ method: 'modal', data }); },
    async autocomplete(choices) { calls.push({ method: 'autocomplete', choices }); },
  };
}

function context(source, responder, interaction = {}) {
  return {
    source,
    responder,
    interaction: {
      data: { options: [] },
      user: { id: '123456789012345678', username: 'tester', discriminator: '0', avatar: null },
      ...interaction,
    },
    commands: new Map([['help', help], ['ping', ping]]),
  };
}

test('help slash command renders the paginated public directory', async () => {
  const responder = responseRecorder();
  await help.execute(context('command', responder), {});
  assert.equal(responder.calls[0].method, 'defer');
  assert.equal(responder.calls[1].method, 'editOriginal');
  assert.match(responder.calls[1].body.embeds[0].description, /`\/help`/);
  assert.match(responder.calls[1].body.embeds[0].description, /`\/ping`/);
});

test('help search button opens a raw modal without deferring first', async () => {
  const responder = responseRecorder();
  await help.execute(context('component', responder), { customId: 'help:search:2' });
  assert.equal(responder.calls.length, 1);
  assert.equal(responder.calls[0].method, 'modal');
  assert.equal(responder.calls[0].data.custom_id, 'help:modal:2');
  assert.equal(responder.calls[0].data.components[0].components[0].custom_id, 'search_query');
});

test('help autocomplete returns matching public command names', async () => {
  const responder = responseRecorder();
  await help.autocomplete(context('autocomplete', responder, {
    data: { options: [{ name: 'command', value: 'pi', focused: true }] },
  }));
  assert.deepEqual(responder.calls[0], {
    method: 'autocomplete',
    choices: [{ name: 'ping', value: 'ping' }],
  });
});
