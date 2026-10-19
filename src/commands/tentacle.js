import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'tentacle',
  description: 'Delivers a random NSFW tentacle Image/GIF',
  title: 'NSFW Tentacle Image',
  sources: [
    { provider: 'nekobot', type: 'tentacle' },
  ],
});
