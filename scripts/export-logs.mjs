import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configuredLogFile = process.env.CONSOLE_LOG_FILE?.trim() || 'logs/discord-bot-console.txt';
const source = path.resolve(root, configuredLogFile);

if (!existsSync(source)) {
  console.error(`No persistent console log exists at ${source}. Start the bot with "npm start" first.`);
  process.exitCode = 1;
} else {
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const requestedDestination = process.argv[2]?.trim();
  const destination = requestedDestination
    ? path.resolve(root, requestedDestination)
    : path.join(root, 'logs', 'exports', `discord-bot-console-${timestamp}.txt`);

  if (destination === source) {
    console.error('The export destination must be different from the active console log.');
    process.exitCode = 1;
  } else {
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
    chmodSync(destination, 0o600);
    console.log(`Console history exported to ${destination}`);
  }
}
