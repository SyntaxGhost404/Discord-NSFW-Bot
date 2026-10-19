import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'pussy',
  description: 'Delivers a random NSFW pussy Image/GIF',
  title: 'NSFW Pussy Image',
  sources: [
    { provider: 'nekosv4', endpoint: 'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=pussy' },
    { provider: 'nekobot', type: 'pussy' },
  ],
});
