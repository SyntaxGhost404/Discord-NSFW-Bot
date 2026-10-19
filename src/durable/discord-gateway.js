import { DurableObject } from 'cloudflare:workers';
import { configFor } from '../config.js';
import { DEFAULT_GATEWAY_URL, GatewayOpcode } from '../discord/constants.js';
import { DiscordRest } from '../discord/rest.js';
import { isExactBotMention, replyToMessage, welcomePayload } from '../gateway/mention.js';
import {
  closeDisposition,
  gatewayFetchUrl,
  heartbeatPayload,
  identifyBlockedUntil,
  identifyPayload,
  recentIdentifies,
  reconnectDelay,
  resumePayload,
  serializePayload,
} from '../gateway/protocol.js';
import { createLogger } from '../lib/logger.js';
import { randomFraction } from '../lib/random.js';

// The alarm is a health check and safety net; it also counts as an incoming
// event, which keeps the object well inside the ~70 s idle eviction window.
const ALARM_INTERVAL_MS = 30_000;
const HEARTBEAT_GRACE_MS = 10_000;
const HELLO_TIMEOUT_MS = 30_000;
const RESUMABLE_CLOSE_CODE = 4000;
const REPLIED_CACHE_SIZE = 200;
const SOCKET_OPEN = 1;

export const GatewayState = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  IDENTIFYING: 'identifying',
  RESUMING: 'resuming',
  READY: 'ready',
  BACKOFF: 'backoff',
  THROTTLED: 'throttled',
  FAILED: 'failed',
  STOPPED: 'stopped',
});

const tokenFingerprints = new Map();

async function tokenFingerprint(token) {
  let fingerprint = tokenFingerprints.get(token);
  if (!fingerprint) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    fingerprint = [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    tokenFingerprints.set(token, fingerprint);
  }
  return fingerprint;
}

// One object per Gateway shard. Interactions arrive over HTTP, so this
// connection exists only for what HTTP cannot deliver: the bot's online
// presence and MESSAGE_CREATE events for the exact-mention welcome reply.
export class DiscordGateway extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.socket = null;
    this.state = GatewayState.IDLE;
    this.shard = null;
    this.session = null;
    this.sequence = null;
    this.persistedSequence = null;
    this.identifies = [];
    this.fatal = null;
    this.gatewayUrl = DEFAULT_GATEWAY_URL;
    this.pendingResume = false;
    this.openedAt = null;
    this.heartbeatIntervalMs = null;
    this.heartbeatTimer = null;
    this.awaitingAck = false;
    this.lastHeartbeatSentAt = null;
    this.lastHeartbeatAckAt = null;
    this.ping = null;
    this.user = null;
    this.guildCount = null;
    this.readyAt = null;
    this.reconnectAttempts = 0;
    this.nextConnectAt = 0;
    this.reconnectTimer = null;
    this.connectPromise = null;
    this.replied = new Set();
    this.stopReason = null;
    this.cachedLogger = null;
    this.cachedRest = null;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(['shard', 'session', 'identifies', 'fatal']);
      this.shard = stored.get('shard') ?? null;
      const session = stored.get('session') ?? null;
      if (session?.sessionId) {
        this.session = {
          sessionId: session.sessionId,
          resumeGatewayUrl: session.resumeGatewayUrl,
          intents: session.intents,
        };
        this.sequence = Number.isFinite(session.sequence) ? session.sequence : null;
        this.persistedSequence = this.sequence;
      }
      this.identifies = recentIdentifies(stored.get('identifies'), Date.now());
      this.fatal = stored.get('fatal') ?? null;
    });
  }

  get config() {
    return configFor(this.env);
  }

  get logger() {
    if (!this.cachedLogger) {
      const shard = this.shard ? `${this.shard.id}/${this.shard.count}` : 'unassigned';
      let level = 'info';
      try {
        level = this.config.logLevel;
      } catch {
        // An invalid configuration is reported by the call that read it.
      }
      this.cachedLogger = createLogger(level, { subsystem: 'discord-gateway', shard });
    }
    return this.cachedLogger;
  }

  get rest() {
    if (!this.cachedRest || this.cachedRest.token !== this.config.botToken) {
      this.cachedRest = new DiscordRest({ token: this.config.botToken, logger: this.logger });
    }
    return this.cachedRest;
  }

  // Called by the Worker's cron trigger every minute for each configured shard.
  async ensureRunning({ shardId, shardCount }) {
    if (!Number.isInteger(shardId) || !Number.isInteger(shardCount) || shardId < 0 || shardId >= shardCount) {
      throw new RangeError('A valid Gateway shard assignment is required.');
    }
    if (this.shard?.id !== shardId || this.shard?.count !== shardCount) {
      this.shard = { id: shardId, count: shardCount };
      this.cachedLogger = null;
      await this.ctx.storage.put('shard', this.shard);
    }
    await this.#tick();
    return this.status();
  }

  async alarm() {
    try {
      await this.#tick();
    } catch (error) {
      this.logger.error('Gateway health check failed.', { error });
    }
  }

  status() {
    return {
      state: this.state,
      connected: this.state === GatewayState.READY,
      ping: this.ping,
      guilds: this.guildCount,
      shardId: this.shard?.id ?? null,
      shardCount: this.shard?.count ?? null,
      readyAt: this.readyAt,
      lastHeartbeatAckAt: this.lastHeartbeatAckAt,
      nextConnectAt: this.nextConnectAt || null,
      user: this.user ? { id: this.user.id, username: this.user.username } : null,
      fatal: this.fatal ? { code: this.fatal.code, reason: this.fatal.reason, at: this.fatal.at } : null,
    };
  }

  async #runBlocker() {
    const config = this.config;
    if (config.gateway.mode === 'off') return 'GATEWAY_MODE is off';
    if (!config.botToken) return 'DISCORD_BOT_TOKEN is not configured';
    if (!this.shard) return 'no shard assignment';
    if (this.shard.count !== config.gateway.shardCount || this.shard.id >= config.gateway.shardCount) {
      return 'shard is no longer part of GATEWAY_SHARD_COUNT';
    }
    if (this.fatal) {
      const sameConfiguration = this.fatal.tokenFingerprint === await tokenFingerprint(config.botToken)
        && this.fatal.intents === config.gateway.intents
        && this.fatal.shardCount === config.gateway.shardCount;
      if (sameConfiguration) return `Discord closed the session with fatal code ${this.fatal.code}`;
      this.fatal = null;
      await this.ctx.storage.delete('fatal');
    }
    return null;
  }

  async #tick() {
    const blocker = await this.#runBlocker();
    if (blocker) {
      await this.#shutdown(blocker);
      return;
    }
    const config = this.config;
    if (this.session && this.session.intents !== config.gateway.intents) {
      this.logger.event('Gateway intents changed; starting a new session.', { intents: config.gateway.intents });
      this.#reconnect({ resume: false, delayMs: 0 });
    } else if (this.socket) {
      this.#checkLiveness();
      await this.#persistSequence();
    } else if (!this.reconnectTimer && Date.now() >= this.nextConnectAt) {
      await this.#connect();
    }
    await this.#scheduleAlarm();
  }

  async #scheduleAlarm() {
    const next = Date.now() + ALARM_INTERVAL_MS;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next) await this.ctx.storage.setAlarm(next);
  }

  #connect() {
    this.connectPromise ??= this.#open().catch((error) => {
      this.#backoff('Gateway connection attempt failed.', error);
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async #open() {
    if (this.socket) return;
    const config = this.config;
    const resume = Boolean(this.session?.sessionId && this.session.resumeGatewayUrl && this.sequence !== null);
    if (!resume) {
      const localBlock = identifyBlockedUntil(this.identifies, Date.now());
      if (localBlock) {
        this.#throttle(localBlock, 'The local IDENTIFY budget for this shard is exhausted.');
        return;
      }
      let gateway;
      try {
        gateway = await this.rest.get('/gateway/bot', { timeoutMs: 10_000 });
      } catch (error) {
        if (error?.status === 401) {
          await this.#fail(4004, 'Discord rejected the bot token (HTTP 401).');
          return;
        }
        throw error;
      }
      const remoteBlock = identifyBlockedUntil(this.identifies, Date.now(), gateway?.session_start_limit);
      if (remoteBlock) {
        this.#throttle(remoteBlock, 'Discord reports too few remaining session starts.');
        return;
      }
      if (typeof gateway?.url === 'string' && gateway.url.startsWith('wss://')) this.gatewayUrl = gateway.url;
    }

    this.state = GatewayState.CONNECTING;
    const response = await fetch(gatewayFetchUrl(resume ? this.session.resumeGatewayUrl : this.gatewayUrl), {
      headers: { Upgrade: 'websocket' },
    });
    const socket = response.webSocket;
    if (!socket) throw new Error(`Discord Gateway did not upgrade the connection (HTTP ${response.status}).`);
    socket.accept();
    this.socket = socket;
    this.stopReason = null;
    this.pendingResume = resume;
    this.openedAt = Date.now();
    this.heartbeatIntervalMs = null;
    this.lastHeartbeatSentAt = null;
    socket.addEventListener('message', (event) => {
      this.#onMessage(socket, event).catch((error) => this.logger.error('Gateway message handling failed.', { error }));
    });
    socket.addEventListener('close', (event) => {
      this.#onClose(socket, event.code, event.reason).catch((error) => this.logger.error('Gateway close handling failed.', { error }));
    });
    socket.addEventListener('error', (event) => {
      if (socket === this.socket) this.logger.warn('Discord Gateway socket error.', { message: String(event?.message ?? event?.error ?? 'unknown') });
    });
    this.logger.event('Opened Discord Gateway connection.', { resume, intents: config.gateway.intents });
  }

  async #onMessage(socket, event) {
    if (socket !== this.socket) return;
    if (typeof event.data !== 'string') {
      this.logger.error('Unexpected binary Gateway payload; reconnecting without compression.');
      this.#reconnect({ resume: true });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      this.logger.error('Failed to parse a Gateway payload.', { error });
      this.#reconnect({ resume: true });
      return;
    }
    if (payload.s !== null && payload.s !== undefined) this.sequence = payload.s;

    switch (payload.op) {
      case GatewayOpcode.HELLO:
        await this.#onHello(payload.d?.heartbeat_interval);
        break;
      case GatewayOpcode.HEARTBEAT:
        this.#sendHeartbeat({ requested: true });
        break;
      case GatewayOpcode.HEARTBEAT_ACK:
        this.awaitingAck = false;
        this.lastHeartbeatAckAt = Date.now();
        if (this.lastHeartbeatSentAt !== null) this.ping = this.lastHeartbeatAckAt - this.lastHeartbeatSentAt;
        break;
      case GatewayOpcode.RECONNECT:
        this.logger.event('Discord requested a Gateway reconnect.');
        this.#reconnect({ resume: true, delayMs: 0 });
        break;
      case GatewayOpcode.INVALID_SESSION:
        this.logger.warn('Discord Gateway session became invalid.', { resumable: Boolean(payload.d) });
        this.#reconnect({ resume: Boolean(payload.d), delayMs: 1_000 + Math.floor(randomFraction() * 4_000) });
        break;
      case GatewayOpcode.DISPATCH:
        await this.#onDispatch(payload.t, payload.d);
        break;
      default:
        break;
    }
  }

  async #onHello(interval) {
    if (!Number.isFinite(interval) || interval <= 0) {
      this.logger.error('Discord Gateway HELLO omitted a valid heartbeat interval.');
      this.#reconnect({ resume: true });
      return;
    }
    this.heartbeatIntervalMs = interval;
    this.#startHeartbeat();
    const config = this.config;
    if (this.pendingResume && this.session) {
      this.state = GatewayState.RESUMING;
      this.#send(resumePayload({ token: config.botToken, sessionId: this.session.sessionId, sequence: this.sequence }));
      return;
    }
    // The identify is recorded before it is sent so a crash mid-handshake
    // still counts against the local budget.
    this.identifies = recentIdentifies([...this.identifies, Date.now()], Date.now());
    await this.ctx.storage.put('identifies', this.identifies);
    this.state = GatewayState.IDENTIFYING;
    this.#send(identifyPayload({
      token: config.botToken,
      intents: config.gateway.intents,
      shardId: this.shard.id,
      shardCount: this.shard.count,
      activity: config.gateway.activity,
    }));
  }

  async #onDispatch(eventName, data) {
    if (eventName === 'READY') {
      this.session = {
        sessionId: data.session_id,
        resumeGatewayUrl: data.resume_gateway_url,
        intents: this.config.gateway.intents,
      };
      this.user = data.user ?? null;
      this.guildCount = Array.isArray(data.guilds) ? data.guilds.length : null;
      this.state = GatewayState.READY;
      this.readyAt = Date.now();
      this.reconnectAttempts = 0;
      this.nextConnectAt = 0;
      await this.#persistSequence(true);
      this.logger.success('Discord Gateway session is ready.', {
        user: `${data.user?.username ?? 'unknown'} (${data.user?.id ?? 'unknown'})`,
        guilds: this.guildCount,
        mode: this.config.gateway.mode,
      });
    } else if (eventName === 'RESUMED') {
      this.state = GatewayState.READY;
      this.reconnectAttempts = 0;
      this.nextConnectAt = 0;
      this.logger.success('Discord Gateway session resumed.');
    } else if (eventName === 'MESSAGE_CREATE' && this.config.gateway.mode === 'full') {
      await this.#onMessageCreate(data);
    }
  }

  async #onMessageCreate(message) {
    if (!isExactBotMention(message, this.user?.id) || this.replied.has(message.id)) return;
    this.replied.add(message.id);
    if (this.replied.size > REPLIED_CACHE_SIZE) this.replied.delete(this.replied.values().next().value);
    try {
      await replyToMessage(this.rest, message, welcomePayload(this.user));
      this.logger.event('Replied to a direct bot mention.', { channelId: message.channel_id, guildId: message.guild_id ?? 'DM' });
    } catch (error) {
      this.logger.warn('Could not reply to a bot mention.', { channelId: message.channel_id, code: error?.code, error });
    }
    // A resumed session replays events after the stored sequence, so storing
    // it here keeps this mention from being answered twice.
    await this.#persistSequence(true);
  }

  async #onClose(socket, code, reason) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.#stopHeartbeat();
    if (this.state === GatewayState.STOPPED) return;
    const disposition = closeDisposition(code);
    this.logger.warn('Discord Gateway connection closed.', { code, reason, disposition });
    if (disposition === 'fatal') {
      await this.#fail(code, reason || 'Discord closed the session with a non-recoverable code.');
      return;
    }
    if (disposition === 'identify') this.#clearSession();
    this.#scheduleReconnect();
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    const schedule = (delay) => {
      this.heartbeatTimer = setTimeout(() => {
        this.#sendHeartbeat();
        if (this.socket) schedule(this.heartbeatIntervalMs);
      }, delay);
    };
    schedule(Math.floor(this.heartbeatIntervalMs * randomFraction()));
  }

  #stopHeartbeat() {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.awaitingAck = false;
  }

  #sendHeartbeat({ requested = false } = {}) {
    if (!this.socket) return;
    if (this.awaitingAck && !requested) {
      this.logger.warn('Gateway heartbeat ACK was not received; reconnecting.');
      this.#reconnect({ resume: true, delayMs: 0 });
      return;
    }
    this.lastHeartbeatSentAt = Date.now();
    this.awaitingAck = true;
    this.#send(heartbeatPayload(this.sequence));
  }

  // Alarm-driven backstop for a connection whose heartbeat timer or HELLO
  // never arrived, for example after the runtime suspended timers.
  #checkLiveness() {
    const now = Date.now();
    if (this.heartbeatIntervalMs === null) {
      if (this.openedAt !== null && now - this.openedAt > HELLO_TIMEOUT_MS) {
        this.logger.warn('Discord Gateway HELLO did not arrive; reconnecting.');
        this.#reconnect({ resume: true, delayMs: 0 });
      }
      return;
    }
    const lastBeat = this.lastHeartbeatSentAt ?? this.openedAt;
    if (now - lastBeat > this.heartbeatIntervalMs + HEARTBEAT_GRACE_MS) {
      if (this.awaitingAck) {
        this.logger.warn('Gateway heartbeat is overdue; reconnecting.');
        this.#reconnect({ resume: true, delayMs: 0 });
      } else {
        this.#sendHeartbeat();
      }
    }
  }

  #send(payload) {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    this.socket.send(serializePayload(payload));
    return true;
  }

  #reconnect({ resume, delayMs }) {
    const socket = this.socket;
    this.socket = null;
    this.#stopHeartbeat();
    if (socket) {
      try {
        // Closing with 1000/1001 invalidates the session, so a resumable
        // reconnect uses a 4000-range code instead.
        socket.close(resume ? RESUMABLE_CLOSE_CODE : 1000, resume ? 'Reconnecting to resume' : 'Starting a new session');
      } catch {
        // The socket may already be closing.
      }
    }
    if (!resume) this.#clearSession();
    this.#scheduleReconnect(delayMs);
  }

  #scheduleReconnect(delayMs = reconnectDelay(this.reconnectAttempts, randomFraction)) {
    this.reconnectAttempts += 1;
    this.state = GatewayState.BACKOFF;
    this.nextConnectAt = Date.now() + delayMs;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#connect();
    }, delayMs);
  }

  #backoff(message, error) {
    this.logger.warn(message, { attempt: this.reconnectAttempts + 1, error });
    this.socket = null;
    this.#stopHeartbeat();
    this.#scheduleReconnect();
  }

  #throttle(until, reason) {
    if (this.state !== GatewayState.THROTTLED) {
      this.logger.error('Refusing to IDENTIFY to protect the bot token.', {
        reason,
        retryAt: new Date(until).toISOString(),
        recentIdentifies: this.identifies.length,
      });
    }
    this.state = GatewayState.THROTTLED;
    this.nextConnectAt = until;
  }

  async #fail(code, reason) {
    this.state = GatewayState.FAILED;
    this.#clearSession();
    const config = this.config;
    this.fatal = {
      code,
      reason,
      at: Date.now(),
      tokenFingerprint: await tokenFingerprint(config.botToken),
      intents: config.gateway.intents,
      shardCount: config.gateway.shardCount,
    };
    await this.ctx.storage.put('fatal', this.fatal);
    const hints = {
      4004: 'Update DISCORD_BOT_TOKEN.',
      4011: 'Increase GATEWAY_SHARD_COUNT.',
      4013: 'Check GATEWAY_MODE.',
      4014: 'Use GATEWAY_MODE=presence or enable the required intents.',
    };
    this.logger.error('Discord Gateway stopped after a non-recoverable close.', { code, reason, action: hints[code] ?? 'Check the bot configuration.' });
  }

  #clearSession() {
    this.session = null;
    this.sequence = null;
    this.persistedSequence = null;
    this.ctx.storage.delete('session').catch((error) => this.logger.warn('Could not clear the stored Gateway session.', { error }));
  }

  async #persistSequence(force = false) {
    if (!this.session) return;
    if (!force && this.sequence === this.persistedSequence) return;
    await this.ctx.storage.put('session', { ...this.session, sequence: this.sequence });
    this.persistedSequence = this.sequence;
  }

  async #shutdown(reason) {
    const idle = this.state === GatewayState.STOPPED || this.state === GatewayState.FAILED;
    if (idle && !this.socket && this.stopReason === reason) return;
    this.stopReason = reason;
    const stale = reason.startsWith('shard is no longer');
    const socket = this.socket;
    this.socket = null;
    this.#stopHeartbeat();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (socket) {
      try {
        socket.close(1000, 'Gateway disabled');
      } catch {
        // The socket may already be closing.
      }
    }
    if (this.state !== GatewayState.FAILED) this.state = GatewayState.STOPPED;
    await this.ctx.storage.deleteAlarm();
    if (stale) {
      await this.ctx.storage.deleteAll();
      this.shard = null;
      this.session = null;
    }
    this.logger.event('Gateway session is not running.', { reason });
  }
}
