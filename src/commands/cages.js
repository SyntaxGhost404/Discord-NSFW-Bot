import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'cages',
  description: 'Delivers a random Cages image',
  title: 'NSFW Cages Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/cages' },
  ],
});
