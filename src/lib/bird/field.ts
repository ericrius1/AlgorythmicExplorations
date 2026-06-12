// The wren as a function. f(p) returns the signed distance from point p to
// the bird's surface: negative inside, positive outside, zero exactly on the
// skin. The whole animal is tapered capsules — some squashed flat, because
// feathers are panels — combined with the polynomial smooth minimum, so parts
// merge with fillets instead of creases. Part 1 polygonizes this function;
// the rest of the series animates the mesh it produced.

import { BIRD_BONES, type BirdBone } from "./skeleton";

// Distance to a tapered capsule: closest point on the segment, radius lerped
// along it. With `flat`, the offset from the segment is stretched along one
// axis before measuring, which thins the shape to a blade (s = thickness
// scale). Not an exact SDF under the squash, but the polygonizer and the
// gradient only need "honest near zero", and it is.
export function sdBone(b: BirdBone, px: number, py: number, pz: number): number {
  const ax = b.head[0], ay = b.head[1], az = b.head[2];
  const bax = b.tail[0] - ax, bay = b.tail[1] - ay, baz = b.tail[2] - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  let h = l2 > 1e-12 ? (pax * bax + pay * bay + paz * baz) / l2 : 0;
  h = Math.max(0, Math.min(1, h));
  let dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  if (b.flat) {
    const [nx, ny, nz] = b.flat.axis;
    const along = (dx * nx + dy * ny + dz * nz) * (1 / b.flat.s - 1);
    dx += nx * along;
    dy += ny * along;
    dz += nz * along;
  }
  return Math.hypot(dx, dy, dz) - (b.r0 + (b.r1 - b.r0) * h);
}

// Quilez's polynomial smooth minimum: min(a, b) with a blend zone of width k
// where the two shapes negotiate a fillet instead of intersecting.
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

export interface FieldOptions {
  radiusScale?: number; // inflate/deflate every capsule — the fluff dial
  blendScale?: number; // scale every smooth-union width (0 = hard union)
}

// The assembled wren. Evaluates every capsule and folds them together with
// per-bone blend widths. ~17 capsules; cheap enough to call millions of times.
export function birdField(x: number, y: number, z: number, opts?: FieldOptions): number {
  const rs = opts?.radiusScale ?? 1;
  const bs = opts?.blendScale ?? 1;
  let d = 1e9;
  for (const b of BIRD_BONES) {
    let di = sdBone(b, x, y, z);
    if (rs !== 1) di -= (b.r0 + b.r1) * 0.5 * (rs - 1);
    d = smin(d, di, b.blend * bs);
  }
  return d;
}

// Distance to one bone's capsule alone — zone painting asks this for every
// vertex, and part 2's skin weights will ask it for every (vertex, bone) pair.
export function boneDistance(b: BirdBone, x: number, y: number, z: number): number {
  return sdBone(b, x, y, z);
}

// Field gradient by central differences — used as the mesh normal. For a
// distance field the gradient *is* the surface normal, and it is smoother
// than anything you could average from the triangles.
export function birdGradient(x: number, y: number, z: number, opts?: FieldOptions): [number, number, number] {
  const e = 0.003;
  const gx = birdField(x + e, y, z, opts) - birdField(x - e, y, z, opts);
  const gy = birdField(x, y + e, z, opts) - birdField(x, y - e, z, opts);
  const gz = birdField(x, y, z + e, opts) - birdField(x, y, z - e, opts);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

// Axis-aligned bounds the polygonizer samples inside (padding past the down).
export const FIELD_BOUNDS = {
  min: [-0.28, -0.02, -0.55] as [number, number, number],
  max: [0.28, 0.80, 0.48] as [number, number, number],
};
