import { commandData } from '../brain/command-schema.js';
import { actionRow, button } from '../discord/components.js';
import { BOT_INVITE_PERMISSIONS, ButtonStyle } from '../discord/constants.js';
import { requester } from '../discord/interaction-data.js';
import { avatarUrl, displayName } from '../lib/discord-user.js';
import { randomColor } from '../lib/random.js';
import { Emoji, uiText } from '../config/emojis.js';

export function inviteUrl(clientId) {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('permissions', BOT_INVITE_PERMISSIONS);
  url.searchParams.set('integration_type', '0');
  url.searchParams.set('scope', 'bot applications.commands');
  return url.toString();
}

export default {
  data: commandData({
    name: 'invite',
    description: 'Get a dynamic invite link to add this bot to your server.',
  }),
  async execute(context) {
    await context.responder.defer();
    const user = requester(context.interaction);
    await context.responder.editOriginal({
      embeds: [{
        title: uiText(Emoji.ui.sparkle, 'Invite Me to Your Server'),
        description: 'Use the button below to authorize the bot with only the permissions required for replies, embeds, and media attachments.',
        color: randomColor(),
        footer: { text: displayName(user), icon_url: avatarUrl(user) },
        timestamp: new Date().toISOString(),
      }],
      components: [actionRow(button({
        label: uiText(Emoji.ui.add, 'Invite Bot'),
        style: ButtonStyle.LINK,
        url: inviteUrl(context.config.clientId),
      }))],
      attachments: [],
    });
  },
};
