import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { configFor } from '../../src/config.js';
import { fetchHentaiCosplayXxx } from '../../src/brain/providers/hentai-cosplay-xxx.js';
import { MediaHttpClient, SubrequestBudget } from '../../src/brain/providers/http.js';

// Fills the real CosplayPool from hentai-cosplay-xxx.com, then compares how
// long /cosplay's provider takes with the pool and with direct feed reads.
// Media stays in memory; nothing is posted anywhere.
async function timedFetch(config, withPool) {
  const http = new MediaHttpClient({
    timeoutMs: config.mediaTimeoutMs,
    maximumBytes: config.maxMediaBytes,
    deadline: Date.now() + 20_000,
    budget: new SubrequestBudget(43),
  });
  const startedAt = Date.now();
  try {
    const result = await fetchHentaiCosplayXxx({}, { http, config, env: withPool ? env : {}, logger: null });
    return { ok: true, ms: Date.now() - startedAt, bytes: result.buffer.byteLength, subrequests: http.budget.used };
  } catch (error) {
    return { ok: false, ms: Date.now() - startedAt, error: error.code, subrequests: http.budget.used };
  }
}

describe('live cosplay pool', () => {
  it('fills from the real feed and serves /cosplay without a feed read', async () => {
    const config = configFor(env);
    const stub = env.COSPLAY_POOL.getByName('hentai-cosplay-xxx.com');
    await stub.take();
    const fillStartedAt = Date.now();
    for (let run = 0; run < 3 && (await stub.status()).size < 15; run += 1) await runDurableObjectAlarm(stub);
    const status = await stub.status();
    console.log(`pool after ${Date.now() - fillStartedAt}ms: ${status.size} links, dead servers: ${status.deadHosts.join(', ') || 'none'}`);
    expect(status.size).toBeGreaterThan(0);

    const pooled = [];
    for (let run = 0; run < 6; run += 1) pooled.push(await timedFetch(config, true));
    const direct = [];
    for (let run = 0; run < 4; run += 1) direct.push(await timedFetch(config, false));
    console.log('with pool:', JSON.stringify(pooled));
    console.log('direct:   ', JSON.stringify(direct));
    const median = (runs) => runs.map((entry) => entry.ms).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    console.log(`median with pool ${median(pooled)}ms, direct ${median(direct)}ms`);
    expect(pooled.filter((entry) => entry.ok).length).toBeGreaterThan(0);
    await runInDurableObject(stub, (_instance, state) => state.storage.deleteAlarm());
  });
});
