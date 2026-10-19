import { defineMediaCommand } from '../brain/media-command.js';

export default defineMediaCommand({
  name: 'cosplay',
  description: 'Delivers a random NSFW cosplay Image',
  title: 'NSFW Cosplay Image',
  orderedSources: true,
  sources: [
    { provider: 'hentaicosplayxxx' },
    { provider: 'ahottie' },
  ],
});
