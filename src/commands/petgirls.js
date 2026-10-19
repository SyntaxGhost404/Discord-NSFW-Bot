import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'petgirls',
  description: 'Delivers a random Petgirls image',
  title: 'NSFW Petgirls Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/petgirls' },
  ],
});
