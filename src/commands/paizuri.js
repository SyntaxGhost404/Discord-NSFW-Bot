import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'paizuri',
  description: 'Delivers a random NSFW paizuri Image/GIF',
  title: 'NSFW Paizuri Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/paizuri' },
    { provider: 'waifuim', tag: 'paizuri', isNsfw: true },
    { provider: 'nekobot', type: 'paizuri' },
  ],
});
