import { commandData, userOption } from '../brain/command-schema.js';
import {
  FREE_DAILY_LIMIT,
  FREE_MINUTE_LIMIT,
  PREMIUM_DAILY_LIMIT,
} from '../brain/rate-limit/limits.js';
import { Emoji } from '../config/emojis.js';
import { actionRow, button } from '../discord/components.js';
import { ButtonStyle } from '../discord/constants.js';
import { requester, resolvedUser } from '../discord/interaction-data.js';
import { avatarUrl, displayName } from '../lib/discord-user.js';
import { randomColor } from '../lib/random.js';

const SUBSCRIBE_URL = 'https://chatgpt.com';
const PREMIUM_REFRESH_PREFIX = 'premium:refresh:';

function number(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function usageLimits(snapshot) {
  const minute = snapshot.minuteLimit === null
    ? 'Unlimited per min'
    : `${number(snapshot.minuteRemaining)} / ${number(snapshot.minuteLimit)} per min`;
  return [
    '**Usage Limits**',
    `Rate Limit: ${minute}`,
    `Daily Cap: ${number(snapshot.dailyRemaining)} / ${number(snapshot.dailyLimit)}`,
  ].join('\n');
}

function freeDescription(target, ownProfile, snapshot) {
  const subject = ownProfile ? 'You are' : `**${displayName(target)}** is`;
  const possessive = ownProfile ? 'you currently have' : 'they currently have';
  const missing = ownProfile ? "you're currently missing" : "they're currently missing";
  return [
    `${subject} currently **NOT** a Premium User.`,
    '',
    `**Perks ${possessive}:**`,
    `${Emoji.custom.check} Access to 37 NSFW commands`,
    `${Emoji.custom.check} Cooldown limits: ${number(FREE_MINUTE_LIMIT)}/min & ${number(FREE_DAILY_LIMIT)}/day`,
    '',
    `**Perks ${missing}:**`,
    `${Emoji.custom.check} Unlimited requests per minute`,
    `${Emoji.custom.check} ${number(PREMIUM_DAILY_LIMIT)} requests per day hard ceiling`,
    `${Emoji.custom.check} Instant image pre-fetching & optimization`,
    `${Emoji.custom.check} Premium support server access`,
    '',
    usageLimits(snapshot),
  ].join('\n');
}

function premiumDescription(target, ownProfile, snapshot) {
  const name = displayName(target);
  const status = ownProfile
    ? 'You are currently a **Premium User**.'
    : `**${name}** is currently a **Premium User**.`;
  const thanks = ownProfile
    ? `Thank you, **${name}**, for supporting the bot! Your membership keeps the media flowing.`
    : `Thanks to **${name}** for supporting the bot and helping keep the media flowing.`;
  return [
    status,
    '',
    thanks,
    '',
    '**Premium perks:**',
    `${Emoji.custom.check} Access to 37 NSFW commands`,
    `${Emoji.custom.check} Unlimited requests per minute`,
    `${Emoji.custom.check} ${number(PREMIUM_DAILY_LIMIT)} requests per day hard ceiling`,
    `${Emoji.custom.check} Instant image pre-fetching & optimization`,
    `${Emoji.custom.check} Premium support server access`,
    '',
    usageLimits(snapshot),
  ].join('\n');
}

function refreshCustomId(targetId, viewerId) {
  return `${PREMIUM_REFRESH_PREFIX}${targetId}:${viewerId}`;
}

function parseRefreshCustomId(customId) {
  const match = String(customId ?? '').match(/^premium:refresh:(\d{17,20}):(\d{17,20})$/);
  return match ? { targetId: match[1], viewerId: match[2] } : null;
}

function footerFor(target) {
  const icon = avatarUrl(target);
  return {
    text: displayName(target),
    ...(icon ? { icon_url: icon } : {}),
  };
}

function componentProfile(interaction, refresh) {
  const actor = requester(interaction);
  if (actor?.id === refresh.targetId) {
    return { target: actor, footer: footerFor(actor) };
  }
  const existing = interaction.message?.embeds?.[0]?.footer;
  const target = {
    id: refresh.targetId,
    username: existing?.text || 'Unknown user',
  };
  return {
    target,
    footer: existing?.text
      ? { text: existing.text, ...(existing.icon_url ? { icon_url: existing.icon_url } : {}) }
      : footerFor(target),
  };
}

function responseBody({ target, viewerId, footer, snapshot }) {
  const premium = snapshot.premium;
  return {
    embeds: [{
      title: premium ? 'Premium Plan ($1)' : 'Free Plan ($0)',
      description: premium
        ? premiumDescription(target, viewerId === target.id, snapshot)
        : freeDescription(target, viewerId === target.id, snapshot),
      color: randomColor(),
      footer,
      timestamp: new Date().toISOString(),
    }],
    components: [actionRow(
      button({
        label: premium ? 'Manage' : 'Subscribe',
        style: ButtonStyle.LINK,
        url: SUBSCRIBE_URL,
      }),
      button({
        customId: refreshCustomId(target.id, viewerId),
        emoji: Emoji.ui.refresh,
        style: ButtonStyle.SECONDARY,
      }),
    )],
    attachments: [],
  };
}

export default {
  kind: 'utility',
  rateLimitComponents: true,
  data: commandData({
    name: 'premium',
    description: 'View Premium status, benefits, and remaining request quotas.',
    options: [userOption({
      name: 'user',
      description: 'User whose plan and remaining quotas you want to view.',
    })],
  }),

  async execute(context, state = {}) {
    if (context.source === 'component') {
      const refresh = parseRefreshCustomId(state.customId);
      if (!refresh) {
        await context.responder.reply({ content: 'This Premium refresh button is no longer valid.', flags: 64 });
        return;
      }
      await context.responder.deferUpdate();
      const { target, footer } = componentProfile(context.interaction, refresh);
      const snapshot = context.rateLimiter.snapshot(refresh.targetId);
      await context.responder.editOriginal(responseBody({
        target,
        viewerId: refresh.viewerId,
        footer,
        snapshot,
      }));
      return;
    }

    await context.responder.defer();
    const author = requester(context.interaction);
    const target = resolvedUser(context.interaction, 'user');
    const snapshot = context.rateLimiter.snapshot(target.id);
    await context.responder.editOriginal(responseBody({
      target,
      viewerId: author.id,
      footer: footerFor(target),
      snapshot,
    }));
  },
};

export {
  PREMIUM_REFRESH_PREFIX,
  SUBSCRIBE_URL,
  parseRefreshCustomId,
  refreshCustomId,
  usageLimits as premiumUsageLimits,
};
