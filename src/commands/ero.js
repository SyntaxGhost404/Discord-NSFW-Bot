import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'ero',
  description: 'Delivers a random Ero image',
  title: 'NSFW Ero Image',
  sources: [
    { provider: 'waifuarchive', tag: 'ero', isNsfw: true },
  ],
});
