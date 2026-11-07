// Inline SVG icons drawn for this page, on a 24-unit grid with 2-unit round
// strokes. They take the color of the surrounding text.

const NS = 'http://www.w3.org/2000/svg';

const STROKES = Object.freeze({
  search: ['M10.5 4.5a6 6 0 1 0 0 12a6 6 0 0 0 0-12Z', 'm19.5 19.5-4.75-4.75'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  copy: ['M9.5 9.5h9v9h-9Z', 'M5.5 14.5v-9h9'],
  check: ['M5.5 12.5l4.25 4.25L18.5 8'],
  open: ['M13.5 5.5h5v5', 'M18.5 5.5l-7 7', 'M10 6.5H6.5v11h11V14'],
  retry: ['M19 12a7 7 0 1 1-2.05-4.95', 'M19 5v4.5h-4.5'],
  alert: ['M12 4.5 20.5 19h-17Z', 'M12 10v4', 'M12 16.5h.01'],
  chevron: ['M9.5 6.5 15 12l-5.5 5.5'],
  user: ['M12 12a3.75 3.75 0 1 0 0-7.5a3.75 3.75 0 0 0 0 7.5Z', 'M5 19.5a7 7 0 0 1 14 0'],
  bot: ['M6 9.5h12v9H6Z', 'M12 9.5V6.5', 'M12 5h.01', 'M9.5 14h.01', 'M14.5 14h.01', 'M3.5 13v2.5', 'M20.5 13v2.5'],
  system: ['M4.5 5.5h15v13h-15Z', 'm8 10 2.5 2L8 14', 'M12.5 14.5H16'],
  calendar: ['M5 7h14v12H5Z', 'M5 11h14', 'M9 4.5v4', 'M15 4.5v4'],
  image: ['M5 5.5h14v13H5Z', 'm5 15.5 4-4 3 3 2.5-2.5 4.5 4.5', 'M15 9.25h.01'],
  tag: ['M4.5 12.5v-7h7l8 8-7 7Z', 'M8.5 8.5h.01'],
  sparkle: ['M12 4.5l1.75 5.75L19.5 12l-5.75 1.75L12 19.5l-1.75-5.75L4.5 12l5.75-1.75Z'],
  type: ['M5 7.5V5.5h14v2', 'M12 5.5v13', 'M9.5 18.5h5'],
  braces: ['M9 4.5c-2 0-2.5 1-2.5 2.5v2c0 1.5-.75 2.5-2 3c1.25.5 2 1.5 2 3v2c0 1.5.5 2.5 2.5 2.5', 'M15 4.5c2 0 2.5 1 2.5 2.5v2c0 1.5.75 2.5 2 3c-1.25.5-2 1.5-2 3v2c0 1.5-.5 2.5-2.5 2.5'],
  hash: ['M9.5 4.5 8 19.5', 'M16 4.5l-1.5 15', 'M5 9.5h14.5', 'M4.5 14.5H19'],
  flagged: ['M6.5 20V4.5', 'M6.5 5.5H17l-2.5 4 2.5 4H6.5'],
  // One per documented user flag.
  staff: ['M12 4l7 2.5v5c0 4.5-3 7.5-7 8.5c-4-1-7-4-7-8.5v-5Z', 'M12 8.5v6', 'M9 11.5h6'],
  partner: ['M10 14a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1 1', 'M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1-1'],
  events: ['M6.5 20V4.5', 'M6.5 5.5H17l-2.5 4 2.5 4H6.5', 'M10.5 9.5h.01'],
  bug: ['M8.5 10h7v4.5a3.5 3.5 0 0 1-7 0Z', 'M9.5 10a2.5 2.5 0 0 1 5 0', 'M4.5 12.5h4', 'M15.5 12.5h4', 'M5.5 8l3 2', 'M18.5 8l-3 2', 'M5.5 17.5l3-2', 'M18.5 17.5l-3-2'],
  bugPlus: ['M8.5 10h7v4.5a3.5 3.5 0 0 1-7 0Z', 'M9.5 10a2.5 2.5 0 0 1 5 0', 'M4.5 12.5h4', 'M15.5 12.5h4', 'M5.5 8l3 2', 'M18.5 8l-3 2', 'M5.5 17.5l3-2', 'M18.5 17.5l-3-2', 'M12 11.5v4'],
  bravery: ['M6 13l6-5.5 6 5.5', 'M6 18l6-5.5 6 5.5'],
  brilliance: ['M12 4.5l6.5 7.5-6.5 7.5-6.5-7.5Z', 'M5.5 12h13'],
  balance: ['M12 5v14', 'M6.5 8h11', 'M6.5 8 4 13.5h5Z', 'M17.5 8 15 13.5h5Z', 'M8.5 19h7'],
  early: ['M12 4.5l2.3 4.7 5.2.75-3.75 3.65.9 5.15L12 16.3l-4.65 2.45.9-5.15L4.5 9.95l5.2-.75Z'],
  team: ['M9 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6Z', 'M3.5 19a5.5 5.5 0 0 1 11 0', 'M16 11a2.5 2.5 0 1 0 0-5', 'M17.5 19a5 5 0 0 0-2.5-4.3'],
  verified: ['M12 3.5l2.2 1.6 2.7-.1.8 2.6 2.2 1.6-.9 2.6.9 2.6-2.2 1.6-.8 2.6-2.7-.1L12 20.5l-2.2-1.6-2.7.1-.8-2.6-2.2-1.6.9-2.6-.9-2.6 2.2-1.6.8-2.6 2.7.1Z', 'm9 12 2 2 4-4'],
  developer: ['m9 8-4 4 4 4', 'm15 8 4 4-4 4', 'M13 6.5l-2 11'],
  moderator: ['M12 4l7 2.5v5c0 4.5-3 7.5-7 8.5c-4-1-7-4-7-8.5v-5Z', 'm9 12 2 2 4-4'],
  http: ['M13 3.5 6 13.5h5.5l-1 7 7.5-10.5h-5.5Z'],
  mark: ['M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Z', 'm20 20-4.75-4.75', 'M10.5 7.75a1.75 1.75 0 1 0 0 3.5a1.75 1.75 0 0 0 0-3.5Z', 'M7.75 14.25a3 3 0 0 1 5.5 0'],
});

export function icon(name, size = 20) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('icon');
  for (const data of STROKES[name] ?? STROKES.flagged) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}
