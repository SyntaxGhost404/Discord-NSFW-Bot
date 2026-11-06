import { openOptionSheet } from './sheet.js';
import {
  RANGE_LABELS,
  RANGE_PHRASES,
  RANGED_SORTS,
  SORT_GROUPS,
  SORT_LABELS,
  TEXT,
  XH_RANGE_LABELS,
  XH_RANGE_PHRASES,
  XH_RANGED_SORTS,
  XH_SORT_GROUPS,
  XH_SORT_LABELS,
} from './text.js';

// The sites the viewer can show, picked from the header. Each has its own
// routes on the Worker (`api`) and its own sorts and ranges. The addresses
// of its albums start with `path`, empty for the default provider, so links
// from before there were providers still work.
export const PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'hcx',
    name: 'Hentai Cosplay',
    link: 'https://hentai-cosplay-xxx.com/',
    api: '/api',
    path: '',
    sortGroups: SORT_GROUPS,
    sortLabels: SORT_LABELS,
    defaultSort: 'recent',
    rangedSorts: RANGED_SORTS,
    rangeLabels: RANGE_LABELS,
    rangePhrases: RANGE_PHRASES,
    videos: true,
  }),
  Object.freeze({
    id: 'xh',
    name: 'xHamster',
    link: 'https://xhamster.com/',
    api: '/api/xh',
    path: '/xh',
    sortGroups: XH_SORT_GROUPS,
    sortLabels: XH_SORT_LABELS,
    defaultSort: 'best',
    rangedSorts: XH_RANGED_SORTS,
    rangeLabels: XH_RANGE_LABELS,
    rangePhrases: XH_RANGE_PHRASES,
    videos: false,
  }),
]);

export const DEFAULT_PROVIDER = PROVIDERS[0].id;

// Unknown names fall back to the default provider.
export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}

// The provider whose album addresses start with `path` ("/xh"), if any.
export function providerByPath(path) {
  return PROVIDERS.find((provider) => provider.path !== '' && provider.path === path) ?? null;
}

// The header names a provider by its address, the way a browser shows it,
// or by its name when it has no address.
export function providerTitle(provider) {
  return provider.link ? new URL(provider.link).host : provider.name;
}

// The provider picker: the same sheet as the sort picker.
export function openProviderSheet({ current, onPick, requestClose }) {
  return openOptionSheet({
    label: TEXT.provider,
    groups: [{ options: PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name })) }],
    current,
    onPick,
    requestClose,
  });
}
