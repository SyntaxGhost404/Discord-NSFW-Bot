import { defineMediaCommand } from '../brain/media-command.js';
import { stringOption } from '../brain/command-schema.js';

export default defineMediaCommand({
  name: 'solo',
  description: 'Delivers a random solo masturbation Image/GIF',
  title: 'NSFW Solo Image',
  options: [stringOption({
    name: 'gender',
    description: 'The gender for the solo Image/GIF',
    choices: [
      { name: 'Female', value: 'female' },
      { name: 'Male', value: 'male' },
    ],
  })],
  optionName: 'gender',
  randomGroups: ['female', 'male', 'nekosv4'],
  groups: {
    female: [
      { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/solo/gif' },
      { provider: 'abd', endpoint: 'https://api.n-sfw.com/nsfw/masturbation' },
    ],
    male: [
      { provider: 'purrbot', endpoint: 'https://purrbot.site/api/img/nsfw/solo_male/gif' },
    ],
    nekosv4: [
      { provider: 'nekosv4', endpoint: 'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=masturbating' },
    ],
  },
});
