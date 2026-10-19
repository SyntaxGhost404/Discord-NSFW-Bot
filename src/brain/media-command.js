import { fetchMedia } from './providers/index.js';
import { MediaHttpClient, SubrequestBudget } from './providers/http.js';
import { commandData } from './command-schema.js';
import { actionRow, button } from '../discord/components.js';
import { ButtonStyle } from '../discord/constants.js';
import { mediaCustomId, optionValue, requester } from '../discord/interaction-data.js';
import { deferFor, errorEmbed } from '../discord/responses.js';
import { Emoji, uiText } from '../config/emojis.js';
import { avatarUrl, displayName } from '../lib/discord-user.js';
import { choose, randomColor, shuffle } from '../lib/random.js';

// Time and subrequests kept back for the final Discord upload, so a slow
// provider can never consume the window needed to deliver the result.
const DISCORD_UPLOAD_RESERVE_MS = 4_000;
const DISCORD_SUBREQUEST_RESERVE = 2;
const MINIMUM_ATTEMPT_MS = 1_500;

function allGroupedSources(groups) {
  return Object.values(groups ?? {}).flat();
}

function selectedOption(specification, interaction, state) {
  return state[specification.optionName] || optionValue(interaction, specification.optionName);
}

function sourcePool(specification, interaction, state) {
  if (specification.optionName && specification.groups) {
    const selected = selectedOption(specification, interaction, state);
    if (selected && specification.groups[selected]) return specification.groups[selected];
    if (specification.randomGroups?.length) return specification.groups[choose(specification.randomGroups)] ?? [];
    return allGroupedSources(specification.groups);
  }
  return specification.sources ?? [];
}

function refreshState(specification, interaction, state) {
  if (!specification.optionName) return state;
  const selected = selectedOption(specification, interaction, state);
  return selected ? { ...state, [specification.optionName]: selected } : state;
}

function validLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function errorDescription(errors) {
  if (errors.some((error) => error?.code === 'TIMEOUT' || error?.code === 'DEADLINE_EXCEEDED')) {
    return 'Every available media source timed out. Please try again shortly.';
  }
  if (errors.length > 0 && errors.every((error) => error?.code === 'PROVIDER_DISABLED')) {
    return 'The required media provider is not configured. Check the provider secrets.';
  }
  return 'No media source returned a usable result. Please try again.';
}

export async function resolveMedia(specification, context, state) {
  const pool = sourcePool(specification, context.interaction, state);
  const sources = specification.orderedSources ? [...pool] : shuffle(pool);
  const errors = [];
  for (const source of sources) {
    if (context.http.remainingTime() < MINIMUM_ATTEMPT_MS) {
      errors.push(Object.assign(new Error('The media deadline left no time for another source.'), { code: 'DEADLINE_EXCEEDED' }));
      break;
    }
    try {
      context.logger.event('Requesting media from provider.', { command: specification.name, provider: source.provider });
      const candidate = await fetchMedia(source, context);
      if (candidate && !validLink(candidate.url)) {
        throw Object.assign(new TypeError('Media provider returned an invalid media URL.'), { code: 'INVALID_URL' });
      }
      if (candidate) {
        context.logger.success('Media provider returned a usable result.', {
          command: specification.name,
          provider: candidate.provider,
          attachment: Boolean(candidate.buffer),
        });
        return { result: candidate, errors };
      }
    } catch (error) {
      errors.push(error);
      // Waifu.pics is disabled by default, so skipping a disabled source is
      // routine rather than a warning.
      const level = error?.code === 'PROVIDER_DISABLED' ? 'debug' : 'warn';
      context.logger[level]('Media source failed; trying the next configured source.', {
        command: specification.name,
        provider: source.provider,
        code: error?.code,
        error,
      });
      if (error?.code === 'BUDGET_EXHAUSTED') break;
    }
  }
  return { result: null, errors };
}

export function mediaMessage(specification, context, state, result) {
  const user = requester(context.interaction);
  const imageReference = result.buffer ? `attachment://${result.fileName}` : result.url;
  const embed = {
    title: uiText(Emoji.ui.nsfw, specification.title),
    color: randomColor(),
    image: { url: imageReference },
    footer: {
      text: displayName(user),
      icon_url: avatarUrl(user),
    },
    timestamp: new Date().toISOString(),
  };
  const link = validLink(result.watchUrl) ? result.watchUrl : result.url;
  const body = {
    embeds: [embed],
    components: [actionRow(
      button({
        customId: mediaCustomId(specification.name, refreshState(specification, context.interaction, state)),
        label: uiText(Emoji.ui.refresh, 'Refresh'),
      }),
      button({ label: uiText(Emoji.ui.link, 'Link'), style: ButtonStyle.LINK, url: link }),
    )],
    attachments: result.buffer ? [{ id: 0, filename: result.fileName }] : [],
  };
  const files = result.buffer
    ? [{ data: result.buffer, name: result.fileName, contentType: result.contentType }]
    : [];
  return { body, files };
}

// Runs after the deferred acknowledgement: tries the command's providers in
// order until one succeeds, then edits the loading message in place.
export async function runMediaRequest(specification, context, state = {}) {
  const deadline = context.receivedAt + context.config.mediaDeadlineMs - DISCORD_UPLOAD_RESERVE_MS;
  const http = new MediaHttpClient({
    timeoutMs: context.config.mediaTimeoutMs,
    maximumBytes: context.maxMediaBytes,
    deadline,
    budget: new SubrequestBudget(Math.max(1, context.config.maxSubrequests - DISCORD_SUBREQUEST_RESERVE)),
    fetchImpl: context.fetch,
  });
  const { result, errors } = await resolveMedia(specification, { ...context, http }, state);

  if (!result) {
    await context.webhook.editOriginal({
      embeds: [errorEmbed(uiText(Emoji.ui.error, 'Error'), errorDescription(errors))],
      components: [],
      attachments: [],
    });
    return { mediaDisplayed: false };
  }

  const { body, files } = mediaMessage(specification, context, state, result);
  await context.webhook.editOriginal(body, files);
  return { mediaDisplayed: true };
}

export function defineMediaCommand(specification) {
  const data = commandData({
    name: specification.name,
    description: specification.description,
    nsfw: true,
    options: specification.options ?? [],
  });

  return {
    data,
    kind: 'media',
    media: specification,
    execute(context, state = {}) {
      return deferFor(context.source, () => runMediaRequest(specification, context, state));
    },
  };
}
