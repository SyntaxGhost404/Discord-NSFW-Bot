import { replyToMessage } from '../discord/message-api.js';
import { actionRow, button } from '../discord/components.js';
import { avatarUrl } from '../lib/discord-user.js';
import { randomColor } from '../lib/random.js';
import { Emoji, uiText } from '../config/emojis.js';

export class MessageRouter {
  constructor({ rest, gateway, logger }) {
    this.rest = rest;
    this.gateway = gateway;
    this.logger = logger.child({ subsystem: 'message-router' });
  }

  async handle(message) {
    if (message.author?.bot || !this.gateway.user?.id) return;
    const exactMention = new RegExp(`^<@!?${this.gateway.user.id}>$`);
    if (!exactMention.test(message.content?.trim() ?? '')) return;

    this.logger.event('Responding to a direct bot mention.', {
      channelId: message.channel_id,
      guildId: message.guild_id ?? 'DM',
    });
    await replyToMessage(this.rest, message, {
      embeds: [{
        title: uiText(Emoji.ui.sparkle, `Welcome to ${this.gateway.user.username}`),
        description: 'I am an age-restricted media bot. Use `/help` to browse commands, or use the buttons below for a short overview.',
        color: randomColor(),
        thumbnail: { url: avatarUrl(this.gateway.user, 256) },
      }],
      components: [actionRow(
        button({ customId: 'intro:features', label: uiText(Emoji.ui.search, 'Core Features') }),
        button({ customId: 'intro:support', label: uiText(Emoji.ui.tools, 'Support & Usage'), style: 2 }),
      )],
    });
  }
}
