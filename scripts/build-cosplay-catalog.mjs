#!/usr/bin/env node
// Builds src/brain/providers/cosplay-catalog.txt, the list of every album in
// hentai-cosplay-xxx.com's image sitemaps, so /cosplay can pick from the
// whole site without reading a sitemap while the user waits. Only the
// sitemap listings are read (about 180 MB of gzip for ~700 files); no image
// is downloaded. Rebuild it from time to time to include new albums.
//
//   node scripts/build-cosplay-catalog.mjs [--cache <directory>] [--concurrency <n>]
//
// --cache keeps the downloaded sitemaps in a directory outside the
// repository for a day, so an interrupted run can resume without fetching
// them again; older copies are fetched afresh.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { albumsFromSitemap, catalogText } from '../src/brain/providers/cosplay-catalog.js';

const ORIGIN = 'https://hentai-cosplay-xxx.com';
const INDEX_URL = `${ORIGIN}/sitemap_index_images_detail.xml`;
const OUTPUT = fileURLToPath(new URL('../src/brain/providers/cosplay-catalog.txt', import.meta.url));
const HEADERS = Object.freeze({
  Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
});
const ATTEMPTS = 4;
const CACHE_MS = 24 * 60 * 60 * 1_000;

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

const cache = option('--cache', null);
const concurrency = Math.max(1, Number(option('--concurrency', 4)) || 4);
if (cache) mkdirSync(cache, { recursive: true });

// Network errors, 5xx, 429, and 404 are retried with backoff: the site's edge
// cache has been seen to answer 404 for a moment while it revalidates a file.
// Other statuses fail at once.
async function download(url) {
  for (let attempt = 1; ; attempt += 1) {
    let retryable = true;
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      retryable = response.status >= 500 || response.status === 429 || response.status === 404;
      throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { status: response.status });
    } catch (error) {
      if (!retryable || attempt >= ATTEMPTS) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
  }
}

async function sitemap(file) {
  const name = `sitemap_images_detail_${file}.xml.gz`;
  const cached = cache && path.join(cache, name);
  if (cached && existsSync(cached) && Date.now() - statSync(cached).mtimeMs < CACHE_MS) {
    try {
      return gunzipSync(readFileSync(cached)).toString('utf8');
    } catch {
      // A truncated download is fetched again.
    }
  }
  const bytes = await download(`${ORIGIN}/${name}`);
  const xml = gunzipSync(bytes).toString('utf8');
  if (cached) writeFileSync(cached, bytes);
  return xml;
}

const index = (await download(INDEX_URL)).toString('utf8');
const files = [...new Set([...index.matchAll(/sitemap_images_detail_(\d+)\.xml\.gz/g)].map((match) => Number(match[1])))]
  .sort((left, right) => left - right);
if (files.length === 0) throw new Error(`${INDEX_URL} lists no image sitemaps.`);
console.log(`Reading ${files.length} image sitemaps (${concurrency} at a time)...`);

const results = new Map();
const failures = [];
// Listed in the index but still missing after the retries; nothing can read
// these, so they are left out rather than blocking the build.
const missing = [];
let next = 0;
let done = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    try {
      const albums = albumsFromSitemap(await sitemap(file));
      results.set(file, albums);
    } catch (error) {
      if (error.status === 404) missing.push(file);
      else failures.push(`${file}: ${error.message}`);
    }
    done += 1;
    if (done % 50 === 0 || done === files.length) console.log(`  ${done}/${files.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

if (failures.length > 0) {
  console.error(`Could not read ${failures.length} sitemap(s), so the catalog was not changed:\n  ${failures.join('\n  ')}`);
  console.error('Run the command again; with --cache, files already read are not fetched twice.');
  process.exit(1);
}

if (missing.length > 0) {
  console.warn(`Left out ${missing.length} sitemap(s) that the index lists but the site does not serve: ${missing.sort((left, right) => left - right).join(', ')}.`);
}

const albums = files.flatMap((file) => results.get(file) ?? []);
const images = albums.reduce((sum, album) => sum + album.runs.reduce((total, run) => total + run.count, 0), 0);
const summary = `${albums.length.toLocaleString('en-US')} albums, ${images.toLocaleString('en-US')} images`;
writeFileSync(OUTPUT, catalogText(albums, [
  'hentai-cosplay-xxx.com album catalog, generated by scripts/build-cosplay-catalog.mjs',
  `on ${new Date().toISOString().slice(0, 10)} from ${results.size} image sitemaps: ${summary}.`,
  'Do not edit by hand; rebuild it to include new albums. The format is',
  'described in src/brain/providers/cosplay-catalog.js.',
]));
console.log(`Wrote ${summary} from ${results.size} sitemaps to ${OUTPUT}.`);
