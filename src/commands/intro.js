import { commandData } from '../brain/command-schema.js';
import { ephemeral } from '../discord/responses.js';
import { randomColor } from '../lib/random.js';
import { Emoji, uiText } from '../config/emojis.js';

function bullets(lines) {
  return lines.map((line) => `${Emoji.ui.bullet} ${line}`).join('\n');
}

// Hidden handler for the buttons on the mention welcome message.
export default {
  data: commandData({
    name: 'intro',
    description: 'Internal component handler for the mention introduction.',
  }),
  hidden: true,
  execute(_context, state) {
    const isFeatures = state.customId === 'intro:features';
    return ephemeral({
      embeds: [{
        title: isFeatures
          ? uiText(Emoji.ui.search, 'Core Features')
          : uiText(Emoji.ui.tools, 'Support & Usage'),
        description: isFeatures
          ? bullets([
            'Serverless on Cloudflare Workers with Discord HTTP interactions',
            'Modular provider fallback network',
            'Searchable command directory',
            'Native URL and attachment delivery',
          ])
          : bullets([
            'Use `/help` to browse categories',
            'Use `/invite` for the installation link',
            'Use `/ping` for latency and runtime diagnostics',
            'Server media commands require an age-restricted channel',
          ]),
        color: randomColor(),
      }],
    });
  },
};
