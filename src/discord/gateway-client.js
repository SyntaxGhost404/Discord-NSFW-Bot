import { EventEmitter } from 'node:events';
import process from 'node:process';
import WebSocket from 'ws';
import { DEFAULT_GATEWAY_URL, GatewayOpcode } from './constants.js';

const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const RESET_SESSION_CLOSE_CODES = new Set([1000, 1001, 4007, 4009]);

export function gatewayUrl(baseUrl) {
  const url = new URL(baseUrl || DEFAULT_GATEWAY_URL);
  url.searchParams.set('v', '10');
  url.searchParams.set('encoding', 'json');
  url.searchParams.delete('compress');
  return url.toString();
}

export function closeDisposition(code) {
  if (FATAL_CLOSE_CODES.has(code)) return 'fatal';
  if (RESET_SESSION_CLOSE_CODES.has(code)) return 'identify';
  return 'resume';
}

export function identifyPayload(token, intents) {
  return {
    op: GatewayOpcode.IDENTIFY,
    d: {
      token,
      intents,
      properties: {
        os: process.platform,
        browser: 'discord-nsfw-bot-raw',
        device: 'discord-nsfw-bot-raw',
      },
    },
  };
}

export function resumePayload(token, sessionId, sequence) {
  return {
    op: GatewayOpcode.RESUME,
    d: { token, session_id: sessionId, seq: sequence },
  };
}

export class DiscordGatewayClient extends EventEmitter {
  constructor({ token, intents, rest, logger, WebSocketImpl = WebSocket }) {
    super();
    this.token = token;
    this.intents = intents;
    this.rest = rest;
    this.logger = logger.child({ subsystem: 'discord-gateway' });
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.closingSocket = null;
    this.gatewayBaseUrl = DEFAULT_GATEWAY_URL;
    this.resumeGatewayUrl = null;
    this.sessionId = null;
    this.sequence = null;
    this.heartbeatTimer = null;
    this.firstHeartbeatTimer = null;
    this.reconnectTimer = null;
    this.invalidSessionTimer = null;
    this.invalidSessionWaitResolve = null;
    this.awaitingHeartbeatAck = false;
    this.lastHeartbeatAt = null;
    this.ping = null;
    this.reconnectAttempts = 0;
    this.stopped = false;
    this.user = null;
    this.guildIds = new Set();
  }

  get guildCount() {
    return this.guildIds.size;
  }

  async connect() {
    this.stopped = false;
    const gateway = await this.rest.get('/gateway/bot');
    this.gatewayBaseUrl = gateway?.url || DEFAULT_GATEWAY_URL;
    if (gateway?.session_start_limit?.remaining === 0) {
      throw new Error(`Discord Gateway session start limit exhausted; reset in ${gateway.session_start_limit.reset_after}ms.`);
    }
    this.#open(false);
  }

  stop({ force = false, timeoutMs = 1_000 } = {}) {
    this.stopped = true;
    this.#clearTimers();
    const socket = this.socket ?? this.closingSocket;
    this.socket = null;
    if (!socket) return Promise.resolve();
    this.closingSocket = socket;
    if (force) {
      socket.terminate();
      if (this.closingSocket === socket) this.closingSocket = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let timer;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener?.('close', finish);
        if (this.closingSocket === socket) this.closingSocket = null;
        resolve();
      };
      socket.once('close', finish);
      timer = setTimeout(() => {
        socket.terminate();
        finish();
      }, timeoutMs);
      if (socket.readyState === this.WebSocketImpl.CLOSED) finish();
      else socket.close(1000, 'Application shutdown');
    });
  }

  #open(shouldResume) {
    if (this.stopped) return;
    const canResume = shouldResume && this.sessionId && this.sequence !== null && this.resumeGatewayUrl;
    const url = gatewayUrl(canResume ? this.resumeGatewayUrl : this.gatewayBaseUrl);
    const socket = new this.WebSocketImpl(url);
    this.socket = socket;
    this.logger.event('Opening Discord Gateway connection.', { resume: Boolean(canResume) });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.logger.error('Unexpected binary Gateway payload; reconnecting without compression.');
        socket.terminate();
        return;
      }
      this.#handlePayload(String(data));
    });
    socket.on('error', (error) => this.logger.warn('Discord Gateway socket error.', error));
    socket.on('close', (code, reason) => this.#handleClose(socket, code, String(reason)));
    socket.once('open', () => this.emit('open'));
  }

  #handlePayload(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      this.logger.error('Failed to parse Discord Gateway JSON payload.', error);
      this.socket?.terminate();
      return;
    }

    if (payload.s !== null && payload.s !== undefined) this.sequence = payload.s;

    switch (payload.op) {
      case GatewayOpcode.DISPATCH:
        this.#handleDispatch(payload.t, payload.d);
        break;
      case GatewayOpcode.HEARTBEAT:
        this.#sendHeartbeat();
        break;
      case GatewayOpcode.RECONNECT:
        this.logger.warn('Discord requested a Gateway reconnect.');
        this.#scheduleReconnect(true, 0);
        break;
      case GatewayOpcode.INVALID_SESSION:
        this.#handleInvalidSession(Boolean(payload.d));
        break;
      case GatewayOpcode.HELLO:
        this.#handleHello(payload.d?.heartbeat_interval);
        break;
      case GatewayOpcode.HEARTBEAT_ACK:
        this.awaitingHeartbeatAck = false;
        if (this.lastHeartbeatAt !== null) this.ping = Date.now() - this.lastHeartbeatAt;
        break;
      default:
        this.logger.debug('Ignoring unsupported Gateway opcode.', { opcode: payload.op });
    }
  }

  #handleHello(heartbeatInterval) {
    if (!Number.isFinite(heartbeatInterval) || heartbeatInterval <= 0) {
      this.logger.error('Discord Gateway HELLO omitted a valid heartbeat interval.');
      this.socket?.terminate();
      return;
    }
    this.#startHeartbeatLoop(heartbeatInterval);
    if (this.sessionId && this.sequence !== null) {
      this.#send(resumePayload(this.token, this.sessionId, this.sequence));
    } else {
      this.#send(identifyPayload(this.token, this.intents));
    }
  }

  #startHeartbeatLoop(interval) {
    this.#clearHeartbeatTimers();
    const firstDelay = Math.floor(Math.random() * interval);
    this.firstHeartbeatTimer = setTimeout(() => {
      this.#sendHeartbeat();
      this.heartbeatTimer = setInterval(() => this.#sendHeartbeat(), interval);
    }, firstDelay);
  }

  #sendHeartbeat() {
    if (this.awaitingHeartbeatAck) {
      this.logger.warn('Gateway heartbeat ACK was not received; reconnecting.');
      this.#scheduleReconnect(true, 0);
      return;
    }
    this.lastHeartbeatAt = Date.now();
    this.awaitingHeartbeatAck = true;
    this.#send({ op: GatewayOpcode.HEARTBEAT, d: this.sequence });
  }

  #handleDispatch(eventName, data) {
    if (eventName === 'READY') {
      this.sessionId = data.session_id;
      this.resumeGatewayUrl = data.resume_gateway_url;
      this.user = data.user;
      this.guildIds = new Set((data.guilds ?? []).map((guild) => guild.id));
      this.reconnectAttempts = 0;
      this.logger.success('Discord Gateway session is ready.', {
        user: `${data.user?.username ?? 'unknown'} (${data.user?.id ?? 'unknown'})`,
        guilds: this.guildCount,
        sessionType: data.session_type,
      });
      this.emit('ready', data);
    } else if (eventName === 'RESUMED') {
      this.reconnectAttempts = 0;
      this.logger.success('Discord Gateway session resumed.');
      this.emit('resumed', data);
    } else if (eventName === 'GUILD_CREATE') {
      this.guildIds.add(data.id);
    } else if (eventName === 'GUILD_DELETE' && !data.unavailable) {
      this.guildIds.delete(data.id);
    }
    this.emit('dispatch', eventName, data);
    this.emit(eventName, data);
  }

  async #handleInvalidSession(canResume) {
    this.logger.warn('Discord Gateway session became invalid.', { canResume });
    if (!canResume) this.#resetSession();
    await this.#waitForInvalidSessionRetry(1_000 + Math.floor(Math.random() * 4_000));
    this.#scheduleReconnect(canResume, 0);
  }

  #handleClose(socket, code, reason) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.#clearHeartbeatTimers();
    if (this.stopped) return;

    const disposition = closeDisposition(code);
    this.logger.warn('Discord Gateway connection closed.', { code, reason, disposition });
    if (disposition === 'fatal') {
      const error = new Error(`Fatal Discord Gateway close ${code}: ${reason || 'no reason supplied'}`);
      error.code = code;
      this.emit('fatal', error);
      return;
    }
    if (disposition === 'identify') this.#resetSession();
    this.#scheduleReconnect(disposition === 'resume');
  }

  #scheduleReconnect(shouldResume, requestedDelay) {
    if (this.stopped || this.reconnectTimer) return;
    this.#clearHeartbeatTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== this.WebSocketImpl.CLOSED) socket.terminate();

    const exponential = Math.min(1_000 * (2 ** this.reconnectAttempts), 30_000);
    const delay = requestedDelay ?? Math.floor(exponential * (0.75 + Math.random() * 0.5));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#open(shouldResume);
    }, delay);
  }

  #send(payload) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) return false;
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > 4_096) {
      throw new Error('Gateway payload exceeds Discord\'s 4096-byte limit.');
    }
    this.socket.send(serialized);
    return true;
  }

  #resetSession() {
    this.sessionId = null;
    this.resumeGatewayUrl = null;
    this.sequence = null;
  }

  #clearHeartbeatTimers() {
    clearTimeout(this.firstHeartbeatTimer);
    clearInterval(this.heartbeatTimer);
    this.firstHeartbeatTimer = null;
    this.heartbeatTimer = null;
    this.awaitingHeartbeatAck = false;
  }

  #clearTimers() {
    this.#clearHeartbeatTimers();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    clearTimeout(this.invalidSessionTimer);
    this.invalidSessionTimer = null;
    const resolve = this.invalidSessionWaitResolve;
    this.invalidSessionWaitResolve = null;
    resolve?.();
  }

  #waitForInvalidSessionRetry(milliseconds) {
    clearTimeout(this.invalidSessionTimer);
    this.invalidSessionWaitResolve?.();
    return new Promise((resolve) => {
      this.invalidSessionWaitResolve = resolve;
      this.invalidSessionTimer = setTimeout(() => {
        this.invalidSessionTimer = null;
        this.invalidSessionWaitResolve = null;
        resolve();
      }, milliseconds);
    });
  }
}
