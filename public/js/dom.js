// A small element builder. Text is always added as text nodes, never parsed
// as HTML, so nothing from the source site can inject markup.

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, ...children);
  return element;
}

export function append(parent, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(element) {
  element.replaceChildren();
  return element;
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Resolves after one of the element's own transitions ends (not a child's),
// after `timeout` at the latest, or at once when motion is reduced.
export function settle(element, timeout = 400) {
  if (reducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (event) => {
      if (event && event.target !== element) return;
      clearTimeout(timer);
      element.removeEventListener('transitionend', done);
      resolve();
    };
    const timer = setTimeout(done, timeout);
    element.addEventListener('transitionend', done);
  });
}

// Swipe right from the left edge to go back, following the finger. Built
// for full-screen views; the browser's own edge swipe still works where it
// exists.
export function edgeSwipe(element, onBack) {
  let drag = null;
  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || event.clientX > 28) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), active: false, offset: 0 };
  });
  element.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        drag = null;
        return;
      }
      if (dx < 10) return;
      drag.active = true;
      element.setPointerCapture(event.pointerId);
      element.classList.add('dragging');
    }
    drag.offset = Math.max(0, dx);
    element.style.transform = `translate3d(${drag.offset}px, 0, 0)`;
  });
  const release = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { active, offset, time } = drag;
    drag = null;
    if (!active) return;
    element.classList.remove('dragging');
    const speed = offset / Math.max(1, performance.now() - time);
    // A cancelled pointer means the browser took the gesture over (its own
    // back swipe, for one), so only a lifted finger goes back.
    if (event.type === 'pointerup' && (offset > element.clientWidth * 0.3 || (offset > 40 && speed > 0.5))) {
      // Keep moving out from where the finger let go.
      element.style.transform = 'translate3d(100%, 0, 0)';
      onBack();
    } else {
      element.style.transform = '';
    }
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
}
