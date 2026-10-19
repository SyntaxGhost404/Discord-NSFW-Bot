import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCommands } from '../src/brain/command-loader.js';
import { Logger } from '../src/lib/logger.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const commands = await loadCommands(path.join(root, 'src', 'commands'), new Logger('error'));

const expectedPublicCommands = [
  '4k', 'anal', 'ass', 'blowjob', 'boobs', 'breeding', 'buttplug', 'cages', 'cum',
  'cosplay', 'ecchi', 'ero', 'feet', 'fuck', 'gif', 'gonewild', 'help', 'hentai', 'invite',
  'kitsune', 'legs', 'maid', 'midriff', 'milf', 'neko', 'paizuri', 'petgirls',
  'ping', 'premium', 'pussy', 'pussylick', 'selfie', 'smothering', 'socks', 'solo', 'tentacle',
  'thigh', 'threesome', 'uniform', 'waifu', 'yuri',
].sort();

test('the rebuilt command registry exposes all legacy commands plus active additions', () => {
  const publicNames = [...commands.values()]
    .filter((command) => !command.hidden)
    .map((command) => command.data.name)
    .sort();
  assert.deepEqual(publicNames, expectedPublicCommands);
  assert.equal(commands.size, 42, 'the registry also contains one hidden component handler');
});

test('every media command is age-restricted and available in the original contexts', () => {
  const mediaCommands = [...commands.values()].filter((command) => command.kind === 'media');
  assert.equal(mediaCommands.length, 37);
  for (const command of mediaCommands) {
    assert.equal(command.data.nsfw, true, command.data.name);
    assert.deepEqual(command.data.integration_types, [0, 1], command.data.name);
    assert.deepEqual(command.data.contexts, [0, 1, 2], command.data.name);
    assert.equal(command.data.type, 1, command.data.name);
  }
});

test('utility commands remain safe commands', () => {
  for (const name of ['help', 'invite', 'ping', 'premium']) {
    assert.equal(commands.get(name).data.nsfw, false, name);
  }
});

test('premium accepts one optional raw Discord user option', () => {
  assert.deepEqual(commands.get('premium').data.options, [{
    type: 6,
    name: 'user',
    description: 'User whose plan and remaining quotas you want to view.',
    required: false,
  }]);
});

test('legacy and active command options expose their exact choice values', () => {
  for (const name of ['anal', 'ass', 'blowjob', 'boobs', 'buttplug', 'feet', 'thigh']) {
    const option = commands.get(name).data.options[0];
    assert.equal(option.name, 'style');
    assert.deepEqual(option.choices, [
      { name: 'Anime', value: 'Anime' },
      { name: 'Real', value: 'Real' },
    ]);
  }
  assert.deepEqual(commands.get('solo').data.options[0].choices, [
    { name: 'Female', value: 'female' },
    { name: 'Male', value: 'male' },
  ]);
  assert.deepEqual(commands.get('threesome').data.options[0].choices, [
    { name: '3 Females', value: 'fff' },
    { name: '2 Females 1 Male', value: 'ffm' },
    { name: '2 Males 1 Female', value: 'mmf' },
  ]);
  assert.equal(commands.get('help').data.options[0].autocomplete, true);
});
