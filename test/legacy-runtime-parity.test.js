import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCommands } from '../src/brain/command-loader.js';
import { SexComNiches } from '../src/brain/providers/manifest.js';
import { Logger } from '../src/lib/logger.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const legacyDirectory = path.join(root, 'archive', 'legacy', 'commands');
const modernCommands = await loadCommands(path.join(root, 'src', 'commands'), new Logger('error'));

function fluentBuilder() {
  let proxy;
  proxy = new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return undefined;
      if (property === 'toJSON') return () => ({});
      if (property === 'addStringOption') {
        return (configure) => {
          configure(fluentBuilder());
          return proxy;
        };
      }
      return () => proxy;
    },
  });
  return proxy;
}

class FluentBuilder {
  constructor() {
    return fluentBuilder();
  }
}

const discordStub = {
  SlashCommandBuilder: FluentBuilder,
  EmbedBuilder: FluentBuilder,
  ActionRowBuilder: FluentBuilder,
  ButtonBuilder: FluentBuilder,
  AttachmentBuilder: FluentBuilder,
  ModalBuilder: FluentBuilder,
  TextInputBuilder: FluentBuilder,
  ButtonStyle: { PRIMARY: 1, Primary: 1, SECONDARY: 2, Secondary: 2, LINK: 5, Link: 5 },
  TextInputStyle: { SHORT: 1, Short: 1 },
};

let providerCalls = [];
const providerFunctions = [
  'fetchABD',
  'fetchAss',
  'fetchBoobs',
  'fetchNekoBot',
  'fetchNekosV4',
  'fetchPorngifs',
  'fetchPorngifsTv',
  'fetchPurrbot',
  'fetchSexcom',
  'fetchWaifu',
  'fetchWaifuIm',
];
const apiStub = Object.fromEntries(providerFunctions.map((name) => [name, async (...args) => {
  providerCalls.push({ name, args });
  const result = {
    id: '123',
    source: name,
    url: 'https://cdn.example/media.gif',
  };
  if (['fetchABD', 'fetchPorngifs', 'fetchPorngifsTv'].includes(name)) {
    result.buffer = Buffer.from('media');
  }
  return result;
}]));
const loggerStub = new Proxy({}, { get: () => () => undefined });

const require = createRequire(import.meta.url);
const originalModuleLoad = Module._load;
Module._load = function loadLegacyDependency(request, parent, isMain) {
  if (request === 'discord.js') return discordStub;
  if (request === '../utils/api') return apiStub;
  if (request === '../utils/logger') return loggerStub;
  return originalModuleLoad.call(this, request, parent, isMain);
};

const legacyModules = new Map();
try {
  for (const fileName of fs.readdirSync(legacyDirectory).filter((name) => name.endsWith('.js'))) {
    legacyModules.set(fileName.slice(0, -3), require(path.join(legacyDirectory, fileName)));
  }
} finally {
  Module._load = originalModuleLoad;
}

function fakeInteraction(optionValues) {
  return {
    options: {
      getString(name) { return optionValues[name] ?? null; },
    },
    user: {
      username: 'parity-auditor',
      displayAvatarURL() { return 'https://cdn.example/avatar.png'; },
    },
    member: { displayName: 'parity-auditor' },
    async deferReply() {},
    async deferUpdate() {},
    async editReply() {},
    async reply() {},
    async update() {},
  };
}

function scenarioGroups(commandName) {
  if (commandName === 'buttplug') {
    return [{ group: 'Anime', options: {} }];
  }
  if (['anal', 'ass', 'blowjob', 'boobs', 'feet', 'thigh'].includes(commandName)) {
    return [
      { group: 'Anime', options: { style: 'Anime' } },
      { group: 'Real', options: { style: 'Real' } },
    ];
  }
  if (commandName === 'solo') {
    return [
      { group: 'female', options: { gender: 'female' } },
      { group: 'male', options: { gender: 'male' } },
      { group: 'nekosv4', options: { gender: null }, randomRange: [2 / 3, 1] },
    ];
  }
  if (commandName === 'threesome') {
    return [
      { group: 'fff', options: { type: 'fff' } },
      { group: 'ffm', options: { type: 'ffm' } },
      { group: 'mmf', options: { type: 'mmf' } },
      { group: 'nekosv4', options: { type: null }, randomRange: [3 / 4, 1] },
    ];
  }
  return [{ group: 'all', options: {} }];
}

function normalizeLegacyCall({ name, args }) {
  switch (name) {
    case 'fetchABD': return `abd:endpoint=${args[0]}`;
    case 'fetchAss': return 'obutts';
    case 'fetchBoobs': return 'oboobs';
    case 'fetchNekoBot': return `nekobot:type=${args[0]}`;
    case 'fetchNekosV4': return `nekosv4:endpoint=${args[0]}`;
    case 'fetchPorngifs': return 'porngifs';
    case 'fetchPorngifsTv': return 'porngifstv';
    case 'fetchPurrbot': return `purrbot:endpoint=${args[0]}`;
    case 'fetchSexcom': return 'sexcom';
    case 'fetchWaifu': return `waifupics:endpoint=${args[0]}`;
    case 'fetchWaifuIm': return `waifuim:tag=${args[0]}:nsfw=${args[1] !== false}`;
    default: throw new Error(`Unknown archived provider function: ${name}`);
  }
}

function normalizeModernSource(source) {
  switch (source.provider) {
    case 'abd': return `abd:endpoint=${source.endpoint}`;
    case 'obutts': return 'obutts';
    case 'oboobs': return 'oboobs';
    case 'pornpics': return `pornpics:endpoint=${source.endpoint}`;
    case 'nekobot': return `nekobot:type=${source.type}`;
    case 'nekosv4': return `nekosv4:endpoint=${source.endpoint}`;
    case 'porngifs': return 'porngifs';
    case 'porngifstv': return 'porngifstv';
    case 'purrbot': return `purrbot:endpoint=${source.endpoint}`;
    case 'sexcom': return 'sexcom';
    case 'waifupics': return `waifupics:endpoint=${source.endpoint}`;
    case 'waifuim': return `waifuim:tag=${source.tag}:nsfw=${source.isNsfw !== false}`;
    default: throw new Error(`Unknown modern provider: ${source.provider}`);
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

async function executeLegacyAcrossRandomRange(command, options, [minimum, maximum] = [0, 1]) {
  const calls = [];
  const originalRandom = Math.random;
  try {
    for (let index = 0; index < 96; index += 1) {
      const fraction = (index + 0.01) / 96;
      Math.random = () => minimum + fraction * (maximum - minimum);
      providerCalls = [];
      try {
        await command.execute(fakeInteraction(options), false);
      } catch (error) {
        if (providerCalls.length === 0) throw error;
      }
      calls.push(...providerCalls);
    }
  } finally {
    Math.random = originalRandom;
  }
  return sortedUnique(calls.map(normalizeLegacyCall));
}

test('every reachable archived media provider call exists in the matching modern command', async () => {
  const previousWaifuPics = process.env.WAIFU_PICS;
  process.env.WAIFU_PICS = 'true';
  try {
    const mediaCommands = [...modernCommands.values()].filter((command) => command.kind === 'media');
    assert.equal(mediaCommands.length, 37);
    const archivedMediaCommands = mediaCommands.filter((command) => legacyModules.has(command.data.name));
    assert.equal(archivedMediaCommands.length, 36);

    for (const modern of archivedMediaCommands) {
      const legacy = legacyModules.get(modern.data.name);
      assert.ok(legacy, `missing archived command ${modern.data.name}`);
      const archivedUnion = [];
      const modernGroups = modern.media.groups ?? { all: modern.media.sources ?? [] };

      for (const scenario of scenarioGroups(modern.data.name)) {
        const archived = await executeLegacyAcrossRandomRange(
          legacy,
          scenario.options,
          scenario.randomRange,
        );
        const current = sortedUnique((modernGroups[scenario.group] ?? []).map(normalizeModernSource));
        assert.deepEqual(archived, current, `${modern.data.name}:${scenario.group}`);
        archivedUnion.push(...archived);
      }

      const intentionalExtensions = modern.data.name === 'buttplug'
        ? ['pornpics:endpoint=https://www.pornpics.com/butt-plug/']
        : [];
      const currentUnion = sortedUnique(Object.values(modernGroups).flat().map(normalizeModernSource));
      assert.deepEqual(
        sortedUnique([...archivedUnion, ...intentionalExtensions]),
        currentUnion,
        `${modern.data.name}:all providers`,
      );
    }
  } finally {
    if (previousWaifuPics === undefined) delete process.env.WAIFU_PICS;
    else process.env.WAIFU_PICS = previousWaifuPics;
  }
});

test('the Sex.com niche list is copied exactly from the archived gif command', () => {
  const source = fs.readFileSync(path.join(legacyDirectory, 'gif.js'), 'utf8');
  const nicheBlock = source.match(/const NICHES = \[([\s\S]*?)\];/)?.[1];
  assert.ok(nicheBlock, 'archived NICHES array was not found');
  const archivedNiches = [...nicheBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(SexComNiches, archivedNiches);
});
