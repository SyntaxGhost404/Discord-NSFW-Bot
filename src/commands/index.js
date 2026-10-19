import fourKCommand from './4k.js';
import analCommand from './anal.js';
import assCommand from './ass.js';
import blowjobCommand from './blowjob.js';
import boobsCommand from './boobs.js';
import breedingCommand from './breeding.js';
import buttplugCommand from './buttplug.js';
import cagesCommand from './cages.js';
import cosplayCommand from './cosplay.js';
import cumCommand from './cum.js';
import ecchiCommand from './ecchi.js';
import eroCommand from './ero.js';
import feetCommand from './feet.js';
import fuckCommand from './fuck.js';
import gifCommand from './gif.js';
import gonewildCommand from './gonewild.js';
import helpCommand from './help.js';
import hentaiCommand from './hentai.js';
import introCommand from './intro.js';
import inviteCommand from './invite.js';
import kitsuneCommand from './kitsune.js';
import legsCommand from './legs.js';
import maidCommand from './maid.js';
import midriffCommand from './midriff.js';
import milfCommand from './milf.js';
import nekoCommand from './neko.js';
import paizuriCommand from './paizuri.js';
import petgirlsCommand from './petgirls.js';
import pingCommand from './ping.js';
import premiumCommand from './premium.js';
import pussyCommand from './pussy.js';
import pussylickCommand from './pussylick.js';
import selfieCommand from './selfie.js';
import smotheringCommand from './smothering.js';
import socksCommand from './socks.js';
import soloCommand from './solo.js';
import tentacleCommand from './tentacle.js';
import thighCommand from './thigh.js';
import threesomeCommand from './threesome.js';
import uniformCommand from './uniform.js';
import waifuCommand from './waifu.js';
import yuriCommand from './yuri.js';

// Workers bundles have no filesystem, so every command module is imported
// explicitly. The order matches the previous file-name sort and drives the
// /help directory pagination.
const COMMAND_MODULES = Object.freeze([
  fourKCommand,
  analCommand,
  assCommand,
  blowjobCommand,
  boobsCommand,
  breedingCommand,
  buttplugCommand,
  cagesCommand,
  cosplayCommand,
  cumCommand,
  ecchiCommand,
  eroCommand,
  feetCommand,
  fuckCommand,
  gifCommand,
  gonewildCommand,
  helpCommand,
  hentaiCommand,
  introCommand,
  inviteCommand,
  kitsuneCommand,
  legsCommand,
  maidCommand,
  midriffCommand,
  milfCommand,
  nekoCommand,
  paizuriCommand,
  petgirlsCommand,
  pingCommand,
  premiumCommand,
  pussyCommand,
  pussylickCommand,
  selfieCommand,
  smotheringCommand,
  socksCommand,
  soloCommand,
  tentacleCommand,
  thighCommand,
  threesomeCommand,
  uniformCommand,
  waifuCommand,
  yuriCommand,
]);

const COMMAND_NAME = /^[\w-]{1,32}$/;

function validateCommand(command, index) {
  if (!command || typeof command !== 'object') throw new Error(`Command module #${index} does not export a command object.`);
  if (!command.data?.name || !command.data?.description) throw new Error(`Command module #${index} is missing command data.`);
  if (typeof command.execute !== 'function') throw new Error(`/${command.data.name} is missing execute().`);
  if (!COMMAND_NAME.test(command.data.name)) throw new Error(`/${command.data.name} has an invalid command name.`);
  if (command.data.description.length > 100) throw new Error(`/${command.data.name} has a description longer than 100 characters.`);
}

export function buildCommandRegistry(modules = COMMAND_MODULES) {
  const commands = new Map();
  modules.forEach((command, index) => {
    validateCommand(command, index);
    if (commands.has(command.data.name)) throw new Error(`Duplicate command name: ${command.data.name}`);
    commands.set(command.data.name, command);
  });
  return commands;
}

export const commands = buildCommandRegistry();
