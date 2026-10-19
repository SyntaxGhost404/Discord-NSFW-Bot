import process from 'node:process';
import { inspect } from 'node:util';
import { Chalk } from 'chalk';
import { Emoji } from '../config/emojis.js';

const PRIORITY = Object.freeze({
  debug: 10,
  boot: 20,
  event: 20,
  info: 20,
  success: 20,
  warn: 30,
  error: 40,
});

const KIND = Object.freeze({
  debug: { label: 'DEBUG', symbol: Emoji.terminal.debug, style: (chalk) => chalk.gray },
  boot: { label: 'BOOT', symbol: Emoji.terminal.boot, style: (chalk) => chalk.bold.magenta },
  event: { label: 'EVENT', symbol: Emoji.terminal.event, style: (chalk) => chalk.bold.blue },
  info: { label: 'INFO', symbol: Emoji.terminal.info, style: (chalk) => chalk.cyan },
  success: { label: 'SUCCESS', symbol: Emoji.terminal.success, style: (chalk) => chalk.bold.green },
  warn: { label: 'WARN', symbol: Emoji.terminal.warn, style: (chalk) => chalk.bold.yellow },
  error: { label: 'ERROR', symbol: Emoji.terminal.error, style: (chalk) => chalk.bold.red },
});

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(?:authorization|password|secret|token|api[_-]?key)/i;

function redactString(value) {
  return String(value)
    .replace(/(\/interactions\/[^/?\s]+\/)[^/?\s]+/giu, `$1${REDACTED}`)
    .replace(/(\/webhooks\/[^/?\s]+\/)[^/?\s]+/giu, `$1${REDACTED}`)
    .replace(/\bBot\s+[^\s,;]+/giu, `Bot ${REDACTED}`);
}

export function redactLogText(value) {
  return redactString(value);
}

export function redactSensitive(value, key = '', seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return serializeError(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, '', seen));
  return Object.fromEntries(Object.entries(value)
    .map(([childKey, child]) => [childKey, redactSensitive(child, childKey, seen)]));
}

function hasEnvironmentKey(environment, key) {
  return Object.prototype.hasOwnProperty.call(environment, key);
}

function forcedColorLevel(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['0', 'false', 'never', 'off'].includes(normalized)) return 0;
  if (normalized === '2') return 2;
  if (normalized === '3') return 3;
  return 1;
}

function streamColorLevel(stream) {
  if (!stream?.isTTY) return 0;
  const depth = typeof stream.getColorDepth === 'function' ? stream.getColorDepth() : 4;
  if (depth >= 24) return 3;
  if (depth >= 8) return 2;
  return 1;
}

export function colorLevelForEnvironment({
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const preference = String(environment.LOG_COLORS ?? 'auto').trim().toLowerCase();
  if (['never', 'false', '0', 'off'].includes(preference)) return 0;
  if (['always', 'true', '1', 'on'].includes(preference)) return 1;
  if (hasEnvironmentKey(environment, 'NO_COLOR')) return 0;
  if (hasEnvironmentKey(environment, 'FORCE_COLOR')) {
    return forcedColorLevel(environment.FORCE_COLOR);
  }
  if (environment.REPL_ID || environment.REPL_SLUG || environment.REPLIT_DEPLOYMENT) {
    return 1;
  }
  return Math.max(streamColorLevel(stdout), streamColorLevel(stderr));
}

function serializeError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: redactString(error.message),
    code: error.code,
    status: error.status,
    stack: redactString(error.stack),
  };
}

function jsonReplacer(key, value) {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value instanceof Error) return serializeError(value);
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function prettyTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace('T', ' ');
}

function contextLabel(bindings) {
  return redactString([bindings.application, bindings.subsystem].filter(Boolean).join('/'));
}

function extraBindings(bindings) {
  return Object.fromEntries(Object.entries(bindings)
    .filter(([key]) => key !== 'application' && key !== 'subsystem'));
}

function formatValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') {
    const safe = redactString(value);
    return /\s|[="']/u.test(safe) ? JSON.stringify(safe) : safe;
  }
  return inspect(redactSensitive(value), {
    colors: false,
    compact: true,
    breakLength: Number.POSITIVE_INFINITY,
    depth: 4,
    maxArrayLength: 25,
    maxStringLength: 500,
  });
}

function splitMetadata(data) {
  if (data === undefined) return { values: {}, errors: [] };
  if (data instanceof Error) return { values: {}, errors: [{ key: 'error', error: data }] };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { values: { data }, errors: [] };
  }

  const values = {};
  const errors = [];
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY.test(key)) values[key] = REDACTED;
    else if (value instanceof Error) errors.push({ key, error: value });
    else values[key] = value;
  }
  return { values, errors };
}

function errorSummary(error) {
  const code = error.code === undefined ? '' : ` ${error.code}`;
  return redactString(`${error.name || 'Error'}${code}: ${error.message || String(error)}`);
}

export class Logger {
  constructor(level = 'info', bindings = {}, options = {}) {
    this.level = PRIORITY[level] === undefined ? 'info' : level;
    this.threshold = PRIORITY[this.level];
    this.bindings = bindings;
    this.clock = options.clock ?? (() => new Date());
    this.output = options.output ?? console;
    this.format = options.format ?? (process.env.LOG_FORMAT === 'json' ? 'json' : 'pretty');
    this.colorLevel = options.colorLevel ?? colorLevelForEnvironment(options.colorEnvironment);
    this.chalk = new Chalk({ level: this.colorLevel });
  }

  child(bindings) {
    return new Logger(this.level, { ...this.bindings, ...bindings }, {
      clock: this.clock,
      output: this.output,
      format: this.format,
      colorLevel: this.colorLevel,
    });
  }

  debug(message, data) { this.#write('debug', message, data); }
  boot(message, data) { this.#write('boot', message, data); }
  event(message, data) { this.#write('event', message, data); }
  info(message, data) { this.#write('info', message, data); }
  success(message, data) { this.#write('success', message, data); }
  warn(message, data) { this.#write('warn', message, data); }
  error(message, data) { this.#write('error', message, data); }

  #write(kind, message, data) {
    if (PRIORITY[kind] < this.threshold) return;
    const timestamp = this.clock();
    if (this.format === 'json') {
      this.#emit(kind, JSON.stringify({
        time: (timestamp instanceof Date ? timestamp : new Date(timestamp)).toISOString(),
        level: kind,
        message,
        ...this.bindings,
        ...(data === undefined ? {} : { data }),
      }, jsonReplacer));
      return;
    }

    const chalk = this.chalk;
    const style = KIND[kind];
    const badge = style.style(chalk)(`${style.symbol} ${style.label.padEnd(7)}`);
    const context = contextLabel(this.bindings);
    const { values, errors } = splitMetadata(data);
    const metadata = { ...extraBindings(this.bindings), ...values };
    const metadataText = Object.entries(metadata)
      .map(([key, value]) => `${chalk.cyan(key)}=${chalk.dim(formatValue(value, key))}`);
    const errorText = errors.map(({ key, error }) => (
      `${chalk.cyan(key)}=${chalk.red(errorSummary(error))}`
    ));
    const segments = [
      chalk.dim(prettyTimestamp(timestamp)),
      badge,
      context ? chalk.magenta(`[${context}]`) : null,
      chalk.bold(redactString(message)),
      [...metadataText, ...errorText].join(' '),
    ].filter(Boolean);
    this.#emit(kind, segments.join('  '));

    for (const { error } of errors) {
      const stackLines = String(error.stack ?? '').split('\n').slice(1);
      for (const line of stackLines) {
        if (line.trim()) this.#emit(kind, chalk.dim(`    ${Emoji.terminal.stack} ${redactString(line.trim())}`));
      }
    }
  }

  #emit(kind, line) {
    const method = kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'log';
    const writer = this.output[method] ?? this.output.log;
    writer.call(this.output, line);
  }
}
