export function commandPayload(commands) {
  return [...commands.values()]
    .filter((command) => !command.hidden)
    .map((command) => command.data);
}

// Installation and interaction contexts apply only to global commands.
export function guildCommandPayload(payload) {
  return payload.map(({ integration_types: _integrationTypes, contexts: _contexts, ...command }) => command);
}

function sortedNumbers(values) {
  return Array.isArray(values) ? [...values].sort((left, right) => left - right) : null;
}

function canonicalOption(option) {
  return {
    type: option.type,
    name: option.name,
    description: option.description,
    required: Boolean(option.required),
    autocomplete: Boolean(option.autocomplete),
    choices: (option.choices ?? []).map(({ name, value }) => ({ name, value })),
    options: (option.options ?? []).map(canonicalOption),
  };
}

// Reduces local and Discord-returned commands to the fields this bot sets, so
// server-side defaults (ids, versions, null localizations) never look like a
// difference.
function canonicalCommand(command, { global }) {
  const canonical = {
    type: command.type ?? 1,
    name: command.name,
    description: command.description,
    nsfw: Boolean(command.nsfw),
    options: (command.options ?? []).map(canonicalOption),
  };
  if (global) {
    canonical.integration_types = sortedNumbers(command.integration_types) ?? [0];
    canonical.contexts = sortedNumbers(command.contexts);
  }
  return canonical;
}

function canonicalSet(commands, scope) {
  return JSON.stringify([...commands]
    .map((command) => canonicalCommand(command, scope))
    .sort((left, right) => left.name.localeCompare(right.name)));
}

export function commandsDiffer(local, remote, scope) {
  return canonicalSet(local, scope) !== canonicalSet(remote ?? [], scope);
}

async function syncScope({ rest, route, payload, scope, force, logger, label }) {
  if (!force) {
    const remote = await rest.get(route);
    if (!commandsDiffer(payload, remote, scope)) {
      logger.debug('Application commands are already up to date.', { scope: label, count: payload.length });
      return { scope: label, changed: false, count: payload.length };
    }
  }
  await rest.put(route, { body: payload });
  logger.success('Refreshed application commands.', { scope: label, count: payload.length });
  return { scope: label, changed: true, count: payload.length };
}

// Bulk-overwrites the configured command scopes when they differ from the
// commands bundled in this deployment (or always, with `force`).
export async function syncCommands({ rest, config, commands, logger, force = false }) {
  if (!config.botToken || !config.applicationId) {
    return [{ scope: 'none', changed: false, skipped: 'DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are required' }];
  }
  const payload = commandPayload(commands);
  const results = [];
  if (config.registrationMode === 'global' || config.registrationMode === 'both') {
    results.push(await syncScope({
      rest,
      route: `/applications/${config.applicationId}/commands`,
      payload,
      scope: { global: true },
      force,
      logger,
      label: 'global',
    }));
  }
  if (config.registrationMode === 'guild' || config.registrationMode === 'both') {
    results.push(await syncScope({
      rest,
      route: `/applications/${config.applicationId}/guilds/${config.testingGuildId}/commands`,
      payload: guildCommandPayload(payload),
      scope: { global: false },
      force,
      logger,
      label: `guild:${config.testingGuildId}`,
    }));
  }
  return results;
}
