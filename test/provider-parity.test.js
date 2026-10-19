import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCommands } from '../src/brain/command-loader.js';
import { ProviderEndpoint, SexComNiches } from '../src/brain/providers/manifest.js';
import { Logger } from '../src/lib/logger.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const commands = await loadCommands(path.join(root, 'src', 'commands'), new Logger('error'));

function mediaSources() {
  return [...commands.values()].flatMap((command) => {
    if (!command.media) return [];
    return [
      ...(command.media.sources ?? []),
      ...Object.values(command.media.groups ?? {}).flat(),
    ];
  });
}

function valuesFor(provider, field) {
  return [...new Set(mediaSources()
    .filter((source) => source.provider === provider && source[field])
    .map((source) => source[field]))]
    .sort();
}

function descriptor(source) {
  if (source.endpoint) return `${source.provider}:${source.endpoint}`;
  if (source.type) return `${source.provider}:type=${source.type}`;
  if (source.tag) return `${source.provider}:tag=${source.tag}`;
  if (source.niches) return `${source.provider}:niches=${source.niches.length}`;
  return source.provider;
}

const purr = (path) => `purrbot:https://purrbot.site/api/img/nsfw/${path}`;
const abd = (category) => `abd:https://api.n-sfw.com/nsfw/${category}`;
const nekoBot = (type) => `nekobot:type=${type}`;
const nekos = (tag) => `nekosv4:https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=${tag}`;
const waifuIm = (tag) => `waifuim:tag=${tag}`;
const waifuPics = (category) => `waifupics:https://api.waifu.pics/nsfw/${category}`;

const expectedCommandSources = {
  '4k': { all: [nekoBot('4k')] },
  anal: { Anime: [purr('anal/gif'), abd('anal'), nekoBot('hentai_anal'), nekos('anal')], Real: [nekoBot('anal')] },
  ass: { Anime: [abd('ass'), waifuIm('ass'), nekoBot('hass')], Real: ['obutts', nekoBot('ass')] },
  blowjob: { Anime: [purr('blowjob/gif'), waifuPics('blowjob'), abd('blowjob'), waifuIm('oral')], Real: [nekoBot('blowjob')] },
  boobs: { Anime: [waifuIm('oppai'), nekoBot('hboobs')], Real: ['oboobs', nekoBot('boobs')] },
  breeding: { all: [abd('breeding')] },
  buttplug: {
    Anime: [abd('buttplug')],
    Real: ['pornpics:https://www.pornpics.com/butt-plug/'],
  },
  cages: { all: [abd('cages')] },
  cosplay: { all: ['hentaicosplayxxx', 'ahottie'] },
  cum: { all: [purr('cum/gif')] },
  ecchi: { all: [abd('ecchi'), waifuIm('ecchi')] },
  ero: { all: [waifuIm('ero')] },
  feet: { Anime: [abd('feet')], Real: [nekoBot('feet')] },
  fuck: { all: [purr('fuck/gif')] },
  gif: { all: ['sexcom:niches=31', 'porngifs', nekoBot('pgif'), 'porngifstv'] },
  gonewild: { all: [nekoBot('gonewild')] },
  hentai: { all: [waifuIm('hentai'), nekoBot('hentai')] },
  kitsune: { all: [nekoBot('hkitsune')] },
  legs: { all: [abd('legs')] },
  maid: { all: [waifuIm('maid'), nekos('maid')] },
  midriff: { all: [nekoBot('hmidriff')] },
  milf: { all: [abd('milf'), waifuIm('milf')] },
  neko: { all: [purr('neko/gif'), purr('neko/img'), waifuPics('neko'), abd('neko'), nekos('catgirl'), nekoBot('lewdneko')] },
  paizuri: { all: [abd('paizuri'), waifuIm('paizuri'), nekoBot('paizuri')] },
  petgirls: { all: [abd('petgirls')] },
  pussy: { all: [nekos('pussy'), nekoBot('pussy')] },
  pussylick: { all: [purr('pussylick/gif')] },
  selfie: { all: [abd('selfie'), waifuIm('selfies')] },
  smothering: { all: [abd('smothering')] },
  socks: { all: [abd('socks')] },
  solo: { female: [purr('solo/gif'), abd('masturbation')], male: [purr('solo_male/gif')], nekosv4: [nekos('masturbating')] },
  tentacle: { all: [nekoBot('tentacle')] },
  thigh: { Anime: [nekoBot('hthigh')], Real: [nekoBot('thigh')] },
  threesome: { fff: [purr('threesome_fff/gif')], ffm: [purr('threesome_ffm/gif')], mmf: [purr('threesome_mmf/gif')], nekosv4: [nekos('threesome')] },
  uniform: { all: [waifuIm('uniform')] },
  waifu: { all: [waifuPics('waifu'), waifuIm('waifu')] },
  yuri: { all: [purr('yuri/gif'), abd('yuri'), nekoBot('hyuri'), nekos('yuri')] },
};

test('each command retains its legacy mapping plus explicit active extensions', () => {
  const actual = {};
  for (const command of [...commands.values()].filter((item) => item.kind === 'media')) {
    const groups = command.media.groups ?? { all: command.media.sources ?? [] };
    actual[command.data.name] = Object.fromEntries(Object.entries(groups).map(([name, sources]) => [
      name,
      sources.map(descriptor),
    ]));
  }
  assert.deepEqual(actual, expectedCommandSources);
  assert.deepEqual(commands.get('solo').media.randomGroups, ['female', 'male', 'nekosv4']);
  assert.deepEqual(commands.get('threesome').media.randomGroups, ['fff', 'ffm', 'mmf', 'nekosv4']);
  assert.equal(commands.get('cosplay').media.orderedSources, true);
});

test('all legacy N-SFW endpoint categories are retained', () => {
  assert.deepEqual(valuesFor('abd', 'endpoint'), [
    'https://api.n-sfw.com/nsfw/anal',
    'https://api.n-sfw.com/nsfw/ass',
    'https://api.n-sfw.com/nsfw/blowjob',
    'https://api.n-sfw.com/nsfw/breeding',
    'https://api.n-sfw.com/nsfw/buttplug',
    'https://api.n-sfw.com/nsfw/cages',
    'https://api.n-sfw.com/nsfw/ecchi',
    'https://api.n-sfw.com/nsfw/feet',
    'https://api.n-sfw.com/nsfw/legs',
    'https://api.n-sfw.com/nsfw/masturbation',
    'https://api.n-sfw.com/nsfw/milf',
    'https://api.n-sfw.com/nsfw/neko',
    'https://api.n-sfw.com/nsfw/paizuri',
    'https://api.n-sfw.com/nsfw/petgirls',
    'https://api.n-sfw.com/nsfw/selfie',
    'https://api.n-sfw.com/nsfw/smothering',
    'https://api.n-sfw.com/nsfw/socks',
    'https://api.n-sfw.com/nsfw/yuri',
  ]);
});

test('all legacy Purrbot endpoints are retained explicitly', () => {
  assert.deepEqual(valuesFor('purrbot', 'endpoint'), [
    'https://purrbot.site/api/img/nsfw/anal/gif',
    'https://purrbot.site/api/img/nsfw/blowjob/gif',
    'https://purrbot.site/api/img/nsfw/cum/gif',
    'https://purrbot.site/api/img/nsfw/fuck/gif',
    'https://purrbot.site/api/img/nsfw/neko/gif',
    'https://purrbot.site/api/img/nsfw/neko/img',
    'https://purrbot.site/api/img/nsfw/pussylick/gif',
    'https://purrbot.site/api/img/nsfw/solo/gif',
    'https://purrbot.site/api/img/nsfw/solo_male/gif',
    'https://purrbot.site/api/img/nsfw/threesome_fff/gif',
    'https://purrbot.site/api/img/nsfw/threesome_ffm/gif',
    'https://purrbot.site/api/img/nsfw/threesome_mmf/gif',
    'https://purrbot.site/api/img/nsfw/yuri/gif',
  ]);
});

test('all legacy NekoBot types are retained', () => {
  assert.deepEqual(valuesFor('nekobot', 'type'), [
    '4k', 'anal', 'ass', 'blowjob', 'boobs', 'feet', 'gonewild', 'hass', 'hboobs',
    'hentai', 'hentai_anal', 'hkitsune', 'hmidriff', 'hthigh', 'hyuri', 'lewdneko',
    'paizuri', 'pgif', 'pussy', 'tentacle', 'thigh',
  ]);
});

test('all legacy Waifu.im and Nekos API tags are retained', () => {
  assert.deepEqual(valuesFor('waifuim', 'tag'), [
    'ass', 'ecchi', 'ero', 'hentai', 'maid', 'milf', 'oppai', 'oral', 'paizuri',
    'selfies', 'uniform', 'waifu',
  ]);
  assert.deepEqual(valuesFor('nekosv4', 'endpoint'), [
    'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=anal',
    'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=catgirl',
    'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=maid',
    'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=masturbating',
    'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=pussy',
    'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=threesome',
    'https://api.nekosapi.com/v4/images/random?limit=1&rating=explicit,suggestive&tags=yuri',
  ]);
});

test('all legacy Waifu.pics categories and Sex.com niches are retained', () => {
  assert.deepEqual(valuesFor('waifupics', 'endpoint'), [
    'https://api.waifu.pics/nsfw/blowjob',
    'https://api.waifu.pics/nsfw/neko',
    'https://api.waifu.pics/nsfw/waifu',
  ]);
  assert.equal(SexComNiches.length, 31);
  assert.equal(new Set(SexComNiches).size, 31);
});

test('provider manifest retains utility endpoints and URL parameters', () => {
  assert.equal(ProviderEndpoint.OBOOBS_RANDOM, 'http://api.oboobs.ru/boobs/0/1/random/');
  assert.equal(ProviderEndpoint.OBOOBS_BY_ID, 'http://api.oboobs.ru/boobs/get/{id}/');
  assert.equal(ProviderEndpoint.OBUTTS_RANDOM, 'http://api.obutts.ru/butts/0/1/random/');
  assert.equal(ProviderEndpoint.OBUTTS_BY_ID, 'http://api.obutts.ru/butts/get/{id}/');
  assert.match(ProviderEndpoint.PORNGIFS_TV, /action=ajax&mode=async&function=get_block/);
  assert.match(ProviderEndpoint.PORNGIFS_TV, /block_id=list_videos_most_recent_videos/);
  assert.match(ProviderEndpoint.PORNGIFS_TV, /sort_by=post_date&from=\{page\}/);
  assert.equal(ProviderEndpoint.WAIFU_IM, 'https://api.waifu.im/images');
  assert.equal(ProviderEndpoint.SEX_COM_SEARCH, 'https://www.sex.com/portal/api/gifs/search');
  assert.equal(ProviderEndpoint.PORNPICS_BUTTPLUG_FEED, 'https://www.pornpics.com/butt-plug/');
  assert.equal(ProviderEndpoint.HENTAI_COSPLAY_FEED, 'https://hentai-cosplay-xxx.com/search/page/{page}/');
  assert.equal(ProviderEndpoint.AHOTTIE_COSPLAY_FEED, 'https://ahottie.top/tags/Cosplay?page={page}');
});
