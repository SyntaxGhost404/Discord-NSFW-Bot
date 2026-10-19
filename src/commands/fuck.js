import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'fuck',
  description: 'Delivers a random penetrative sex GIF',
  title: 'NSFW Sex GIF',
  sources: [
    { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/fuck/gif' },
  ],
});
