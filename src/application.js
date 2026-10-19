import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommands } from './brain/command-loader.js';
import { registerCommands } from './brain/command-registration.js';
import { InteractionConflictMonitor } from './brain/interaction-conflict-monitor.js';
import { InteractionRouter } from './brain/interaction-router.js';
import { MessageRouter } from './brain/message-router.js';
import { MediaHttpClient } from './brain/providers/http.js';
import { ProviderCircuitBreaker } from './brain/providers/circuit-breaker.js';
import { GlobalRateLimiter } from './brain/rate-limit/global-rate-limiter.js';
import { DiscordGatewayClient } from './discord/gateway-client.js';
import { DiscordRestClient } from './discord/rest-client.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export class BotApplication {
  constructor({ config, logger, instanceLease = null }) {
    this.config = config;
    this.logger = logger;
    this.instanceLease = instanceLease;
    this.providerAbortController = new AbortController();
    this.discordAbortController = new AbortController();
    this.rest = new DiscordRestClient({
      token: config.botToken,
      logger,
      signal: this.discordAbortController.signal,
    });
    this.gateway = new DiscordGatewayClient({
      token: config.botToken,
      intents: config.gatewayIntents,
      rest: this.rest,
      logger,
    });
    this.commands = null;
    this.interactionRouter = null;
    this.messageRouter = null;
    this.stopping = false;
    this.activeTasks = new Set();
    this.shutdownPromise = null;
    this.rateLimiter = null;
    this.circuitBreaker = null;
    this.interactionConflictMonitor = new InteractionConflictMonitor({
      logger,
      onConflict: (diagnostic) => this.#yieldCompetingSession(diagnostic),
    });
  }

  async start() {
    this.commands = await loadCommands(path.join(sourceDirectory, 'commands'), this.logger);
    this.rateLimiter = new GlobalRateLimiter({
      premiumUserIds: this.config.premiumUserIds,
      stateFile: this.config.rateLimitStateFile,
      logger: this.logger,
    });
    await this.rateLimiter.initialize();
    this.circuitBreaker = new ProviderCircuitBreaker({ logger: this.logger });
    await registerCommands({
      rest: this.rest,
      clientId: this.config.clientId,
      guildId: this.config.testingGuildId,
      mode: this.config.registrationMode,
      commands: this.commands,
      logger: this.logger,
    });

    const mediaHttp = new MediaHttpClient({
      timeoutMs: this.config.mediaTimeoutMs,
      maximumBytes: this.config.maxMediaBytes,
      logger: this.logger,
      signal: this.providerAbortController.signal,
    });
    this.interactionRouter = new InteractionRouter({
      commands: this.commands,
      rest: this.rest,
      gateway: this.gateway,
      config: this.config,
      mediaHttp,
      rateLimiter: this.rateLimiter,
      circuitBreaker: this.circuitBreaker,
      interactionConflictMonitor: this.interactionConflictMonitor,
      shutdownSignal: this.providerAbortController.signal,
      logger: this.logger,
    });
    this.messageRouter = new MessageRouter({
      rest: this.rest,
      gateway: this.gateway,
      logger: this.logger,
    });

    this.gateway.on('INTERACTION_CREATE', (interaction) => {
      this.#track(this.interactionRouter.handle(interaction), 'interaction router', {
        interactionId: interaction?.id,
      });
    });
    this.gateway.on('MESSAGE_CREATE', (message) => {
      if (!this.stopping) this.#track(this.messageRouter.handle(message), 'message router');
    });
    this.gateway.on('ready', (ready) => {
      if (ready.user?.id !== this.config.clientId) {
        this.logger.warn('CLIENT_ID does not match the authenticated bot user ID.', {
          configuredClientId: this.config.clientId,
          authenticatedUserId: ready.user?.id,
        });
      }
    });
    this.gateway.on('fatal', (error) => {
      this.logger.error('Discord Gateway reported a fatal session error.', error);
      process.exitCode = 1;
      void this.shutdown({ reason: 'fatal Gateway session error' });
    });

    await this.gateway.connect();
    this.logger.boot('Runtime initialized; awaiting Discord Gateway READY.', {
      commands: [...this.commands.values()].filter((command) => !command.hidden).length,
      registrationMode: this.config.registrationMode,
    });
  }

  shutdown({ reason = 'shutdown requested' } = {}) {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.#shutdown(reason);
    return this.shutdownPromise;
  }

  stop() {
    return this.shutdown({ reason: 'stop requested' });
  }

  #track(promise, label, metadata = {}) {
    const tracked = Promise.resolve(promise)
      .catch((error) => {
        this.logger.error(`Unhandled ${label} failure.`, { ...metadata, error });
      })
      .finally(() => this.activeTasks.delete(tracked));
    this.activeTasks.add(tracked);
  }

  async #shutdown(reason) {
    this.stopping = true;
    this.interactionRouter?.stopAccepting();
    this.logger.event('Graceful shutdown started; new work is being rejected.', {
      reason,
      activeTasks: this.activeTasks.size,
    });

    let hardTimer;
    const hardFallback = new Promise((resolve) => {
      hardTimer = setTimeout(() => {
        this.providerAbortController.abort(new Error('Shutdown hard timeout reached.'));
        this.discordAbortController.abort(new Error('Shutdown hard timeout reached.'));
        void this.gateway.stop({ force: true });
        resolve(false);
      }, this.config.shutdownHardTimeoutMs);
    });

    const graceful = (async () => {
      const drained = await this.#waitForTasks(this.config.shutdownDrainMs);
      if (!drained) {
        this.logger.warn('Provider drain window elapsed; cancelling remaining provider work.', {
          activeTasks: this.activeTasks.size,
        });
        this.providerAbortController.abort(new Error('Application shutdown'));
      }

      const settled = await this.#waitForTasks(this.config.shutdownSettleMs);
      if (!settled) {
        this.logger.warn('Discord response settle window elapsed; cancelling remaining requests.', {
          activeTasks: this.activeTasks.size,
        });
      }
      if (!this.providerAbortController.signal.aborted) {
        this.providerAbortController.abort(new Error('Application shutdown'));
      }
      this.discordAbortController.abort(new Error('Application shutdown'));
      await this.gateway.stop();
      await this.rateLimiter?.flush();
      return true;
    })();

    let completed = false;
    try {
      completed = await Promise.race([graceful, hardFallback]);
    } catch (error) {
      this.logger.error('An error interrupted graceful shutdown; force-closing resources.', { error });
      this.providerAbortController.abort(error);
      this.discordAbortController.abort(error);
      await this.gateway.stop({ force: true });
    } finally {
      clearTimeout(hardTimer);
    }
    if (!completed) {
      this.logger.error('Graceful shutdown exceeded its hard timeout; resources were force-closed.', {
        activeTasks: this.activeTasks.size,
      });
      await Promise.race([
        this.rateLimiter?.flush() ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 250)),
      ]);
    }
    try {
      await this.instanceLease?.release();
    } catch (error) {
      this.logger.error('Could not release the bot instance lease.', { error });
      process.exitCode = 1;
    }
    this.logger.event('Bot stopped.', { graceful: completed, activeTasks: this.activeTasks.size });
  }

  async #waitForTasks(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (this.activeTasks.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      let timer;
      const settled = await Promise.race([
        Promise.allSettled([...this.activeTasks]).then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), remaining);
        }),
      ]);
      clearTimeout(timer);
      if (!settled) return false;
    }
    return true;
  }

  #yieldCompetingSession(diagnostic) {
    if (this.stopping) return this.shutdownPromise;
    return this.shutdown({
      reason: `another process owns Discord interactions (code ${diagnostic.code})`,
    });
  }
}
