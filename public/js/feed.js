import { api } from './api.js';
import { clear, h, reducedMotion } from './dom.js';
import { icon } from './icons.js';
import { mark } from './mark.js';
import { day, RANGE_LABELS, RANGED_SORTS, results, SORT_LABELS, TEXT } from './text.js';

// Cover widths per layout: two columns on phones up to five on wide
// screens. The browser picks the 305-pixel copy or the full image from it.
const COVER_SIZES = '(min-width: 1280px) 248px, (min-width: 960px) 24vw, (min-width: 640px) 32vw, 48vw';
// Start loading the next page this far before the end of the list.
const LOOKAHEAD = 1600;
const SKELETONS = 8;
const MAXIMUM_QUERY = 80;

export function readFeedState(search) {
  const params = new URLSearchParams(search);
  const q = (params.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, MAXIMUM_QUERY);
  if (q) return { q, sort: 'recent', range: 'all' };
  const sort = Object.hasOwn(SORT_LABELS, params.get('sort') ?? '') ? params.get('sort') : 'recent';
  const range = RANGED_SORTS.has(sort) && Object.hasOwn(RANGE_LABELS, params.get('range') ?? '') ? params.get('range') : 'all';
  return { q: '', sort, range };
}

export function feedPath(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  else {
    if (state.sort !== 'recent') params.set('sort', state.sort);
    if (state.range !== 'all') params.set('range', state.range);
  }
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export const sameFeed = (a, b) => a.q === b.q && a.sort === b.sort && a.range === b.range;

function cover(item) {
  const frame = h('div', { class: 'cover sq' });
  const fail = () => {
    frame.classList.add('failed');
    frame.append(icon('missing', 26));
  };
  if (item.cover) {
    const image = h('img', {
      src: item.cover.small,
      srcset: `${item.cover.small} 305w, ${item.cover.large} ${item.kind === 'video' ? 604 : 1024}w`,
      sizes: COVER_SIZES,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
      draggable: 'false',
    });
    image.addEventListener('load', () => frame.classList.add('loaded'), { once: true });
    image.addEventListener('error', () => {
      image.remove();
      fail();
    }, { once: true });
    frame.append(image);
  } else {
    fail();
  }
  if (item.kind === 'video') frame.append(h('span', { class: 'badge sq', role: 'img', 'aria-label': TEXT.video }, icon('play', 14)));
  return frame;
}

export function createFeed({ initial, onOpen, onPickSort, onStateChange }) {
  let state = { ...initial };
  let browseState = state.q ? { q: '', sort: 'recent', range: 'all' } : { ...state };
  let searching = Boolean(state.q);
  let list = null;

  const barRow = h('div', { class: 'bar-row' });
  const filters = h('div', { class: 'filters' });
  const grid = h('ul', { class: 'grid' });
  const status = h('div', { class: 'feed-status', 'aria-live': 'polite' });
  const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });
  const element = h('div', { class: 'feed' }, h('header', { class: 'bar feed-bar' }, barRow, filters), h('main', { class: 'feed-main' }, grid, status, sentinel));

  function prefetch(item) {
    (item.kind === 'video' ? api.video(item.slug) : api.album(item.slug)).catch(() => {});
  }

  function card(item) {
    const link = h('a', { class: 'card', href: `/${item.kind}/${item.slug}` },
      cover(item),
      h('span', { class: 'card-title' }, item.title),
      item.date ? h('span', { class: 'card-date' }, day(item.date)) : null);
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onOpen(item, link);
    });
    // Warm the album while the pointer rests on it.
    let timer = null;
    link.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') timer = setTimeout(() => prefetch(item), 150);
    });
    link.addEventListener('pointerleave', () => clearTimeout(timer));
    link.addEventListener('focus', () => prefetch(item));
    return h('li', { class: 'cell' }, link);
  }

  function renderBar() {
    if (searching) {
      const input = h('input', {
        class: 'search-input',
        type: 'search',
        name: 'q',
        value: state.q,
        placeholder: TEXT.searchPlaceholder,
        'aria-label': TEXT.searchPlaceholder,
        enterkeyhint: 'search',
        autocomplete: 'off',
        autocapitalize: 'none',
        spellcheck: 'false',
        maxlength: String(MAXIMUM_QUERY),
      });
      const clearButton = h('button', { class: 'search-clear', type: 'button', 'aria-label': TEXT.clear, hidden: !state.q }, icon('close', 18));
      input.addEventListener('input', () => {
        clearButton.hidden = input.value === '';
      });
      clearButton.addEventListener('click', () => {
        input.value = '';
        clearButton.hidden = true;
        input.focus();
      });
      const form = h('form', { class: 'search-form', role: 'search' },
        h('label', { class: 'search-field sq' }, icon('search', 18), input, clearButton));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const q = input.value.replace(/\s+/g, ' ').trim();
        input.blur();
        if (q) apply({ q, sort: 'recent', range: 'all' });
        else closeSearch();
      });
      const close = h('button', { class: 'btn btn-secondary btn-small sq', type: 'button' }, TEXT.cancel);
      close.addEventListener('click', closeSearch);
      barRow.replaceChildren(form, close);
      if (!state.q) requestAnimationFrame(() => input.focus());
      return;
    }
    const home = h('button', { class: 'wordmark', type: 'button', 'aria-label': TEXT.toTop }, mark(28), h('span', {}, TEXT.app));
    home.addEventListener('click', () => scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));
    const search = h('button', { class: 'icon-btn sq', type: 'button', 'aria-label': TEXT.search }, icon('search'));
    search.addEventListener('click', () => {
      searching = true;
      renderBar();
      renderFilters();
    });
    const sort = h('button', { class: 'icon-btn sq', type: 'button', 'aria-label': TEXT.sort }, icon('sort'));
    sort.addEventListener('click', () => onPickSort(state.sort));
    barRow.replaceChildren(home, h('span', { class: 'spacer' }), search, sort);
  }

  function renderFilters() {
    if (state.q) {
      const label = list?.total != null ? `“${state.q}” · ${results(list.total)}` : `“${state.q}”`;
      filters.replaceChildren(h('p', { class: 'filter-note' }, label));
      return;
    }
    if (searching) {
      filters.replaceChildren();
      return;
    }
    const sortChip = h('button', { class: 'chip chip-select sq', type: 'button', 'aria-haspopup': 'dialog' }, h('span', {}, SORT_LABELS[state.sort]), icon('down', 16));
    sortChip.addEventListener('click', () => onPickSort(state.sort));
    const chips = [sortChip];
    if (RANGED_SORTS.has(state.sort)) {
      for (const range of Object.keys(RANGE_LABELS)) {
        const chip = h('button', { class: 'chip sq', type: 'button', 'aria-pressed': String(range === state.range) }, RANGE_LABELS[range]);
        chip.addEventListener('click', () => {
          if (range !== state.range) apply({ ...state, range });
        });
        chips.push(chip);
      }
    }
    filters.replaceChildren(...chips);
  }

  function renderStatus() {
    if (!list) return;
    if (list.error) {
      const retry = h('button', { class: 'btn btn-secondary btn-small sq', type: 'button' }, icon('retry', 18), TEXT.retry);
      retry.addEventListener('click', () => {
        list.error = false;
        if (list.page === 0) showSkeletons();
        load();
      });
      status.replaceChildren(h('div', { class: 'notice sq' }, h('p', {}, TEXT.loadError), retry));
    } else if (list.loading && list.page > 0) {
      status.replaceChildren(h('div', { class: 'loader', role: 'progressbar', 'aria-label': 'Loading' }, h('span', { class: 'sq' }), h('span', { class: 'sq' }), h('span', { class: 'sq' })));
    } else if (!list.more) {
      status.replaceChildren(h('p', { class: 'end' }, list.count === 0 ? (state.q ? TEXT.noResults : TEXT.empty) : TEXT.end));
    } else {
      status.replaceChildren();
    }
  }

  function showSkeletons() {
    clear(grid);
    for (let index = 0; index < SKELETONS; index += 1) {
      grid.append(h('li', { class: 'cell skeleton-cell', 'aria-hidden': 'true' }, h('div', { class: 'cover sq skeleton' }), h('span', { class: 'skeleton-line sq' }), h('span', { class: 'skeleton-line short sq' })));
    }
  }

  function nearEnd() {
    return sentinel.getBoundingClientRect().top < innerHeight + LOOKAHEAD;
  }

  async function load() {
    if (!list || list.loading || !list.more || list.error) return;
    const current = list;
    current.loading = true;
    renderStatus();
    const page = current.page + 1;
    try {
      const data = state.q
        ? await api.search({ q: state.q, page })
        : await api.feed({ sort: state.sort, range: state.range === 'all' ? null : state.range, page });
      if (current !== list) return;
      if (current.page === 0) clear(grid);
      const fragment = document.createDocumentFragment();
      for (const item of data.items) {
        const key = `${item.kind}/${item.slug}`;
        if (current.seen.has(key)) continue;
        current.seen.add(key);
        fragment.append(card(item));
        current.count += 1;
      }
      grid.append(fragment);
      current.page = page;
      current.total = data.total ?? current.total;
      current.more = Boolean(data.more) && data.items.length > 0;
    } catch {
      if (current !== list) return;
      if (current.page === 0) clear(grid);
      current.error = true;
    }
    current.loading = false;
    renderStatus();
    if (state.q) renderFilters();
    // A tall screen may still show the end of the list.
    if (current.more && !current.error && nearEnd()) requestAnimationFrame(load);
  }

  function apply(next, { silent = false } = {}) {
    state = { ...next };
    if (!state.q) browseState = { ...state };
    searching = Boolean(state.q);
    list = { page: 0, more: true, loading: false, error: false, total: null, count: 0, seen: new Set() };
    renderBar();
    renderFilters();
    showSkeletons();
    renderStatus();
    scrollTo({ top: 0 });
    if (!silent) onStateChange(state);
    load();
  }

  function closeSearch() {
    searching = false;
    if (state.q) apply(browseState);
    else {
      renderBar();
      renderFilters();
    }
  }

  new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) load();
  }, { rootMargin: `0px 0px ${LOOKAHEAD}px 0px` }).observe(sentinel);

  apply(state, { silent: true });

  return {
    element,
    get state() {
      return state;
    },
    apply,
  };
}
