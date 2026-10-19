import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'yuri',
  description: 'Delivers a random NSFW yuri Image/GIF',
  title: 'NSFW Yuri Image',
  sources: [
    { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/yuri/gif' },
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/yuri' },
    { provider: 'nekobot', type: 'hyuri' },
    { provider: 'nekosv4', endpoint: 'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=yuri' },
  ],
});
