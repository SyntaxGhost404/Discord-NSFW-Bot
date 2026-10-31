import { api } from './api.js';
import { clear, fitText, h, reducedMotion } from './dom.js';
import { icon } from './icons.js';
import { mark } from './mark.js';
import { banner, imageWatch, listOutcome, noticeElement, problem, searchable, whenOnline } from './notices.js';
import { DEFAULT_PROVIDER, providerById, providerTitle } from './providers.js';
import { day, NOTICE, RANGE_LABELS, RANGED_SORTS, results, SORT_LABELS, TEXT } from './text.js';

// Cover widths per layout: two columns on phones up to five on wide
// screens. The browser picks the 305-pixel copy or the full image from it.
const COVER_SIZES = '(min-width: 1280px) 248px, (min-width: 960px) 24vw, (min-width: 640px) 32vw, 48vw';
// Start loading the next page this far before the end of the list.
const LOOKAHEAD = 1600;
const SKELETONS = 8;
const MAXIMUM_QUERY = 80;
// Covers that fail, with none loading, before the feed says the image server
// is refusing them.
const COVERS_DOWN = 6;
// A list the site sends a few albums at a time loads its pages this far
// apart, rather than in one burst.
const LIMITED_PACE = 350;
// Pages in a row that add nothing new before the list stops (a site that
// repeats a page would otherwise be read forever). Lists the site sends a
// few albums at a time repeat albums between new ones, so they get longer.
const STALE_PAGES = 2;
const LIMITED_STALE_PAGES = 6;
// The provider's name in the header: this size where it fits, smaller on
// narrow screens down to the floor, and cut short with an ellipsis below it.
const TITLE_SIZE = 20;
const TITLE_MIN = 15;

// A provider's first page: its newest albums.
export const homeState = (provider = DEFAULT_PROVIDER) => ({ provider, q: '', sort: 'recent', range: 'all' });

export function readFeedState(search) {
  const params = new URLSearchParams(search);
  const provider = providerById(params.get('provider'));
  // A provider without a source has nothing to sort or search.
  if (!provider.connected) return homeState(provider.id);
  const q = (params.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, MAXIMUM_QUERY);
  if (q) return { provider: provider.id, q, sort: 'recent', range: 'all' };
  const sort = Object.hasOwn(SORT_LABELS, params.get('sort') ?? '') ? params.get('sort') : 'recent';
  const range = RANGED_SORTS.has(sort) && Object.hasOwn(RANGE_LABELS, params.get('range') ?? '') ? params.get('range') : 'all';
  return { provider: provider.id, q: '', sort, range };
}

export function feedPath(state) {
  const params = new URLSearchParams();
  if (state.provider !== DEFAULT_PROVIDER) params.set('provider', state.provider);
  if (state.q) params.set('q', state.q);
  else {
    if (state.sort !== 'recent') params.set('sort', state.sort);
    if (state.range !== 'all') params.set('range', state.range);
  }
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export const sameFeed = (a, b) => a.provider === b.provider && a.q === b.q && a.sort === b.sort && a.range === b.range;

function cover(item, watch) {
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
    image.addEventListener('load', () => {
      frame.classList.add('loaded');
      watch?.loaded();
    }, { once: true });
    // One size can fail where the other works (the site resizes covers on a
    // separate service), so a cover tries the other size once.
    let other = true;
    image.addEventListener('error', () => {
      if (other) {
        other = false;
        const next = image.currentSrc === item.cover.small ? item.cover.large : item.cover.small;
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');
        image.src = next;
        return;
      }
      image.remove();
      fail();
      watch?.failed();
    });
    frame.append(image);
  } else {
    fail();
  }
  if (item.kind === 'video') frame.append(h('span', { class: 'badge sq', role: 'img', 'aria-label': TEXT.video }, icon('play', 14)));
  return frame;
}

export function createFeed({ initial, onOpen, onPickSort, onPickProvider, onStateChange }) {
  let state = { ...initial };
  let browseState = state.q ? homeState(state.provider) : { ...state };
  let searching = Boolean(state.q);
  let list = null;
  const connected = () => providerById(state.provider).connected;

  const barRow = h('div', { class: 'bar-row' });
  const filters = h('div', { class: 'filters' });
  const grid = h('ul', { class: 'grid' });
  const status = h('div', { class: 'feed-status', 'aria-live': 'polite' });
  const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });
  const notes = banner();
  const element = h('div', { class: 'feed' }, h('header', { class: 'bar feed-bar' }, barRow, filters), h('main', { class: 'feed-main' }, notes.element, grid, status, sentinel));

  // The header's controls are made once, so focus can come back to them
  // when a sheet closes. A tap on the provider's name scrolls to the top;
  // the chevron beside it switches providers.
  const title = h('span', { class: 'wordmark-title', id: 'provider-title' });
  const home = h('button', { class: 'wordmark', type: 'button', 'aria-label': TEXT.toTop }, mark(28), title);
  home.addEventListener('click', () => scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));
  const switcher = h('button', { class: 'switcher', type: 'button', 'aria-label': TEXT.switchProvider, 'aria-describedby': 'provider-title', 'aria-haspopup': 'dialog' },
    h('span', { class: 'switcher-face sq' }, icon('down', 16)));
  switcher.addEventListener('click', () => onPickProvider(state.provider));
  const brand = h('div', { class: 'brand' }, home, switcher);
  const searchButton = h('button', { class: 'icon-btn sq', type: 'button', 'aria-label': TEXT.search }, icon('search'));
  searchButton.addEventListener('click', () => {
    searching = true;
    renderBar();
    renderFilters();
  });
  const sortButton = h('button', { class: 'icon-btn sq', type: 'button', 'aria-label': TEXT.sort }, icon('sort'));
  sortButton.addEventListener('click', () => onPickSort(state.sort));

  const fitTitle = () => {
    if (title.isConnected) fitText(title, TITLE_SIZE, TITLE_MIN);
  };
  // A wider or narrower screen leaves a different room for the name.
  new ResizeObserver(fitTitle).observe(barRow);

  function prefetch(item) {
    (item.kind === 'video' ? api.video(item.slug) : api.album(item.slug)).catch(() => {});
  }

  function card(item, watch) {
    const link = h('a', { class: 'card', href: `/${item.kind}/${item.slug}` },
      cover(item, watch),
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
        if (q) apply({ ...homeState(state.provider), q });
        else closeSearch();
      });
      const close = h('button', { class: 'btn btn-secondary btn-small sq', type: 'button' }, TEXT.cancel);
      close.addEventListener('click', closeSearch);
      barRow.replaceChildren(form, close);
      if (!state.q) requestAnimationFrame(() => input.focus());
      return;
    }
    title.textContent = providerTitle(providerById(state.provider));
    barRow.replaceChildren(brand, ...(connected() ? [searchButton, sortButton] : []));
    fitTitle();
  }

  function renderFilters() {
    if (!connected()) {
      filters.replaceChildren();
      return;
    }
    if (state.q) {
      // The site's count, only when it can be trusted.
      const counted = list && !list.outcome && !list.limited && list.total != null;
      const label = counted ? `“${state.q}” · ${results(list.total)}` : `“${state.q}”`;
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

  // Asks for the page that failed or came back unreadable once more.
  function retry() {
    list.error = null;
    list.outcome = null;
    list.more = true;
    if (list.page === 0) showSkeletons();
    load();
  }

  function renderStatus() {
    if (!list) return;
    if (list.error) {
      status.replaceChildren(noticeElement(problem(list.error), retry));
    } else if (list.loading && list.page > 0) {
      status.replaceChildren(h('div', { class: 'loader', role: 'progressbar', 'aria-label': 'Loading' }, h('span', { class: 'sq' }), h('span', { class: 'sq' }), h('span', { class: 'sq' })));
    } else if (list.outcome) {
      status.replaceChildren(noticeElement(listOutcome(list.outcome, state), retry));
    } else if (!list.more) {
      // Stopping because the site kept repeating itself is not the end of
      // the list, and the viewer says so.
      status.replaceChildren(h('p', { class: 'end' }, list.repeating ? NOTICE.feed.repeating : state.q ? TEXT.endOfResults : TEXT.end));
    } else {
      status.replaceChildren();
    }
  }

  // Something that affects the whole list: covers the image server will not
  // send, or a search the site sends a few albums at a time.
  function renderBanner() {
    if (list?.coversDown) notes.show(NOTICE.feed.coversDown);
    else if (list?.limited) notes.show({ title: NOTICE.search.limited });
    else notes.hide();
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
    if (!list || list.loading || !list.more || list.error || list.outcome) return;
    const current = list;
    // A provider with no source behind it: say so without asking anything.
    if (!connected()) {
      clear(grid);
      current.outcome = 'unconnected';
      current.more = false;
      renderStatus();
      return;
    }
    // The site matches only letters and numbers; say so without asking it.
    if (state.q && !searchable(state.q)) {
      clear(grid);
      current.outcome = 'nothing';
      current.more = false;
      renderStatus();
      return;
    }
    current.loading = true;
    renderStatus();
    const page = current.page + 1;
    try {
      const data = state.q
        ? await api.search({ q: state.q, page })
        : await api.feed({ sort: state.sort, range: state.range === 'all' ? null : state.range, page });
      if (current !== list) return;
      if (current.page === 0) clear(grid);
      // Answers cached from before lists had a state are read by their
      // albums.
      const outcome = data.state ?? (data.items?.length > 0 ? 'ok' : page > 1 ? 'end' : 'empty');
      if (outcome === 'ok' || outcome === 'end') {
        const fragment = document.createDocumentFragment();
        const before = current.count;
        for (const item of data.items) {
          const key = `${item.kind}/${item.slug}`;
          if (current.seen.has(key)) continue;
          current.seen.add(key);
          fragment.append(card(item, current.images));
          current.count += 1;
        }
        grid.append(fragment);
        current.page = page;
        current.limited ||= Boolean(data.limited);
        current.total = current.limited ? null : (data.total ?? current.total);
        current.stale = data.items.length > 0 && current.count === before ? current.stale + 1 : 0;
        current.repeating = current.stale >= (current.limited ? LIMITED_STALE_PAGES : STALE_PAGES);
        current.more = outcome === 'ok' && Boolean(data.more) && data.items.length > 0 && !current.repeating;
      } else {
        // Empty, refused, missing, or unreadable: the same page is what a
        // retry asks for, so the page count stays.
        current.outcome = outcome;
        current.more = false;
      }
    } catch (error) {
      if (current !== list) return;
      if (current.page === 0) clear(grid);
      current.error = error;
      if (error.code === 'offline') {
        whenOnline(() => {
          if (list === current && current.error?.code === 'offline') retry();
        });
      }
    }
    current.loading = false;
    renderStatus();
    renderBanner();
    if (state.q) renderFilters();
    // A tall screen may still show the end of the list.
    if (current.more && nearEnd()) {
      if (current.limited) setTimeout(() => list === current && load(), LIMITED_PACE);
      else requestAnimationFrame(load);
    }
  }

  function apply(next, { silent = false } = {}) {
    state = { ...next };
    if (!state.q) browseState = { ...state };
    searching = Boolean(state.q);
    const fresh = { page: 0, more: true, loading: false, error: null, outcome: null, limited: false, coversDown: false, stale: 0, total: null, count: 0, seen: new Set() };
    fresh.images = imageWatch((failing) => {
      fresh.coversDown = failing;
      if (list === fresh) renderBanner();
    }, COVERS_DOWN);
    list = fresh;
    renderBar();
    renderFilters();
    renderBanner();
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
