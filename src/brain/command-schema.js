import {
  ApplicationCommandOptionType,
  ApplicationIntegrationType,
  InteractionContextType,
} from '../discord/constants.js';

export const ALL_INSTALLATION_TYPES = Object.freeze([
  ApplicationIntegrationType.GUILD_INSTALL,
  ApplicationIntegrationType.USER_INSTALL,
]);

export const ALL_INTERACTION_CONTEXTS = Object.freeze([
  InteractionContextType.GUILD,
  InteractionContextType.BOT_DM,
  InteractionContextType.PRIVATE_CHANNEL,
]);

export function stringOption({ name, description, required = false, autocomplete = false, choices }) {
  const option = {
    type: ApplicationCommandOptionType.STRING,
    name,
    description,
    required,
  };
  if (autocomplete) option.autocomplete = true;
  if (choices) option.choices = choices;
  return option;
}

export function userOption({ name, description, required = false }) {
  return {
    type: ApplicationCommandOptionType.USER,
    name,
    description,
    required,
  };
}

export function commandData({ name, description, nsfw = false, options = [] }) {
  return {
    type: 1,
    name,
    description,
    integration_types: [...ALL_INSTALLATION_TYPES],
    contexts: [...ALL_INTERACTION_CONTEXTS],
    nsfw,
    options,
  };
}

export const styleOption = stringOption({
  name: 'style',
  description: 'Select the style (Anime or Real)',
  choices: [
    { name: 'Anime', value: 'Anime' },
    { name: 'Real', value: 'Real' },
  ],
});
