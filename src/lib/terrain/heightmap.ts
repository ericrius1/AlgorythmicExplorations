// From noise to landscape: the height function (warped, ridged fBm shaped to
// keep its valleys), and a builder that stands it up as a colored, lit mesh.
// The same function will drive every part of this series — erosion will carve
// it, grass will sample it, trees will root in it, and the infinite world will
// tile it — so it lives here, alone, with no idea what a vertex is.

import * as THREE from "three/webgpu";
import { fbm2 } from "./noise";
import { bakeLight, type HeightSampler } from "./light";

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

const C_GRASS = new THREE.Color().setHex(0x4f6a32, THREE.SRGBColorSpace);
const C_SCREE = new THREE.Color().setHex(0x7d7166, THREE.SRGBColorSpace);
const C_ROCK = new THREE.Color().setHex(0x665f58, THREE.SRGBColorSpace);
const C_SNOW = new THREE.Color().setHex(0xe9eef4, THREE.SRGBColorSpace);

const smooth = (a: number, b: number, t: number): number => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

// h01 = height as a fraction of amplitude, slope = 1 − normal.y.
export function heightColor(h01: number, slope: number, out: THREE.Color): THREE.Color {
  out.copy(C_GRASS).lerp(C_SCREE, smooth(0.4, 0.7, h01));
  out.lerp(C_ROCK, smooth(0.25, 0.5, slope)); // steep ground sheds its soil
  const snow = smooth(0.6, 0.72, h01) * (1 - smooth(0.3, 0.55, slope)); // snow refuses steeps
  return out.lerp(C_SNOW, snow);
}

// ---- the mesh -----------------------------------------------------------------------

export interface TerrainBuild {
  geometry: THREE.BufferGeometry;
  vertexCount: number;
  triangleCount: number;
  buildMs: number;
  // the (n+1)² heights, row-major from (centerX − size/2, centerZ − size/2)
  heights: Float32Array;
}

export interface TerrainBuildOptions {
  size?: number;
  segments?: number;
  centerX?: number;
  centerZ?: number;
  skirt?: number; // depth of the crack-hiding curtain around the border
  skirtTint?: [number, number, number, number]; // paint the skirt (a block-diagram side)
  hole?: number; // leave out quads inside this half-width (a far ring around a near patch)
  light?: { sun: { x: number; y: number; z: number }; reach?: number; outside?: HeightSampler };
  // paint per vertex: (x, z, height, slope as rise/run) → linear rgb + weight
  tint?: (x: number, z: number, h: number, slope: number) => [number, number, number, number];
}

export function buildTerrainGeometry(p: TerrainParams, opts: TerrainBuildOptions = {}): TerrainBuild {
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
  const margin = new Float32Array(MW * MW);
  let s = 0;
  for (let j = -1; j <= n + 1; j++) {
    const z = cz - half + j * step;
    for (let i = -1; i <= n + 1; i++) {
      margin[s++] = terrainHeight(cx - half + i * step, z, p);
    }
  }
  const H = (i: number, j: number): number => margin[i + 1 + MW * (j + 1)];

  const heights = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) heights[i + W * j] = H(i, j);

  const positions = new Float32Array(W * W * 3);
  const normals = new Float32Array(W * W * 3);
  const lightAttr = new Float32Array(W * W * 2).fill(1);
  const tint = new Float32Array(W * W * 4);

  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const v = i + W * j;
      positions[v * 3] = cx - half + i * step;
      positions[v * 3 + 1] = H(i, j);
      positions[v * 3 + 2] = cz - half + j * step;

      // central differences on the height grid: the normal is (−dh/dx, 1, −dh/dz)
      const dhdx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const dhdz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const inv = 1 / Math.hypot(dhdx, 1, dhdz);
      normals[v * 3] = -dhdx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -dhdz * inv;
      if (opts.tint) tint.set(opts.tint(positions[v * 3], positions[v * 3 + 2], H(i, j), Math.hypot(dhdx, dhdz)), v * 4);
    }
  }

  if (opts.light) {
    const baked = bakeLight(heights, W, W, cx - half, cz - half, step, opts.light.sun, {
      reach: opts.light.reach,
      outside: opts.light.outside,
    });
    lightAttr.set(baked);
  }

  const hole = opts.hole ?? 0;
  const inHole = (x: number, z: number): boolean => Math.abs(x - cx) < hole - 1e-4 && Math.abs(z - cz) < hole - 1e-4;
  const quads: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (hole > 0) {
        const xm = cx - half + (i + 0.5) * step, zm = cz - half + (j + 0.5) * step;
        if (inHole(xm, zm)) continue;
      }
      quads.push(i + W * j);
    }
  }

  // the skirt: each border vertex gets a twin pushed straight down, and the
  // wall between them hides the cracks where a coarser neighbor chunk meets
  // this one (both windings, so the wall shows from every side). A ring with
  // a hole gets one around the hole's rim as well.
  const lines: number[][] = [];
  if (opts.skirt) {
    const side = (f: (k: number) => number, from: number, to: number): number[] => {
      const out: number[] = [];
      for (let k = from; k <= to; k++) out.push(f(k));
      return out;
    };
    lines.push(side((i) => i, 0, n), side((i) => i + W * n, 0, n), side((j) => W * j, 0, n), side((j) => n + W * j, 0, n));
    if (hole > 0) {
      const h0 = Math.round((half - hole) / step), h1 = Math.round((half + hole) / step);
      lines.push(
        side((i) => i + W * h0, h0, h1),
        side((i) => i + W * h1, h0, h1),
        side((j) => h0 + W * j, h0, h1),
        side((j) => h1 + W * j, h0, h1),
      );
    }
  }
  const SW = lines.reduce((m, l) => m + l.length, 0);
  const wallQuads = lines.reduce((m, l) => m + l.length - 1, 0);

  const indices = new Uint32Array(quads.length * 6 + wallQuads * 12);
  let q = 0;
  for (const a of quads) {
    const b = a + 1;
    const d = a + W;
    const e = d + 1;
    indices[q++] = a; indices[q++] = d; indices[q++] = b;
    indices[q++] = b; indices[q++] = d; indices[q++] = e;
  }

  let posOut = positions, normOut = normals, lightOut = lightAttr, tintOut = tint;
  let vertCount = W * W;
  if (opts.skirt && SW > 0) {
    posOut = new Float32Array((W * W + SW) * 3);
    normOut = new Float32Array((W * W + SW) * 3);
    lightOut = new Float32Array((W * W + SW) * 2);
    tintOut = new Float32Array((W * W + SW) * 4);
    posOut.set(positions); normOut.set(normals); lightOut.set(lightAttr); tintOut.set(tint);
    let dst = W * W;
    for (const line of lines) {
      const first = dst;
      for (const src of line) {
        posOut[dst * 3] = positions[src * 3];
        posOut[dst * 3 + 1] = positions[src * 3 + 1] - opts.skirt;
        posOut[dst * 3 + 2] = positions[src * 3 + 2];
        for (let c = 0; c < 3; c++) normOut[dst * 3 + c] = normals[src * 3 + c];
        lightOut[dst * 2] = lightAttr[src * 2] * 0.8;
        lightOut[dst * 2 + 1] = lightAttr[src * 2 + 1] * 0.8;
        if (opts.skirtTint) {
          tintOut.set(opts.skirtTint, dst * 4);
          tintOut.set(opts.skirtTint, src * 4); // the rim of the top, too, so the edge reads as a cut
        }
        dst++;
      }
      for (let k = 0; k < line.length - 1; k++) {
        const a = line[k], b = line[k + 1];
        const sa = first + k, sb = sa + 1;
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
  geometry.setAttribute("aLight", new THREE.BufferAttribute(lightOut, 2));
  geometry.setAttribute("aTint", new THREE.BufferAttribute(tintOut, 4));
  geometry.setAttribute("aWater", new THREE.BufferAttribute(new Float32Array(vertCount), 1)); // dry; the erosion meshes fill theirs
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return {
    geometry,
    vertexCount: vertCount,
    triangleCount: q / 3,
    buildMs: performance.now() - t0,
    heights,
  };
}
