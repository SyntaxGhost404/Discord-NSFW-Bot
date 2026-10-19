import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeState,
  encodeState,
  focusedOption,
  mediaCustomId,
  modalValue,
  optionValue,
  parseMediaCustomId,
  resolvedUser,
} from '../src/discord/interaction-data.js';

test('interaction options are read recursively', () => {
  const interaction = { data: { options: [{ name: 'group', options: [{ name: 'style', value: 'Anime' }] }] } };
  assert.equal(optionValue(interaction, 'style'), 'Anime');
});

test('resolved user options use Discord resolved data and default to the requester', () => {
  const author = { id: '123456789012345678', username: 'author' };
  const target = { id: '234567890123456789', username: 'target' };
  const interaction = {
    user: author,
    data: {
      options: [{ name: 'user', value: target.id }],
      resolved: { users: { [target.id]: target } },
    },
  };
  assert.equal(resolvedUser(interaction, 'user'), target);
  assert.equal(resolvedUser({ user: author, data: { options: [] } }, 'user'), author);
});

test('focused autocomplete option is found recursively', () => {
  const interaction = { data: { options: [{ name: 'command', value: 'he', focused: true }] } };
  assert.deepEqual(focusedOption(interaction), { name: 'command', value: 'he', focused: true });
});

test('modal values are extracted from action rows', () => {
  const interaction = { data: { components: [{ components: [{ custom_id: 'search_query', value: 'ping' }] }] } };
  assert.equal(modalValue(interaction, 'search_query'), 'ping');
});

test('component state round trips safely', () => {
  const state = { style: 'Anime', phrase: 'two words' };
  assert.deepEqual(decodeState(encodeState(state)), state);
  assert.deepEqual(parseMediaCustomId(mediaCustomId('anal', state)), { commandName: 'anal', state });
});
