import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { commandPayload, commandsDiffer, guildCommandPayload, syncCommands } from '../src/brain/command-registration.js';
import { commands } from '../src/commands/index.js';
import { DiscordRest } from '../src/discord/rest.js';
import { Logger } from '../src/lib/logger.js';
import { resetScheduledStateForTests } from '../src/scheduled.js';
import { installFetchMock, json } from './helpers/fetch-mock.js';

const quiet = new Logger('error', {}, { output: { log() {}, warn() {}, error() {}, debug() {} } });
const COMMANDS_URL = 'https://discord.com/api/v10/applications/111111111111111111/commands';

// What Discord returns for a registered command: ids, versions, nulls, and
// `required: false` omitted.
function asDiscordReturns(command) {
  return {
    id: '1',
    application_id: '111111111111111111',
    version: '2',
    default_member_permissions: null,
    name_localizations: null,
    description_localizations: null,
    ...command,
    options: command.options?.map(({ required, ...option }) => (required ? { required, ...option } : option)),
  };
}

let mock;
beforeEach(() => {
  mock = installFetchMock();
});
afterEach(() => mock.restore());

describe('command registration', () => {
  it('ignores Discord-side defaults but detects real changes', () => {
    const payload = commandPayload(commands);
    const remote = payload.map(asDiscordReturns).reverse();
    expect(commandsDiffer(payload, remote, { global: true })).toBe(false);

    const renamed = remote.map((command) => (command.name === '4k' ? { ...command, description: 'changed' } : command));
    expect(commandsDiffer(payload, renamed, { global: true })).toBe(true);
    expect(commandsDiffer(payload, remote.slice(1), { global: true })).toBe(true);
    expect(commandsDiffer(payload, remote.map((command) => ({ ...command, contexts: [0] })), { global: true })).toBe(true);
  });

  it('omits installation contexts from guild payloads', () => {
    const [first] = guildCommandPayload(commandPayload(commands));
    expect(first.integration_types).toBeUndefined();
    expect(first.contexts).toBeUndefined();
    expect(first.nsfw).toBe(true);
  });

  it('only bulk-overwrites when the remote set differs, unless forced', async () => {
    const payload = commandPayload(commands);
    mock.route(`GET ${COMMANDS_URL}`, () => json(payload.map(asDiscordReturns)));
    mock.route(`PUT ${COMMANDS_URL}`, () => json([]));
    const rest = new DiscordRest({ token: 'test-bot-token' });
    const config = { botToken: 'test-bot-token', applicationId: '111111111111111111', registrationMode: 'global' };

    expect(await syncCommands({ rest, config, commands, logger: quiet })).toEqual([{ scope: 'global', changed: false, count: 41 }]);
    expect(mock.callsTo(`PUT ${COMMANDS_URL}`)).toHaveLength(0);

    expect(await syncCommands({ rest, config, commands, logger: quiet, force: true })).toEqual([{ scope: 'global', changed: true, count: 41 }]);
    const put = mock.callsTo(`PUT ${COMMANDS_URL}`)[0];
    expect(put.headers.authorization).toBe('Bot test-bot-token');
    expect(put.headers['user-agent']).toMatch(/^DiscordBot \(/);
    expect(await put.request.json()).toHaveLength(41);
  });

  it('registers guild commands in guild mode', async () => {
    const guildUrl = 'https://discord.com/api/v10/applications/111111111111111111/guilds/333333333333333333/commands';
    mock.route(`GET ${guildUrl}`, () => json([]));
    mock.route(`PUT ${guildUrl}`, () => json([]));
    const results = await syncCommands({
      rest: new DiscordRest({ token: 't' }),
      config: { botToken: 't', applicationId: '111111111111111111', registrationMode: 'guild', testingGuildId: '333333333333333333' },
      commands,
      logger: quiet,
    });
    expect(results).toEqual([{ scope: 'guild:333333333333333333', changed: true, count: 41 }]);
  });

  it('syncs commands from the cron trigger once per isolate', async () => {
    resetScheduledStateForTests();
    const payload = commandPayload(commands);
    mock.route(`GET ${COMMANDS_URL}`, () => json([]));
    mock.route(`PUT ${COMMANDS_URL}`, () => json(payload.map(asDiscordReturns)));
    // The Gateway is exercised in its own suite; here it only needs to answer.
    mock.route('GET https://discord.com/api/v10/gateway/bot', () => json({ url: 'wss://gateway.discord.gg', session_start_limit: { remaining: 0, reset_after: 60_000 } }));

    for (let run = 0; run < 2; run += 1) {
      const ctx = createExecutionContext();
      await worker.scheduled(createScheduledController({ cron: '* * * * *' }), env, ctx);
      await waitOnExecutionContext(ctx);
    }
    expect(mock.callsTo(`GET ${COMMANDS_URL}`)).toHaveLength(1);
    expect(mock.callsTo(`PUT ${COMMANDS_URL}`)).toHaveLength(1);
    const status = await env.GATEWAY.getByName('shard-0-of-1').status();
    expect(status.state).toBe('throttled');
  });
});
