import { openOptionSheet } from './sheet.js';
import { TEXT } from './text.js';

// The sort picker: every order the provider offers, in its groups.
export function openSortSheet({ provider, current, onPick, requestClose }) {
  return openOptionSheet({
    label: TEXT.sort,
    groups: provider.sortGroups.map((group) => ({ label: group.label, options: group.sorts.map((sort) => ({ value: sort, label: provider.sortLabels[sort] })) })),
    current,
    onPick,
    requestClose,
  });
}
