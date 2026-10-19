// Private half of the test key whose public key is DISCORD_PUBLIC_KEY in
// vitest.config.js. It signs requests exactly as Discord does.
const TEST_PRIVATE_JWK = Object.freeze({
  kty: 'OKP',
  crv: 'Ed25519',
  d: 'XIwuUjmVGpU6RMmvX_mse4IR7mhp4PSNDnpRKFjbYUE',
  x: '0Gh-mlmkOafmoMbDSgxWkyJ91HQIrlThr_QBO3QvAaM',
});

export const APPLICATION_ID = '111111111111111111';
export const USER_ID = '222222222222222222';
export const PREMIUM_USER_ID = '999999999999999999';
export const GUILD_ID = '333333333333333333';
export const CHANNEL_ID = '444444444444444444';

let signingKey;
let sequence = 0;

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function testSigningKey() {
  signingKey ??= crypto.subtle.importKey('jwk', TEST_PRIVATE_JWK, { name: 'Ed25519' }, false, ['sign']);
  return signingKey;
}

export async function signedRequest(payload, { path = '/interactions', timestamp, tamper = false, signature } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const stamp = timestamp ?? String(Math.floor(Date.now() / 1_000));
  const signed = signature ?? hex(await crypto.subtle.sign('Ed25519', await testSigningKey(), new TextEncoder().encode(stamp + body)));
  return new Request(`https://bot.example${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': signed,
      'X-Signature-Timestamp': stamp,
    },
    body: tamper ? `${body} ` : body,
  });
}

export function snowflake(timestamp = Date.now()) {
  sequence = (sequence + 1) % 4096;
  return String(((BigInt(timestamp) - 1420070400000n) << 22n) | BigInt(sequence));
}

export function testUser(id = USER_ID) {
  return { id, username: `user${id.slice(-4)}`, global_name: 'Test User', avatar: null, discriminator: '0' };
}

function base({ type, guild = true, nsfw = true, channel, userId = USER_ID, data, message, attachmentSizeLimit }) {
  const user = testUser(userId);
  const interaction = {
    id: snowflake(),
    application_id: APPLICATION_ID,
    type,
    token: `interaction-token-${sequence}`,
    version: 1,
    data,
    locale: 'en-US',
    entitlements: [],
    authorizing_integration_owners: { 0: GUILD_ID },
    attachment_size_limit: attachmentSizeLimit ?? 26_214_400,
  };
  if (guild) {
    interaction.guild_id = GUILD_ID;
    interaction.channel_id = CHANNEL_ID;
    interaction.channel = channel ?? { id: CHANNEL_ID, type: 0, nsfw };
    interaction.member = { user, roles: [], permissions: '0' };
    interaction.context = 0;
  } else {
    interaction.channel_id = CHANNEL_ID;
    interaction.channel = { id: CHANNEL_ID, type: 1 };
    interaction.user = user;
    interaction.context = 1;
  }
  if (message) interaction.message = message;
  return interaction;
}

export function commandInteraction(name, { options = [], resolved, ...rest } = {}) {
  return base({ type: 2, data: { id: snowflake(), name, type: 1, options, ...(resolved ? { resolved } : {}) }, ...rest });
}

export function autocompleteInteraction(name, options, rest = {}) {
  return base({ type: 4, data: { id: snowflake(), name, type: 1, options }, ...rest });
}

export function componentInteraction(customId, { message = { id: snowflake(), embeds: [] }, ...rest } = {}) {
  return base({ type: 3, data: { custom_id: customId, component_type: 2 }, message, ...rest });
}

export function modalInteraction(customId, values, { message = { id: snowflake(), embeds: [] }, ...rest } = {}) {
  return base({
    type: 5,
    data: {
      custom_id: customId,
      components: Object.entries(values).map(([id, value]) => ({
        type: 1,
        components: [{ type: 4, custom_id: id, value }],
      })),
    },
    message,
    ...rest,
  });
}
