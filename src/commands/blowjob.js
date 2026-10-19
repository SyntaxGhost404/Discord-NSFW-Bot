import { defineMediaCommand } from '../brain/media-command.js';
import { styleOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'blowjob',
  description: 'Delivers a random NSFW blowjob Image/GIF',
  title: 'NSFW Blowjob Image',
  options: [styleOption],
  optionName: 'style',
  groups: {
    Anime: [
      { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/blowjob/gif' },
      { provider: 'waifupics', endpoint: 'https://api.waifu.pics/nsfw/blowjob' },
      { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/blowjob' },
      { provider: 'waifuim', tag: 'oral', isNsfw: true },
    ],
    Real: [
      { provider: 'nekobot', type: 'blowjob' },
    ],
  },
});
