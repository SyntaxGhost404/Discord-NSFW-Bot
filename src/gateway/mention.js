import { actionRow, button } from '../discord/components.js';
import { ButtonStyle } from '../discord/constants.js';
import { avatarUrl } from '../lib/discord-user.js';
import { randomColor } from '../lib/random.js';
import { Emoji, uiText } from '../config/emojis.js';

// Only a message consisting of nothing but the bot's mention gets the welcome
// reply. Mention content arrives without the privileged MESSAGE_CONTENT intent.
export function isExactBotMention(message, botUserId) {
  if (!botUserId || !message || message.author?.bot || message.webhook_id) return false;
  return new RegExp(`^<@!?${botUserId}>$`).test(message.content?.trim() ?? '');
}

export function welcomePayload(botUser) {
  return {
    embeds: [{
      title: uiText(Emoji.ui.sparkle, `Welcome to ${botUser.global_name || botUser.username}`),
      description: 'I am an age-restricted media bot. Use `/help` to browse commands, or use the buttons below for a short overview.',
      color: randomColor(),
      thumbnail: { url: avatarUrl(botUser, 256) },
    }],
    components: [actionRow(
      button({ customId: 'intro:features', label: uiText(Emoji.ui.search, 'Core Features') }),
      button({ customId: 'intro:support', label: uiText(Emoji.ui.tools, 'Support & Usage'), style: ButtonStyle.SECONDARY }),
    )],
  };
}

export function replyToMessage(rest, message, data) {
  return rest.post(`/channels/${message.channel_id}/messages`, {
    body: {
      ...data,
      message_reference: {
        type: 0,
        message_id: message.id,
        channel_id: message.channel_id,
        ...(message.guild_id ? { guild_id: message.guild_id } : {}),
        fail_if_not_exists: false,
      },
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
    },
  });
}
