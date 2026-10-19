import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function validateCommand(command, fileName) {
  if (!command || typeof command !== 'object') throw new Error(`${fileName} does not export a command object.`);
  if (!command.data?.name || !command.data?.description) throw new Error(`${fileName} is missing command data.`);
  if (typeof command.execute !== 'function') throw new Error(`${fileName} is missing execute().`);
  if (!/^[\w-]{1,32}$/.test(command.data.name)) throw new Error(`${fileName} has an invalid command name.`);
  if (command.data.description.length > 100) throw new Error(`${fileName} has a description longer than 100 characters.`);
}

export async function loadCommands(directory, logger) {
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const commands = new Map();

  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    const module = await import(pathToFileURL(file));
    const command = module.default;
    validateCommand(command, entry.name);
    if (commands.has(command.data.name)) throw new Error(`Duplicate command name: ${command.data.name}`);
    commands.set(command.data.name, command);
    logger.debug('Loaded command module.', { command: command.data.name, file: entry.name });
  }
  return commands;
}
