// The bear as a function. f(p) returns the signed distance from point p to the
// bear's surface: negative inside, positive outside, zero exactly on the skin.
// The whole animal is capsules combined with a smooth minimum — the polynomial
// smin popularized by Inigo Quilez — so parts merge with fillets instead of
// creases. Part 1 polygonizes this function; everything later animates the
// mesh it produced.

import { BONES, type BoneDef } from "./skeleton";

// Distance to a "round cone" — a capsule whose radius tapers from r0 at a to
// r1 at b. The classic two-sphere-and-a-cone-hull distance.
export function sdCapsule(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r0: number, r1: number,
): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  let h = l2 > 1e-12 ? (pax * bax + pay * bay + paz * baz) / l2 : 0;
  h = Math.max(0, Math.min(1, h));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.hypot(dx, dy, dz) - (r0 + (r1 - r0) * h);
}

// Quilez's polynomial smooth minimum: like min(a, b) but with a blend zone of
// width k where the two shapes negotiate a fillet instead of intersecting.
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

export interface FieldOptions {
  radiusScale?: number; // inflate/deflate every capsule
  blendScale?: number; // scale every smooth-union width (0 = hard union)
}

// The assembled bear. Evaluates every capsule and folds them together with
// per-bone blend widths. ~25 capsules; cheap enough to call millions of times.
export function bearField(x: number, y: number, z: number, opts?: FieldOptions): number {
  const rs = opts?.radiusScale ?? 1;
  const bs = opts?.blendScale ?? 1;
  let d = 1e9;
  for (const b of BONES) {
    const di = sdCapsule(x, y, z, b.head[0], b.head[1], b.head[2], b.tail[0], b.tail[1], b.tail[2], b.r0 * rs, b.r1 * rs);
    d = smin(d, di, b.blend * bs);
  }
  return d;
}

// Distance to one named bone's capsule alone — the skin-weight computation in
// part 2 asks this for every (vertex, bone) pair.
export function boneDistance(b: BoneDef, x: number, y: number, z: number): number {
  return sdCapsule(x, y, z, b.head[0], b.head[1], b.head[2], b.tail[0], b.tail[1], b.tail[2], b.r0, b.r1);
}

// Field gradient by central differences — used as the mesh normal. For a true
// SDF the gradient *is* the surface normal, and it is smoother than anything
// you could average from the triangles.
export function bearGradient(x: number, y: number, z: number, opts?: FieldOptions): [number, number, number] {
  const e = 0.004;
  const gx = bearField(x + e, y, z, opts) - bearField(x - e, y, z, opts);
  const gy = bearField(x, y + e, z, opts) - bearField(x, y - e, z, opts);
  const gz = bearField(x, y, z + e, opts) - bearField(x, y, z - e, opts);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

// Axis-aligned bounds the marcher samples inside (a little padding past the fur).
export const FIELD_BOUNDS = {
  min: [-0.62, -0.02, -0.45] as [number, number, number],
  max: [0.62, 1.92, 0.5] as [number, number, number],
};
