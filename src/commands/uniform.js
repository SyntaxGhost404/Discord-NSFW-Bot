import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'uniform',
  description: 'Delivers a random Uniform image',
  title: 'NSFW Uniform Image',
  sources: [
    { provider: 'waifuarchive', tag: 'uniform', isNsfw: true },
  ],
});
