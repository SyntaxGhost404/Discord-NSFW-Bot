// What a Discord user object means, from the field tables and the image
// formatting rules in Discord's documentation. Pure functions, so they can be
// tested on their own.

export const CDN = 'https://cdn.discordapp.com';
// Image size can be any power of two between 16 and 4096.
export const LARGEST_SIZE = 4096;

// The public flags the documentation names. Any other bit that is set is
// shown as an unlisted flag, with its number.
export const USER_FLAGS = Object.freeze([
  [0, 'STAFF'],
  [1, 'PARTNER'],
  [2, 'HYPESQUAD'],
  [3, 'BUG_HUNTER_LEVEL_1'],
  [6, 'HYPESQUAD_ONLINE_HOUSE_1'],
  [7, 'HYPESQUAD_ONLINE_HOUSE_2'],
  [8, 'HYPESQUAD_ONLINE_HOUSE_3'],
  [9, 'PREMIUM_EARLY_SUPPORTER'],
  [10, 'TEAM_PSEUDO_USER'],
  [14, 'BUG_HUNTER_LEVEL_2'],
  [16, 'VERIFIED_BOT'],
  [17, 'VERIFIED_DEVELOPER'],
  [18, 'CERTIFIED_MODERATOR'],
  [19, 'BOT_HTTP_INTERACTIONS'],
]);
const FLAG_NAMES = new Map(USER_FLAGS);

export const PREMIUM_TYPES = Object.freeze({ 0: 'None', 1: 'Nitro Classic', 2: 'Nitro', 3: 'Nitro Basic' });

// Image hashes are 32 hex digits, with a_ in front when animated. Anything
// else is not turned into an address.
const HASH = /^(?:a_)?[0-9a-f]{32}$/;
const SNOWFLAKE = /^\d{15,20}$/;

export const isHash = (value) => typeof value === 'string' && HASH.test(value);

// The named flags and the unlisted bits set in a flags integer.
export function readFlags(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return { named: [], unlisted: [] };
  const named = [];
  const unlisted = [];
  const bits = BigInt(value);
  for (let bit = 0; bits >> BigInt(bit) > 0n; bit += 1) {
    if (((bits >> BigInt(bit)) & 1n) === 0n) continue;
    if (FLAG_NAMES.has(bit)) named.push({ bit, name: FLAG_NAMES.get(bit) });
    else unlisted.push(bit);
  }
  return { named, unlisted };
}

// An image in every format the CDN offers for it, at the largest size. An
// animated one also comes as GIF and as animated WebP, which the docs
// recommend for animation.
function image(path, hash, formats) {
  const animated = hash.startsWith('a_');
  const address = (extension, size, animate = false) => `${CDN}/${path}/${hash}.${extension}?size=${size}${animate ? '&animated=true' : ''}`;
  const files = formats.map((format) => ({ format, url: address(format, LARGEST_SIZE) }));
  if (animated) files.push({ format: 'gif', url: address('gif', LARGEST_SIZE) }, { format: 'webp', animated: true, url: address('webp', LARGEST_SIZE, true) });
  return {
    hash,
    animated,
    files,
    // A smaller copy for the page itself.
    preview: (size) => (animated ? address('webp', size, true) : address(formats.includes('webp') ? 'webp' : formats[0], size)),
  };
}

export function avatarImage(user) {
  return isHash(user?.avatar) && SNOWFLAKE.test(user.id) ? image(`avatars/${user.id}`, user.avatar, ['png', 'jpg', 'webp']) : null;
}

export function bannerImage(user) {
  return isHash(user?.banner) && SNOWFLAKE.test(user.id) ? image(`banners/${user.id}`, user.banner, ['png', 'jpg', 'webp']) : null;
}

export function decorationImage(user) {
  const asset = user?.avatar_decoration_data?.asset;
  return isHash(asset) ? image('avatar-decoration-presets', asset, ['png']) : null;
}

export function guildBadgeImage(user) {
  const guild = user?.primary_guild;
  return guild && SNOWFLAKE.test(guild.identity_guild_id ?? '') && isHash(guild.badge) ? image(`guild-tag-badges/${guild.identity_guild_id}`, guild.badge, ['png', 'jpg', 'webp']) : null;
}

// The avatar Discord shows when there is none: for users on the new username
// system, (user_id >> 22) % 6; on the legacy system, discriminator % 5.
export function defaultAvatar(user) {
  const legacy = typeof user?.discriminator === 'string' && /^\d{1,4}$/.test(user.discriminator) && user.discriminator !== '0';
  const index = legacy ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
  return { index, url: `${CDN}/embed/avatars/${index}.png` };
}

// A color integer as #rrggbb.
export function hexColor(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffff ? `#${value.toString(16).padStart(6, '0')}` : null;
}

// The fields this page lays out on its own; any other field Discord sends is
// listed as it came, so nothing is left out.
export const KNOWN_FIELDS = Object.freeze(new Set([
  'id', 'username', 'discriminator', 'global_name', 'avatar', 'bot', 'system', 'mfa_enabled', 'banner', 'accent_color',
  'locale', 'verified', 'email', 'flags', 'premium_type', 'public_flags', 'avatar_decoration_data', 'collectibles',
  'primary_guild', 'display_name_styles',
]));

export const otherFields = (user) => Object.keys(user ?? {}).filter((key) => !KNOWN_FIELDS.has(key)).sort();
