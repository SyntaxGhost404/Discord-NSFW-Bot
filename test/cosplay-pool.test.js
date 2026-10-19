import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { image, installFetchMock } from './helpers/fetch-mock.js';

const LIVE = 'static1.hentai-cosplay-xxx.com';
const DEAD = 'static11.hentai-cosplay-xxx.com';

// Every page lists covers on a working server and on one that answers 502.
function feedPage(page) {
  const covers = [LIVE, LIVE, LIVE, DEAD, DEAD].map((host, index) => (
    `<li><a href="/image/${page}-${index}/"><img src="https://${host}/upload/2026/${page}/p=160x200/${index}.jpg"></a></li>`
  ));
  return `<a class="last" href="/search/page/500/">Last</a><ul id="image-list">${covers.join('')}</ul>`;
}

function link(host, page, index) {
  return { url: `https://${host}/upload/2026/${page}/${index}.jpg`, page };
}

async function clearAlarm(stub) {
  await runInDurableObject(stub, (_instance, state) => state.storage.deleteAlarm());
}

let mock;
beforeEach(() => {
  mock = installFetchMock();
});
afterEach(() => mock.restore());

describe('CosplayPool Durable Object', () => {
  it('fills from random feed pages in an alarm, skipping image servers that are down', async () => {
    mock.route('GET https://hentai-cosplay-xxx.com/search/page/', (request) => new Response(feedPage(request.url.match(/page\/(\d+)/)[1])));
    mock.route('GET https://hentai-cosplay-xxx.com/search/', () => new Response(feedPage(1)));
    mock.route(`GET https://${LIVE}/`, (request) => {
      expect(request.headers.get('range')).toBe('bytes=0-4095');
      expect(request.headers.get('referer')).toBe('https://hentai-cosplay-xxx.com/');
      return image('image/jpeg', 4_096);
    });
    mock.route(`GET https://${DEAD}/`, () => new Response('error code: 502', { status: 502 }));
    const stub = env.COSPLAY_POOL.getByName('fill');

    expect(await stub.take()).toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const status = await stub.status();
    expect(status.size).toBeGreaterThanOrEqual(3);
    expect(status.size).toBeLessThanOrEqual(12);
    expect(status.deadHosts).toEqual([DEAD]);
    expect(status.ceiling).toBe(500);
    // Each page needs one feed request and at most one check per image server.
    expect(mock.callsTo('GET https://hentai-cosplay-xxx.com/search/page/').length).toBeLessThanOrEqual(4);
    expect(mock.callsTo(`GET https://${DEAD}/`)).toHaveLength(1);

    const taken = await stub.take();
    expect(new URL(taken.url).hostname).toBe(LIVE);
    expect(taken.url).not.toMatch(/p=160x200/);
    await clearAlarm(stub);
  });

  it('hands out each link once, keeps them across restarts, and drops a dead server', async () => {
    const stub = env.COSPLAY_POOL.getByName('serve');
    const seeded = [link(LIVE, 3, 0), link(LIVE, 3, 1), link('static2.hentai-cosplay-xxx.com', 9, 0), link('static2.hentai-cosplay-xxx.com', 9, 1)];
    await runInDurableObject(stub, (_instance, state) => state.storage.put({ links: seeded, deadHosts: {}, ceiling: null }));
    await evictDurableObject(stub);

    const first = await stub.take();
    const second = await stub.take();
    expect(seeded.map((entry) => entry.url)).toContain(first.url);
    expect(second.url).not.toBe(first.url);

    await stub.reportDeadHost('https://static2.hentai-cosplay-xxx.com/upload/2026/9/0.jpg');
    const status = await stub.status();
    expect(status.deadHosts).toEqual(['static2.hentai-cosplay-xxx.com']);
    const remaining = await runInDurableObject(stub, (instance) => instance.links);
    expect(remaining.every((entry) => !entry.url.includes('static2'))).toBe(true);
    expect(status.size).toBe(remaining.length);
    await clearAlarm(stub);
  });

  it('schedules a later retry when the site cannot be read', async () => {
    mock.route('GET https://hentai-cosplay-xxx.com/search/', () => new Response('origin down', { status: 503 }));
    const stub = env.COSPLAY_POOL.getByName('retry');
    await stub.take();
    const startedAt = Date.now();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const next = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
    expect(next - startedAt).toBeGreaterThan(50_000);
    expect((await stub.status()).size).toBe(0);
    await clearAlarm(stub);
  });
});
