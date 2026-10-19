import { BOT_GATEWAY_INTENTS } from './discord/constants.js';

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const REGISTRATION_MODES = new Set(['global', 'guild', 'both']);
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function integerValue(value, fallback, { minimum, maximum }) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function requiredCredential(env, preferredName, legacyName, allowMissing) {
  const preferred = env[preferredName]?.trim();
  const legacy = env[legacyName]?.trim();
  const value = preferred || legacy;
  if (!value && !allowMissing) {
    throw new Error(
      `Missing required environment variable: ${preferredName} (legacy alias: ${legacyName})`,
    );
  }
  return {
    name: preferred ? preferredName : legacyName,
    value: value ?? '',
  };
}

function optionalSnowflake(value, name) {
  const normalized = value?.trim() ?? '';
  if (normalized && !SNOWFLAKE_PATTERN.test(normalized)) {
    throw new Error(`${name} must be a Discord snowflake.`);
  }
  return normalized || null;
}

function snowflakeList(value, name) {
  const values = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of values) {
    if (!SNOWFLAKE_PATTERN.test(entry)) throw new Error(`${name} must contain only Discord snowflakes.`);
  }
  return Object.freeze([...new Set(values)]);
}

export function loadConfig(env = process.env, { allowMissing = false } = {}) {
  const botCredential = requiredCredential(
    env,
    'DISCORD_BOT_TOKEN',
    'BOT_TOKEN',
    allowMissing,
  );
  const clientCredential = requiredCredential(
    env,
    'DISCORD_CLIENT_ID',
    'CLIENT_ID',
    allowMissing,
  );
  const botToken = botCredential.value;
  const clientId = clientCredential.value;

  if (clientId && !SNOWFLAKE_PATTERN.test(clientId)) {
    throw new Error(
      `${clientCredential.name} must be a 17-20 digit Discord application ID. `
      + 'Do not use a Google OAuth client ID or a placeholder value.',
    );
  }

  const registrationMode = env.COMMAND_REGISTRATION_MODE?.trim().toLowerCase() || 'global';
  if (!REGISTRATION_MODES.has(registrationMode)) {
    throw new Error('COMMAND_REGISTRATION_MODE must be global, guild, or both.');
  }

  const testingGuildId = optionalSnowflake(env.TESTING_GUILD_ID, 'TESTING_GUILD_ID');
  if ((registrationMode === 'guild' || registrationMode === 'both') && !testingGuildId) {
    throw new Error(`${registrationMode} command registration requires TESTING_GUILD_ID.`);
  }

  const logLevel = env.LOG_LEVEL?.trim().toLowerCase() || 'info';
  if (!LOG_LEVELS.has(logLevel)) throw new Error('LOG_LEVEL must be debug, info, warn, or error.');

  return Object.freeze({
    botToken,
    clientId,
    testingGuildId,
    registrationMode,
    gatewayIntents: BOT_GATEWAY_INTENTS,
    mediaTimeoutMs: integerValue(env.MEDIA_TIMEOUT_MS, 15_000, { minimum: 1_000, maximum: 60_000 }),
    maxMediaBytes: integerValue(env.MAX_MEDIA_BYTES, 10 * 1024 * 1024, { minimum: 64 * 1024, maximum: 25 * 1024 * 1024 }),
    waifuImKey: env.WAIFU_IM_KEY?.trim() || null,
    nekoBotAuthorization: env.NEKOBOT_AUTHORIZATION?.trim() || null,
    waifuPicsEnabled: booleanValue(env.WAIFU_PICS, false),
    premiumUserIds: snowflakeList(env.PREMIUM_USER_IDS, 'PREMIUM_USER_IDS'),
    rateLimitStateFile: env.RATE_LIMIT_STATE_FILE?.trim() || '.runtime/rate-limits.json',
    instanceLockFile: env.INSTANCE_LOCK_FILE?.trim() || '.runtime/bot-instance.lock',
    instanceLockStaleMs: integerValue(env.INSTANCE_LOCK_STALE_MS, 30_000, { minimum: 10_000, maximum: 300_000 }),
    shutdownDrainMs: integerValue(env.SHUTDOWN_DRAIN_MS, 5_000, { minimum: 500, maximum: 30_000 }),
    shutdownSettleMs: integerValue(env.SHUTDOWN_SETTLE_MS, 2_000, { minimum: 250, maximum: 10_000 }),
    shutdownHardTimeoutMs: integerValue(env.SHUTDOWN_HARD_TIMEOUT_MS, 12_000, { minimum: 2_000, maximum: 60_000 }),
    logLevel,
  });
}
