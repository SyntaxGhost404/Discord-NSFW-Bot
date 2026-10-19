import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'kitsune',
  description: 'Delivers a random NSFW kitsune Image/GIF',
  title: 'NSFW Kitsune Image',
  sources: [
    { provider: 'nekobot', type: 'hkitsune' },
  ],
});
