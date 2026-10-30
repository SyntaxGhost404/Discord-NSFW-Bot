import { createAlbumView } from './album.js';
import { settle } from './dom.js';
import { createFeed, feedPath, readFeedState, sameFeed } from './feed.js';
import { ageGate } from './gate.js';
import { openLightbox } from './lightbox.js';
import { openSortSheet } from './sort.js';
import { startSquircles } from './squircle.js';
import { RANGED_SORTS } from './text.js';
import { createVideoView } from './video.js';

// Routes:
//   /                      the feed (?sort=, &range=, or ?q= for a search)
//   /album/<slug>          an album, over the feed
//   /video/<slug>          a video, over the feed
// The sort sheet and the photo viewer are history entries too, so the back
// button or gesture closes them first.

const root = document.getElementById('app');
startSquircles(document.body);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

function currentRoute() {
  const match = location.pathname.match(/^\/(album|video)\/([a-z0-9_-]{1,320})\/?$/);
  return match ? { kind: match[1], slug: match[2] } : { kind: 'feed', state: readFeedState(location.search) };
}

function start() {
  let feed = null;
  let detail = null;
  let overlay = null;
  let opener = null;
  let afterPop = null;
  const depth = () => history.state?.depth ?? 0;

  // A reload can leave an overlay marker on this entry; start clean.
  history.replaceState({ depth: 0 }, '', location.href);

  function onStateChange(state) {
    history.replaceState(history.state, '', feedPath(state));
  }

  function go(url, extra = {}) {
    history.pushState({ depth: depth() + 1, ...extra }, '', url);
    render();
  }

  function back() {
    if (depth() > 0) {
      history.back();
      return;
    }
    history.replaceState({ depth: 0 }, '', feed ? feedPath(feed.state) : '/');
    render();
  }

  function openOverlay(kind, build) {
    history.pushState({ ...history.state, depth: depth() + 1, overlay: kind }, '', location.href);
    overlay = { kind, controller: build(), lastIndex: null };
  }

  // Closes the open overlay through the history; `then` runs once it has.
  function closeOverlay(then) {
    if (history.state?.overlay) {
      afterPop = then ?? null;
      history.back();
    } else {
      then?.();
    }
  }

  function onOpen(item, link) {
    opener = link;
    go(`/${item.kind}/${item.slug}`, { item: { kind: item.kind, slug: item.slug, title: item.title, date: item.date } });
  }

  function onPickSort(current) {
    if (overlay) return;
    openOverlay('sort', () => openSortSheet({
      current,
      requestClose: () => closeOverlay(),
      onPick: (sort) => closeOverlay(() => {
        feed.apply({ q: '', sort, range: RANGED_SORTS.has(sort) ? feed.state.range : 'all' });
      }),
    }));
  }

  function onOpenPhoto({ base, files, index }) {
    if (overlay) return;
    let last = index;
    openOverlay('photo', () => openLightbox({
      base,
      files,
      index,
      requestClose: () => closeOverlay(),
      onChange: (position) => {
        last = position;
      },
    }));
    overlay.lastIndex = () => last;
  }

  function ensureFeed(state) {
    if (!feed) {
      feed = createFeed({ initial: state, onOpen, onPickSort, onStateChange });
      root.append(feed.element);
    } else if (!sameFeed(feed.state, state)) {
      feed.apply(state, { silent: true });
    }
  }

  async function openDetail(route, summary, from) {
    const create = route.kind === 'album' ? createAlbumView : createVideoView;
    const view = create({ slug: route.slug, summary: summary?.slug === route.slug ? summary : null, onBack: back, onOpenPhoto });
    detail = { ...route, view, from };
    root.append(view.element);
    document.documentElement.classList.add('locked');
    requestAnimationFrame(() => view.element.classList.add('open'));
    await settle(view.element, 450);
    if (detail?.view !== view) return;
    feed.element.inert = true;
    view.focusTarget?.focus({ preventScroll: true });
  }

  async function closeDetail() {
    const closing = detail;
    detail = null;
    closing.view.destroy?.();
    feed.element.inert = false;
    document.documentElement.classList.remove('locked');
    closing.view.element.classList.remove('open');
    await settle(closing.view.element, 450);
    closing.view.element.remove();
    if (closing.from?.isConnected) closing.from.focus({ preventScroll: true });
  }

  function render() {
    const route = currentRoute();
    const state = history.state ?? {};
    if (overlay && state.overlay !== overlay.kind) {
      const closing = overlay;
      overlay = null;
      closing.controller.close();
      if (closing.lastIndex && detail) detail.view.showPhoto(closing.lastIndex());
    }
    if (route.kind === 'feed') {
      ensureFeed(route.state);
      if (detail) closeDetail();
    } else {
      ensureFeed(feed ? feed.state : readFeedState(''));
      if (!detail || detail.kind !== route.kind || detail.slug !== route.slug) {
        if (detail) closeDetail();
        openDetail(route, state.item, opener);
      }
    }
    opener = null;
  }

  addEventListener('popstate', () => {
    render();
    const then = afterPop;
    afterPop = null;
    then?.();
  });

  render();
}

ageGate(root, start);
