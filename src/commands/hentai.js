import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'hentai',
  description: 'Delivers a random NSFW hentai Image/GIF',
  title: 'NSFW Hentai Image',
  sources: [
    { provider: 'waifuim', tag: 'hentai', isNsfw: true },
    { provider: 'nekobot', type: 'hentai' },
  ],
});
