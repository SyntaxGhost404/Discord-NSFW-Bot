// Static checks for the rules the app promises: no en or em dashes and no
// emoji anywhere, no accent colors from the banned hues, no HTML injection
// APIs or inline scripts, no third-party hosts, and no secrets in the files
// that would be committed. Run with `npm run check`.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

const problems = [];
const report = (file, line, message) => problems.push(`${file}${line ? `:${line}` : ''}: ${message}`);

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2']);
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && existsSync(file));
const texts = files.filter((file) => !BINARY.has(extname(file).toLowerCase()));
const read = (file) => readFileSync(file, 'utf8');

function eachLine(file, pattern, message) {
  read(file).split('\n').forEach((line, index) => {
    const match = line.match(pattern);
    if (match) report(file, index + 1, `${message} (${[...match[0]].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')})`);
  });
}

// En and em dashes and their look-alikes, and emoji, in every text file.
const DASH = /[\u2012-\u2015\u2212\u2e3a\u2e3b\ufe31\ufe32\ufe58]/u;
const EMOJI = /\p{Extended_Pictographic}|[\u{1f1e6}-\u{1f1ff}\ufe0f\u20e3]/u;
for (const file of texts) {
  eachLine(file, DASH, 'en or em dash');
  eachLine(file, EMOJI, 'emoji');
}

// No way for markup to reach the page as HTML.
const UNSAFE = [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write/, /\beval\s*\(/, /\bnew Function\b/, /\bset(?:Timeout|Interval)\(\s*['"`]/];
for (const file of texts.filter((name) => name.startsWith('public/js/'))) {
  read(file).split('\n').forEach((line, index) => {
    for (const pattern of UNSAFE) if (pattern.test(line)) report(file, index + 1, `unsafe DOM API ${pattern}`);
  });
}

// The page loads only its own files: no inline scripts, styles, or handlers.
const page = read('public/index.html');
for (const tag of page.match(/<script\b[^>]*>/g) ?? []) {
  if (!/\ssrc="\/[^/]/.test(tag)) report('public/index.html', 0, `script that is not a local file: ${tag}`);
}
if (/<style\b|\sstyle=|\son[a-z]+=/i.test(page)) report('public/index.html', 0, 'inline style or event handler');
for (const [, url] of page.matchAll(/\s(?:src|href)="([^"]*)"/g)) {
  if (!url.startsWith('/') || url.startsWith('//')) report('public/index.html', 0, `non-local URL ${url}`);
}
const headers = read('public/_headers');
const policy = headers.match(/Content-Security-Policy: (.*)/)?.[1] ?? '';
if (!/script-src 'self'(;|$)/.test(policy) || /unsafe-(inline|eval)/.test(policy)) report('public/_headers', 0, 'the CSP must allow only same-origin scripts');

// The only remote hosts the app may name: the source site, its video host,
// and the SVG namespace.
const HOSTS = /^(?:[a-z0-9-]+\.)*(?:hentai-cosplay-xxx\.com|videos-uploader\.com)$|^www\.w3\.org$/;
for (const file of texts.filter((name) => name.startsWith('public/') || name.startsWith('src/'))) {
  read(file).split('\n').forEach((line, index) => {
    for (const [, host] of line.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      if (!HOSTS.test(host.toLowerCase())) report(file, index + 1, `third-party host ${host}`);
    }
  });
}

// Accent colors: no pink, purple, violet, blue (including cyan), or orange.
// Grays with a faint tint are fine, and so are near-black and near-white.
function hsl(r, g, b) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
const banned = ({ h, s, l }) => s >= 0.2 && l > 0.08 && l < 0.95 && ((h >= 15 && h < 45) || (h >= 175 && h < 345));
const NAMED = /(?:^|[\s:,(])(blue|navy|cyan|aqua|teal|turquoise|indigo|violet|purple|magenta|fuchsia|pink|orchid|plum|lavender|orange|coral|tomato|salmon|chocolate|tan)\b/i;
for (const file of texts.filter((name) => name.startsWith('public/') && /\.(css|svg|html|js|webmanifest)$/.test(name))) {
  read(file).split('\n').forEach((line, index) => {
    for (const [hex] of line.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
      let digits = hex.slice(1);
      if (digits.length === 3 || digits.length === 4) digits = [...digits].map((c) => c + c).join('');
      if (digits.length !== 6 && digits.length !== 8) continue;
      const color = hsl(...[0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)));
      if (banned(color)) report(file, index + 1, `banned accent color ${hex} (hue ${Math.round(color.h)})`);
    }
    for (const [, r, g, b] of line.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) {
      const color = hsl(Number(r), Number(g), Number(b));
      if (banned(color)) report(file, index + 1, `banned accent color rgb(${r}, ${g}, ${b})`);
    }
    if (file.endsWith('.css') && /:/.test(line) && NAMED.test(line.split('/*')[0])) report(file, index + 1, `named color ${line.match(NAMED)[1]}`);
  });
}

// Every module parses.
for (const file of texts.filter((name) => /\.(m?js)$/.test(name))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) report(file, 0, `syntax error\n${result.stderr.trim()}`);
}

// No secrets: local secret files stay untracked, and nothing to be committed
// contains a local secret value or a well-known token shape.
for (const file of files) {
  if (/(^|\/)(\.dev\.vars|\.env)(\.|$)/.test(file)) report(file, 0, 'secret file would be committed');
}
const secrets = [];
for (const name of ['.dev.vars', '.env']) {
  if (!existsSync(name)) continue;
  for (const line of read(name).split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (match && match[2].length >= 12) secrets.push({ name: match[1], value: match[2] });
  }
}
const TOKENS = [
  /[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/,
];
for (const file of texts) {
  const text = read(file);
  for (const { name, value } of secrets) if (text.includes(value)) report(file, 0, `contains the value of ${name}`);
  for (const pattern of TOKENS) if (pattern.test(text)) report(file, 0, `looks like it contains a token (${pattern.source.slice(0, 24)})`);
}

if (problems.length > 0) {
  console.error(`check: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log(`check: ${texts.length} files clean`);
