export const API_VERSION = 10;
export const API_BASE_URL = `https://discord.com/api/v${API_VERSION}`;
export const DEFAULT_GATEWAY_URL = `wss://gateway.discord.gg/?v=${API_VERSION}&encoding=json`;

export const GatewayOpcode = Object.freeze({
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
});

export const GatewayIntent = Object.freeze({
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
});

export const BOT_GATEWAY_INTENTS =
  GatewayIntent.GUILDS |
  GatewayIntent.GUILD_MESSAGES |
  GatewayIntent.DIRECT_MESSAGES;

export const InteractionType = Object.freeze({
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
});

export const InteractionResponseType = Object.freeze({
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
});

export const ApplicationCommandOptionType = Object.freeze({
  SUB_COMMAND: 1,
  SUB_COMMAND_GROUP: 2,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
  MENTIONABLE: 9,
  NUMBER: 10,
  ATTACHMENT: 11,
});

export const ApplicationIntegrationType = Object.freeze({
  GUILD_INSTALL: 0,
  USER_INSTALL: 1,
});

export const InteractionContextType = Object.freeze({
  GUILD: 0,
  BOT_DM: 1,
  PRIVATE_CHANNEL: 2,
});

export const ComponentType = Object.freeze({
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
});

export const ButtonStyle = Object.freeze({
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
});

export const TextInputStyle = Object.freeze({
  SHORT: 1,
  PARAGRAPH: 2,
});

export const MessageFlag = Object.freeze({
  EPHEMERAL: 1 << 6,
  SUPPRESS_NOTIFICATIONS: 1 << 12,
  IS_COMPONENTS_V2: 1 << 15,
});

export const ChannelType = Object.freeze({
  DM: 1,
  GROUP_DM: 3,
  GUILD_PUBLIC_THREAD: 11,
  GUILD_PRIVATE_THREAD: 12,
  GUILD_ANNOUNCEMENT_THREAD: 10,
});

export const PermissionFlag = Object.freeze({
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
});

export const BOT_INVITE_PERMISSIONS = Object.values(PermissionFlag)
  .reduce((permissions, flag) => permissions | flag, 0n)
  .toString();

export const DISCORD_EPOCH = 1420070400000n;
