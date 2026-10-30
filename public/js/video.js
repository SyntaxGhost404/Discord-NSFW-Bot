import { api } from './api.js';
import { edgeSwipe, h } from './dom.js';
import { icon } from './icons.js';
import { noticeElement, problem, whenOnline } from './notices.js';
import { day, NOTICE, TEXT } from './text.js';

// The site streams video as HLS without CORS headers, so it plays only where
// the browser handles HLS itself (Safari on any device, Chrome on Android).
const canPlayHls = () => document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';

export function createVideoView({ slug, summary, onBack }) {
  const back = h('button', { class: 'icon-btn sq', type: 'button', 'aria-label': TEXT.back }, icon('back'));
  back.addEventListener('click', onBack);
  const title = h('h1', { class: 'detail-title', id: `video-${slug}` }, summary?.title ?? '');
  const meta = h('p', { class: 'detail-meta' }, summary?.date ? day(summary.date) : TEXT.video);
  const skeleton = () => h('div', { class: 'video-frame sq skeleton' });
  const body = h('div', { class: 'video-body' }, skeleton());
  const element = h('section', { class: 'detail', 'aria-labelledby': `video-${slug}` },
    h('header', { class: 'bar detail-bar' }, h('div', { class: 'bar-row' }, back, h('div', { class: 'detail-heading' }, title, meta))),
    body);
  edgeSwipe(element, onBack);

  function reload() {
    body.replaceChildren(skeleton());
    load();
  }

  async function load() {
    try {
      const video = await api.video(slug);
      title.textContent = video.title || summary?.title || '';
      if (!video.stream) {
        body.replaceChildren(noticeElement({ ...NOTICE.video.noStream, retry: false }));
      } else if (canPlayHls()) {
        const player = h('video', { class: 'video-frame sq', controls: true, playsinline: true, preload: 'metadata', poster: video.poster ?? null });
        // The stream itself can fail after the page loaded: say so, and
        // offer to load it again.
        player.addEventListener('error', () => {
          if (player.isConnected) body.replaceChildren(noticeElement({ ...NOTICE.video.failed, retry: true }, reload));
        }, { once: true });
        player.src = video.stream;
        body.replaceChildren(player);
      } else {
        const still = video.poster ? h('img', { class: 'video-still', src: video.poster, alt: '', referrerpolicy: 'no-referrer' }) : null;
        body.replaceChildren(h('div', { class: 'video-frame sq unsupported' }, still), noticeElement({ ...NOTICE.video.noHls, retry: false }));
      }
    } catch (error) {
      body.replaceChildren(noticeElement(problem(error, 'video'), reload));
      if (error.code === 'offline') whenOnline(() => element.isConnected && reload());
    }
  }

  load();

  return {
    element,
    focusTarget: back,
    showPhoto() {},
    destroy() {
      element.querySelector('video')?.pause();
    },
  };
}
