import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ignoredDirectories = new Set(['.git', '.wrangler', 'node_modules']);
const forbiddenBinaryExtensions = new Set([
  '.7z', '.avif', '.class', '.dll', '.dylib', '.exe', '.gif', '.gz', '.jpeg', '.jpg',
  '.mov', '.mp3', '.mp4', '.o', '.obj', '.pdf', '.png', '.pyc', '.pyo', '.rar', '.so',
  '.tar', '.tgz', '.wasm', '.webm', '.webp', '.zip',
]);
const discordWrappers = /(?:from\s+|import\s*\(|require\()\s*['"](?:discord\.js|@discordjs\/[\w-]+|eris|oceanic\.js|discord-interactions|detritus-client|harmony)['"]/;
const botTokenShape = /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}\b/;
// Upstream reference documentation, including Discord's sample token.
const referenceDocuments = new Set(['Cloudflare-Workers.md', 'Discord-Docs-llms-full.txt']);

function walk(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const childRelative = path.posix.join(relative, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, childRelative));
    else files.push(childRelative);
  }
  return files.sort();
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}

const files = walk(root);
const tracked = new Set(git('ls-files').trim().split('\n').filter(Boolean));

for (const file of files) {
  assert.equal(forbiddenBinaryExtensions.has(path.extname(file).toLowerCase()), false, `Binary/media artifact is not allowed: ${file}`);
  if (!tracked.has(file)) continue;
  const content = fs.readFileSync(path.join(root, file));
  assert.equal(content.includes(0), false, `NUL byte indicates a binary file: ${file}`);
  if (!referenceDocuments.has(file)) {
    assert.ok(!botTokenShape.test(content.toString('utf8')), `Something shaped like a Discord bot token is committed in ${file}`);
  }
}

for (const secretFile of ['.dev.vars', '.env']) {
  assert.equal(tracked.has(secretFile), false, `${secretFile} holds local secrets and must not be tracked`);
}
assert.equal(tracked.has('llms-full.txt'), false, 'llms-full.txt is a local reference and must not be tracked');

const codeFiles = files.filter((file) => /\.(?:m?js)$/.test(file));
for (const file of codeFiles) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(content, discordWrappers, `High-level Discord wrapper in ${file}`);
  if (file.startsWith('src/')) {
    // Runtime code stays on web-standard APIs so it behaves the same in
    // workerd, Miniflare, and Node-based tooling.
    assert.doesNotMatch(content, /from\s+['"]node:/, `Node built-in import in Workers runtime code: ${file}`);
    if (file !== 'src/config/emojis.js') {
      assert.doesNotMatch(content, /[^\x00-\x7F]/u, `Presentation glyph outside src/config/emojis.js: ${file}`);
      assert.doesNotMatch(content, /<a?:[A-Za-z0-9_]+:\d+>/u, `Custom Discord emoji outside src/config/emojis.js: ${file}`);
    }
  }
  const syntax = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${file} failed syntax validation:\n${syntax.stderr}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), [], 'The Worker bundle must not depend on runtime packages.');
for (const name of Object.keys(packageJson.devDependencies ?? {})) {
  assert.doesNotMatch(name, /^(?:discord\.js|@discordjs\/|eris$|oceanic\.js$|discord-interactions$)/, `Discord wrapper dependency: ${name}`);
}

const wrangler = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/,(\s*[}\]])/g, '$1'));
const entry = fs.readFileSync(path.join(root, wrangler.main), 'utf8');
for (const binding of wrangler.durable_objects.bindings) {
  assert.match(entry, new RegExp(`export \\{ ${binding.class_name} \\}`), `${wrangler.main} must export Durable Object class ${binding.class_name}`);
  assert.ok(wrangler.migrations.some((migration) => migration.new_sqlite_classes?.includes(binding.class_name)), `${binding.class_name} needs a SQLite migration`);
}

console.log(`Static checks passed: ${files.length} files, ${codeFiles.length} JavaScript modules.`);
