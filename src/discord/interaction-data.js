import { interactionUser } from '../lib/discord-user.js';

function flattenOptions(options = []) {
  const result = [];
  for (const option of options) {
    result.push(option);
    if (Array.isArray(option.options)) result.push(...flattenOptions(option.options));
  }
  return result;
}

export function option(interaction, name) {
  return flattenOptions(interaction.data?.options).find((item) => item.name === name) ?? null;
}

export function optionValue(interaction, name) {
  return option(interaction, name)?.value ?? null;
}

export function focusedOption(interaction) {
  return flattenOptions(interaction.data?.options).find((item) => item.focused) ?? null;
}

export function modalValue(interaction, customId) {
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id === customId) return component.value ?? '';
    }
  }
  return '';
}

export function encodeState(state = {}) {
  return Object.entries(state)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export function decodeState(serialized = '') {
  const state = {};
  for (const part of serialized.split('&')) {
    if (!part) continue;
    const separator = part.indexOf('=');
    const key = decodeURIComponent(separator === -1 ? part : part.slice(0, separator));
    const value = decodeURIComponent(separator === -1 ? '' : part.slice(separator + 1));
    if (key && !['__proto__', 'constructor', 'prototype'].includes(key)) state[key] = value;
  }
  return state;
}

export function mediaCustomId(commandName, state = {}) {
  const serialized = encodeState(state);
  const customId = serialized ? `m:${commandName}:${serialized}` : `m:${commandName}`;
  if (customId.length > 100) throw new Error(`Media custom_id exceeds 100 characters: ${customId}`);
  return customId;
}

export function parseMediaCustomId(customId) {
  const [prefix, commandName, ...stateParts] = customId.split(':');
  if (prefix !== 'm' || !commandName) return null;
  return { commandName, state: decodeState(stateParts.join(':')) };
}

export function commandNameForInteraction(interaction) {
  return interaction.data?.name ?? null;
}

export function requester(interaction) {
  return interactionUser(interaction);
}

export function resolvedUser(interaction, optionName) {
  const userId = optionValue(interaction, optionName);
  if (!userId) return requester(interaction);
  return interaction.data?.resolved?.users?.[userId]
    ?? (requester(interaction)?.id === userId ? requester(interaction) : { id: userId });
}
