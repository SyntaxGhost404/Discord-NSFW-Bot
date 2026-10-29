import { commandData } from '../brain/command-schema.js';
import { gatewayStatus } from '../brain/gateway-status.js';
import { actionRow, button } from '../discord/components.js';
import { ButtonStyle } from '../discord/constants.js';
import { requester } from '../discord/interaction-data.js';
import { respondWhenReady } from '../discord/responses.js';
import { avatarUrl, displayName } from '../lib/discord-user.js';
import { randomColor } from '../lib/random.js';
import { snowflakeTimestamp } from '../lib/snowflake.js';
import { formatDuration } from '../lib/time.js';
import { Emoji, uiText } from '../config/emojis.js';

// Date.now() is not meaningful during Worker startup, so the isolate's age is
// measured from the first request it serves.
let isolateFirstSeenAt = null;

function pageFromState(state) {
  const parsed = Number.parseInt(state.customId?.split(':').at(-1), 10);
  return parsed === 2 ? 2 : 1;
}

async function discordApiProbe(context) {
  const startedAt = Date.now();
  try {
    if (context.rest.token) {
      const application = await context.rest.get('/applications/@me', { timeoutMs: 4_000 });
      return { latencyMs: Date.now() - startedAt, guildCount: application?.approximate_guild_count ?? null };
    }
    await context.rest.get('/gateway', { auth: false, timeoutMs: 4_000 });
    return { latencyMs: Date.now() - startedAt, guildCount: null };
  } catch (error) {
    context.logger.warn('Discord API latency probe failed.', { error });
    return { latencyMs: null, guildCount: null };
  }
}

function gatewayLabel(status) {
  if (!status) return 'unavailable';
  if (status.mode === 'off') return 'disabled';
  if (!status.connected) return status.state ?? 'connecting';
  return Number.isFinite(status.ping) ? `${status.ping}ms` : 'pending';
}

function milliseconds(value) {
  return Number.isFinite(value) ? `${Math.max(0, Math.round(value))}ms` : 'unavailable';
}

export default {
  data: commandData({
    name: 'ping',
    description: 'Advanced diagnostic metrics and latency check.',
  }),
  execute(context, state = {}) {
    isolateFirstSeenAt ??= Date.now();
    return respondWhenReady(async () => {
      const page = pageFromState(state);
      const user = requester(context.interaction);

      if (page === 1) {
        const roundtrip = Date.now() - snowflakeTimestamp(context.interaction.id);
        const [api, gateway] = await Promise.all([discordApiProbe(context), gatewayStatus(context)]);
        return {
          body: {
            embeds: [{
              title: uiText(Emoji.ui.ping, 'Diagnostics: Latency Overview (Page 1/2)'),
              description: 'Interaction, Discord API, and Gateway latency from the Cloudflare edge.',
              color: randomColor(),
              fields: [
                { name: `${Emoji.ui.refresh} Interaction Roundtrip`, value: `\`${milliseconds(roundtrip)}\``, inline: true },
                { name: `${Emoji.ui.computer} Discord API`, value: `\`${milliseconds(api.latencyMs)}\``, inline: true },
                { name: `${Emoji.ui.globe} Gateway Heartbeat`, value: `\`${gatewayLabel(gateway)}\``, inline: true },
              ],
              footer: { text: `${displayName(user)} ${Emoji.ui.bullet} Page 1 of 2`, icon_url: avatarUrl(user) },
              timestamp: new Date().toISOString(),
            }],
            components: [actionRow(button({ customId: 'ping:page:2', label: `Next: System Specs ${Emoji.ui.next}` }))],
            attachments: [],
          },
        };
      }

      const [api, gateway] = await Promise.all([discordApiProbe(context), gatewayStatus(context)]);
      const version = context.env?.CF_VERSION_METADATA;
      const colo = context.cf?.colo ? `${context.cf.colo}${context.cf.country ? ` (${context.cf.country})` : ''}` : 'unknown';
      const guilds = api.guildCount ?? gateway?.guilds ?? null;
      return {
        body: {
          embeds: [{
            title: uiText(Emoji.ui.ping, 'Diagnostics: System Metrics (Page 2/2)'),
            description: 'Cloudflare Workers runtime and deployment details.',
            color: randomColor(),
            fields: [
              { name: `${Emoji.ui.hourglass} Isolate Uptime`, value: `\`${formatDuration((Date.now() - isolateFirstSeenAt) / 1_000)}\``, inline: true },
              { name: `${Emoji.ui.globe} Edge Location`, value: `\`${colo}\``, inline: true },
              { name: `${Emoji.ui.homes} Guild Count`, value: `\`${guilds ?? 'unavailable'}\``, inline: true },
              { name: `${Emoji.ui.gear} Runtime`, value: `\`Cloudflare Workers${version?.id ? ` ${String(version.id).slice(0, 8)}` : ''}\``, inline: true },
              { name: `${Emoji.ui.computer} Gateway Session`, value: `\`${gateway?.mode === 'off' ? 'disabled' : gateway?.connected ? `connected (${gateway.mode})` : gatewayLabel(gateway)}\``, inline: true },
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
        },
      };
    });
  },
};
