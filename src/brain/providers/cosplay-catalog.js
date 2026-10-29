// The hentai-cosplay-xxx.com album catalog: every album listed in the site's
// image sitemaps when scripts/build-cosplay-catalog.mjs last ran, stored in
// cosplay-catalog.txt in a compact form that a request can pick from by
// reading a single short line.
//
// After the "#" comment lines comes the index line: the number of albums in
// base 36, a space, then the start of every following line as a 6-character
// base-36 offset from the first of them. Each following line holds up to 32
// albums on one image server:
//
//   <host> <album> <album> ...
//
// Each album is "<days>,<group>,<id>,<runs>". The first album on a line
// gives those numbers in full and every later one gives the base-36
// difference from the album before it (days are counted from 2014-01-01).
// <runs> lists the album's images as "+"-separated runs of
// "[first:]count[type]": first defaults to 1, and the type letter is W
// (webp), P (png), G (gif), E (jpeg), or nothing (jpg). Image n of an album
// is https://<host>.hentai-cosplay-xxx.com/upload/<yyyymmdd>/<group>/<id>/<n>.<ext>.

const SITE = 'hentai-cosplay-xxx.com';
const EPOCH_MS = Date.UTC(2014, 0, 1);
const DAY_MS = 86_400_000;
const IMAGE_URL = /^https:\/\/(static\d*)\.hentai-cosplay-xxx\.com\/upload\/(\d{8})\/(\d+)\/(\d+)\/(\d+)\.(jpg|jpeg|png|gif|webp)$/;
const SITEMAP_IMAGE = /<image:loc>\s*([^<\s]+)\s*<\/image:loc>/g;
const TYPE_LETTER = Object.freeze({ jpg: '', webp: 'W', png: 'P', gif: 'G', jpeg: 'E' });
const LETTER_TYPE = Object.freeze({ '': 'jpg', W: 'webp', P: 'png', G: 'gif', E: 'jpeg' });
const RUN = /^(?:([0-9a-z]+):)?([0-9a-z]+)([WPGE]?)$/;
const HOST = /^static\d*$/;
const ALBUMS_PER_LINE = 32;
const OFFSET_WIDTH = 6;
const MAXIMUM_PICKS = 20;

function daysFromDate(date) {
  return Math.round((Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) - EPOCH_MS) / DAY_MS);
}

function dateFromDays(days) {
  return new Date(EPOCH_MS + days * DAY_MS).toISOString().slice(0, 10).replaceAll('-', '');
}

// Albums in one image sitemap, in order. Only image URLs in the site's usual
// /upload/<date>/<group>/<id>/<n>.<ext> form are kept. The sitemaps list a
// large album as several entries of up to 100 images each; they are merged,
// so every album counts once.
export function albumsFromSitemap(xml) {
  const albums = new Map();
  for (const block of String(xml).split('<url>').slice(1)) {
    let album = null;
    for (const match of block.matchAll(SITEMAP_IMAGE)) {
      const parts = match[1].match(IMAGE_URL);
      if (!parts) continue;
      const [, host, date, group, id, number, extension] = parts;
      const key = `${host}/${date}/${group}/${id}`;
      album ??= albums.get(key);
      if (!album) {
        album = { key, host, date, group: Number(group), id: Number(id), images: new Map() };
        albums.set(key, album);
      }
      if (key === album.key) album.images.set(Number(number), extension);
    }
  }
  return [...albums.values()].map(({ host, date, group, id, images }) => {
    const runs = [];
    for (const [number, extension] of [...images].sort((left, right) => left[0] - right[0])) {
      const last = runs.at(-1);
      if (last && last.extension === extension && number === last.first + last.count) last.count += 1;
      else runs.push({ first: number, count: 1, extension });
    }
    return { host, date, group, id, runs };
  });
}

function encodeRuns(runs) {
  return runs
    .map((run) => `${run.first === 1 ? '' : `${run.first.toString(36)}:`}${run.count.toString(36)}${TYPE_LETTER[run.extension]}`)
    .join('+');
}

// The complete catalog text for a list of albums, with `comment` (lines of
// text) at the top.
export function catalogText(albums, comment = []) {
  const lines = [];
  let line = null;
  let previous = null;
  for (const album of albums) {
    if (!line || line.host !== album.host || line.entries.length === ALBUMS_PER_LINE) {
      line = { host: album.host, entries: [] };
      lines.push(line);
      previous = { days: 0, group: 0, id: 0 };
    }
    const current = { days: daysFromDate(album.date), group: album.group, id: album.id };
    line.entries.push([current.days - previous.days, current.group - previous.group, current.id - previous.id]
      .map((value) => value.toString(36))
      .concat(encodeRuns(album.runs))
      .join(','));
    previous = current;
  }
  const body = lines.map((entry) => `${entry.host} ${entry.entries.join(' ')}`);
  let offset = 0;
  const offsets = body.map((text) => {
    const start = offset.toString(36).padStart(OFFSET_WIDTH, '0');
    offset += text.length + 1;
    return start;
  });
  return [...comment.map((text) => `# ${text}`), `${albums.length.toString(36)} ${offsets.join('')}`, ...body, ''].join('\n');
}

function readIndex(text) {
  let start = 0;
  while (text[start] === '#') {
    const end = text.indexOf('\n', start);
    if (end === -1) return null;
    start = end + 1;
  }
  const space = text.indexOf(' ', start);
  const end = text.indexOf('\n', start);
  if (space === -1 || end === -1 || space > end || (end - space - 1) % OFFSET_WIDTH !== 0) return null;
  const albums = parseInt(text.slice(start, space), 36);
  const lines = (end - space - 1) / OFFSET_WIDTH;
  if (!(albums > 0) || lines === 0) return null;
  const index = { albums, lines, offsets: space + 1, body: end + 1 };
  // Offsets count characters, so a file whose line endings were changed
  // after it was built would point into the middle of lines; it is treated
  // as empty instead.
  const last = lineStart(text, index, lines - 1);
  if (!text.startsWith('static', index.body) || text[last - 1] !== '\n' || !text.startsWith('static', last)) return null;
  return index;
}

function lineStart(text, index, line) {
  const at = index.offsets + line * OFFSET_WIDTH;
  return index.body + parseInt(text.slice(at, at + OFFSET_WIDTH), 36);
}

// The slot-th album on a line, or null when the line has fewer albums.
function albumAt(text, start, slot) {
  let end = text.indexOf('\n', start);
  if (end === -1) end = text.length;
  let cursor = text.indexOf(' ', start);
  if (cursor === -1 || cursor > end) return null;
  const host = text.slice(start, cursor);
  if (!HOST.test(host)) return null;
  let days = 0;
  let group = 0;
  let id = 0;
  for (let position = 0; cursor < end; position += 1) {
    const tokenStart = cursor + 1;
    cursor = text.indexOf(' ', tokenStart);
    if (cursor === -1 || cursor > end) cursor = end;
    const fields = text.slice(tokenStart, cursor).split(',');
    days += parseInt(fields[0], 36);
    group += parseInt(fields[1], 36);
    id += parseInt(fields[2], 36);
    if (position === slot) return { host, days, group, id, runs: fields[3] ?? '' };
  }
  return null;
}

function imageUrl(album, randomInteger) {
  const runs = album.runs.split('+').map((run) => run.match(RUN));
  if (runs.some((run) => !run)) return null;
  const sizes = runs.map((run) => parseInt(run[2], 36));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!(total > 0) || !(album.group > 0) || !(album.id > 0)) return null;
  let offset = randomInteger(0, total - 1);
  let chosen = 0;
  while (offset >= sizes[chosen]) offset -= sizes[chosen++];
  const run = runs[chosen];
  const number = (run[1] ? parseInt(run[1], 36) : 1) + offset;
  return `https://${album.host}.${SITE}/upload/${dateFromDays(album.days)}/${album.group}/${album.id}/${number}.${LETTER_TYPE[run[3]]}`;
}

// Picks a random album, every album equally likely, and a random image in
// it. A pick draws a line and a position on it, drawing again when the line
// is shorter, so it only ever decodes the start of one line.
export function createCosplayCatalog(text = '') {
  const source = String(text);
  let index;
  const catalog = {
    get albums() {
      if (index === undefined) index = readIndex(source);
      return index?.albums ?? 0;
    },
    // `accept(url)` can turn down a pick, for example one on a server that
    // is down. Up to 20 draws are made; returns null when none qualifies.
    pick(randomInteger, accept = () => true) {
      if (catalog.albums === 0) return null;
      for (let attempt = 0; attempt < MAXIMUM_PICKS; attempt += 1) {
        const start = lineStart(source, index, randomInteger(0, index.lines - 1));
        const album = albumAt(source, start, randomInteger(0, ALBUMS_PER_LINE - 1));
        const url = album && imageUrl(album, randomInteger);
        if (url && accept(url)) return { url, album: album.id };
      }
      return null;
    },
  };
  return catalog;
}

export const EMPTY_COSPLAY_CATALOG = createCosplayCatalog('');
