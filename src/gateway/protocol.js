import { API_VERSION, DEFAULT_GATEWAY_URL, GatewayOpcode } from '../discord/constants.js';

const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const RESET_SESSION_CLOSE_CODES = new Set([1000, 1001, 4007, 4009]);
const MAXIMUM_PAYLOAD_BYTES = 4_096;
const encoder = new TextEncoder();

// Discord resets the bot token after 1,000 IDENTIFY calls in 24 hours, so the
// object refuses to identify long before that: at most this many per shard
// per day, and never while Discord reports few session starts remaining.
export const LOCAL_IDENTIFY_LIMIT = 50;
export const IDENTIFY_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const MINIMUM_REMOTE_SESSION_STARTS = 25;

export function shardName(shardId, shardCount) {
  return `shard-${shardId}-of-${shardCount}`;
}

// Workers open client WebSockets with fetch() + `Upgrade: websocket`, which
// needs an https:// URL; the version and encoding are always pinned.
export function gatewayFetchUrl(baseUrl) {
  const url = new URL(baseUrl || DEFAULT_GATEWAY_URL);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol === 'ws:') url.protocol = 'http:';
  url.searchParams.set('v', String(API_VERSION));
  url.searchParams.set('encoding', 'json');
  url.searchParams.delete('compress');
  return url.toString();
}

export function closeDisposition(code) {
  if (FATAL_CLOSE_CODES.has(code)) return 'fatal';
  if (RESET_SESSION_CLOSE_CODES.has(code)) return 'identify';
  return 'resume';
}

export function presencePayload(activity) {
  return {
    since: null,
    activities: activity ? [{ name: 'Custom Status', type: 4, state: activity }] : [],
    status: 'online',
    afk: false,
  };
}

export function identifyPayload({ token, intents, shardId, shardCount, activity }) {
  return {
    op: GatewayOpcode.IDENTIFY,
    d: {
      token,
      intents,
      properties: {
        os: 'cloudflare-workers',
        browser: 'discord-nsfw-bot',
        device: 'discord-nsfw-bot',
      },
      shard: [shardId, shardCount],
      presence: presencePayload(activity),
    },
  };
}

export function resumePayload({ token, sessionId, sequence }) {
  return {
    op: GatewayOpcode.RESUME,
    d: { token, session_id: sessionId, seq: sequence },
  };
}

export function heartbeatPayload(sequence) {
  return { op: GatewayOpcode.HEARTBEAT, d: sequence ?? null };
}

export function serializePayload(payload) {
  const serialized = JSON.stringify(payload);
  if (encoder.encode(serialized).length > MAXIMUM_PAYLOAD_BYTES) {
    throw new Error('Gateway payload exceeds Discord\'s 4096-byte limit.');
  }
  return serialized;
}

// Exponential backoff with +/-25% jitter, capped at one minute.
export function reconnectDelay(attempt, random = Math.random) {
  const exponential = Math.min(1_000 * (2 ** Math.max(0, attempt)), 60_000);
  return Math.floor(exponential * (0.75 + random() * 0.5));
}

export function recentIdentifies(timestamps, now) {
  return (Array.isArray(timestamps) ? timestamps : [])
    .filter((value) => Number.isFinite(value) && now - value < IDENTIFY_WINDOW_MS)
    .sort((left, right) => left - right);
}

// Returns null when an IDENTIFY is allowed, or the time it next will be.
export function identifyBlockedUntil(timestamps, now, remoteLimit = null) {
  const recent = recentIdentifies(timestamps, now);
  if (recent.length >= LOCAL_IDENTIFY_LIMIT) return recent[0] + IDENTIFY_WINDOW_MS;
  if (remoteLimit && Number.isFinite(remoteLimit.remaining) && remoteLimit.remaining < MINIMUM_REMOTE_SESSION_STARTS) {
    return now + Math.max(60_000, Number(remoteLimit.reset_after) || 0);
  }
  return null;
}
