import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'milf',
  description: 'Delivers a random Milf image',
  title: 'NSFW Milf Image',
  sources: [
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/milf' },
    { provider: 'waifuarchive', tag: 'milf', isNsfw: true },
  ],
});
