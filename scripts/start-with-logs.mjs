import { spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import { redactLogText } from '../src/lib/logger.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configuredLogFile = process.env.CONSOLE_LOG_FILE?.trim() || 'logs/discord-bot-console.txt';
const logFile = path.resolve(root, configuredLogFile);
mkdirSync(path.dirname(logFile), { recursive: true });
const logDescriptor = openSync(logFile, 'a', 0o600);
chmodSync(logFile, 0o600);

let logClosed = false;

function appendLog(value) {
  if (logClosed || !value) return;
  const safeText = redactLogText(stripVTControlCharacters(String(value)));
  writeSync(logDescriptor, safeText, null, 'utf8');
}

function announce(value, destination = process.stdout) {
  destination.write(value);
  appendLog(value);
}

const commandArguments = process.argv.slice(2);
const command = commandArguments.length > 0 ? commandArguments.shift() : process.execPath;
const childArguments = commandArguments.length > 0
  ? commandArguments
  : command === process.execPath
    ? [path.join(root, 'index.js')]
    : [];

appendLog(`\n===== run started at ${new Date().toISOString()} =====\n`);
announce(`[log-backup] Persisting complete bot output to ${logFile}\n`);

const child = spawn(command, childArguments, {
  cwd: root,
  env: { ...process.env, BOT_LOG_CAPTURED: '1' },
  stdio: ['inherit', 'pipe', 'pipe'],
});

function capture(readable, destination) {
  const decoder = new StringDecoder('utf8');
  let pending = '';

  const emit = (value) => {
    if (!value) return;
    const safeText = redactLogText(value);
    destination.write(safeText);
    appendLog(safeText);
  };

  readable.on('data', (chunk) => {
    pending += decoder.write(chunk);
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      emit(pending.slice(0, newline + 1));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
  readable.on('end', () => {
    pending += decoder.end();
    emit(pending);
  });
}

capture(child.stdout, process.stdout);
capture(child.stderr, process.stderr);

let forwardedSignals = 0;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    forwardedSignals += 1;
    appendLog(`[log-backup] Forwarding ${signal} to bot process.\n`);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(forwardedSignals > 1 ? 'SIGKILL' : signal);
    }
  });
}

const syncTimer = setInterval(() => {
  if (!logClosed) fsyncSync(logDescriptor);
}, 5_000);
syncTimer.unref();

child.on('error', (error) => {
  announce(`[log-backup] Could not start bot process: ${error.message}\n`, process.stderr);
});

child.on('close', (code, signal) => {
  clearInterval(syncTimer);
  appendLog(`===== run ended at ${new Date().toISOString()} (code=${code ?? 'none'}, signal=${signal ?? 'none'}) =====\n`);
  try {
    fsyncSync(logDescriptor);
  } finally {
    logClosed = true;
    closeSync(logDescriptor);
  }
  if (Number.isInteger(code)) process.exitCode = code;
  else if (signal && os.constants.signals[signal]) process.exitCode = 128 + os.constants.signals[signal];
  else process.exitCode = 1;
});
