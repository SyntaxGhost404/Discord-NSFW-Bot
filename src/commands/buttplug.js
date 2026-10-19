import { defineMediaCommand } from '../brain/media-command.js';
import { styleOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'buttplug',
  description: 'Delivers a random Buttplug image',
  title: 'NSFW Buttplug Image',
  options: [styleOption],
  optionName: 'style',
  groups: {
    Anime: [
      { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/buttplug' },
    ],
    Real: [
      { provider: 'pornpics', endpoint: 'https://www.pornpics.com/butt-plug/' },
    ],
  },
});
