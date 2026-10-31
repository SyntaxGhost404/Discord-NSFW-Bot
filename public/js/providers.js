import { openOptionSheet } from './sheet.js';
import { TEXT } from './text.js';

// The sites the viewer can show, picked from the header. The first is the
// default and the only one with a Worker behind it so far. The second is a
// placeholder for trying the switcher: it has no source, so the viewer never
// asks anything for it.
export const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'hcx', name: 'Hentai Cosplay', link: 'https://hentai-cosplay-xxx.com/', connected: true }),
  Object.freeze({ id: 'placeholder', name: 'Placeholder', link: null, connected: false }),
]);

export const DEFAULT_PROVIDER = PROVIDERS[0].id;

// Unknown names fall back to the default provider.
export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
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
