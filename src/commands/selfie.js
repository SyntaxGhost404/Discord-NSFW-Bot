import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'selfie',
  description: 'Delivers a random Selfie image',
  title: 'NSFW Selfie Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/selfie' },
    { provider: 'waifuim', tag: 'selfies', isNsfw: true },
  ],
});
