import { api } from './api.js';
import { clear, edgeSwipe, h } from './dom.js';
import { icon } from './icons.js';
import { banner, imageWatch, noticeElement, problem, whenOnline } from './notices.js';
import { day, NOTICE, photos, TEXT } from './text.js';

// Images fetched before the user scrolls; the rest load as they come near.
const EAGER_PHOTOS = 2;
// Photos that fail, with none loading, before the album says the image
// server is refusing them.
const PHOTOS_DOWN = 3;

const metaText = (count, date) => [count ? photos(count) : '', date ? day(date) : ''].filter(Boolean).join(' · ');

const loader = () => h('div', { class: 'loader', role: 'progressbar', 'aria-label': 'Loading' }, h('span', { class: 'sq' }), h('span', { class: 'sq' }), h('span', { class: 'sq' }));

function header(summary, onBack) {
  const back = h('button', { class: 'icon-btn sq', type: 'button', 'aria-label': TEXT.back }, icon('back'));
  back.addEventListener('click', onBack);
  const title = h('h1', { class: 'detail-title' }, summary?.title ?? '');
  const meta = h('p', { class: 'detail-meta' }, metaText(summary?.count, summary?.date));
  return { back, title, meta, element: h('header', { class: 'bar detail-bar' }, h('div', { class: 'bar-row' }, back, h('div', { class: 'detail-heading' }, title, meta))) };
}

// An album as the view shows it, whichever site it comes from: its title,
// date, and size, and its photos as full addresses, with their shape where
// the site gives it. Hentai Cosplay sends every photo at once; xHamster sends
// a gallery 60 photos at a time, so `page` and `pages` say what is left, and
// `key` is the gallery's full name for asking for the rest.
function readAlbum(answer, summary, slug) {
  if (Array.isArray(answer.files)) {
    return {
      key: slug,
      title: answer.title,
      date: summary?.date ?? null,
      count: answer.files.length,
      page: 1,
      pages: 1,
      photos: answer.files.map((file) => ({ src: `${answer.base}${file}` })),
    };
  }
  return {
    key: answer.key ?? slug,
    title: answer.title,
    date: answer.date ?? summary?.date ?? null,
    count: answer.count ?? answer.photos.length,
    page: answer.page ?? 1,
    pages: answer.pages ?? 1,
    photos: [...answer.photos],
  };
}

// Every photo of an album, at the largest size its site serves and in the
// album's order, as one continuous list, however the site splits it.
export function createAlbumView({ provider, slug, summary, onBack, onOpenPhoto }) {
  const top = header(summary, onBack);
  const notes = banner();
  const watch = imageWatch((failing) => (failing ? notes.show(NOTICE.album.photosDown) : notes.hide()), PHOTOS_DOWN);
  const list = h('ol', { class: 'photos' });
  const status = h('div', { class: 'feed-status' });
  const element = h('section', { class: 'detail', 'aria-labelledby': `album-${slug}` }, top.element, notes.element, list, status);
  top.title.id = `album-${slug}`;
  let album = null;
  let closed = false;
  let fetching = false;
  edgeSwipe(element, onBack);

  function placeholders() {
    clear(list);
    for (let index = 0; index < 3; index += 1) list.append(h('li', { class: 'photo-cell' }, h('div', { class: 'photo sq skeleton' })));
  }

  function photo(entry, index) {
    const label = () => `Photo ${index + 1} of ${album.count}`;
    const frame = h('button', { class: 'photo sq', type: 'button', 'aria-label': label() });
    // The site's own size gives the frame its shape before the photo loads.
    if (entry.width && entry.height) frame.style.aspectRatio = `${entry.width} / ${entry.height}`;
    const show = (eager) => {
      const image = h('img', {
        src: entry.src,
        alt: '',
        decoding: 'async',
        loading: eager ? 'eager' : 'lazy',
        fetchpriority: index === 0 ? 'high' : null,
        referrerpolicy: 'no-referrer',
        draggable: 'false',
      });
      image.addEventListener('load', () => {
        if (image.naturalWidth && image.naturalHeight) frame.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
        frame.classList.add('loaded');
        frame.setAttribute('aria-label', label());
        watch.loaded();
      }, { once: true });
      image.addEventListener('error', () => {
        image.remove();
        frame.classList.add('failed');
        frame.setAttribute('aria-label', `${label()}. ${TEXT.photoMissing} ${TEXT.tapToRetry}`);
        frame.append(icon('missing', 28), h('span', { class: 'photo-note' }, TEXT.photoMissing), h('span', { class: 'photo-hint' }, TEXT.tapToRetry));
        watch.failed();
      }, { once: true });
      frame.append(image);
    };
    show(index < EAGER_PHOTOS);
    frame.addEventListener('click', () => {
      // A photo that failed loads again rather than opening an empty viewer.
      if (frame.classList.contains('failed')) {
        frame.classList.remove('failed');
        clear(frame);
        show(true);
        return;
      }
      // The viewer gets the album's own list, so pages that arrive while it
      // is open can be reached in it too.
      onOpenPhoto({ photos: album.photos, index });
    });
    return h('li', { class: 'photo-cell' }, frame);
  }

  function append(entries, from) {
    const fragment = document.createDocumentFragment();
    entries.forEach((entry, offset) => fragment.append(photo(entry, from + offset)));
    list.append(fragment);
  }

  // The end of the album, or a sign that the next page is on its way.
  function renderEnd() {
    status.replaceChildren(album.page < album.pages ? loader() : h('p', { class: 'end' }, TEXT.albumEnd));
  }

  // The rest of an album its site splits into pages, one page after another.
  async function more() {
    if (fetching) return;
    fetching = true;
    renderEnd();
    while (!closed && album.page < album.pages) {
      const page = album.page + 1;
      let answer;
      try {
        answer = await api.album(provider, album.key, page);
      } catch (error) {
        fetching = false;
        if (closed) return;
        status.replaceChildren(noticeElement(problem(error, 'album'), more));
        if (error.code === 'offline') whenOnline(() => element.isConnected && more());
        return;
      }
      if (closed) break;
      // A page with no photos ends the album, whatever the count said.
      if (!answer.photos?.length) {
        album.pages = album.page;
        break;
      }
      const from = album.photos.length;
      album.photos.push(...answer.photos);
      album.page = page;
      append(answer.photos, from);
    }
    fetching = false;
    if (!closed) renderEnd();
  }

  async function load() {
    placeholders();
    status.replaceChildren();
    let answer;
    try {
      answer = await api.album(provider, slug);
    } catch (error) {
      if (closed) return;
      clear(list);
      status.replaceChildren(noticeElement(problem(error, 'album'), load));
      if (error.code === 'offline') whenOnline(() => element.isConnected && load());
      return;
    }
    if (closed) return;
    album = readAlbum(answer, summary, slug);
    top.title.textContent = album.title || summary?.title || '';
    top.meta.textContent = metaText(album.count, album.date);
    clear(list);
    if (album.photos.length === 0) {
      status.replaceChildren(noticeElement({ ...NOTICE.album.empty, retry: false }));
      return;
    }
    append(album.photos, 0);
    more();
  }

  load();

  return {
    element,
    focusTarget: top.back,
    destroy() {
      closed = true;
    },
    // After the photo viewer closes, bring its last photo into view.
    showPhoto(index) {
      const frame = list.children[index]?.querySelector('.photo');
      if (!frame) return;
      frame.scrollIntoView({ block: 'center' });
      frame.focus({ preventScroll: true });
    },
  };
}
