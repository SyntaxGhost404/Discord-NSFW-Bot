import { MessageFlag } from '../../discord/constants.js';

const TITLES = Object.freeze([
  'Woah now, slow it down',
  'Woah there, speed racer!',
  'Easy there, turbo!',
  'Hold up, take a breather',
  'Not so fast!',
]);

export function cooldownPayload(releaseAt, random = Math.random) {
  const index = Math.min(TITLES.length - 1, Math.floor(random() * TITLES.length));
  const timestamp = Math.ceil(releaseAt / 1_000);
  return {
    embeds: [{
      title: TITLES[index],
      description: `-# You'll be able to use this command again <t:${timestamp}:R>\n\nThe default cooldown is **60 requests per 60 seconds**\nThe premium cooldown is **Unlimited**`,
      color: 0xfaa61a,
    }],
    components: [],
    flags: MessageFlag.EPHEMERAL,
  };
}

export { TITLES as cooldownTitles };
