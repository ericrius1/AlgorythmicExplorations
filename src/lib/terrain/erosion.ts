// Hydraulic erosion: rain as an algorithm. A droplet lands on the height
// grid, rolls downhill with a little momentum, picks up sediment while it is
// fast and hungry, drops it when it slows — and a few hundred thousand of
// them carve the fBm into drainage. This file knows nothing about meshes
// except the one builder at the bottom that stands a carved grid back up.

import * as THREE from "three/webgpu";
import { hash2 } from "./noise";
import { heightColor, terrainHeight, type TerrainParams } from "./heightmap";

export interface ErosionParams {
  inertia: number; // 0 = water follows the gradient exactly, 1 = never turns
  capacity: number; // sediment a droplet can hold per unit of slope · speed · water
  deposition: number; // fraction of surplus dropped per step when over capacity
  erosion: number; // fraction of remaining capacity taken from the ground per step
  evaporation: number; // fraction of water lost per step
  radius: number; // erosion brush radius in cells — digs wide, not needle-thin
  gravity: number;
  maxSteps: number;
}

export const EROSION_DEFAULTS: ErosionParams = {
  inertia: 0.06,
  capacity: 3.5,
  deposition: 0.25,
  erosion: 0.55,
  evaporation: 0.012,
  radius: 2.5,
  gravity: 4,
  maxSteps: 96,
};

// A height grid the droplets can chew on: W×W samples of the part-1 height
// function over a size×size patch, plus a parallel "delta" grid recording
// net carve (negative) / deposit (positive) for the colorist.
export interface ErosionGrid {
  W: number;
  size: number;
  cellWorld: number; // world units per cell
  heights: Float32Array;
  delta: Float32Array;
  droplets: number;
}

export function makeErosionGrid(p: TerrainParams, size: number, W: number): ErosionGrid {
  const heights = new Float32Array(W * W);
  const half = size / 2;
  const step = size / (W - 1);
  let s = 0;
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      heights[s++] = terrainHeight(i * step - half, j * step - half, p);
    }
  }
  return { W, size, cellWorld: step, heights, delta: new Float32Array(W * W), droplets: 0 };
}

// Bilinear height and gradient at a fractional cell coordinate. The gradient
// is what the droplet feels; bilinear keeps it continuous so paths don't snap
// to the lattice.
function sample(h: Float32Array, W: number, x: number, y: number): { height: number; gx: number; gy: number } {
  const xi = Math.min(W - 2, Math.max(0, Math.floor(x)));
  const yi = Math.min(W - 2, Math.max(0, Math.floor(y)));
  const fx = x - xi, fy = y - yi;
  const i00 = xi + yi * W;
  const h00 = h[i00], h10 = h[i00 + 1], h01 = h[i00 + W], h11 = h[i00 + W + 1];
  return {
    height: h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy,
    gx: (h10 - h00) * (1 - fy) + (h11 - h01) * fy,
    gy: (h01 - h00) * (1 - fx) + (h11 - h10) * fx,
  };
}

// One droplet, start to evaporation. Mutates grid.heights and grid.delta.
export function traceDroplet(
  grid: ErosionGrid,
  p: ErosionParams,
  startX: number,
  startY: number,
  path?: Float32Array, // optional: records x,y per step for the visualizer
): number {
  const { W, heights, delta } = grid;
  let x = startX, y = startY;
  let dx = 0, dy = 0;
  let speed = 1, water = 1, sediment = 0;
  let steps = 0;

  // precompute the brush once per radius — offsets and normalized weights
  const r = Math.max(1, p.radius);
  const ri = Math.ceil(r);

  for (; steps < p.maxSteps; steps++) {
    if (path) {
      path[steps * 2] = x;
      path[steps * 2 + 1] = y;
    }
    const here = sample(heights, W, x, y);

    // direction: blend old momentum with the downhill gradient
    dx = dx * p.inertia - here.gx * (1 - p.inertia);
    dy = dy * p.inertia - here.gy * (1 - p.inertia);
    const len = Math.hypot(dx, dy);
    if (len < 1e-7) break; // flat — the droplet ponds
    dx /= len;
    dy /= len;

    const nx = x + dx, ny = y + dy;
    if (nx < 1 || ny < 1 || nx > W - 2 || ny > W - 2) break; // ran off the map

    const there = sample(heights, W, nx, ny);
    const dh = there.height - here.height; // negative when moving downhill

    // how much can this droplet carry right now?
    const cap = Math.max(-dh, 0.01) * speed * water * p.capacity;

    if (sediment > cap || dh > 0) {
      // too full, or moving uphill: deposit. Uphill drops fill the pit they
      // climbed out of (up to the height difference), which is what levels
      // lake floors.
      const drop = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * p.deposition;
      sediment -= drop;
      // deposit bilinearly at the current cell
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const i00 = xi + yi * W;
      heights[i00] += drop * (1 - fx) * (1 - fy);
      heights[i00 + 1] += drop * fx * (1 - fy);
      heights[i00 + W] += drop * (1 - fx) * fy;
      heights[i00 + W + 1] += drop * fx * fy;
      delta[i00] += drop * (1 - fx) * (1 - fy);
      delta[i00 + 1] += drop * fx * (1 - fy);
      delta[i00 + W] += drop * (1 - fx) * fy;
      delta[i00 + W + 1] += drop * fx * fy;
    } else {
      // hungry: erode, but never more than the drop — overshooting digs
      // spikes below the line the droplet is travelling
      const take = Math.min((cap - sediment) * p.erosion, -dh);
      // spread the take over a soft brush so channels come out valley-shaped
      // instead of one cell wide
      let wsum = 0;
      const cx = Math.floor(x), cy = Math.floor(y);
      for (let by = -ri; by <= ri; by++) {
        for (let bx = -ri; bx <= ri; bx++) {
          const d = Math.hypot(bx, by);
          if (d > r) continue;
          const gx2 = cx + bx, gy2 = cy + by;
          if (gx2 < 0 || gy2 < 0 || gx2 >= W || gy2 >= W) continue;
          wsum += 1 - d / r;
        }
      }
      if (wsum > 0) {
        for (let by = -ri; by <= ri; by++) {
          for (let bx = -ri; bx <= ri; bx++) {
            const d = Math.hypot(bx, by);
            if (d > r) continue;
            const gx2 = cx + bx, gy2 = cy + by;
            if (gx2 < 0 || gy2 < 0 || gx2 >= W || gy2 >= W) continue;
            const w = (1 - d / r) / wsum;
            heights[gx2 + gy2 * W] -= take * w;
            delta[gx2 + gy2 * W] -= take * w;
          }
        }
      }
      sediment += take;
    }

    speed = Math.sqrt(Math.max(0, speed * speed + -dh * p.gravity));
    water *= 1 - p.evaporation;
    if (water < 0.01) break;
    x = nx;
    y = ny;
  }
  return steps;
}

// A rainstorm: n droplets at hashed positions. Returns droplets actually run.
export function rain(grid: ErosionGrid, p: ErosionParams, n: number, seed: number): number {
  const W = grid.W;
  for (let k = 0; k < n; k++) {
    const id = grid.droplets + k;
    const x = 1 + hash2(id, 17, seed) * (W - 3);
    const y = 1 + hash2(id, 91, seed) * (W - 3);
    traceDroplet(grid, p, x, y);
  }
  grid.droplets += n;
  return n;
}

// ---- standing a carved grid back up ---------------------------------------------

// Like buildTerrainGeometry, but the heights come from an eroded grid instead
// of the pristine function, and fresh sediment gets its own paint: exposed
// cuts read as raw rock, deposits as pale alluvium.
const C_CUT = new THREE.Color().setHex(0x5d544c, THREE.SRGBColorSpace);
const C_SILT = new THREE.Color().setHex(0x9a8c72, THREE.SRGBColorSpace);

export function buildGridGeometry(
  grid: ErosionGrid,
  amplitude: number,
  opts: { tint?: boolean } = {},
): THREE.BufferGeometry {
  const { W, size, heights, delta } = grid;
  const n = W - 1;
  const step = size / n;
  const half = size / 2;
  const tint = opts.tint ?? true;

  const H = (i: number, j: number): number =>
    heights[Math.min(n, Math.max(0, i)) + W * Math.min(n, Math.max(0, j))];

  const positions = new Float32Array(W * W * 3);
  const normals = new Float32Array(W * W * 3);
  const colors = new Float32Array(W * W * 3);
  const c = new THREE.Color();

  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const v = i + W * j;
      positions[v * 3] = i * step - half;
      positions[v * 3 + 1] = H(i, j);
      positions[v * 3 + 2] = j * step - half;

      const dhdx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const dhdz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const inv = 1 / Math.hypot(dhdx, 1, dhdz);
      normals[v * 3] = -dhdx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -dhdz * inv;

      const mottle = 0.92 + 0.16 * hash2(i * 7 + 13, j * 7 + 5, 0);
      heightColor(H(i, j) / amplitude, 1 - inv, c).multiplyScalar(mottle);
      if (tint) {
        const d = delta[v];
        if (d < 0) c.lerp(C_CUT, Math.min(1, -d * 14)); // carved: raw rock
        else if (d > 0) c.lerp(C_SILT, Math.min(1, d * 18)); // dropped: alluvium
      }
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
  return geometry;
}

// Refresh an existing buildGridGeometry result after more rain — rewrites
// heights, normals, and paint in place so the storm demos don't reallocate
// a hundred thousand vertices every update.
export function updateGridGeometry(
  geometry: THREE.BufferGeometry,
  grid: ErosionGrid,
  amplitude: number,
  opts: { tint?: boolean } = {},
): void {
  const { W, size, heights, delta } = grid;
  const n = W - 1;
  const step = size / n;
  const tint = opts.tint ?? true;
  const positions = (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const normals = (geometry.getAttribute("normal") as THREE.BufferAttribute).array as Float32Array;
  const colors = (geometry.getAttribute("color") as THREE.BufferAttribute).array as Float32Array;
  const c = new THREE.Color();

  const H = (i: number, j: number): number =>
    heights[Math.min(n, Math.max(0, i)) + W * Math.min(n, Math.max(0, j))];

  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const v = i + W * j;
      positions[v * 3 + 1] = H(i, j);

      const dhdx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const dhdz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const inv = 1 / Math.hypot(dhdx, 1, dhdz);
      normals[v * 3] = -dhdx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -dhdz * inv;

      const mottle = 0.92 + 0.16 * hash2(i * 7 + 13, j * 7 + 5, 0);
      heightColor(H(i, j) / amplitude, 1 - inv, c).multiplyScalar(mottle);
      if (tint) {
        const d = delta[v];
        if (d < 0) c.lerp(C_CUT, Math.min(1, -d * 14));
        else if (d > 0) c.lerp(C_SILT, Math.min(1, d * 18));
      }
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
  }
  geometry.getAttribute("position").needsUpdate = true;
  geometry.getAttribute("normal").needsUpdate = true;
  geometry.getAttribute("color").needsUpdate = true;
}
