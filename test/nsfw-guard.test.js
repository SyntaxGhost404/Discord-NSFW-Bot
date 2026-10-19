import assert from 'node:assert/strict';
import test from 'node:test';
import { isNsfwContext } from '../src/brain/nsfw-guard.js';

test('direct messages retain legacy media access', () => {
  assert.equal(isNsfwContext({ channel: { type: 1 } }), true);
});

test('guild media access requires the channel NSFW flag', () => {
  assert.equal(isNsfwContext({ guild_id: '1', channel: { type: 0, nsfw: true } }), true);
  assert.equal(isNsfwContext({ guild_id: '1', channel: { type: 0, nsfw: false } }), false);
  assert.equal(isNsfwContext({ guild_id: '1' }), false);
});
