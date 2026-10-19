import { commandData } from '../brain/command-schema.js';
import { randomColor } from '../lib/random.js';
import { Emoji, uiText } from '../config/emojis.js';

function bullets(lines) {
  return lines.map((line) => `${Emoji.ui.bullet} ${line}`).join('\n');
}

export default {
  data: commandData({
    name: 'intro',
    description: 'Internal component handler for the mention introduction.',
  }),
  hidden: true,
  async execute(context, state) {
    const isFeatures = state.customId === 'intro:features';
    await context.responder.reply({
      embeds: [{
        title: isFeatures
          ? uiText(Emoji.ui.search, 'Core Features')
          : uiText(Emoji.ui.tools, 'Support & Usage'),
        description: isFeatures
          ? bullets([
            'Direct Discord HTTP API v10 and Gateway v10 integration',
            'Modular provider fallback network',
            'Searchable command directory',
            'Native URL and attachment delivery',
          ])
          : bullets([
            'Use `/help` to browse categories',
            'Use `/invite` for the installation link',
            'Use `/ping` for connection and host diagnostics',
            'Server media commands require an age-restricted channel',
          ]),
        color: randomColor(),
      }],
      flags: 64,
    });
  },
};
