import assert from 'node:assert/strict';
import test from 'node:test';
import { Logger, colorLevelForEnvironment } from '../src/lib/logger.js';

function captureOutput() {
  const lines = { log: [], warn: [], error: [] };
  return {
    lines,
    output: {
      log(line) { lines.log.push(line); },
      warn(line) { lines.warn.push(line); },
      error(line) { lines.error.push(line); },
    },
  };
}

const fixedClock = () => new Date('2026-01-02T03:04:05.678Z');

test('pretty logger gives boot, event, success, warning, and error states distinct badges', () => {
  const { lines, output } = captureOutput();
  const logger = new Logger('debug', { application: 'discord-nsfw-bot' }, {
    clock: fixedClock,
    colorLevel: 0,
    output,
  });
  const gateway = logger.child({ subsystem: 'discord-gateway' });

  logger.boot('Starting bot.', { commands: 39 });
  gateway.event('Opening Gateway connection.', { resume: false });
  gateway.success('Gateway ready.', { guilds: 3 });
  gateway.warn('Heartbeat delayed.', { delayMs: 250 });
  gateway.error('Gateway failed.', new Error('socket closed'));

  assert.equal(
    lines.log[0],
    '2026-01-02 03:04:05.678Z  ◉ BOOT     [discord-nsfw-bot]  Starting bot.  commands=39',
  );
  assert.equal(
    lines.log[1],
    '2026-01-02 03:04:05.678Z  ◆ EVENT    [discord-nsfw-bot/discord-gateway]  Opening Gateway connection.  resume=false',
  );
  assert.equal(
    lines.log[2],
    '2026-01-02 03:04:05.678Z  ✓ SUCCESS  [discord-nsfw-bot/discord-gateway]  Gateway ready.  guilds=3',
  );
  assert.equal(
    lines.warn[0],
    '2026-01-02 03:04:05.678Z  ▲ WARN     [discord-nsfw-bot/discord-gateway]  Heartbeat delayed.  delayMs=250',
  );
  assert.match(lines.error[0], /✖ ERROR .*Gateway failed\.  error=Error: socket closed/);
  assert.ok(lines.error.slice(1).some((line) => line.includes('logger.test.js')));
});

test('forced pretty colors emit ANSI styling while color level zero remains portable', () => {
  const colored = captureOutput();
  new Logger('info', {}, {
    clock: fixedClock,
    colorLevel: 1,
    output: colored.output,
  }).success('Registration complete.');
  assert.match(colored.lines.log[0], /\u001B\[/);
  assert.match(colored.lines.log[0], /SUCCESS/);

  const plain = captureOutput();
  new Logger('info', {}, {
    clock: fixedClock,
    colorLevel: 0,
    output: plain.output,
  }).success('Registration complete.');
  assert.doesNotMatch(plain.lines.log[0], /\u001B\[/);
});

test('color policy honors explicit settings, NO_COLOR, Replit, and terminal depth', () => {
  const noTty = { isTTY: false };
  assert.equal(colorLevelForEnvironment({
    environment: { NO_COLOR: '' },
    stdout: noTty,
    stderr: noTty,
  }), 0);
  assert.equal(colorLevelForEnvironment({
    environment: { LOG_COLORS: 'always', NO_COLOR: '' },
    stdout: noTty,
    stderr: noTty,
  }), 1);
  assert.equal(colorLevelForEnvironment({
    environment: { REPL_ID: 'workspace-id' },
    stdout: noTty,
    stderr: noTty,
  }), 1);
  assert.equal(colorLevelForEnvironment({
    environment: {},
    stdout: { isTTY: true, getColorDepth: () => 24 },
    stderr: noTty,
  }), 3);
});

test('JSON format remains available for structured log collectors', () => {
  const { lines, output } = captureOutput();
  const logger = new Logger('info', { application: 'discord-nsfw-bot' }, {
    clock: fixedClock,
    colorLevel: 0,
    format: 'json',
    output,
  });
  logger.success('Registration complete.', { count: 39 });
  assert.deepEqual(JSON.parse(lines.log[0]), {
    time: '2026-01-02T03:04:05.678Z',
    level: 'success',
    message: 'Registration complete.',
    application: 'discord-nsfw-bot',
    data: { count: 39 },
  });
});

test('logger redacts interaction, webhook, authorization, and token secrets', () => {
  const { lines, output } = captureOutput();
  const logger = new Logger('info', {}, {
    clock: fixedClock,
    colorLevel: 0,
    output,
  });
  const secret = 'a-very-sensitive-interaction-token';
  logger.error(`POST /interactions/123/${secret}/callback failed`, {
    route: `/webhooks/456/${secret}/messages/@original`,
    authorization: `Bot ${secret}`,
    interactionToken: secret,
  });
  const rendered = lines.error.join('\n');
  assert.doesNotMatch(rendered, new RegExp(secret, 'g'));
  assert.match(rendered, /\[REDACTED\]/);
});
