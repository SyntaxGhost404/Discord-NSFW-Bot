import os from 'node:os';
import { commandData } from '../brain/command-schema.js';
import { actionRow, button } from '../discord/components.js';
import { ButtonStyle } from '../discord/constants.js';
import { requester } from '../discord/interaction-data.js';
import { avatarUrl, displayName } from '../lib/discord-user.js';
import { randomColor } from '../lib/random.js';
import { snowflakeTimestamp } from '../lib/snowflake.js';
import { formatDuration } from '../lib/time.js';
import { Emoji, uiText } from '../config/emojis.js';

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function pageFromState(state) {
  const parsed = Number.parseInt(state.customId?.split(':').at(-1), 10);
  return parsed === 2 ? 2 : 1;
}

export default {
  data: commandData({
    name: 'ping',
    description: 'Advanced diagnostic metrics and latency check.',
  }),
  async execute(context, state) {
    if (context.source === 'component') await context.responder.deferUpdate();
    else await context.responder.defer();
    const page = pageFromState(state);
    const user = requester(context.interaction);

    if (page === 1) {
      const roundtrip = Math.max(0, Date.now() - snowflakeTimestamp(context.interaction.id));
      await context.responder.editOriginal({
        embeds: [{
          title: uiText(Emoji.ui.ping, 'Diagnostics: Latency Overview (Page 1/2)'),
          description: 'Core response times and WebSocket latency to Discord.',
          color: randomColor(),
          fields: [
            { name: `${Emoji.ui.refresh} Interaction Roundtrip`, value: `\`${roundtrip}ms\``, inline: true },
            { name: `${Emoji.ui.globe} Gateway Heartbeat`, value: `\`${context.gateway.ping ?? 'pending'}ms\``, inline: true },
          ],
          footer: { text: `${displayName(user)} ${Emoji.ui.bullet} Page 1 of 2`, icon_url: avatarUrl(user) },
          timestamp: new Date().toISOString(),
        }],
        components: [actionRow(button({ customId: 'ping:page:2', label: `Next: System Specs ${Emoji.ui.next}` }))],
        attachments: [],
      });
      return;
    }

    const memory = process.memoryUsage();
    await context.responder.editOriginal({
      embeds: [{
        title: uiText(Emoji.ui.ping, 'Diagnostics: System Metrics (Page 2/2)'),
        description: 'Host statistics and process resource usage.',
        color: randomColor(),
        fields: [
          { name: `${Emoji.ui.hourglass} Uptime`, value: `\`${formatDuration(process.uptime())}\``, inline: true },
          { name: `${Emoji.ui.computer} Process Memory`, value: `\`${megabytes(memory.rss)}\``, inline: true },
          { name: `${Emoji.ui.homes} Guild Count`, value: `\`${context.gateway.guildCount}\``, inline: true },
          { name: `${Emoji.ui.gear} Host Platform`, value: `\`${os.platform()} ${os.release()}\``, inline: false },
        ],
        footer: { text: `${displayName(user)} ${Emoji.ui.bullet} Page 2 of 2`, icon_url: avatarUrl(user) },
        timestamp: new Date().toISOString(),
      }],
      components: [actionRow(button({
        customId: 'ping:page:1',
        label: `${Emoji.ui.previous} Back to Latency`,
        style: ButtonStyle.SECONDARY,
      }))],
      attachments: [],
    });
  },
};
