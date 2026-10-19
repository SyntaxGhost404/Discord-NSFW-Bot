import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('Replit log supervisor mirrors stdout and stderr into a plain-text persistent file', async (testContext) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-bot-logs-'));
  testContext.after(() => fs.rm(directory, { recursive: true, force: true }));
  const activeLog = path.join(directory, 'console.txt');
  const secret = 'sensitive-interaction-token';
  const childCode = [
    "process.stdout.write('\\u001b[32mstdout line\\u001b[39m\\n')",
    "process.stderr.write('\\u001b[31mstderr line\\u001b[39m\\n')",
    `process.stdout.write('/interactions/123/${secret}/callback\\n')`,
  ].join(';');

  const run = spawnSync(process.execPath, [
    'scripts/start-with-logs.mjs',
    process.execPath,
    '--input-type=module',
    '-e',
    childCode,
  ], {
    cwd: root,
    env: { ...process.env, CONSOLE_LOG_FILE: activeLog },
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /stdout line/);
  assert.match(run.stderr, /stderr line/);
  assert.doesNotMatch(run.stdout, new RegExp(secret, 'g'));
  const persisted = await fs.readFile(activeLog, 'utf8');
  assert.match(persisted, /run started/);
  assert.match(persisted, /stdout line/);
  assert.match(persisted, /stderr line/);
  assert.match(persisted, /run ended/);
  assert.doesNotMatch(persisted, /\u001B\[/);
  assert.doesNotMatch(persisted, new RegExp(secret, 'g'));
  assert.match(persisted, /\[REDACTED\]/);

  const exportedLog = path.join(directory, 'export.txt');
  const exportResult = spawnSync(process.execPath, [
    'scripts/export-logs.mjs',
    exportedLog,
  ], {
    cwd: root,
    env: { ...process.env, CONSOLE_LOG_FILE: activeLog },
    encoding: 'utf8',
  });
  assert.equal(exportResult.status, 0, exportResult.stderr);
  assert.equal(await fs.readFile(exportedLog, 'utf8'), persisted);
});
