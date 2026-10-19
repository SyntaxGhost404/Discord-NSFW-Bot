import { BotApplication } from './src/application.js';
import { loadConfig } from './src/config.js';
import { Logger } from './src/lib/logger.js';
import { ActiveInstanceError, SingleInstanceLease } from './src/lib/single-instance-lease.js';

let application;
let instanceLease;
let logger;
let shutdownRequested = false;

async function shutdown(reason, exitCode = 0) {
  if (shutdownRequested) return;
  shutdownRequested = true;
  process.exitCode = Math.max(process.exitCode ?? 0, exitCode);
  try {
    await application?.shutdown({ reason });
  } catch (error) {
    logger?.error('Shutdown lifecycle failed.', { error });
    process.exitCode = 1;
  } finally {
    try {
      await instanceLease?.release();
      instanceLease = null;
    } catch (error) {
      logger?.error('Could not release the bot instance lease.', { error });
      process.exitCode = 1;
    }
  }
}

async function main() {
  const config = loadConfig();
  logger = new Logger(config.logLevel, { application: 'discord-nsfw-bot' });
  instanceLease = await SingleInstanceLease.acquire({
    file: config.instanceLockFile,
    staleAfterMs: config.instanceLockStaleMs,
    logger,
    onLost: () => {
      void shutdown('bot instance lease lost', 1);
    },
  });
  application = new BotApplication({ config, logger, instanceLease });

  process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection.', error);
    void shutdown('unhandled promise rejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception.', error);
    void shutdown('uncaught exception', 1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      logger.event('Received shutdown signal.', { signal });
      void shutdown(signal);
    });
  }

  logger.boot('Starting Discord NSFW Media Bot.', {
    node: process.version,
    pid: process.pid,
    instanceId: instanceLease.instanceId,
  });
  await application.start();
}

main().catch((error) => {
  logger ??= new Logger('error', { application: 'discord-nsfw-bot' });
  if (error instanceof ActiveInstanceError) {
    logger.error('Another bot process is already active; refusing to start a duplicate Gateway session.', {
      leaseFile: error.file,
      ownerPid: error.owner?.pid,
      ownerHost: error.owner?.hostname,
      action: 'stop the other Replit Run or Deployment before starting this one',
    });
  } else {
    logger.error('Bot startup failed.', error);
  }
  void shutdown('startup failure', 1);
});
