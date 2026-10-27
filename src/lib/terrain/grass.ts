// Grass: the terrain's first inhabitant. A blade is seven vertices; a meadow
// is one merged geometry holding hundreds of thousands of them, animated in
// the vertex shader so the CPU never touches a blade again after planting.
// Placement reads the erosion ledger from part 2: grass roots where the rain
// left soil, and refuses slopes the rain stripped bare.

import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  attribute,
  positionLocal,
  positionWorld,
  cameraPosition,
  normalWorldGeometry,
  sin,
  uniform,
  varying,
  vec3,
  vec4,
  float,
  dot,
  normalize,
  mix,
} from "three/tsl";
import { hash2 } from "./noise";
import type { ErosionGrid } from "./erosion";
import type { Look } from "./look";

type F = Node<"float">;
type V3 = Node<"vec3">;
type V4 = Node<"vec4">;

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
  sun: number; // sun visibility at the root (from the terrain's baked light)
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
  minH01?: number; // fraction of amplitude
  maxH01?: number; // the grass line
  depositBoost?: number; // extra planting probability per unit of rain-laid silt
  // where to try: (k, u, v) → [x, z] with u, v uniform in [0, 1); default is
  // uniform over the grid
  candidate?: (k: number, u: number, v: number) => [number, number];
  scale?: number; // blade size multiplier
  sun?: (x: number, z: number) => number; // sun visibility at a point
}

const smooth01 = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

// The ledger's vote, before the hash rolls the dice: even odds on untouched
// ground, near-certain on silt, fading on ground the rain cut down to rock,
// thinning toward the grass line, and nothing on steep or high ground.
export function grassOdds(g: { h: number; slope: number; delta: number }, amplitude: number, opts: Partial<ScatterOptions> = {}): number {
  const maxSlope = opts.maxSlope ?? 0.85;
  const minH01 = opts.minH01 ?? 0.02;
  const maxH01 = opts.maxH01 ?? 0.52;
  const boost = opts.depositBoost ?? 10;
  const h01 = g.h / amplitude;
  const { slope, delta } = g;
  if (h01 < minH01 || h01 > maxH01 || slope > maxSlope) return 0;
  let p = 0.55 + Math.min(0.45, Math.max(0, delta) * boost);
  if (delta < 0) p *= Math.max(0.15, 1 + delta * 8);
  p *= 1 - smooth01((h01 - maxH01 * 0.7) / (maxH01 * 0.3));
  p *= 1 - smooth01((slope - maxSlope * 0.6) / (maxSlope * 0.4));
  return p;
}

const C_GREEN = new THREE.Color().setHex(0x3d6828, THREE.SRGBColorSpace);
const C_LIGHT = new THREE.Color().setHex(0x789c3c, THREE.SRGBColorSpace);
const C_DRY = new THREE.Color().setHex(0xa8985a, THREE.SRGBColorSpace);

export function scatterOnGrid(grid: ErosionGrid, amplitude: number, opts: ScatterOptions): GrassBlade[] {
  const maxH01 = opts.maxH01 ?? 0.52;
  const half = grid.size / 2 - grid.cellWorld;
  const blades: GrassBlade[] = [];
  const c = new THREE.Color();
  const scale = opts.scale ?? 1;

  for (let k = 0; k < opts.count; k++) {
    const u = hash2(k, 3, opts.seed), v = hash2(k, 71, opts.seed);
    const [x, z] = opts.candidate ? opts.candidate(k, u, v) : [(u * 2 - 1) * half, (v * 2 - 1) * half];
    if (Math.abs(x) > half || Math.abs(z) > half) continue;
    const g = sampleGrid(grid, x, z);
    const p = grassOdds(g, amplitude, opts);
    if (p <= 0 || hash2(k, 211, opts.seed) > p) continue;

    const h01 = g.h / amplitude;
    const tall = 0.55 + 0.45 * hash2(k, 401, opts.seed);
    const dry = 0.65 * hash2(k, 631, opts.seed) + 0.3 * smooth01(h01 / maxH01);
    c.copy(C_GREEN).lerp(C_LIGHT, hash2(k, 503, opts.seed)).lerp(C_DRY, dry * 0.45);

    blades.push({
      x,
      y: g.h - 0.01,
      z,
      yaw: hash2(k, 97, opts.seed) * Math.PI * 2,
      height: (0.1 + 0.16 * tall) * scale,
      width: (0.012 + 0.012 * hash2(k, 157, opts.seed)) * scale,
      lean: 0.05 + 0.22 * hash2(k, 307, opts.seed),
      phase: hash2(k, 769, opts.seed) * Math.PI * 2,
      flex: 0.45 + 0.8 * tall, // tall grass throws further in the wind
      sun: opts.sun ? opts.sun(x, z) : 1,
      r: c.r,
      g: c.g,
      b: c.b,
    });
  }
  return blades;
}

// Paint for the ground under a meadow: the same odds as planting, as a tint
// toward the colour of grass roots, so where blades thin out with distance
// the ground still reads as a meadow.
export const GRASS_GROUND: [number, number, number] = [0.045, 0.07, 0.022]; // linear

export function grassGroundTint(grid: ErosionGrid, amplitude: number, opts: Partial<ScatterOptions> = {}, strength = 0.85): Float32Array {
  const { W, size } = grid;
  const out = new Float32Array(W * W * 4);
  const step = size / (W - 1);
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const g = sampleGrid(grid, i * step - size / 2, j * step - size / 2);
      const v = (i + j * W) * 4;
      out[v] = GRASS_GROUND[0]; out[v + 1] = GRASS_GROUND[1]; out[v + 2] = GRASS_GROUND[2];
      out[v + 3] = Math.min(1, grassOdds(g, amplitude, opts) * 1.3) * strength;
    }
  }
  return out;
}

// ---- geometry: every blade in one buffer ---------------------------------------------

// Each blade: SEG quads tapering to a tip vertex. Vertices carry their final
// world position (with the static lean baked in), a color, and aWind =
// (bend factor t², gust phase, flex, sun) — everything the vertex shader
// needs to move the blade without knowing what a blade is.
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
        wind[pv * 4 + 3] = bl.sun;
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

// ---- the material: wind and light live here ---------------------------------------------

export interface GrassMaterial {
  material: THREE.MeshBasicNodeMaterial;
  time: { value: number };
  strength: { value: number };
  gustScale: { value: number };
}

// Two traveling sine waves of different wavelength and speed stand in for a
// gust field: cheap, and evaluated per vertex so the whole meadow costs the
// GPU one short chain of multiply-adds. The same gust value also brightens
// the blades it's bending, so the wind shows as waves of light rolling
// across the field.
export function makeGrassMaterial(look: Look): GrassMaterial {
  const time = uniform(0);
  const strength = uniform(0.5);
  const gustScale = uniform(0.55);

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });

  const data = attribute("aWind", "vec4") as unknown as V4;
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

  // light: the soft up-facing normal for the field, plus light coming
  // through the blades when you look toward the sun
  const albedo = attribute("color", "vec3") as unknown as V3;
  const t = (varying(data.x) as unknown as F).sqrt(); // 0 at the root, 1 at the tip
  const sunVis = varying(data.w) as unknown as F;
  const n = normalWorldGeometry as unknown as V3;
  // sunlight mostly reaches the upper part of each blade; lower down it's
  // shaded by the neighbours
  const reach = t.mul(0.8).add(0.2).mul(sunVis);
  const diffuse = look.lit(albedo, n, reach, float(0.7).add(t.mul(0.3)), 0.3);
  const viewToFrag = normalize(positionWorld.sub(cameraPosition)) as unknown as V3;
  const back = dot(viewToFrag, look.uSunDir).max(0).pow(6).mul(t).mul(sunVis);
  const through = albedo.mul(vec3(0.9, 1.25, 0.45)).mul(look.uSun).mul(back.mul(0.45));
  const g = (varying(gust) as unknown as F).mul(0.5).add(0.5);
  const sheen = mix(float(0.9), float(1.18), g.mul(g).mul(t)) as unknown as F;
  material.colorNode = vec4(diffuse.add(through).mul(sheen), 1);

  return { material, time, strength, gustScale };
}
