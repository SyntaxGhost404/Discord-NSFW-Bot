import { defineMediaCommand } from '../brain/media-command.js';
import { stringOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'threesome',
  description: 'Delivers a random threesome GIF',
  title: 'NSFW Threesome Image',
  options: [stringOption({
    name: 'type',
    description: 'The type of threesome',
    choices: [
      { name: '3 Females', value: 'fff' },
      { name: '2 Females 1 Male', value: 'ffm' },
      { name: '2 Males 1 Female', value: 'mmf' },
    ],
  })],
  optionName: 'type',
  randomGroups: ['fff', 'ffm', 'mmf', 'nekosv4'],
  groups: {
    fff: [
      { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/threesome_fff/gif' },
    ],
    ffm: [
      { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/threesome_ffm/gif' },
    ],
    mmf: [
      { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/threesome_mmf/gif' },
    ],
    nekosv4: [
      { provider: 'nekosv4', endpoint: 'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=threesome' },
    ],
  },
});
