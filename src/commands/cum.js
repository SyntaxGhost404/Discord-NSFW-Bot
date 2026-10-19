import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'cum',
  description: 'Delivers a random cum/ejaculation GIF',
  title: 'NSFW Cum GIF',
  sources: [
    { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/cum/gif' },
  ],
});
