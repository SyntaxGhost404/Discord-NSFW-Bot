import { InteractionResponseType, MessageFlag } from './constants.js';

// Command handlers return one of these descriptors. Inline descriptors become
// the HTTP response body; deferred ones also carry a `task` that the Worker
// runs with ctx.waitUntil() after Discord has been acknowledged.

export function reply(data) {
  return { type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data };
}

export function ephemeral(data) {
  return reply({ ...data, flags: (data.flags ?? 0) | MessageFlag.EPHEMERAL });
}

export function updateMessage(data) {
  return { type: InteractionResponseType.UPDATE_MESSAGE, data };
}

export function modal(data) {
  return { type: InteractionResponseType.MODAL, data };
}

export function autocompleteResult(choices) {
  return { type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices } };
}

export function deferred(task, { ephemeral: hidden = false } = {}) {
  const response = { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, task };
  if (hidden) response.data = { flags: MessageFlag.EPHEMERAL };
  return response;
}

export function deferredUpdate(task) {
  return { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE, task };
}

// Commands that run a background task acknowledge with a loading state that
// matches the trigger: a new message for commands, an in-place edit for
// components.
export function deferFor(source, task) {
  return source === 'component' ? deferredUpdate(task) : deferred(task);
}

// Work that ends in a finished message: `prepare` resolves to
// { body, files = [], mediaDisplayed = false }. The router sends that message
// as the initial response when it is ready quickly and needs no upload, and
// otherwise acknowledges and edits the message in when it is ready. `prepare`
// receives { willUpload }, to call as soon as it knows a file will be sent,
// so the acknowledgement does not wait for the download.
export function respondWhenReady(prepare) {
  return { prepare };
}

export function errorEmbed(title, description) {
  return { title, description, color: 0xed4245 };
}
