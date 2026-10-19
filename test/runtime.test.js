import { afterEach, describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../src/config.js';
import { ProviderCircuitBreaker } from '../src/brain/providers/circuit-breaker.js';
import { DiscordRest, DiscordRestError, InteractionWebhook, routeTemplate } from '../src/discord/rest.js';
import { Logger, redactLogText } from '../src/lib/logger.js';
import { choose, randomInteger, shuffle } from '../src/lib/random.js';
import { installFetchMock, json } from './helpers/fetch-mock.js';

const quiet = new Logger('error', {}, { output: { log() {}, warn() {}, error() {}, debug() {} } });
let mock;
afterEach(() => mock?.restore());

describe('configuration', () => {
  const base = {
    DISCORD_APPLICATION_ID: '111111111111111111',
    DISCORD_PUBLIC_KEY: 'D0687E9A59A439A7E6A0C6C34A0C5693227DD47408AE54E1AFF4013B742F01A3',
    DISCORD_BOT_TOKEN: 'token',
  };

  it('parses defaults, legacy aliases, and clamps numbers', () => {
    const config = loadConfig({ CLIENT_ID: '111111111111111112', BOT_TOKEN: 'legacy', MEDIA_TIMEOUT_MS: '999999', GATEWAY_MODE: 'presence' });
    expect(config).toMatchObject({
      applicationId: '111111111111111112',
      botToken: 'legacy',
      registrationMode: 'global',
      mediaTimeoutMs: 60_000,
      mediaDeadlineMs: 24_000,
      maxMediaBytes: 10 * 1024 * 1024,
      waifuPicsEnabled: false,
      gateway: { mode: 'presence', intents: 0, shardCount: 1 },
    });
    expect(loadConfig(base)).toMatchObject({ publicKey: base.DISCORD_PUBLIC_KEY.toLowerCase(), gateway: { mode: 'full', intents: 4608 } });
  });

  it('rejects values that would break the bot', () => {
    expect(() => loadConfig({ DISCORD_APPLICATION_ID: '123.apps.googleusercontent.com' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ DISCORD_PUBLIC_KEY: 'abc' })).toThrow(/64-character/);
    expect(() => loadConfig({ COMMAND_REGISTRATION_MODE: 'guild' })).toThrow(/TESTING_GUILD_ID/);
    expect(() => loadConfig({ GATEWAY_MODE: 'sometimes' })).toThrow(/GATEWAY_MODE/);
    expect(() => loadConfig({ PREMIUM_USER_IDS: '1,2' })).toThrow(/snowflakes/);
  });
});

describe('Discord REST client', () => {
  it('honours retry_after on 429 and then succeeds', async () => {
    let attempts = 0;
    mock = installFetchMock([['GET https://discord.com/api/v10/gateway', () => {
      attempts += 1;
      return attempts === 1
        ? json({ message: 'You are being rate limited.', retry_after: 0.05, global: false }, { status: 429 })
        : json({ url: 'wss://gateway.discord.gg' });
    }]]);
    const rest = new DiscordRest({ token: 'secret-token', logger: quiet });
    expect(await rest.get('/gateway')).toEqual({ url: 'wss://gateway.discord.gg' });
    expect(attempts).toBe(2);
    expect(mock.calls[0].headers.authorization).toBe('Bot secret-token');
  });

  it('raises structured errors with redacted route templates', async () => {
    mock = installFetchMock([['PATCH https://discord.com/api/v10/webhooks/', () => json({ message: 'Unknown Webhook', code: 10015 }, { status: 404 })]]);
    const rest = new DiscordRest({ logger: quiet });
    const error = await rest.patch('/webhooks/111111111111111111/super-secret-token/messages/@original', { body: {}, auth: false }).catch((caught) => caught);
    expect(error).toBeInstanceOf(DiscordRestError);
    expect(error).toMatchObject({ status: 404, code: 10015, route: 'PATCH /webhooks/:id/:token/messages/@original' });
    expect(routeTemplate('POST', '/interactions/111111111111111111/abc/callback')).toBe('POST /interactions/:id/:token/callback');
  });

  it('retries a webhook edit that races ahead of the deferred acknowledgement', async () => {
    let attempts = 0;
    mock = installFetchMock([['PATCH https://discord.com/api/v10/webhooks/', () => {
      attempts += 1;
      return attempts === 1 ? json({ message: 'Unknown Webhook', code: 10015 }, { status: 404 }) : json({ id: '1' });
    }]]);
    const webhook = new InteractionWebhook({ rest: new DiscordRest({ logger: quiet }), applicationId: '1', token: 't', receivedAt: Date.now() });
    expect(await webhook.editOriginal({ content: 'x' })).toEqual({ id: '1' });
    expect(attempts).toBe(2);

    const late = new InteractionWebhook({ rest: new DiscordRest({ logger: quiet }), applicationId: '1', token: 't', receivedAt: Date.now() - 60_000 });
    attempts = 0;
    await expect(late.editOriginal({ content: 'x' })).rejects.toMatchObject({ code: 10015 });
    expect(attempts).toBe(1);
  });

  it('sends files as payload_json plus files[n] multipart parts', async () => {
    let form;
    mock = installFetchMock([['POST https://discord.com/api/v10/channels/', async (request) => {
      form = await request.formData();
      return json({ id: '1' });
    }]]);
    await new DiscordRest({ token: 't', logger: quiet }).post('/channels/1/messages', {
      body: { attachments: [{ id: 0, filename: 'media.gif' }] },
      files: [{ data: new Uint8Array([1, 2, 3]), name: 'media.gif', contentType: 'image/gif' }],
    });
    expect(JSON.parse(form.get('payload_json'))).toEqual({ attachments: [{ id: 0, filename: 'media.gif' }] });
    expect(form.get('files[0]').name).toBe('media.gif');
    expect(form.get('files[0]').type).toBe('image/gif');
  });
});

describe('logging', () => {
  it('redacts tokens from messages, nested fields, and errors', () => {
    const records = [];
    const logger = new Logger('debug', { application: 'test' }, { output: { log: (record) => records.push(record), warn: (record) => records.push(record), error: (record) => records.push(record), debug: (record) => records.push(record) } });
    logger.error('Failed PATCH /webhooks/1/abc-token/messages/@original', {
      authorization: 'Bot abc',
      nested: { botToken: 'xyz', url: 'https://discord.com/api/v10/interactions/1/tok/callback' },
      error: new Error('Authorization: Bot leaked.token.value'),
    });
    expect(JSON.stringify(records)).not.toMatch(/abc-token|xyz|leaked\.token|\/tok\//);
    expect(records[0]).toMatchObject({ level: 'error', kind: 'error', application: 'test', authorization: '[REDACTED]' });
    expect(redactLogText('Bot abc.def')).toBe('Bot [REDACTED]');
  });

  it('filters below the configured level', () => {
    const records = [];
    const output = { log: (record) => records.push(record), warn: (record) => records.push(record), error: (record) => records.push(record), debug: (record) => records.push(record) };
    const logger = new Logger('warn', {}, { output });
    logger.info('hidden');
    logger.success('hidden');
    logger.warn('shown');
    expect(records.map((record) => record.message)).toEqual(['shown']);
  });
});

describe('provider circuit breaker', () => {
  it('opens after repeated failures, probes once, and ignores neutral outcomes', () => {
    let now = 1_000;
    const breaker = new ProviderCircuitBreaker({ logger: quiet, now: () => now, random: () => 0 });
    for (let index = 0; index < 3; index += 1) breaker.failure(breaker.acquire('p'), { code: 'HTTP_ERROR' });
    expect(() => breaker.acquire('p')).toThrow(expect.objectContaining({ code: 'CIRCUIT_OPEN' }));

    now += 30_001;
    const probe = breaker.acquire('p');
    expect(probe.probe).toBe(true);
    expect(() => breaker.acquire('p')).toThrow(expect.objectContaining({ code: 'CIRCUIT_OPEN' }));
    breaker.success(probe);
    expect(breaker.snapshot('p')).toEqual({ failures: 0, openUntil: 0, probeInFlight: false });

    for (let index = 0; index < 5; index += 1) breaker.failure(breaker.acquire('q'), { code: 'DEADLINE_EXCEEDED' });
    expect(breaker.acquire('q').probe).toBe(false);
  });
});

describe('random helpers', () => {
  it('stay inside their ranges and keep every element', () => {
    for (let index = 0; index < 200; index += 1) {
      const value = randomInteger(3, 5);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(5);
    }
    expect(choose([])).toBeNull();
    expect(shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});
