// The horizon machine. The world is a grid of chunks keyed by integer
// coordinates; whatever ring of them surrounds the camera exists, everything
// else doesn't. Each chunk builds its own terrain (resolution by distance),
// asks the part-5 scatter rules for its trees and rocks (which agree across
// borders by construction), and grows grass only when the camera is close
// enough to see blades. Building is rationed by a per-frame millisecond
// budget — the world streams in under the flight, never instead of it.

import * as THREE from "three/webgpu";
import { buildTerrainGeometry, terrainHeight, type TerrainParams } from "./heightmap";
import { buildGrassGeometry, makeGrassMaterial } from "./grass";
import { growTree, buildTreeGeometry, TREE_DEFAULTS } from "./trees";
import { scatterItems, grassBlades, buildRockGeometry, type ScatterParams } from "./scatter";

export interface ChunkWorldParams {
  chunkSize: number; // world units on a side
  ringRadius: number; // Chebyshev radius of existing chunks
  nearSegments: number; // grid resolution for the closest ring…
  midSegments: number; // …rings 2–3…
  farSegments: number; // …and everything beyond
  scatterRings: number; // rings that get trees and rocks
  grassRings: number; // rings that get grass (much smaller)
  grassPerChunk: number; // candidate blades per grassy chunk
  budgetMs: number; // build time allowed per frame
  skirtDepth: number;
}

export const CHUNK_DEFAULTS: ChunkWorldParams = {
  chunkSize: 24,
  ringRadius: 5,
  nearSegments: 48,
  midSegments: 24,
  farSegments: 12,
  scatterRings: 3,
  grassRings: 1,
  grassPerChunk: 9_000,
  budgetMs: 6,
  skirtDepth: 2.5,
};

interface Chunk {
  key: string;
  ci: number;
  cj: number;
  group: THREE.Group;
  terrain: THREE.Mesh | null;
  lod: number; // segments used; 0 = not built yet
  scattered: boolean;
  grassed: boolean;
}

export interface ChunkStats {
  live: number;
  queued: number;
  lastBuildMs: number;
  builtTotal: number;
}

export class ChunkWorld {
  readonly scene: THREE.Scene;
  readonly tp: TerrainParams;
  readonly sp: ScatterParams;
  readonly p: ChunkWorldParams;
  readonly grassMat = makeGrassMaterial();
  readonly stats: ChunkStats = { live: 0, queued: 0, lastBuildMs: 0, builtTotal: 0 };
  showLodTint = false;

  private chunks = new Map<string, Chunk>();
  private groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  private barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  private leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  private rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 });
  private trees: ReturnType<typeof buildTreeGeometry>[] = [];
  private rocks: THREE.BufferGeometry[] = [];

  constructor(scene: THREE.Scene, tp: TerrainParams, sp: ScatterParams, p: Partial<ChunkWorldParams> = {}) {
    this.scene = scene;
    this.tp = tp;
    this.sp = sp;
    this.p = { ...CHUNK_DEFAULTS, ...p };
    for (let k = 0; k < 4; k++) this.trees.push(buildTreeGeometry(growTree({ ...TREE_DEFAULTS, seed: 100 + k * 17 })));
    for (let k = 0; k < 3; k++) this.rocks.push(buildRockGeometry(k));
  }

  // Call once per frame with the camera's ground position. Does bookkeeping
  // always; does construction only while under budget.
  update(camX: number, camZ: number): void {
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
        ch = { key, ci: w.ci, cj: w.cj, group: new THREE.Group(), terrain: null, lod: 0, scattered: false, grassed: false };
        this.chunks.set(key, ch);
        this.scene.add(ch.group);
      }
      const lodWant = w.ring <= 1 ? this.p.nearSegments : w.ring <= 3 ? this.p.midSegments : this.p.farSegments;
      const needsTerrain = ch.lod !== lodWant;
      const needsScatter = !ch.scattered && w.ring <= this.p.scatterRings;
      const needsGrass = !ch.grassed && w.ring <= this.p.grassRings;
      if (!needsTerrain && !needsScatter && !needsGrass) continue;

      if (performance.now() - t0 > this.p.budgetMs) {
        queued++;
        continue; // over budget: it stays on the wish list for next frame
      }
      const b0 = performance.now();
      if (needsTerrain) this.buildTerrain(ch, lodWant);
      else if (needsScatter) this.buildScatter(ch);
      else if (needsGrass) this.buildGrass(ch);
      this.stats.lastBuildMs = performance.now() - b0;
      this.stats.builtTotal++;
    }
    this.stats.live = this.chunks.size;
    this.stats.queued = queued;
  }

  setTime(seconds: number): void {
    this.grassMat.time.value = seconds;
  }

  heightAt(x: number, z: number): number {
    // the pure function is the ground truth everywhere, built or not
    return terrainHeight(x, z, this.tp);
  }

  dispose(): void {
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
  }

  private center(ch: Chunk): { x: number; z: number } {
    return { x: (ch.ci + 0.5) * this.p.chunkSize, z: (ch.cj + 0.5) * this.p.chunkSize };
  }

  private buildTerrain(ch: Chunk, segments: number): void {
    const { x, z } = this.center(ch);
    const built = buildTerrainGeometry(this.tp, {
      size: this.p.chunkSize,
      segments,
      centerX: x,
      centerZ: z,
      skirt: this.p.skirtDepth,
    });
    if (this.showLodTint) {
      const col = built.geometry.getAttribute("color");
      const arr = col.array as Float32Array;
      const tint = segments === this.p.nearSegments ? [0.75, 1.15, 1.3] : segments === this.p.midSegments ? [1.2, 1.05, 0.7] : [1.3, 0.8, 0.8];
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] *= tint[0]; arr[i + 1] *= tint[1]; arr[i + 2] *= tint[2];
      }
    }
    if (ch.terrain) {
      ch.terrain.geometry.dispose();
      ch.terrain.geometry = built.geometry;
    } else {
      ch.terrain = new THREE.Mesh(built.geometry, this.groundMat);
      ch.group.add(ch.terrain);
    }
    ch.lod = segments;
  }

  private region(ch: Chunk): { minX: number; minZ: number; maxX: number; maxZ: number } {
    const S = this.p.chunkSize;
    return { minX: ch.ci * S, minZ: ch.cj * S, maxX: (ch.ci + 1) * S, maxZ: (ch.cj + 1) * S };
  }

  private buildScatter(ch: Chunk): void {
    const items = scatterItems(this.tp, this.sp, this.region(ch));
    const m4 = new THREE.Matrix4();
    const sc = new THREE.Vector3();
    for (let v = 0; v < this.trees.length; v++) {
      const mine = items.filter((it) => it.kind === "tree" && it.variant === v);
      if (mine.length === 0) continue;
      const bark = new THREE.InstancedMesh(this.trees[v].bark, this.barkMat, mine.length);
      const leaf = new THREE.InstancedMesh(this.trees[v].leaves, this.leafMat, mine.length);
      mine.forEach((it, i) => {
        sc.setScalar(it.scale);
        m4.makeRotationY(it.yaw).scale(sc).setPosition(it.x, it.y, it.z);
        bark.setMatrixAt(i, m4);
        leaf.setMatrixAt(i, m4);
      });
      ch.group.add(bark, leaf);
    }
    for (let v = 0; v < this.rocks.length; v++) {
      const mine = items.filter((it) => it.kind === "rock" && it.variant === v);
      if (mine.length === 0) continue;
      const rock = new THREE.InstancedMesh(this.rocks[v], this.rockMat, mine.length);
      mine.forEach((it, i) => {
        sc.setScalar(it.scale);
        m4.makeRotationY(it.yaw).scale(sc).setPosition(it.x, it.y, it.z);
        rock.setMatrixAt(i, m4);
      });
      ch.group.add(rock);
    }
    ch.scattered = true;
  }

  private buildGrass(ch: Chunk): void {
    const blades = grassBlades(this.tp, this.sp, this.region(ch), this.p.grassPerChunk, this.sp.seed + ch.ci * 131 + ch.cj * 7);
    if (blades.length > 0) {
      const mesh = new THREE.Mesh(buildGrassGeometry(blades).geometry, this.grassMat.material);
      ch.group.add(mesh);
    }
    ch.grassed = true;
  }

  private disposeChunk(ch: Chunk): void {
    this.scene.remove(ch.group);
    ch.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh && o !== ch.terrain) o.geometry.dispose();
    });
    ch.terrain?.geometry.dispose();
  }
}
