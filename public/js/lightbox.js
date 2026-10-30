import { h, reducedMotion, settle } from './dom.js';
import { icon } from './icons.js';
import { TEXT } from './text.js';

// Full-screen photo viewer.
//
// Touch: swipe sideways to page, pinch or double-tap to zoom, drag to pan a
// zoomed photo, swipe up or down to close, tap to show or hide the controls.
// Mouse and keyboard: arrows, wheel, Escape, and side buttons.

const MAXIMUM_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const TAP_SLOP = 8;
const DOUBLE_TAP_MS = 280;
const PAGE_DISTANCE = 0.2;
const PAGE_SPEED = 0.4;
const CLOSE_DISTANCE = 120;
const CLOSE_SPEED = 0.6;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function openLightbox({ base, files, index, requestClose, onChange }) {
  const count = files.length;
  let current = clamp(index, 0, count - 1);
  const returnFocus = document.activeElement;

  const makeSlide = () => {
    const image = h('img', { alt: '', decoding: 'async', draggable: 'false', referrerpolicy: 'no-referrer' });
    return { element: h('div', { class: 'lb-slide' }, image), image, index: -1 };
  };
  const slides = [makeSlide(), makeSlide(), makeSlide()];
  const track = h('div', { class: 'lb-track' }, slides.map((slide) => slide.element));
  const stage = h('div', { class: 'lb-stage' }, track);
  const counter = h('span', { class: 'lb-counter sq', 'aria-live': 'polite' });
  const closeButton = h('button', { class: 'icon-btn sq', type: 'button', 'aria-label': TEXT.close }, icon('close'));
  const previousButton = h('button', { class: 'lb-nav lb-previous icon-btn sq', type: 'button', 'aria-label': TEXT.previous }, icon('back'));
  const nextButton = h('button', { class: 'lb-nav lb-next icon-btn sq', type: 'button', 'aria-label': TEXT.next }, icon('back'));
  const root = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': TEXT.photoViewer, tabindex: '-1' },
    stage,
    h('div', { class: 'lb-top' }, closeButton, counter),
    previousButton,
    nextButton);

  let zoom = { scale: 1, x: 0, y: 0 };
  let closed = false;

  const width = () => stage.clientWidth || innerWidth;
  const height = () => stage.clientHeight || innerHeight;
  const centerSlide = () => slides[1];

  function setTrack(offset, animate) {
    track.classList.toggle('animate', Boolean(animate) && !reducedMotion());
    track.style.transform = `translate3d(${offset - width()}px, 0, 0)`;
  }

  function applyZoom(animate) {
    const { image } = centerSlide();
    image.classList.toggle('animate', Boolean(animate) && !reducedMotion());
    image.style.transform = zoom.scale === 1 && zoom.x === 0 && zoom.y === 0 ? '' : `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
    root.classList.toggle('zoomed', zoom.scale > 1.01);
  }

  // How far a zoomed photo may move before its edge leaves the screen edge.
  function limits(scale) {
    const { image } = centerSlide();
    const overflowX = Math.max(0, (image.clientWidth * scale - width()) / 2);
    const overflowY = Math.max(0, (image.clientHeight * scale - height()) / 2);
    return { x: overflowX, y: overflowY };
  }

  function clampZoom(state) {
    const scale = clamp(state.scale, 1, MAXIMUM_ZOOM);
    const limit = limits(scale);
    return { scale, x: clamp(state.x, -limit.x, limit.x), y: clamp(state.y, -limit.y, limit.y) };
  }

  // Past a limit, movement is damped instead of stopped.
  function resist(value, limit) {
    if (Math.abs(value) <= limit) return value;
    const over = Math.abs(value) - limit;
    return Math.sign(value) * (limit + over * 0.3);
  }

  // Zoom to `scale` keeping the screen point (x, y) under the finger.
  function zoomAt(scale, x, y, from = zoom) {
    const box = stage.getBoundingClientRect();
    const px = x - (box.left + box.width / 2);
    const py = y - (box.top + box.height / 2);
    const ratio = scale / from.scale;
    return { scale, x: px - (px - from.x) * ratio, y: py - (py - from.y) * ratio };
  }

  function fill(slide, position) {
    slide.index = position;
    slide.image.classList.remove('animate');
    slide.image.style.transform = '';
    if (position < 0 || position >= count) {
      slide.image.removeAttribute('src');
      slide.element.classList.add('empty');
      return;
    }
    slide.element.classList.remove('empty');
    const source = `${base}${files[position]}`;
    if (slide.image.getAttribute('src') !== source) slide.image.src = source;
  }

  function show(position) {
    current = position;
    fill(slides[0], current - 1);
    fill(slides[1], current);
    fill(slides[2], current + 1);
    zoom = { scale: 1, x: 0, y: 0 };
    applyZoom(false);
    setTrack(0, false);
    counter.textContent = `${current + 1} / ${count}`;
    previousButton.hidden = current === 0;
    nextButton.hidden = current === count - 1;
    onChange?.(current);
  }

  // One page turn at a time, so fast wheel or key repeats cannot overlap.
  let paging = false;

  async function page(direction) {
    if (paging) return;
    const target = current + direction;
    if (target < 0 || target >= count) {
      setTrack(0, true);
      return;
    }
    paging = true;
    setTrack(-direction * width(), true);
    await settle(track, 350);
    paging = false;
    if (closed) return;
    // Reuse the slide that is already showing the new photo.
    if (direction > 0) slides.push(slides.shift());
    else slides.unshift(slides.pop());
    track.replaceChildren(...slides.map((slide) => slide.element));
    show(target);
  }

  // Touch and pen gestures on the stage.
  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  let tapTimer = null;

  function sample(x, y) {
    const now = performance.now();
    gesture.samples.push({ x, y, time: now });
    while (gesture.samples.length > 2 && now - gesture.samples[0].time > 120) gesture.samples.shift();
  }

  function velocity() {
    const first = gesture.samples[0];
    const last = gesture.samples.at(-1);
    const elapsed = Math.max(1, last.time - first.time);
    return { x: (last.x - first.x) / elapsed, y: (last.y - first.y) / elapsed };
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    gesture = {
      type: 'pinch',
      distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      from: { ...zoom },
      samples: [],
    };
    setTrack(0, false);
  }

  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      startPinch();
    } else if (pointers.size === 1) {
      gesture = { type: 'pending', x: event.clientX, y: event.clientY, time: performance.now(), from: { ...zoom }, samples: [] };
      sample(event.clientX, event.clientY);
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clamp(gesture.from.scale * (distance / gesture.distance), 0.8, MAXIMUM_ZOOM * 1.2);
      const next = zoomAt(scale, gesture.middle.x, gesture.middle.y, gesture.from);
      zoom = { scale, x: next.x + (middle.x - gesture.middle.x), y: next.y + (middle.y - gesture.middle.y) };
      applyZoom(false);
      return;
    }
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    sample(event.clientX, event.clientY);
    if (gesture.type === 'pending') {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      if (zoom.scale > 1.01) gesture.type = 'pan';
      else gesture.type = Math.abs(dx) > Math.abs(dy) ? 'page' : 'dismiss';
      root.classList.add('moving');
    }
    if (gesture.type === 'page') {
      const atEdge = (dx > 0 && current === 0) || (dx < 0 && current === count - 1);
      setTrack(atEdge ? dx * 0.3 : dx, false);
    } else if (gesture.type === 'dismiss') {
      const progress = Math.min(1, Math.abs(dy) / height());
      centerSlide().image.style.transform = `translate3d(${dx * 0.3}px, ${dy}px, 0) scale(${1 - progress * 0.2})`;
      root.style.setProperty('--backdrop', String(1 - Math.min(0.85, progress * 1.6)));
    } else if (gesture.type === 'pan') {
      const limit = limits(zoom.scale);
      zoom = { ...zoom, x: resist(gesture.from.x + dx, limit.x), y: resist(gesture.from.y + dy, limit.y) };
      applyZoom(false);
    }
  });

  function finish(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (!gesture) return;
    if (gesture.type === 'pinch') {
      if (pointers.size === 1) {
        // One finger stays down: keep going as a pan.
        const [rest] = [...pointers.values()];
        gesture = { type: 'pan', x: rest.x, y: rest.y, time: performance.now(), from: { ...zoom }, samples: [] };
        sample(rest.x, rest.y);
        return;
      }
      zoom = clampZoom(zoom);
      applyZoom(true);
      gesture = null;
      return;
    }
    if (pointers.size > 0) return;
    const type = gesture.type;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const speed = velocity();
    root.classList.remove('moving');
    gesture = null;
    // A cancelled pointer means the browser took the gesture over, so nothing
    // is committed and the photo settles back.
    const lifted = event.type === 'pointerup';
    if (type === 'page') {
      if (lifted && (dx < -width() * PAGE_DISTANCE || speed.x < -PAGE_SPEED)) page(1);
      else if (lifted && (dx > width() * PAGE_DISTANCE || speed.x > PAGE_SPEED)) page(-1);
      else setTrack(0, true);
    } else if (type === 'dismiss') {
      if (lifted && (Math.abs(dy) > CLOSE_DISTANCE || Math.abs(speed.y) > CLOSE_SPEED)) {
        dismiss(Math.sign(dy) || 1);
      } else {
        const { image } = centerSlide();
        image.classList.toggle('animate', !reducedMotion());
        image.style.transform = '';
        root.style.removeProperty('--backdrop');
      }
    } else if (type === 'pan') {
      zoom = clampZoom(zoom);
      applyZoom(true);
    } else if (type === 'pending' && lifted) {
      tap(event.clientX, event.clientY);
    }
  }
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);

  function tap(x, y) {
    const now = performance.now();
    if (lastTap && now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
      clearTimeout(tapTimer);
      lastTap = null;
      zoom = zoom.scale > 1.01 ? { scale: 1, x: 0, y: 0 } : clampZoom(zoomAt(DOUBLE_TAP_ZOOM, x, y));
      applyZoom(true);
      return;
    }
    lastTap = { x, y, time: now };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => root.classList.toggle('bare'), DOUBLE_TAP_MS);
  }

  async function dismiss(direction) {
    const { image } = centerSlide();
    root.classList.add('leaving');
    image.classList.toggle('animate', !reducedMotion());
    image.style.transform = `translate3d(0, ${direction * height()}px, 0) scale(0.8)`;
    root.style.setProperty('--backdrop', '0');
    await settle(image, 300);
    requestClose();
  }

  // Mouse wheel: Ctrl (or a trackpad pinch) zooms; otherwise it pages.
  let wheelTravel = 0;
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.ctrlKey) {
      const scale = clamp(zoom.scale * Math.exp(-event.deltaY * 0.01), 1, MAXIMUM_ZOOM);
      zoom = clampZoom(zoomAt(scale, event.clientX, event.clientY));
      applyZoom(false);
      return;
    }
    if (zoom.scale > 1.01) {
      zoom = clampZoom({ ...zoom, x: zoom.x - event.deltaX, y: zoom.y - event.deltaY });
      applyZoom(false);
      return;
    }
    wheelTravel += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(wheelTravel) > 60) {
      page(Math.sign(wheelTravel));
      wheelTravel = 0;
    }
  }, { passive: false });

  function onKey(event) {
    if (event.key === 'Escape') requestClose();
    else if (event.key === 'ArrowRight') page(1);
    else if (event.key === 'ArrowLeft') page(-1);
  }
  root.addEventListener('keydown', onKey);
  closeButton.addEventListener('click', () => requestClose());
  previousButton.addEventListener('click', () => page(-1));
  nextButton.addEventListener('click', () => page(1));
  const onResize = () => {
    setTrack(0, false);
    zoom = clampZoom(zoom);
    applyZoom(false);
  };
  addEventListener('resize', onResize);

  document.body.append(root);
  show(current);
  requestAnimationFrame(() => root.classList.add('open'));
  root.focus({ preventScroll: true });

  return {
    element: root,
    get index() {
      return current;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(tapTimer);
      removeEventListener('resize', onResize);
      root.classList.remove('open');
      await settle(root, 250);
      root.remove();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    },
  };
}
