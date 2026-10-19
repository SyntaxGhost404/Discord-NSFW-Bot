import { defineMediaCommand } from '../brain/media-command.js';
import { styleOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'feet',
  description: 'Delivers a random NSFW feet Image/GIF',
  title: 'NSFW Feet Image',
  options: [styleOption],
  optionName: 'style',
  groups: {
    Anime: [
      { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/feet' },
    ],
    Real: [
      { provider: 'nekobot', type: 'feet' },
    ],
  },
});
