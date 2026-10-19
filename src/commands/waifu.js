import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'waifu',
  description: 'Delivers a random Waifu image',
  title: 'NSFW Waifu Image',
  sources: [
    { provider: 'waifupics', endpoint: 'https://api.waifu.pics/nsfw/waifu' },
    { provider: 'waifuarchive', tag: 'waifu', isNsfw: true },
  ],
});
