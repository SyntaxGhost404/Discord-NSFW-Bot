import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { installFetchMock, image, json } from './helpers/fetch-mock.js';
import {
  APPLICATION_ID,
  PREMIUM_USER_ID,
  USER_ID,
  autocompleteInteraction,
  commandInteraction,
  componentInteraction,
  modalInteraction,
  signedRequest,
  snowflake,
  testUser,
} from './helpers/discord.js';

const WEBHOOK_PREFIX = `PATCH https://discord.com/api/v10/webhooks/${APPLICATION_ID}/`;
let mock;

async function send(interaction) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(await signedRequest(interaction), env, ctx);
  const body = await response.json();
  await waitOnExecutionContext(ctx);
  return body;
}

function discordWebhookRoute() {
  mock.route((request) => request.method === 'PATCH' && request.url.startsWith(`https://discord.com/api/v10/webhooks/${APPLICATION_ID}/`), () => json({ id: '1' }));
}

async function lastEdit() {
  const edits = mock.callsTo(WEBHOOK_PREFIX);
  expect(edits.length).toBeGreaterThan(0);
  const { request } = edits.at(-1);
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const form = await request.formData();
    return { payload: JSON.parse(form.get('payload_json')), file: form.get('files[0]'), multipart: true };
  }
  return { payload: await request.json(), multipart: false };
}

// An interaction Discord created `ageMs` ago, which narrows the window for an
// inline reply just as a slow delivery does.
function createdAgo(interaction, ageMs) {
  return { ...interaction, id: snowflake(Date.now() - ageMs) };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function quotaSnapshot(userId = USER_ID) {
  return env.USER_QUOTA.getByName(userId).snapshot({ userId, premium: userId === PREMIUM_USER_ID });
}

beforeEach(() => {
  mock = installFetchMock();
});

afterEach(() => {
  mock.restore();
});

describe('/help', () => {
  it('replies inline with the first directory page', async () => {
    const body = await send(commandInteraction('help', { userId: '777777777777777771' }));
    expect(body.type).toBe(4);
    expect(body.data.embeds[0].description).toContain('`/4k`');
    expect(body.data.embeds[0].footer.text).toBe('Page 1 of 6');
    expect(body.data.components[0].components.map((item) => item.custom_id)).toEqual(['help:page:0', 'help:search:1', 'help:page:2']);
    expect(body.data.components[0].components[0].disabled).toBe(true);
  });

  it('shows command details for the option value', async () => {
    const body = await send(commandInteraction('help', { userId: '777777777777777772', options: [{ name: 'command', type: 3, value: 'solo' }] }));
    expect(body.data.embeds[0].title).toContain('/solo');
    expect(body.data.embeds[0].fields[0].value).toContain('`gender`');
  });

  it('pages, searches, and fuzzy-matches through in-place updates', async () => {
    const page = await send(componentInteraction('help:page:3'));
    expect(page.type).toBe(7);
    expect(page.data.embeds[0].footer.text).toBe('Page 3 of 6');

    const search = await send(componentInteraction('help:search:3'));
    expect(search.type).toBe(9);
    expect(search.data.custom_id).toBe('help:modal:3');
    expect(search.data.components[0].components[0].custom_id).toBe('search_query');

    const result = await send(modalInteraction('help:modal:3', { search_query: 'tentacel' }));
    expect(result.type).toBe(7);
    expect(result.data.embeds[0].title).toContain('/tentacle');
  });

  it('autocompletes visible command names without consuming quota', async () => {
    const body = await send(autocompleteInteraction('help', [{ name: 'command', type: 3, value: 'pu', focused: true }]));
    expect(body).toEqual({
      type: 8,
      data: { choices: [{ name: 'pussy', value: 'pussy' }, { name: 'pussylick', value: 'pussylick' }] },
    });
    expect(mock.calls).toHaveLength(0);
  });
});

describe('media commands', () => {
  it('rejects guild channels that are not age-restricted', async () => {
    const body = await send(commandInteraction('4k', { nsfw: false }));
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.embeds[0].title).toContain('Not an age-restricted channel');
    expect(mock.calls).toHaveLength(0);
  });

  it('trusts threads, which inherit age restriction from their parent channel', async () => {
    mock.route('GET https://nekobot.xyz/api/image?type=4k', () => json({ success: true, message: 'https://i0.nekobot.xyz/t.jpg' }));
    const thread = { id: '444444444444444445', type: 11, parent_id: '444444444444444444' };
    const allowed = await send(commandInteraction('4k', { channel: thread, userId: '555555555555555550' }));
    expect(allowed.type).toBe(4);
    expect(allowed.data.embeds[0].image.url).toBe('https://i0.nekobot.xyz/t.jpg');
    const refused = await send(commandInteraction('4k', { channel: { ...thread, nsfw: false }, userId: '555555555555555550' }));
    expect(refused.data.embeds[0].title).toContain('Not an age-restricted channel');
  });

  it('replies at once with a URL embed and buttons when the provider is quick', async () => {
    mock.route('GET https://nekobot.xyz/api/image?type=4k', (request) => {
      expect(request.headers.get('authorization')).toBe('test-nekobot-authorization');
      return json({ success: true, message: 'https://i0.nekobot.xyz/a/b/c.jpg' });
    });

    const body = await send(commandInteraction('4k', { guild: false, userId: '555555555555555551' }));
    expect(body.type).toBe(4);
    expect(body.data.embeds[0].image.url).toBe('https://i0.nekobot.xyz/a/b/c.jpg');
    expect(body.data.embeds[0].footer.text).toBe('Test User');
    expect(body.data.attachments).toEqual([]);
    const [refresh, link] = body.data.components[0].components;
    expect(refresh.custom_id).toBe('m:4k');
    expect(link).toMatchObject({ style: 5, url: 'https://i0.nekobot.xyz/a/b/c.jpg' });
    expect(mock.callsTo(WEBHOOK_PREFIX)).toHaveLength(0);
    expect((await quotaSnapshot('555555555555555551')).dailyUsed).toBe(1);
  });

  it('acknowledges first and edits the result in when the provider is slow', async () => {
    mock.route('GET https://nekobot.xyz/api/image?type=4k', async () => {
      await delay(700);
      return json({ success: true, message: 'https://i0.nekobot.xyz/slow.jpg' });
    });
    discordWebhookRoute();

    // Created two seconds ago, so the inline window closes before the answer.
    const interaction = createdAgo(commandInteraction('4k', { userId: '555555555555555549' }), 2_000);
    expect(await send(interaction)).toEqual({ type: 5 });
    const { payload, multipart } = await lastEdit();
    expect(multipart).toBe(false);
    expect(payload.embeds[0].image.url).toBe('https://i0.nekobot.xyz/slow.jpg');
    expect(mock.callsTo(WEBHOOK_PREFIX)[0].headers.authorization).toBeUndefined();
    // The request already under way is delivered, not repeated.
    expect(mock.callsTo('GET https://nekobot.xyz/')).toHaveLength(1);
    expect((await quotaSnapshot('555555555555555549')).dailyUsed).toBe(1);
  });

  it('defers a refresh at once when Discord delivers it too late to answer inline', async () => {
    mock.route('GET https://api.purrbot.site/v2/img/nsfw/cum/gif', () => json({ link: 'https://cdn.purrbot.site/nsfw/cum/gif/cum_002.gif', error: false }));
    discordWebhookRoute();
    const interaction = createdAgo(componentInteraction('m:cum', { userId: '555555555555555548' }), 2_500);
    expect(await send(interaction)).toEqual({ type: 6 });
    expect((await lastEdit()).payload.embeds[0].image.url).toBe('https://cdn.purrbot.site/nsfw/cum/gif/cum_002.gif');
  });

  it('re-uploads downloaded media as a native attachment', async () => {
    mock.route('GET https://api.n-sfw.com/nsfw/breeding', () => json({
      name: 'abc.jpg',
      type: 'breeding',
      nsfw: true,
      mime: 'image/jpeg',
      size: 2_048,
      url: 'https://data.n-sfw.com/nsfw/breeding/abc.jpg',
    }));
    mock.route('GET https://data.n-sfw.com/nsfw/breeding/abc.jpg', () => image('image/jpeg'));
    discordWebhookRoute();

    expect(await send(commandInteraction('breeding', { userId: '555555555555555552' }))).toEqual({ type: 5 });
    const { payload, file, multipart } = await lastEdit();
    expect(multipart).toBe(true);
    expect(payload.embeds[0].image.url).toBe('attachment://media.jpg');
    expect(payload.attachments).toEqual([{ id: 0, filename: 'media.jpg' }]);
    expect(file.name).toBe('media.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(file.size).toBe(2_048);
    expect(payload.components[0].components[1].url).toBe('https://data.n-sfw.com/nsfw/breeding/abc.jpg');
  });

  it('acknowledges as soon as a file download starts', async () => {
    let release;
    const released = new Promise((resolve) => {
      release = resolve;
    });
    mock.route('GET https://api.n-sfw.com/nsfw/breeding', () => json({ mime: 'image/jpeg', size: 2_048, url: 'https://data.n-sfw.com/nsfw/breeding/held.jpg' }));
    mock.route('GET https://data.n-sfw.com/nsfw/breeding/held.jpg', async () => {
      await released;
      return image('image/jpeg');
    });
    discordWebhookRoute();

    const request = await signedRequest(commandInteraction('breeding', { userId: '555555555555555546' }));
    const ctx = createExecutionContext();
    const startedAt = Date.now();
    const response = await worker.fetch(request, env, ctx);
    expect(await response.json()).toEqual({ type: 5 });
    // Well before the inline window would have closed.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(mock.callsTo(WEBHOOK_PREFIX)).toHaveLength(0);

    release();
    await waitOnExecutionContext(ctx);
    const { payload, multipart } = await lastEdit();
    expect(multipart).toBe(true);
    expect(payload.embeds[0].image.url).toBe('attachment://media.jpg');
    expect((await quotaSnapshot('555555555555555546')).dailyUsed).toBe(1);
  });

  it('falls back to another source when one provider fails', async () => {
    mock.route('GET https://api.n-sfw.com/nsfw/ecchi', () => new Response('bad gateway', { status: 502 }));
    mock.route('GET https://waifu-im-shim.trinitymoin.workers.dev/', (request) => {
      expect(request.headers.get('authorization')).toBeNull();
      return image('image/jpeg');
    });
    discordWebhookRoute();
    expect(await send(commandInteraction('ecchi', { userId: '555555555555555558' }))).toEqual({ type: 5 });
    const { payload, multipart } = await lastEdit();
    expect(multipart).toBe(true);
    expect(payload.embeds[0].image.url).toBe('attachment://media.jpg');
    expect(payload.components[0].components[1].url).toMatch(/^https:\/\/waifu-im-shim\.trinitymoin\.workers\.dev\/\d+\.(?:gif|jpe?g|png|webp)$/);
    // The archive image comes from the bundled index, without a search.
    expect(mock.callsTo('GET https://waifu-im-shim.trinitymoin.workers.dev/images')).toHaveLength(0);
  });

  it('reports total failure without charging quota, then refreshes with the chosen style', async () => {
    mock.route('GET https://api.n-sfw.com/nsfw/feet', () => new Response('upstream down', { status: 503 }));

    const failed = await send(commandInteraction('feet', { options: [{ name: 'style', type: 3, value: 'Anime' }], userId: '555555555555555553' }));
    expect(failed.type).toBe(4);
    expect(failed.data.embeds[0].title).toContain('Error');
    expect(failed.data.embeds[0].description).toBe('No media source returned a usable result. Please try again.');
    expect((await quotaSnapshot('555555555555555553')).dailyUsed).toBe(0);

    mock.route('GET https://nekobot.xyz/api/image?type=feet', () => json({ success: true, message: 'https://i0.nekobot.xyz/feet.jpg' }));
    const refreshed = await send(componentInteraction('m:feet:style=Real', { userId: '555555555555555553' }));
    expect(refreshed.type).toBe(7);
    expect(refreshed.data.embeds[0].image.url).toBe('https://i0.nekobot.xyz/feet.jpg');
    expect(refreshed.data.components[0].components[0].custom_id).toBe('m:feet:style=Real');
    expect(mock.callsTo(WEBHOOK_PREFIX)).toHaveLength(0);
    expect((await quotaSnapshot('555555555555555553')).dailyUsed).toBe(1);
  });

  it('updates the message in place when a refresh is ready quickly', async () => {
    mock.route('GET https://api.purrbot.site/v2/img/nsfw/cum/gif', () => json({ link: 'https://cdn.purrbot.site/nsfw/cum/gif/cum_001.gif', error: false }));
    const body = await send(componentInteraction('m:cum', { userId: '555555555555555554' }));
    expect(body.type).toBe(7);
    expect(body.data.embeds[0].image.url).toBe('https://cdn.purrbot.site/nsfw/cum/gif/cum_001.gif');
  });

  it('still routes refresh buttons created by the archived bot', async () => {
    mock.route('GET https://nekobot.xyz/api/image?type=anal', () => json({ success: true, message: 'https://i0.nekobot.xyz/anal.jpg' }));
    const body = await send(componentInteraction('refresh_anal_Real', { userId: '555555555555555555' }));
    expect(body.type).toBe(7);
    expect(body.data.components[0].components[0].custom_id).toBe('m:anal:style=Real');
  });

  it('never asks a provider that is switched off', async () => {
    mock.route('GET https://waifu-im-shim.trinitymoin.workers.dev/', () => image('image/jpeg'));
    discordWebhookRoute();
    expect(await send(commandInteraction('waifu', { userId: '555555555555555547' }))).toEqual({ type: 5 });
    expect((await lastEdit()).payload.embeds[0].image.url).toBe('attachment://media.jpg');
    expect(mock.callsTo('GET https://api.waifu.pics/')).toHaveLength(0);
  });

  it('enforces the free minute quota before contacting any provider', async () => {
    const userId = '555555555555555556';
    const stub = env.USER_QUOTA.getByName(userId);
    for (let index = 0; index < 60; index += 1) {
      const { reservationId } = await stub.reserveMedia({ userId });
      await stub.commitMedia({ userId, reservationId });
    }
    const body = await send(commandInteraction('4k', { userId }));
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.embeds[0].description).toContain('<t:');
    expect(mock.calls).toHaveLength(0);
  });

  it('lets Premium users past the minute ceiling', async () => {
    const stub = env.USER_QUOTA.getByName(PREMIUM_USER_ID);
    for (let index = 0; index < 61; index += 1) {
      const { reservationId } = await stub.reserveMedia({ userId: PREMIUM_USER_ID, premium: true });
      await stub.commitMedia({ userId: PREMIUM_USER_ID, reservationId, premium: true });
    }
    mock.route('GET https://nekobot.xyz/api/image?type=4k', () => json({ success: true, message: 'https://i0.nekobot.xyz/4k.jpg' }));
    const body = await send(commandInteraction('4k', { userId: PREMIUM_USER_ID }));
    expect(body.type).toBe(4);
    expect(body.data.embeds[0].image.url).toBe('https://i0.nekobot.xyz/4k.jpg');
    expect((await quotaSnapshot(PREMIUM_USER_ID)).dailyUsed).toBe(62);
  });

  it('applies the requester\'s smaller attachment limit', async () => {
    mock.route('GET https://api.n-sfw.com/nsfw/cages', () => json({
      mime: 'image/jpeg',
      size: 300_000,
      url: 'https://data.n-sfw.com/nsfw/cages/big.jpg',
    }));
    const body = await send(commandInteraction('cages', { attachmentSizeLimit: 200_000, userId: '555555555555555557' }));
    expect(body.type).toBe(4);
    expect(body.data.embeds[0].title).toContain('Error');
    expect(mock.callsTo('GET https://data.n-sfw.com/')).toHaveLength(0);
    expect((await quotaSnapshot('555555555555555557')).dailyUsed).toBe(0);
  });
});

describe('utility commands', () => {
  it('builds the invite link from the configured application ID', async () => {
    const body = await send(commandInteraction('invite', { userId: '666666666666666661' }));
    expect(body.type).toBe(4);
    const url = new URL(body.data.components[0].components[0].url);
    expect(url.searchParams.get('client_id')).toBe(APPLICATION_ID);
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
  });

  it('applies the two-second utility cooldown to free users', async () => {
    const userId = '666666666666666662';
    expect((await send(commandInteraction('invite', { userId }))).type).toBe(4);
    const second = await send(commandInteraction('invite', { userId }));
    expect(second.data.flags).toBe(64);
    expect(second.data.embeds[0].description).toContain('<t:');
  });

  it('answers the mention intro buttons ephemerally', async () => {
    const body = await send(componentInteraction('intro:features'));
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.embeds[0].title).toContain('Core Features');
  });

  it('answers /ping at once with live latency figures', async () => {
    mock.route('GET https://discord.com/api/v10/applications/@me', () => json({ id: APPLICATION_ID, approximate_guild_count: 3 }));
    const body = await send(commandInteraction('ping', { userId: '666666666666666665' }));
    expect(body.type).toBe(4);
    expect(body.data.embeds[0].title).toContain('Latency Overview');
    expect(body.data.embeds[0].fields[1].value).toMatch(/^`\d+ms`$/);
    expect(body.data.components[0].components[0].custom_id).toBe('ping:page:2');

    const specs = await send(componentInteraction('ping:page:2', { userId: '666666666666666665' }));
    expect(specs.type).toBe(7);
    expect(specs.data.embeds[0].fields.find((field) => field.name.includes('Guild Count')).value).toBe('`3`');
    expect(mock.callsTo(WEBHOOK_PREFIX)).toHaveLength(0);
  });

  it('reports Premium status and live usage for another user', async () => {
    const target = testUser(PREMIUM_USER_ID);
    const body = await send(commandInteraction('premium', {
      userId: '666666666666666663',
      options: [{ name: 'user', type: 6, value: PREMIUM_USER_ID }],
      resolved: { users: { [PREMIUM_USER_ID]: target } },
    }));
    expect(body.type).toBe(4);
    expect(body.data.embeds[0].title).toBe('Premium Plan ($1)');
    expect(body.data.embeds[0].description).toContain('Unlimited per min');
    expect(body.data.components[0].components[1].custom_id).toBe(`premium:refresh:${PREMIUM_USER_ID}:666666666666666663`);
    expect(mock.callsTo(WEBHOOK_PREFIX)).toHaveLength(0);
  });

  it('refreshes Premium usage in place', async () => {
    const viewer = '666666666666666664';
    const body = await send(componentInteraction(`premium:refresh:${viewer}:${viewer}`, { userId: viewer }));
    expect(body.type).toBe(7);
    expect(body.data.embeds[0].title).toBe('Free Plan ($0)');
    expect(body.data.embeds[0].description).toContain('60 / 60 per min');
  });
});
