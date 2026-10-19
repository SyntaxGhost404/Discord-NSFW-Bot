import assert from 'node:assert/strict';
import test from 'node:test';
import { registerCommands } from '../src/brain/command-registration.js';
import { Logger } from '../src/lib/logger.js';

function command(name, hidden = false) {
  return {
    hidden,
    data: {
      type: 1,
      name,
      description: `${name} description`,
      integration_types: [0, 1],
      contexts: [0, 1, 2],
      nsfw: false,
      options: [],
    },
  };
}

test('automatic registration excludes hidden handlers and uses scope-valid fields', async () => {
  const requests = [];
  const rest = {
    async put(route, options) {
      requests.push({ route, body: options.body });
    },
  };
  await registerCommands({
    rest,
    clientId: '12345678901234567',
    guildId: '76543210987654321',
    mode: 'both',
    commands: new Map([
      ['public', command('public')],
      ['internal', command('internal', true)],
    ]),
    logger: new Logger('error'),
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].route, '/applications/12345678901234567/commands');
  assert.equal(requests[0].body.length, 1);
  assert.deepEqual(requests[0].body[0].integration_types, [0, 1]);
  assert.deepEqual(requests[0].body[0].contexts, [0, 1, 2]);
  assert.equal(requests[1].route, '/applications/12345678901234567/guilds/76543210987654321/commands');
  assert.equal(requests[1].body.length, 1);
  assert.equal('integration_types' in requests[1].body[0], false);
  assert.equal('contexts' in requests[1].body[0], false);
});
