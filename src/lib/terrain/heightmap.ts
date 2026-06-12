// From noise to landscape: the height function (warped, ridged fBm shaped to
// keep its valleys), and a builder that stands it up as a colored, lit mesh.
// The same function will drive every part of this series — erosion will carve
// it, grass will sample it, trees will root in it, and the infinite world will
// tile it — so it lives here, alone, with no idea what a vertex is.

import * as THREE from "three/webgpu";
import { fbm2, hash2 } from "./noise";

export interface TerrainParams {
  seed: number;
  frequency: number; // base feature size: cycles per world unit
  amplitude: number; // peak height in world units
  octaves: number;
  ridge: number; // 0 = rolling hills, 1 = alpine crests
  warp: number; // domain-warp strength in world units
}

export const TERRAIN_DEFAULTS: TerrainParams = {
  seed: 7,
  frequency: 0.09,
  amplitude: 3.2,
  octaves: 6,
  ridge: 0.55,
  warp: 0.9,
};

// h(x, z): two low-octave fBm fields bend the coordinate frame (the domain
// warp), the main ridged fBm reads through the bent frame, and a gentle power
// curve pushes the result down so valleys stay broad and floors stay flat.
export function terrainHeight(x: number, z: number, p: TerrainParams): number {
  let u = x * p.frequency, v = z * p.frequency;
  if (p.warp > 0) {
    const w = p.warp * p.frequency;
    const qx = fbm2(u + 1.7, v + 9.2, { octaves: 3, seed: p.seed + 31 });
    const qz = fbm2(u + 8.3, v + 2.8, { octaves: 3, seed: p.seed + 67 });
    u += qx * w * 4;
    v += qz * w * 4;
  }
  const n = fbm2(u, v, { octaves: p.octaves, ridge: p.ridge, seed: p.seed });
  const h01 = Math.max(0, (n + 1) * 0.5);
  return Math.pow(h01, 1.6) * p.amplitude;
}

// ---- the palette: altitude and slope vote on every vertex --------------------------

const C_GRASS = new THREE.Color().setHex(0x55703b, THREE.SRGBColorSpace);
const C_SCREE = new THREE.Color().setHex(0x7d7166, THREE.SRGBColorSpace);
const C_ROCK = new THREE.Color().setHex(0x665f58, THREE.SRGBColorSpace);
const C_SNOW = new THREE.Color().setHex(0xe9eef4, THREE.SRGBColorSpace);

const smooth = (a: number, b: number, t: number): number => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

// h01 = height as a fraction of amplitude, slope = 1 − normal.y.
export function heightColor(h01: number, slope: number, out: THREE.Color): THREE.Color {
  out.copy(C_GRASS).lerp(C_SCREE, smooth(0.3, 0.62, h01));
  out.lerp(C_ROCK, smooth(0.22, 0.5, slope)); // steep ground sheds its soil
  const snow = smooth(0.55, 0.7, h01) * (1 - smooth(0.3, 0.55, slope)); // snow refuses steeps
  return out.lerp(C_SNOW, snow);
}

// ---- the mesh -----------------------------------------------------------------------

export interface TerrainBuild {
  geometry: THREE.BufferGeometry;
  vertexCount: number;
  triangleCount: number;
  buildMs: number;
}

export function buildTerrainGeometry(
  p: TerrainParams,
  opts: { size?: number; segments?: number; centerX?: number; centerZ?: number } = {},
): TerrainBuild {
  const t0 = performance.now();
  const size = opts.size ?? 14;
  const n = opts.segments ?? 192;
  const cx = opts.centerX ?? 0;
  const cz = opts.centerZ ?? 0;
  const step = size / n;
  const half = size / 2;

  // sample the height function once per lattice point; everything else —
  // normals included — is read back out of this grid for free
  const W = n + 1;
  const heights = new Float32Array(W * W);
  let s = 0;
  for (let j = 0; j < W; j++) {
    const z = cz - half + j * step;
    for (let i = 0; i < W; i++) {
      heights[s++] = terrainHeight(cx - half + i * step, z, p);
    }
  }
  const H = (i: number, j: number): number =>
    heights[Math.min(n, Math.max(0, i)) + W * Math.min(n, Math.max(0, j))];

  const positions = new Float32Array(W * W * 3);
  const normals = new Float32Array(W * W * 3);
  const colors = new Float32Array(W * W * 3);
  const c = new THREE.Color();

  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const v = i + W * j;
      const x = cx - half + i * step;
      const z = cz - half + j * step;
      const h = H(i, j);
      positions[v * 3] = x;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = z;

      // central differences on the height grid: the normal is (−dh/dx, 1, −dh/dz)
      const dhdx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const dhdz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const inv = 1 / Math.hypot(dhdx, 1, dhdz);
      normals[v * 3] = -dhdx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -dhdz * inv;

      const mottle = 0.92 + 0.16 * hash2(i * 7 + 13, j * 7 + 5, p.seed);
      heightColor(h / p.amplitude, 1 - inv, c).multiplyScalar(mottle);
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
  }

  const indices = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = i + W * j;
      const b = a + 1;
      const d = a + W;
      const e = d + 1;
      indices[q++] = a; indices[q++] = d; indices[q++] = b;
      indices[q++] = b; indices[q++] = d; indices[q++] = e;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return {
    geometry,
    vertexCount: W * W,
    triangleCount: n * n * 2,
    buildMs: performance.now() - t0,
  };
}
