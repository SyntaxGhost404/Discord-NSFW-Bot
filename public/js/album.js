import { api } from './api.js';
import { clear, edgeSwipe, h } from './dom.js';
import { icon } from './icons.js';
import { day, photos, TEXT } from './text.js';

// Images fetched before the user scrolls; the rest load as they come near.
const EAGER_PHOTOS = 2;

function header(summary, onBack) {
  const back = h('button', { class: 'icon-btn sq', type: 'button', 'aria-label': TEXT.back }, icon('back'));
  back.addEventListener('click', onBack);
  const title = h('h1', { class: 'detail-title' }, summary?.title ?? '');
  const meta = h('p', { class: 'detail-meta' }, summary?.date ? day(summary.date) : '');
  return { back, title, meta, element: h('header', { class: 'bar detail-bar' }, h('div', { class: 'bar-row' }, back, h('div', { class: 'detail-heading' }, title, meta))) };
}

// Every photo of an album, full size and in the album's order, as one
// continuous list (the source site splits large albums into pages).
export function createAlbumView({ slug, summary, onBack, onOpenPhoto }) {
  const top = header(summary, onBack);
  const list = h('ol', { class: 'photos' });
  const status = h('div', { class: 'feed-status' });
  const element = h('section', { class: 'detail', 'aria-labelledby': `album-${slug}` }, top.element, list, status);
  top.title.id = `album-${slug}`;
  let album = null;
  edgeSwipe(element, onBack);

  function placeholders() {
    clear(list);
    for (let index = 0; index < 3; index += 1) list.append(h('li', { class: 'photo-cell' }, h('div', { class: 'photo sq skeleton' })));
  }

  function photo(file, index) {
    const frame = h('button', { class: 'photo sq', type: 'button', 'aria-label': `Photo ${index + 1} of ${album.files.length}` });
    const image = h('img', {
      src: `${album.base}${file}`,
      alt: '',
      decoding: 'async',
      loading: index < EAGER_PHOTOS ? 'eager' : 'lazy',
      fetchpriority: index === 0 ? 'high' : null,
      referrerpolicy: 'no-referrer',
      draggable: 'false',
    });
    image.addEventListener('load', () => {
      if (image.naturalWidth && image.naturalHeight) frame.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
      frame.classList.add('loaded');
    }, { once: true });
    image.addEventListener('error', () => {
      image.remove();
      frame.classList.add('failed');
      frame.append(icon('missing', 28), h('span', { class: 'photo-note' }, TEXT.photoMissing));
    }, { once: true });
    frame.append(image);
    frame.addEventListener('click', () => onOpenPhoto({ base: album.base, files: album.files, index }));
    return h('li', { class: 'photo-cell' }, frame);
  }

  function render() {
    top.title.textContent = album.title || summary?.title || '';
    top.meta.textContent = [photos(album.files.length), summary?.date ? day(summary.date) : ''].filter(Boolean).join(' · ');
    const fragment = document.createDocumentFragment();
    album.files.forEach((file, index) => fragment.append(photo(file, index)));
    list.replaceChildren(fragment);
    status.replaceChildren(h('p', { class: 'end' }, TEXT.albumEnd));
  }

  async function load() {
    placeholders();
    status.replaceChildren();
    try {
      album = await api.album(slug);
      render();
    } catch {
      clear(list);
      const retry = h('button', { class: 'btn btn-secondary btn-small sq', type: 'button' }, icon('retry', 18), TEXT.retry);
      retry.addEventListener('click', load);
      status.replaceChildren(h('div', { class: 'notice sq' }, h('p', {}, TEXT.albumError), retry));
    }
  }

  load();

  return {
    element,
    focusTarget: top.back,
    // After the photo viewer closes, bring its last photo into view.
    showPhoto(index) {
      const frame = list.children[index]?.querySelector('.photo');
      if (!frame) return;
      frame.scrollIntoView({ block: 'center' });
      frame.focus({ preventScroll: true });
    },
  };
}
