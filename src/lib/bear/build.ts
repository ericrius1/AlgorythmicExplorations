// From bone table to GPU buffers: loft the parts (see loft.ts), weld them
// into one BufferGeometry, stamp every vertex with a color zone, and — for
// part 2 onward — compute skin weights by asking each vertex which bones it
// lives near. One build, four articles of mileage.

import * as THREE from "three/webgpu";
import { BONES, DEFORM_BONES, DEFORM_INDEX, SHAPE_PARENT, boneDistance } from "./skeleton";
import { buildParts, type LoftOptions, type PartGeometry } from "./loft";

export interface BuildOptions extends LoftOptions {
  flat?: boolean; // duplicate vertices per face for flat shading (default true — triangles are the look)
  skin?: boolean; // compute skinIndex/skinWeight attributes
  weightPower?: number; // skin-weight falloff sharpness
}

export interface BearMesh {
  geometry: THREE.BufferGeometry;
  vertexCount: number;
  triangleCount: number;
  partCount: number;
  buildMs: number;
}

export const WEIGHT_POWER_DEFAULT = 2.4;

// Skin weights by proximity: a vertex is influenced by the bones it is close
// to. Shape-only parts (ears, muzzle) count as proxies for the deform bone
// they ride, so an ear vertex reads as "basically zero distance to the head".
// Top four influences, normalized — the GPU gets vec4s.
export function computeSkinWeights(
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  power: number,
): { skinIndex: Float32Array; skinWeight: Float32Array } {
  const nVerts = positions.count;
  const skinIndex = new Float32Array(nVerts * 4);
  const skinWeight = new Float32Array(nVerts * 4);
  const nBones = DEFORM_BONES.length;
  const dist = new Float32Array(nBones);
  const eps = 0.015;

  for (let v = 0; v < nVerts; v++) {
    const x = positions.getX(v), y = positions.getY(v), z = positions.getZ(v);
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

// One part → one indexed BufferGeometry with position + zone attributes.
function partToGeometry(p: PartGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p.positions, 3));
  g.setAttribute("zone", new THREE.BufferAttribute(p.zones, 1));
  g.setIndex(new THREE.BufferAttribute(p.indices, 1));
  return g;
}

// Per-part meshes for the "kit" demo — the real construction parts, not props.
export function buildBearParts(opts: BuildOptions = {}): {
  parts: { name: string; geometry: THREE.BufferGeometry; center: THREE.Vector3 }[];
} {
  return {
    parts: buildParts(opts).map((p) => {
      let g = partToGeometry(p);
      if (opts.flat !== false) g = g.toNonIndexed();
      g.computeVertexNormals();
      return { name: p.name, geometry: g, center: new THREE.Vector3(...p.center) };
    }),
  };
}

export function buildBearMesh(opts: BuildOptions = {}): BearMesh {
  const t0 = performance.now();
  const parts = buildParts(opts);

  // Weld the parts into one geometry (one draw call, one skinned mesh) by
  // concatenating buffers and offsetting indices.
  let vTotal = 0, iTotal = 0;
  for (const p of parts) { vTotal += p.positions.length / 3; iTotal += p.indices.length; }
  const positions = new Float32Array(vTotal * 3);
  const zones = new Float32Array(vTotal);
  const indices = new Uint32Array(iTotal);
  let vOff = 0, iOff = 0;
  for (const p of parts) {
    positions.set(p.positions, vOff * 3);
    zones.set(p.zones, vOff);
    for (let k = 0; k < p.indices.length; k++) indices[iOff + k] = p.indices[k] + vOff;
    vOff += p.positions.length / 3;
    iOff += p.indices.length;
  }

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("zone", new THREE.BufferAttribute(zones, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // Flat shading is a topology choice, not a material flag: un-share the
  // vertices so each triangle owns three and the normals stop averaging.
  if (opts.flat !== false) geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();

  // colors are baked per-vertex from the zone (see paintZones) — interpolating
  // an *index* across a triangle would sweep through every palette slot in
  // between and draw rainbow rings at the zone borders
  const nVerts = geometry.getAttribute("position").count;
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nVerts * 3), 3));

  if (opts.skin !== false) {
    const { skinIndex, skinWeight } = computeSkinWeights(
      geometry.getAttribute("position") as THREE.BufferAttribute,
      opts.weightPower ?? WEIGHT_POWER_DEFAULT,
    );
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  }

  const idx = geometry.getIndex();
  return {
    geometry,
    vertexCount: nVerts,
    triangleCount: (idx ? idx.count : nVerts) / 3,
    partCount: parts.length,
    buildMs: performance.now() - t0,
  };
}
