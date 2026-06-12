// From function to geometry: march the bear field, take normals from the
// field's gradient, stamp every vertex with a color zone, and — for part 2
// onward — compute skin weights by asking each vertex which capsules it lives
// near. One build, four articles of mileage.

import * as THREE from "three/webgpu";
import { BONES, DEFORM_BONES, DEFORM_INDEX, SHAPE_PARENT } from "./skeleton";
import { bearField, bearGradient, boneDistance, FIELD_BOUNDS, type FieldOptions } from "./field";
import { marchTetra } from "./tetra";

export interface BuildOptions extends FieldOptions {
  res?: number; // marching grid resolution along the longest axis
  weightPower?: number; // skin-weight falloff sharpness
  skin?: boolean; // compute skinIndex/skinWeight attributes
}

export interface BearMesh {
  geometry: THREE.BufferGeometry;
  vertexCount: number;
  triangleCount: number;
  cells: number;
  buildMs: number;
}

export const WEIGHT_POWER_DEFAULT = 2.4;

// Skin weights by proximity: a vertex is influenced by the capsules it is
// close to. Shape-only blobs (ears, muzzle, belly…) count as proxies for the
// deform bone they ride, so an ear vertex reads as "basically zero distance
// to the head". Top four influences, normalized — the GPU gets vec4s.
export function computeSkinWeights(
  positions: Float32Array,
  power: number,
): { skinIndex: Float32Array; skinWeight: Float32Array } {
  const nVerts = positions.length / 3;
  const skinIndex = new Float32Array(nVerts * 4);
  const skinWeight = new Float32Array(nVerts * 4);
  const nBones = DEFORM_BONES.length;
  const dist = new Float32Array(nBones);
  const eps = 0.015;

  for (let v = 0; v < nVerts; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    dist.fill(1e9);
    for (const b of BONES) {
      const owner = b.deform ? b.name : SHAPE_PARENT[b.name];
      const j = DEFORM_INDEX.get(owner);
      if (j === undefined) continue;
      const d = Math.max(0, boneDistance(b, x, y, z));
      if (d < dist[j]) dist[j] = d;
    }
    // top four bones by closeness
    let i0 = -1, i1 = -1, i2 = -1, i3 = -1;
    for (let j = 0; j < nBones; j++) {
      const d = dist[j];
      if (i0 < 0 || d < dist[i0]) { i3 = i2; i2 = i1; i1 = i0; i0 = j; }
      else if (i1 < 0 || d < dist[i1]) { i3 = i2; i2 = i1; i1 = j; }
      else if (i2 < 0 || d < dist[i2]) { i3 = i2; i2 = j; }
      else if (i3 < 0 || d < dist[i3]) { i3 = j; }
    }
    const picks = [i0, i1, i2, i3];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = Math.pow(1 / (dist[picks[k]] + eps), power);
      skinIndex[v * 4 + k] = picks[k];
      skinWeight[v * 4 + k] = w;
      sum += w;
    }
    for (let k = 0; k < 4; k++) skinWeight[v * 4 + k] /= sum;
  }
  return { skinIndex, skinWeight };
}

export function buildBearMesh(opts: BuildOptions = {}): BearMesh {
  const t0 = performance.now();
  const res = opts.res ?? 56;
  const fieldOpts: FieldOptions = { radiusScale: opts.radiusScale, blendScale: opts.blendScale };

  const { positions, indices, cells } = marchTetra(
    (x, y, z) => bearField(x, y, z, fieldOpts),
    FIELD_BOUNDS.min,
    FIELD_BOUNDS.max,
    res,
  );

  const nVerts = positions.length / 3;
  const normals = new Float32Array(nVerts * 3);
  const zones = new Float32Array(nVerts);

  for (let v = 0; v < nVerts; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const [gx, gy, gz] = bearGradient(x, y, z, fieldOpts);
    normals[v * 3] = gx;
    normals[v * 3 + 1] = gy;
    normals[v * 3 + 2] = gz;
    // color zone: whichever capsule owns this point (smallest distance)
    let best = 1e9, zone = 0;
    for (const b of BONES) {
      const d = boneDistance(b, x, y, z);
      if (d < best) { best = d; zone = b.zone; }
    }
    zones[v] = zone;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("zone", new THREE.BufferAttribute(zones, 1));
  // colors are baked per-vertex from the zone (see paintZones) — interpolating
  // an *index* across a triangle would sweep through every palette slot in
  // between and draw rainbow rings at the zone borders
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nVerts * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  if (opts.skin !== false) {
    const { skinIndex, skinWeight } = computeSkinWeights(positions, opts.weightPower ?? WEIGHT_POWER_DEFAULT);
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  }

  return {
    geometry,
    vertexCount: nVerts,
    triangleCount: indices.length / 3,
    cells,
    buildMs: performance.now() - t0,
  };
}
