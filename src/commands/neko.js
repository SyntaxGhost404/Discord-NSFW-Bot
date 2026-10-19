import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'neko',
  description: 'Delivers a random NSFW neko Image/GIF',
  title: 'NSFW Neko Image',
  sources: [
    { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/neko/gif' },
    { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/neko/img' },
    { provider: 'waifupics', endpoint: 'https://api.waifu.pics/nsfw/neko' },
    { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/neko' },
    { provider: 'nekosv4', endpoint: 'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=catgirl' },
    { provider: 'nekobot', type: 'lewdneko' },
  ],
});
