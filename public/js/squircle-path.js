// Continuous-curvature rounded rectangles ("squircles") as SVG path data.
//
// A plain border-radius joins a straight edge to a quarter circle, so the
// curvature jumps from zero to 1/r at once. Here each corner is a shorter
// circular arc with a cubic curve on either side that eases in from the
// straight edge, so the curvature rises gradually. `smoothing` (0 to 1) sets
// how much of the corner is eased: 0 is a plain circular corner, and 0.6
// matches the smooth corners of modern app icons. The corner then reaches
// (1 + smoothing) * radius along each edge.

const DEGREES = Math.PI / 180;
export const DEFAULT_SMOOTHING = 0.6;

function cornerShape(radius, smoothing, budget) {
  const r = Math.max(0, Math.min(radius, budget));
  if (r === 0) return null;
  let ease = Math.max(0, Math.min(1, smoothing));
  let reach = (1 + ease) * r;
  if (reach > budget) {
    // Not enough room: ease less rather than shrink the radius.
    ease = Math.max(0, budget / r - 1);
    reach = budget;
  }
  const arc = 90 * (1 - ease);
  const chord = Math.SQRT2 * r * Math.sin((arc / 2) * DEGREES);
  // The arc meets each easing curve at this angle to the edge.
  const angle = 45 * ease;
  const handle = r * Math.tan((angle / 2) * DEGREES);
  const c = handle * Math.cos(angle * DEGREES);
  const d = c * Math.tan(angle * DEGREES);
  const b = (reach - chord - c - d) / 3;
  return { r, reach, a: 2 * b, b, c, d, chord };
}

const number = (value) => String(Math.round(value * 100) / 100);

// One corner, drawn clockwise from the end of the previous edge. `x` and
// `y` give the direction of travel along the incoming edge, and the corner
// turns right (clockwise on screen).
function corner(shape, x, y) {
  if (!shape) return '';
  const { r, a, b, c, d, chord } = shape;
  // Rotate a vector given for the top-right corner (travelling right, then
  // turning down) into the incoming direction.
  const turn = (u, v) => [u * x - v * y, u * y + v * x];
  const point = (u, v) => turn(u, v).map(number).join(' ');
  return [
    `c ${point(a, 0)} ${point(a + b, 0)} ${point(a + b + c, d)}`,
    `a ${number(r)} ${number(r)} 0 0 1 ${point(chord, chord)}`,
    `c ${point(d, c)} ${point(d, b + c)} ${point(d, a + b + c)}`,
  ].join(' ');
}

// Path data for a width by height box whose top-left corner is at (origin,
// origin). `radii` is one radius or four (top-left, top-right, bottom-right,
// bottom-left).
export function squirclePath(width, height, radii, smoothing = DEFAULT_SMOOTHING, origin = 0) {
  const [tl, tr, br, bl] = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  const budget = Math.max(0, Math.min(width, height) / 2);
  const shapes = [tl, tr, br, bl].map((radius) => cornerShape(Number(radius) || 0, smoothing, budget));
  const reach = shapes.map((shape) => shape?.reach ?? 0);
  const at = (x, y) => `${number(origin + x)} ${number(origin + y)}`;
  return [
    `M ${at(reach[0], 0)}`,
    `L ${at(width - reach[1], 0)}`,
    corner(shapes[1], 1, 0),
    `L ${at(width, height - reach[2])}`,
    corner(shapes[2], 0, 1),
    `L ${at(reach[3], height)}`,
    corner(shapes[3], -1, 0),
    `L ${at(0, reach[0])}`,
    corner(shapes[0], 0, -1),
    'Z',
  ].filter(Boolean).join(' ');
}
