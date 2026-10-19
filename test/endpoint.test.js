import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { verifyDiscordRequest } from '../src/http/signature.js';
import { installFetchMock } from './helpers/fetch-mock.js';
import { commandInteraction, signedRequest } from './helpers/discord.js';

const PUBLIC_KEY = 'd0687e9a59a439a7e6a0c6c34a0c5693227dd47408ae54e1aff4013b742f01a3';

async function dispatch(request) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('Ed25519 request verification', () => {
  it('accepts a correctly signed body and returns the decoded text', async () => {
    const request = await signedRequest({ type: 1 });
    await expect(verifyDiscordRequest(request, PUBLIC_KEY)).resolves.toEqual({ valid: true, body: '{"type":1}' });
  });

  it('rejects tampered bodies, wrong timestamps, and malformed signatures', async () => {
    expect((await verifyDiscordRequest(await signedRequest({ type: 1 }, { tamper: true }), PUBLIC_KEY)).valid).toBe(false);

    const original = await signedRequest({ type: 1 }, { timestamp: '1700000000' });
    const replayed = new Request(original.url, {
      method: 'POST',
      headers: { ...Object.fromEntries(original.headers), 'X-Signature-Timestamp': '1700000001' },
      body: await original.text(),
    });
    expect((await verifyDiscordRequest(replayed, PUBLIC_KEY)).valid).toBe(false);
    expect((await verifyDiscordRequest(await signedRequest({ type: 1 }, { signature: 'zz' }), PUBLIC_KEY)).valid).toBe(false);
    expect((await verifyDiscordRequest(await signedRequest({ type: 1 }, { signature: '0'.repeat(128) }), PUBLIC_KEY)).valid).toBe(false);
  });

  it('verifies the exact raw bytes, including non-ASCII content', async () => {
    const request = await signedRequest('{"type":1,"note":"日本語 ✓"}');
    const result = await verifyDiscordRequest(request, PUBLIC_KEY);
    expect(result.valid).toBe(true);
    expect(JSON.parse(result.body).note).toBe('日本語 ✓');
  });
});

describe('interactions endpoint', () => {
  afterEach(() => {
    globalThis.__fetchMock?.restore();
  });

  it('serves a plain health page and rejects unknown routes and methods', async () => {
    const health = await dispatch(new Request('https://bot.example/'));
    expect(health.status).toBe(200);
    expect(await health.text()).toContain('/interactions');
    expect((await dispatch(new Request('https://bot.example/nope'))).status).toBe(404);
    expect((await dispatch(new Request('https://bot.example/interactions'))).status).toBe(405);
  });

  it('answers 401 to unsigned or badly signed requests, as Discord\'s security checks require', async () => {
    const unsigned = new Request('https://bot.example/interactions', { method: 'POST', body: '{"type":1}' });
    expect((await dispatch(unsigned)).status).toBe(401);
    expect((await dispatch(await signedRequest({ type: 1 }, { tamper: true }))).status).toBe(401);
  });

  it('acknowledges PING with a JSON PONG on both endpoint paths', async () => {
    for (const path of ['/interactions', '/']) {
      const response = await dispatch(await signedRequest({ type: 1, id: '1', application_id: '1', token: 't', version: 1 }, { path }));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ type: 1 });
    }
  });

  it('returns 400 for signed bodies that are not valid interactions', async () => {
    expect((await dispatch(await signedRequest('not json'))).status).toBe(400);
    expect((await dispatch(await signedRequest({ type: 99, id: '1', token: 't' }))).status).toBe(400);
  });

  it('answers unknown commands and stale components ephemerally', async () => {
    globalThis.__fetchMock = installFetchMock();
    const response = await dispatch(await signedRequest(commandInteraction('does-not-exist')));
    expect(await response.json()).toEqual({
      type: 4,
      data: { content: 'This interaction is no longer available.', flags: 64 },
    });
  });
});
