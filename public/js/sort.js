import { openOptionSheet } from './sheet.js';
import { SORT_GROUPS, SORT_LABELS, TEXT } from './text.js';

// The sort picker: every order the source site offers, grouped by albums
// and videos.
export function openSortSheet({ current, onPick, requestClose }) {
  return openOptionSheet({
    label: TEXT.sort,
    groups: SORT_GROUPS.map((group) => ({ label: group.label, options: group.sorts.map((sort) => ({ value: sort, label: SORT_LABELS[sort] })) })),
    current,
    onPick,
    requestClose,
  });
}
