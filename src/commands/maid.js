import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'maid',
  description: 'Delivers a random Maid image',
  title: 'NSFW Maid Image',
  sources: [
    { provider: 'waifuarchive', tag: 'maid', isNsfw: true },
    { provider: 'nekosv4', endpoint: 'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=maid' },
  ],
});
