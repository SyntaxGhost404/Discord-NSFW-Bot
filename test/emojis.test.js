import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Emoji, toComponentEmoji, uiText } from '../src/config/emojis.js';
import { button } from '../src/discord/components.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'src');
const emojiConfig = path.join(source, 'config', 'emojis.js');

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? files(absolute) : [absolute];
  });
}

test('all source presentation glyphs live only in the centralized emoji configuration', () => {
  for (const file of files(source)) {
    if (file === emojiConfig) continue;
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /[^\x00-\x7F]/u, `Hardcoded Unicode presentation glyph in ${file}`);
    assert.doesNotMatch(content, /<a?:[A-Za-z0-9_]+:\d+>/u, `Hardcoded custom Discord emoji in ${file}`);
  }
});

test('emoji helpers format UI text and both Discord component emoji forms', () => {
  assert.equal(uiText(Emoji.ui.search, 'Search'), `${Emoji.ui.search} ${Emoji.ui.separator} Search`);
  assert.deepEqual(toComponentEmoji(Emoji.ui.refresh), { name: Emoji.ui.refresh });
  assert.deepEqual(toComponentEmoji('<a:dance:123456789012345678>'), {
    id: '123456789012345678',
    name: 'dance',
    animated: true,
  });
  assert.deepEqual(button({ customId: 'refresh', emoji: Emoji.ui.refresh, style: 2 }), {
    type: 2,
    style: 2,
    disabled: false,
    emoji: { name: Emoji.ui.refresh },
    custom_id: 'refresh',
  });
});
