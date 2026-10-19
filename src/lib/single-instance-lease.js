import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const MAX_ACQUIRE_ATTEMPTS = 5;

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

function validOwner(value) {
  return value && typeof value === 'object'
    && typeof value.instanceId === 'string'
    && Number.isInteger(value.pid)
    && value.pid > 0
    && typeof value.hostname === 'string';
}

async function readLease(file) {
  try {
    const [raw, stats] = await Promise.all([
      fs.readFile(file, 'utf8'),
      fs.stat(file),
    ]);
    let owner = null;
    try {
      owner = JSON.parse(raw);
    } catch {
      // A fresh malformed file may be another process between create and write.
    }
    return { owner, stats };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export class ActiveInstanceError extends Error {
  constructor(file, owner = null) {
    const location = owner?.hostname && owner?.pid
      ? `${owner.hostname} (PID ${owner.pid})`
      : 'an unknown process';
    super(`Another bot instance already owns ${file}: ${location}.`);
    this.name = 'ActiveInstanceError';
    this.code = 'BOT_INSTANCE_ALREADY_RUNNING';
    this.file = file;
    this.owner = owner;
  }
}

export class SingleInstanceLease {
  constructor({
    file,
    logger = null,
    onLost = null,
    now = Date.now,
    hostname = os.hostname(),
    pid = process.pid,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    isProcessAlive = processIsAlive,
  }) {
    if (!file) throw new Error('A single-instance lease file is required.');
    this.file = path.resolve(file);
    this.logger = logger?.child?.({ subsystem: 'instance-lease' }) ?? logger;
    this.onLost = onLost;
    this.now = now;
    this.hostname = hostname;
    this.pid = pid;
    this.heartbeatMs = heartbeatMs;
    this.staleAfterMs = staleAfterMs;
    this.isProcessAlive = isProcessAlive;
    this.instanceId = randomUUID();
    this.owner = Object.freeze({
      instanceId: this.instanceId,
      pid: this.pid,
      hostname: this.hostname,
      startedAt: new Date(this.now()).toISOString(),
    });
    this.acquired = false;
    this.released = false;
    this.lost = false;
    this.heartbeatTimer = null;
    this.heartbeatPromise = null;
  }

  static async acquire(options) {
    const lease = new SingleInstanceLease(options);
    await lease.acquire();
    return lease;
  }

  async acquire() {
    if (this.acquired) return this;
    await fs.mkdir(path.dirname(this.file), { recursive: true });

    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
      try {
        const handle = await fs.open(this.file, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(this.owner)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        this.acquired = true;
        this.#startHeartbeat();
        return this;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }

      const existing = await readLease(this.file);
      if (!existing) continue;
      if (this.#isActive(existing)) throw new ActiveInstanceError(this.file, existing.owner);

      try {
        await fs.unlink(this.file);
        this.logger?.warn?.('Removed a stale bot instance lease.', {
          leaseFile: this.file,
          previousPid: existing.owner?.pid,
          previousHost: existing.owner?.hostname,
        });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    throw new Error(`Could not acquire the bot instance lease after ${MAX_ACQUIRE_ATTEMPTS} attempts.`);
  }

  async release() {
    if (this.released) return;
    this.released = true;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    await this.heartbeatPromise?.catch(() => undefined);
    if (!this.acquired) return;

    try {
      const handle = await fs.open(this.file, 'r');
      let owner;
      let handleStats;
      try {
        owner = JSON.parse(await handle.readFile('utf8'));
        handleStats = await handle.stat();
      } finally {
        await handle.close();
      }
      const pathStats = await fs.stat(this.file);
      if (owner?.instanceId === this.instanceId
        && handleStats.dev === pathStats.dev
        && handleStats.ino === pathStats.ino) {
        await fs.unlink(this.file);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    } finally {
      this.acquired = false;
    }
  }

  #isActive({ owner, stats }) {
    if (validOwner(owner) && owner.hostname === this.hostname) {
      return this.isProcessAlive(owner.pid);
    }
    return this.now() - stats.mtimeMs < this.staleAfterMs;
  }

  #startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatPromise || this.released || this.lost) return;
      this.heartbeatPromise = this.#heartbeat()
        .catch((error) => this.#handleHeartbeatFailure(error))
        .finally(() => {
          this.heartbeatPromise = null;
        });
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  async #heartbeat() {
    const handle = await fs.open(this.file, 'r+');
    try {
      const owner = JSON.parse(await handle.readFile('utf8'));
      if (owner?.instanceId !== this.instanceId) {
        const error = new Error('The bot instance lease is now owned by another process.');
        error.code = 'BOT_INSTANCE_LEASE_REPLACED';
        throw error;
      }
      const heartbeatAt = new Date(this.now());
      await handle.utimes(heartbeatAt, heartbeatAt);
    } finally {
      await handle.close();
    }
  }

  #handleHeartbeatFailure(error) {
    if (this.released || this.lost) return;
    this.lost = true;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.logger?.error?.('Lost the bot instance lease; shutting down to prevent duplicate consumers.', {
      leaseFile: this.file,
      error,
    });
    try {
      this.onLost?.(error);
    } catch (callbackError) {
      this.logger?.error?.('The instance lease loss handler failed.', { error: callbackError });
    }
  }
}
