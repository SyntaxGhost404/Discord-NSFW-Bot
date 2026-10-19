import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'ecchi',
  description: 'Delivers a random Ecchi image',
  title: 'NSFW Ecchi Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/ecchi' },
    { provider: 'waifuarchive', tag: 'ecchi', isNsfw: true },
  ],
});
