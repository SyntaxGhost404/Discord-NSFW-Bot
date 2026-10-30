import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';

// The app's mark: a light squircle tile with a viewfinder.
export function mark(size = 32) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(Math.round(size * 0.56)));
  svg.setAttribute('height', String(Math.round(size * 0.56)));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const data of ['M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9', 'M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9', 'M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15', 'M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15', 'M10 9.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5Z']) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return h('span', { class: `mark sq mark-${size}` }, svg);
}
