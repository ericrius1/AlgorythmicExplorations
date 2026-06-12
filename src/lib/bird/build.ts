// From function to geometry: run surface nets over the wren field, then
// commit to a look. The default style is deliberately low-poly — every
// triangle gets one normal and one color, so the facets show and the
// silhouette does the talking. The "smooth" style keeps the same surface but
// reads normals from the field's gradient instead, for comparison.

import * as THREE from "three/webgpu";
import { BIRD_BONES } from "./skeleton";
import { birdField, birdGradient, boneDistance, FIELD_BOUNDS, type FieldOptions } from "./field";
import { surfaceNets } from "./nets";
import { computeSkinWeights, WEIGHT_POWER_DEFAULT } from "./rig";

export interface BuildOptions extends FieldOptions {
  res?: number; // sampling resolution along the longest axis
  style?: "faceted" | "smooth";
  skin?: boolean; // part 2: bake skinIndex/skinWeight attributes
  weightPower?: number; // skin-weight falloff sharpness
}

export interface BirdMesh {
  geometry: THREE.BufferGeometry;
  vertexCount: number;
  triangleCount: number;
  cells: number;
  buildMs: number;
}

// Plumage, one color per zone (sRGB, converted to working space below):
// russet body, buff breast, barred brown wings and tail, horn beak, the pale
// supercilium, and bare pink-gray legs. Punchier than nature — flat facets
// eat saturation, so the paint pushes back.
export const ZONE_COLORS = [0x9a6238, 0xe2bd8d, 0x77492a, 0x6f452c, 0x4a3a28, 0xf0e0b8, 0xcf9a76];

const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// zone + cheap plumage texture for a point on the skin: hashed mottle, and
// dark bars across the wing and tail feathers (wrens are barred all over)
function paint(x: number, y: number, z: number, key: number, out: THREE.Color, palette: THREE.Color[]): void {
  let best = 1e9, zone = 0;
  for (const b of BIRD_BONES) {
    const d = boneDistance(b, x, y, z);
    if (d < best) { best = d; zone = b.zone; }
  }
  out.copy(palette[zone]);
  const mottle = 0.9 + 0.2 * hash1(key);
  let bar = 0;
  if (zone === 2) bar = Math.sin(z * (Math.PI * 2 / 0.06));
  if (zone === 3) bar = Math.sin((y * 0.6 - z * 0.8) * (Math.PI * 2 / 0.06));
  const barring = 1 - 0.16 * Math.max(0, bar) * Math.max(0, bar);
  out.multiplyScalar(mottle * barring);
}

export function buildBirdMesh(opts: BuildOptions = {}): BirdMesh {
  const t0 = performance.now();
  const res = opts.res ?? 56;
  const style = opts.style ?? "faceted";
  const fieldOpts: FieldOptions = { radiusScale: opts.radiusScale, blendScale: opts.blendScale };

  const net = surfaceNets(
    (x, y, z) => birdField(x, y, z, fieldOpts),
    FIELD_BOUNDS.min,
    FIELD_BOUNDS.max,
    res,
  );

  const palette = ZONE_COLORS.map((hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace));
  const c = new THREE.Color();
  const geometry = new THREE.BufferGeometry();

  if (style === "smooth") {
    // indexed mesh, one vertex per cell, normals straight from the field
    const nVerts = net.positions.length / 3;
    const normals = new Float32Array(nVerts * 3);
    const colors = new Float32Array(nVerts * 3);
    for (let v = 0; v < nVerts; v++) {
      const x = net.positions[v * 3], y = net.positions[v * 3 + 1], z = net.positions[v * 3 + 2];
      const [gx, gy, gz] = birdGradient(x, y, z, fieldOpts);
      normals[v * 3] = gx;
      normals[v * 3 + 1] = gy;
      normals[v * 3 + 2] = gz;
      paint(x, y, z, v, c, palette);
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(net.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(net.indices, 1));
  } else {
    // faceted: un-share the vertices so each triangle owns its normal and its
    // color. The face normal comes from the cross product, sign-checked
    // against the field gradient (the gradient always knows which way is out).
    const nTris = net.indices.length / 3;
    const positions = new Float32Array(nTris * 9);
    const normals = new Float32Array(nTris * 9);
    const colors = new Float32Array(nTris * 9);
    for (let t = 0; t < nTris; t++) {
      const i0 = net.indices[t * 3], i1 = net.indices[t * 3 + 1], i2 = net.indices[t * 3 + 2];
      const ax = net.positions[i0 * 3], ay = net.positions[i0 * 3 + 1], az = net.positions[i0 * 3 + 2];
      const bx = net.positions[i1 * 3], by = net.positions[i1 * 3 + 1], bz = net.positions[i1 * 3 + 2];
      const cx = net.positions[i2 * 3], cy = net.positions[i2 * 3 + 1], cz = net.positions[i2 * 3 + 2];

      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
      const [gx, gy, gz] = birdGradient(mx, my, mz, fieldOpts);
      if (nx * gx + ny * gy + nz * gz < 0) { nx = -nx; ny = -ny; nz = -nz; }

      paint(mx, my, mz, t, c, palette);

      for (let k = 0; k < 3; k++) {
        const src = [i0, i1, i2][k];
        positions[t * 9 + k * 3] = net.positions[src * 3];
        positions[t * 9 + k * 3 + 1] = net.positions[src * 3 + 1];
        positions[t * 9 + k * 3 + 2] = net.positions[src * 3 + 2];
        normals[t * 9 + k * 3] = nx;
        normals[t * 9 + k * 3 + 1] = ny;
        normals[t * 9 + k * 3 + 2] = nz;
        colors[t * 9 + k * 3] = c.r;
        colors[t * 9 + k * 3 + 1] = c.g;
        colors[t * 9 + k * 3 + 2] = c.b;
      }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  if (opts.skin) {
    const pos = geometry.getAttribute("position").array as Float32Array;
    const { skinIndex, skinWeight } = computeSkinWeights(pos, opts.weightPower ?? WEIGHT_POWER_DEFAULT);
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  }

  return {
    geometry,
    vertexCount: geometry.getAttribute("position").count,
    triangleCount: net.indices.length / 3,
    cells: net.cells,
    buildMs: performance.now() - t0,
  };
}

// Eyes are not in the field: growing a glossy three-millimeter eyeball out of
// a distance field would need a lattice fine enough to waste. They are riders
// — two faceted spheres and two glints parented to where the head will be.
// `pivot` re-bases the rest-pose world positions into the parent's local
// frame, so part 2 can hang the whole face off the head joint.
export function addFace(parent: THREE.Object3D, pivot: [number, number, number] = [0, 0, 0]): void {
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.15, flatShading: true });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x - pivot[0], y - pivot[1], z - pivot[2]);
    parent.add(m);
  };
  const eye = new THREE.IcosahedronGeometry(0.02, 1);
  const glint = new THREE.SphereGeometry(0.005, 8, 6);
  add(eye, eyeMat, 0.072, 0.615, 0.235);
  add(eye, eyeMat, -0.072, 0.615, 0.235);
  add(glint, glintMat, 0.078, 0.621, 0.245);
  add(glint, glintMat, -0.066, 0.621, 0.245);
}
