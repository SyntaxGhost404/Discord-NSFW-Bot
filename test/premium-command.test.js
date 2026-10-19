import assert from 'node:assert/strict';
import test from 'node:test';
import { Emoji } from '../src/config/emojis.js';
import premium, { SUBSCRIBE_URL } from '../src/commands/premium.js';

function recorder() {
  const calls = [];
  return {
    calls,
    async defer() { calls.push({ method: 'defer' }); },
    async deferUpdate() { calls.push({ method: 'deferUpdate' }); },
    async reply(body) { calls.push({ method: 'reply', body }); },
    async editOriginal(body) { calls.push({ method: 'editOriginal', body }); },
  };
}

function snapshot(userId, isPremium) {
  return {
    userId,
    premium: isPremium,
    minuteLimit: isPremium ? null : 60,
    minuteRemaining: isPremium ? null : 29,
    dailyLimit: isPremium ? 5_000 : 1_000,
    dailyRemaining: isPremium ? 4_594 : 594,
  };
}

test('premium command renders the author free plan, usage limits, and paired buttons', async () => {
  const responder = recorder();
  const user = { id: '123456789012345678', username: 'Moin', discriminator: '0', avatar: null };
  await premium.execute({
    responder,
    interaction: { user, data: { options: [] } },
    rateLimiter: { snapshot: (userId) => snapshot(userId, false) },
  });
  const body = responder.calls[1].body;
  assert.equal(body.embeds[0].title, 'Free Plan ($0)');
  assert.match(body.embeds[0].description, /You are currently \*\*NOT\*\* a Premium User/);
  assert.match(body.embeds[0].description, /\*\*Usage Limits\*\*/);
  assert.match(body.embeds[0].description, /Rate Limit: 29 \/ 60 per min/);
  assert.match(body.embeds[0].description, /Daily Cap: 594 \/ 1,000/);
  assert.match(body.embeds[0].description, /5,000 requests per day hard ceiling/);
  assert.match(body.embeds[0].description, /Access to 37 NSFW commands/);
  assert.equal(body.embeds[0].footer.text, 'Moin');
  assert.equal(body.components[0].components[0].url, SUBSCRIBE_URL);
  assert.equal(body.components[0].components[0].style, 5);
  assert.equal(body.components[0].components[0].label, 'Subscribe');
  assert.deepEqual(body.components[0].components[1], {
    type: 2,
    style: 2,
    disabled: false,
    emoji: { name: Emoji.ui.refresh },
    custom_id: `premium:refresh:${user.id}:${user.id}`,
  });
});

test('premium command personalizes another premium user profile', async () => {
  const responder = recorder();
  const author = { id: '123456789012345678', username: 'author' };
  const target = { id: '234567890123456789', username: 'supporter', discriminator: '0', avatar: null };
  await premium.execute({
    responder,
    interaction: {
      user: author,
      data: {
        options: [{ name: 'user', value: target.id }],
        resolved: { users: { [target.id]: target } },
      },
    },
    rateLimiter: { snapshot: (userId) => snapshot(userId, true) },
  });
  const embed = responder.calls[1].body.embeds[0];
  assert.equal(embed.title, 'Premium Plan ($1)');
  assert.match(embed.description, /supporter.*currently a \*\*Premium User\*\*/);
  assert.match(embed.description, /Rate Limit: Unlimited per min/);
  assert.match(embed.description, /Daily Cap: 4,594 \/ 5,000/);
  assert.equal(embed.footer.text, 'supporter');
  assert.equal(responder.calls[1].body.components[0].components[0].label, 'Manage');
});

test('premium refresh updates the original message from the latest quota snapshot', async () => {
  const responder = recorder();
  const user = { id: '123456789012345678', username: 'Moin', discriminator: '0', avatar: null };
  const originalFooter = {
    text: 'Moin',
    icon_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
  };
  await premium.execute({
    source: 'component',
    responder,
    interaction: {
      user,
      message: { embeds: [{ footer: originalFooter }] },
    },
    rateLimiter: { snapshot: (userId) => snapshot(userId, true) },
  }, { customId: `premium:refresh:${user.id}:${user.id}` });

  assert.equal(responder.calls[0].method, 'deferUpdate');
  assert.equal(responder.calls[1].method, 'editOriginal');
  assert.equal(responder.calls.some((call) => call.method === 'defer' || call.method === 'reply'), false);
  const body = responder.calls[1].body;
  assert.equal(body.embeds[0].title, 'Premium Plan ($1)');
  assert.match(body.embeds[0].description, /Rate Limit: Unlimited per min/);
  assert.match(body.embeds[0].description, /Daily Cap: 4,594 \/ 5,000/);
  assert.equal(body.components[0].components[0].label, 'Manage');
  assert.equal(body.components[0].components[1].label, undefined);
  assert.equal(body.components[0].components[1].custom_id, `premium:refresh:${user.id}:${user.id}`);
});
