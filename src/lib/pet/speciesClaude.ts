// Three original procedural 3D pet species crafted by Claude Opus 5.5 — studio edition:
//   1. Mochi   — Calico Kitten (cashmere cream / apricot / espresso, kimono collar + suzu bell,
//                origami stars & fireflies, brass crescent astrolabe)
//   2. Kitsune — Spirit Fox Pup (alabaster & vermilion, 1 → 2 → 3 → 5 plume tails, shimenawa
//                rope + shide + jade magatama, kitsune-bi lanterns, sacred shrine halo)
//   3. Pebble  — Mossy Axolotl (wet mint-jade sea-glass skin, six backlit gill plumes, velvet
//                moss cap + fairy mushrooms, dewdrop pearls, crystal lotus tiara + caustic ring)
//
// Every primary surface is sculpted as one seamless signed-distance field (smooth-min blends of
// ellipsoids & round cones, organic noise contours, carved eye sockets) and meshed by the Surface
// Nets sculptor in ./sdfSculpt, which bakes AO + thickness for real backlit subsurface scattering.
// Tails are SDF sculpts skinned onto bone chains so they bend as one continuous furry plume.
//
// Every rig implements PetModelRig: base resting on y = 0, facing +Z, four-stage evolution,
// clamped look-at, blinking + happy squints, mood body language and all six tricks. A shared
// PetCore owns the transform stack:
//
//   root (placed by the sanctuary) → grow (stage scale) → motion (jumps, spins,
//   figure-8s) → tilt (pitch / roll about a pivot) → inner (pivot compensation)
//   → body (squash & stretch about the floor, petted wiggle) → species parts.

import * as THREE from "three/webgpu";
import {
  attribute,
  color,
  float,
  length,
  mix,
  pow,
  saturate,
  sin,
  smoothstep as tslSmoothstep,
  uniform,
  uv,
  vec2,
} from "three/tsl";
import type { EvolutionStage, PetModelRig, PetPoseInput, PetTrick, SpeciesDefinition } from "./types";
import {
  buildSdfGeometry,
  sdRoundCone,
  sdCapsule,
  sdfNoise3,
  smax,
  smin,
  smoothstep as ss,
} from "./sdfSculpt";
import {
  addFurShells,
  makeArtisanMetalMaterial,
  makeBioSssMaterial,
  makeHdrGlowMaterial,
  makeJewelEyeMaterial,
  makePlushSssMaterial,
  makeSilkFabricMaterial,
  type FurShellOptions,
} from "./petShaders";

const TAU = Math.PI * 2;
const PI = Math.PI;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

type U = NonNullable<Parameters<typeof makeHdrGlowMaterial>[2]>;
type RGB = [number, number, number];
type Sdf = (x: number, y: number, z: number) => number;

function damp(cur: number, target: number, lambda: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}

/** smoothstep with (edge0, edge1, x) argument order */
function smooth(e0: number, e1: number, x: number): number {
  return THREE.MathUtils.smoothstep(x, e0, e1);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ----------------------------------------------------------------------------
// Shared SDF geometry cache (rebuilt once per page, reused across pet switches)
// ----------------------------------------------------------------------------

const GEO_CACHE = new Map<string, THREE.BufferGeometry>();
const SHARED_GEOS = new Set<THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = GEO_CACHE.get(key);
  if (!g) {
    g = make();
    GEO_CACHE.set(key, g);
    SHARED_GEOS.add(g);
  }
  return g;
}

let prewarmScheduled = false;
/**
 * After the first pet is built, sculpt the remaining species' SDF geometry during browser idle
 * time (one species per idle slice) so switching pets afterwards only costs ~15 ms.
 */
function schedulePrewarm(): void {
  if (prewarmScheduled || typeof window === "undefined") return;
  prewarmScheduled = true;
  const tasks: (() => unknown)[] = [mochiGeometries, kitsuneGeometries, pebbleGeometries];
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  const idle = (cb: () => void) => (w.requestIdleCallback ? w.requestIdleCallback(cb, { timeout: 5000 }) : setTimeout(cb, 700));
  const next = () => {
    const task = tasks.shift();
    if (!task) return;
    task();
    idle(next);
  };
  idle(next);
}

function disposeHierarchy(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.geometry && !SHARED_GEOS.has(m.geometry)) geos.add(m.geometry);
    if (m.material) {
      if (Array.isArray(m.material)) m.material.forEach((mm) => mats.add(mm));
      else mats.add(m.material);
    }
    const sk = obj as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh && sk.skeleton) sk.skeleton.dispose();
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
}

// Fast sqrt-based primitives (Math.hypot is slow in V8 and dominates Surface Nets build time).
function el(x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): number {
  const qx = (x - cx) / rx;
  const qy = (y - cy) / ry;
  const qz = (z - cz) / rz;
  const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const ux = qx / rx;
  const uy = qy / ry;
  const uz = qz / rz;
  const k1 = Math.sqrt(ux * ux + uy * uy + uz * uz);
  return k1 > 1e-8 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

function sph(x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number): number {
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** Organic contour lumps applied only near the surface (far samples only need the sign). */
function lumps(d: number, n: () => number, amp: number): number {
  return d > 0.045 || d < -0.045 ? d : d - (n() - 0.5) * amp;
}

// ----------------------------------------------------------------------------
// Paint + probing helpers
// ----------------------------------------------------------------------------

const _col = new THREE.Color();
/** sRGB hex → linear RGB triple for SDF vertex paint */
function lin(hex: number): RGB {
  _col.setHex(hex);
  return [_col.r, _col.g, _col.b];
}

function mixc(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Soft organic patch mask (noise-warped edge) — calico patches, freckles, markings */
function blob(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  soft = 0.035,
  warp = 0.05,
  freq = 8,
  seed = 0,
): number {
  const n = warp > 0 ? (sdfNoise3(x * freq + seed, y * freq + seed * 0.7 + 3.1, z * freq - seed * 1.3) - 0.5) * warp * 2 : 0;
  return ss(r + soft, r - soft, Math.hypot(x - cx, y - cy, z - cz) + n);
}

/** Distance from (px, py) to the 2D segment (ax, ay) → (bx, by) */
function seg2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const h = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(px - ax - vx * h, py - ay - vy * h);
}

/** March from an outside point along a direction until the SDF surface is hit; returns distance. */
function probe(sdf: Sdf, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT = 1): number {
  const step = 0.004;
  let prevT = 0;
  for (let t = step; t <= maxT; t += step) {
    if (sdf(ox + dx * t, oy + dy * t, oz + dz * t) < 0) {
      let a = prevT;
      let b = t;
      for (let i = 0; i < 14; i++) {
        const m = (a + b) * 0.5;
        if (sdf(ox + dx * m, oy + dy * m, oz + dz * m) < 0) b = m;
        else a = m;
      }
      return (a + b) * 0.5;
    }
    prevT = t;
  }
  return maxT;
}

/** Front surface z of an SDF at (x, y), probing from +Z */
function surfZ(sdf: Sdf, x: number, y: number, from = 0.6): number {
  return from - probe(sdf, x, y, from, 0, 0, -1, from + 0.6);
}

/** Top surface y of an SDF at (x, z), probing from +Y */
function surfY(sdf: Sdf, x: number, z: number, from = 0.8): number {
  return from - probe(sdf, x, from, z, 0, -1, 0, from + 0.6);
}

function sdfNormal(sdf: Sdf, x: number, y: number, z: number): THREE.Vector3 {
  const e = 0.003;
  return new THREE.Vector3(
    sdf(x + e, y, z) - sdf(x - e, y, z),
    sdf(x, y + e, z) - sdf(x, y - e, z),
    sdf(x, y, z + e) - sdf(x, y, z - e),
  ).normalize();
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Place an object on an SDF surface point (with outward offset) and align its +Z to the normal. */
function stick<T extends THREE.Object3D>(obj: T, sdf: Sdf, x: number, y: number, z: number, offset = 0, align = true): T {
  const n = sdfNormal(sdf, x, y, z);
  obj.position.set(x + n.x * offset, y + n.y * offset, z + n.z * offset);
  if (align) obj.quaternion.setFromUnitVectors(Z_AXIS, n);
  return obj;
}

/**
 * Eye socket ellipsoid in a yawed + rolled eye frame (mirrors the eye group's rotation (0, yaw, roll)).
 * Used to carve snug sockets so the jewel eyes nest into the sculpted skull.
 */
function sdSocket(
  x: number,
  y: number,
  z: number,
  ex: number,
  ey: number,
  ez: number,
  yaw: number,
  roll: number,
  rx: number,
  ry: number,
  rz: number,
): number {
  const dx = x - ex;
  const dy = y - ey;
  const dz = z - ez;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const lx = dx * cy - dz * sy;
  const lz = dx * sy + dz * cy;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const qx = lx * cr + dy * sr;
  const qy = -lx * sr + dy * cr;
  return el(qx, qy, lz, 0, 0, 0, rx, ry, rz);
}

/** Per-vertex float attribute from a position function (glow masks, tips). */
function addMaskAttr(geo: THREE.BufferGeometry, name: string, fn: (x: number, y: number, z: number) => number): void {
  if (geo.getAttribute(name)) return;
  const pos = geo.getAttribute("position");
  const arr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) arr[i] = clamp(fn(pos.getX(i), pos.getY(i), pos.getZ(i)), 0, 1);
  geo.setAttribute(name, new THREE.BufferAttribute(arr, 1));
}

/** Layer a masked HDR emissive glow (driven by a uniform) on top of an SSS material's emissive. */
function addEmissiveMask(mat: THREE.Material, name: string, hex: number, strength: U): void {
  const m = mat as unknown as { emissiveNode: unknown };
  const glow = color(hex).mul(attribute(name, "float")).mul(strength);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  m.emissiveNode = m.emissiveNode ? (m.emissiveNode as any).add(glow) : glow;
}

/** Linear-blend skin weights along a bone chain (axis +Y or -Z), blending around each joint. */
function addSkin(geo: THREE.BufferGeometry, axis: "y" | "-z", seg: number, n: number): void {
  if (geo.getAttribute("skinIndex")) return;
  const pos = geo.getAttribute("position");
  const idx = new Uint16Array(pos.count * 4);
  const w = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const along = axis === "y" ? pos.getY(i) : -pos.getZ(i);
    const s = clamp(along / seg - 0.5, 0, n - 1);
    const i0 = Math.min(n - 2, Math.floor(s));
    const f = smooth(0, 1, s - i0);
    idx[i * 4] = i0;
    idx[i * 4 + 1] = i0 + 1;
    w[i * 4] = 1 - f;
    w[i * 4 + 1] = f;
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(w, 4));
}

/**
 * Fur-shell proxy: a copy of an SDF mesh whose masked vertices (eyes, nose, muzzle) are sunk
 * below the skin, so the extruded fur shells taper away there and never fuzz over the face.
 */
function furProxy(key: string, geo: THREE.BufferGeometry, mask: (x: number, y: number, z: number) => number, depth: number): THREE.BufferGeometry {
  return cached(key, () => {
    const g = geo.clone();
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const m = clamp(mask(pos.getX(i), pos.getY(i), pos.getZ(i)), 0, 1) * depth;
      if (m <= 0) continue;
      pos.setXYZ(i, pos.getX(i) - nrm.getX(i) * m, pos.getY(i) - nrm.getY(i) * m, pos.getZ(i) - nrm.getZ(i) * m);
    }
    return g;
  });
}

// ----------------------------------------------------------------------------
// Mesh helpers
// ----------------------------------------------------------------------------

function solid<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

function ell(r: number, sx: number, sy: number, sz: number, mat: THREE.Material, seg = 24): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.72))), mat);
  m.scale.set(sx, sy, sz);
  return m;
}

function glossy(hex: number, roughness = 0.3): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: hex, roughness, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.12 });
}

function additive(hex: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function tube(points: [number, number, number][], radius: number, mat: THREE.Material, segs = 16, radial = 6): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, radial, false), mat);
}

/** Torus arc. Default orientation spans angle 0 → arc counter-clockwise (∩ for arc = π). */
function arcMesh(radius: number, thick: number, arc: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, thick, 8, 28, arc), mat);
}

/** Four-point twinkle star ✦ built from two crossed stretched octahedra. */
function makeStar(size: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(size, 0);
  const a = new THREE.Mesh(geo, mat);
  a.scale.set(0.3, 1, 0.3);
  const b = new THREE.Mesh(geo, mat);
  b.scale.set(1, 0.3, 0.3);
  g.add(a, b);
  return g;
}

/** Puffy faceted origami "lucky star" (extruded 5-point star with pinched bevel). */
function makeOrigamiStarGeo(outer: number, inner: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = PI / 2 + (i / 10) * TAU;
    const r = i % 2 === 0 ? outer : inner;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: outer * 0.18,
    bevelEnabled: true,
    bevelThickness: outer * 0.32,
    bevelSize: inner * 0.42,
    bevelSegments: 1,
  });
  g.center();
  g.computeVertexNormals();
  return g;
}

/** Teardrop lathe (pointed top, round bottom) — fox-fire, dewdrops. Height ≈ 2.4 r. */
function makeTeardropGeo(r: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * PI;
    const rr = Math.sin(t) * Math.pow(Math.sin(t / 2), 1.6) * r;
    pts.push(new THREE.Vector2(Math.max(0.0001, rr), Math.cos(t) * r * 1.2));
  }
  pts.reverse();
  return new THREE.LatheGeometry(pts, 24);
}

/** Pointed, cupped petal (sakura or lotus) from a deformed sphere. */
function makePetalGeo(w: number, h: number, thick: number, cup: number, notch = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 18, 14);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const v = (y + 1) * 0.5; // 0 base → 1 tip
    const taper = Math.sin(PI * Math.pow(v, 0.8)) * (1 - 0.35 * v) + 0.06;
    let tipY = v;
    if (notch > 0) tipY -= notch * Math.exp(-(x * x) * 30) * ss(0.7, 1.0, v);
    const px = x * w * taper;
    p.setXYZ(i, px, tipY * h, z * thick + cup * (px * px) / (w * w) * h * 0.25 - cup * v * v * h * 0.12);
  }
  g.computeVertexNormals();
  return g;
}

/** Hammered metal: dimple a sphere's vertices with cellular-ish noise. */
function hammer(geo: THREE.BufferGeometry, amp: number, freq: number): THREE.BufferGeometry {
  const p = geo.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = sdfNoise3(v.x * freq + 7, v.y * freq + 3, v.z * freq + 11);
    const dent = 1 - amp * Math.pow(n, 3);
    p.setXYZ(i, v.x * dent, v.y * dent, v.z * dent);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Soft glowing mote: HDR core + additive halo. */
function makeMote(coreMat: THREE.Material, haloHex: number, r: number): { g: THREE.Group; halo: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), coreMat);
  const halo = additive(haloHex, 0.32);
  g.add(core, new THREE.Mesh(new THREE.SphereGeometry(r * 2.6, 16, 12), halo));
  return { g, halo };
}

/** Ring of radiating twinkles that blooms at the peak of a flip. */
function makeBurst(colors: number[]): { group: THREE.Group; update(s: number, t: number): void } {
  const group = new THREE.Group();
  const items: { g: THREE.Group; a: number }[] = [];
  const mats = colors.map((c) => additive(c, 0.9));
  for (let i = 0; i < 8; i++) {
    const g = makeStar(0.04, mats[i % mats.length]);
    group.add(g);
    items.push({ g, a: (i / 8) * TAU + 0.2 });
  }
  group.visible = false;
  return {
    group,
    update(s: number, t: number) {
      group.visible = s > 0.01;
      if (!group.visible) return;
      const R = 0.3 + 0.32 * s;
      for (const it of items) {
        it.g.position.set(Math.cos(it.a) * R, Math.sin(it.a) * R, 0.05);
        it.g.scale.setScalar(Math.max(0.001, s * (0.8 + 0.3 * Math.sin(t * 9 + it.a * 3))));
        it.g.rotation.z = t * 3 + it.a;
      }
      for (const m of mats) m.opacity = 0.9 * s;
    },
  };
}

/** Ornament that blooms in (scale 0 → 1) while the pet's stage is within [minStage, maxStage]. */
class Reveal {
  v = 0;
  constructor(
    readonly obj: THREE.Object3D,
    readonly minStage: number,
    readonly maxStage = 4,
  ) {
    obj.visible = false;
    obj.scale.setScalar(0.0001);
  }
  tick(stage: number, dt: number, snap = false): void {
    const target = stage >= this.minStage && stage <= this.maxStage ? 1 : 0;
    this.v = snap ? target : damp(this.v, target, 4.5, dt);
    this.obj.visible = this.v > 0.01;
    this.obj.scale.setScalar(Math.max(0.0001, this.v));
  }
}

// ----------------------------------------------------------------------------
// Fitted rings, braids and ribbon bands (collars that hug the sculpted neck)
// ----------------------------------------------------------------------------

interface FittedRing {
  pts: THREE.Vector3[];
  radial: THREE.Vector3[];
  up: THREE.Vector3;
}

/** Shrink-wrap a tilted ring around an SDF (march inward from outside) + outward offset. */
function fitRing(sdf: Sdf, cx: number, cy: number, cz: number, tilt: number, offset: number, n = 72): FittedRing {
  const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, tilt);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const pts: THREE.Vector3[] = [];
  const radial: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).applyQuaternion(q);
    const maxR = 0.5;
    const t = maxR - probe(sdf, cx + dir.x * maxR, cy + dir.y * maxR, cz + dir.z * maxR, -dir.x, -dir.y, -dir.z, maxR - 0.02);
    const r = t + offset;
    pts.push(new THREE.Vector3(cx + dir.x * r, cy + dir.y * r, cz + dir.z * r));
    radial.push(dir);
  }
  return { pts, radial, up };
}

function ringShift(ring: FittedRing, radialOff: number, upOff: number): THREE.Vector3[] {
  return ring.pts.map((p, i) => p.clone().addScaledVector(ring.radial[i], radialOff).addScaledVector(ring.up, upOff));
}

function closedTube(pts: THREE.Vector3[], r: number, mat: THREE.Material, radial = 8): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  return new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 3, r, radial, true), mat);
}

/** Twisted multi-strand rope / woven thread following a fitted ring. */
function braid(ring: FittedRing, strands: number, twistR: number, twists: number, r: number, mats: THREE.Material[]): THREE.Group {
  const g = new THREE.Group();
  const n = ring.pts.length;
  for (let k = 0; k < strands; k++) {
    const pts: THREE.Vector3[] = [];
    const M = n * 3;
    for (let i = 0; i < M; i++) {
      const f = i / 3;
      const i0 = Math.floor(f) % n;
      const i1 = (i0 + 1) % n;
      const u = f - Math.floor(f);
      const p = ring.pts[i0].clone().lerp(ring.pts[i1], u);
      const rad = ring.radial[i0].clone().lerp(ring.radial[i1], u).normalize();
      const ph = (i / M) * TAU * twists + (k / strands) * TAU;
      p.addScaledVector(rad, Math.cos(ph) * twistR).addScaledVector(ring.up, Math.sin(ph) * twistR);
      pts.push(p);
    }
    g.add(solid(closedTube(pts, r, mats[k % mats.length], 6)));
  }
  return g;
}

/** Soft rolled fabric band (kimono eri) following a fitted ring. */
function ribbonBand(ring: FittedRing, width: number, bulge: number, mat: THREE.Material, rows = 6): THREE.Mesh {
  const n = ring.pts.length;
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = ring.pts[i % n];
    const rad = ring.radial[i % n];
    for (let j = 0; j <= rows; j++) {
      const v = j / rows - 0.5;
      const b = Math.cos(v * PI) * bulge;
      pos.push(
        p.x + ring.up.x * v * width + rad.x * b,
        p.y + ring.up.y * v * width + rad.y * b,
        p.z + ring.up.z * v * width + rad.z * b,
      );
    }
  }
  const R = rows + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * R + j;
      const b = (i + 1) * R + j;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

// ----------------------------------------------------------------------------
// Skinned SDF chains (tails): one seamless sculpt bent by a bone chain
// ----------------------------------------------------------------------------

interface SkinChain {
  mesh: THREE.SkinnedMesh;
  joints: THREE.Bone[];
  tip: THREE.Group;
}

function makeSkinChain(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  n: number,
  step: THREE.Vector3,
  fur?: FurShellOptions,
): SkinChain {
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const joints: THREE.Bone[] = [];
  let parent: THREE.Object3D = mesh;
  for (let i = 0; i < n; i++) {
    const b = new THREE.Bone();
    if (i > 0) b.position.copy(step);
    parent.add(b);
    joints.push(b);
    parent = b;
  }
  const tip = new THREE.Group();
  tip.position.copy(step);
  joints[n - 1].add(tip);
  const skeleton = new THREE.Skeleton(joints);
  mesh.bind(skeleton);
  if (fur) {
    // Fur shells reuse the shell materials from addFurShells but ride the same skeleton.
    const tmp = new THREE.Group();
    for (const s of addFurShells(tmp, geo, fur)) {
      const sm = new THREE.SkinnedMesh(geo, s.material as THREE.Material);
      sm.renderOrder = s.renderOrder;
      sm.frustumCulled = false;
      mesh.add(sm);
      sm.bind(skeleton, mesh.bindMatrix);
    }
  }
  return { mesh, joints, tip };
}

// ----------------------------------------------------------------------------
// Studio jewel eye: procedural iris ball nested in a carved socket, sculpted
// lower lid, rotating plush eyelid, happy ∩ squint arc and calm ‿ lash line.
// ----------------------------------------------------------------------------

interface EyeRig {
  group: THREE.Group;
  update(lookX: number, lookY: number, lid: number, happy: number): void;
}

function makeJewelEye(
  r: number,
  irisHex: number,
  hiHex: number,
  pupilR: number,
  lidMat: THREE.Material,
  lineMat: THREE.Material,
): EyeRig {
  const group = new THREE.Group();
  const ballG = new THREE.Group();
  ballG.scale.set(1, 1, 0.72);
  group.add(ballG);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), makeJewelEyeMaterial(irisHex, hiHex, pupilR));
  ball.receiveShadow = true;
  ballG.add(ball);

  const lid = new THREE.Mesh(new THREE.SphereGeometry(r * 1.09, 32, 16, 0, TAU, 0, PI * 0.6), lidMat);
  lid.castShadow = true;
  ballG.add(lid);

  // sculpted lower lid rim hugging the bottom of the cornea
  const lower = arcMesh(r * 0.93, r * 0.085, PI * 0.82, lidMat);
  lower.rotation.z = -PI / 2 - PI * 0.41;
  lower.position.z = r * 0.3;
  group.add(lower);

  const squint = arcMesh(r * 0.72, r * 0.12, PI, lineMat);
  squint.position.set(0, -r * 0.16, r * 0.66);
  squint.visible = false;
  group.add(squint);

  const lash = arcMesh(r * 0.66, r * 0.085, PI, lineMat);
  lash.rotation.z = PI;
  lash.position.set(0, r * 0.1, r * 0.68);
  lash.visible = false;
  group.add(lash);

  return {
    group,
    update(lookX: number, lookY: number, lidAmt: number, happy: number) {
      const closed = clamp(Math.max(lidAmt, happy), 0, 1);
      lid.rotation.x = closed < 0.5 ? lerp(-0.66 * PI, -0.1 * PI, closed * 2) : lerp(-0.1 * PI, 0.3 * PI, (closed - 0.5) * 2);
      ball.rotation.set(-lookY * 0.3, lookX * 0.4, 0);
      const showSquint = happy > 0.55;
      squint.visible = showSquint;
      squint.scale.setScalar(0.85 + 0.15 * happy);
      lash.visible = !showSquint && closed > 0.86;
    },
  };
}

// ----------------------------------------------------------------------------
// Trick choreography
// ----------------------------------------------------------------------------

interface TrickOut {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  squash: number;
  centerPivot: boolean;
  flare: number;
  headPitch: number;
  headRoll: number;
  droop: number;
  glow: number;
  wag: number;
  paddle: number;
  mouth: number;
  sparkle: number;
  env: number;
  happy: number;
}

function restTrick(): TrickOut {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, squash: 1, centerPivot: false,
    flare: 0, headPitch: 0, headRoll: 0, droop: 0, glow: 0, wag: 0, paddle: 0,
    mouth: 0, sparkle: 0, env: 0, happy: 0,
  };
}

function computeTrick(trick: PetTrick | null, p: number): TrickOut {
  const o = restTrick();
  if (!trick) return o;
  const plateau = (a: number) => clamp(Math.min(p / a, (1 - p) / a), 0, 1);
  switch (trick) {
    case "hop": {
      o.env = plateau(0.1);
      if (p < 0.22) {
        // anticipation crouch
        const u = easeInOut(p / 0.22);
        o.squash = 1 - 0.24 * u;
        o.headPitch = 0.1 * u;
        o.droop = 0.3 * u;
      } else if (p < 0.8) {
        // joyful arc, stretched on the way up/down, round at the apex
        const u = (p - 0.22) / 0.58;
        o.y = 0.58 * 4 * u * (1 - u);
        const stretch = 1 + 0.16 * Math.pow(Math.abs(1 - 2 * u), 1.5) * (1 - smooth(0.85, 1, u));
        o.squash = lerp(0.76, stretch, smooth(0, 0.12, u));
        o.pitch = -0.12 * Math.sin(u * TAU);
        o.flare = Math.sin(u * PI);
        o.headPitch = -0.16 * Math.sin(u * PI);
        o.paddle = 0.35;
        o.happy = 1;
      } else {
        // soft squash landing
        const u = (p - 0.8) / 0.2;
        o.squash = 1 - 0.2 * Math.sin(u * PI) * (1 - 0.4 * u);
        o.happy = 1;
      }
      break;
    }
    case "spin": {
      o.env = plateau(0.12);
      o.centerPivot = true;
      o.y = 0.3 * Math.sin(p * PI);
      o.yaw = easeInOut(p) * TAU * 2;
      o.squash = 1 - 0.14 * Math.sin(clamp(p / 0.14, 0, 1) * PI) + 0.07 * Math.sin(p * PI);
      o.roll = 0.1 * Math.sin(p * PI);
      o.flare = Math.sin(p * PI);
      o.wag = 1.2 * o.env;
      o.happy = 1;
      break;
    }
    case "sing": {
      const env = plateau(0.18);
      o.env = env;
      o.headPitch = -0.48 * env;
      o.roll = Math.sin(p * PI * 6) * 0.09 * env;
      o.headRoll = Math.sin(p * PI * 6 + 0.7) * 0.16 * env;
      o.squash = 1 + 0.04 * Math.sin(p * PI * 12) * env;
      o.glow = env * (0.6 + 0.4 * Math.sin(p * PI * 16));
      o.mouth = env * (0.5 + 0.5 * Math.abs(Math.sin(p * PI * 8)));
      o.wag = 0.6 * env;
      o.happy = env > 0.3 ? 1 : 0;
      break;
    }
    case "dash": {
      const env = plateau(0.15);
      o.env = env;
      const ang = p * TAU;
      o.x = Math.sin(ang) * 0.45 * env;
      o.z = Math.sin(ang * 2) * 0.22 * env;
      const dx = 0.45 * Math.cos(ang);
      const dz = 0.44 * Math.cos(ang * 2);
      o.yaw = Math.atan2(dx, dz) * env;
      o.pitch = 0.2 * env;
      o.roll = -Math.sin(ang) * 0.22 * env;
      o.y = Math.abs(Math.sin(p * PI * 12)) * 0.05 * env;
      o.squash = 1 - 0.1 * env;
      o.paddle = env;
      o.droop = 0.55 * env; // ears / gills streamlined back
      o.wag = 0.8 * env;
      break;
    }
    case "bow": {
      const env = smooth(0, 0.3, p) * (1 - smooth(0.72, 1, p));
      o.env = env;
      o.pitch = 0.42 * env;
      o.headPitch = 0.28 * env;
      o.droop = env;
      o.wag = 1.4 * env;
      o.squash = 1 - 0.06 * env;
      o.happy = env > 0.4 ? 1 : 0;
      break;
    }
    case "flip": {
      o.env = plateau(0.1);
      o.centerPivot = true;
      if (p < 0.18) {
        const u = easeInOut(p / 0.18);
        o.squash = 1 - 0.25 * u;
        o.droop = 0.3 * u;
      } else if (p < 0.85) {
        const u = (p - 0.18) / 0.67;
        o.y = 0.85 * 4 * u * (1 - u);
        o.pitch = -TAU * easeInOut(u);
        o.squash = lerp(0.75, 1, smooth(0, 0.12, u)) * (1 - 0.1 * Math.sin(u * PI));
        o.flare = 1;
        o.sparkle = Math.pow(Math.sin(u * PI), 4);
        o.glow = 0.6 * o.sparkle;
        o.happy = 1;
      } else {
        const u = (p - 0.85) / 0.15;
        o.squash = 1 - 0.2 * Math.sin(u * PI);
        o.happy = 1;
      }
      break;
    }
  }
  return o;
}

// ----------------------------------------------------------------------------
// Shared rig core: transform stack, moods, blinking, look-at, squash & stretch
// ----------------------------------------------------------------------------

interface PetFrame {
  t: number;
  dt: number;
  breath: number;
  lid: number;
  happyEyes: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  eyeX: number;
  eyeY: number;
  flare: number;
  droop: number;
  perk: number;
  glow: number;
  blush: number;
  wag: number;
  paddle: number;
  mouth: number;
  sparkle: number;
  excite: number;
  dream: number;
  sleepy: number;
  airborne: number;
  pulse: number;
  petted: number;
  trick: PetTrick | null;
  env: number;
}

interface CoreConfig {
  /** Height of the body's centre of mass (flip / spin pivot) */
  centerY: number;
  /** Approximate head height at scale 1 (look-at origin) */
  headY: number;
  /** Z of the front toes (bow / lean pivot) */
  frontZ: number;
  stageScale: [number, number, number, number];
}

class PetCore {
  readonly root = new THREE.Group();
  readonly grow = new THREE.Group();
  readonly motion = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly inner = new THREE.Group();
  readonly body = new THREE.Group();
  stage: EvolutionStage = 1;
  frames = 0;
  private growCur: number;
  private readonly seed = Math.random() * 100;
  private blinkClock = 1.2 + Math.random() * 2;
  private blinkT = -1;
  private readonly sm: Record<string, number> = {};
  private readonly tmp = new THREE.Vector3();
  /** Ground-contact probes (paw soles, toes, tail underside) kept at y >= 0 */
  readonly contacts: THREE.Object3D[] = [];

  constructor(readonly cfg: CoreConfig) {
    this.root.add(this.grow);
    this.grow.add(this.motion);
    this.motion.add(this.tilt);
    this.tilt.add(this.inner);
    this.inner.add(this.body);
    this.growCur = cfg.stageScale[0];
    this.grow.scale.setScalar(this.growCur);
  }

  private s(key: string, target: number, lambda: number, dt: number): number {
    const v = damp(this.sm[key] ?? target, target, lambda, dt);
    this.sm[key] = v;
    return v;
  }

  /** Add a ground-contact probe at a local position inside `parent`. */
  contact(parent: THREE.Object3D, x: number, y: number, z: number): void {
    const o = at(new THREE.Object3D(), x, y, z);
    parent.add(o);
    this.contacts.push(o);
  }

  /** Lift the body so no contact probe sinks below the floor (called after limbs are posed). */
  settle(): void {
    this.root.updateMatrixWorld(true);
    let minY = Infinity;
    for (const c of this.contacts) {
      c.getWorldPosition(this.tmp);
      this.root.worldToLocal(this.tmp);
      minY = Math.min(minY, this.tmp.y);
    }
    if (minY < 0) this.motion.position.y -= minY / this.growCur;
  }

  frame(pose: PetPoseInput): PetFrame {
    this.frames++;
    const dt = clamp(pose.dt, 0, 0.05);
    const t = pose.time;
    const cfg = this.cfg;

    this.growCur = damp(this.growCur, cfg.stageScale[this.stage - 1], 3.5, dt);
    this.grow.scale.setScalar(this.growCur);

    const tr = computeTrick(pose.activeTrick, clamp(pose.trickPhase, 0, 1));
    const petted = clamp(pose.petted, 0, 1);
    const speaking = clamp(pose.speaking, 0, 1);
    const pulse = clamp(pose.attentionPulse, 0, 1);

    // ---- mood body language targets
    let mPitch = 0, mRoll = 0, crouch = 0, lean = 0, puff = 0, glow = 0, droop = 0;
    let perk = 0.15, wag = 0.35, lidBase = 0, lookW = 1, gazeUp = 0, hopB = 0;
    let dream = 0, sleepy = 0, wiggle = 0, joyEyes = 0;
    const smileCycle = (t + this.seed) % 6.5 < 2.4;
    switch (pose.mood) {
      case "happy":
        perk = 0.45; wag = 0.85; hopB = 1; joyEyes = smileCycle ? 1 : 0;
        break;
      case "curious":
        mRoll = 0.3 * (Math.sin(t * 0.33 + this.seed) >= 0 ? 1 : -1);
        perk = 1; lean = 0.07; wag = 0.4;
        break;
      case "playful":
        crouch = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 7.5));
        lean = 0.13; perk = 0.7; wag = 1.25; wiggle = 1;
        break;
      case "thinking":
        gazeUp = 1; mRoll = 0.12 * Math.sin(t * 0.7); lookW = 0.25;
        glow = 0.45 + 0.35 * Math.sin(t * 2.6); lidBase = 0.12; wag = 0.12;
        break;
      case "dreaming":
        crouch = 0.12; mPitch = 0.36; lidBase = 1; lookW = 0; droop = 1; wag = 0.05;
        dream = 1; perk = 0; glow = 0.2 + 0.15 * Math.sin(t * 0.9);
        break;
      case "proud":
        puff = 1; mPitch = -0.2; perk = 0.85; wag = 0.55; joyEyes = smileCycle ? 1 : 0;
        break;
      case "sleepy":
        lidBase = 0.5 + 0.3 * Math.max(0, Math.sin(t * 0.8));
        mPitch = 0.14 + 0.07 * Math.sin(t * 0.55); droop = 0.65; lookW = 0.45; wag = 0.1;
        sleepy = 1; perk = 0;
        break;
      default:
        break;
    }
    perk += clamp(pose.listening, 0, 1) * 0.5;

    mPitch = this.s("mPitch", mPitch, 4, dt);
    mRoll = this.s("mRoll", mRoll, 3, dt);
    crouch = this.s("crouch", crouch, 7, dt);
    lean = this.s("lean", lean, 4, dt);
    puff = this.s("puff", puff, 4, dt);
    glow = this.s("glow", glow, 3, dt);
    droop = this.s("droop", droop, 4, dt);
    perk = this.s("perk", perk, 5, dt);
    wag = this.s("wag", wag, 3, dt);
    lidBase = this.s("lidBase", lidBase, 4, dt);
    lookW = this.s("lookW", lookW, 3, dt);
    gazeUp = this.s("gazeUp", gazeUp, 3, dt);
    hopB = this.s("hopB", hopB, 3, dt);
    dream = this.s("dream", dream, 2, dt);
    sleepy = this.s("sleepy", sleepy, 2, dt);
    wiggle = this.s("wiggle", wiggle, 4, dt);

    // ---- natural blinking (occasional double blink, heavy when sleepy)
    this.blinkClock -= dt;
    if (this.blinkClock <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.blinkClock = Math.random() < 0.18 ? 0.3 : (sleepy > 0.5 ? 1.6 : 2.2) + Math.random() * 3.2;
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt / (sleepy > 0.5 ? 0.42 : 0.17);
      if (this.blinkT >= 1) this.blinkT = -1;
      else blink = Math.sin(this.blinkT * PI);
    }
    const lid = Math.max(blink, lidBase, dream);
    const happyEyes = this.s("happy", Math.max(petted > 0.1 ? 1 : 0, joyEyes, tr.happy) * (1 - dream), 10, dt);

    // ---- look-at (target converted into the pet's own space)
    this.root.updateWorldMatrix(true, false);
    const lt = this.root.worldToLocal(this.tmp.copy(pose.lookTarget));
    const dx = lt.x;
    const dy = lt.y - cfg.headY * this.growCur;
    const dz = lt.z - cfg.frontZ * this.growCur;
    const rawYaw = Math.atan2(dx, Math.max(0.2, dz));
    const rawPitch = -Math.atan2(dy, Math.max(0.2, Math.hypot(dx, dz)));
    const lw = lookW * (1 - tr.env * 0.85);
    const yawT = clamp(rawYaw, -0.75, 0.75) * lw;
    const pitchT = clamp(rawPitch, -0.42, 0.32) * lw + mPitch + tr.headPitch - gazeUp * 0.32;
    const rollT = mRoll + tr.headRoll - yawT * 0.12;
    let headYaw = this.s("hy", yawT, 5, dt);
    let headPitch = this.s("hp", pitchT, 5, dt);
    let headRoll = this.s("hr", rollT, 4, dt);
    headPitch += Math.sin(t * 11) * 0.06 * speaking;
    headRoll += Math.sin(t * 5.5) * 0.04 * speaking + Math.sin(t * 9) * 0.1 * petted;
    headYaw += Math.sin(t * 4.5) * 0.05 * petted;
    const eyeX = this.s("ex", clamp(rawYaw * 1.4, -1, 1) * lw, 14, dt);
    const eyeY = this.s("ey", clamp(-rawPitch * 1.6, -1, 1) * lw + gazeUp * 0.85, 14, dt);

    // ---- whole-body motion
    const breath = Math.sin(t * (dream > 0.5 || sleepy > 0.5 ? 1.3 : 2.3) + this.seed);
    const happyBounce = hopB * Math.pow(Math.max(0, Math.sin(t * 6.2)), 2) * 0.022;
    const playHop = wiggle * Math.pow(Math.max(0, Math.sin(t * 5)), 3) * 0.03;
    const float = dream * (0.5 + 0.5 * Math.sin(t * 0.9)) * 0.014;
    this.motion.position.set(tr.x, tr.y + happyBounce + playHop + float + Math.abs(Math.sin(tr.roll)) * 0.18, tr.z);
    this.motion.rotation.y = tr.yaw;

    if (tr.centerPivot) this.tilt.position.set(0, cfg.centerY, 0);
    else this.tilt.position.set(0, 0, cfg.frontZ);
    this.inner.position.copy(this.tilt.position).multiplyScalar(-1);
    const speedLean = clamp(pose.speed * 0.12, 0, 0.2);
    this.tilt.rotation.set(tr.pitch + lean + speedLean, 0, tr.roll);

    let sy = tr.squash * (1 - crouch) * (1 + 0.018 * breath) * (1 + 0.03 * puff);
    sy *= 1 - 0.05 * petted * (0.5 + 0.5 * Math.sin(t * 13));
    const sxz = (1 / Math.sqrt(sy)) * (1 + 0.035 * puff);
    this.body.scale.set(sxz, sy, sxz * (1 + 0.02 * puff));
    this.body.rotation.z = Math.sin(t * 15) * 0.04 * petted + Math.sin(t * 8) * 0.04 * wiggle;
    this.body.rotation.y = Math.sin(t * 7.5) * 0.08 * petted + Math.sin(t * 4) * 0.1 * wiggle;

    return {
      t,
      dt,
      breath,
      lid,
      happyEyes,
      headYaw,
      headPitch,
      headRoll,
      eyeX,
      eyeY,
      flare: tr.flare,
      droop: clamp(Math.max(droop, tr.droop) - tr.flare * 0.4, 0, 1),
      perk: clamp(perk, 0, 1.5),
      glow: clamp(pulse * 0.55 + glow + tr.glow, 0, 1.6),
      blush: clamp(0.2 + pose.affection * 0.25 + petted * 0.9 + happyEyes * 0.25 + tr.glow * 0.3, 0, 1.4),
      wag: wag + tr.wag + petted * 0.8,
      paddle: clamp(tr.paddle + pose.speed * 0.7, 0, 1.2),
      mouth: clamp(Math.max(speaking * (0.35 + 0.65 * Math.abs(Math.sin(t * 12.5))), tr.mouth), 0, 1),
      sparkle: tr.sparkle,
      excite: clamp(tr.env + petted + wiggle * 0.5 + hopB * 0.25 + perk * 0.15, 0, 1),
      dream,
      sleepy,
      airborne: clamp(tr.y * 3, 0, 1),
      pulse,
      petted,
      trick: pose.activeTrick,
      env: tr.env,
    };
  }
}

/** Attach a sculpted SDF mesh (+ optional fur shells) to a parent. */
function sculpted(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  fur?: FurShellOptions,
  furGeo?: THREE.BufferGeometry,
): THREE.Mesh {
  const mesh = solid(new THREE.Mesh(geo, mat));
  parent.add(mesh);
  if (fur) addFurShells(mesh, furGeo ?? geo, fur);
  return mesh;
}

// ============================================================================
// 1. MOCHI — Calico Kitten
// ============================================================================

const M_CREAM = lin(0xfff0dc);
const M_SNOW = lin(0xfffaf4);
const M_APRICOT = lin(0xeea05c);
const M_GINGER = lin(0xc9733a);
const M_ESPRESSO = lin(0x4a2c21);
const M_PINK = lin(0xffb2bd);
const M_BLUSH = lin(0xff9aa6);
const M_EYE_R = 0.07;

function mochiBodySdf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = el(x, y, z, 0, 0.29, -0.03, 0.245, 0.25, 0.275); // plump torso
  d = smin(d, el(x, y, z, 0, 0.35, 0.1, 0.185, 0.2, 0.16), 0.1); // fluffy chest bib
  d = smin(d, el(x, y, z, 0, 0.19, 0.0, 0.215, 0.16, 0.2), 0.08); // soft belly
  d = smin(d, el(ax, y, z, 0.085, 0.44, -0.04, 0.085, 0.055, 0.09), 0.08); // shoulder blades
  d = smin(d, el(ax, y, z, 0.15, 0.15, -0.08, 0.125, 0.14, 0.17), 0.07); // pear haunches
  d = smin(d, el(ax, y, z, 0.175, 0.035, 0.05, 0.066, 0.045, 0.1), 0.05); // tucked hind paws
  if (y < 0.1 && z > 0.06 && ax > 0.1) {
    for (let k = -1; k <= 1; k++) {
      d = smin(d, sph(ax, y, z, 0.175 + k * 0.025, 0.024, 0.143 - Math.abs(k) * 0.006, 0.023), 0.012); // toes
    }
  }
  d = smin(d, sdRoundCone(x, y, z, 0, 0.4, 0.0, 0, 0.55, 0.05, 0.145, 0.115), 0.08); // neck into skull
  d = lumps(d, () => sdfNoise3(x * 9 + 1.3, y * 9 + 4.1, z * 9 + 2.2), 0.018); // plush fur contour lumps
  return smax(d, -y, 0.01); // flat soles on y = 0
}

function mochiHeadBase(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = el(x, y, z, 0, 0.0, -0.02, 0.262, 0.218, 0.235); // skull
  d = smin(d, el(x, y, z, 0, 0.07, 0.02, 0.2, 0.15, 0.2), 0.08); // forehead dome
  d = smin(d, el(ax, y, z, 0.13, -0.075, 0.08, 0.135, 0.105, 0.12), 0.08); // puffy cheek pads
  d = smin(d, sdRoundCone(ax, y, z, 0.2, -0.06, 0.02, 0.305, -0.12, -0.01, 0.06, 0.014), 0.05); // cheek ruff
  d = smin(d, sdRoundCone(ax, y, z, 0.23, -0.1, 0.0, 0.3, -0.175, -0.03, 0.045, 0.01), 0.04);
  d = smin(d, el(ax, y, z, 0.043, -0.072, 0.19, 0.058, 0.046, 0.05), 0.04); // whisker pads
  d = smin(d, el(x, y, z, 0, -0.03, 0.2, 0.03, 0.04, 0.035), 0.03); // nose bridge
  d = smin(d, el(x, y, z, 0, -0.118, 0.165, 0.045, 0.03, 0.04), 0.035); // soft chin
  d = smin(d, el(ax, y, z, 0.145, 0.16, -0.02, 0.085, 0.055, 0.065), 0.06); // ear roots
  d = smin(d, el(ax, y, z, 0.1, 0.075, 0.165, 0.07, 0.022, 0.04), 0.03); // brow / upper lid
  const back = ss(0.06, -0.12, z);
  d = lumps(d, () => sdfNoise3(x * 10 + 3, y * 10 + 1, z * 10 + 7), 0.016 * (0.3 + 0.7 * back));
  return d;
}

interface HeadDesign {
  sdf: Sdf;
  eye: { x: number; y: number; z: number; yaw: number; roll: number; sx: number; sy: number };
}

let mochiHeadDesign: HeadDesign | null = null;
function getMochiHead(): HeadDesign {
  if (mochiHeadDesign) return mochiHeadDesign;
  const ex = 0.104;
  const ey = 0.018;
  const zs = surfZ(mochiHeadBase, ex, ey);
  const eye = { x: ex, y: ey, z: zs - M_EYE_R * 0.72 * 0.55, yaw: 0.22, roll: 0, sx: 1, sy: 1 };
  const sdf: Sdf = (x, y, z) =>
    smax(
      mochiHeadBase(x, y, z),
      -sdSocket(Math.abs(x), y, z, eye.x, eye.y, eye.z, eye.yaw, 0, M_EYE_R * 1.07, M_EYE_R * 1.07, M_EYE_R * 0.8),
      0.014,
    );
  mochiHeadDesign = { sdf, eye };
  return mochiHeadDesign;
}

function mochiGeometries() {
  const head = getMochiHead();
  const bodyGeo = cached("mochi.body", () =>
    buildSdfGeometry({
      sdf: mochiBodySdf,
      min: [-0.34, -0.03, -0.37],
      max: [0.34, 0.7, 0.33],
      cell: 0.024,
      paint(x, y, z) {
        let c = M_CREAM;
        // snowy bib & mittens
        const bib = ss(0.07, 0.17, z + (sdfNoise3(x * 8, y * 8, 3) - 0.5) * 0.06) * ss(0.56, 0.4, y);
        c = mixc(c, M_SNOW, bib);
        // organic calico patches: apricot-ginger & roasted espresso
        const ap = Math.max(
          blob(x, y, z, -0.17, 0.3, -0.16, 0.17, 0.04, 0.08, 7, 3),
          blob(x, y, z, 0.02, 0.2, -0.31, 0.1, 0.035, 0.06, 7, 5),
          blob(x, y, z, -0.2, 0.12, -0.02, 0.09, 0.035, 0.05, 9, 8),
        );
        c = mixc(c, mixc(M_APRICOT, M_GINGER, sdfNoise3(x * 14, y * 14, z * 14) * 0.6), ap);
        const es = Math.max(
          blob(x, y, z, 0.15, 0.42, -0.12, 0.12, 0.035, 0.07, 8, 11),
          blob(x, y, z, 0.21, 0.2, -0.2, 0.08, 0.03, 0.05, 9, 13),
          blob(x, y, z, -0.21, 0.38, -0.1, 0.05, 0.025, 0.03, 10, 17),
        );
        c = mixc(c, M_ESPRESSO, es * 0.94);
        const mitten = ss(0.08, 0.04, y) * ss(-0.02, 0.06, z);
        c = mixc(c, M_SNOW, mitten);
        return [c[0], c[1], c[2], 0];
      },
    }),
  );
  const headGeo = cached("mochi.head", () =>
    buildSdfGeometry({
      sdf: head.sdf,
      min: [-0.36, -0.3, -0.3],
      max: [0.36, 0.3, 0.34],
      cell: 0.022,
      paint(x, y, z, _nx, _ny, nz) {
        const ax = Math.abs(x);
        let c = M_CREAM;
        const ap = Math.max(
          blob(x, y, z, 0.13, 0.16, 0.02, 0.13, 0.04, 0.07, 8, 1),
          blob(x, y, z, 0.2, 0.0, -0.15, 0.12, 0.04, 0.06, 8, 2),
        );
        c = mixc(c, M_APRICOT, ap);
        const es = Math.max(
          blob(x, y, z, -0.15, 0.13, -0.06, 0.12, 0.035, 0.06, 8, 4),
          blob(x, y, z, -0.04, 0.17, -0.18, 0.09, 0.035, 0.05, 8, 6),
        );
        c = mixc(c, M_ESPRESSO, es * 0.92);
        // forehead tabby "M" stripes
        const fore = ss(0.08, 0.12, y) * ss(0.23, 0.17, y) * ss(0.2, 0.5, nz);
        const sw = 0.013;
        const s0 = ss(sw + 0.01, sw - 0.004, Math.abs(x));
        const s1 = ss(sw + 0.01, sw - 0.004, Math.abs(ax - (0.052 + (y - 0.1) * 0.35)));
        c = mixc(c, M_GINGER, Math.max(s0, s1) * fore * 0.55);
        // snowy muzzle & chin
        const muzzle = Math.max(
          blob(ax, y, z, 0.045, -0.078, 0.2, 0.07, 0.025, 0.02, 12, 9),
          blob(x, y, z, 0, -0.12, 0.16, 0.055, 0.025, 0.02, 12, 10),
        );
        c = mixc(c, M_SNOW, muzzle);
        // rosy cheek blush
        c = mixc(c, M_BLUSH, blob(ax, y, z, 0.165, -0.05, 0.16, 0.045, 0.04, 0, 1, 0) * 0.42);
        return [c[0], c[1], c[2], 0];
      },
    }),
  );
  const legGeo = (side: number) =>
    cached(`mochi.leg${side}`, () =>
      buildSdfGeometry({
        sdf(x, y, z) {
          let d = sdRoundCone(x, y, z, 0, 0.03, -0.01, 0, -0.18, 0.012, 0.056, 0.044);
          d = smin(d, el(x, y, z, 0, -0.228, 0.03, 0.058, 0.042, 0.07), 0.04);
          for (let k = -1; k <= 1; k++) {
            d = smin(d, sph(x, y, z, k * 0.026, -0.238, 0.083 - Math.abs(k) * 0.008, 0.022), 0.01);
          }
          d = lumps(d, () => sdfNoise3(x * 14 + side, y * 14, z * 14), 0.008);
          return smax(d, -(y + 0.27), 0.008);
        },
        min: [-0.1, -0.3, -0.09],
        max: [0.1, 0.11, 0.14],
        cell: 0.014,
        paint(_x, y) {
          let c = side < 0 ? M_CREAM : M_APRICOT;
          c = mixc(c, M_SNOW, ss(-0.15, -0.19, y));
          return [c[0], c[1], c[2], 0];
        },
      }),
    );
  const earGeo = (side: number) =>
    cached(`mochi.ear${side}`, () => {
      const g = buildSdfGeometry({
        sdf(x, y, z) {
          const zb = z - 0.28 * y * y;
          let d = sdRoundCone(x, y, zb / 0.36, 0, -0.05, 0, 0, 0.185, 0, 0.094, 0.012) * 0.36;
          const inner = sdRoundCone(x, y, (zb - 0.018) / 0.3, 0, -0.01, 0, 0, 0.155, 0, 0.068, 0.006) * 0.3;
          d = smax(d, -inner, 0.008);
          for (const k of [-1, 1]) {
            d = smin(d, sdRoundCone(x, y, z, k * 0.02, 0.0, 0.014, k * 0.032, 0.075, 0.026, 0.011, 0.003), 0.007);
          }
          return d;
        },
        min: [-0.11, -0.08, -0.06],
        max: [0.11, 0.22, 0.08],
        cell: 0.0095,
        paint(x, y, z, _nx, _ny, nz) {
          const zb = z - 0.28 * y * y;
          const innerMask = ss(0.004, 0.018, zb) * ss(-0.1, 0.35, nz) * ss(0.17, 0.12, y);
          let c = side < 0 ? M_ESPRESSO : M_APRICOT;
          c = mixc(c, M_PINK, innerMask);
          const tuft = ss(0.035, 0.02, Math.abs(Math.abs(x) - 0.026)) * ss(0.09, 0.03, y) * innerMask;
          c = mixc(c, M_SNOW, tuft * 0.85);
          return [c[0], c[1], c[2], 0.9];
        },
      });
      addMaskAttr(g, "aGlow", (_x, y) => ss(0.12, 0.185, y));
      return g;
    });
  const tailGeo = cached("mochi.tail", () => {
    const g = buildSdfGeometry({
      sdf(x, y, z) {
        let d = sdRoundCone(x, y, z, 0, -0.04, 0, 0, 0.53, 0, 0.05, 0.04);
        d = smin(d, el(x, y, z, 0, 0.565, 0, 0.047, 0.062, 0.047), 0.04);
        return lumps(d, () => sdfNoise3(x * 16, y * 12 + 5, z * 16), 0.01);
      },
      min: [-0.08, -0.07, -0.08],
      max: [0.08, 0.66, 0.08],
      cell: 0.013,
      paint(x, y, z) {
        const yy = y + (sdfNoise3(x * 10, y * 6, z * 10) - 0.5) * 0.05;
        let c = M_APRICOT;
        c = mixc(c, M_CREAM, ss(0.13, 0.16, yy) * ss(0.25, 0.22, yy));
        c = mixc(c, M_ESPRESSO, ss(0.33, 0.36, yy) * ss(0.42, 0.39, yy));
        c = mixc(c, M_ESPRESSO, ss(0.5, 0.54, yy));
        return [c[0], c[1], c[2], ss(0.5, 0.6, y) * 0.5];
      },
    });
    addMaskAttr(g, "aTip", (_x, y) => ss(0.44, 0.6, y));
    addSkin(g, "y", 0.066, 9);
    return g;
  });
  const crescentGeo = cached("mochi.crescent", () =>
    buildSdfGeometry({
      sdf: (x, y, z) => smax(el(x, y, z, 0, 0, 0, 0.06, 0.06, 0.018), -el(x, y, z, 0.028, 0.016, 0, 0.054, 0.054, 0.04), 0.004),
      min: [-0.075, -0.075, -0.03],
      max: [0.075, 0.075, 0.03],
      cell: 0.005,
      paint: () => [1, 1, 1, 0],
    }),
  );
  legGeo(-1);
  legGeo(1);
  earGeo(-1);
  earGeo(1);
  return { head, bodyGeo, headGeo, legGeo, earGeo, tailGeo, crescentGeo };
}

function buildMochiRig(): PetModelRig {
  const core = new PetCore({ centerY: 0.42, headY: 0.68, frontZ: 0.2, stageScale: [0.85, 0.93, 1.0, 1.07] });
  const { root, body } = core;
  const hitMeshes: THREE.Object3D[] = [];
  const reveals: Reveal[] = [];
  const G = mochiGeometries();
  const pulseUniform = uniform(0.2);
  const uEarShimmer = uniform(0);
  const uTailAurora = uniform(0);

  // ---- materials
  const furMat = makePlushSssMaterial({ sssColor: 0xffb38a, sssStrength: 0.85, roughness: 0.84, sheen: 0.8, grainScale: 44, pulseUniform });
  const earMat = makePlushSssMaterial({ sssColor: 0xff9c7a, sssStrength: 1.2, roughness: 0.78, sheen: 0.7, grainScale: 60, pulseUniform });
  addEmissiveMask(earMat, "aGlow", 0xffdf9a, uEarShimmer);
  const tailMat = makePlushSssMaterial({ sssColor: 0xffb38a, sssStrength: 0.9, roughness: 0.84, sheen: 0.8, grainScale: 48, pulseUniform });
  addEmissiveMask(tailMat, "aTip", 0xffb0e0, uTailAurora);
  const lidMat = makePlushSssMaterial({ baseColor: 0xfff0dc, useSdfAttrs: false, sssColor: 0xffb38a, sssStrength: 0.5 });
  const noseMat = new THREE.MeshPhysicalMaterial({
    color: 0xff8fa3, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: new THREE.Color(0xffd0dc),
  });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x4b2a28, roughness: 0.55 });
  const mouthMat = glossy(0x6e2633, 0.45);
  const tongueMat = glossy(0xff7e95, 0.35);
  const whiskerMat = new THREE.MeshPhysicalMaterial({ color: 0xfffdf8, roughness: 0.3, clearcoat: 0.5, emissive: 0xffffff, emissiveIntensity: 0.05 });
  const follicleMat = new THREE.MeshStandardMaterial({ color: 0xc89a86, roughness: 0.7 });
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff9db0, emissive: 0xff7f9c, emissiveIntensity: 0.2, roughness: 0.8, transparent: true, opacity: 0.5, depthWrite: false,
  });

  // ---- seamless sculpted torso (+ volumetric fur shells)
  const torsoG = new THREE.Group();
  body.add(torsoG);
  const torso = sculpted(torsoG, G.bodyGeo, furMat, { layers: 5, length: 0.02, density: 58, sssColor: 0xffb38a });
  hitMeshes.push(torso);
  for (const side of [-1, 1]) {
    core.contact(body, side * 0.175, 0, 0.05);
    core.contact(body, side * 0.175, 0, 0.14);
  }

  // ---- front legs with toe beans (pivot at the shoulder)
  const frontLegs: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.095, 0.27, 0.17);
    const leg = sculpted(pivot, G.legGeo(side), furMat, { layers: 3, length: 0.014, density: 64, sssColor: 0xffb38a });
    hitMeshes.push(leg);
    core.contact(pivot, 0, -0.27, 0.03);
    core.contact(pivot, 0, -0.268, 0.09);
    body.add(pivot);
    frontLegs.push({ pivot, side });
  }

  // ---- articulated calico tail: one sculpt skinned on a 9-bone chain
  const tailBase = at(new THREE.Group(), 0, 0.12, -0.26);
  body.add(tailBase);
  const TAIL_N = 9;
  const tail = makeSkinChain(G.tailGeo, tailMat, TAIL_N, new THREE.Vector3(0, 0.066, 0), {
    layers: 4, length: 0.02, density: 56, sssColor: 0xffc49a, groom: [0, 0.3, -0.2],
  });
  tailBase.add(tail.mesh);
  hitMeshes.push(tail.mesh);
  const tailJoints = tail.joints;
  const tailTip = tail.tip;

  // ---- head
  const neck = at(new THREE.Group(), 0, 0.5, 0.03);
  neck.rotation.order = "YXZ";
  body.add(neck);
  const headG = new THREE.Group();
  neck.add(headG);
  const face = at(new THREE.Group(), 0, 0.16, 0.02);
  headG.add(face);
  const E = G.head.eye;
  const mochiFaceMask = (x: number, y: number, z: number) =>
    Math.max(
      blob(Math.abs(x), y, z, E.x, E.y, E.z + 0.02, 0.085, 0.03, 0),
      blob(Math.abs(x) * 0.8, y, z, 0, -0.07, 0.21, 0.075, 0.03, 0),
    );
  const skull = sculpted(
    face,
    G.headGeo,
    furMat,
    { layers: 5, length: 0.02, density: 58, sssColor: 0xffb38a, groom: [0, -0.3, -0.45] },
    furProxy("mochi.headFur", G.headGeo, mochiFaceMask, 0.028),
  );
  hitMeshes.push(skull);
  const hs = G.head.sdf;

  // wet sculpted nose with a glint
  const nZ = surfZ(hs, 0, -0.035);
  const nose = at(ell(0.022, 1.35, 0.85, 0.75, noseMat, 18), 0, -0.035, nZ + 0.004);
  nose.rotation.x = 0.35;
  face.add(solid(nose));
  face.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })), 0.008, -0.029, nZ + 0.019));
  const philtrum = stick(new THREE.Mesh(new THREE.CapsuleGeometry(0.0032, 0.014, 4, 6), lineMat), hs, 0, -0.06, surfZ(hs, 0, -0.06), 0.001, false);
  face.add(philtrum);
  // delicate ω smile
  const smileY = -0.072;
  const smileG = stick(new THREE.Group(), hs, 0, smileY, surfZ(hs, 0, smileY), 0.003);
  face.add(smileG);
  for (const side of [-1, 1]) {
    const s = at(arcMesh(0.019, 0.0038, PI, lineMat), side * 0.019, 0, 0);
    s.rotation.z = PI;
    smileG.add(s);
  }
  const mouthOpen = stick(new THREE.Group(), hs, 0, -0.098, surfZ(hs, 0, -0.098), -0.006);
  mouthOpen.add(ell(0.026, 1.2, 1, 0.5, mouthMat, 16));
  mouthOpen.add(at(ell(0.016, 1.2, 0.6, 0.5, tongueMat, 12), 0, -0.01, 0.006));
  face.add(mouthOpen);

  // jewel eyes nested in carved sockets, tilted along the skull
  const eyes: EyeRig[] = [];
  for (const side of [-1, 1]) {
    const eye = makeJewelEye(M_EYE_R, 0x3ba87c, 0xa8f5c8, 0.42, lidMat, lineMat);
    eye.group.position.set(side * E.x, E.y, E.z);
    eye.group.rotation.y = side * E.yaw;
    face.add(eye.group);
    eyes.push(eye);
    const bx = side * 0.165;
    const blush = stick(ell(0.042, 1.3, 0.75, 0.25, blushMat, 16), hs, bx, -0.055, surfZ(hs, bx, -0.055), 0.004);
    face.add(blush);
  }

  // whisker follicles + curved tube whiskers
  const whiskers: { g: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    for (const [i, dy] of [0.016, 0, -0.016].entries()) {
      const fx = side * (0.06 + i * 0.006);
      const fy = -0.064 + dy;
      const fz = surfZ(hs, fx, fy);
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), follicleMat), fx, fy, fz));
      g.add(tube([[fx, fy, fz], [fx + side * 0.09, fy + dy * 0.6 + 0.006, fz - 0.012], [fx + side * 0.2, fy + dy * 1.4 - 0.006, fz - 0.05]], 0.0028, whiskerMat, 14, 5));
    }
    face.add(g);
    whiskers.push({ g, side });
  }

  // sculpted cupped ears (one espresso, one apricot) with backlit peach SSS
  const ears: { pivot: THREE.Group; side: number; tip: THREE.Group }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.155, 0.165, -0.01);
    const ear = sculpted(pivot, G.earGeo(side), earMat);
    hitMeshes.push(ear);
    const tip = at(new THREE.Group(), 0, 0.2, 0.01);
    pivot.add(tip);
    face.add(pivot);
    ears.push({ pivot, side, tip });
  }

  // ---- collars fitted to the sculpted neck
  const collarRing = fitRing(mochiBodySdf, 0, 0.45, 0.03, 0.32, 0.012);
  // Stage 1: tiny woven collar thread
  const threadWrap = new THREE.Group();
  body.add(threadWrap);
  reveals.push(new Reveal(threadWrap, 1, 1));
  threadWrap.add(braid(collarRing, 2, 0.0035, 26, 0.0032, [makeSilkFabricMaterial(0xd8394a, 0xffc0c8), makeSilkFabricMaterial(0xfff0d8, 0xffffff)]));
  const front = collarRing.pts[0];
  const frontN = collarRing.radial[0];
  const threadKnot = at(ell(0.011, 1, 0.8, 0.7, makeSilkFabricMaterial(0xd8394a, 0xffc0c8), 12), front.x, front.y, front.z + 0.004);
  threadWrap.add(solid(threadKnot));

  // Stage 2: crimson & gold embroidered silk kimono collar, pleated bow, suzu bell, tassels
  const collarWrap = new THREE.Group();
  body.add(collarWrap);
  reveals.push(new Reveal(collarWrap, 2));
  const silk = makeSilkFabricMaterial(0xb3122e, 0xff9fb0);
  const silkDeep = makeSilkFabricMaterial(0x7a0c22, 0xff7088);
  const gold = makeArtisanMetalMaterial(0xe6be68, 0.28);
  const brass = makeArtisanMetalMaterial(0xd9a94e, 0.34);
  const bandRing = fitRing(mochiBodySdf, 0, 0.45, 0.03, 0.32, 0.016);
  const band = solid(ribbonBand(bandRing, 0.042, 0.008, silk));
  (band.material as THREE.Material).side = THREE.DoubleSide;
  collarWrap.add(band);
  collarWrap.add(solid(closedTube(ringShift(bandRing, 0.004, 0.021), 0.0042, gold, 6)));
  collarWrap.add(solid(closedTube(ringShift(bandRing, 0.004, -0.021), 0.0042, gold, 6)));
  // embroidered gold chrysanthemum knots along the band
  const knotGeo = new THREE.IcosahedronGeometry(0.0065, 0);
  for (let i = 3; i < bandRing.pts.length; i += 6) {
    if (i > bandRing.pts.length - 4) break;
    const p = bandRing.pts[i].clone().addScaledVector(bandRing.radial[i], 0.012);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + i;
      const dot = new THREE.Mesh(knotGeo, gold);
      dot.position.copy(p).addScaledVector(bandRing.up, Math.sin(a) * 0.008).addScaledVector(new THREE.Vector3().crossVectors(bandRing.up, bandRing.radial[i]), Math.cos(a) * 0.008);
      dot.scale.set(1, 1, 0.5);
      collarWrap.add(dot);
    }
  }
  const bandFront = bandRing.pts[0].clone().addScaledVector(bandRing.radial[0], 0.012);
  const bowG = at(new THREE.Group(), bandFront.x, bandFront.y + 0.006, bandFront.z);
  bowG.quaternion.setFromUnitVectors(Z_AXIS, frontN);
  collarWrap.add(bowG);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      // three stacked pleats per loop
      const loop = at(new THREE.Mesh(new THREE.TorusGeometry(0.03 - k * 0.006, 0.0085 - k * 0.0015, 10, 26), k === 1 ? silkDeep : silk), side * (0.036 - k * 0.003), 0.004, k * 0.004);
      loop.scale.set(1.25, 0.72, 0.5);
      loop.rotation.z = side * 0.32;
      bowG.add(solid(loop));
    }
    const ribbonTail = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.05, 4, 10), silk), side * 0.018, -0.04, 0.002);
    ribbonTail.scale.set(1.4, 1, 0.4);
    ribbonTail.rotation.z = side * 0.32;
    bowG.add(solid(ribbonTail));
  }
  bowG.add(solid(ell(0.015, 1, 1.05, 0.8, silkDeep, 14)));
  bowG.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.0155, 0.0022, 6, 20), gold), 0, 0, 0.004));
  // hanging hammered brass suzu bell
  const bellPivot = at(new THREE.Group(), 0, -0.018, 0.012);
  bowG.add(bellPivot);
  bellPivot.add(solid(at(new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0032, 6, 14), brass), 0, -0.004, 0)));
  const bellBody = solid(at(new THREE.Mesh(hammer(new THREE.SphereGeometry(0.034, 36, 26), 0.08, 160), brass), 0, -0.043, 0));
  bellPivot.add(bellBody);
  const bellBand = at(new THREE.Mesh(new THREE.TorusGeometry(0.0342, 0.0026, 6, 36), gold), 0, -0.043, 0);
  bellBand.rotation.x = PI / 2;
  bellPivot.add(bellBand);
  const slit = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.0034, 0.03, 4, 8), lineMat), 0, -0.064, 0.026);
  slit.rotation.z = PI / 2;
  slit.rotation.x = -0.6;
  bellPivot.add(slit);
  bellPivot.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), lineMat), 0, -0.056, 0.029));
  const bellGlow = makeHdrGlowMaterial(0xffcf6a, 0.25, pulseUniform);
  bellPivot.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), bellGlow), 0, -0.022, 0.026));
  // silk tassels
  const tassels: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const tas = at(new THREE.Group(), side * 0.05, -0.012, 0.0);
    tas.add(tube([[0, 0, 0], [side * 0.004, -0.018, 0.002], [0, -0.034, 0]], 0.0022, gold, 8, 4));
    tas.add(solid(at(ell(0.007, 1, 1, 1, gold, 10), 0, -0.036, 0)));
    const skirt = solid(at(new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.012, 0.04, 14, 1, true), silk), 0, -0.06, 0));
    (skirt.material as THREE.Material).side = THREE.DoubleSide;
    tas.add(skirt);
    bowG.add(tas);
    tassels.push(tas);
  }

  // Stage 3: floating golden origami star-charms + luminous spirit firefly motes + ear-tip shimmer
  const charmsWrap = new THREE.Group();
  body.add(charmsWrap);
  reveals.push(new Reveal(charmsWrap, 3));
  const origamiGold = makeArtisanMetalMaterial(0xf2c86a, 0.36);
  const starGeo = makeOrigamiStarGeo(0.03, 0.014);
  const stars: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const s = solid(new THREE.Mesh(starGeo, i % 2 === 0 ? origamiGold : makeSilkFabricMaterial(0xffb4a0, 0xfff0e0)));
    charmsWrap.add(s);
    stars.push(s);
  }
  const fireflyMat = makeHdrGlowMaterial(0xffe28a, 2.4, pulseUniform);
  const fireflies: { g: THREE.Group; halo: THREE.MeshBasicMaterial }[] = [];
  const ffHalo = [0xffd27a, 0xfff0b0, 0xffc0a8, 0xe8ffb0, 0xffe0f0, 0xffd27a, 0xfff6c8];
  for (let i = 0; i < 7; i++) {
    const m = makeMote(fireflyMat, ffHalo[i], 0.009);
    charmsWrap.add(m.g);
    fireflies.push(m);
  }

  // Stage 4: rotating brass filigree crescent-moon astrolabe halo + pastel-aurora tail plume
  const astroWrap = at(new THREE.Group(), 0, 0.43, -0.02);
  face.add(astroWrap);
  reveals.push(new Reveal(astroWrap, 4));
  const astroBrass = makeArtisanMetalMaterial(0xe0b660, 0.22);
  const ringOuter = new THREE.Group();
  astroWrap.add(ringOuter);
  const outer = solid(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.0055, 8, 96), astroBrass));
  outer.rotation.x = PI / 2;
  ringOuter.add(outer);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, i % 2 === 0 ? 0.02 : 0.011), astroBrass);
    tick.position.set(Math.cos(a) * 0.162, 0, Math.sin(a) * 0.162);
    tick.rotation.y = -a + PI / 2;
    ringOuter.add(tick);
    if (i % 4 === 0) {
      const scroll = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0018, 6, 18, PI * 1.6), astroBrass);
      scroll.position.set(Math.cos(a) * 0.184, 0, Math.sin(a) * 0.184);
      scroll.rotation.y = -a;
      ringOuter.add(scroll);
    }
  }
  const gimbal = new THREE.Group();
  astroWrap.add(gimbal);
  gimbal.add(solid(new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.0038, 8, 80), astroBrass)));
  const gimbal2 = new THREE.Group();
  gimbal.add(gimbal2);
  const g2 = solid(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.003, 8, 72), astroBrass));
  g2.rotation.y = PI / 2;
  gimbal2.add(g2);
  const crescent = solid(new THREE.Mesh(G.crescentGeo, makeArtisanMetalMaterial(0xf3d17a, 0.18)));
  crescent.rotation.z = -0.5;
  astroWrap.add(crescent);
  const astroGlow = makeHdrGlowMaterial(0xfff0c0, 2.0, pulseUniform);
  const astroStars: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const s = makeStar(0.02, astroGlow);
    const a = (i / 5) * TAU;
    s.position.set(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17);
    ringOuter.add(s);
    astroStars.push(s);
  }
  const auroraWrap = new THREE.Group();
  tailTip.add(auroraWrap);
  reveals.push(new Reveal(auroraWrap, 4));
  const auroraMats: THREE.MeshBasicMaterial[] = [];
  const auroraMeshes: THREE.Mesh[] = [];
  const plumeGeo = makeTeardropGeo(0.05);
  for (let i = 0; i < 5; i++) {
    const m = additive(0xffb0d0, 0.28 - i * 0.04);
    auroraMats.push(m);
    const mesh = at(new THREE.Mesh(plumeGeo, m), 0, 0.03 + i * 0.03, -i * 0.018);
    mesh.scale.set(1 + i * 0.35, 1.2 + i * 0.4, 1 + i * 0.35);
    auroraWrap.add(mesh);
    auroraMeshes.push(mesh);
  }
  auroraWrap.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), makeHdrGlowMaterial(0xffd6f4, 2.2, pulseUniform)), 0, 0.02, 0));

  const burst = makeBurst([0xffe2a0, 0xffb3c8, 0xfff6e0]);
  burst.group.position.y = 0.55;
  core.motion.add(burst.group);

  const headAnchor = at(new THREE.Object3D(), 0, 0.56, 0);
  headG.add(headAnchor);

  // ---- animation state
  let headScale = 1.1;
  let earTwitchClock = 3;
  let earTwitchT = -1;
  let earTwitchSide = 1;

  function setEvolution(stage: EvolutionStage): void {
    core.stage = stage;
    if (core.frames === 0) {
      for (const r of reveals) r.tick(stage, 0, true);
      headScale = stage === 1 ? 1.1 : stage === 2 ? 1.04 : 1;
    }
  }

  function update(pose: PetPoseInput): void {
    if (pose.evolution !== core.stage) setEvolution(pose.evolution);
    const f = core.frame(pose);
    const { t, dt } = f;
    for (const r of reveals) r.tick(core.stage, dt);
    pulseUniform.value = pose.attentionPulse;

    // kitten proportions: bigger head while tiny
    headScale = damp(headScale, core.stage === 1 ? 1.1 : core.stage === 2 ? 1.04 : 1, 3, dt);
    headG.scale.setScalar(headScale);
    neck.rotation.set(f.headPitch, f.headYaw, f.headRoll);

    for (const e of eyes) e.update(f.eyeX, f.eyeY, f.lid, f.happyEyes);

    // ears: perk forward, droop sideways, flare in the air, occasional twitch
    earTwitchClock -= dt;
    if (earTwitchClock <= 0) {
      earTwitchClock = 2.5 + Math.random() * 4.5;
      earTwitchT = 0;
      earTwitchSide = Math.random() < 0.5 ? -1 : 1;
    }
    let twitch = 0;
    if (earTwitchT >= 0) {
      earTwitchT += dt / 0.28;
      if (earTwitchT >= 1) earTwitchT = -1;
      else twitch = Math.sin(earTwitchT * TAU) * 0.22;
    }
    for (const e of ears) {
      e.pivot.rotation.z = -e.side * (0.3 + 0.6 * f.droop - 0.12 * f.perk + 0.3 * f.flare) + (e.side === earTwitchSide ? twitch : 0);
      e.pivot.rotation.x = -0.06 + 0.2 * f.perk - 0.45 * f.droop + Math.sin(t * 1.3 + e.side) * 0.03;
    }
    uEarShimmer.value = core.stage >= 3 ? (0.35 + 0.35 * Math.sin(t * 3.2) + 0.6 * f.glow) * (charmsWrap.visible ? 1 : 0) : 0;

    for (const w of whiskers) {
      w.g.rotation.y = w.side * (Math.sin(t * 1.7 + w.side) * 0.03 + f.mouth * 0.06 - f.happyEyes * 0.03);
      w.g.rotation.z = w.side * (Math.sin(t * 2.3) * 0.03 - f.droop * 0.08);
    }

    mouthOpen.visible = f.mouth > 0.04;
    mouthOpen.scale.set(1, Math.max(0.05, f.mouth), 1);
    smileG.scale.setScalar(1 - f.mouth * 0.15);
    blushMat.emissiveIntensity = 0.12 + f.blush * 0.65;
    blushMat.opacity = 0.25 + 0.45 * clamp(f.blush, 0, 1);
    nose.scale.set(1.35, 0.85 + Math.sin(t * 3.1) * 0.03, 0.75);

    // front paws: zoomie paddle, polite bow reach, airborne tuck, petted kneading
    const bowEnv = f.trick === "bow" ? f.env : 0;
    for (const l of frontLegs) {
      const paddle = Math.sin(t * 17 + (l.side > 0 ? PI : 0)) * 0.6 * f.paddle;
      const knead = l.side > 0 ? -0.35 * f.petted * (0.5 + 0.5 * Math.sin(t * 7)) : 0;
      l.pivot.rotation.x = paddle + knead - 0.55 * bowEnv - 0.35 * f.airborne;
      l.pivot.rotation.z = l.side * 0.05 * f.airborne;
    }

    // tail: lazy sway ↔ excited perk, curl around the body while dreaming
    const ex = f.excite;
    const baseX = lerp(-1.3, -0.45, clamp(ex * 0.8 + f.perk * 0.25 + f.flare * 0.4, 0, 1)) - 0.25 * f.sleepy;
    const swayAmp = 0.08 + 0.12 * ex + 0.06 * f.wag;
    const swaySpeed = 1.3 + 3 * ex + f.wag;
    for (let i = 0; i < TAIL_N; i++) {
      const u = i / (TAIL_N - 1);
      const awakeX = i === 0 ? baseX : 0.14 + 0.1 * u * (1 - 0.5 * ex) + (u > 0.75 ? 0.25 : 0);
      const awakeZ = Math.sin(t * swaySpeed - i * 0.42) * swayAmp * (0.4 + u);
      const dreamX = i === 0 ? -1.5 : 0;
      const dreamZ = i === 0 ? 0.6 : 0.32 + Math.sin(t * 0.8 - i * 0.3) * 0.03;
      tailJoints[i].rotation.x = lerp(awakeX, dreamX, f.dream);
      tailJoints[i].rotation.z = lerp(awakeZ, dreamZ, f.dream);
    }

    // stage 2 bell & tassel sway
    if (collarWrap.visible) {
      bellPivot.rotation.x = Math.sin(t * 7) * 0.14 * ex + Math.sin(t * 9) * 0.4 * f.airborne;
      bellPivot.rotation.z = Math.sin(t * 5.3) * 0.12 * ex + f.headYaw * 0.15;
      for (let i = 0; i < tassels.length; i++) {
        tassels[i].rotation.z = Math.sin(t * 3.1 + i * 1.7) * (0.08 + 0.15 * ex) + f.headYaw * 0.1;
        tassels[i].rotation.x = Math.sin(t * 2.4 + i) * 0.06 + 0.3 * f.airborne;
      }
    }

    // stage 3 origami stars & fireflies
    if (charmsWrap.visible) {
      const singLift = f.trick === "sing" ? f.env : 0;
      for (let i = 0; i < stars.length; i++) {
        const a = t * 0.42 + (i / stars.length) * TAU;
        const r = 0.36 + 0.03 * Math.sin(t * 0.9 + i);
        stars[i].position.set(Math.cos(a) * r, 0.74 + 0.05 * Math.sin(t * 1.1 + i * 1.9) + singLift * 0.12, Math.sin(a) * r);
        stars[i].rotation.set(Math.sin(t + i) * 0.4, t * 1.2 + i, Math.sin(t * 0.7 + i) * 0.3);
      }
      for (let i = 0; i < fireflies.length; i++) {
        const ff = fireflies[i];
        const a = t * (0.3 + 0.07 * i) + i * 2.1;
        ff.g.position.set(
          Math.sin(a) * (0.42 + 0.06 * Math.sin(t * 0.6 + i)),
          0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.5 + i * 1.3)) + singLift * 0.2,
          Math.cos(a * 1.3) * 0.38,
        );
        const blinkFF = Math.pow(0.5 + 0.5 * Math.sin(t * (1.6 + i * 0.37) + i * 2.3), 3);
        ff.g.scale.setScalar(0.4 + 0.9 * blinkFF + 0.3 * f.pulse);
        ff.halo.opacity = (0.12 + 0.3 * blinkFF) * (1 + f.glow * 0.6);
      }
    }

    // stage 4 astrolabe & aurora plume
    uTailAurora.value = auroraWrap.visible ? (0.35 + 0.25 * Math.sin(t * 1.9) + 0.5 * f.glow) * clamp((core.stage - 3) * 1, 0, 1) : 0;
    if (astroWrap.visible) {
      ringOuter.rotation.y = t * 0.35;
      gimbal.rotation.set(1.1 + Math.sin(t * 0.5) * 0.15, t * -0.6, 0);
      gimbal2.rotation.x = t * 0.9;
      astroWrap.position.y = 0.43 + Math.sin(t * 1.4) * 0.014;
      crescent.rotation.y = Math.sin(t * 0.8) * 0.5;
      for (let i = 0; i < astroStars.length; i++) {
        astroStars[i].rotation.y = -t * 2;
        astroStars[i].scale.setScalar(0.8 + 0.3 * Math.sin(t * 4 + i * 1.3) + 0.2 * f.glow);
      }
    }
    if (auroraWrap.visible) {
      for (let i = 0; i < auroraMats.length; i++) {
        auroraMats[i].color.setHSL((t * 0.06 + i * 0.12) % 1, 0.8, 0.72);
        auroraMats[i].opacity = (0.26 - i * 0.04) * (0.7 + 0.3 * Math.sin(t * 2.2 + i) + 0.4 * f.glow);
        auroraMeshes[i].rotation.y = t * (0.6 + i * 0.2);
        auroraMeshes[i].position.x = Math.sin(t * 1.3 + i) * 0.012 * i;
      }
    }

    core.settle();
    burst.update(f.sparkle, t);
  }

  schedulePrewarm();
  return { root, headAnchor, hitMeshes, update, setEvolution, dispose: () => disposeHierarchy(root) };
}

// ============================================================================
// 2. KITSUNE — Spirit Fox Pup
// ============================================================================

const K_ALABASTER = lin(0xfff6ee);
const K_SNOW = lin(0xffffff);
const K_CREAM = lin(0xffeedc);
const K_PEACH = lin(0xffdcc8);
const K_VERMILION = lin(0xee4a2e);
const K_SAKURA = lin(0xffbfae);
const K_DARK = lin(0x3a2430);
const K_INNER = lin(0xff8f8a);
const K_BLUSH = lin(0xffa0b8);
const K_EYE_R = 0.06;

function kitsuneBodySdf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = el(x, y, z, 0, 0.24, -0.05, 0.19, 0.21, 0.23); // seated mass
  d = smin(d, sdRoundCone(x, y, z, 0, 0.2, -0.08, 0, 0.43, 0.03, 0.17, 0.125), 0.1); // arched upright torso
  d = smin(d, el(x, y, z, 0, 0.35, 0.1, 0.125, 0.14, 0.1), 0.08); // proud chest
  // flared chest ruff tufts
  d = smin(d, sdRoundCone(x, y, z, 0, 0.37, 0.13, 0, 0.21, 0.215, 0.06, 0.012), 0.05);
  d = smin(d, sdRoundCone(ax, y, z, 0.055, 0.38, 0.12, 0.085, 0.235, 0.2, 0.052, 0.011), 0.045);
  d = smin(d, sdRoundCone(ax, y, z, 0.11, 0.42, 0.06, 0.19, 0.33, 0.09, 0.05, 0.01), 0.045);
  d = smin(d, el(ax, y, z, 0.13, 0.13, -0.08, 0.1, 0.125, 0.16), 0.07); // haunches
  d = smin(d, el(ax, y, z, 0.15, 0.03, 0.05, 0.048, 0.04, 0.085), 0.04); // hind paws
  d = smin(d, sdRoundCone(x, y, z, 0, 0.4, 0.02, 0, 0.53, 0.06, 0.115, 0.095), 0.07); // neck
  d = lumps(d, () => sdfNoise3(x * 11 + 2, y * 11 + 5, z * 11 + 1), 0.02);
  return smax(d, -y, 0.01);
}

function kitsuneHeadBase(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = el(x, y, z, 0, 0.01, -0.02, 0.205, 0.175, 0.185); // sleek skull
  d = smin(d, el(x, y, z, 0, 0.06, 0.03, 0.155, 0.115, 0.155), 0.07); // brow dome
  d = smin(d, sdRoundCone(x, y, z, 0, -0.03, 0.08, 0, -0.068, 0.25, 0.085, 0.026), 0.06); // tapered snout
  d = smin(d, el(ax, y, z, 0.035, -0.074, 0.17, 0.048, 0.036, 0.06), 0.035); // muzzle pads
  d = smin(d, el(x, y, z, 0, -0.098, 0.12, 0.06, 0.032, 0.07), 0.04); // jaw
  d = smin(d, sdRoundCone(ax, y, z, 0.14, -0.05, 0.03, 0.275, -0.12, -0.01, 0.07, 0.012), 0.05); // cheek fluff
  d = smin(d, sdRoundCone(ax, y, z, 0.15, -0.1, 0.04, 0.24, -0.18, 0.0, 0.05, 0.01), 0.04);
  d = smin(d, el(ax, y, z, 0.115, 0.13, -0.03, 0.07, 0.05, 0.05), 0.05); // ear roots
  d = smin(d, el(ax, y, z, 0.088, 0.078, 0.13, 0.06, 0.018, 0.035), 0.025); // brow
  const back = ss(0.05, -0.1, z);
  d = lumps(d, () => sdfNoise3(x * 12 + 1, y * 12 + 3, z * 12 + 5), 0.016 * (0.25 + 0.75 * back));
  return d;
}

let kitsuneHeadDesign: HeadDesign | null = null;
function getKitsuneHead(): HeadDesign {
  if (kitsuneHeadDesign) return kitsuneHeadDesign;
  const ex = 0.095;
  const ey = 0.03;
  const zs = surfZ(kitsuneHeadBase, ex, ey);
  const eye = { x: ex, y: ey, z: zs - K_EYE_R * 0.72 * 0.5, yaw: 0.22, roll: 0.22, sx: 1.15, sy: 0.95 };
  const sdf: Sdf = (x, y, z) =>
    smax(
      kitsuneHeadBase(x, y, z),
      -sdSocket(Math.abs(x), y, z, eye.x, eye.y, eye.z, eye.yaw, eye.roll, K_EYE_R * 1.07 * eye.sx, K_EYE_R * 1.07 * eye.sy, K_EYE_R * 0.8),
      0.012,
    );
  kitsuneHeadDesign = { sdf, eye };
  return kitsuneHeadDesign;
}

/** Comma-shaped magatama bead (head with a cord hole, curling tapered tail). */
function magatamaGeo(): THREE.BufferGeometry {
  return cached("kitsune.magatama", () =>
    buildSdfGeometry({
      sdf(x, y, z) {
        const zz = z / 0.65;
        let d = sph(x, y, zz, 0, 0.01, 0, 0.014);
        d = smin(d, sdRoundCone(x, y, zz, 0.002, 0.008, 0, -0.011, -0.011, 0, 0.012, 0.008), 0.008);
        d = smin(d, sdRoundCone(x, y, zz, -0.011, -0.011, 0, 0.004, -0.024, 0, 0.008, 0.0035), 0.006);
        d *= 0.65;
        return smax(d, -sdCapsule(x, y, z, 0.001, 0.012, -0.03, 0.001, 0.012, 0.03, 0.0035), 0.002);
      },
      min: [-0.03, -0.035, -0.016],
      max: [0.022, 0.03, 0.016],
      cell: 0.0024,
      paint(x, y) {
        const c = mixc(lin(0x0c7a4a), lin(0x6ff0b0), ss(-0.02, 0.02, y + x * 0.4));
        return [c[0], c[1], c[2], 0.8];
      },
    }),
  );
}

function kitsuneGeometries() {
  const head = getKitsuneHead();
  const bodyGeo = cached("kitsune.body", () =>
    buildSdfGeometry({
      sdf: kitsuneBodySdf,
      min: [-0.3, -0.03, -0.34],
      max: [0.3, 0.66, 0.29],
      cell: 0.024,
      paint(x, y, z) {
        let c = K_ALABASTER;
        const ruff = ss(0.08, 0.16, z) * ss(0.5, 0.42, y);
        c = mixc(c, K_CREAM, ruff);
        // vermilion saddle across the back & haunch flames
        const saddle = Math.max(
          blob(x * 1.2, y, z, 0, 0.42, -0.14, 0.12, 0.04, 0.06, 7, 2),
          blob(x, y * 1.4, z, 0, 0.36, -0.24, 0.14, 0.04, 0.05, 7, 4),
        );
        c = mixc(c, mixc(K_VERMILION, K_SAKURA, ss(0.5, 0.3, y) * 0.3), saddle * 0.85);
        c = mixc(c, K_PEACH, blob(Math.abs(x), y, z, 0.16, 0.2, -0.12, 0.08, 0.04, 0.05, 8, 7) * 0.6);
        // dark-dipped hind paws
        c = mixc(c, K_DARK, ss(0.075, 0.035, y) * ss(-0.04, 0.02, z));
        return [c[0], c[1], c[2], 0];
      },
    }),
  );
  const headGeo = cached("kitsune.head", () => {
    const g = buildSdfGeometry({
      sdf: head.sdf,
      min: [-0.32, -0.25, -0.26],
      max: [0.32, 0.26, 0.31],
      cell: 0.022,
      paint(x, y, z, _nx, _ny, nz) {
        const ax = Math.abs(x);
        let c = K_ALABASTER;
        c = mixc(c, K_PEACH, ss(0.1, 0.2, y) * ss(0.08, -0.1, z) * 0.6);
        // snowy muzzle, jaw & cheek fluff
        const lower = ss(-0.02, -0.07, y + (sdfNoise3(x * 10, y * 10, z * 10) - 0.5) * 0.03) * ss(-0.02, 0.06, z);
        c = mixc(c, K_SNOW, Math.max(lower, ss(0.14, 0.2, ax) * ss(-0.03, -0.09, y)));
        // vermilion kabuki eye-corner sweeps + forehead sacred crest
        const front = ss(0.05, 0.35, nz);
        const kabuki = ss(0.024, 0.01, seg2(ax, y, 0.135, 0.045, 0.19, 0.11)) * front;
        const crest = Math.max(
          ss(0.026, 0.014, Math.hypot(x * 1.5, y - 0.1)),
          ss(0.016, 0.006, ax - 0.012 * (1 - (y - 0.1) / 0.075)) * ss(0.09, 0.105, y) * ss(0.18, 0.165, y),
          ss(0.016, 0.008, Math.hypot(ax - 0.045, y - 0.088)),
        ) * front;
        c = mixc(c, K_VERMILION, Math.max(kabuki, crest));
        c = mixc(c, K_BLUSH, blob(ax, y, z, 0.13, -0.04, 0.13, 0.04, 0.035, 0, 1, 0) * 0.4);
        return [c[0], c[1], c[2], 0];
      },
    });
    addMaskAttr(g, "aGlow", (x, y, z) => {
      const ax = Math.abs(x);
      if (z < 0.05) return 0;
      const kabuki = ss(0.026, 0.01, seg2(ax, y, 0.135, 0.045, 0.19, 0.11));
      const crest = Math.max(ss(0.03, 0.012, Math.hypot(x * 1.5, y - 0.1)), ss(0.02, 0.006, Math.hypot(ax - 0.045, y - 0.088)));
      return Math.max(kabuki * 0.6, crest);
    });
    return g;
  });
  const legGeo = cached("kitsune.leg", () =>
    buildSdfGeometry({
      sdf(x, y, z) {
        let d = sdRoundCone(x, y, z, 0, 0.03, 0, 0, -0.2, 0.008, 0.04, 0.029);
        d = smin(d, el(x, y, z, 0, -0.26, 0.022, 0.042, 0.032, 0.058), 0.03);
        for (let k = -1; k <= 1; k++) d = smin(d, sph(x, y, z, k * 0.02, -0.27, 0.062 - Math.abs(k) * 0.006, 0.016), 0.008);
        d = lumps(d, () => sdfNoise3(x * 16, y * 16, z * 16), 0.008);
        return smax(d, -(y + 0.29), 0.008);
      },
      min: [-0.08, -0.31, -0.07],
      max: [0.08, 0.1, 0.11],
      cell: 0.012,
      paint(_x, y) {
        const c = mixc(K_ALABASTER, K_DARK, ss(-0.15, -0.2, y));
        return [c[0], c[1], c[2], 0];
      },
    }),
  );
  const earGeo = cached("kitsune.ear", () =>
    buildSdfGeometry({
      sdf(x, y, z) {
        const zb = z - 0.18 * y * y;
        let d = sdRoundCone(x, y, zb / 0.42, 0, -0.05, 0, 0, 0.265, 0, 0.088, 0.01) * 0.42;
        const inner = sdRoundCone(x, y, (zb - 0.02) / 0.32, 0, 0.0, 0, 0, 0.22, 0, 0.064, 0.006) * 0.32;
        d = smax(d, -inner, 0.008);
        for (const k of [-1, 0, 1]) {
          d = smin(d, sdRoundCone(x, y, z, k * 0.022, -0.005, 0.016, k * 0.03, 0.085 - Math.abs(k) * 0.01, 0.032, 0.013, 0.003), 0.007);
        }
        return d;
      },
      min: [-0.1, -0.08, -0.06],
      max: [0.1, 0.29, 0.08],
      cell: 0.0105,
      paint(x, y, z, _nx, _ny, nz) {
        const zb = z - 0.18 * y * y;
        const inner = ss(0.006, 0.02, zb) * ss(-0.1, 0.35, nz) * ss(0.23, 0.17, y);
        let c = mixc(K_ALABASTER, K_VERMILION, ss(0.17, 0.215, y));
        c = mixc(c, K_INNER, inner);
        const tuft = ss(0.04, 0.025, y) + ss(0.11, 0.05, y) * ss(0.012, 0.004, Math.abs(Math.abs(x) - 0.026));
        c = mixc(c, K_SNOW, clamp(tuft, 0, 1) * inner);
        return [c[0], c[1], c[2], 0.95];
      },
    }),
  );
  const tailGeo = cached("kitsune.tail", () => {
    const g = buildSdfGeometry({
      sdf(x, y, z) {
        let d = sdRoundCone(x, y, z, 0, -0.04, 0, 0, 0.26, 0, 0.045, 0.105);
        d = smin(d, sdRoundCone(x, y, z, 0, 0.26, 0, 0, 0.52, 0, 0.105, 0.032), 0.05);
        d = smin(d, sdRoundCone(x, y, z, 0, 0.52, 0, 0, 0.6, 0.01, 0.032, 0.006), 0.03);
        return lumps(d, () => sdfNoise3(x * 15 + 4, y * 10, z * 15), 0.028 * ss(0.04, 0.2, y));
      },
      min: [-0.14, -0.08, -0.14],
      max: [0.14, 0.64, 0.14],
      cell: 0.018,
      paint(x, y, z) {
        const yy = y + (sdfNoise3(x * 9, y * 9, z * 9) - 0.5) * 0.06;
        let c = mixc(K_ALABASTER, K_SAKURA, ss(0.3, 0.44, yy));
        c = mixc(c, K_VERMILION, ss(0.45, 0.55, yy));
        return [c[0], c[1], c[2], ss(0.4, 0.58, y) * 0.8];
      },
    });
    addMaskAttr(g, "aTip", (_x, y) => ss(0.42, 0.6, y));
    addSkin(g, "y", 0.072, 8);
    return g;
  });
  magatamaGeo();
  return { head, bodyGeo, headGeo, legGeo, earGeo, tailGeo };
}

function buildKitsuneRig(): PetModelRig {
  const core = new PetCore({ centerY: 0.42, headY: 0.68, frontZ: 0.17, stageScale: [0.84, 0.93, 1.0, 1.07] });
  const { root, body } = core;
  const hitMeshes: THREE.Object3D[] = [];
  const reveals: Reveal[] = [];
  const G = kitsuneGeometries();
  const pulseUniform = uniform(0.2);
  const uMarkGlow = uniform(0.1);
  const uTailGlow = uniform(0.1);

  const furMat = makePlushSssMaterial({ sssColor: 0xffa88a, sssStrength: 0.85, roughness: 0.82, sheen: 0.82, grainScale: 46, pulseUniform });
  const headMat = makePlushSssMaterial({ sssColor: 0xffa88a, sssStrength: 0.85, roughness: 0.82, sheen: 0.82, grainScale: 50, pulseUniform });
  addEmissiveMask(headMat, "aGlow", 0xff5a32, uMarkGlow);
  const earMat = makePlushSssMaterial({ sssColor: 0xff6a5a, sssStrength: 1.3, roughness: 0.78, sheen: 0.7, grainScale: 60, pulseUniform });
  const tailMat = makePlushSssMaterial({ sssColor: 0xffb08a, sssStrength: 0.95, roughness: 0.84, sheen: 0.85, grainScale: 40, pulseUniform });
  addEmissiveMask(tailMat, "aTip", 0xff7a4a, uTailGlow);
  const lidMat = makePlushSssMaterial({ baseColor: 0xfff6ee, useSdfAttrs: false, sssColor: 0xffa88a, sssStrength: 0.5 });
  const noseMat = glossy(0x2a1a22, 0.22);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x3a1a20, roughness: 0.5 });
  const mouthMat = glossy(0x6a2030, 0.45);
  const markMat = makeHdrGlowMaterial(0xff4a2e, 0.35, pulseUniform);
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xffa0b8, emissive: 0xff7ab8, emissiveIntensity: 0.2, roughness: 0.8, transparent: true, opacity: 0.5, depthWrite: false,
  });

  // ---- sculpted shrine-fox torso with proud chest ruff
  const torsoG = new THREE.Group();
  body.add(torsoG);
  const torso = sculpted(torsoG, G.bodyGeo, furMat, { layers: 5, length: 0.022, density: 56, sssColor: 0xffc0a0 });
  hitMeshes.push(torso);
  for (const side of [-1, 1]) {
    core.contact(body, side * 0.15, 0, 0.05);
    core.contact(body, side * 0.15, 0, 0.12);
  }

  const frontLegs: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.075, 0.29, 0.14);
    const leg = sculpted(pivot, G.legGeo, furMat, { layers: 3, length: 0.012, density: 66, sssColor: 0xffc0a0 });
    hitMeshes.push(leg);
    core.contact(pivot, 0, -0.29, 0.022);
    core.contact(pivot, 0, -0.288, 0.07);
    body.add(pivot);
    frontLegs.push({ pivot, side });
  }

  // ---- 1 → 2 → 3 → 5 sculpted plume tails (each one skinned sculpt with fur fuzz)
  const tailBase = at(new THREE.Group(), 0, 0.14, -0.22);
  body.add(tailBase);
  const TAIL_N = 8;
  const tails: { fan: THREE.Group; joints: THREE.Bone[]; fanCur: number; k: number; tip: THREE.Group }[] = [];
  const TAIL_STAGE = [1, 2, 3, 4, 4];
  for (let k = 0; k < 5; k++) {
    const wrap = at(new THREE.Group(), 0, 0, -0.012 * k);
    tailBase.add(wrap);
    reveals.push(new Reveal(wrap, TAIL_STAGE[k]));
    const fan = new THREE.Group();
    wrap.add(fan);
    const chain = makeSkinChain(G.tailGeo, tailMat, TAIL_N, new THREE.Vector3(0, 0.072, 0), {
      layers: 3, length: 0.024, density: 48, sssColor: 0xffb8a0, groom: [0, 0.35, -0.2],
    });
    fan.add(chain.mesh);
    hitMeshes.push(chain.mesh);
    tails.push({ fan, joints: chain.joints, fanCur: 0, k, tip: chain.tip });
  }
  const FAN: Record<number, number[]> = {
    1: [0, 0, 0, 0, 0],
    2: [-0.3, 0.3, 0, 0, 0],
    3: [-0.55, 0.55, 0, 0, 0],
    4: [-0.52, 0.52, 0, -1.0, 1.0],
  };

  // ---- head
  const neck = at(new THREE.Group(), 0, 0.49, 0.04);
  neck.rotation.order = "YXZ";
  body.add(neck);
  const headG = new THREE.Group();
  neck.add(headG);
  const face = at(new THREE.Group(), 0, 0.15, 0.03);
  headG.add(face);
  const E = G.head.eye;
  const foxFaceMask = (x: number, y: number, z: number) =>
    Math.max(
      blob(Math.abs(x), y, z, E.x, E.y, E.z + 0.02, 0.075, 0.03, 0),
      blob(Math.abs(x) * 1.1, y, z * 0.8, 0, -0.06, 0.2, 0.06, 0.03, 0),
      blob(x, y, z, 0, 0.11, 0.17, 0.04, 0.02, 0),
    );
  const skull = sculpted(
    face,
    G.headGeo,
    headMat,
    { layers: 5, length: 0.018, density: 62, sssColor: 0xffc0a0, groom: [0, -0.25, -0.5] },
    furProxy("kitsune.headFur", G.headGeo, foxFaceMask, 0.026),
  );
  hitMeshes.push(skull);
  const hs = G.head.sdf;

  const nY = -0.052;
  const nZ = surfZ(hs, 0, nY);
  const nose = solid(at(ell(0.02, 1.35, 0.85, 0.9, noseMat, 16), 0, nY, nZ + 0.004));
  face.add(nose);
  face.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })), 0.007, nY + 0.007, nZ + 0.018));
  const smileY = -0.094;
  const smileG = stick(new THREE.Group(), hs, 0, smileY, surfZ(hs, 0, smileY), 0.002);
  face.add(smileG);
  for (const side of [-1, 1]) {
    const s = at(arcMesh(0.015, 0.0032, PI, lineMat), side * 0.015, 0, 0);
    s.rotation.z = PI;
    smileG.add(s);
  }
  const mouthOpen = stick(ell(0.02, 1.2, 1, 0.55, mouthMat, 14), hs, 0, -0.108, surfZ(hs, 0, -0.108), -0.005);
  face.add(mouthOpen);

  const eyes: EyeRig[] = [];
  for (const side of [-1, 1]) {
    const eye = makeJewelEye(K_EYE_R, 0xd98218, 0xffe07d, 0.38, lidMat, lineMat);
    eye.group.position.set(side * E.x, E.y, E.z);
    eye.group.rotation.set(0, side * E.yaw, side * E.roll);
    eye.group.scale.set(E.sx, E.sy, 1);
    face.add(eye.group);
    eyes.push(eye);
    // crisp kabuki flick decal over the painted sweep
    const fx = side * 0.165;
    const flick = stick(new THREE.Group(), hs, fx, 0.08, surfZ(hs, fx, 0.08), 0.002);
    const flickMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.0055, 0.038, 4, 8), markMat);
    flickMesh.rotation.z = -side * 0.85;
    flickMesh.scale.z = 0.4;
    flick.add(flickMesh);
    face.add(flick);
    const bx = side * 0.135;
    face.add(stick(ell(0.034, 1.3, 0.75, 0.25, blushMat, 14), hs, bx, -0.04, surfZ(hs, bx, -0.04), 0.004));
  }
  // forehead sacred crest decal
  const crestG = stick(new THREE.Group(), hs, 0, 0.115, surfZ(hs, 0, 0.115), 0.002);
  face.add(crestG);
  crestG.add(at(ell(0.016, 0.8, 1.5, 0.3, markMat, 14), 0, -0.01, 0));
  crestG.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.03, 10), markMat), 0, 0.022, 0));

  // tall sculpted ears with carved hollows (light glows ruby-peach through them)
  const ears: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.115, 0.14, -0.02);
    const ear = sculpted(pivot, G.earGeo, earMat);
    hitMeshes.push(ear);
    face.add(pivot);
    ears.push({ pivot, side });
  }

  // ---- collars fitted to the sculpted ruff
  const neckRing = fitRing(kitsuneBodySdf, 0, 0.45, 0.04, 0.36, 0.012);
  const crimsonSilk = makeSilkFabricMaterial(0xc8243a, 0xff9aa8);
  // Stage 1: tiny red shrine cord
  const cordWrap = new THREE.Group();
  body.add(cordWrap);
  reveals.push(new Reveal(cordWrap, 1, 1));
  cordWrap.add(solid(closedTube(neckRing.pts, 0.0048, crimsonSilk, 6)));
  const cf = neckRing.pts[0];
  const cordKnot = solid(at(ell(0.012, 1.2, 0.9, 0.8, crimsonSilk, 12), cf.x, cf.y, cf.z + 0.004));
  cordWrap.add(cordKnot);
  for (const side of [-1, 1]) {
    cordWrap.add(solid(tube([[cf.x, cf.y, cf.z + 0.006], [cf.x + side * 0.012, cf.y - 0.025, cf.z + 0.012], [cf.x + side * 0.016, cf.y - 0.05, cf.z + 0.012]], 0.0032, crimsonSilk, 8, 5)));
  }

  // Stage 2: braided shimenawa rope + folded shide talismans + glowing jade magatama
  const ropeWrap = new THREE.Group();
  body.add(ropeWrap);
  reveals.push(new Reveal(ropeWrap, 2));
  const ropeRing = fitRing(kitsuneBodySdf, 0, 0.45, 0.04, 0.36, 0.02);
  const straw = new THREE.MeshPhysicalMaterial({ color: 0xd8c08a, roughness: 0.88, sheen: 0.6, sheenColor: new THREE.Color(0xfff0c0), sheenRoughness: 0.5 });
  const straw2 = new THREE.MeshPhysicalMaterial({ color: 0xc4a66a, roughness: 0.9, sheen: 0.5, sheenColor: new THREE.Color(0xffe0a0) });
  ropeWrap.add(braid(ropeRing, 3, 0.009, 18, 0.0085, [straw, straw2, straw]));
  const paper = makePlushSssMaterial({ baseColor: 0xfffbf2, useSdfAttrs: false, sssColor: 0xfff0d0, sssStrength: 1.0, roughness: 0.7, sheen: 0.3 });
  paper.side = THREE.DoubleSide;
  const shideGeo = new THREE.BoxGeometry(0.02, 0.022, 0.0016);
  const shides: THREE.Group[] = [];
  for (const idx of [5, -5, 12, -12]) {
    const i = (idx + ropeRing.pts.length) % ropeRing.pts.length;
    const p = ropeRing.pts[i].clone().addScaledVector(ropeRing.radial[i], 0.008);
    const sh = at(new THREE.Group(), p.x, p.y - 0.006, p.z);
    sh.quaternion.setFromUnitVectors(Z_AXIS, ropeRing.radial[i]);
    for (let j = 0; j < 4; j++) {
      const panel = solid(new THREE.Mesh(shideGeo, paper));
      panel.position.set((j % 2 === 0 ? -1 : 1) * 0.006, -0.012 - j * 0.02, 0.002 * (j % 2));
      panel.rotation.y = (j % 2 === 0 ? 1 : -1) * 0.35;
      sh.add(panel);
    }
    ropeWrap.add(sh);
    shides.push(sh);
  }
  const jade = makeBioSssMaterial({ sssColor: 0x3cffa0, iridColor: 0xbfffe0, sssStrength: 1.3, clearcoat: 1, roughness: 0.12, pulseUniform });
  const rf = ropeRing.pts[0].clone().addScaledVector(ropeRing.radial[0], 0.01);
  const pendant = at(new THREE.Group(), rf.x, rf.y - 0.008, rf.z);
  pendant.quaternion.setFromUnitVectors(Z_AXIS, ropeRing.radial[0]);
  ropeWrap.add(pendant);
  pendant.add(tube([[0, 0, 0], [0, -0.012, 0.003], [0.001, -0.022, 0.002]], 0.0018, crimsonSilk, 6, 4));
  const magatama = solid(at(new THREE.Mesh(magatamaGeo(), jade), 0, -0.04, 0.004));
  magatama.scale.setScalar(1.25);
  pendant.add(magatama);
  pendant.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), makeHdrGlowMaterial(0x6effb8, 1.2, pulseUniform)), 0, -0.028, 0.012));

  // Stage 3: orbiting kitsune-bi teardrop lantern wisps with glowing cores
  const wispWrap = new THREE.Group();
  body.add(wispWrap);
  reveals.push(new Reveal(wispWrap, 3));
  const flameGeo = makeTeardropGeo(0.03);
  const wisps: { g: THREE.Group; outer: THREE.Mesh; outerMat: THREE.MeshBasicMaterial; inner: THREE.Mesh }[] = [];
  for (let i = 0; i < 4; i++) {
    const cyan = i % 2 === 0;
    const g = new THREE.Group();
    const outerMat = additive(cyan ? 0x5ff0ff : 0xffc24a, 0.42);
    const outer = new THREE.Mesh(flameGeo, outerMat);
    const shell = new THREE.Mesh(flameGeo, additive(cyan ? 0x9ffcff : 0xffe7a0, 0.25));
    shell.scale.setScalar(1.5);
    const inner = at(new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 10), makeHdrGlowMaterial(cyan ? 0xc8ffff : 0xfff0c8, 2.6, pulseUniform)), 0, -0.012, 0);
    g.add(outer, shell, inner);
    wispWrap.add(g);
    wisps.push({ g, outer, outerMat, inner });
  }

  // Stage 4: ornate antique-gold shrine halo with carved magatama beads + sakura petals
  const haloWrap = at(new THREE.Group(), 0, 0.07, -0.19);
  face.add(haloWrap);
  reveals.push(new Reveal(haloWrap, 4));
  const haloSpin = new THREE.Group();
  haloWrap.add(haloSpin);
  const antique = makeArtisanMetalMaterial(0xd8b064, 0.3);
  haloSpin.add(solid(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.011, 10, 120), antique)));
  haloSpin.add(solid(new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.005, 8, 96), antique)));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0035, i % 2 === 0 ? 0.06 : 0.035, 6), antique);
    const rr = i % 2 === 0 ? 0.24 : 0.228;
    ray.position.set(Math.cos(a) * rr, Math.sin(a) * rr, 0);
    ray.rotation.z = a - PI / 2;
    haloSpin.add(ray);
  }
  const haloGlowMat = additive(0xffb86a, 0.22);
  haloSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 10, 72), haloGlowMat));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const bead = solid(new THREE.Mesh(magatamaGeo(), i % 2 === 0 ? antique : jade));
    bead.position.set(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.012);
    bead.rotation.z = a;
    bead.scale.setScalar(1.3);
    haloSpin.add(bead);
  }
  const haloStarMat = makeHdrGlowMaterial(0xfff2d0, 1.8, pulseUniform);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + PI / 4;
    const s = makeStar(0.022, haloStarMat);
    s.position.set(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.02);
    haloSpin.add(s);
  }
  const petalWrap = new THREE.Group();
  body.add(petalWrap);
  reveals.push(new Reveal(petalWrap, 4));
  const petalMat = makePlushSssMaterial({ baseColor: 0xffc6d6, useSdfAttrs: false, sssColor: 0xff8fb8, sssStrength: 1.2, roughness: 0.6, sheen: 0.6 });
  petalMat.side = THREE.DoubleSide;
  const petalGeo = makePetalGeo(0.014, 0.024, 0.0018, 0.6, 0.05);
  const petals: { m: THREE.Mesh; seed: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(petalGeo, petalMat);
    m.castShadow = true;
    petalWrap.add(m);
    petals.push({ m, seed: i * 1.37 + 0.4 });
  }

  const burst = makeBurst([0x7ff8ff, 0xffd27a, 0xff9ac0]);
  burst.group.position.y = 0.55;
  core.motion.add(burst.group);

  const headAnchor = at(new THREE.Object3D(), 0, 0.6, 0);
  headG.add(headAnchor);

  let earFlickClock = 2.5;
  let earFlickT = -1;

  function setEvolution(stage: EvolutionStage): void {
    core.stage = stage;
    if (core.frames === 0) {
      for (const r of reveals) r.tick(stage, 0, true);
      for (const tl of tails) tl.fanCur = FAN[stage][tl.k];
    }
  }

  function update(pose: PetPoseInput): void {
    if (pose.evolution !== core.stage) setEvolution(pose.evolution);
    const f = core.frame(pose);
    const { t, dt } = f;
    for (const r of reveals) r.tick(core.stage, dt);
    pulseUniform.value = pose.attentionPulse;

    neck.rotation.set(f.headPitch, f.headYaw, f.headRoll);
    for (const e of eyes) e.update(f.eyeX, f.eyeY, f.lid, f.happyEyes);

    earFlickClock -= dt;
    if (earFlickClock <= 0) {
      earFlickClock = 2 + Math.random() * 4;
      earFlickT = 0;
    }
    let flick = 0;
    if (earFlickT >= 0) {
      earFlickT += dt / 0.3;
      if (earFlickT >= 1) earFlickT = -1;
      else flick = Math.sin(earFlickT * TAU) * 0.16;
    }
    for (const e of ears) {
      e.pivot.rotation.z = -e.side * (0.18 + 0.7 * f.droop - 0.08 * f.perk + 0.25 * f.flare) + (e.side > 0 ? flick : 0);
      e.pivot.rotation.x = -0.05 + 0.18 * f.perk - 0.55 * f.droop + Math.sin(t * 1.1 + e.side) * 0.025;
    }

    mouthOpen.visible = f.mouth > 0.04;
    mouthOpen.scale.set(1.2, Math.max(0.05, f.mouth), 0.55);
    smileG.scale.setScalar(1 - f.mouth * 0.15);
    blushMat.emissiveIntensity = 0.12 + f.blush * 0.6;
    blushMat.opacity = 0.25 + 0.45 * clamp(f.blush, 0, 1);
    uMarkGlow.value = (core.stage >= 2 ? 0.45 : 0.12) + f.pulse * 0.9 + f.glow * 0.5;

    const bowEnv = f.trick === "bow" ? f.env : 0;
    for (const l of frontLegs) {
      const paddle = Math.sin(t * 18 + (l.side > 0 ? PI : 0)) * 0.65 * f.paddle;
      l.pivot.rotation.x = paddle - 0.6 * bowEnv - 0.3 * f.airborne;
    }

    // tails: fan out per stage, sway with independent phases, flare during tricks
    const fan = FAN[core.stage];
    const lift = clamp(f.perk * 0.2 + f.excite * 0.25 + f.flare * 0.3 - f.droop * 0.3, -0.35, 0.5);
    const swayAmp = 0.06 + 0.08 * f.wag + 0.06 * f.excite;
    const swaySpeed = 1.2 + 1.8 * f.wag;
    for (const tl of tails) {
      tl.fanCur = damp(tl.fanCur, fan[tl.k], 3, dt);
      tl.fan.rotation.z = (tl.fanCur * (1 + f.flare * 0.4) + Math.sin(t * 1.1 + tl.k * 1.7) * 0.05) * (1 - 0.85 * f.dream);
      const dreamSide = tl.k % 2 === 0 ? 1 : -1;
      for (let i = 0; i < tl.joints.length; i++) {
        const u = i / (tl.joints.length - 1);
        const awakeX = i === 0 ? -1.15 + lift : 0.19 + 0.03 * i - f.flare * 0.06;
        const awakeZ = Math.sin(t * swaySpeed - i * 0.5 + tl.k * 1.3) * swayAmp * (0.3 + u);
        const dreamX = i === 0 ? -1.45 + tl.k * 0.06 : 0.02;
        const dreamZ = i === 0 ? dreamSide * 0.5 : dreamSide * (0.3 + Math.sin(t * 0.7 - i * 0.4) * 0.03);
        tl.joints[i].rotation.x = lerp(awakeX, dreamX, f.dream);
        tl.joints[i].rotation.z = lerp(awakeZ, dreamZ, f.dream);
      }
    }
    const tailGlow = core.stage >= 3 ? 0.4 + 0.45 * f.glow + (core.stage >= 4 ? 0.45 : 0) : 0.06 + 0.2 * f.glow;
    uTailGlow.value = tailGlow * (0.85 + 0.15 * Math.sin(t * 3)) + f.pulse * 0.3;

    if (ropeWrap.visible) {
      for (let i = 0; i < shides.length; i++) {
        shides[i].rotation.z = Math.sin(t * 2.6 + i * 1.3) * (0.06 + 0.12 * f.excite) + f.headYaw * 0.1;
      }
      pendant.rotation.z = Math.sin(t * 3.1) * 0.12 * f.excite;
      pendant.rotation.x = 0.35 * f.airborne;
    }
    if (wispWrap.visible) {
      const singBoost = f.trick === "sing" ? f.env : 0;
      for (let i = 0; i < wisps.length; i++) {
        const w = wisps[i];
        const a = t * (0.7 + singBoost * 0.8) + (i / wisps.length) * TAU;
        const r = 0.46 + 0.05 * Math.sin(t * 1.3 + i);
        w.g.position.set(Math.cos(a) * r, 0.52 + 0.12 * Math.sin(t * 1.1 + i * 1.9), Math.sin(a) * r);
        w.g.rotation.z = Math.cos(a) * 0.25;
        w.g.rotation.x = -Math.sin(a) * 0.25;
        const flickr = 0.85 + 0.3 * Math.sin(t * 9 + i * 1.7) + 0.1 * Math.sin(t * 23 + i);
        w.outer.scale.set(1, flickr, 1);
        w.outerMat.opacity = 0.3 + 0.25 * f.glow + 0.08 * Math.sin(t * 6 + i * 2);
        w.inner.scale.setScalar(0.85 + 0.3 * f.pulse + 0.15 * Math.sin(t * 7 + i));
        w.g.scale.setScalar(1 + 0.25 * f.pulse + 0.3 * singBoost);
      }
    }
    if (haloWrap.visible) {
      haloSpin.rotation.z = t * 0.22;
      haloGlowMat.opacity = 0.16 + 0.26 * f.glow + 0.06 * Math.sin(t * 2);
      haloWrap.position.y = 0.07 + Math.sin(t * 1.6) * 0.01;
      for (const p of petals) {
        const life = (t * 0.12 + p.seed * 0.37) % 1;
        const a = p.seed * 2.4 + t * 0.35;
        const r = 0.32 + 0.1 * Math.sin(p.seed * 3.1);
        p.m.position.set(Math.cos(a) * r, 0.95 - life * 0.75, Math.sin(a) * r);
        p.m.rotation.set(t * 1.3 + p.seed, t * 0.9 + p.seed * 2, Math.sin(t * 2 + p.seed) * 0.8);
        p.m.scale.setScalar(Math.max(0.001, Math.min(1, life * 6, (1 - life) * 6)));
      }
    }

    core.settle();
    burst.update(f.sparkle, t);
  }

  schedulePrewarm();
  return { root, headAnchor, hitMeshes, update, setEvolution, dispose: () => disposeHierarchy(root) };
}

// ============================================================================
// 3. PEBBLE — Mossy Axolotl
// ============================================================================

const P_MINT = lin(0xa8ecd0);
const P_JADE = lin(0x7ad6b4);
const P_DEEP = lin(0x58bfa0);
const P_BELLY = lin(0xe6fff4);
const P_ROSE = lin(0xffa6c8);
const P_FIN = lin(0xffc6dc);
const P_EYE_R = 0.054;

function pebbleBodySdf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = el(x, y, z, 0, 0.245, -0.03, 0.27, 0.235, 0.29); // round chubby body
  d = smin(d, el(x, y, z, 0, 0.2, 0.07, 0.22, 0.18, 0.2), 0.08); // belly
  d = smin(d, el(ax, y, z, 0.12, 0.1, -0.1, 0.12, 0.1, 0.14), 0.07); // hips
  d = smin(d, el(x, y, z, 0, 0.4, 0.04, 0.2, 0.12, 0.18), 0.08); // neck into wide head
  d = smin(d, sdRoundCone(x, y, z, 0, 0.12, -0.2, 0, 0.105, -0.3, 0.125, 0.098), 0.06); // tapering tail root
  d = lumps(d, () => sdfNoise3(x * 8 + 2, y * 8, z * 8 + 4), 0.006);
  return smax(d, -y, 0.01);
}

function pebbleHeadBase(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = el(x, y, z, 0, 0.0, 0.0, 0.32, 0.215, 0.245); // wide joyful head
  d = smin(d, el(ax, y, z, 0.17, -0.06, 0.07, 0.14, 0.11, 0.13), 0.08); // chubby cheeks
  d = smin(d, el(x, y, z, 0, -0.095, 0.08, 0.2, 0.08, 0.14), 0.07); // soft jaw
  d = smin(d, el(ax, y, z, 0.26, 0.04, -0.05, 0.07, 0.11, 0.07), 0.05); // gill roots
  d = lumps(d, () => sdfNoise3(x * 9, y * 9 + 2, z * 9 + 6), 0.006);
  return d;
}

interface PebbleHead extends HeadDesign {
  smile: THREE.Vector3[];
}

let pebbleHeadDesign: PebbleHead | null = null;
function getPebbleHead(): PebbleHead {
  if (pebbleHeadDesign) return pebbleHeadDesign;
  const ex = 0.15;
  const ey = 0.04;
  const zs = surfZ(pebbleHeadBase, ex, ey);
  const eye = { x: ex, y: ey, z: zs - P_EYE_R * 0.72 * 0.5, yaw: 0.35, roll: 0, sx: 1, sy: 1 };
  const smile: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const sx = -0.15 + (i / 10) * 0.3;
    const sy = -0.07 + 1.35 * sx * sx;
    smile.push(new THREE.Vector3(sx, sy, surfZ(pebbleHeadBase, sx, sy)));
  }
  const sdf: Sdf = (x, y, z) => {
    let d = pebbleHeadBase(x, y, z);
    d = smax(d, -sdSocket(Math.abs(x), y, z, eye.x, eye.y, eye.z, eye.yaw, 0, P_EYE_R * 1.07, P_EYE_R * 1.07, P_EYE_R * 0.8), 0.012);
    if (z > 0.1 && y < 0.0 && y > -0.12) {
      let g = Infinity;
      for (let i = 0; i < smile.length - 1; i++) {
        const a = smile[i];
        const b = smile[i + 1];
        g = Math.min(g, sdCapsule(x, y, z, a.x, a.y, a.z, b.x, b.y, b.z, 0.0075));
      }
      d = smax(d, -g, 0.008); // sculpted smile crease
    }
    return d;
  };
  pebbleHeadDesign = { sdf, eye, smile };
  return pebbleHeadDesign;
}

function pebbleTailBody(x: number, y: number, z: number): number {
  const sx = 0.64;
  return sdRoundCone(x / sx, y, z, 0, 0, 0.03, 0, 0.012, -0.52, 0.1, 0.018) * sx;
}

function pebbleTailSdf(x: number, y: number, z: number): number {
  let d = pebbleTailBody(x, y, z);
  const u = clamp(-z / 0.56, 0, 1);
  const h = (0.018 + 0.05 * ss(0.05, 0.45, u) * (1 - ss(0.85, 1.0, u))) * (1 + 0.14 * Math.sin(z * 42));
  let fin = Math.max(Math.abs(x) - 0.0075, d - h);
  if (y < 0) fin = Math.max(fin, z + 0.22); // ventral fin only toward the tip
  fin = Math.max(fin, z + 0.02);
  return smin(d, fin, 0.01);
}

const GILL_L = [0.25, 0.23, 0.19];

function pebbleGillGeo(k: number, L: number): THREE.BufferGeometry {
  return cached(`pebble.gill${k}`, () =>
    buildSdfGeometry({
      sdf(x, y, z) {
        let d = sdRoundCone(x, y, z, 0, -0.02, 0, 0, L * 0.5, -0.012, 0.019, 0.015);
        d = smin(d, sdRoundCone(x, y, z, 0, L * 0.5, -0.012, 0, L, 0.008, 0.015, 0.011), 0.02);
        d = smin(d, sph(x, y, z, 0, L + 0.004, 0.008, 0.019), 0.014);
        if (d > 0.075) return d;
        for (let j = 0; j < 6; j++) {
          const yj = L * (0.22 + 0.13 * j);
          const len = 0.062 * (1 - j * 0.085);
          if (Math.abs(y - yj - len * 0.3) > len + 0.03) continue;
          for (const fs of [-1, 1]) {
            d = smin(d, sdRoundCone(x, y, z, 0, yj, -0.006, fs * len * 0.88, yj + len * 0.45, 0.002, 0.0085, 0.005), 0.008);
            if (j < 5) {
              const y2 = yj + L * 0.065;
              d = smin(d, sdRoundCone(x, y, z, 0, y2, 0.006, fs * len * 0.6, y2 + len * 0.55, 0.022, 0.0072, 0.0042), 0.007);
            }
          }
        }
        return d;
      },
      min: [-0.075, -0.045, -0.035],
      max: [0.075, L + 0.045, 0.045],
      cell: 0.0072,
      paint(x, y) {
        const t = ss(0.008, 0.05, Math.abs(x));
        let c = mixc(lin(0xff7aa8), lin(0xffc4dc), t);
        c = mixc(c, lin(0xffd8e8), ss(L - 0.02, L + 0.01, y));
        return [c[0], c[1], c[2], 0.6 + 0.35 * t];
      },
    }),
  );
}

function pebbleGeometries() {
  const head = getPebbleHead();
  const bodyGeo = cached("pebble.body", () =>
    buildSdfGeometry({
      sdf: pebbleBodySdf,
      min: [-0.33, -0.03, -0.38],
      max: [0.33, 0.56, 0.32],
      cell: 0.022,
      paint(x, y, z, _nx, ny) {
        let c = mixc(P_MINT, P_JADE, ss(0.0, 0.6, ny) * ss(0.05, -0.15, z));
        c = mixc(c, P_BELLY, ss(0.06, 0.16, z) * ss(0.4, 0.25, y));
        const freckle = ss(0.7, 0.8, sdfNoise3(x * 22 + 3, y * 22, z * 22)) * ss(0.2, 0.7, ny + 0.2);
        c = mixc(c, P_DEEP, freckle * 0.7);
        return [c[0], c[1], c[2], 0];
      },
    }),
  );
  const headGeo = cached("pebble.head", () => {
    const g = buildSdfGeometry({
      sdf: head.sdf,
      min: [-0.37, -0.26, -0.29],
      max: [0.37, 0.26, 0.31],
      cell: 0.022,
      paint(x, y, z, _nx, ny) {
        const ax = Math.abs(x);
        let c = mixc(P_MINT, P_JADE, ss(0.2, 0.8, ny) * 0.8);
        c = mixc(c, P_BELLY, ss(-0.03, -0.1, y) * ss(0.02, 0.12, z));
        const freckle = ss(0.72, 0.82, sdfNoise3(x * 24 + 1, y * 24 + 5, z * 24)) * ss(0.3, 0.8, ny);
        c = mixc(c, P_DEEP, freckle * 0.65);
        c = mixc(c, P_ROSE, blob(ax, y, z, 0.2, -0.035, 0.17, 0.05, 0.035, 0, 1, 0) * 0.6);
        return [c[0], c[1], c[2], blob(ax, y, z, 0.27, 0.04, -0.05, 0.07, 0.04, 0, 1, 0) * 0.5];
      },
    });
    addMaskAttr(g, "aGlow", (x, y, z) => blob(Math.abs(x), y, z, 0.2, -0.035, 0.17, 0.055, 0.04, 0, 1, 0));
    return g;
  });
  const ridgeGeo = cached("pebble.ridge", () =>
    buildSdfGeometry({
      sdf(x, y, z) {
        const h = (0.03 + 0.012 * Math.sin(z * 26)) * ss(0.13, 0.05, z) * ss(-0.36, -0.22, z) + 0.004;
        let d = Math.max(Math.abs(x) - 0.0068, pebbleBodySdf(x, y, z) - h);
        d = smax(d, 0.22 - y, 0.01);
        return d;
      },
      min: [-0.03, 0.18, -0.42],
      max: [0.03, 0.56, 0.18],
      cell: 0.0095,
      paint(x, y, z) {
        const tip = ss(-0.004, 0.012, pebbleBodySdf(x, y, z));
        const c = mixc(P_JADE, P_FIN, tip);
        return [c[0], c[1], c[2], 0.95 * tip];
      },
    }),
  );
  const armGeo = cached("pebble.arm", () =>
    buildSdfGeometry({
      sdf(x, y, z) {
        let d = sdRoundCone(x, y, z, 0, 0.03, 0, 0, -0.07, 0.005, 0.04, 0.032);
        d = smin(d, el(x, y, z, 0, -0.1, 0.012, 0.046, 0.026, 0.05), 0.03);
        for (let k = 0; k < 4; k++) {
          const tx = -0.03 + k * 0.02;
          d = smin(d, sdRoundCone(x, y, z, tx * 0.6, -0.105, 0.03, tx, -0.112, 0.06 + (k === 1 || k === 2 ? 0.006 : 0), 0.012, 0.0095), 0.008);
        }
        return d;
      },
      min: [-0.07, -0.14, -0.06],
      max: [0.07, 0.09, 0.09],
      cell: 0.01,
      paint(_x, y) {
        const c = mixc(P_MINT, lin(0xffd0e0), ss(-0.09, -0.115, y));
        return [c[0], c[1], c[2], 0.3];
      },
    }),
  );
  const legGeo = cached("pebble.leg", () =>
    buildSdfGeometry({
      sdf(x, y, z) {
        let d = sdRoundCone(x, y, z, 0, 0.02, -0.04, 0, 0.0, 0.06, 0.05, 0.04);
        d = smin(d, el(x, y, z, 0, -0.015, 0.085, 0.052, 0.028, 0.05), 0.03);
        for (let k = 0; k < 4; k++) {
          const tx = -0.03 + k * 0.02;
          d = smin(d, sdRoundCone(x, y, z, tx * 0.6, -0.022, 0.09, tx, -0.026, 0.125 + (k === 1 || k === 2 ? 0.006 : 0), 0.013, 0.01), 0.008);
        }
        return smax(d, -(y + 0.045), 0.006);
      },
      min: [-0.08, -0.06, -0.1],
      max: [0.08, 0.08, 0.16],
      cell: 0.01,
      paint(_x, y, z) {
        const c = mixc(P_MINT, lin(0xffd0e0), ss(0.1, 0.13, z) * ss(-0.01, -0.03, y));
        return [c[0], c[1], c[2], 0.3];
      },
    }),
  );
  const tailGeo = cached("pebble.tail", () => {
    const g = buildSdfGeometry({
      sdf: pebbleTailSdf,
      min: [-0.08, -0.15, -0.62],
      max: [0.08, 0.16, 0.14],
      cell: 0.0115,
      paint(x, y, z, _nx, ny) {
        const fin = ss(0.002, 0.012, pebbleTailBody(x, y, z));
        let c = mixc(P_MINT, P_JADE, ss(0.0, 0.7, ny));
        const freckle = ss(0.72, 0.82, sdfNoise3(x * 24, y * 24 + 2, z * 24 + 9)) * ss(0.2, 0.7, ny);
        c = mixc(c, P_DEEP, freckle * 0.6);
        c = mixc(c, P_FIN, fin);
        return [c[0], c[1], c[2], fin * 0.95];
      },
    });
    addSkin(g, "-z", 0.08, 7);
    return g;
  });
  const capGeo = cached("pebble.moss", () =>
    buildSdfGeometry({
      sdf(x, y, z) {
        const hd = head.sdf(x, y, z);
        const t = 0.022 + (sdfNoise3(x * 18 + 4, y * 18, z * 18 + 2) - 0.5) * 0.024;
        let d = Math.max(hd - t, -hd - 0.004);
        const edge = 0.125 + (sdfNoise3(x * 9 + 7, 1.3, z * 9) - 0.5) * 0.05 + Math.max(0, z) * 0.15;
        d = smax(d, edge - y, 0.012);
        return d;
      },
      min: [-0.3, 0.06, -0.26],
      max: [0.3, 0.27, 0.26],
      cell: 0.014,
      paint(x, y, z) {
        const n = sdfNoise3(x * 20, y * 20, z * 20);
        let c = mixc(lin(0x4f9d44), lin(0x8ccc5a), n);
        c = mixc(c, lin(0x2f6f34), ss(0.15, 0.12, y) * 0.6);
        return [c[0], c[1], c[2], 0.2];
      },
    }),
  );
  const charmGeo = cached("pebble.charm", () =>
    buildSdfGeometry({
      sdf: (x, y, z) => el(x, y, z, 0, 0, 0, 0.032, 0.02, 0.026) - (sdfNoise3(x * 60, y * 60, z * 60) - 0.5) * 0.004,
      min: [-0.04, -0.03, -0.035],
      max: [0.04, 0.03, 0.035],
      cell: 0.004,
      paint(x, y, z, _nx, ny) {
        let c = mixc(lin(0x8a9aa2), lin(0xb8c4c4), sdfNoise3(x * 50, y * 50, z * 50));
        c = mixc(c, lin(0x6cbf58), ss(0.35, 0.7, ny + (sdfNoise3(x * 70, 2, z * 70) - 0.5) * 0.6));
        return [c[0], c[1], c[2], 0];
      },
    }),
  );
  const gillGeos = GILL_L.map((L, k) => pebbleGillGeo(k, L));
  return { head, bodyGeo, headGeo, ridgeGeo, armGeo, legGeo, tailGeo, capGeo, charmGeo, gillGeos };
}

/** Animated caustic ripple ring for the ground under Pebble (TSL, additive, AgX-bloom friendly). */
function makeRippleMaterial(uTime: U, uPulse: U, uStrength: U): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const p = uv().sub(0.5).mul(2.0);
  const r = length(p);
  const w1 = sin(r.mul(34).sub(uTime.mul(2.6)));
  const w2 = sin(length(p.sub(vec2(0.32, 0.12))).mul(27).sub(uTime.mul(2.1)));
  const w3 = sin(length(p.add(vec2(0.26, -0.22))).mul(31).sub(uTime.mul(3.0)));
  const caustic = pow(saturate(w1.add(w2).add(w3).mul(0.1667).add(0.5)), float(4.0));
  const band = tslSmoothstep(0.32, 0.55, r).mul(float(1.0).sub(tslSmoothstep(0.8, 1.0, r)));
  const tint = mix(color(0x4ff2d0), color(0xff9cd2), sin(r.mul(9.0).sub(uTime.mul(0.7))).mul(0.5).add(0.5));
  const k = caustic.mul(band).mul(uStrength.add(uPulse.mul(0.8)));
  mat.colorNode = tint.mul(k).mul(2.4);
  mat.opacityNode = saturate(k);
  return mat;
}

function buildPebbleRig(): PetModelRig {
  const core = new PetCore({ centerY: 0.38, headY: 0.55, frontZ: 0.2, stageScale: [1.04, 1.08, 1.12, 1.16] });
  const { root, body } = core;
  const hitMeshes: THREE.Object3D[] = [];
  const reveals: Reveal[] = [];
  const G = pebbleGeometries();
  const pulseUniform = uniform(0.2);
  const uCheek = uniform(0.2);
  const uTime = uniform(0);
  const uRipple = uniform(0);

  const skinMat = makeBioSssMaterial({
    sssColor: 0x6ef7d2, iridColor: 0xffa8d6, clearcoat: 0.92, roughness: 0.16, sssStrength: 1.25, pulseUniform,
  });
  const headMat = makeBioSssMaterial({
    sssColor: 0x6ef7d2, iridColor: 0xffa8d6, clearcoat: 0.92, roughness: 0.16, sssStrength: 1.25, pulseUniform,
  });
  addEmissiveMask(headMat, "aGlow", 0xff6fa8, uCheek);
  const ridgeMat = makeBioSssMaterial({
    sssColor: 0xff9cc8, iridColor: 0xa8fff0, clearcoat: 0.9, roughness: 0.14, sssStrength: 1.4, opacity: 0.9, pulseUniform,
  });
  const gillMat = makeBioSssMaterial({
    sssColor: 0xff5c9e, iridColor: 0xffd0f0, clearcoat: 0.75, roughness: 0.26, sssStrength: 1.45, pulseUniform,
  });
  const lidMat = makeBioSssMaterial({ baseColor: 0xa8ecd0, useSdfAttrs: false, sssColor: 0x6ef7d2, iridColor: 0xffa8d6, sssStrength: 0.6 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x5a2a44, roughness: 0.45 });
  const mouthMat = glossy(0x7a2a4a, 0.4);

  // ---- seamless wet sea-glass body + undulating translucent dorsal ridge
  const torso = sculpted(body, G.bodyGeo, skinMat);
  hitMeshes.push(torso);
  for (const [x, z] of [[0, 0.06], [0.12, -0.02], [-0.12, -0.02], [0, -0.12]]) core.contact(body, x, 0, z);
  const ridge = new THREE.Mesh(G.ridgeGeo, ridgeMat);
  ridge.castShadow = true;
  body.add(ridge);

  // ---- tiny dimpled limbs with toes
  const arms: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.18, 0.16, 0.13);
    pivot.rotation.z = side * 0.55;
    const arm = sculpted(pivot, G.armGeo, skinMat);
    hitMeshes.push(arm);
    core.contact(pivot, 0, -0.128, 0.04);
    body.add(pivot);
    arms.push({ pivot, side });
  }
  const legs: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.2, 0.045, 0.05);
    pivot.rotation.y = side * 0.55;
    const leg = sculpted(pivot, G.legGeo, skinMat);
    hitMeshes.push(leg);
    core.contact(pivot, 0, -0.045, 0.12);
    core.contact(pivot, 0, -0.045, 0.06);
    body.add(pivot);
    legs.push({ pivot, side });
  }

  // ---- undulating finned tail (one skinned sculpt)
  const tailBase = at(new THREE.Group(), 0, 0.1, -0.26);
  tailBase.rotation.x = -0.08;
  body.add(tailBase);
  const TSEG = 0.08;
  const tail = makeSkinChain(G.tailGeo, skinMat, 7, new THREE.Vector3(0, 0, -TSEG));
  tailBase.add(tail.mesh);
  hitMeshes.push(tail.mesh);
  const tailJoints = tail.joints;
  for (let i = 0; i < tailJoints.length; i++) {
    const rr = lerp(0.1, 0.025, i / (tailJoints.length - 1));
    core.contact(tailJoints[i], 0, -rr - (i >= 3 ? 0.035 : 0), -TSEG * 0.5);
  }

  // ---- big round head
  const neck = at(new THREE.Group(), 0, 0.42, 0.05);
  neck.rotation.order = "YXZ";
  body.add(neck);
  const headG = new THREE.Group();
  neck.add(headG);
  const face = at(new THREE.Group(), 0, 0.13, 0.03);
  headG.add(face);
  const skull = sculpted(face, G.headGeo, headMat);
  hitMeshes.push(skull);
  const hs = G.head.sdf;

  const eyes: EyeRig[] = [];
  const E = G.head.eye;
  for (const side of [-1, 1]) {
    const eye = makeJewelEye(P_EYE_R, 0x163854, 0x7ef2ff, 0.5, lidMat, lineMat);
    eye.group.position.set(side * E.x, E.y, E.z);
    eye.group.rotation.y = side * E.yaw;
    face.add(eye.group);
    eyes.push(eye);
  }
  // wide gentle smile line nested in the sculpted crease
  const smileCenter = G.head.smile[5];
  const smileG = at(new THREE.Group(), smileCenter.x, smileCenter.y, smileCenter.z);
  face.add(smileG);
  const smileCurve = new THREE.CatmullRomCurve3(G.head.smile.map((p) => new THREE.Vector3(p.x, p.y, p.z - 0.004).sub(smileCenter)));
  smileG.add(new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 40, 0.0042, 6, false), lineMat));
  const mouthOpen = stick(ell(0.032, 1.5, 1, 0.45, mouthMat, 16), hs, 0, -0.088, surfZ(hs, 0, -0.088), -0.006);
  face.add(mouthOpen);

  // six multi-tiered backlit gill plumes (three per side)
  const gills: { stalk: THREE.Group; mesh: THREE.Mesh; side: number; k: number; a: number }[] = [];
  const GILL_A = [0.35, 0.85, 1.35];
  const GILL_Y = [0.09, 0.02, -0.05];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const stalk = at(new THREE.Group(), side * 0.27, 0.05 + GILL_Y[k], -0.05 + k * 0.02);
      const mesh = solid(new THREE.Mesh(G.gillGeos[k], gillMat));
      stalk.add(mesh);
      hitMeshes.push(mesh);
      face.add(stalk);
      gills.push({ stalk, mesh, side, k, a: GILL_A[k] });
    }
  }

  // ---- Stage 1+: tiny mossy pebble charm tucked on the head
  const charmMat = makePlushSssMaterial({ sssColor: 0xb8ffb0, sssStrength: 0.4, roughness: 0.6, sheen: 0.4 });
  const charmX = 0.15;
  const charmZ = 0.04;
  const mossTop = (x: number, z: number) => surfY((px, py, pz) => hs(px, py, pz) - 0.024, x, z);
  const charmYHead = surfY(hs, charmX, charmZ);
  const charmYCap = mossTop(charmX, charmZ);
  const charm = solid(at(new THREE.Mesh(G.charmGeo, charmMat), charmX, charmYHead + 0.012, charmZ));
  charm.rotation.set(0.25, 0.4, -0.35);
  face.add(charm);

  // ---- Stage 2: velvet moss cap + bioluminescent fairy mushrooms + clover sprouts
  const mossWrap = new THREE.Group();
  face.add(mossWrap);
  const mossReveal = new Reveal(mossWrap, 2);
  reveals.push(mossReveal);
  const mossMat = makePlushSssMaterial({ sssColor: 0xb8ff8a, sssStrength: 0.7, roughness: 0.95, sheen: 0.9, grainScale: 80 });
  sculpted(mossWrap, G.capGeo, mossMat, { layers: 4, length: 0.011, density: 96, sssColor: 0xd0ff9a, groom: [0, 0.2, 0] });
  const mushCapMat = makeBioSssMaterial({ baseColor: 0x9ff7ff, useSdfAttrs: false, sssColor: 0x5ff0ff, iridColor: 0xd0a8ff, sssStrength: 1.6, clearcoat: 0.8, roughness: 0.3, pulseUniform });
  const stemMat = makePlushSssMaterial({ baseColor: 0xfff4e0, useSdfAttrs: false, sssColor: 0xfff0c0, sssStrength: 0.8, roughness: 0.6 });
  const spotGlow = makeHdrGlowMaterial(0xbfffff, 2.2, pulseUniform);
  const mushrooms: THREE.Group[] = [];
  for (const [mx, mz, sc] of [[-0.07, 0.02, 1], [-0.12, -0.04, 0.7]] as [number, number, number][]) {
    const g = at(new THREE.Group(), mx, mossTop(mx, mz) - 0.004, mz);
    g.scale.setScalar(sc);
    const stem = solid(at(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.05, 12), stemMat), 0, 0.025, 0));
    stem.rotation.z = 0.12;
    g.add(stem);
    const capM = solid(at(new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 12, 0, TAU, 0, PI * 0.55), mushCapMat), -0.003, 0.048, 0));
    capM.scale.set(1, 0.7, 1);
    g.add(capM);
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * TAU + 0.4;
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), spotGlow), Math.cos(a) * 0.018, 0.064, Math.sin(a) * 0.018));
    }
    mossWrap.add(g);
    mushrooms.push(g);
  }
  const leafMat = makePlushSssMaterial({ baseColor: 0x7fd36a, useSdfAttrs: false, sssColor: 0xc8ff8a, sssStrength: 1.1, roughness: 0.6, sheen: 0.6 });
  leafMat.side = THREE.DoubleSide;
  const heartLeaf = makePetalGeo(0.016, 0.026, 0.002, 0.4, 0.08);
  const sprouts: { g: THREE.Group; side: number }[] = [];
  for (const [sx, sz, side] of [[0.05, 0.0, 1], [0.02, -0.08, -1]] as [number, number, number][]) {
    const g = at(new THREE.Group(), sx, mossTop(sx, sz) - 0.004, sz);
    g.add(solid(at(new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0035, 0.04, 6), leafMat), 0, 0.02, 0)));
    for (let l = 0; l < 3; l++) {
      const holder = at(new THREE.Group(), 0, 0.04, 0);
      holder.rotation.y = (l / 3) * TAU;
      const leaf = new THREE.Mesh(heartLeaf, leafMat);
      leaf.castShadow = true;
      leaf.rotation.x = PI / 2 - 0.4;
      holder.add(leaf);
      g.add(holder);
    }
    mossWrap.add(g);
    sprouts.push({ g, side });
  }

  // ---- Stage 3: orbiting iridescent crystal droplet pearls + glowing dewdrop bubbles
  const pearlWrap = new THREE.Group();
  body.add(pearlWrap);
  reveals.push(new Reveal(pearlWrap, 3));
  const dropMat = makeBioSssMaterial({
    baseColor: 0xd8fbff, useSdfAttrs: false, sssColor: 0x7ef2ff, iridColor: 0xffa8f0, sssStrength: 1.2,
    clearcoat: 1, roughness: 0.05, opacity: 0.82, pulseUniform,
  });
  const dropGeo = makeTeardropGeo(0.024);
  const pearls: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const drop = new THREE.Mesh(dropGeo, dropMat);
    drop.castShadow = true;
    g.add(drop);
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })), 0.009, 0.006, 0.019));
    pearlWrap.add(g);
    pearls.push(g);
  }
  const bubbleCore = makeHdrGlowMaterial(0xa8fff4, 1.8, pulseUniform);
  const bubbles: { g: THREE.Group; halo: THREE.MeshBasicMaterial; seed: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const m = makeMote(bubbleCore, 0x7ff0ff, 0.008);
    pearlWrap.add(m.g);
    bubbles.push({ ...m, seed: i * 1.91 + 0.3 });
  }

  // ---- Stage 4: multi-petal translucent crystal lotus tiara + caustic ripple ring
  const tiaraWrap = at(new THREE.Group(), 0, 0.29, -0.01);
  face.add(tiaraWrap);
  reveals.push(new Reveal(tiaraWrap, 4));
  const tiara = new THREE.Group();
  tiaraWrap.add(tiara);
  const lotusOuter = makeBioSssMaterial({
    baseColor: 0xe8fff6, useSdfAttrs: false, sssColor: 0x9ff7e0, iridColor: 0xffb8e0, sssStrength: 1.4, clearcoat: 1, roughness: 0.08, opacity: 0.86, pulseUniform,
  });
  const lotusInner = makeBioSssMaterial({
    baseColor: 0xffe0ee, useSdfAttrs: false, sssColor: 0xff9ac8, iridColor: 0xfff0c0, sssStrength: 1.5, clearcoat: 1, roughness: 0.08, opacity: 0.9, pulseUniform,
  });
  lotusOuter.side = THREE.DoubleSide;
  lotusInner.side = THREE.DoubleSide;
  const outerPetal = makePetalGeo(0.032, 0.085, 0.006, 1.0);
  const innerPetal = makePetalGeo(0.024, 0.06, 0.005, 1.2);
  for (let i = 0; i < 8; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (i / 8) * TAU;
    const petal = at(new THREE.Mesh(outerPetal, lotusOuter), 0, 0, 0.04);
    petal.rotation.x = 0.75;
    holder.add(petal);
    tiara.add(holder);
  }
  for (let i = 0; i < 5; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (i / 5) * TAU + 0.3;
    const petal = at(new THREE.Mesh(innerPetal, lotusInner), 0, 0.004, 0.02);
    petal.rotation.x = 0.35;
    holder.add(petal);
    tiara.add(holder);
  }
  const stamenGlow = makeHdrGlowMaterial(0xffe9a0, 2.4, pulseUniform);
  const stamenStalk = new THREE.MeshStandardMaterial({ color: 0xfff0b0, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    tiara.add(tube([[0, 0.004, 0], [Math.cos(a) * 0.008, 0.024, Math.sin(a) * 0.008], [Math.cos(a) * 0.013, 0.04, Math.sin(a) * 0.013]], 0.0014, stamenStalk, 6, 4));
    tiara.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), stamenGlow), Math.cos(a) * 0.013, 0.041, Math.sin(a) * 0.013));
  }
  const dew = at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), dropMat), 0, 0.02, 0);
  tiara.add(dew);
  const circlet = solid(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.005, 8, 64), lotusOuter));
  circlet.rotation.x = PI / 2;
  circlet.position.y = -0.01;
  tiara.add(circlet);

  const rippleWrap = at(new THREE.Group(), 0, 0.004, 0);
  root.add(rippleWrap);
  const rippleReveal = new Reveal(rippleWrap, 4);
  reveals.push(rippleReveal);
  const ripple = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), makeRippleMaterial(uTime, pulseUniform, uRipple));
  ripple.rotation.x = -PI / 2;
  ripple.renderOrder = 2;
  rippleWrap.add(ripple);

  const burst = makeBurst([0x9ff7e0, 0xff9cc0, 0xc8f8ff]);
  burst.group.position.y = 0.5;
  core.motion.add(burst.group);

  const headAnchor = at(new THREE.Object3D(), 0, 0.52, 0);
  headG.add(headAnchor);

  function setEvolution(stage: EvolutionStage): void {
    core.stage = stage;
    if (core.frames === 0) for (const r of reveals) r.tick(stage, 0, true);
  }

  function update(pose: PetPoseInput): void {
    if (pose.evolution !== core.stage) setEvolution(pose.evolution);
    const f = core.frame(pose);
    const { t, dt } = f;
    for (const r of reveals) r.tick(core.stage, dt);
    pulseUniform.value = pose.attentionPulse;
    uTime.value = t;

    neck.rotation.set(f.headPitch, f.headYaw, f.headRoll);
    for (const e of eyes) e.update(f.eyeX, f.eyeY, f.lid, f.happyEyes);

    mouthOpen.visible = f.mouth > 0.04;
    mouthOpen.scale.set(1.5, Math.max(0.05, f.mouth), 0.45);
    smileG.scale.set(1 + 0.06 * f.happyEyes - 0.1 * f.mouth, 1 + 0.25 * f.happyEyes, 1);
    uCheek.value = 0.12 + f.blush * 0.55;

    // gills breathe, pulse with the LLM's attention, stream back on zoomies, droop when sleepy
    const sing = f.trick === "sing" ? f.env : 0;
    for (const g of gills) {
      const wave = Math.sin(t * (2 + f.excite * 2) + g.k * 0.9 + g.side) * (0.07 + 0.05 * f.excite);
      const ang = g.a + wave + 0.4 * f.droop - 0.15 * f.perk + 0.2 * f.flare;
      g.stalk.rotation.set(-0.25 - 0.35 * f.droop + 0.05 * Math.sin(t * 1.6 + g.k), 0, -g.side * ang);
      const fluff = 1 + 0.22 * f.pulse * (0.5 + 0.5 * Math.sin(t * 4 + g.k * 1.3)) + 0.15 * sing + 0.1 * f.petted;
      g.mesh.scale.set(fluff, 1, 1 + (fluff - 1) * 0.5);
    }

    // limbs: gentle paddle idle, waving when happy/petted, frantic paddling in zoomies
    const wave = clamp(f.happyEyes * 0.6 + f.petted, 0, 1);
    for (const a of arms) {
      const pad = Math.sin(t * 18 + (a.side > 0 ? PI : 0)) * 0.8 * f.paddle;
      a.pivot.rotation.x = Math.sin(t * 2 + a.side) * 0.12 + pad - 0.4 * f.airborne;
      a.pivot.rotation.z = a.side * (0.55 + 0.35 * wave * (0.5 + 0.5 * Math.sin(t * 9 + (a.side > 0 ? 0 : 1.2))) + 0.3 * f.flare);
    }
    for (const l of legs) {
      l.pivot.rotation.y = l.side * (0.55 + Math.sin(t * 18 + (l.side > 0 ? 0 : PI)) * 0.35 * f.paddle + Math.sin(t * 1.5) * 0.05);
    }

    // tail & fin undulation (travelling wave through the skinned sculpt)
    const amp = 0.12 + 0.12 * f.excite + 0.08 * f.wag + 0.2 * f.paddle;
    const spd = 2.6 + 3 * f.excite + 6 * f.paddle;
    for (let i = 0; i < tailJoints.length; i++) {
      const u = i / (tailJoints.length - 1);
      const curl = lerp(0.08, 0.32, f.dream);
      tailJoints[i].rotation.y = Math.sin(t * spd - i * 0.8) * amp * (0.3 + u) * (1 - f.dream * 0.7) + (i > 0 ? curl : 0);
      tailJoints[i].rotation.x = i === 0 ? 0 : Math.sin(t * spd * 0.5 - i * 0.6) * 0.02;
    }
    ridge.scale.x = 1 + 0.25 * Math.sin(t * spd * 0.7);
    ridge.rotation.z = Math.sin(t * spd * 0.5) * 0.015 * (0.5 + f.excite);

    // charm settles into the moss cap as it grows in
    charm.position.y = lerp(charmYHead + 0.012, charmYCap + 0.006, mossReveal.v);
    charm.rotation.z = -0.35 + Math.sin(t * 1.2) * 0.03;

    if (mossWrap.visible) {
      for (const s of sprouts) {
        s.g.rotation.z = s.side * (-0.12 + Math.sin(t * 1.8 + s.side) * 0.1 - 0.3 * f.droop + 0.25 * f.flare);
        s.g.rotation.y = t * 0.2 * s.side;
      }
      for (let i = 0; i < mushrooms.length; i++) {
        mushrooms[i].rotation.z = Math.sin(t * 1.3 + i * 2) * 0.05 + 0.1 * f.flare;
      }
    }
    if (pearlWrap.visible) {
      for (let i = 0; i < pearls.length; i++) {
        const a = t * (0.55 + sing * 0.6) + (i / pearls.length) * TAU;
        const r = 0.44 + 0.04 * Math.sin(t * 1.2 + i * 1.7);
        pearls[i].position.set(Math.cos(a) * r, 0.42 + 0.16 * Math.sin(t * 0.8 + i * 2.2), Math.sin(a) * r);
        pearls[i].rotation.set(Math.sin(t * 2 + i) * 0.3, a, Math.sin(t * 1.4 + i) * 0.2);
      }
      for (const b of bubbles) {
        const life = (t * 0.18 + b.seed * 0.29) % 1;
        const a = b.seed * 2.2 + t * 0.4;
        b.g.position.set(Math.cos(a) * (0.3 + 0.08 * Math.sin(b.seed)), 0.15 + life * 0.8, Math.sin(a) * 0.32);
        const s = Math.max(0.001, Math.min(1, life * 5, (1 - life) * 4));
        b.g.scale.setScalar(s * (0.8 + 0.4 * f.pulse));
        b.halo.opacity = 0.18 + 0.2 * f.glow;
      }
    }
    if (tiaraWrap.visible) {
      tiaraWrap.position.y = 0.29 + Math.sin(t * 1.3) * 0.012;
      tiara.rotation.y = t * 0.35;
    }
    uRipple.value = rippleWrap.visible ? (0.55 + 0.2 * Math.sin(t * 1.4) + 0.4 * f.glow) * rippleReveal.v : 0;
    ripple.scale.setScalar(core.grow.scale.x * (1 + 0.03 * Math.sin(t * 0.9)));

    core.settle();
    burst.update(f.sparkle, t);
  }

  schedulePrewarm();
  return { root, headAnchor, hitMeshes, update, setEvolution, dispose: () => disposeHierarchy(root) };
}

// ============================================================================
// Species catalog entries
// ============================================================================

export const CLAUDE_SPECIES: SpeciesDefinition[] = [
  {
    id: "mochi",
    name: "Mochi",
    species: "Calico Kitten",
    author: "Claude Opus 5.5",
    accentHex: "#ff9e7d",
    tagline: "A squishy calico who purrs in warm chimes and naps in sunbeams.",
    personalitySeed:
      "Mochi is a soft, sleepy-sweet calico kitten. Gentle, a little mischievous, loves sunbeams, yarn, " +
      "warm milk and quiet company. Speaks in short cozy sentences, purrs when happy, and gets curious about small sounds.",
    favoriteWords: ["purr", "sunbeam", "mrrp", "cozy", "yarn", "nap", "bell", "warm"],
    voicePitch: 523.25,
    buildRig: buildMochiRig,
  },
  {
    id: "kitsune",
    name: "Kitsune",
    species: "Spirit Fox Pup",
    author: "Claude Opus 5.5",
    accentHex: "#ff7ab8",
    tagline: "A spirit fox pup whose tails bloom with every lesson learned.",
    personalitySeed:
      "Kitsune is a graceful, playful spirit fox pup from a moonlit shrine forest. Clever, curious and kind, " +
      "fond of riddles, lanterns and falling petals. Speaks with gentle wonder and grows a new tail of light with each memory.",
    favoriteWords: ["lantern", "petal", "moon", "riddle", "kon", "shrine", "glow", "wish"],
    voicePitch: 587.33,
    buildRig: buildKitsuneRig,
  },
  {
    id: "pebble",
    name: "Pebble",
    species: "Mossy Axolotl",
    author: "Claude Opus 5.5",
    accentHex: "#5ef0b5",
    tagline: "A beaming pond sprite with frilly gills and a pocketful of dewdrops.",
    personalitySeed:
      "Pebble is a joyful, round axolotl water sprite who lives in a mossy pond. Endlessly cheerful, slow and wiggly, " +
      "loves bubbles, lily pads, rain and smooth stones. Speaks in bubbly, upbeat phrases and smiles at everything.",
    favoriteWords: ["blub", "bubble", "lily", "dewdrop", "pond", "wiggle", "moss", "splash"],
    voicePitch: 440.0,
    buildRig: buildPebbleRig,
  },
];
