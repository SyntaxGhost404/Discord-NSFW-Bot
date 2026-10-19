import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'legs',
  description: 'Delivers a random Legs image',
  title: 'NSFW Legs Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/legs' },
  ],
});
