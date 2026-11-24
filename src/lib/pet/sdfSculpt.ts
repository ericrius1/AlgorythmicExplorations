// Organic SDF + Surface Nets Sculpting Engine for Small Minds companions.
// Inspired by Eric Levin's sevenhavens/src/bison/mesh.ts:
//   - Smooth-min (smin) polynomial blends eliminate hard sphere/cylinder seams
//   - Surface Nets extracts a clean, watertight quad-split triangle mesh
//   - 2-step Newton projection snaps vertices cleanly onto the exact f(p) = 0 surface
//   - Analytical SDF central-difference normals give silky-smooth shading
//   - 4-tap SDF directional AO + local thickness (for real subsurface scattering!)
//     are baked straight into vertex attributes (`aAo`, `aThick`, `color`)!

import * as THREE from "three/webgpu";

export type Vec3 = [number, number, number];

// ---- SDF Primitives & Smooth Boolean Ops -----------------------------------

export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

export function sdSphere(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  return Math.hypot(x - cx, y - cy, z - cz) - r;
}

/** IQ ellipsoid distance bound (smooth and accurate near surface) */
export function sdEllipsoid(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
): number {
  const qx = (x - cx) / rx;
  const qy = (y - cy) / ry;
  const qz = (z - cz) / rz;
  const k0 = Math.hypot(qx, qy, qz);
  const k1 = Math.hypot(qx / rx, qy / ry, qz / rz);
  return k1 > 1e-8 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

/** Round cone / tapered organic limb or ear from point A(r1) to B(r2) */
export function sdRoundCone(
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r1: number,
  r2: number,
): number {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-10) return Math.hypot(x - ax, y - ay, z - az) - Math.max(r1, r2);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const yy = pax * bax + pay * bay + paz * baz;
  const zz = yy - l2;
  const wx = pax * l2 - bax * yy;
  const wy = pay * l2 - bay * yy;
  const wz = paz * l2 - baz * yy;
  const x2 = wx * wx + wy * wy + wz * wz;
  const y2 = yy * yy * l2;
  const z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(Math.max(0, x2 * a2 * il2)) + yy * rr) * il2 - r1;
}

/** Capsule segment from A to B with radius r */
export function sdCapsule(
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
): number {
  const pax = x - ax;
  const pay = y - ay;
  const paz = z - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const h = l2 > 1e-10 ? Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / l2)) : 0;
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

/** Rounded box centered at (cx, cy, cz) */
export function sdRoundBox(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
): number {
  const qx = Math.abs(x - cx) - bx + r;
  const qy = Math.abs(y - cy) - by + r;
  const qz = Math.abs(z - cz) - bz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** Deterministic 3D smooth value noise [0, 1] for organic fur/tuft contours */
function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function sdfNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(
      lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux),
      lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux),
      uy,
    ),
    lerp(
      lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux),
      lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux),
      uy,
    ),
    uz,
  );
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---- Surface Nets Mesher + Baked Analytical Normals, AO & SSS Thickness ----

export interface SdfSculptOptions {
  /** Signed distance function (< 0 inside, > 0 outside) */
  sdf: (x: number, y: number, z: number) => number;
  /** Bounding box min [x, y, z] */
  min: Vec3;
  /** Bounding box max [x, y, z] */
  max: Vec3;
  /** Voxel grid cell size (smaller = finer detail; 0.022..0.032 is ideal for ~0.9m pets) */
  cell: number;
  /** Per-vertex linear RGB color & optional SSS thickness bias [r, g, b, extraTranslucency?] */
  paint: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => [number, number, number, number?];
  /** Optional smooth relaxation passes before projecting back onto exact SDF surface (default 1) */
  smoothPasses?: number;
}

/**
 * Extracts a silky-smooth, watertight BufferGeometry from an organic SDF field.
 * Includes attributes:
 *  - position (vec3)
 *  - normal   (vec3, analytical SDF gradient)
 *  - color    (vec3, linear sRGB coat markings & gradients)
 *  - aAo      (float, 0..1 baked SDF ambient occlusion)
 *  - aThick   (float, 0..1 thinness/translucency for backlit subsurface scattering!)
 */
export function buildSdfGeometry(opts: SdfSculptOptions): THREE.BufferGeometry {
  const { sdf, min: lo, max: hi, cell, paint } = opts;
  const nx = Math.ceil((hi[0] - lo[0]) / cell);
  const ny = Math.ceil((hi[1] - lo[1]) / cell);
  const nz = Math.ceil((hi[2] - lo[2]) / cell);
  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;

  const val = new Float32Array(sx * sy * sz);
  for (let k = 0; k < sz; k++) {
    const z = lo[2] + k * cell;
    for (let j = 0; j < sy; j++) {
      const y = lo[1] + j * cell;
      const base = sx * (j + sy * k);
      for (let i = 0; i < sx; i++) {
        val[base + i] = sdf(lo[0] + i * cell, y, z);
      }
    }
  }

  const at = (i: number, j: number, k: number) => val[i + sx * (j + sy * k)];
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const cid = (i: number, j: number, k: number) => i + nx * (j + ny * k);

  const corner = (c: number): Vec3 => [c & 1, (c >> 1) & 1, (c >> 2) & 1];
  const edges: [number, number][] = [];
  for (let a = 0; a < 8; a++) {
    for (const bit of [1, 2, 4]) {
      if (!(a & bit)) edges.push([a, a | bit]);
    }
  }

  const pos: number[] = [];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let m = 0;
        for (const [a, b] of edges) {
          if ((cv[a] < 0) === (cv[b] < 0)) continue;
          const t = cv[a] / (cv[a] - cv[b]);
          const A = corner(a);
          const B = corner(b);
          px += A[0] + (B[0] - A[0]) * t;
          py += A[1] + (B[1] - A[1]) * t;
          pz += A[2] + (B[2] - A[2]) * t;
          m++;
        }
        cellVert[cid(i, j, k)] = pos.length / 3;
        pos.push(lo[0] + (i + px / m) * cell, lo[1] + (j + py / m) * cell, lo[2] + (k + pz / m) * cell);
      }
    }
  }

  const tris: number[] = [];
  const P = (v: number): Vec3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const dims = [nx, ny, nz];
    for (let k = 0; k < sz; k++) {
      for (let j = 0; j < sy; j++) {
        for (let i = 0; i < sx; i++) {
          const c = [i, j, k];
          if (c[axis] >= dims[axis] || c[u] < 1 || c[v] < 1 || c[u] >= dims[u] || c[v] >= dims[v]) continue;
          const e = [i, j, k];
          e[axis]++;
          const a0 = at(i, j, k);
          const a1 = at(e[0], e[1], e[2]);
          if ((a0 < 0) === (a1 < 0)) continue;
          const cellAt = (du: number, dv: number) => {
            const q = [i, j, k];
            q[u] -= du;
            q[v] -= dv;
            return cellVert[cid(q[0], q[1], q[2])];
          };
          const q0 = cellAt(1, 1);
          const q1 = cellAt(0, 1);
          const q2 = cellAt(0, 0);
          const q3 = cellAt(1, 0);
          if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
          const A = P(q0);
          const B = P(q1);
          const C = P(q2);
          const D = P(q3);
          const d02 = (A[0] - C[0]) ** 2 + (A[1] - C[1]) ** 2 + (A[2] - C[2]) ** 2;
          const d13 = (B[0] - D[0]) ** 2 + (B[1] - D[1]) ** 2 + (B[2] - D[2]) ** 2;
          const quad = d02 <= d13 ? [q0, q1, q2, q0, q2, q3] : [q0, q1, q3, q1, q2, q3];
          const outward = a0 < 0 ? 1 : -1;
          for (let s = 0; s < 6; s += 3) {
            const p0 = P(quad[s]);
            const p1 = P(quad[s + 1]);
            const p2 = P(quad[s + 2]);
            const e1x = p1[0] - p0[0];
            const e1y = p1[1] - p0[1];
            const e1z = p1[2] - p0[2];
            const e2x = p2[0] - p0[0];
            const e2y = p2[1] - p0[1];
            const e2z = p2[2] - p0[2];
            const nvec = [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
            if (nvec[axis] * outward >= 0) tris.push(quad[s], quad[s + 1], quad[s + 2]);
            else tris.push(quad[s], quad[s + 2], quad[s + 1]);
          }
        }
      }
    }
  }

  const nv = pos.length / 3;
  const positions = new Float32Array(pos);

  // Optional gentle Taubin/Laplacian smoothing to eliminate grid stair-stepping
  const smoothPasses = opts.smoothPasses ?? 1;
  if (smoothPasses > 0 && nv > 0) {
    const sum = new Float32Array(nv * 3);
    const cnt = new Uint16Array(nv);
    for (let pass = 0; pass < smoothPasses; pass++) {
      sum.fill(0);
      cnt.fill(0);
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t];
        const b = tris[t + 1];
        const c = tris[t + 2];
        for (const [u, v] of [
          [a, b],
          [b, c],
          [c, a],
        ]) {
          sum[u * 3] += positions[v * 3];
          sum[u * 3 + 1] += positions[v * 3 + 1];
          sum[u * 3 + 2] += positions[v * 3 + 2];
          cnt[u]++;
          sum[v * 3] += positions[u * 3];
          sum[v * 3 + 1] += positions[u * 3 + 1];
          sum[v * 3 + 2] += positions[u * 3 + 2];
          cnt[v]++;
        }
      }
      for (let i = 0; i < nv; i++) {
        if (cnt[i] === 0) continue;
        const inv = 1 / cnt[i];
        positions[i * 3] = positions[i * 3] * 0.55 + sum[i * 3] * inv * 0.45;
        positions[i * 3 + 1] = positions[i * 3 + 1] * 0.55 + sum[i * 3 + 1] * inv * 0.45;
        positions[i * 3 + 2] = positions[i * 3 + 2] * 0.55 + sum[i * 3 + 2] * inv * 0.45;
      }
    }
  }

  // 2-step Newton projection onto exact f(p) = 0 + analytical normals + SDF AO + SSS thickness!
  const eps = cell * 0.35;
  const normals = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 3);
  const aoAttr = new Float32Array(nv);
  const thickAttr = new Float32Array(nv);

  for (let i = 0; i < nv; i++) {
    let x = positions[i * 3];
    let y = positions[i * 3 + 1];
    let z = positions[i * 3 + 2];

    let gx = 0;
    let gy = 1;
    let gz = 0;
    for (let iter = 0; iter < 2; iter++) {
      const d = sdf(x, y, z);
      gx = sdf(x + eps, y, z) - sdf(x - eps, y, z);
      gy = sdf(x, y + eps, z) - sdf(x, y - eps, z);
      gz = sdf(x, y, z + eps) - sdf(x, y, z - eps);
      const gl = Math.hypot(gx, gy, gz) || 1;
      gx /= gl;
      gy /= gl;
      gz /= gl;
      const step = Math.max(-cell * 0.7, Math.min(cell * 0.7, d));
      x -= gx * step;
      y -= gy * step;
      z -= gz * step;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    normals[i * 3] = gx;
    normals[i * 3 + 1] = gy;
    normals[i * 3 + 2] = gz;

    // 4-tap SDF Ambient Occlusion (Iq's method: darkens creases under chin, ears, belly!)
    let occ = 0;
    let weight = 0.55;
    for (let s = 1; s <= 4; s++) {
      const dist = s * cell * 1.45;
      const sample = sdf(x + gx * dist, y + gy * dist, z + gz * dist);
      occ += weight * Math.max(0, (dist - sample) / dist);
      weight *= 0.58;
    }
    const ao = Math.max(0.28, Math.min(1.0, 1.0 - occ * 0.85));
    aoAttr[i] = ao;

    // Local inverted-SDF thickness estimate for physically grounded Subsurface Scattering!
    // Stepping inward along -N: thin ears, gill tips, and fin edges have positive/near-zero
    // SDF values behind them -> high translucency (1.0); thick belly cores stay deep negative -> low!
    const dIn1 = sdf(x - gx * 0.055, y - gy * 0.055, z - gz * 0.055);
    const dIn2 = sdf(x - gx * 0.125, y - gy * 0.125, z - gz * 0.125);
    const thinness = Math.max(0, Math.min(1, 0.5 + (dIn1 + dIn2) * 5.2));

    const [r, g, b, extraSss] = paint(x, y, z, gx, gy, gz);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    thickAttr[i] = Math.max(0, Math.min(1, Math.max(thinness, extraSss ?? 0)));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aAo", new THREE.BufferAttribute(aoAttr, 1));
  geo.setAttribute("aThick", new THREE.BufferAttribute(thickAttr, 1));
  geo.setIndex(tris);
  geo.computeBoundingSphere();
  return geo;
}
