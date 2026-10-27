// A big view for the heroes: nested square rings of terrain, fine near the
// camera and coarser with distance, each with a hole where the next finer
// ring sits and a skirt to hide the seams. It's a fixed version of the
// level-of-detail rings that part six streams, built once at load.

import * as THREE from "three/webgpu";
import { buildTerrainGeometry, terrainHeight, type TerrainParams } from "./heightmap";
import { gridSampler, type HeightSampler } from "./light";

export interface Ring {
  half: number; // half-width in world units
  step: number; // grid spacing
}

export interface Vista {
  group: THREE.Group;
  heightAt: HeightSampler; // finest available height anywhere in the view
  vertexCount: number;
}

// Rings are listed fine to coarse. `core` (optional) is a half-width left
// empty in the finest ring for a mesh the caller supplies (an eroded patch,
// say); `coreSampler` reads it.
export function buildVista(
  tp: TerrainParams,
  sun: THREE.Vector3,
  material: THREE.Material,
  rings: Ring[],
  opts: {
    core?: number;
    coreSampler?: HeightSampler;
    reach?: number;
    tint?: (x: number, z: number, h: number, slope: number) => [number, number, number, number];
  } = {},
): Vista {
  const group = new THREE.Group();
  let outside: HeightSampler = (x, z) => terrainHeight(x, z, tp);
  const samplers: { half: number; s: HeightSampler }[] = [];
  let verts = 0;
  for (let r = rings.length - 1; r >= 0; r--) {
    const ring = rings[r];
    const hole = r > 0 ? rings[r - 1].half : opts.core ?? 0;
    const segments = Math.round((ring.half * 2) / ring.step);
    const built = buildTerrainGeometry(tp, {
      size: ring.half * 2,
      segments,
      hole,
      skirt: ring.step * 2,
      light: { sun, reach: opts.reach ?? 36, outside },
      tint: opts.tint,
    });
    verts += built.vertexCount;
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.frustumCulled = false;
    group.add(mesh);
    const W = segments + 1;
    const s = gridSampler(built.heights, W, W, -ring.half, -ring.half, ring.step, outside);
    samplers.unshift({ half: ring.half, s });
    outside = s;
  }
  const core = opts.core ?? 0;
  const heightAt: HeightSampler = (x, z) => {
    if (opts.coreSampler && Math.abs(x) < core && Math.abs(z) < core) return opts.coreSampler(x, z);
    for (const { half, s } of samplers) if (Math.abs(x) <= half && Math.abs(z) <= half) return s(x, z);
    return terrainHeight(x, z, tp);
  };
  return { group, heightAt, vertexCount: verts };
}
