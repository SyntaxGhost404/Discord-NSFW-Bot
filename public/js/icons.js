// Inline SVG icons, drawn on a 24-unit grid with 2-unit rounded strokes. They
// take the color of the surrounding text.

const NS = 'http://www.w3.org/2000/svg';

const STROKES = Object.freeze({
  search: ['M10.5 4.5a6 6 0 1 0 0 12a6 6 0 0 0 0-12Z', 'm19.5 19.5-4.75-4.75'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  back: ['M14.5 5.5 8 12l6.5 6.5'],
  sort: ['M4.5 7h15', 'M7.5 12h9', 'M10.5 17h3'],
  check: ['M5.5 12.5l4.25 4.25L18.5 8'],
  down: ['M7 10l5 5 5-5'],
  retry: ['M19 12a7 7 0 1 1-2.05-4.95', 'M19 5v4.5h-4.5'],
  photo: ['M5 5.5h14v13H5Z', 'm5 15.5 4-4 3 3 2.5-2.5 4.5 4.5', 'M15 9.25h.01'],
  missing: ['M5 5.5h14v13H5Z', 'M5 5.5l14 13'],
  up: ['M12 18.5V6', 'M6.5 11.5 12 6l5.5 5.5'],
});

const FILLS = Object.freeze({
  play: ['M9 6.75v10.5a.75.75 0 0 0 1.14.64l8.6-5.25a.75.75 0 0 0 0-1.28l-8.6-5.25A.75.75 0 0 0 9 6.75Z'],
});

export function icon(name, size = 22) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  const filled = Boolean(FILLS[name]);
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  if (!filled) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  for (const data of FILLS[name] ?? STROKES[name] ?? []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}
