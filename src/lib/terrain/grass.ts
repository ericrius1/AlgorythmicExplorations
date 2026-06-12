// Grass: the terrain's first inhabitant. A blade is seven vertices; a meadow
// is one merged geometry holding a hundred thousand of them, animated in the
// vertex shader so the CPU never touches a blade again after planting day.
// Placement reads the erosion ledger from part 2 — grass roots where the
// rain left soil, and refuses slopes the rain stripped bare.

import * as THREE from "three/webgpu";
import { attribute, positionLocal, sin, uniform, vec3, float } from "three/tsl";
import { hash2 } from "./noise";
import type { ErosionGrid } from "./erosion";

// @types/three loses the fluent node interface through attribute(); this alias
// puts the swizzles and operators back (same dodge as lib/bear/material.ts).
import type { Node } from "three/webgpu";
type Vec4Node = Node<"vec4">;

export interface GrassBlade {
  x: number;
  y: number;
  z: number;
  yaw: number;
  height: number;
  width: number;
  lean: number; // static bend, before any wind
  phase: number; // where this blade lives in the gust cycle
  flex: number; // how much the wind moves it (tall young grass vs stiff tufts)
  r: number;
  g: number;
  b: number;
}

// Bilinear read of an eroded grid: height, slope magnitude, and the sediment
// ledger (positive = the rain left soil here).
export function sampleGrid(grid: ErosionGrid, x: number, z: number): { h: number; slope: number; delta: number } {
  const { W, size, heights, delta } = grid;
  const gx = Math.min(W - 2.001, Math.max(0, ((x + size / 2) / size) * (W - 1)));
  const gz = Math.min(W - 2.001, Math.max(0, ((z + size / 2) / size) * (W - 1)));
  const xi = Math.floor(gx), zi = Math.floor(gz);
  const fx = gx - xi, fz = gz - zi;
  const i00 = xi + zi * W;
  const bil = (a: Float32Array): number =>
    a[i00] * (1 - fx) * (1 - fz) + a[i00 + 1] * fx * (1 - fz) + a[i00 + W] * (1 - fx) * fz + a[i00 + W + 1] * fx * fz;
  const h = bil(heights);
  const cell = size / (W - 1);
  const dhdx = (heights[i00 + 1] - heights[i00]) / cell;
  const dhdz = (heights[i00 + W] - heights[i00]) / cell;
  return { h, slope: Math.hypot(dhdx, dhdz), delta: bil(delta) };
}

export interface ScatterOptions {
  count: number; // candidates attempted; survivors depend on the ground
  seed: number;
  maxSlope?: number; // rise/run above which grass gives up
  minH01?: number; // fraction of amplitude: above = snow, below = water (later)
  maxH01?: number;
  depositBoost?: number; // extra planting probability per unit of rain-laid silt
}

const C_GREEN = new THREE.Color().setHex(0x5d8038, THREE.SRGBColorSpace);
const C_LIGHT = new THREE.Color().setHex(0x93b052, THREE.SRGBColorSpace);
const C_DRY = new THREE.Color().setHex(0xa39a58, THREE.SRGBColorSpace);

export function scatterOnGrid(grid: ErosionGrid, amplitude: number, opts: ScatterOptions): GrassBlade[] {
  const maxSlope = opts.maxSlope ?? 0.85;
  const minH01 = opts.minH01 ?? 0.02;
  const maxH01 = opts.maxH01 ?? 0.52;
  const boost = opts.depositBoost ?? 10;
  const half = grid.size / 2 - grid.cellWorld;
  const blades: GrassBlade[] = [];
  const c = new THREE.Color();

  for (let k = 0; k < opts.count; k++) {
    const x = (hash2(k, 3, opts.seed) * 2 - 1) * half;
    const z = (hash2(k, 71, opts.seed) * 2 - 1) * half;
    const g = sampleGrid(grid, x, z);
    const h01 = g.h / amplitude;
    if (h01 < minH01 || h01 > maxH01) continue;
    if (g.slope > maxSlope) continue;

    // the ledger vote: bare odds on untouched ground, near-certain on silt,
    // fading on ground the rain cut down to rock
    let p = 0.55 + Math.min(0.45, Math.max(0, g.delta) * boost);
    if (g.delta < 0) p *= Math.max(0.15, 1 + g.delta * 8);
    p *= 1 - smooth01((h01 - maxH01 * 0.7) / (maxH01 * 0.3)); // thinning toward the line
    if (hash2(k, 211, opts.seed) > p) continue;

    const tall = 0.55 + 0.45 * hash2(k, 401, opts.seed);
    const dry = 0.65 * hash2(k, 631, opts.seed) + 0.3 * smooth01(h01 / maxH01);
    c.copy(C_GREEN).lerp(C_LIGHT, hash2(k, 503, opts.seed)).lerp(C_DRY, dry * 0.55);

    blades.push({
      x,
      y: g.h - 0.01,
      z,
      yaw: hash2(k, 97, opts.seed) * Math.PI * 2,
      height: 0.1 + 0.16 * tall,
      width: 0.012 + 0.012 * hash2(k, 157, opts.seed),
      lean: 0.05 + 0.22 * hash2(k, 307, opts.seed),
      phase: hash2(k, 769, opts.seed) * Math.PI * 2,
      flex: 0.45 + 0.8 * tall, // tall grass throws further in the wind
      r: c.r,
      g: c.g,
      b: c.b,
    });
  }
  return blades;
}

const smooth01 = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

// ---- geometry: every blade in one buffer ---------------------------------------------

// Each blade: SEG quads tapering to a tip vertex. Vertices carry their final
// world position (with the static lean baked in), a color, and aWind =
// (bend factor t², gust phase, flex, 0) — everything the vertex shader needs
// to move the blade without knowing what a blade is.
export interface GrassBuild {
  geometry: THREE.BufferGeometry;
  bladeCount: number;
  vertexCount: number;
}

export function buildGrassGeometry(blades: GrassBlade[], segments = 3): GrassBuild {
  const rows = segments; // vertex pair rows below the tip
  const vPer = rows * 2 + 1;
  const tPer = (rows - 1) * 2 + 1;
  const n = blades.length;

  const positions = new Float32Array(n * vPer * 3);
  const normals = new Float32Array(n * vPer * 3);
  const colors = new Float32Array(n * vPer * 3);
  const wind = new Float32Array(n * vPer * 4);
  const indices = new Uint32Array(n * tPer * 3);

  let pv = 0, iv = 0;
  for (let b = 0; b < n; b++) {
    const bl = blades[b];
    const cy = Math.cos(bl.yaw), sy = Math.sin(bl.yaw);
    const base = pv;

    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const halfW = (bl.width * (1 - t * 0.85)) / 2;
      // static lean: the blade is a quadratic curve even on a still day
      const bendX = bl.lean * t * t * bl.height;
      const yDrop = bl.lean * bl.lean * t * t * 0.3 * bl.height;
      const yy = bl.y + t * bl.height - yDrop;
      const tipRow = r === rows;
      const count = tipRow ? 1 : 2;
      for (let s = 0; s < count; s++) {
        const side = tipRow ? 0 : s === 0 ? -halfW : halfW;
        const lx = side, lz = bendX;
        positions[pv * 3] = bl.x + lx * cy + lz * sy;
        positions[pv * 3 + 1] = yy;
        positions[pv * 3 + 2] = bl.z - lx * sy + lz * cy;
        // soft up-facing normals: grass lights like a field, not like razors
        normals[pv * 3] = sy * 0.25;
        normals[pv * 3 + 1] = 0.97;
        normals[pv * 3 + 2] = cy * 0.25;
        const shade = 0.45 + 0.55 * t; // rooted in its own shadow
        colors[pv * 3] = bl.r * shade;
        colors[pv * 3 + 1] = bl.g * shade;
        colors[pv * 3 + 2] = bl.b * shade;
        wind[pv * 4] = t * t;
        wind[pv * 4 + 1] = bl.phase;
        wind[pv * 4 + 2] = bl.flex * bl.height;
        wind[pv * 4 + 3] = 0;
        pv++;
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      const a = base + r * 2;
      indices[iv++] = a; indices[iv++] = a + 1; indices[iv++] = a + 2;
      indices[iv++] = a + 1; indices[iv++] = a + 3; indices[iv++] = a + 2;
    }
    const a = base + (rows - 1) * 2;
    indices[iv++] = a; indices[iv++] = a + 1; indices[iv++] = a + 2; // the tip
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aWind", new THREE.BufferAttribute(wind, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return { geometry, bladeCount: n, vertexCount: n * vPer };
}

// ---- the material: wind lives here ---------------------------------------------------

export interface GrassMaterial {
  material: THREE.MeshStandardNodeMaterial;
  time: { value: number };
  strength: { value: number };
  gustScale: { value: number };
}

// Two traveling sine waves of different wavelength and speed stand in for a
// gust field — cheap, periodic only if you wait minutes, and evaluated per
// vertex so the whole meadow costs the GPU one extra add-and-multiply chain.
export function makeGrassMaterial(): GrassMaterial {
  const time = uniform(0);
  const strength = uniform(0.5);
  const gustScale = uniform(0.55);

  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });

  const data = attribute("aWind", "vec4") as unknown as Vec4Node;
  const p = positionLocal;
  // gust(x, z, t): big slow swells plus small fast flutter, sampled at the
  // vertex (a blade is tiny next to a gust, so root vs tip doesn't matter)
  const w1 = p.x.mul(gustScale).add(p.z.mul(gustScale.mul(0.7))).add(time.mul(1.7)).add(data.y);
  const w2 = p.x.mul(gustScale.mul(2.9)).sub(p.z.mul(gustScale.mul(2.1))).add(time.mul(3.4)).add(data.y.mul(1.7));
  const gust = sin(w1).mul(0.7).add(sin(w2).mul(0.3));
  // wind never pushes negative: blades lean with the prevailing direction
  // and oscillate around that lean
  const sway = gust.mul(0.5).add(0.62).mul(strength).mul(data.x).mul(data.z);
  const droop = sway.mul(sway).mul(float(-0.45)); // arcs shorten, not stretch
  material.positionNode = p.add(vec3(sway.mul(0.82), droop, sway.mul(0.57)));

  return { material, time, strength, gustScale };
}
