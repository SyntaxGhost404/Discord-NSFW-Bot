import { describe, expect, it } from 'vitest';
import { DISCORD_EPOCH, readId, snowflakeParts } from '../public/js/snowflake.js';
import { avatarImage, bannerImage, decorationImage, defaultAvatar, guildBadgeImage, hexColor, otherFields, readFlags, USER_FLAGS } from '../public/js/user.js';

const STILL = '4efa06673cef56db5084059c4698755b';
const ANIMATED = `a_${STILL}`;

describe('snowflakes', () => {
  it('breaks an ID down the way the docs do', () => {
    expect(snowflakeParts('175928847299117063')).toEqual({ timestamp: 1462015105796, worker: 1, process: 0, increment: 7 });
    expect(new Date(snowflakeParts('175928847299117063').timestamp).toISOString()).toBe('2016-04-30T11:18:25.796Z');
    expect(snowflakeParts('0').timestamp).toBe(DISCORD_EPOCH);
  });

  it('reads typed and pasted IDs, and says what is wrong with the rest', () => {
    expect(readId('80351110224678912')).toEqual({ id: '80351110224678912' });
    expect(readId('  80351110 224678912 ')).toEqual({ id: '80351110224678912' });
    expect(readId('<@80351110224678912>')).toEqual({ id: '80351110224678912' });
    expect(readId('<@!80351110224678912>')).toEqual({ id: '80351110224678912' });
    expect(readId('')).toEqual({ error: 'empty' });
    expect(readId('   ')).toEqual({ error: 'empty' });
    expect(readId('abc')).toEqual({ error: 'format' });
    expect(readId('12345')).toEqual({ error: 'format' });
    expect(readId('1'.repeat(21))).toEqual({ error: 'format' });
    expect(readId('99999999999999999999')).toEqual({ error: 'large' });
    const now = Date.UTC(2026, 10, 7);
    const later = ((BigInt(now + 3_600_000) - BigInt(DISCORD_EPOCH)) << 22n).toString();
    expect(readId(later, now)).toEqual({ error: 'future' });
  });
});

describe('flags', () => {
  it('names the documented flags and keeps the rest as unlisted bits', () => {
    expect(readFlags(524288)).toEqual({ named: [{ bit: 19, name: 'BOT_HTTP_INTERACTIONS' }], unlisted: [] });
    expect(readFlags(1 | 64 | (1 << 22))).toEqual({ named: [{ bit: 0, name: 'STAFF' }, { bit: 6, name: 'HYPESQUAD_ONLINE_HOUSE_1' }], unlisted: [22] });
    expect(readFlags(0)).toEqual({ named: [], unlisted: [] });
    expect(readFlags(-1)).toEqual({ named: [], unlisted: [] });
    expect(readFlags(null)).toEqual({ named: [], unlisted: [] });
  });

  it('match the bits in the documentation', () => {
    expect(USER_FLAGS.map(([bit]) => bit)).toEqual([0, 1, 2, 3, 6, 7, 8, 9, 10, 14, 16, 17, 18, 19]);
  });
});

describe('images', () => {
  it('offers every format at the largest size, and animation where there is one', () => {
    const still = avatarImage({ id: '80351110224678912', avatar: STILL });
    expect(still.animated).toBe(false);
    expect(still.files.map((file) => file.url)).toEqual([
      `https://cdn.discordapp.com/avatars/80351110224678912/${STILL}.png?size=4096`,
      `https://cdn.discordapp.com/avatars/80351110224678912/${STILL}.jpg?size=4096`,
      `https://cdn.discordapp.com/avatars/80351110224678912/${STILL}.webp?size=4096`,
    ]);
    expect(still.preview(512)).toBe(`https://cdn.discordapp.com/avatars/80351110224678912/${STILL}.webp?size=512`);
    const animated = bannerImage({ id: '80351110224678912', banner: ANIMATED });
    expect(animated.animated).toBe(true);
    expect(animated.files.slice(-2)).toEqual([
      { format: 'gif', url: `https://cdn.discordapp.com/banners/80351110224678912/${ANIMATED}.gif?size=4096` },
      { format: 'webp', animated: true, url: `https://cdn.discordapp.com/banners/80351110224678912/${ANIMATED}.webp?size=4096&animated=true` },
    ]);
    expect(animated.preview(1024)).toBe(`https://cdn.discordapp.com/banners/80351110224678912/${ANIMATED}.webp?size=1024&animated=true`);
  });

  it('builds decoration and server tag badge addresses from the docs', () => {
    expect(decorationImage({ avatar_decoration_data: { asset: STILL, sku_id: '1144058844004233369' } }).files).toEqual([
      { format: 'png', url: `https://cdn.discordapp.com/avatar-decoration-presets/${STILL}.png?size=4096` },
    ]);
    const badge = guildBadgeImage({ primary_guild: { identity_guild_id: '1234647491267808778', badge: STILL, tag: 'DISC', identity_enabled: true } });
    expect(badge.files[0].url).toBe(`https://cdn.discordapp.com/guild-tag-badges/1234647491267808778/${STILL}.png?size=4096`);
  });

  it('makes no address from a hash or ID that is not one', () => {
    expect(avatarImage({ id: '80351110224678912', avatar: '../../evil' })).toBeNull();
    expect(avatarImage({ id: '80351110224678912', avatar: null })).toBeNull();
    expect(bannerImage({ id: 'nope', banner: STILL })).toBeNull();
    expect(decorationImage({ avatar_decoration_data: null })).toBeNull();
    expect(guildBadgeImage({ primary_guild: { identity_guild_id: null, badge: STILL } })).toBeNull();
  });

  it('picks the default avatar the documented way', () => {
    expect(defaultAvatar({ id: '80351110224678912', discriminator: '0' })).toEqual({ index: 5, url: 'https://cdn.discordapp.com/embed/avatars/5.png' });
    expect(defaultAvatar({ id: '1111111111111111111', discriminator: '1302' }).index).toBe(2);
    expect(defaultAvatar({ id: '643945264868098049', discriminator: '0000' }).index).toBe(0);
  });
});

describe('other values', () => {
  it('writes colors as hex', () => {
    expect(hexColor(16711680)).toBe('#ff0000');
    expect(hexColor(0)).toBe('#000000');
    expect(hexColor(null)).toBeNull();
    expect(hexColor(0x1000000)).toBeNull();
  });

  it('lists the fields the page has no place for', () => {
    const live = { id: '1', username: 'a', avatar: null, discriminator: '0', public_flags: 0, flags: 0, banner: null, accent_color: null, global_name: null, avatar_decoration_data: null, collectibles: null, display_name_styles: null, banner_color: null, clan: null, primary_guild: null };
    expect(otherFields(live)).toEqual(['banner_color', 'clan']);
  });
});
