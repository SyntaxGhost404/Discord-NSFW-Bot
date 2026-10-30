import { DEFAULT_SMOOTHING, squirclePath } from './squircle-path.js';

// Every element with the class "sq" gets continuous-curvature corners, sized
// by its CSS --r (one radius, or four for top-left, top-right, bottom-right,
// bottom-left). Browsers with `corner-shape: squircle` draw them from CSS
// alone; elsewhere each element gets the same shape as a clip path, redrawn
// whenever its size changes.

export const nativeSquircles = typeof CSS !== 'undefined' && CSS.supports('corner-shape', 'squircle');

let resizer = null;

function radiiOf(element) {
  const values = getComputedStyle(element).getPropertyValue('--r').trim().split(/\s+/).map((value) => Number.parseFloat(value) || 0);
  return values.length === 4 ? values : [values[0], values[0], values[0], values[0]];
}

// The path runs half a pixel outside the box. Browsers snap an element's own
// edges to whole device pixels but not its clip path, so an exact path would
// soften the straight edges of anything that sits at a fractional position.
const SLACK = 0.5;

function shape(element, width, height) {
  if (width <= 0 || height <= 0) return;
  const radii = radiiOf(element).map((radius) => (radius > 0 ? radius + SLACK : 0));
  element.style.clipPath = `path('${squirclePath(width + 2 * SLACK, height + 2 * SLACK, radii, DEFAULT_SMOOTHING, -SLACK)}')`;
}

function each(node, action) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.classList.contains('sq')) action(node);
  for (const element of node.querySelectorAll('.sq')) action(element);
}

export function startSquircles(root = document.body) {
  if (nativeSquircles || resizer) return;
  resizer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.borderBoxSize?.[0];
      shape(entry.target, box ? box.inlineSize : entry.target.offsetWidth, box ? box.blockSize : entry.target.offsetHeight);
    }
  });
  const watch = (element) => resizer.observe(element);
  const release = (element) => resizer.unobserve(element);
  each(root, watch);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) each(node, release);
      for (const node of record.addedNodes) each(node, watch);
    }
  }).observe(root, { childList: true, subtree: true });
}
