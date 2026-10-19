import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'breeding',
  description: 'Delivers a random Breeding image',
  title: 'NSFW Breeding Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/breeding' },
  ],
});
