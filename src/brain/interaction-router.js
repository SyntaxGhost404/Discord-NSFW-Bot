import { InteractionType } from '../discord/constants.js';
import {
  InteractionResponder,
  isInteractionUnavailableError,
} from '../discord/interaction-responder.js';
import { commandNameForInteraction, parseMediaCustomId, requester } from '../discord/interaction-data.js';
import { isNsfwContext, nsfwErrorPayload } from './nsfw-guard.js';
import { cooldownPayload } from './rate-limit/cooldown-payload.js';
import { Emoji, uiText } from '../config/emojis.js';
import { snowflakeTimestamp } from '../lib/snowflake.js';

const INTERACTION_CACHE_TTL_MS = 15 * 60 * 1_000;
const MAX_CACHED_INTERACTIONS = 10_000;

function legacyRefreshTarget(customId, commands) {
  const parts = customId.slice('refresh_'.length).split('_');
  const commandName = parts.shift();
  if (!commandName) return null;
  const optionName = commands.get(commandName)?.media?.optionName;
  const optionValue = parts.join(' ').trim();
  const state = optionName && optionValue ? { [optionName]: optionValue } : {};
  return { commandName, state };
}

function componentTarget(customId, commands) {
  if (customId.startsWith('m:')) return parseMediaCustomId(customId);
  if (customId.startsWith('refresh_')) return legacyRefreshTarget(customId, commands);
  if (customId.startsWith('help:')) return { commandName: 'help', state: { customId } };
  if (customId.startsWith('ping:')) return { commandName: 'ping', state: { customId } };
  if (customId.startsWith('premium:refresh:')) return { commandName: 'premium', state: { customId } };
  if (customId.startsWith('intro:')) return { commandName: 'intro', state: { customId } };
  return null;
}

export class InteractionRouter {
  constructor({
    commands,
    rest,
    gateway,
    config,
    mediaHttp,
    rateLimiter = null,
    circuitBreaker = null,
    interactionConflictMonitor = null,
    shutdownSignal = null,
    logger,
    now = Date.now,
    random = Math.random,
  }) {
    this.commands = commands;
    this.rest = rest;
    this.gateway = gateway;
    this.config = config;
    this.mediaHttp = mediaHttp;
    this.rateLimiter = rateLimiter;
    this.circuitBreaker = circuitBreaker;
    this.interactionConflictMonitor = interactionConflictMonitor;
    this.shutdownSignal = shutdownSignal;
    this.logger = logger.child({ subsystem: 'interaction-router' });
    this.now = now;
    this.random = random;
    this.seenInteractions = new Map();
    this.accepting = true;
  }

  stopAccepting() {
    this.accepting = false;
  }

  async handle(interaction) {
    const receivedAt = this.now();
    if (!this.#rememberInteraction(interaction?.id)) {
      this.logger.debug('Ignoring duplicate Gateway interaction dispatch.', {
        interactionId: interaction?.id,
      });
      return;
    }

    const responder = new InteractionResponder({ interaction, rest: this.rest });
    let commandName = null;
    let state = {};
    let source = null;
    let reservation = null;

    try {
      if (interaction.type === InteractionType.PING) {
        await responder.pong();
        return;
      }

      if (!this.accepting) {
        if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
          await responder.autocomplete([]);
        } else {
          await responder.reply({
            content: 'The bot is restarting and is not accepting new interactions yet. Please try again shortly.',
            flags: 64,
          });
        }
        return;
      }

      if (interaction.type === InteractionType.APPLICATION_COMMAND || interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
        commandName = commandNameForInteraction(interaction);
        source = interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE ? 'autocomplete' : 'command';
      } else if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
        const target = componentTarget(interaction.data?.custom_id ?? '', this.commands);
        commandName = target?.commandName ?? null;
        state = target?.state ?? {};
        source = 'component';
      } else if (interaction.type === InteractionType.MODAL_SUBMIT) {
        commandName = interaction.data?.custom_id?.startsWith('help:modal:') ? 'help' : null;
        state = { customId: interaction.data?.custom_id };
        source = 'modal';
      } else {
        return;
      }

      const command = this.commands.get(commandName);
      if (!command) {
        if (source === 'autocomplete') await responder.autocomplete([]);
        else await responder.reply({ content: 'This interaction is no longer available.', flags: 64 });
        return;
      }
      if (source !== 'autocomplete') {
        this.logger.event('Routing Discord interaction.', {
          command: commandName,
          source,
          interactionId: interaction.id,
        });
      }
      if (source !== 'autocomplete' && command.data.nsfw && !isNsfwContext(interaction)) {
        await responder.reply(nsfwErrorPayload());
        return;
      }

      if (this.rateLimiter && source !== 'autocomplete') {
        const userId = requester(interaction)?.id;
        const mediaRequest = command.kind === 'media' && (source === 'command' || source === 'component');
        const utilityRequest = command.kind !== 'media'
          && (source === 'command' || (command.rateLimitComponents && source === 'component'));
        if (userId && (mediaRequest || utilityRequest)) {
          const gate = mediaRequest
            ? this.rateLimiter.reserveMedia(userId)
            : this.rateLimiter.consumeUtility(userId);
          if (!gate.allowed) {
            await responder.reply(cooldownPayload(gate.releaseAt, this.random));
            return;
          }
          reservation = gate.reservation ?? null;
        }
      }

      const advertisedAttachmentLimit = Number(interaction.attachment_size_limit);
      const maxMediaBytes = Number.isFinite(advertisedAttachmentLimit) && advertisedAttachmentLimit > 0
        ? Math.min(this.config.maxMediaBytes, advertisedAttachmentLimit)
        : this.config.maxMediaBytes;
      const context = {
        interaction,
        responder,
        source,
        rest: this.rest,
        gateway: this.gateway,
        config: this.config,
        http: this.mediaHttp.withMaximumBytes(maxMediaBytes),
        circuitBreaker: this.circuitBreaker,
        rateLimiter: this.rateLimiter,
        signal: this.shutdownSignal,
        maxMediaBytes,
        commands: this.commands,
        logger: this.logger,
      };

      if (source === 'autocomplete') {
        if (typeof command.autocomplete === 'function') await command.autocomplete(context);
        else await responder.autocomplete([]);
      } else {
        const result = await command.execute(context, state);
        if (reservation) {
          if (result?.mediaDisplayed) this.rateLimiter.commit(reservation);
          else this.rateLimiter.rollback(reservation);
          reservation = null;
        }
      }
    } catch (error) {
      if (reservation) {
        this.rateLimiter?.rollback(reservation);
        reservation = null;
      }
      const unavailable = isInteractionUnavailableError(error);
      if (unavailable) {
        const failedAt = this.now();
        let interactionAgeMs = null;
        try {
          interactionAgeMs = failedAt - snowflakeTimestamp(interaction.id);
        } catch {
          // Discord IDs are snowflakes, but classification can fall back to local elapsed time.
        }
        const details = {
          error,
          command: commandName,
          source,
          interactionId: interaction.id,
          responseState: responder.responseState,
          elapsedMs: failedAt - receivedAt,
          interactionAgeMs,
        };
        if (this.interactionConflictMonitor) {
          this.interactionConflictMonitor.record(details);
        } else {
          this.logger.warn('Discord interaction is no longer available.', {
            code: Number(error.code),
            command: commandName,
            source,
            interactionId: interaction.id,
            responseState: responder.responseState,
            callbackElapsedMs: Math.max(0, Math.round(details.elapsedMs)),
            interactionAgeMs: Number.isFinite(interactionAgeMs)
              ? Math.max(0, Math.round(interactionAgeMs))
              : null,
          });
        }
      } else {
        this.logger.error('Unhandled interaction command error.', {
          command: commandName,
          interactionId: interaction.id,
          responseState: responder.responseState,
          error,
        });
      }

      if (unavailable || interaction.type === InteractionType.PING) return;
      try {
        const data = {
          embeds: [{
            title: uiText(Emoji.ui.error, 'Error'),
            description: 'An unexpected error occurred while executing this interaction.',
            color: 0xed4245,
          }],
          components: [],
        };
        if (source === 'autocomplete') {
          if (responder.canAcknowledge) await responder.autocomplete([]);
        } else if (responder.acknowledged) {
          await responder.editOriginal({ ...data, attachments: [] });
        } else if (responder.canAcknowledge) {
          await responder.reply({ ...data, flags: 64 });
        }
      } catch (responseError) {
        const responseUnavailable = isInteractionUnavailableError(responseError);
        const responseLog = responseUnavailable
          ? this.logger.warn.bind(this.logger)
          : this.logger.error.bind(this.logger);
        responseLog(responseUnavailable
          ? 'Interaction expired before an error response could be sent.'
          : 'Failed to report an interaction error to Discord.', responseUnavailable
          ? { code: Number(responseError.code), responseState: responder.responseState }
          : responseError);
      }
    }
  }

  #rememberInteraction(interactionId) {
    if (!interactionId) return true;
    const now = this.now();
    for (const [id, seenAt] of this.seenInteractions) {
      if (now - seenAt < INTERACTION_CACHE_TTL_MS) break;
      this.seenInteractions.delete(id);
    }
    if (this.seenInteractions.has(interactionId)) return false;
    this.seenInteractions.set(interactionId, now);
    while (this.seenInteractions.size > MAX_CACHED_INTERACTIONS) {
      this.seenInteractions.delete(this.seenInteractions.keys().next().value);
    }
    return true;
  }
}
