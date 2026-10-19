import { InteractionResponseType, InteractionType } from '../discord/constants.js';
import { commandNameForInteraction, parseMediaCustomId, requester } from '../discord/interaction-data.js';
import { autocompleteResult, ephemeral, errorEmbed, reply } from '../discord/responses.js';
import { InteractionWebhook, isInteractionUnavailableError } from '../discord/rest.js';
import { isNsfwContext, nsfwErrorPayload } from './nsfw-guard.js';
import { cooldownPayload } from './rate-limit/cooldown-payload.js';
import { Emoji, uiText } from '../config/emojis.js';
import { snowflakeTimestamp } from '../lib/snowflake.js';

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

function routeTarget(interaction, commands) {
  switch (interaction.type) {
    case InteractionType.APPLICATION_COMMAND:
      return { commandName: commandNameForInteraction(interaction), state: {}, source: 'command' };
    case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE:
      return { commandName: commandNameForInteraction(interaction), state: {}, source: 'autocomplete' };
    case InteractionType.MESSAGE_COMPONENT: {
      const target = componentTarget(interaction.data?.custom_id ?? '', commands);
      return { commandName: target?.commandName ?? null, state: target?.state ?? {}, source: 'component' };
    }
    case InteractionType.MODAL_SUBMIT: {
      const customId = interaction.data?.custom_id ?? '';
      return { commandName: customId.startsWith('help:modal:') ? 'help' : null, state: { customId }, source: 'modal' };
    }
    default:
      return null;
  }
}

function unexpectedErrorMessage() {
  return {
    embeds: [errorEmbed(uiText(Emoji.ui.error, 'Error'), 'An unexpected error occurred while executing this interaction.')],
    components: [],
  };
}

// Maps one verified interaction onto { response, task }. `response` is the
// JSON body returned to Discord inside its three-second window; `task` is
// optional follow-up work the Worker keeps alive with ctx.waitUntil().
export class InteractionRouter {
  constructor({ commands, logger, random = Math.random, now = Date.now }) {
    this.commands = commands;
    this.logger = logger.child({ subsystem: 'interaction-router' });
    this.random = random;
    this.now = now;
  }

  async route(interaction, runtime) {
    if (interaction?.type === InteractionType.PING) {
      return { response: { type: InteractionResponseType.PONG } };
    }
    const target = routeTarget(interaction, this.commands);
    if (!target) return null;

    const { commandName, state, source } = target;
    const command = this.commands.get(commandName);
    if (!command) {
      return {
        response: source === 'autocomplete'
          ? autocompleteResult([])
          : ephemeral({ content: 'This interaction is no longer available.' }),
      };
    }

    if (source !== 'autocomplete') {
      this.logger.event('Routing Discord interaction.', { command: commandName, source, interactionId: interaction.id });
      if (command.data.nsfw && !isNsfwContext(interaction)) {
        return { response: reply(nsfwErrorPayload()) };
      }
    }

    let reservation = null;
    try {
      if (source !== 'autocomplete') {
        const gate = await this.#quotaGate(command, source, interaction, runtime.quota);
        if (gate && !gate.allowed) return { response: cooldownPayloadResponse(gate.releaseAt, this.random) };
        reservation = gate?.reservation ?? null;
      }

      const context = this.#context(interaction, source, runtime);
      if (source === 'autocomplete') {
        const choices = typeof command.autocomplete === 'function' ? await command.autocomplete(context) : [];
        return { response: autocompleteResult(choices ?? []) };
      }

      const descriptor = await command.execute(context, state);
      const { task, ...response } = descriptor;
      if (typeof task !== 'function') {
        if (reservation) await runtime.quota.rollback(reservation);
        return { response };
      }
      const heldReservation = reservation;
      reservation = null;
      return { response, task: this.#runTask(task, context, { command: commandName, source, reservation: heldReservation }) };
    } catch (error) {
      if (reservation) await runtime.quota.rollback(reservation);
      this.logger.error('Unhandled interaction command error.', { command: commandName, source, interactionId: interaction.id, error });
      return {
        response: source === 'autocomplete' ? autocompleteResult([]) : ephemeral(unexpectedErrorMessage()),
      };
    }
  }

  #quotaGate(command, source, interaction, quota) {
    if (!quota?.enabled) return null;
    const userId = requester(interaction)?.id;
    if (!userId) return null;
    const mediaRequest = command.kind === 'media' && (source === 'command' || source === 'component');
    if (mediaRequest) return quota.reserveMedia(userId);
    const utilityRequest = command.kind !== 'media'
      && (source === 'command' || (command.rateLimitComponents && source === 'component'));
    return utilityRequest ? quota.consumeUtility(userId) : null;
  }

  #context(interaction, source, runtime) {
    const advertisedLimit = Number(interaction.attachment_size_limit);
    const maxMediaBytes = Number.isFinite(advertisedLimit) && advertisedLimit > 0
      ? Math.min(runtime.config.maxMediaBytes, advertisedLimit)
      : runtime.config.maxMediaBytes;
    return {
      interaction,
      source,
      config: runtime.config,
      env: runtime.env,
      cf: runtime.cf ?? null,
      commands: this.commands,
      circuitBreaker: runtime.circuitBreaker,
      quota: runtime.quota,
      rest: runtime.rest,
      fetch: runtime.fetch,
      receivedAt: runtime.receivedAt,
      maxMediaBytes,
      logger: this.logger,
      webhook: new InteractionWebhook({
        rest: runtime.webhookRest,
        applicationId: interaction.application_id,
        token: interaction.token,
        receivedAt: runtime.receivedAt,
      }),
    };
  }

  // Wraps a deferred task so it can never reject inside waitUntil: failures
  // are reported by editing the loading message, and a media reservation is
  // committed only when media was actually displayed.
  async #runTask(task, context, { command, source, reservation }) {
    let outcome = null;
    try {
      outcome = await task();
    } catch (error) {
      await this.#reportTaskError(error, context, { command, source });
    } finally {
      if (reservation) {
        if (outcome?.mediaDisplayed) await context.quota.commit(reservation);
        else await context.quota.rollback(reservation);
      }
    }
  }

  async #reportTaskError(error, context, { command, source }) {
    if (isInteractionUnavailableError(error)) {
      let interactionAgeMs = null;
      try {
        interactionAgeMs = this.now() - snowflakeTimestamp(context.interaction.id);
      } catch {
        // Interaction IDs are snowflakes; the age is diagnostic only.
      }
      this.logger.warn('Discord interaction expired before the follow-up could be delivered.', {
        code: Number(error.code),
        command,
        source,
        interactionId: context.interaction.id,
        interactionAgeMs,
      });
      return;
    }
    this.logger.error('Deferred interaction task failed.', { command, source, interactionId: context.interaction.id, error });
    try {
      await context.webhook.editOriginal({ ...unexpectedErrorMessage(), attachments: [] });
    } catch (reportError) {
      const log = isInteractionUnavailableError(reportError) ? 'warn' : 'error';
      this.logger[log]('Could not report the interaction failure to Discord.', { error: reportError });
    }
  }
}

function cooldownPayloadResponse(releaseAt, random) {
  return reply(cooldownPayload(releaseAt, random));
}
