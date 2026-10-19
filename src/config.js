import { MENTION_GATEWAY_INTENTS } from './discord/constants.js';

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const REGISTRATION_MODES = new Set(['global', 'guild', 'both']);
const GATEWAY_MODES = new Set(['full', 'presence', 'off']);
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function text(env, name) {
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

// Returns the first configured name so errors can point at the variable the
// operator actually set, including the legacy Replit-era aliases.
function firstOf(env, names) {
  for (const name of names) {
    const value = text(env, name);
    if (value) return { name, value };
  }
  return { name: names[0], value: '' };
}

function booleanValue(value, fallback) {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function integerValue(value, fallback, { minimum, maximum }) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function optionalSnowflake({ name, value }) {
  if (value && !SNOWFLAKE_PATTERN.test(value)) {
    throw new ConfigurationError(
      `${name} must be a 17-20 digit Discord snowflake. Do not use a Google OAuth client ID or a placeholder.`,
    );
  }
  return value || null;
}

function snowflakeList(value, name) {
  const values = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of values) {
    if (!SNOWFLAKE_PATTERN.test(entry)) throw new ConfigurationError(`${name} must contain only Discord snowflakes.`);
  }
  return Object.freeze([...new Set(values)]);
}

export function loadConfig(env) {
  const applicationId = optionalSnowflake(firstOf(env, ['DISCORD_APPLICATION_ID', 'DISCORD_CLIENT_ID', 'CLIENT_ID']));
  const publicKey = text(env, 'DISCORD_PUBLIC_KEY');
  if (publicKey && !PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new ConfigurationError('DISCORD_PUBLIC_KEY must be the 64-character hexadecimal key from the Developer Portal.');
  }

  const registrationMode = text(env, 'COMMAND_REGISTRATION_MODE').toLowerCase() || 'global';
  if (!REGISTRATION_MODES.has(registrationMode)) {
    throw new ConfigurationError('COMMAND_REGISTRATION_MODE must be global, guild, or both.');
  }
  const testingGuildId = optionalSnowflake({ name: 'TESTING_GUILD_ID', value: text(env, 'TESTING_GUILD_ID') });
  if (registrationMode !== 'global' && !testingGuildId) {
    throw new ConfigurationError(`${registrationMode} command registration requires TESTING_GUILD_ID.`);
  }

  const gatewayMode = text(env, 'GATEWAY_MODE').toLowerCase() || 'full';
  if (!GATEWAY_MODES.has(gatewayMode)) throw new ConfigurationError('GATEWAY_MODE must be full, presence, or off.');

  const logLevel = text(env, 'LOG_LEVEL').toLowerCase() || 'info';
  if (!LOG_LEVELS.has(logLevel)) throw new ConfigurationError('LOG_LEVEL must be debug, info, warn, or error.');

  return Object.freeze({
    applicationId,
    publicKey: publicKey.toLowerCase() || null,
    botToken: firstOf(env, ['DISCORD_BOT_TOKEN', 'BOT_TOKEN']).value || null,
    registrationMode,
    testingGuildId,
    gateway: Object.freeze({
      mode: gatewayMode,
      intents: gatewayMode === 'full' ? MENTION_GATEWAY_INTENTS : 0,
      shardCount: integerValue(text(env, 'GATEWAY_SHARD_COUNT'), 1, { minimum: 1, maximum: 64 }),
      activity: text(env, 'GATEWAY_ACTIVITY').slice(0, 128) || null,
    }),
    mediaTimeoutMs: integerValue(text(env, 'MEDIA_TIMEOUT_MS'), 10_000, { minimum: 1_000, maximum: 60_000 }),
    mediaDeadlineMs: integerValue(text(env, 'MEDIA_DEADLINE_MS'), 24_000, { minimum: 5_000, maximum: 28_000 }),
    maxMediaBytes: integerValue(text(env, 'MAX_MEDIA_BYTES'), 10 * 1024 * 1024, {
      minimum: 64 * 1024,
      maximum: 25 * 1024 * 1024,
    }),
    maxSubrequests: integerValue(text(env, 'MAX_SUBREQUESTS'), 45, { minimum: 10, maximum: 9_000 }),
    nekoBotAuthorization: text(env, 'NEKOBOT_AUTHORIZATION') || null,
    waifuPicsEnabled: booleanValue(text(env, 'WAIFU_PICS'), false),
    premiumUserIds: snowflakeList(text(env, 'PREMIUM_USER_IDS'), 'PREMIUM_USER_IDS'),
    logLevel,
  });
}

const configCache = new WeakMap();

// `env` is stable for the lifetime of an isolate, so parsing once per binding
// object keeps per-request work to a lookup.
export function configFor(env) {
  if (!env || typeof env !== 'object') return loadConfig(env);
  let config = configCache.get(env);
  if (!config) {
    config = loadConfig(env);
    configCache.set(env, config);
  }
  return config;
}
