import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: '4k',
  description: 'Delivers a random NSFW 4k Image/GIF',
  title: 'NSFW 4k Image',
  sources: [
    { provider: 'nekobot', type: '4k' },
  ],
});
