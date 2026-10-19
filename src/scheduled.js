import { syncCommands } from './brain/command-registration.js';
import { shardName } from './gateway/protocol.js';

// Each isolate verifies the command set once. A deployment always starts new
// isolates, so changed commands are re-registered within a minute of deploy.
let commandsVerified = false;

async function verifyCommands(runtime) {
  if (commandsVerified) return;
  const results = await syncCommands({
    rest: runtime.rest,
    config: runtime.config,
    commands: runtime.commands,
    logger: runtime.logger,
  });
  if (results.every((result) => !result.skipped)) commandsVerified = true;
}

function gatewayTasks(runtime) {
  const { config, env } = runtime;
  if (config.gateway.mode === 'off' || !config.botToken || !env.GATEWAY) return [];
  const { shardCount } = config.gateway;
  return Array.from({ length: shardCount }, (_value, shardId) => ({
    label: `gateway shard ${shardId}`,
    run: () => env.GATEWAY.getByName(shardName(shardId, shardCount)).ensureRunning({ shardId, shardCount }),
  }));
}

// Cron maintenance: keep application commands in sync with this deployment
// and make sure every configured Gateway shard object is running.
export async function runScheduled(runtime) {
  const tasks = [{ label: 'command sync', run: () => verifyCommands(runtime) }, ...gatewayTasks(runtime)];
  const outcomes = await Promise.allSettled(tasks.map((task) => task.run()));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      runtime.logger.error('Scheduled maintenance task failed.', { task: tasks[index].label, error: outcome.reason });
    }
  });
}

export function resetScheduledStateForTests() {
  commandsVerified = false;
}
