import { commandData, stringOption } from '../brain/command-schema.js';
import { actionRow, button, shortTextInput } from '../discord/components.js';
import { ButtonStyle } from '../discord/constants.js';
import { focusedOption, modalValue, optionValue, requester } from '../discord/interaction-data.js';
import { avatarUrl, displayName } from '../lib/discord-user.js';
import { randomColor } from '../lib/random.js';
import { Emoji, uiText } from '../config/emojis.js';

const ITEMS_PER_PAGE = 8;

function levenshteinDistance(left, right) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function visibleCommands(commands) {
  return [...commands.values()].filter((command) => !command.hidden);
}

function pageFromCustomId(customId, fallback = 1) {
  const parsed = Number.parseInt(customId?.split(':').at(-1), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function footer(interaction, text) {
  const user = requester(interaction);
  return { text, icon_url: avatarUrl(user) };
}

async function showDirectory(context, page) {
  const commands = visibleCommands(context.commands);
  const totalPages = Math.max(1, Math.ceil(commands.length / ITEMS_PER_PAGE));
  const boundedPage = Math.min(totalPages, Math.max(1, page));
  const start = (boundedPage - 1) * ITEMS_PER_PAGE;
  const entries = commands.slice(start, start + ITEMS_PER_PAGE);
  const description = [
    'Here is a list of all available commands:',
    '',
    ...entries.flatMap((command) => [
      `**\`/${command.data.name}\`**`,
      command.data.description,
      '',
    ]),
  ].join('\n');

  await context.responder.editOriginal({
    embeds: [{
      title: uiText(Emoji.ui.nsfw, 'Command Directory'),
      description,
      color: randomColor(),
      footer: footer(context.interaction, `Page ${boundedPage} of ${totalPages}`),
      timestamp: new Date().toISOString(),
    }],
    components: [actionRow(
      button({
        customId: `help:page:${boundedPage - 1}`,
        label: `${Emoji.ui.previous} Previous`,
        disabled: boundedPage === 1,
      }),
      button({
        customId: `help:search:${boundedPage}`,
        label: uiText(Emoji.ui.search, 'Search'),
        style: ButtonStyle.SECONDARY,
      }),
      button({
        customId: `help:page:${boundedPage + 1}`,
        label: `Next ${Emoji.ui.next}`,
        disabled: boundedPage === totalPages,
      }),
    )],
    attachments: [],
  });
}

async function showCommand(context, targetName, returnPage = 1) {
  const target = context.commands.get(targetName);
  if (!target || target.hidden) {
    await context.responder.editOriginal({
      embeds: [{
        title: uiText(Emoji.ui.error, 'Error'),
        description: `Could not find information for command \`${targetName}\`.`,
        color: 0xed4245,
      }],
      components: [actionRow(button({
        customId: `help:page:${returnPage}`,
        label: uiText(Emoji.ui.back, 'Back to Directory'),
        style: ButtonStyle.SECONDARY,
      }))],
      attachments: [],
    });
    return;
  }

  const commands = visibleCommands(context.commands);
  const index = commands.findIndex((command) => command.data.name === target.data.name);
  const page = index < 0 ? returnPage : Math.floor(index / ITEMS_PER_PAGE) + 1;
  const parameters = target.data.options?.length
    ? target.data.options.map((item) => `${Emoji.ui.bullet} **\`${item.name}\`** ${item.required ? '(Required)' : '(Optional)'}\n${item.description}`).join('\n')
    : 'No parameters are available for this command.';
  const user = requester(context.interaction);

  await context.responder.editOriginal({
    embeds: [{
      title: uiText(Emoji.ui.nsfw, `Command Details: /${target.data.name}`),
      description: `**Description:**\n${target.data.description}`,
      color: randomColor(),
      fields: [{ name: 'Parameters', value: parameters }],
      footer: footer(context.interaction, displayName(user)),
      timestamp: new Date().toISOString(),
    }],
    components: [actionRow(button({
      customId: `help:page:${page}`,
      label: uiText(Emoji.ui.back, 'Back to Directory'),
      style: ButtonStyle.SECONDARY,
    }))],
    attachments: [],
  });
}

export default {
  data: commandData({
    name: 'help',
    description: 'Directory of all available commands and detailed information.',
    options: [stringOption({
      name: 'command',
      description: 'Select a specific command for detailed information.',
      autocomplete: true,
    })],
  }),

  async autocomplete(context) {
    const query = String(focusedOption(context.interaction)?.value ?? '').toLowerCase();
    const choices = visibleCommands(context.commands)
      .map((command) => command.data.name)
      .filter((name) => name.startsWith(query))
      .slice(0, 25)
      .map((name) => ({ name, value: name }));
    await context.responder.autocomplete(choices);
  },

  async execute(context, state) {
    const customId = state.customId ?? '';
    if (context.source === 'component' && customId.startsWith('help:search:')) {
      const page = pageFromCustomId(customId);
      await context.responder.modal({
        custom_id: `help:modal:${page}`,
        title: 'Search for a Command',
        components: [actionRow(shortTextInput({
          customId: 'search_query',
          label: 'Enter command name',
          minLength: 1,
          maxLength: 32,
        }))],
      });
      return;
    }

    if (context.source === 'command') await context.responder.defer();
    else await context.responder.deferUpdate();

    if (context.source === 'modal') {
      const page = pageFromCustomId(customId);
      const query = modalValue(context.interaction, 'search_query').trim().toLowerCase();
      const names = visibleCommands(context.commands).map((command) => command.data.name);
      const ranked = names
        .map((name) => ({ name, distance: levenshteinDistance(query, name) }))
        .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name));
      const best = ranked[0];
      await showCommand(context, best && best.distance <= 3 ? best.name : query, page);
      return;
    }

    if (context.source === 'component' && customId.startsWith('help:command:')) {
      await showCommand(context, decodeURIComponent(customId.slice('help:command:'.length)));
      return;
    }

    const requested = context.source === 'command' ? optionValue(context.interaction, 'command') : null;
    if (requested) {
      await showCommand(context, String(requested));
      return;
    }
    await showDirectory(context, context.source === 'component' ? pageFromCustomId(customId) : 1);
  },
};

export { levenshteinDistance };
