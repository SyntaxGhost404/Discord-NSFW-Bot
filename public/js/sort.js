import { h } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { SORT_GROUPS, SORT_LABELS, TEXT } from './text.js';

// The sort picker: every order the source site offers, grouped by albums
// and videos.
export function openSortSheet({ current, onPick, requestClose }) {
  const groups = SORT_GROUPS.map((group) => h('div', { class: 'option-group', role: 'group', 'aria-label': group.label },
    h('h3', { class: 'option-label' }, group.label),
    group.sorts.map((sort) => {
      const selected = sort === current;
      const option = h('button', { class: 'option sq', type: 'button', 'aria-pressed': String(selected) },
        h('span', {}, SORT_LABELS[sort]),
        selected ? icon('check', 20) : null);
      option.addEventListener('click', () => onPick(sort));
      return option;
    })));
  const sheet = openSheet({ label: TEXT.sort, body: h('div', { class: 'sheet-body' }, groups), requestClose });
  requestAnimationFrame(() => sheet.element.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }));
  return sheet;
}
