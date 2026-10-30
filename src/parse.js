// Turns the source site's HTML into plain data. Only the fields the viewer
// shows are read; the site's scripts, ads, and markup are never passed on,
// and every URL handed to the browser must match one of the patterns below.

// Album images and their resized copies (/p=160x200/, /p=305/).
const ALBUM_IMAGE = /^(https:\/\/static\d*\.hentai-cosplay-xxx\.com\/upload\/\d{8}\/\d+\/\d+\/)(?:p=[0-9x]+\/)?(\d+\.(?:jpe?g|png|gif|webp))$/i;
// Full-size album images only.
const ORIGINAL_IMAGE = /^(https:\/\/static\d*\.hentai-cosplay-xxx\.com\/upload\/\d{8}\/\d+\/\d+\/)(\d+\.(?:jpe?g|png|gif|webp))$/i;
const VIDEO_IMAGE = /^(https:\/\/static\d*\.videos-uploader\.com\/video\/\d{4}\/\d{4}\/[A-Za-z0-9]+\/)(?:p=[0-9x]+\/)?(image-\d+\.(?:jpe?g|png|webp))$/i;
const VIDEO_STREAM = /^https:\/\/video\d*\.videos-uploader\.com\/video\/\d{4}\/\d{4}\/[A-Za-z0-9]+\/[A-Za-z0-9_-]+\.m3u8$/;
const SRC = /\ssrc="([^"]*)"/;
const LIST_HEADING = '<div id="post_list_title">';
const LIST_START = '<ul id="image-list"';
const MAXIMUM_TITLE_LENGTH = 300;

const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (entity, name) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : entity;
  });
}

// Emoji and the invisible characters that build them (joiners, variation
// selectors, skin tones, keycaps, flag letters).
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u200d\ufe0e\ufe0f\u20e3]|[\u{1f1e6}-\u{1f1ff}]/gu;

// En and em dashes and their relatives: figure dash, horizontal bar, minus
// sign, two and three em dashes, and the small and vertical forms.
const DASHES = '\\u2012-\\u2015\\u2212\\u2e3a\\u2e3b\\ufe31\\ufe32\\ufe58';
const SPACED_DASH = new RegExp(`\\s+[-\\ufe63\\uff0d${DASHES}]+\\s+`, 'g');
const DASH = new RegExp(`[${DASHES}]`, 'g');

// Plain text from a fragment of the site's HTML. The interface never shows
// emoji or en and em dashes, so titles drop emoji, a dash or hyphen between
// spaces (separating parts of a title) becomes a middle dot, and any other
// dash becomes a hyphen.
export function cleanText(fragment) {
  return decodeEntities(String(fragment ?? '').replace(/<[^>]*>/g, ' '))
    .replace(EMOJI, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(SPACED_DASH, ' \u00b7 ')
    .replace(DASH, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAXIMUM_TITLE_LENGTH);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : null;
}

function coverFor(kind, source) {
  if (!source) return null;
  if (kind === 'video') {
    const parts = source.match(VIDEO_IMAGE);
    return parts ? { small: `${parts[1]}p=305/${parts[2]}`, large: `${parts[1]}p=700/${parts[2]}` } : null;
  }
  const parts = source.match(ALBUM_IMAGE);
  return parts ? { small: `${parts[1]}p=305/${parts[2]}`, large: `${parts[1]}${parts[2]}` } : null;
}

// The page's main list. Each list on a page follows a title block; the
// sidebar lists' titles link to "Read More", the main list's never do, and a
// search without results has no main list at all.
function mainList(html) {
  for (let at = html.indexOf(LIST_HEADING); at !== -1;) {
    const next = html.indexOf(LIST_HEADING, at + LIST_HEADING.length);
    const headingEnd = html.indexOf('</div>', at);
    const heading = html.slice(at, headingEnd === -1 ? at + 500 : headingEnd);
    if (!/<a\b/i.test(heading)) {
      const start = html.indexOf(LIST_START, at);
      if (start === -1 || (next !== -1 && start > next)) return null;
      const end = html.indexOf('</ul>', start);
      const count = heading.match(/class="immoral_all_items">\s*([\d,]+)/);
      return { html: html.slice(start, end === -1 ? undefined : end), total: count ? Number(count[1].replace(/,/g, '')) : null };
    }
    at = next;
  }
  return null;
}

export function parseListing(html) {
  const text = String(html);
  const list = mainList(text);
  const items = [];
  const seen = new Set();
  for (const block of list ? list.html.split(/<li\b/).slice(1) : []) {
    const link = block.match(/<a\s[^>]*href="\/(image|video)\/([a-z0-9_-]{1,320})\/"/);
    if (!link) continue;
    const kind = link[1] === 'video' ? 'video' : 'album';
    if (seen.has(`${kind}/${link[2]}`)) continue;
    seen.add(`${kind}/${link[2]}`);
    const image = block.match(/<img\s[^>]*>/)?.[0] ?? '';
    const title = block.match(/class="image-list-item-title"[^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? attribute(image, 'alt') ?? '';
    const date = block.match(/class="image-list-item-regist-date"[^>]*>\s*<span>\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    items.push({
      kind,
      slug: link[2],
      title: cleanText(title) || link[2].replace(/[-_]+/g, ' '),
      date: date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : null,
      cover: coverFor(kind, attribute(image, 'src')),
    });
  }
  return { items, more: /<link rel="next" href="/.test(text), total: list?.total ?? null };
}

// An album's story view: its title on <amp-story>, then one <amp-img> per
// image in order, starting with the cover. Images from other albums are left
// out by keeping only those under the cover's folder.
export function parseStory(html) {
  const text = String(html);
  const storyStart = text.indexOf('<amp-story ');
  if (storyStart === -1) return null;
  const storyEnd = text.indexOf('>', storyStart);
  const story = text.slice(storyStart, storyEnd);
  let base = attribute(story, 'poster-portrait-src')?.match(ORIGINAL_IMAGE)?.[1] ?? null;
  const files = [];
  const seen = new Set();
  for (let at = text.indexOf('<amp-img', storyEnd); at !== -1; at = text.indexOf('<amp-img', at + 8)) {
    const end = text.indexOf('>', at);
    if (end === -1) break;
    const parts = text.slice(at, end).match(SRC)?.[1].match(ORIGINAL_IMAGE);
    if (!parts) continue;
    base ??= parts[1];
    if (parts[1] !== base || seen.has(parts[2])) continue;
    seen.add(parts[2]);
    files.push(parts[2]);
  }
  if (!base || files.length === 0) return null;
  return { title: cleanText(attribute(story, 'title')), base, files };
}

export function parseVideo(html) {
  const text = String(html);
  const sources = text.match(/<source\b[^>]*>/g) ?? [];
  const stream = sources.map((tag) => attribute(tag, 'src')).find((src) => src && VIDEO_STREAM.test(src));
  if (!stream) return null;
  const poster = attribute(text.match(/<video\b[^>]*>/)?.[0] ?? '', 'poster');
  const heading = text.match(/<h1 id="post_title">([\s\S]*?)<\/h1>/)?.[1]
    ?? text.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+-\s+Hentai Cosplay\s*$/i, '');
  return {
    title: cleanText(heading),
    poster: poster && VIDEO_IMAGE.test(poster) ? poster : null,
    stream,
  };
}
