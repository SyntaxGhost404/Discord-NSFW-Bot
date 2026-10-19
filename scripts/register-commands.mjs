// Registers the bundled application commands from the command line.
//
//   npm run register              # sync only when Discord's copy differs
//   npm run register -- --force   # always bulk-overwrite
//
// Credentials come from the environment or, for local use, from .dev.vars.
// The deployed Worker also syncs commands from its cron trigger, so this is
// only needed to register before the first deployment or to force a refresh.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { commands } from '../src/commands/index.js';
import { syncCommands } from '../src/brain/command-registration.js';
import { loadConfig } from '../src/config.js';
import { DiscordRest } from '../src/discord/rest.js';
import { Logger } from '../src/lib/logger.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseDevVars(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const env = { ...parseDevVars(path.join(root, '.dev.vars')), ...process.env };
const config = loadConfig(env);
if (!config.botToken || !config.applicationId) {
  console.error('DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are required (environment or .dev.vars).');
  process.exit(1);
}

const output = {
  log: (record) => console.log(`${record.message}${record.scope ? ` [${record.scope}]` : ''}${record.count !== undefined ? ` (${record.count} commands)` : ''}`),
  debug: (record) => console.log(record.message),
  warn: (record) => console.warn(record.message),
  error: (record) => console.error(record.message, record.error ?? ''),
};
const logger = new Logger('warn', {}, { output });
const rest = new DiscordRest({ token: config.botToken, logger });

try {
  const results = await syncCommands({ rest, config, commands, logger, force: process.argv.includes('--force') });
  for (const result of results) {
    console.log(`${result.scope}: ${result.changed ? 'updated' : 'already up to date'} (${result.count} commands)`);
  }
} catch (error) {
  console.error(`Command registration failed: ${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
}
