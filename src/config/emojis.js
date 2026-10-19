export const Emoji = Object.freeze({
  ui: Object.freeze({
    add: '➕',
    back: '🔙',
    bullet: '•',
    computer: '💻',
    error: '❌',
    gear: '⚙️',
    globe: '🌐',
    homes: '🏘️',
    hourglass: '⏳',
    link: '📎',
    next: '▶',
    nsfw: '🔞',
    ping: '🏓',
    previous: '◀',
    refresh: '🔄',
    search: '🔍',
    separator: '▸',
    sparkle: '✨',
    tools: '🛠️',
  }),
  custom: Object.freeze({
    check: '<:CY:1071484103762915348>',
  }),
  terminal: Object.freeze({
    boot: '◉',
    debug: '·',
    error: '✖',
    event: '◆',
    info: '●',
    stack: '↳',
    success: '✓',
    warn: '▲',
  }),
});

export function uiText(emoji, text) {
  return `${emoji} ${Emoji.ui.separator} ${text}`;
}

export function toComponentEmoji(emoji) {
  const custom = String(emoji).match(/^<(a?):([A-Za-z0-9_]+):(\d+)>$/);
  if (!custom) return { name: String(emoji) };
  const [, animated, name, id] = custom;
  return {
    id,
    name,
    ...(animated ? { animated: true } : {}),
  };
}
