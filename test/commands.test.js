import { describe, expect, it } from 'vitest';
import { buildCommandRegistry, commands } from '../src/commands/index.js';
import { providerNames } from '../src/brain/providers/index.js';
import { SexComNiches } from '../src/brain/providers/manifest.js';
import { mediaCustomId, parseMediaCustomId } from '../src/discord/interaction-data.js';
import { levenshteinDistance } from '../src/commands/help.js';

function mediaSources(command) {
  return [...(command.media.sources ?? []), ...Object.values(command.media.groups ?? {}).flat()];
}

function descriptor(source) {
  if (source.endpoint) return `${source.provider}:${source.endpoint}`;
  if (source.type) return `${source.provider}:type=${source.type}`;
  if (source.tag) return `${source.provider}:tag=${source.tag}`;
  if (source.niches) return `${source.provider}:niches=${source.niches.length}`;
  return source.provider;
}

const purr = (path) => `purrbot:https://api.purrbot.site/v2/img/nsfw/${path}`;
const abd = (category) => `abd:https://api.n-sfw.com/nsfw/${category}`;
const nekoBot = (type) => `nekobot:type=${type}`;
const nekos = (tag) => `nekosv4:https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=${tag}`;
const waifuArchive = (tag) => `waifuarchive:tag=${tag}`;
const waifuPics = (category) => `waifupics:https://api.waifu.pics/nsfw/${category}`;

// The complete command-to-provider mapping, carried over from the previous
// runtime with Purrbot moved to its v2 host and the Waifu.im sources moved to
// the self-hosted Waifu archive after Waifu.im shut down.
const expectedCommandSources = {
  '4k': { all: [nekoBot('4k')] },
  anal: { Anime: [purr('anal/gif'), abd('anal'), nekoBot('hentai_anal'), nekos('anal')], Real: [nekoBot('anal')] },
  ass: { Anime: [abd('ass'), waifuArchive('ass'), nekoBot('hass')], Real: ['obutts', nekoBot('ass')] },
  blowjob: { Anime: [purr('blowjob/gif'), waifuPics('blowjob'), abd('blowjob'), waifuArchive('oral')], Real: [nekoBot('blowjob')] },
  boobs: { Anime: [waifuArchive('oppai'), nekoBot('hboobs')], Real: ['oboobs', nekoBot('boobs')] },
  breeding: { all: [abd('breeding')] },
  buttplug: { Anime: [abd('buttplug')], Real: ['pornpics:https://www.pornpics.com/butt-plug/'] },
  cages: { all: [abd('cages')] },
  cosplay: { all: ['hentaicosplayxxx', 'ahottie'] },
  cum: { all: [purr('cum/gif')] },
  ecchi: { all: [abd('ecchi'), waifuArchive('ecchi')] },
  ero: { all: [waifuArchive('ero')] },
  feet: { Anime: [abd('feet')], Real: [nekoBot('feet')] },
  fuck: { all: [purr('fuck/gif')] },
  gif: { all: ['sexcom:niches=31', 'porngifs', nekoBot('pgif'), 'porngifstv'] },
  gonewild: { all: [nekoBot('gonewild')] },
  hentai: { all: [waifuArchive('hentai'), nekoBot('hentai')] },
  kitsune: { all: [nekoBot('hkitsune')] },
  legs: { all: [abd('legs')] },
  maid: { all: [waifuArchive('maid'), nekos('maid')] },
  midriff: { all: [nekoBot('hmidriff')] },
  milf: { all: [abd('milf'), waifuArchive('milf')] },
  neko: { all: [purr('neko/gif'), purr('neko/img'), waifuPics('neko'), abd('neko'), nekos('catgirl'), nekoBot('lewdneko')] },
  paizuri: { all: [abd('paizuri'), waifuArchive('paizuri'), nekoBot('paizuri')] },
  petgirls: { all: [abd('petgirls')] },
  pussy: { all: [nekos('pussy'), nekoBot('pussy')] },
  pussylick: { all: [purr('pussylick/gif')] },
  selfie: { all: [abd('selfie'), waifuArchive('selfies')] },
  smothering: { all: [abd('smothering')] },
  socks: { all: [abd('socks')] },
  solo: { female: [purr('solo/gif'), abd('masturbation')], male: [purr('solo_male/gif')], nekosv4: [nekos('masturbating')] },
  tentacle: { all: [nekoBot('tentacle')] },
  thigh: { Anime: [nekoBot('hthigh')], Real: [nekoBot('thigh')] },
  threesome: { fff: [purr('threesome_fff/gif')], ffm: [purr('threesome_ffm/gif')], mmf: [purr('threesome_mmf/gif')], nekosv4: [nekos('threesome')] },
  uniform: { all: [waifuArchive('uniform')] },
  waifu: { all: [waifuPics('waifu'), waifuArchive('waifu')] },
  yuri: { all: [purr('yuri/gif'), abd('yuri'), nekoBot('hyuri'), nekos('yuri')] },
};

describe('command registry', () => {
  it('loads 41 public commands plus the hidden intro handler, in directory order', () => {
    expect(commands.size).toBe(42);
    const visible = [...commands.values()].filter((command) => !command.hidden).map((command) => command.data.name);
    expect(visible).toHaveLength(41);
    expect(visible[0]).toBe('4k');
    expect(visible).toEqual([...visible].sort((left, right) => left.localeCompare(right)));
    expect(commands.get('intro').hidden).toBe(true);
  });

  it('marks every media command age-restricted for all installs and contexts', () => {
    const media = [...commands.values()].filter((command) => command.kind === 'media');
    expect(media).toHaveLength(37);
    for (const command of media) {
      expect(command.data).toMatchObject({ type: 1, nsfw: true, integration_types: [0, 1], contexts: [0, 1, 2] });
    }
    for (const name of ['help', 'invite', 'ping', 'premium']) expect(commands.get(name).data.nsfw).toBe(false);
  });

  it('keeps the full provider mapping for every media command', () => {
    const actual = {};
    for (const command of [...commands.values()].filter((item) => item.kind === 'media')) {
      const groups = command.media.groups ?? { all: command.media.sources ?? [] };
      actual[command.data.name] = Object.fromEntries(Object.entries(groups).map(([name, sources]) => [name, sources.map(descriptor)]));
    }
    expect(actual).toEqual(expectedCommandSources);
    expect(commands.get('solo').media.randomGroups).toEqual(['female', 'male', 'nekosv4']);
    expect(commands.get('threesome').media.randomGroups).toEqual(['fff', 'ffm', 'mmf', 'nekosv4']);
    expect(commands.get('cosplay').media.orderedSources).toBe(true);
    expect(SexComNiches).toHaveLength(31);
  });

  it('only references registered provider adapters', () => {
    for (const command of [...commands.values()].filter((item) => item.kind === 'media')) {
      for (const source of mediaSources(command)) expect(providerNames).toContain(source.provider);
    }
  });

  it('fits every refresh state into Discord\'s 100-character custom_id', () => {
    for (const command of [...commands.values()].filter((item) => item.kind === 'media')) {
      const values = Object.keys(command.media.groups ?? { none: [] });
      for (const value of values) {
        const state = command.media.optionName ? { [command.media.optionName]: value } : {};
        const customId = mediaCustomId(command.data.name, state);
        expect(customId.length).toBeLessThanOrEqual(100);
        expect(parseMediaCustomId(customId)).toEqual({ commandName: command.data.name, state });
      }
    }
  });

  it('rejects malformed or duplicate command modules', () => {
    const valid = commands.get('invite');
    expect(() => buildCommandRegistry([valid, valid])).toThrow(/Duplicate/);
    expect(() => buildCommandRegistry([{ data: { name: 'Bad Name', description: 'x' }, execute() {} }])).toThrow(/invalid command name/);
    expect(() => buildCommandRegistry([{ data: { name: 'x', description: 'y'.repeat(101) }, execute() {} }])).toThrow(/longer than 100/);
  });

  it('ranks fuzzy help searches by edit distance', () => {
    expect(levenshteinDistance('tentacel', 'tentacle')).toBe(2);
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });
});
