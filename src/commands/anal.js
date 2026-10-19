import { defineMediaCommand } from '../brain/media-command.js';
import { styleOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'anal',
  description: 'Delivers a random NSFW anal Image/GIF',
  title: 'NSFW Anal Image',
  options: [styleOption],
  optionName: 'style',
  groups: {
    Anime: [
      { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/anal/gif' },
      { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/anal' },
      { provider: 'nekobot', type: 'hentai_anal' },
      { provider: 'nekosv4', endpoint: 'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=anal' },
    ],
    Real: [
      { provider: 'nekobot', type: 'anal' },
    ],
  },
});
