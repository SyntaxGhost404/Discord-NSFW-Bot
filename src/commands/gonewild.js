import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'gonewild',
  description: 'Delivers a random NSFW gonewild Image/GIF',
  title: 'NSFW Gonewild Image',
  sources: [
    { provider: 'nekobot', type: 'gonewild' },
  ],
});
