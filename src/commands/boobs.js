import { defineMediaCommand } from '../brain/media-command.js';
import { styleOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'boobs',
  description: 'Delivers a random NSFW boobs Image/GIF',
  title: 'NSFW Boobs Image',
  options: [styleOption],
  optionName: 'style',
  groups: {
    Anime: [
      { provider: 'waifuim', tag: 'oppai', isNsfw: true },
      { provider: 'nekobot', type: 'hboobs' },
    ],
    Real: [
      { provider: 'oboobs' },
      { provider: 'nekobot', type: 'boobs' },
    ],
  },
});
