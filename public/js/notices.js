import { h } from './dom.js';
import { icon } from './icons.js';
import { NOTICE, RANGE_PHRASES, TEXT } from './text.js';

// Turns what came back into what to say. A notice has a title (what
// happened, as far as the viewer can tell), a hint (what to do about it),
// and `retry`, set only where trying again can help.

const RETRYABLE = new Set(['offline', 'network', 'timeout', 'unreachable', 'blocked', 'upstream', 'moved', 'busy', 'server', 'unreadable']);
const VIDEO_SORTS = new Set(['videos', 'popular-videos']);

const words = (query) => query.trim().split(/\s+/).filter(Boolean).length;
// Searches the site cannot match: no letters or digits at all.
export const searchable = (query) => /[\p{L}\p{N}]/u.test(query);

// A request that failed. `subject` is 'list', 'album', or 'video'.
export function problem(error, subject = 'list') {
  const code = typeof error?.code === 'string' ? error.code : 'server';
  if (code === 'not_found' && NOTICE.gone[subject]) return { ...NOTICE.gone[subject], retry: false };
  if (code.startsWith('bad_')) return { ...NOTICE.invalid, retry: false };
  // A failure the viewer has no name for may well pass: offer to try again.
  if (!NOTICE.errors[code]) return { ...NOTICE.errors.server, retry: true };
  return { ...NOTICE.errors[code], retry: RETRYABLE.has(code) };
}

function searchHint(query) {
  if (/^[a-z0-9]$/i.test(query.trim())) return NOTICE.search.longer;
  if (/[^\p{L}\p{N}\s'.:/&-]/u.test(query)) return NOTICE.search.symbols;
  return words(query) > 1 ? NOTICE.search.fewer : NOTICE.search.spelling;
}

// A list that came back without albums, in the context it was asked in:
// { q } for a search, { sort, range } for a sort.
export function listOutcome(state, { q = '', sort = 'recent', range = 'all' } = {}) {
  if (state === 'unreadable') return { ...NOTICE.errors.unreadable, retry: true };
  if (q) {
    if (state === 'nothing') return { ...NOTICE.search.nothing, retry: false };
    if (state === 'refused') return { title: NOTICE.search.refused(q), hint: words(q) > 1 ? NOTICE.search.fewerOrDifferent : NOTICE.search.different, retry: false };
    return { title: NOTICE.search.empty(q), hint: searchHint(q), retry: false };
  }
  if (state === 'missing') return { ...NOTICE.feed.missing, retry: true };
  if (RANGE_PHRASES[range]) return { title: NOTICE.feed.ranged(RANGE_PHRASES[range]), hint: NOTICE.feed.longerRange, retry: false };
  return { ...(VIDEO_SORTS.has(sort) ? NOTICE.feed.noVideos : NOTICE.feed.empty), retry: false };
}

export function retryButton(onRetry) {
  const button = h('button', { class: 'btn btn-secondary btn-small sq', type: 'button' }, icon('retry', 18), TEXT.retry);
  button.addEventListener('click', onRetry);
  return button;
}

// A notice block, with a Try again button when `onRetry` is given and
// trying again can help.
export function noticeElement({ title, hint, retry = false }, onRetry = null) {
  return h('div', { class: 'notice sq' },
    h('p', { class: 'notice-title' }, title),
    hint ? h('p', { class: 'notice-hint' }, hint) : null,
    retry && onRetry ? retryButton(onRetry) : null);
}

// A slim note above a list or album, for something that affects all of it.
export function banner() {
  const title = h('p', { class: 'notice-title' });
  const hint = h('p', { class: 'notice-hint' });
  const element = h('div', { class: 'banner sq', role: 'status', hidden: true }, icon('info', 18), h('div', {}, title, hint));
  return {
    element,
    show(notice) {
      title.textContent = notice.title;
      hint.textContent = notice.hint ?? '';
      hint.hidden = !notice.hint;
      element.hidden = false;
    },
    hide() {
      element.hidden = true;
    },
  };
}

// Watches whether the site's images load. Several failures and not one
// success means the image server is refusing this browser or network, which
// is worth saying once rather than showing a wall of broken tiles.
export function imageWatch(onChange, threshold) {
  let loaded = 0;
  let failed = 0;
  let failing = false;
  const update = () => {
    const now = loaded === 0 && failed >= threshold;
    if (now !== failing) {
      failing = now;
      onChange(failing);
    }
  };
  return {
    loaded() {
      loaded += 1;
      update();
    },
    failed() {
      failed += 1;
      update();
    },
  };
}

// Runs `retry` once the browser is back online, if it is offline now.
export function whenOnline(retry) {
  if (navigator.onLine !== false) return () => {};
  const listener = () => retry();
  addEventListener('online', listener, { once: true });
  return () => removeEventListener('online', listener);
}
