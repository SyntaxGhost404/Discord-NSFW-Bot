import { describe, expect, it } from 'vitest';
import { squirclePath } from '../public/js/squircle-path.js';

// Follows a path made of M, L, c, a, and Z commands and records the points
// it passes and each straight edge it draws.
function walk(path) {
  const tokens = path.trim().split(/\s+/);
  const number = () => Number(tokens[(index += 1) - 1]);
  let index = 0;
  let x = 0;
  let y = 0;
  let start = null;
  const points = [];
  const cubics = [];
  const arcs = [];
  const edges = [];
  while (index < tokens.length) {
    const command = tokens[index];
    index += 1;
    if (command === 'M' || command === 'L') {
      const from = [x, y];
      x = number();
      y = number();
      if (command === 'L') edges.push([from, [x, y]]);
      start ??= [x, y];
    } else if (command === 'c') {
      const c = Array.from({ length: 6 }, number);
      cubics.push(c);
      x += c[4];
      y += c[5];
    } else if (command === 'a') {
      const a = Array.from({ length: 7 }, number);
      arcs.push(a);
      x += a[5];
      y += a[6];
    } else if (command !== 'Z') {
      throw new Error(`Unexpected command ${command}`);
    }
    points.push([x, y]);
  }
  return { start, end: [x, y], points, cubics, arcs, edges };
}

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

describe('squirclePath', () => {
  it('draws a plain rectangle without radius', () => {
    expect(squirclePath(100, 50, 0)).toBe('M 0 0 L 100 0 L 100 50 L 0 50 L 0 0 Z');
  });

  it('reaches (1 + smoothing) times the radius along each edge', () => {
    expect(squirclePath(100, 100, 10)).toMatch(/^M 16 0 L 84 0 c /);
    expect(squirclePath(100, 100, 10, 0.3)).toMatch(/^M 13 0 L 87 0 c /);
  });

  it('is a plain circular corner without smoothing', () => {
    const { cubics, arcs } = walk(squirclePath(100, 60, 12, 0));
    expect(cubics.flat().every((value) => Math.abs(value) < 0.01)).toBe(true);
    expect(arcs[0]).toEqual([12, 12, 0, 0, 1, 12, 12]);
  });

  it('closes on itself and stays inside the box for any size and radius', () => {
    const sizes = [[40, 40], [50, 34], [390, 844], [1, 1], [320, 18], [760, 1013.33]];
    for (const [width, height] of sizes) {
      for (const radius of [0, 3, 8, 11, 13, 16, 18, 30, 200]) {
        for (const smoothing of [0, 0.6, 1]) {
          const path = squirclePath(width, height, radius, smoothing);
          const { start, end, points, edges } = walk(path);
          expect(Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]), path).toBeLessThan(0.08);
          // Every corner ends on the next edge, so each edge is straight.
          for (const [[x0, y0], [x1, y1]] of edges) expect(Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)), path).toBeLessThan(0.02);
          for (const [x, y] of points) {
            expect(x, path).toBeGreaterThanOrEqual(-0.02);
            expect(y, path).toBeGreaterThanOrEqual(-0.02);
            expect(x, path).toBeLessThanOrEqual(width + 0.02);
            expect(y, path).toBeLessThanOrEqual(height + 0.02);
          }
        }
      }
    }
  });

  it('leaves each edge without a kink: the easing curves start and end along the edges', () => {
    const { cubics } = walk(squirclePath(300, 200, 24));
    // Clockwise from the top edge: right, down, left, up.
    const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    directions.forEach(([dx, dy], corner) => {
      const [ease, release] = [cubics[corner * 2], cubics[corner * 2 + 1]];
      // Both control points of the first curve lie on the incoming edge.
      expect(Math.abs(cross(ease[0], ease[1], dx, dy))).toBeLessThan(0.01);
      expect(Math.abs(cross(ease[2], ease[3], dx, dy))).toBeLessThan(0.01);
      // Both control points of the second curve lie on the outgoing edge.
      const [ox, oy] = directions[(corner + 1) % 4];
      expect(Math.abs(cross(release[4] - release[0], release[5] - release[1], ox, oy))).toBeLessThan(0.01);
      expect(Math.abs(cross(release[4] - release[2], release[5] - release[3], ox, oy))).toBeLessThan(0.01);
    });
  });

  it('fits large radii by easing less instead of overlapping', () => {
    expect(squirclePath(200, 30, 20)).toMatch(/^M 15 0 L 185 0 c /);
    const { start, end } = walk(squirclePath(200, 30, 20));
    expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeLessThan(0.08);
  });

  it('takes four radii, clockwise from the top left', () => {
    const path = squirclePath(390, 300, [30, 30, 0, 0]);
    expect(walk(path).arcs).toHaveLength(2);
    expect(path).toContain('L 390 300 L 0 300');
  });

  it('can start the box away from the origin', () => {
    const { start, points } = walk(squirclePath(101, 51, 16.5, 0.6, -0.5));
    expect(start).toEqual([25, -0.5]);
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(-0.5, 1);
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(50.5, 1);
  });
});
