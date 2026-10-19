import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'pussylick',
  description: 'Delivers a random cunnilingus GIF',
  title: 'NSFW Pussy Licking GIF',
  sources: [
    { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/pussylick/gif' },
  ],
});
