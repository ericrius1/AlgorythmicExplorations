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
  opts: { size?: number; segments?: number; centerX?: number; centerZ?: number; skirt?: number } = {},
): TerrainBuild {
  const t0 = performance.now();
  const size = opts.size ?? 14;
  const n = opts.segments ?? 192;
  const cx = opts.centerX ?? 0;
  const cz = opts.centerZ ?? 0;
  const step = size / n;
  const half = size / 2;

  // sample the height function once per lattice point, with one row of margin
  // beyond each edge — the function is pure, so the margin is exact, and it
  // keeps border normals two-sided (chunked worlds shade seamlessly)
  const W = n + 1;
  const MW = W + 2;
  const heights = new Float32Array(MW * MW);
  let s = 0;
  for (let j = -1; j <= n + 1; j++) {
    const z = cz - half + j * step;
    for (let i = -1; i <= n + 1; i++) {
      heights[s++] = terrainHeight(cx - half + i * step, z, p);
    }
  }
  const H = (i: number, j: number): number => heights[i + 1 + MW * (j + 1)];

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

  const indices = new Uint32Array(n * n * 6 + (opts.skirt ? 4 * n * 12 : 0));
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

  // the skirt: each border vertex gets a twin pushed straight down, and the
  // wall between them hides the cracks where a coarser neighbor chunk meets
  // this one (both windings, so the wall shows from every side)
  let posOut = positions, normOut = normals, colOut = colors;
  let vertCount = W * W;
  if (opts.skirt) {
    const edge: number[] = [];
    for (let i = 0; i < W; i++) edge.push(i); // top
    for (let i = 0; i < W; i++) edge.push(i + W * n); // bottom
    for (let j = 0; j < W; j++) edge.push(W * j); // left
    for (let j = 0; j < W; j++) edge.push(n + W * j); // right

    const SW = edge.length;
    posOut = new Float32Array((W * W + SW) * 3);
    normOut = new Float32Array((W * W + SW) * 3);
    colOut = new Float32Array((W * W + SW) * 3);
    posOut.set(positions); normOut.set(normals); colOut.set(colors);
    for (let k = 0; k < SW; k++) {
      const src = edge[k] * 3, dst = (W * W + k) * 3;
      posOut[dst] = positions[src];
      posOut[dst + 1] = positions[src + 1] - opts.skirt;
      posOut[dst + 2] = positions[src + 2];
      normOut[dst] = normals[src]; normOut[dst + 1] = normals[src + 1]; normOut[dst + 2] = normals[src + 2];
      colOut[dst] = colors[src] * 0.85; colOut[dst + 1] = colors[src + 1] * 0.85; colOut[dst + 2] = colors[src + 2] * 0.85;
    }
    for (let e2 = 0; e2 < 4; e2++) {
      for (let i = 0; i < n; i++) {
        const a = edge[e2 * W + i];
        const b = edge[e2 * W + i + 1];
        const sa = W * W + e2 * W + i;
        const sb = sa + 1;
        indices[q++] = a; indices[q++] = b; indices[q++] = sa;
        indices[q++] = b; indices[q++] = sb; indices[q++] = sa;
        indices[q++] = a; indices[q++] = sa; indices[q++] = b;
        indices[q++] = b; indices[q++] = sa; indices[q++] = sb;
      }
    }
    vertCount += SW;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(posOut, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normOut, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colOut, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return {
    geometry,
    vertexCount: vertCount,
    triangleCount: indices.length / 3,
    buildMs: performance.now() - t0,
  };
}
