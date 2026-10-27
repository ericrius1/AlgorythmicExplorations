// The horizon machine. The world is a grid of chunks keyed by integer
// coordinates; whatever ring of them surrounds the camera exists, everything
// else doesn't. Each chunk builds its own terrain (resolution by distance),
// asks the part-5 scatter rules for its trees and rocks (which agree across
// borders by construction), and grows grass only when the camera is close
// enough to see blades. Building is rationed by a per-frame millisecond
// budget, so the world streams in during the flight instead of stopping it.
// Past the last ring, one coarse backdrop carries the land out to the haze,
// rebuilt a few rows per frame whenever the camera has moved far enough.

import * as THREE from "three/webgpu";
import { buildTerrainGeometry, terrainHeight, type TerrainParams } from "./heightmap";
import { buildGrassGeometry, makeGrassMaterial, type GrassMaterial } from "./grass";
import { scatterItems, grassBlades, biomeTint, type ScatterParams } from "./scatter";
import { bakeSun, bakeOcclusion, gridSampler, type HeightSampler } from "./light";
import { stampTreeShadows, type TreeSpot } from "./forest";
import { makePlantKit, plantItems, disposePlanting, type PlantKit } from "./populate";
import { terrainMaterial, type Look } from "./look";

export interface ChunkWorldParams {
  chunkSize: number; // world units on a side
  ringRadius: number; // Chebyshev radius of existing chunks
  nearSegments: number; // grid resolution for rings 0–1…
  midSegments: number; // …rings 2–3…
  farSegments: number; // …and everything beyond
  scatterRings: number; // rings that get trees and rocks
  grassRings: number; // rings that get grass (much smaller)
  grassPerChunk: number; // candidate blades per grassy chunk
  budgetMs: number; // build time allowed per frame
  skirtDepth: number;
  backdrop: boolean; // the coarse land beyond the last ring
}

export const CHUNK_DEFAULTS: ChunkWorldParams = {
  chunkSize: 24,
  ringRadius: 6,
  nearSegments: 48,
  midSegments: 24,
  farSegments: 12,
  scatterRings: 3,
  grassRings: 1,
  grassPerChunk: 24_000,
  budgetMs: 6,
  skirtDepth: 4,
  backdrop: true,
};

// Resolution class by ring: 0 = full, 1 = half, 2 = quarter. The diagram in
// the article uses the same function.
export function lodClass(ring: number): number {
  return ring <= 1 ? 0 : ring <= 3 ? 1 : 2;
}

// Tints for the "LOD tint" view: cyan full, amber half, red quarter, violet backdrop.
export const LOD_TINTS: [number, number, number][] = [
  [0.1, 0.55, 0.65],
  [0.75, 0.5, 0.12],
  [0.7, 0.16, 0.12],
  [0.35, 0.2, 0.6],
];

const GRASS_PARTS = 4; // grass is planted a quarter chunk at a time, to stay inside the budget

interface Chunk {
  key: string;
  ci: number;
  cj: number;
  group: THREE.Group;
  terrain: THREE.Mesh | null;
  heights: Float32Array | null; // the terrain grid, (segments + 1)²
  lod: number; // segments used; 0 = not built yet
  tinted: boolean; // built with the LOD tint on
  spots: TreeSpot[] | null; // trees, once scattered
  planting: THREE.Group | null;
  treeLod: number;
  grass: THREE.Mesh[];
  grassParts: number;
}

export interface ChunkStats {
  live: number;
  queued: number;
  lastBuildMs: number;
  builtTotal: number;
  vertices: number;
  trees: number;
}

// Heights on a coarse world lattice, cached by tile. Shadow marching needs
// to look past a chunk's edge toward the sun; reading those far heights from
// the full height function would cost more than building the chunk.
class CoarseHeights {
  private tiles = new Map<number, Float32Array>();
  private lastKey = NaN;
  private lastTile: Float32Array | null = null;
  constructor(
    private readonly tp: TerrainParams,
    private readonly step = 2,
    private readonly n = 16,
  ) {}

  private lattice(i: number, j: number): number {
    const n = this.n;
    const ti = Math.floor(i / n), tj = Math.floor(j / n);
    const key = (ti + 32768) * 65536 + (tj + 32768);
    let t = key === this.lastKey ? this.lastTile : this.tiles.get(key);
    if (!t) {
      if (this.tiles.size > 4000) this.tiles.clear();
      t = new Float32Array(n * n);
      for (let b = 0; b < n; b++)
        for (let a = 0; a < n; a++) t[a + b * n] = terrainHeight((ti * n + a) * this.step, (tj * n + b) * this.step, this.tp);
      this.tiles.set(key, t);
    }
    this.lastKey = key;
    this.lastTile = t;
    return t[i - ti * n + (j - tj * n) * n];
  }

  readonly at: HeightSampler = (x, z) => {
    const gx = x / this.step, gz = z / this.step;
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    return (
      this.lattice(i, j) * (1 - fx) * (1 - fz) +
      this.lattice(i + 1, j) * fx * (1 - fz) +
      this.lattice(i, j + 1) * (1 - fx) * fz +
      this.lattice(i + 1, j + 1) * fx * fz
    );
  };
}

export class ChunkWorld {
  readonly scene: THREE.Scene;
  readonly tp: TerrainParams;
  readonly sp: ScatterParams;
  readonly p: ChunkWorldParams;
  readonly look: Look;
  readonly grassMat: GrassMaterial;
  readonly stats: ChunkStats = { live: 0, queued: 0, lastBuildMs: 0, builtTotal: 0, vertices: 0, trees: 0 };
  showLodTint = false;

  private chunks = new Map<string, Chunk>();
  private groundMat: THREE.MeshBasicNodeMaterial;
  private kit: PlantKit;
  private coarse: CoarseHeights;
  private tint: (x: number, z: number, h: number, slope: number) => [number, number, number, number];
  private backdrop: Backdrop | null = null;

  constructor(scene: THREE.Scene, look: Look, tp: TerrainParams, sp: ScatterParams, p: Partial<ChunkWorldParams> = {}) {
    this.scene = scene;
    this.look = look;
    this.tp = tp;
    this.sp = sp;
    this.p = { ...CHUNK_DEFAULTS, ...p };
    this.groundMat = terrainMaterial(look, { amplitude: tp.amplitude, snowLine: [0.6, 0.72] }).material;
    this.grassMat = makeGrassMaterial(look);
    this.grassMat.strength.value = 0.5;
    this.kit = makePlantKit(look, [1, 2]);
    this.coarse = new CoarseHeights(tp);
    this.tint = biomeTint(tp, sp);
    if (this.p.backdrop) {
      this.backdrop = new Backdrop(tp, look.sunDir, this.groundMat, this.tint);
      scene.add(this.backdrop.group);
    }
  }

  // Call once per frame with the camera's ground position. Does bookkeeping
  // always; does construction only while under budget.
  update(camX: number, camZ: number, budgetMs = this.p.budgetMs, backdropMs?: number): void {
    const S = this.p.chunkSize;
    const cci = Math.floor(camX / S);
    const ccj = Math.floor(camZ / S);
    const R = this.p.ringRadius;

    // retire chunks beyond the ring (+1 of hysteresis so the boundary doesn't flicker)
    for (const [key, ch] of this.chunks) {
      if (Math.max(Math.abs(ch.ci - cci), Math.abs(ch.cj - ccj)) > R + 1) {
        this.disposeChunk(ch);
        this.chunks.delete(key);
      }
    }

    // what should exist, nearest first
    const wanted: { ci: number; cj: number; ring: number }[] = [];
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        wanted.push({ ci: cci + di, cj: ccj + dj, ring: Math.max(Math.abs(di), Math.abs(dj)) });
      }
    }
    wanted.sort((a, b) => a.ring - b.ring);

    const t0 = performance.now();
    let queued = 0;
    for (const w of wanted) {
      const key = `${w.ci},${w.cj}`;
      let ch = this.chunks.get(key);
      if (!ch) {
        ch = { key, ci: w.ci, cj: w.cj, group: new THREE.Group(), terrain: null, heights: null, lod: 0, tinted: false, spots: null, planting: null, treeLod: -1, grass: [], grassParts: 0 };
        this.chunks.set(key, ch);
        this.scene.add(ch.group);
      }
      // population the camera has left far behind is dropped (cheap, so
      // it doesn't wait for the budget); it comes back by the same rules
      if (w.ring > this.p.grassRings + 1 && ch.grassParts > 0) this.dropGrass(ch);
      if (w.ring > this.p.scatterRings + 1 && ch.planting) {
        ch.group.remove(ch.planting);
        disposePlanting(ch.planting);
        ch.planting = null;
        ch.spots = null;
        ch.treeLod = -1;
      }
      const lodWant = this.segmentsFor(w.ring);
      const treeLodWant = w.ring <= 1 ? 1 : 2;
      const needsTerrain = ch.lod !== lodWant || ch.tinted !== this.showLodTint;
      const needsScatter = w.ring <= this.p.scatterRings && (ch.spots === null || ch.treeLod !== treeLodWant);
      const needsGrass = ch.grassParts < GRASS_PARTS && w.ring <= this.p.grassRings;
      if (!needsTerrain && !needsScatter && !needsGrass) continue;

      if (performance.now() - t0 > budgetMs) {
        queued++;
        continue; // over budget: it stays on the wish list for next frame
      }
      const b0 = performance.now();
      if (needsTerrain) this.buildTerrain(ch, lodWant);
      else if (needsScatter) this.buildScatter(ch, treeLodWant);
      else if (needsGrass) this.buildGrass(ch);
      this.stats.lastBuildMs = performance.now() - b0;
      this.stats.builtTotal++;
    }

    // the backdrop's hole has to stay inside the chunk ring wherever the
    // camera wanders before the next rebuild finishes
    if (this.backdrop) {
      this.backdrop.tinted = this.showLodTint;
      this.backdrop.update(camX, camZ, Math.max(S, R * S - Backdrop.SLACK), backdropMs ?? (queued > 0 ? 1 : 2.5));
    }

    let verts = 0, trees = 0;
    for (const ch of this.chunks.values()) {
      if (ch.terrain) verts += ch.terrain.geometry.getAttribute("position").count;
      if (ch.spots && ch.planting) trees += ch.spots.length;
    }
    this.stats.live = this.chunks.size;
    this.stats.queued = queued;
    this.stats.vertices = verts;
    this.stats.trees = trees;
  }

  // Build everything the camera position wants, yielding to the browser
  // between slices, so a hero can start complete instead of popping in.
  async prefill(camX: number, camZ: number): Promise<void> {
    for (let k = 0; k < 400; k++) {
      this.update(camX, camZ, 14, 14);
      const bdDone = !this.backdrop || this.backdrop.ready;
      if (this.stats.queued === 0 && bdDone && k > 0) {
        // one more pass to catch work that finished exactly on the budget line
        this.update(camX, camZ, 1000, 0);
        if (this.stats.queued === 0) return;
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Throw away the backdrop's progress and rebuild it at once (after the
  // ring radius changes, say).
  rebuildBackdropNow(camX: number, camZ: number): void {
    if (!this.backdrop) return;
    const S = this.p.chunkSize;
    this.backdrop.force(camX, camZ, Math.max(S, this.p.ringRadius * S - Backdrop.SLACK));
  }

  setTime(seconds: number): void {
    this.grassMat.time.value = seconds;
    this.kit.treeMats.time.value = seconds;
  }

  heightAt(x: number, z: number): number {
    // the pure function is the ground truth everywhere, built or not
    return terrainHeight(x, z, this.tp);
  }

  dispose(): void {
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    this.backdrop?.dispose();
  }

  segmentsFor(ring: number): number {
    const c = lodClass(ring);
    return c === 0 ? this.p.nearSegments : c === 1 ? this.p.midSegments : this.p.farSegments;
  }

  private center(ch: Chunk): { x: number; z: number } {
    return { x: (ch.ci + 0.5) * this.p.chunkSize, z: (ch.cj + 0.5) * this.p.chunkSize };
  }

  private buildTerrain(ch: Chunk, segments: number): void {
    const { x, z } = this.center(ch);
    const lodTint = LOD_TINTS[segments === this.p.nearSegments ? 0 : segments === this.p.midSegments ? 1 : 2];
    const built = buildTerrainGeometry(this.tp, {
      size: this.p.chunkSize,
      segments,
      centerX: x,
      centerZ: z,
      skirt: this.p.skirtDepth,
      light: { sun: this.look.sunDir, reach: 40, outside: this.coarse.at },
      tint: this.showLodTint ? () => [lodTint[0], lodTint[1], lodTint[2], 0.85] : this.tint,
    });
    if (ch.terrain) {
      ch.terrain.geometry.dispose();
      ch.terrain.geometry = built.geometry;
    } else {
      ch.terrain = new THREE.Mesh(built.geometry, this.groundMat);
      ch.terrain.frustumCulled = false;
      ch.group.add(ch.terrain);
    }
    ch.heights = built.heights;
    ch.lod = segments;
    ch.tinted = this.showLodTint;
    if (ch.spots) this.stampShadows(ch);
  }

  private region(ch: Chunk): { minX: number; minZ: number; maxX: number; maxZ: number } {
    const S = this.p.chunkSize;
    return { minX: ch.ci * S, minZ: ch.cj * S, maxX: (ch.ci + 1) * S, maxZ: (ch.cj + 1) * S };
  }

  // the crowns' shadows go into the chunk's baked light, like the grove in part four
  private stampShadows(ch: Chunk): void {
    if (!ch.terrain || !ch.spots || ch.spots.length === 0) return;
    const attr = ch.terrain.geometry.getAttribute("aLight") as THREE.BufferAttribute;
    const W = ch.lod + 1, S = this.p.chunkSize;
    stampTreeShadows(attr.array as Float32Array, W, W, ch.ci * S, ch.cj * S, S / ch.lod, ch.spots, this.kit.variants[1], this.look.sunDir);
    attr.needsUpdate = true;
  }

  private buildScatter(ch: Chunk, treeLod: number): void {
    const items = scatterItems(this.tp, this.sp, this.region(ch));
    if (ch.planting) {
      ch.group.remove(ch.planting);
      disposePlanting(ch.planting);
    }
    const planted = plantItems(this.kit, items, treeLod);
    ch.planting = planted.group;
    ch.group.add(planted.group);
    const first = ch.spots === null;
    ch.spots = planted.spots;
    ch.treeLod = treeLod;
    if (first) this.stampShadows(ch);
  }

  private buildGrass(ch: Chunk): void {
    if (!ch.terrain || !ch.heights) return;
    const S = this.p.chunkSize;
    const W = ch.lod + 1;
    const x0 = ch.ci * S, z0 = ch.cj * S, step = S / ch.lod;
    const light = (ch.terrain.geometry.getAttribute("aLight") as THREE.BufferAttribute).array as Float32Array;
    const sunGrid = new Float32Array(W * W);
    for (let v = 0; v < W * W; v++) sunGrid[v] = light[v * 2];
    const sun = gridSampler(sunGrid, W, W, x0, z0, step);
    const heightAt = gridSampler(ch.heights, W, W, x0, z0, step, this.coarse.at);

    // one quarter of the chunk per call
    const q = ch.grassParts;
    const half = S / 2;
    const qx = x0 + (q % 2) * half, qz = z0 + Math.floor(q / 2) * half;
    const region = { minX: qx, minZ: qz, maxX: qx + half, maxZ: qz + half };
    const seed = this.sp.seed + ch.ci * 131 + ch.cj * 7 + q * 1013;
    const blades = grassBlades(this.tp, this.sp, region, this.p.grassPerChunk / GRASS_PARTS, seed, { scale: 1.5, sun, heightAt });
    if (blades.length > 0) {
      const mesh = new THREE.Mesh(buildGrassGeometry(blades).geometry, this.grassMat.material);
      mesh.frustumCulled = false;
      ch.group.add(mesh);
      ch.grass.push(mesh);
    }
    ch.grassParts++;
  }

  private dropGrass(ch: Chunk): void {
    for (const m of ch.grass) {
      ch.group.remove(m);
      m.geometry.dispose();
    }
    ch.grass = [];
    ch.grassParts = 0;
  }

  private disposeChunk(ch: Chunk): void {
    this.scene.remove(ch.group);
    if (ch.planting) disposePlanting(ch.planting);
    ch.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
    });
  }
}

// ---- the backdrop ------------------------------------------------------------------------

// A coarse square of land, HALF units each way around a centre snapped to
// its own lattice, with a hole where the chunks are. It's rebuilt in slices
// (heights a few rows per frame, then the sun march a few rows per frame,
// then one assembly) into a fresh buffer, and swapped in when complete.
class Backdrop {
  static readonly HALF = 800;
  static readonly STEP = 10;
  static readonly SLACK = 48; // how far the camera may drift from the centre before the hole shows
  readonly group = new THREE.Group();
  tinted = false;
  ready = false;

  private mesh: THREE.Mesh | null = null;
  private cx = NaN;
  private cz = NaN;
  private job: {
    cx: number;
    cz: number;
    hole: number;
    tinted: boolean;
    margin: Float32Array; // (W + 2)² heights including a one-sample border
    heights: Float32Array;
    light: Float32Array;
    row: number;
    phase: "heights" | "sun" | "assemble";
  } | null = null;

  constructor(
    private readonly tp: TerrainParams,
    private readonly sun: THREE.Vector3,
    private readonly material: THREE.Material,
    private readonly tint: (x: number, z: number, h: number, slope: number) => [number, number, number, number],
  ) {}

  private get W(): number {
    return (2 * Backdrop.HALF) / Backdrop.STEP + 1;
  }

  update(camX: number, camZ: number, hole: number, budgetMs: number): void {
    const snap = (v: number): number => Math.round(v / Backdrop.STEP) * Backdrop.STEP;
    const far = !(Math.max(Math.abs(camX - this.cx), Math.abs(camZ - this.cz)) < Backdrop.SLACK / 2);
    if (!this.job && (far || this.tinted !== (this.mesh?.userData.tinted ?? false))) {
      this.start(snap(camX), snap(camZ), hole);
    }
    if (this.job) this.work(budgetMs);
  }

  force(camX: number, camZ: number, hole: number): void {
    const snap = (v: number): number => Math.round(v / Backdrop.STEP) * Backdrop.STEP;
    this.start(snap(camX), snap(camZ), hole);
    this.work(1e9);
  }

  private start(cx: number, cz: number, hole: number): void {
    const W = this.W;
    this.job = {
      cx,
      cz,
      hole,
      tinted: this.tinted,
      margin: new Float32Array((W + 2) * (W + 2)),
      heights: new Float32Array(W * W),
      light: new Float32Array(W * W * 2),
      row: -1,
      phase: "heights",
    };
  }

  private work(budgetMs: number): void {
    const job = this.job!;
    const W = this.W, MW = W + 2, step = Backdrop.STEP, half = Backdrop.HALF;
    const x0 = job.cx - half, z0 = job.cz - half;
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (job.phase === "heights") {
        const j = job.row++;
        const z = z0 + j * step;
        for (let i = -1; i <= W; i++) job.margin[i + 1 + MW * (j + 1)] = terrainHeight(x0 + i * step, z, this.tp);
        if (job.row > W) {
          for (let jj = 0; jj < W; jj++) for (let i = 0; i < W; i++) job.heights[i + W * jj] = job.margin[i + 1 + MW * (jj + 1)];
          job.phase = "sun";
          job.row = 0;
        }
      } else if (job.phase === "sun") {
        const rows = 6;
        bakeSun(job.heights, W, W, x0, z0, step, this.sun, job.light, { reach: 160, softness: 5, rowFrom: job.row, rowTo: job.row + rows });
        job.row += rows;
        if (job.row >= W) job.phase = "assemble";
      } else {
        this.assemble();
        return;
      }
    }
  }

  private assemble(): void {
    const job = this.job!;
    this.job = null;
    const W = this.W, MW = W + 2, step = Backdrop.STEP, half = Backdrop.HALF, n = W - 1;
    const x0 = job.cx - half, z0 = job.cz - half;
    bakeOcclusion(job.heights, W, W, step, job.light, { aoRadii: [20, 60], aoStrength: 1.2 });
    const H = (i: number, j: number): number => job.margin[i + 1 + MW * (j + 1)];

    const positions = new Float32Array(W * W * 3);
    const normals = new Float32Array(W * W * 3);
    const tint = new Float32Array(W * W * 4);
    const lod = LOD_TINTS[3];
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const v = i + W * j;
        const x = x0 + i * step, z = z0 + j * step;
        const dhdx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
        const dhdz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
        const inv = 1 / Math.hypot(dhdx, 1, dhdz);
        // where the chunks overlap the backdrop, sink it under them; the
        // chunks' skirts cover the step at the edge of the ring
        const d = Math.max(Math.abs(x - job.cx), Math.abs(z - job.cz));
        const sink = 2.2 * (1 - Math.min(1, Math.max(0, (d - job.hole) / (Backdrop.SLACK * 2 + 48))));
        positions[v * 3] = x;
        positions[v * 3 + 1] = H(i, j) - sink;
        positions[v * 3 + 2] = z;
        normals[v * 3] = -dhdx * inv;
        normals[v * 3 + 1] = inv;
        normals[v * 3 + 2] = -dhdz * inv;
        if (job.tinted) tint.set([lod[0], lod[1], lod[2], 0.85], v * 4);
        else tint.set(this.tint(x, z, H(i, j), Math.hypot(dhdx, dhdz)), v * 4);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const xm = x0 + (i + 0.5) * step - job.cx, zm = z0 + (j + 0.5) * step - job.cz;
        if (Math.abs(xm) < job.hole && Math.abs(zm) < job.hole) continue;
        const a = i + W * j, b = a + 1, c = a + W, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("aLight", new THREE.BufferAttribute(job.light, 2));
    geometry.setAttribute("aTint", new THREE.BufferAttribute(tint, 4));
    geometry.setAttribute("aWater", new THREE.BufferAttribute(new Float32Array(W * W), 1));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));

    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.frustumCulled = false;
      this.group.add(this.mesh);
    }
    this.mesh.userData.tinted = job.tinted;
    this.cx = job.cx;
    this.cz = job.cz;
    this.ready = true;
  }

  dispose(): void {
    this.mesh?.geometry.dispose();
  }
}
