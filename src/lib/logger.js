const PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

// Event kinds are kept as an indexed field so Workers Logs can filter by
// lifecycle stage; each maps onto one console severity.
const KIND_LEVEL = Object.freeze({
  debug: 'debug',
  boot: 'info',
  event: 'info',
  info: 'info',
  success: 'info',
  warn: 'warn',
  error: 'error',
});

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(?:authorization|password|secret|token|api[_-]?key)/i;

export function redactLogText(value) {
  return String(value)
    .replace(/(\/interactions\/[^/?\s]+\/)[^/?\s]+/giu, `$1${REDACTED}`)
    .replace(/(\/webhooks\/[^/?\s]+\/)[^/?\s]+/giu, `$1${REDACTED}`)
    .replace(/\bBot\s+[^\s,;"]+/giu, `Bot ${REDACTED}`);
}

function serializeError(error) {
  const serialized = {
    name: error.name,
    message: redactLogText(error.message),
  };
  if (error.code !== undefined) serialized.code = error.code;
  if (error.status !== undefined) serialized.status = error.status;
  if (error.provider !== undefined) serialized.provider = error.provider;
  if (error.stack) serialized.stack = redactLogText(error.stack);
  if (error.cause instanceof Error) serialized.cause = serializeError(error.cause);
  return serialized;
}

export function redactSensitive(value, key = '', seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return serializeError(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, '', seen));
  return Object.fromEntries(Object.entries(value)
    .map(([childKey, child]) => [childKey, redactSensitive(child, childKey, seen)]));
}

export class Logger {
  constructor(level = 'info', bindings = {}, { output = console, clock = () => new Date() } = {}) {
    this.level = PRIORITY[level] === undefined ? 'info' : level;
    this.threshold = PRIORITY[this.level];
    this.bindings = bindings;
    this.output = output;
    this.clock = clock;
  }

  child(bindings) {
    return new Logger(this.level, { ...this.bindings, ...bindings }, {
      output: this.output,
      clock: this.clock,
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
    const level = KIND_LEVEL[kind];
    if (PRIORITY[level] < this.threshold) return;
    const fields = data instanceof Error ? { error: data } : data;
    const record = {
      time: this.clock().toISOString(),
      level,
      kind,
      message: redactLogText(message),
      ...redactSensitive(this.bindings),
      ...(fields && typeof fields === 'object' ? redactSensitive(fields) : fields === undefined ? {} : { data: redactSensitive(fields) }),
    };
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'debug' ? 'debug' : 'log';
    (this.output[method] ?? this.output.log).call(this.output, record);
  }
}

export function createLogger(level, bindings = {}) {
  return new Logger(level, { application: 'discord-nsfw-bot', ...bindings });
}
