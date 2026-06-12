// Biomes and placement: what grows where, decided by the same hash as the
// mountains. Everything here is a pure function of world position — the
// moisture field, the biome classification, the jittered-grid placement —
// because part 6 is going to call it chunk by chunk, and two neighboring
// chunks must agree about every tree on their border without ever meeting.

import * as THREE from "three/webgpu";
import { fbm2, hash2 } from "./noise";
import { terrainHeight, type TerrainParams } from "./heightmap";
import type { GrassBlade } from "./grass";

// ---- the climate ------------------------------------------------------------------------

export interface ScatterParams {
  seed: number;
  moistureFreq: number; // cycles per world unit — broader than the terrain's
  moistureOffset: number; // -0.5 (drought) … +0.5 (everything is fern)
  treeLine: number; // h01 above which no tree survives
  treeCell: number; // one tree candidate per cell of this size (world units)
  rockCell: number;
}

export const SCATTER_DEFAULTS: ScatterParams = {
  seed: 7,
  moistureFreq: 0.035,
  moistureOffset: 0,
  treeLine: 0.45,
  treeCell: 3.4,
  rockCell: 5.0,
};

// Rainfall as a second, broader noise field. Real moisture follows drainage
// (part 2 computed exactly that), but drainage is history and this must stay
// a function — the standing compromise of this series.
export function moisture(x: number, z: number, p: ScatterParams): number {
  const m = fbm2(x * p.moistureFreq + 3.7, z * p.moistureFreq - 9.1, { octaves: 3, seed: p.seed + 401 });
  return Math.min(1, Math.max(0, m * 0.5 + 0.5 + p.moistureOffset));
}

export type Biome = "meadow" | "forest" | "scrub" | "scree" | "alpine" | "cliff";

export const BIOME_COLORS: Record<Biome, number> = {
  meadow: 0x6d8c43,
  forest: 0x3d5e31,
  scrub: 0x9a8d5c,
  scree: 0x7d7166,
  alpine: 0xe9eef4,
  cliff: 0x55504a,
};

// Altitude stands in for temperature, the noise stands in for rainfall, and
// slope gets a veto — a pocket Whittaker diagram.
export function classify(h01: number, slope: number, m: number, p: ScatterParams): Biome {
  if (slope > 0.55) return "cliff";
  if (h01 > p.treeLine + 0.17) return "alpine";
  if (h01 > p.treeLine) return m > 0.5 ? "meadow" : "scree";
  if (m > 0.52) return "forest";
  if (m > 0.3) return "meadow";
  return "scrub";
}

// Convenience: full ground report at a point — height, slope, moisture, biome.
export function groundAt(
  x: number,
  z: number,
  tp: TerrainParams,
  sp: ScatterParams,
): { h: number; h01: number; slope: number; m: number; biome: Biome } {
  const h = terrainHeight(x, z, tp);
  const eps = 0.35;
  const dhdx = (terrainHeight(x + eps, z, tp) - terrainHeight(x - eps, z, tp)) / (2 * eps);
  const dhdz = (terrainHeight(x, z + eps, tp) - terrainHeight(x, z - eps, tp)) / (2 * eps);
  const slope = Math.hypot(dhdx, dhdz);
  const m = moisture(x, z, sp);
  const h01 = h / tp.amplitude;
  return { h, h01, slope, m, biome: classify(h01, slope, m, sp) };
}

// ---- placement: the jittered grid --------------------------------------------------------

// One candidate per grid cell, jittered by the cell's hash. The cells are
// indexed in *world* coordinates (floor(x / cell)), so any region query over
// any chunk boundary reproduces the identical trees. Poisson-disk gives
// prettier spacing, but its samples depend on their neighbors — and
// neighbor-dependence is exactly what chunked worlds can't afford.
export interface ScatterItem {
  kind: "tree" | "rock";
  variant: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export function scatterItems(
  tp: TerrainParams,
  sp: ScatterParams,
  region: { minX: number; minZ: number; maxX: number; maxZ: number },
): ScatterItem[] {
  const out: ScatterItem[] = [];

  const walk = (
    cell: number,
    salt: number,
    place: (x: number, z: number, ci: number, cj: number) => void,
  ): void => {
    const i0 = Math.floor(region.minX / cell), i1 = Math.floor(region.maxX / cell);
    const j0 = Math.floor(region.minZ / cell), j1 = Math.floor(region.maxZ / cell);
    for (let cj = j0; cj <= j1; cj++) {
      for (let ci = i0; ci <= i1; ci++) {
        const x = (ci + 0.12 + 0.76 * hash2(ci, cj * 3 + salt, sp.seed)) * cell;
        const z = (cj + 0.12 + 0.76 * hash2(ci * 5 + salt, cj, sp.seed)) * cell;
        if (x < region.minX || x >= region.maxX || z < region.minZ || z >= region.maxZ) continue;
        place(x, z, ci, cj);
      }
    }
  };

  // trees: forest cells almost always, meadows occasionally, edges thinned
  walk(sp.treeCell, 17, (x, z, ci, cj) => {
    const g = groundAt(x, z, tp, sp);
    if (g.slope > 0.5 || g.h01 > sp.treeLine) return;
    let p = 0;
    if (g.biome === "forest") p = 0.92;
    else if (g.biome === "meadow") p = 0.1;
    else if (g.biome === "scrub") p = 0.05;
    p *= 1 - smooth01((g.h01 - (sp.treeLine - 0.12)) / 0.12); // krummholz fade
    if (hash2(ci * 7, cj * 11, sp.seed + 23) > p) return;
    const nearLine = smooth01((g.h01 - (sp.treeLine - 0.2)) / 0.2);
    out.push({
      kind: "tree",
      variant: (hash2(ci, cj, sp.seed + 31) * 4) | 0,
      x,
      y: g.h - 0.05,
      z,
      yaw: hash2(ci * 13, cj * 17, sp.seed) * Math.PI * 2,
      scale: (0.75 + 0.6 * hash2(ci * 19, cj * 23, sp.seed)) * (1 - 0.45 * nearLine), // stunted at altitude
    });
  });

  // rocks: scree and alpine mostly, anywhere occasionally
  walk(sp.rockCell, 71, (x, z, ci, cj) => {
    const g = groundAt(x, z, tp, sp);
    if (g.slope > 0.85) return;
    let p = 0.08;
    if (g.biome === "scree") p = 0.75;
    else if (g.biome === "alpine" || g.biome === "cliff") p = 0.45;
    else if (g.biome === "scrub") p = 0.22;
    if (hash2(ci * 7 + 2, cj * 11 + 2, sp.seed + 67) > p) return;
    out.push({
      kind: "rock",
      variant: (hash2(ci + 9, cj + 9, sp.seed + 41) * 3) | 0,
      x,
      y: g.h - 0.06,
      z,
      yaw: hash2(ci * 13 + 4, cj * 17 + 4, sp.seed) * Math.PI * 2,
      scale: 0.25 + 0.85 * Math.pow(hash2(ci * 19 + 6, cj * 23 + 6, sp.seed), 2), // many pebbles, few boulders
    });
  });

  return out;
}

const smooth01 = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

// ---- grass by the same rules --------------------------------------------------------------

// Function-of-position grass (part 3 planted from the erosion ledger; this
// plants from the climate, so chunks can do it). Density follows biome.
const C_GREEN = new THREE.Color().setHex(0x5d8038, THREE.SRGBColorSpace);
const C_LIGHT = new THREE.Color().setHex(0x93b052, THREE.SRGBColorSpace);
const C_DRY = new THREE.Color().setHex(0xa39a58, THREE.SRGBColorSpace);

export function grassBlades(
  tp: TerrainParams,
  sp: ScatterParams,
  region: { minX: number; minZ: number; maxX: number; maxZ: number },
  candidates: number,
  seed: number,
): GrassBlade[] {
  const blades: GrassBlade[] = [];
  const c = new THREE.Color();
  const w = region.maxX - region.minX, d = region.maxZ - region.minZ;

  for (let k = 0; k < candidates; k++) {
    const x = region.minX + hash2(k, 3, seed) * w;
    const z = region.minZ + hash2(k, 71, seed) * d;
    const g = groundAt(x, z, tp, sp);
    let p = 0;
    if (g.biome === "meadow") p = 0.9;
    else if (g.biome === "forest") p = 0.45;
    else if (g.biome === "scrub") p = 0.25;
    else if (g.biome === "scree") p = 0.06;
    if (hash2(k, 211, seed) > p) continue;

    const tall = (0.55 + 0.45 * hash2(k, 401, seed)) * (0.6 + 0.5 * g.m);
    const dry = (1 - g.m) * 0.8 + 0.25 * hash2(k, 631, seed);
    c.copy(C_GREEN).lerp(C_LIGHT, hash2(k, 503, seed)).lerp(C_DRY, Math.min(1, dry) * 0.6);

    blades.push({
      x,
      y: g.h - 0.01,
      z,
      yaw: hash2(k, 97, seed) * Math.PI * 2,
      height: 0.1 + 0.16 * tall,
      width: 0.012 + 0.012 * hash2(k, 157, seed),
      lean: 0.05 + 0.22 * hash2(k, 307, seed),
      phase: hash2(k, 769, seed) * Math.PI * 2,
      flex: 0.45 + 0.8 * tall,
      r: c.r,
      g: c.g,
      b: c.b,
    });
  }
  return blades;
}

// ---- rocks ----------------------------------------------------------------------------------

const C_ROCK_LO = new THREE.Color().setHex(0x564f48, THREE.SRGBColorSpace);
const C_ROCK_HI = new THREE.Color().setHex(0x8a8178, THREE.SRGBColorSpace);

// A rock is an icosahedron that's been argued with: each vertex pushed in or
// out by its hash, the bottom flattened, every facet given its own tone.
export function buildRockGeometry(variant: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const pos = ico.getAttribute("position");
  const seed = 977 + variant * 131;

  // displace shared directions consistently: hash on the *direction*, so the
  // non-indexed icosahedron's coincident corners move together and stay sealed
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const key1 = Math.round(v.x * 37 + v.y * 53 + v.z * 71);
    const key2 = Math.round(v.x * 19 - v.y * 29 + v.z * 43);
    const bump = 0.72 + 0.55 * hash2(key1, key2, seed);
    v.multiplyScalar(bump);
    v.y = Math.max(v.y * (0.55 + 0.25 * hash2(key2, key1, seed)), -0.25); // sat-in-the-ground bottom
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  const flat = ico.toNonIndexed();
  flat.computeVertexNormals(); // non-indexed → face normals → facets
  const fp = flat.getAttribute("position");
  const colors = new Float32Array(fp.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < fp.count; f += 3) {
    c.copy(C_ROCK_LO).lerp(C_ROCK_HI, hash2(f, variant, seed));
    for (let s = 0; s < 3; s++) {
      colors[(f + s) * 3] = c.r;
      colors[(f + s) * 3 + 1] = c.g;
      colors[(f + s) * 3 + 2] = c.b;
    }
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}
