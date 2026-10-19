import { ChannelType } from '../discord/constants.js';
import { Emoji, uiText } from '../config/emojis.js';

const DM_TYPES = new Set([ChannelType.DM, ChannelType.GROUP_DM]);
const THREAD_TYPES = new Set([
  ChannelType.GUILD_ANNOUNCEMENT_THREAD,
  ChannelType.GUILD_PUBLIC_THREAD,
  ChannelType.GUILD_PRIVATE_THREAD,
]);

// Defence in depth on top of Discord's own age gate for `nsfw` commands.
// Threads inherit age restriction from their parent and their partial channel
// carries no flag, so they are trusted unless explicitly marked otherwise.
export function isNsfwContext(interaction) {
  if (!interaction.guild_id) return true;
  const channel = interaction.channel;
  if (DM_TYPES.has(channel?.type)) return true;
  if (channel?.nsfw === true) return true;
  return THREAD_TYPES.has(channel?.type) && channel?.nsfw !== false;
}

export function nsfwErrorPayload() {
  return {
    embeds: [{
      title: uiText(Emoji.ui.error, 'Not an age-restricted channel'),
      description: 'This command can only be used in a Discord channel marked age-restricted (NSFW).',
      color: 0xed4245,
    }],
    flags: 64,
  };
}
