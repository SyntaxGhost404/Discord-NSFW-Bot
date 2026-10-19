import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'cum',
  description: 'Delivers a random cum/ejaculation GIF',
  title: 'NSFW Cum GIF',
  sources: [
    { provider: 'purrbot', endpoint: 'https://api.purrbot.site/v2/img/nsfw/cum/gif' },
  ],
});
