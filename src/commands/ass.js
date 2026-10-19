import { defineMediaCommand } from '../brain/media-command.js';
import { styleOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'ass',
  description: 'Delivers a random NSFW ass Image/GIF',
  title: 'NSFW Ass Image',
  options: [styleOption],
  optionName: 'style',
  groups: {
    Anime: [
      { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/ass' },
      { provider: 'waifuim', tag: 'ass', isNsfw: true },
      { provider: 'nekobot', type: 'hass' },
    ],
    Real: [
      { provider: 'obutts' },
      { provider: 'nekobot', type: 'ass' },
    ],
  },
});
