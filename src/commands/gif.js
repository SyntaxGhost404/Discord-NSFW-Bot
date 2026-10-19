import { defineMediaCommand } from '../brain/media-command.js';
import { SexComNiches } from '../brain/providers/manifest.js';

export default defineMediaCommand({
  name: 'gif',
  description: 'Delivers a random NSFW GIF',
  title: 'NSFW GIF',
  sources: [
    { provider: 'sexcom', niches: SexComNiches },
    { provider: 'porngifs' },
    { provider: 'nekobot', type: 'pgif' },
    { provider: 'porngifstv' },
  ],
});
