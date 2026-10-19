import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'smothering',
  description: 'Delivers a random Smothering image',
  title: 'NSFW Smothering Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/smothering' },
  ],
});
