import { h } from './dom.js';
import { ago, dateTime } from './format.js';
import { icon } from './icons.js';
import { snowflakeParts } from './snowflake.js';
import { animatedFile, FIELDS, FILE_LABELS, FLAG_LABELS, NOTICES, SECTIONS, TEXT, unlistedFlag, VALUES, waitHint } from './text.js';
import { avatarImage, bannerImage, decorationImage, defaultAvatar, guildBadgeImage, hexColor, otherFields, PREMIUM_TYPES, readFlags } from './user.js';

// The icon drawn for each documented flag.
const FLAG_ICONS = Object.freeze({
  STAFF: 'staff',
  PARTNER: 'partner',
  HYPESQUAD: 'events',
  BUG_HUNTER_LEVEL_1: 'bug',
  HYPESQUAD_ONLINE_HOUSE_1: 'bravery',
  HYPESQUAD_ONLINE_HOUSE_2: 'brilliance',
  HYPESQUAD_ONLINE_HOUSE_3: 'balance',
  PREMIUM_EARLY_SUPPORTER: 'early',
  TEAM_PSEUDO_USER: 'team',
  BUG_HUNTER_LEVEL_2: 'bugPlus',
  VERIFIED_BOT: 'verified',
  VERIFIED_DEVELOPER: 'developer',
  CERTIFIED_MODERATOR: 'moderator',
  BOT_HTTP_INTERACTIONS: 'http',
});

const OPEN = { target: '_blank', rel: 'noreferrer noopener' };

// A button that copies `text`, and shows a check for a moment once it has.
export function copyButton(text, label, withText = false) {
  const face = (name, words) => [icon(name, 16), withText ? h('span', {}, words) : null];
  const button = h('button', { class: withText ? 'btn btn-small sq' : 'icon-btn small sq', type: 'button', 'aria-label': label }, face('copy', TEXT.copy));
  let timer = null;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    button.replaceChildren(...face('check', TEXT.copied).filter(Boolean));
    clearTimeout(timer);
    timer = setTimeout(() => button.replaceChildren(...face('copy', TEXT.copy).filter(Boolean)), 1500);
  });
  return button;
}

const row = (label, ...value) => h('div', { class: 'row' }, h('dt', {}, label), h('dd', {}, ...value));
// An image row takes the full width, with its label above.
const mediaRow = (label, content) => h('div', { class: 'row media' }, h('dt', {}, label), h('dd', {}, content));
const plain = (text) => h('span', { class: 'value' }, text);
const mono = (text) => h('span', { class: 'value mono' }, text);
const muted = (text) => h('span', { class: 'value muted' }, text);
const copyable = (text, label) => [mono(text), copyButton(text, `${TEXT.copy} ${label}`)];

function panel(title, iconName, rows) {
  return h('section', { class: 'panel sq' }, h('h3', { class: 'panel-title' }, icon(iconName, 16), title), h('dl', { class: 'rows' }, rows));
}

function chip(iconName, label) {
  return h('span', { class: 'chip sq' }, icon(iconName, 16), h('span', {}, label));
}

function swatch(color) {
  const element = h('span', { class: 'swatch sq', role: 'img', 'aria-label': color });
  element.style.backgroundColor = color;
  return element;
}

// Each file of an image is a link to its largest size.
function files(image) {
  return h('div', { class: 'files' }, image.files.map((file) => h('a', { class: 'file sq', href: file.url, ...OPEN },
    file.animated ? animatedFile(FILE_LABELS[file.format]) : FILE_LABELS[file.format], icon('open', 14))));
}

function imageRow(label, image, { wide = false } = {}) {
  if (!image) return row(label, muted(VALUES.none));
  return mediaRow(label, h('div', { class: `image-cell${wide ? ' wide' : ''}` },
    h('a', { class: `thumb sq${wide ? ' wide' : ''}`, href: image.files[0].url, ...OPEN, 'aria-label': label },
      h('img', { src: image.preview(wide ? 1024 : 256), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })),
    h('div', { class: 'image-meta' },
      h('div', { class: 'line' }, ...copyable(image.hash, label)),
      muted(image.animated ? VALUES.animated : VALUES.still),
      files(image))));
}

// expires_at may be null (never), seconds, milliseconds, or a date string.
function expiry(value) {
  if (value === null || value === undefined) return muted(VALUES.never);
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(ms) ? plain(dateTime(ms)) : mono(String(value));
}

function head(user) {
  const banner = bannerImage(user);
  const color = hexColor(user.accent_color);
  const bannerBox = h('div', { class: 'banner' });
  if (color) bannerBox.style.backgroundColor = color;
  if (banner) bannerBox.append(h('img', { src: banner.preview(1024), alt: '', decoding: 'async', referrerpolicy: 'no-referrer' }));
  const avatar = avatarImage(user);
  const legacy = Boolean(user.discriminator) && user.discriminator !== '0';
  const chips = [];
  if (user.system) chips.push(chip('system', VALUES.system));
  if (user.bot) chips.push(chip('bot', VALUES.bot));
  const { named, unlisted } = readFlags(user.public_flags);
  for (const flag of named) chips.push(chip(FLAG_ICONS[flag.name], FLAG_LABELS[flag.name]));
  for (const bit of unlisted) chips.push(chip('flagged', unlistedFlag(bit)));
  const guild = user.primary_guild;
  if (guild?.identity_enabled && guild.tag) {
    const badge = guildBadgeImage(user);
    chips.push(h('span', { class: 'chip sq' },
      badge ? h('img', { class: 'chip-image', src: badge.preview(64), alt: '', referrerpolicy: 'no-referrer' }) : icon('tag', 16),
      h('span', {}, guild.tag)));
  }
  return h('header', { class: 'profile-head sq' },
    bannerBox,
    h('div', { class: 'identity' },
      h('div', { class: 'avatar-frame sq' },
        h('img', { class: 'avatar sq', src: avatar ? avatar.preview(512) : defaultAvatar(user).url, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' })),
      h('div', { class: 'names' },
        h('h2', { class: 'display-name' }, user.global_name || user.username),
        h('p', { class: 'handle' }, legacy ? `${user.username}#${user.discriminator}` : user.username))),
    chips.length > 0 ? h('div', { class: 'chips' }, chips) : null);
}

function account(user, parts) {
  const type = [user.system ? VALUES.system : null, user.bot ? VALUES.bot : null].filter(Boolean).join(', ') || VALUES.user;
  const yesNo = (value) => plain(value ? VALUES.yes : VALUES.no);
  return panel(SECTIONS.account, 'user', [
    row(FIELDS.id, ...copyable(user.id, FIELDS.id)),
    row(FIELDS.username, ...copyable(user.username, FIELDS.username)),
    row(FIELDS.displayName, user.global_name ? plain(user.global_name) : muted(VALUES.notSet)),
    row(FIELDS.discriminator, user.discriminator && user.discriminator !== '0' ? mono(user.discriminator) : muted(VALUES.newUsername)),
    row(FIELDS.type, plain(type)),
    row(FIELDS.created, h('span', { class: 'stack' }, plain(dateTime(parts.timestamp)), muted(ago(parts.timestamp)))),
    // Only sent with the right OAuth2 scopes; shown whenever Discord sends them.
    'mfa_enabled' in user ? row(FIELDS.mfa, yesNo(user.mfa_enabled)) : null,
    user.locale ? row(FIELDS.locale, mono(user.locale)) : null,
    'verified' in user ? row(FIELDS.verified, yesNo(user.verified)) : null,
    user.email ? row(FIELDS.email, ...copyable(user.email, FIELDS.email)) : null,
    'premium_type' in user ? row(FIELDS.premium, plain(PREMIUM_TYPES[user.premium_type] ?? String(user.premium_type))) : null,
  ]);
}

function snowflake(parts) {
  return panel(SECTIONS.snowflake, 'hash', [
    row(FIELDS.timestamp, ...copyable(String(parts.timestamp), FIELDS.timestamp)),
    row(FIELDS.worker, mono(String(parts.worker))),
    row(FIELDS.process, mono(String(parts.process))),
    row(FIELDS.increment, mono(String(parts.increment))),
  ]);
}

function images(user) {
  const color = hexColor(user.accent_color);
  const fallback = defaultAvatar(user);
  return panel(SECTIONS.images, 'image', [
    imageRow(FIELDS.avatar, avatarImage(user)),
    imageRow(FIELDS.banner, bannerImage(user), { wide: true }),
    row(FIELDS.bannerColor, ...(color ? [swatch(color), ...copyable(color, FIELDS.bannerColor)] : [muted(VALUES.none)])),
    mediaRow(FIELDS.defaultAvatar, h('div', { class: 'image-cell' },
      h('a', { class: 'thumb sq', href: fallback.url, ...OPEN, 'aria-label': FIELDS.defaultAvatar },
        h('img', { src: fallback.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })),
      h('div', { class: 'image-meta' },
        plain(VALUES.index(fallback.index)),
        h('div', { class: 'files' }, h('a', { class: 'file sq', href: fallback.url, ...OPEN }, FILE_LABELS.png, icon('open', 14)))))),
  ]);
}

function collectibles(user) {
  const decoration = user.avatar_decoration_data;
  const plate = user.collectibles?.nameplate;
  const rows = [];
  if (decoration) {
    rows.push(imageRow(FIELDS.decoration, decorationImage(user)));
    if (decoration.sku_id) rows.push(row(FIELDS.sku, ...copyable(decoration.sku_id, `${FIELDS.decoration} ${FIELDS.sku}`)));
    if ('expires_at' in decoration) rows.push(row(FIELDS.expires, expiry(decoration.expires_at)));
  } else {
    rows.push(row(FIELDS.decoration, muted(VALUES.none)));
  }
  if (plate) {
    rows.push(row(FIELDS.nameplate, ...copyable(String(plate.asset ?? ''), FIELDS.nameplate)));
    if (plate.sku_id) rows.push(row(FIELDS.sku, ...copyable(plate.sku_id, `${FIELDS.nameplate} ${FIELDS.sku}`)));
    if (plate.palette) rows.push(row(FIELDS.palette, mono(plate.palette)));
    if (plate.label) rows.push(row(FIELDS.label, mono(plate.label)));
    if ('expires_at' in plate) rows.push(row(FIELDS.expires, expiry(plate.expires_at)));
  } else {
    rows.push(row(FIELDS.nameplate, muted(VALUES.none)));
  }
  return panel(SECTIONS.collectibles, 'sparkle', rows);
}

function serverTag(user) {
  const guild = user.primary_guild;
  if (!guild) return panel(SECTIONS.tag, 'tag', [row(FIELDS.tagText, muted(VALUES.none))]);
  const shown = guild.identity_enabled === true ? VALUES.yes : guild.identity_enabled === false ? VALUES.no : VALUES.unknown;
  return panel(SECTIONS.tag, 'tag', [
    row(FIELDS.tagText, guild.tag ? mono(guild.tag) : muted(VALUES.none)),
    row(FIELDS.shown, plain(shown)),
    row(FIELDS.server, ...(guild.identity_guild_id ? copyable(guild.identity_guild_id, FIELDS.server) : [muted(VALUES.none)])),
    imageRow(FIELDS.badge, guildBadgeImage(user)),
  ]);
}

function nameStyle(user) {
  const style = user.display_name_styles;
  if (!style) return panel(SECTIONS.style, 'type', [row(FIELDS.style, muted(VALUES.none))]);
  const colors = Array.isArray(style.colors) ? style.colors.map(hexColor).filter(Boolean) : [];
  return panel(SECTIONS.style, 'type', [
    row(FIELDS.font, 'font_id' in style ? mono(String(style.font_id)) : muted(VALUES.none)),
    row(FIELDS.effect, 'effect_id' in style ? mono(String(style.effect_id)) : muted(VALUES.none)),
    row(FIELDS.colors, ...(colors.length > 0 ? colors.map((color) => h('span', { class: 'line' }, swatch(color), mono(color))) : [muted(VALUES.none)])),
  ]);
}

function flagList(value) {
  const { named, unlisted } = readFlags(value);
  const items = [...named.map((flag) => `${FLAG_LABELS[flag.name]} (1 << ${flag.bit})`), ...unlisted.map(unlistedFlag)];
  return items.length > 0 ? h('ul', { class: 'flag-list' }, items.map((item) => h('li', {}, item))) : muted(VALUES.none);
}

function flags(user) {
  const rows = [row(FIELDS.publicFlags, h('span', { class: 'stack' }, mono(String(user.public_flags ?? 0)), flagList(user.public_flags)))];
  if ('flags' in user) {
    const same = user.flags === user.public_flags;
    rows.push(row(FIELDS.flags, h('span', { class: 'stack' }, mono(String(user.flags)), same ? muted(VALUES.sameAsPublic) : flagList(user.flags))));
  }
  return panel(SECTIONS.flags, 'flagged', rows);
}

// Fields Discord sends that this page has no place for, as they came.
function other(user) {
  const keys = otherFields(user);
  if (keys.length === 0) return null;
  return panel(SECTIONS.other, 'braces', keys.map((key) => {
    const value = user[key];
    return row(key, value === null ? muted('null') : mono(typeof value === 'string' ? value : JSON.stringify(value)));
  }));
}

function raw(user) {
  const text = JSON.stringify(user, null, 2);
  return h('details', { class: 'panel raw sq' },
    h('summary', { class: 'panel-title' }, icon('braces', 16), TEXT.rawJson, h('span', { class: 'spacer' }), icon('chevron', 16)),
    h('div', { class: 'raw-body' },
      h('pre', { class: 'code sq' }, h('code', {}, text)),
      copyButton(text, `${TEXT.copy} ${TEXT.rawJson}`, true)));
}

export function renderProfile({ user, fetched_at: fetchedAt }) {
  const parts = snowflakeParts(user.id);
  const when = Date.parse(fetchedAt ?? '');
  return h('article', { class: 'profile' },
    head(user),
    account(user, parts),
    snowflake(parts),
    images(user),
    collectibles(user),
    serverTag(user),
    nameStyle(user),
    flags(user),
    other(user),
    raw(user),
    Number.isFinite(when) ? h('p', { class: 'fetched' }, TEXT.fetched(ago(when))) : null);
}

export function renderSkeleton() {
  return h('div', { class: 'profile skeleton', role: 'progressbar', 'aria-label': TEXT.loading },
    h('div', { class: 'profile-head sq' }, h('div', { class: 'banner' }),
      h('div', { class: 'identity' }, h('div', { class: 'avatar-frame sq' }, h('div', { class: 'avatar sq block' })),
        h('div', { class: 'names' }, h('div', { class: 'line-block sq' }), h('div', { class: 'line-block short sq' })))),
    h('div', { class: 'panel sq block tall' }),
    h('div', { class: 'panel sq block' }));
}

// What went wrong, with a Try again button where that can help.
export function renderNotice(code, { retryAfter = null, onRetry = null } = {}) {
  const notice = NOTICES[code] ?? NOTICES.server;
  const hint = retryAfter && notice.retry ? waitHint(retryAfter) : notice.hint;
  const retry = notice.retry && onRetry ? h('button', { class: 'btn btn-small sq', type: 'button' }, icon('retry', 16), h('span', {}, TEXT.retry)) : null;
  retry?.addEventListener('click', onRetry);
  return h('div', { class: 'notice sq', role: 'alert' }, icon('alert', 20), h('div', { class: 'notice-text' },
    h('p', { class: 'notice-title' }, notice.title),
    h('p', { class: 'notice-hint' }, hint),
    retry));
}
