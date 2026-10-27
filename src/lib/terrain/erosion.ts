// Hydraulic erosion: rain as an algorithm. A droplet lands on the height
// grid, rolls downhill with a little momentum, picks up sediment while it is
// fast and hungry, drops it when it slows — and a few hundred thousand of
// them carve the fBm into drainage. This file knows nothing about meshes
// except the one builder at the bottom that stands a carved grid back up.

import * as THREE from "three/webgpu";
import { hash2 } from "./noise";
import { terrainHeight, type TerrainParams } from "./heightmap";
import { bakeSun, bakeOcclusion, type HeightSampler } from "./light";

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
  // optional: how much water has run through each cell (for drawing streams)
  flow?: Float32Array;
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
  return { W, size, cellWorld: step, heights, delta: new Float32Array(W * W), droplets: 0, flow: new Float32Array(W * W) };
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

// The erosion brush: cell offsets inside the radius and their weights
// (1 − d/r, normalized to sum to 1). Built once per radius and reused by
// every droplet.
interface Brush { count: number; reach: number; dx: Int32Array; dy: Int32Array; w: Float32Array }
const brushes = new Map<number, Brush>();
function brushFor(radius: number): Brush {
  const r = Math.max(1, radius);
  let b = brushes.get(r);
  if (b) return b;
  const ri = Math.ceil(r);
  const dx: number[] = [], dy: number[] = [], w: number[] = [];
  let sum = 0;
  for (let by = -ri; by <= ri; by++) {
    for (let bx = -ri; bx <= ri; bx++) {
      const d = Math.hypot(bx, by);
      if (d > r) continue;
      dx.push(bx); dy.push(by); w.push(1 - d / r);
      sum += 1 - d / r;
    }
  }
  b = { count: w.length, reach: ri, dx: Int32Array.from(dx), dy: Int32Array.from(dy), w: Float32Array.from(w.map((v) => v / sum)) };
  brushes.set(r, b);
  return b;
}

// No carving within this many cells (plus the brush radius) of the border.
// Droplets that reach the edge leave the map and take their sediment with
// them, so a hole dug near the edge never gets refilled, and it deepens
// without limit as more droplets fall into it. Deposits are still allowed
// there, and they can only ever add back what was dug elsewhere.
const EDGE = 2;

// One droplet, start to evaporation. Mutates grid.heights and grid.delta
// (and grid.flow, when the grid keeps one).
export function traceDroplet(
  grid: ErosionGrid,
  p: ErosionParams,
  startX: number,
  startY: number,
  path?: Float32Array, // optional: records x, y, speed, sediment per step for the visualizer
): number {
  const { W, heights, delta } = grid;
  let x = startX, y = startY;
  let dx = 0, dy = 0;
  let speed = 1, water = 1, sediment = 0;
  let steps = 0;

  const brush = brushFor(p.radius);
  const flow = grid.flow;

  for (; steps < p.maxSteps; steps++) {
    if (path) {
      path[steps * 4] = x;
      path[steps * 4 + 1] = y;
      path[steps * 4 + 2] = speed;
      path[steps * 4 + 3] = sediment;
    }
    const here = sample(heights, W, x, y);
    if (flow) flow[Math.round(x) + Math.round(y) * W] += water;

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
      // instead of one cell wide. Near the border there's no erosion at all
      // (see EDGE).
      const cx = Math.floor(x), cy = Math.floor(y);
      const r = brush.reach + EDGE;
      if (cx >= r && cy >= r && cx <= W - 1 - r && cy <= W - 1 - r) {
        for (let b = 0; b < brush.count; b++) {
          const k = cx + brush.dx[b] + (cy + brush.dy[b]) * W;
          const w = take * brush.w[b];
          heights[k] -= w;
          delta[k] -= w;
        }
        sediment += take;
      }
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

// The carved grid as a mesh for the terrain shader (look.ts): heights and
// normals from the grid, aLight from the bake, aTint for the sediment paint
// (fresh cuts darken toward raw rock, deposits pale toward silt), and aWater
// from the flow record, so the streams the droplets wore in show as water.

export interface GridMeshOptions {
  tint?: boolean; // sediment paint
  water?: boolean; // write aWater from grid.flow
  skirt?: number; // a wall around the border
  skirtTint?: [number, number, number, number];
  taper?: number; // cells over which carving fades out at the border (to meet unweathered ground)
  sun?: THREE.Vector3; // bake shadows toward this sun
  reach?: number;
  outside?: HeightSampler; // heights beyond the grid, for the shadow march
  groundTint?: Float32Array; // rgba per grid vertex, used when the sediment paint is off (a meadow's soil)
}

const C_CUT: [number, number, number] = [0.105, 0.088, 0.075]; // linear
const C_SILT: [number, number, number] = [0.33, 0.27, 0.19];

interface GridMeshState {
  disp: Float32Array; // displayed heights (carving tapered at the border)
  light: Float32Array; // interleaved sun, occlusion
  sunRow: number; // next row to re-light
  opts: GridMeshOptions;
}

function displayHeights(grid: ErosionGrid, opts: GridMeshOptions, out: Float32Array): void {
  const { W, heights, delta } = grid;
  const taper = opts.taper ?? 0;
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const v = i + j * W;
      if (taper <= 0) {
        out[v] = heights[v];
        continue;
      }
      const e = Math.min(i, j, W - 1 - i, W - 1 - j) / taper;
      const f = e >= 1 ? 1 : e * e * (3 - 2 * e);
      out[v] = heights[v] - delta[v] * (1 - f);
    }
  }
}

export function buildGridGeometry(grid: ErosionGrid, opts: GridMeshOptions = {}): THREE.BufferGeometry {
  const { W } = grid;
  const n = W - 1;
  const skirtLen = opts.skirt ? 4 * W : 0;
  const NV = W * W + skirtLen;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NV * 3), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(NV * 3), 3));
  geometry.setAttribute("aLight", new THREE.BufferAttribute(new Float32Array(NV * 2).fill(1), 2));
  geometry.setAttribute("aTint", new THREE.BufferAttribute(new Float32Array(NV * 4), 4));
  geometry.setAttribute("aWater", new THREE.BufferAttribute(new Float32Array(NV), 1));

  const indices: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = i + W * j, b = a + 1, d = a + W, e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  if (opts.skirt) {
    const edge: number[] = [];
    for (let i = 0; i < W; i++) edge.push(i);
    for (let i = 0; i < W; i++) edge.push(i + W * n);
    for (let j = 0; j < W; j++) edge.push(W * j);
    for (let j = 0; j < W; j++) edge.push(n + W * j);
    geometry.userData.edge = edge;
    for (let e2 = 0; e2 < 4; e2++) {
      for (let i = 0; i < n; i++) {
        const a = edge[e2 * W + i], b = edge[e2 * W + i + 1];
        const sa = W * W + e2 * W + i, sb = sa + 1;
        indices.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb);
      }
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));

  const state: GridMeshState = { disp: new Float32Array(W * W), light: new Float32Array(W * W * 2).fill(1), sunRow: 0, opts };
  geometry.userData.state = state;
  displayHeights(grid, opts, state.disp);
  if (opts.sun) {
    const half = grid.size / 2;
    bakeSun(state.disp, W, W, -half, -half, grid.cellWorld, opts.sun, state.light, { reach: opts.reach, outside: opts.outside });
  }
  updateGridGeometry(geometry, grid, { relight: 0 });
  return geometry;
}

// Refresh after more rain: heights, normals, paint, and water in place, so
// the storm demos don't reallocate a hundred thousand vertices each update.
// Occlusion is recomputed every time (it's cheap); the sun shadows are
// re-marched `relight` rows per call, since they change slowly.
export function updateGridGeometry(
  geometry: THREE.BufferGeometry,
  grid: ErosionGrid,
  o: { relight?: number; heights?: Float32Array; tint?: boolean; water?: boolean; wetScale?: number } = {},
): void {
  const state = geometry.userData.state as GridMeshState;
  const opts = state.opts;
  const { W, size, delta } = grid;
  const n = W - 1;
  const step = size / n;
  const half = size / 2;
  const disp = state.disp;
  if (o.heights) disp.set(o.heights);
  else displayHeights(grid, opts, disp);
  const tint = o.tint ?? opts.tint ?? false;

  const positions = (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const normals = (geometry.getAttribute("normal") as THREE.BufferAttribute).array as Float32Array;
  const lightA = (geometry.getAttribute("aLight") as THREE.BufferAttribute).array as Float32Array;
  const tintA = (geometry.getAttribute("aTint") as THREE.BufferAttribute).array as Float32Array;
  const waterA = (geometry.getAttribute("aWater") as THREE.BufferAttribute).array as Float32Array;

  const H = (i: number, j: number): number => disp[Math.min(n, Math.max(0, i)) + W * Math.min(n, Math.max(0, j))];

  if (opts.sun && (o.relight ?? 0) > 0) {
    const from = state.sunRow;
    const to = Math.min(W, from + (o.relight ?? 0));
    bakeSun(disp, W, W, -half, -half, step, opts.sun, state.light, { reach: opts.reach, outside: opts.outside, rowFrom: from, rowTo: to });
    state.sunRow = to >= W ? 0 : to;
  }
  bakeOcclusion(disp, W, W, step, state.light);

  // the flow record, smoothed a little and compared with the average cell
  let mean = 0;
  const flow = grid.flow;
  const water = (o.water ?? true) && opts.water && flow;
  if (water) {
    for (let v = 0; v < W * W; v++) mean += flow[v];
    mean = mean / (W * W) || 1;
  }

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

      lightA[v * 2] = state.light[v * 2];
      lightA[v * 2 + 1] = state.light[v * 2 + 1];

      let tr = 0, tg = 0, tb = 0, tw = 0;
      if (!tint && opts.groundTint) {
        tr = opts.groundTint[v * 4]; tg = opts.groundTint[v * 4 + 1]; tb = opts.groundTint[v * 4 + 2]; tw = opts.groundTint[v * 4 + 3];
      }
      if (tint) {
        const d = delta[v];
        if (d < 0) { tw = Math.min(0.75, -d * 6); tr = C_CUT[0]; tg = C_CUT[1]; tb = C_CUT[2]; }
        else if (d > 0) { tw = Math.min(0.85, d * 9); tr = C_SILT[0]; tg = C_SILT[1]; tb = C_SILT[2]; }
      }
      tintA[v * 4] = tr; tintA[v * 4 + 1] = tg; tintA[v * 4 + 2] = tb; tintA[v * 4 + 3] = tw;

      let wet = 0;
      if (water) {
        let f = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = Math.min(n, Math.max(0, i + di)), jj = Math.min(n, Math.max(0, j + dj));
          f += flow![ii + jj * W] * (di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1);
        }
        const ratio = f / 16 / mean;
        const t = Math.min(1, Math.max(0, (Math.log(ratio) - 0.95) / 1.25));
        wet = t * t * (3 - 2 * t) * (o.wetScale ?? 1);
      }
      waterA[v] = wet;
    }
  }

  const edge = geometry.userData.edge as number[] | undefined;
  if (opts.skirt && edge) {
    for (let k = 0; k < edge.length; k++) {
      const src = edge[k], dst = W * W + k;
      positions[dst * 3] = positions[src * 3];
      positions[dst * 3 + 1] = positions[src * 3 + 1] - opts.skirt;
      positions[dst * 3 + 2] = positions[src * 3 + 2];
      for (let c = 0; c < 3; c++) normals[dst * 3 + c] = normals[src * 3 + c];
      lightA[dst * 2] = lightA[src * 2] * 0.8;
      lightA[dst * 2 + 1] = lightA[src * 2 + 1] * 0.8;
      if (opts.skirtTint) {
        tintA.set(opts.skirtTint, dst * 4);
        tintA.set(opts.skirtTint, src * 4);
      }
      waterA[dst] = 0;
    }
  }

  for (const name of ["position", "normal", "aLight", "aTint", "aWater"]) geometry.getAttribute(name).needsUpdate = true;
}

// Re-march the sun for the next `rows` rows of a grid mesh (call every frame
// during a storm; updateGridGeometry copies the result into the attribute).
export function relightGrid(geometry: THREE.BufferGeometry, grid: ErosionGrid, rows: number): void {
  const state = geometry.userData.state as GridMeshState;
  const opts = state.opts;
  if (!opts.sun) return;
  const { W, size } = grid;
  const from = state.sunRow;
  const to = Math.min(W, from + rows);
  bakeSun(state.disp, W, W, -size / 2, -size / 2, size / (W - 1), opts.sun, state.light, {
    reach: opts.reach,
    outside: opts.outside,
    rowFrom: from,
    rowTo: to,
  });
  state.sunRow = to >= W ? 0 : to;
}
