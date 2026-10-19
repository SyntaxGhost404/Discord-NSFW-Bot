import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'socks',
  description: 'Delivers a random Socks image',
  title: 'NSFW Socks Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/socks' },
  ],
});
