import { defineMediaCommand } from '../brain/media-command.js';
import { styleOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'thigh',
  description: 'Delivers a random NSFW thigh Image/GIF',
  title: 'NSFW Thigh Image',
  options: [styleOption],
  optionName: 'style',
  groups: {
    Anime: [
      { provider: 'nekobot', type: 'hthigh' },
    ],
    Real: [
      { provider: 'nekobot', type: 'thigh' },
    ],
  },
});
