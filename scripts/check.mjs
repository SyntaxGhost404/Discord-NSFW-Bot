import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGINAL_COMMIT = '39fe345d362fb860ec2a6968958a65e634af5fa9';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ignoredDirectories = new Set(['.git', '.runtime', 'node_modules']);
const forbiddenBinaryExtensions = new Set([
  '.7z', '.avif', '.class', '.dll', '.dylib', '.exe', '.gif', '.gz', '.jpeg', '.jpg',
  '.mov', '.mp3', '.mp4', '.o', '.obj', '.pdf', '.png', '.pyc', '.pyo', '.rar', '.so',
  '.tar', '.tgz', '.wasm', '.webm', '.webp', '.zip',
]);

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

function git(...arguments_) {
  const result = spawnSync('git', arguments_, {
    cwd: root,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(' ')} failed:\n${result.stderr.toString('utf8')}`);
  }
  return result.stdout;
}

const files = walk(root);
for (const file of files) {
  const extension = path.extname(file).toLowerCase();
  assert.equal(forbiddenBinaryExtensions.has(extension), false, `Binary/media artifact is not allowed: ${file}`);
  const content = fs.readFileSync(path.join(root, file));
  assert.equal(content.includes(0), false, `NUL byte indicates a binary file: ${file}`);
}

const originalFiles = git('ls-tree', '-r', '--name-only', ORIGINAL_COMMIT)
  .toString('utf8')
  .trim()
  .split('\n')
  .filter(Boolean);
for (const file of originalFiles) {
  if (file === 'llms-full.txt') continue;
  const archivedPath = path.join(root, 'archive', 'legacy', file);
  assert.equal(fs.existsSync(archivedPath), true, `Missing archived legacy file: ${file}`);
  assert.deepEqual(fs.readFileSync(archivedPath), git('show', `${ORIGINAL_COMMIT}:${file}`), `Archive mismatch: ${file}`);
}

const trackedFiles = new Set(git('ls-files').toString('utf8').trim().split('\n').filter(Boolean));
assert.equal(trackedFiles.has('llms-full.txt'), false, 'llms-full.txt is a local reference and must not be tracked');

const activeCodeFiles = files.filter((file) =>
  !file.startsWith('archive/') && (file.endsWith('.js') || file.endsWith('.mjs')),
);
for (const file of activeCodeFiles) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(content, /(?:from\s+|require\()['"](?:discord\.js|eris|oceanic\.js)/, `High-level Discord wrapper in ${file}`);
  if (file.startsWith('src/') && file !== 'src/config/emojis.js') {
    assert.doesNotMatch(content, /[^\x00-\x7F]/u, `Presentation glyph outside src/config/emojis.js: ${file}`);
    assert.doesNotMatch(content, /<a?:[A-Za-z0-9_]+:\d+>/u, `Custom Discord emoji outside src/config/emojis.js: ${file}`);
  }
  const syntax = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${file} failed syntax validation:\n${syntax.stderr}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.deepEqual(
  Object.keys(packageJson.dependencies ?? {}),
  ['chalk', 'ws'],
  'Only Chalk styling and the low-level ws transport are allowed as runtime dependencies.',
);

const binaryDiffLines = git('diff', '--numstat', ORIGINAL_COMMIT, '--')
  .toString('utf8')
  .split('\n')
  .filter((line) => line.startsWith('-\t-\t'));
assert.deepEqual(binaryDiffLines, [], `Git detected binary changes:\n${binaryDiffLines.join('\n')}`);

console.log(`Static checks passed: ${files.length} text files, ${activeCodeFiles.length} JavaScript modules, ${originalFiles.length - 1} archived legacy files.`);
