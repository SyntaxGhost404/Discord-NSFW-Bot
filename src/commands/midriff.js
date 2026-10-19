import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'midriff',
  description: 'Delivers a random NSFW midriff Image/GIF',
  title: 'NSFW Midriff Image',
  sources: [
    { provider: 'nekobot', type: 'hmidriff' },
  ],
});
