import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ActiveInstanceError, SingleInstanceLease } from '../src/lib/single-instance-lease.js';

const silentLogger = {
  child() { return this; },
  warn() {},
  error() {},
};

async function temporaryDirectory(testContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-bot-lease-'));
  testContext.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('single-instance lease rejects a second live process owner', async (testContext) => {
  const directory = await temporaryDirectory(testContext);
  const file = path.join(directory, 'bot.lock');
  const first = await SingleInstanceLease.acquire({
    file,
    logger: silentLogger,
    heartbeatMs: 60_000,
  });
  testContext.after(() => first.release());

  await assert.rejects(
    SingleInstanceLease.acquire({ file, logger: silentLogger, heartbeatMs: 60_000 }),
    (error) => error instanceof ActiveInstanceError
      && error.code === 'BOT_INSTANCE_ALREADY_RUNNING'
      && error.owner.pid === process.pid,
  );
});

test('releasing a lease allows the next process to acquire it', async (testContext) => {
  const directory = await temporaryDirectory(testContext);
  const file = path.join(directory, 'bot.lock');
  const first = await SingleInstanceLease.acquire({ file, logger: silentLogger, heartbeatMs: 60_000 });
  await first.release();

  const second = await SingleInstanceLease.acquire({ file, logger: silentLogger, heartbeatMs: 60_000 });
  await second.release();
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('a stale lease from an old container is reclaimed safely', async (testContext) => {
  const directory = await temporaryDirectory(testContext);
  const file = path.join(directory, 'bot.lock');
  await fs.writeFile(file, JSON.stringify({
    instanceId: 'old-instance',
    pid: 999_999,
    hostname: 'old-container',
    startedAt: '2026-01-01T00:00:00.000Z',
  }));
  const stale = new Date(Date.now() - 60_000);
  await fs.utimes(file, stale, stale);

  const lease = await SingleInstanceLease.acquire({
    file,
    logger: silentLogger,
    heartbeatMs: 60_000,
    staleAfterMs: 10_000,
  });
  assert.notEqual(lease.instanceId, 'old-instance');
  await lease.release();
});
