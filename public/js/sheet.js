import { h, settle } from './dom.js';

// A bottom sheet: slides up over a dim backdrop and closes from the
// backdrop, Escape, or a downward drag on its top area. `requestClose` is
// called for those; the caller then calls `close()` (so that closing can go
// through the browser history).

export function openSheet({ label, body, requestClose }) {
  const returnFocus = document.activeElement;
  const grab = h('div', { class: 'sheet-grab' }, h('div', { class: 'grabber sq' }), h('h2', { class: 'sheet-title' }, label));
  const sheet = h('section', { class: 'sheet sq', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' }, grab, body);
  const scrim = h('div', { class: 'scrim' });
  document.body.append(scrim, sheet);
  requestAnimationFrame(() => {
    scrim.classList.add('open');
    sheet.classList.add('open');
  });

  scrim.addEventListener('click', () => requestClose());
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') requestClose();
  });

  // Drag down on the top area to close.
  let drag = null;
  grab.addEventListener('pointerdown', (event) => {
    drag = { id: event.pointerId, y: event.clientY, time: performance.now(), offset: 0 };
    grab.setPointerCapture(event.pointerId);
    sheet.classList.add('dragging');
  });
  grab.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag.offset = Math.max(0, event.clientY - drag.y);
    sheet.style.transform = `translateY(${drag.offset}px)`;
  });
  const release = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const speed = drag.offset / Math.max(1, performance.now() - drag.time);
    const shouldClose = event.type === 'pointerup' && (drag.offset > 90 || (drag.offset > 20 && speed > 0.5));
    drag = null;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    if (shouldClose) requestClose();
  };
  grab.addEventListener('pointerup', release);
  grab.addEventListener('pointercancel', release);

  let closed = false;
  return {
    element: sheet,
    async close() {
      if (closed) return;
      closed = true;
      scrim.classList.remove('open');
      sheet.classList.remove('open');
      await settle(sheet);
      scrim.remove();
      sheet.remove();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    },
  };
}
