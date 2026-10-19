import { InteractionResponseType } from './constants.js';
import { DiscordRestError } from './rest-client.js';

const ResponseState = Object.freeze({
  IDLE: 'idle',
  ACKNOWLEDGING: 'acknowledging',
  ACKNOWLEDGED: 'acknowledged',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
});

const UNAVAILABLE_INTERACTION_CODES = new Set([10015, 10062, 40060]);

export function isInteractionUnavailableError(error) {
  return error instanceof DiscordRestError
    && UNAVAILABLE_INTERACTION_CODES.has(Number(error.code));
}

export class InteractionResponder {
  constructor({ interaction, rest }) {
    this.interaction = interaction;
    this.rest = rest;
    this.responseState = ResponseState.IDLE;
  }

  get acknowledged() {
    return this.responseState === ResponseState.ACKNOWLEDGED;
  }

  get canAcknowledge() {
    return this.responseState === ResponseState.IDLE;
  }

  async pong() {
    return this.#callback(InteractionResponseType.PONG);
  }

  async reply(data) {
    return this.#callback(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data);
  }

  async defer({ ephemeral = false } = {}) {
    const data = ephemeral ? { flags: 64 } : undefined;
    return this.#callback(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data);
  }

  async deferUpdate() {
    return this.#callback(InteractionResponseType.DEFERRED_UPDATE_MESSAGE);
  }

  async update(data) {
    return this.#callback(InteractionResponseType.UPDATE_MESSAGE, data);
  }

  async autocomplete(choices) {
    return this.#callback(InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, { choices });
  }

  async modal(data) {
    return this.#callback(InteractionResponseType.MODAL, data);
  }

  async editOriginal(data, files = []) {
    if (!this.acknowledged) throw new Error('Cannot edit an interaction response before acknowledging it.');
    return this.rest.patch(
      `/webhooks/${this.interaction.application_id}/${this.interaction.token}/messages/@original`,
      { body: data, files, auth: false },
    );
  }

  async followup(data, files = []) {
    if (!this.acknowledged) throw new Error('Cannot send a followup before acknowledging the interaction.');
    return this.rest.post(
      `/webhooks/${this.interaction.application_id}/${this.interaction.token}`,
      {
        body: data,
        files,
        auth: false,
        query: { wait: true },
        retryTransient: false,
      },
    );
  }

  async #callback(type, data) {
    if (!this.canAcknowledge) {
      throw new Error(`Discord interactions can only be acknowledged once (state: ${this.responseState}).`);
    }
    this.responseState = ResponseState.ACKNOWLEDGING;
    const body = data === undefined ? { type } : { type, data };
    try {
      const result = await this.rest.post(
        `/interactions/${this.interaction.id}/${this.interaction.token}/callback`,
        {
          body,
          auth: false,
          query: { with_response: false },
          // A callback may have reached Discord even when its HTTP response is
          // lost. Retrying that non-idempotent POST causes error 40060.
          retryTransient: false,
        },
      );
      this.responseState = ResponseState.ACKNOWLEDGED;
      return result;
    } catch (error) {
      if (isInteractionUnavailableError(error)) {
        this.responseState = ResponseState.UNAVAILABLE;
      } else if (error instanceof DiscordRestError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429) {
        // Discord explicitly rejected the payload before acknowledging it, so
        // the router may still send a simpler error response.
        this.responseState = ResponseState.IDLE;
      } else {
        // Transport and server failures are ambiguous: at-most-once behavior
        // is safer than sending a second callback for the same interaction.
        this.responseState = ResponseState.FAILED;
      }
      throw error;
    }
  }
}

export { ResponseState as InteractionResponseState };
