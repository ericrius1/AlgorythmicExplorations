// The eagle's body, lofted. No distance fields, no polygonizer: the mesh is
// built the way a boat hull is — rings of vertices stationed along a curve,
// stitched into quads, split into triangles. Every component (torso, beak,
// brow, wing sleeves, legs, toes, talons) is one loft: a list of stations,
// each carrying a center, an oval radius, and optionally a shape function
// that dents or bulges the ring. The skeleton table decides where the
// stations go; the loft decides nothing but how to wrap skin around them.

import * as THREE from "three/webgpu";
import { BIRD_BONES, BONE_INDEX, ZONE } from "./skeleton";

// One ring of the loft: an oval (rx, ry) in the plane perpendicular to the
// path, optionally reshaped by `shape(theta)` — a radial multiplier that puts
// the keel on the chest, the culmen ridge on the beak, the brow on the skull.
export interface Station {
  c: [number, number, number];
  rx: number;
  ry: number;
  shape?: (theta: number) => number;
  zone?: number; // override the loft's zone from this station on
}

export interface Loft {
  name: string;
  stations: Station[];
  segments: number; // vertices around each ring
  zone: number;
  capStart?: boolean;
  capEnd?: boolean;
  // pin every vertex of this loft to one bone (skips proximity weighting —
  // the upper beak must follow the skull, the talons must follow the foot)
  pin?: string;
  mirror?: boolean; // emit a copy with x negated (and pin L→R)
}

// Plumage, one color per zone (sRGB): chocolate body, white head, near-black
// flight-feather wing, white tail, yellow beak and legs, dark talons. Flat
// facets eat saturation, so everything is pushed a little past nature.
export const ZONE_COLORS = [0x4a3622, 0xf2ecdd, 0x33281e, 0xe9e3d2, 0xe9a92d, 0xe2a838, 0x1b1713];

const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// gaussian-ish bump for shape functions: 1 + amp around theta0 (radians)
const bump = (amp: number, theta0: number, width: number) => (theta: number): number => {
  let d = Math.abs(theta - theta0);
  d = Math.min(d, Math.PI * 2 - d);
  return 1 + amp * Math.exp(-(d * d) / (2 * width * width));
};
const bumps = (...fns: ((t: number) => number)[]) => (theta: number): number =>
  fns.reduce((acc, f) => acc * f(theta), 1);

// theta convention: 0 = +x (the bird's left), π/2 = up, 3π/2 = down (keel).
const UP_T = Math.PI / 2;
const DOWN_T = (3 * Math.PI) / 2;

// ---- the parts list --------------------------------------------------------------

// Every loft of the eagle, parameterized by `bulk` (the fluff dial — scales
// every radius, not any position). The part-1 demos draw these rings raw;
// buildEagleBody() wraps them in skin. One table, two consumers.
export function eagleLofts(bulk = 1): Loft[] {
  const b = bulk;
  const brow = bumps(bump(0.16, UP_T - 0.55, 0.42), bump(0.16, UP_T + 0.55, 0.42));
  const keel = bump(0.12, DOWN_T, 0.7);
  const culmen = bump(0.22, UP_T, 0.55);
  const flatTop = bump(-0.10, UP_T, 0.6);

  const lofts: Loft[] = [
    {
      name: "torso",
      segments: 14,
      zone: ZONE.body,
      capStart: true,
      capEnd: true,
      stations: [
        { c: [0, 0.46, -0.225], rx: 0.042 * b, ry: 0.048 * b },
        { c: [0, 0.465, -0.13], rx: 0.10 * b, ry: 0.115 * b },
        { c: [0, 0.46, -0.01], rx: 0.145 * b, ry: 0.175 * b, shape: keel },
        { c: [0, 0.475, 0.10], rx: 0.132 * b, ry: 0.16 * b, shape: keel },
        { c: [0, 0.51, 0.17], rx: 0.112 * b, ry: 0.125 * b },
        { c: [0, 0.555, 0.21], rx: 0.085 * b, ry: 0.09 * b, zone: ZONE.head },
        { c: [0, 0.60, 0.245], rx: 0.074 * b, ry: 0.077 * b },
        { c: [0, 0.645, 0.275], rx: 0.078 * b, ry: 0.08 * b },
        { c: [0, 0.675, 0.315], rx: 0.075 * b, ry: 0.072 * b, shape: bumps(brow, flatTop) },
        { c: [0, 0.675, 0.355], rx: 0.057 * b, ry: 0.05 * b, shape: bumps(brow, flatTop) },
        { c: [0, 0.664, 0.385], rx: 0.037 * b, ry: 0.033 * b },
      ],
    },
    {
      name: "beak-upper",
      segments: 10,
      zone: ZONE.beak,
      capEnd: true,
      pin: "head",
      stations: [
        { c: [0, 0.672, 0.372], rx: 0.030 * b, ry: 0.027 * b, shape: culmen },
        { c: [0, 0.668, 0.405], rx: 0.026 * b, ry: 0.023 * b, shape: culmen },
        { c: [0, 0.656, 0.435], rx: 0.020 * b, ry: 0.018 * b, shape: culmen },
        { c: [0, 0.641, 0.458], rx: 0.012 * b, ry: 0.011 * b },
        { c: [0, 0.616, 0.470], rx: 0.0035 * b, ry: 0.0035 * b }, // the hook drops
      ],
    },
    {
      name: "beak-lower",
      segments: 8,
      zone: ZONE.beak,
      capEnd: true,
      pin: "beak",
      stations: [
        { c: [0, 0.645, 0.368], rx: 0.022 * b, ry: 0.014 * b },
        { c: [0, 0.638, 0.408], rx: 0.018 * b, ry: 0.011 * b },
        { c: [0, 0.631, 0.443], rx: 0.009 * b, ry: 0.006 * b },
      ],
    },
    {
      name: "browL",
      segments: 7,
      zone: ZONE.head,
      capStart: true,
      capEnd: true,
      pin: "head",
      mirror: true,
      stations: [
        { c: [0.048, 0.684, 0.298], rx: 0.016 * b, ry: 0.009 * b },
        { c: [0.060, 0.681, 0.330], rx: 0.021 * b, ry: 0.011 * b },
        { c: [0.050, 0.672, 0.362], rx: 0.012 * b, ry: 0.007 * b },
      ],
    },
    // -- folded wing sleeves: one loft per bone so the Z can hinge ----------------
    {
      name: "sleeve-humL",
      segments: 9,
      zone: ZONE.wing,
      capStart: true,
      mirror: true,
      stations: [
        { c: [0.135, 0.535, 0.10], rx: 0.036 * b, ry: 0.052 * b },
        { c: [0.165, 0.518, -0.01], rx: 0.034 * b, ry: 0.050 * b },
        { c: [0.185, 0.50, -0.10], rx: 0.030 * b, ry: 0.045 * b },
      ],
    },
    {
      name: "sleeve-foreL",
      segments: 9,
      zone: ZONE.wing,
      mirror: true,
      stations: [
        { c: [0.185, 0.50, -0.10], rx: 0.029 * b, ry: 0.044 * b },
        { c: [0.168, 0.516, 0.04], rx: 0.026 * b, ry: 0.041 * b },
        { c: [0.155, 0.53, 0.16], rx: 0.022 * b, ry: 0.036 * b },
      ],
    },
    {
      name: "sleeve-handL",
      segments: 8,
      zone: ZONE.wing,
      capEnd: true,
      mirror: true,
      stations: [
        { c: [0.155, 0.53, 0.16], rx: 0.019 * b, ry: 0.032 * b },
        { c: [0.135, 0.515, -0.02], rx: 0.014 * b, ry: 0.024 * b },
        { c: [0.115, 0.50, -0.18], rx: 0.006 * b, ry: 0.011 * b },
      ],
    },
    // -- tail root: the white coverts the rectrices fan out from ------------------
    {
      name: "tail-root",
      segments: 9,
      zone: ZONE.tail,
      capEnd: true,
      stations: [
        { c: [0, 0.45, -0.20], rx: 0.052 * b, ry: 0.042 * b },
        { c: [0, 0.425, -0.34], rx: 0.040 * b, ry: 0.026 * b },
        { c: [0, 0.405, -0.46], rx: 0.020 * b, ry: 0.011 * b },
      ],
    },
    // -- legs ----------------------------------------------------------------------
    {
      name: "thighL",
      segments: 9,
      zone: ZONE.body,
      capEnd: true,
      mirror: true,
      stations: [
        { c: [0.065, 0.40, 0.0], rx: 0.058 * b, ry: 0.062 * b },
        { c: [0.078, 0.30, 0.02], rx: 0.052 * b, ry: 0.055 * b },
        { c: [0.085, 0.21, 0.03], rx: 0.034 * b, ry: 0.036 * b },
      ],
    },
    {
      name: "tarsusL",
      segments: 7,
      zone: ZONE.leg,
      mirror: true,
      stations: [
        { c: [0.085, 0.22, 0.03], rx: 0.023 * b, ry: 0.023 * b },
        { c: [0.092, 0.13, 0.04], rx: 0.020 * b, ry: 0.020 * b },
        { c: [0.095, 0.055, 0.05], rx: 0.019 * b, ry: 0.019 * b },
      ],
    },
  ];

  // toes and talons: three forward, one back, per side. Each toe is a short
  // loft from the foot pivot; each talon a curling cone off the toe's end.
  const foot: [number, number, number] = [0.095, 0.055, 0.05];
  const toeDirs: { d: [number, number, number]; len: number; name: string }[] = [
    { d: [-0.45, 0, 0.89], len: 0.115, name: "toe-inL" },
    { d: [0.08, 0, 1.0], len: 0.13, name: "toe-midL" },
    { d: [0.72, 0, 0.69], len: 0.105, name: "toe-outL" },
    { d: [-0.10, 0, -0.99], len: 0.095, name: "toe-backL" },
  ];
  for (const t of toeDirs) {
    const n = Math.hypot(t.d[0], t.d[1], t.d[2]);
    const dx = t.d[0] / n, dz = t.d[2] / n;
    const drop = foot[1] - 0.018;
    const tip: [number, number, number] = [foot[0] + dx * t.len, 0.018, foot[2] + dz * t.len];
    lofts.push({
      name: t.name,
      segments: 6,
      zone: ZONE.leg,
      pin: "footL",
      mirror: true,
      stations: [
        { c: [foot[0] + dx * 0.012, drop + 0.012, foot[2] + dz * 0.012], rx: 0.016, ry: 0.014 },
        { c: [foot[0] + dx * t.len * 0.55, 0.020, foot[2] + dz * t.len * 0.55], rx: 0.013, ry: 0.012 },
        { c: tip, rx: 0.010, ry: 0.010 },
      ],
    });
    lofts.push({
      name: t.name.replace("toe", "talon"),
      segments: 6,
      zone: ZONE.talon,
      capEnd: true,
      pin: "footL",
      mirror: true,
      stations: [
        { c: tip, rx: 0.0085, ry: 0.0085 },
        { c: [tip[0] + dx * 0.030, 0.012, tip[2] + dz * 0.030], rx: 0.005, ry: 0.005 },
        { c: [tip[0] + dx * 0.048, 0.001, tip[2] + dz * 0.048], rx: 0.0012, ry: 0.0012 },
      ],
    });
  }

  return lofts;
}

// ---- the loft itself --------------------------------------------------------------

// Unindexed, faceted: every triangle owns its three vertices, one flat
// normal, one flat color. The mottle — each facet brightening or dimming
// itself a few percent, keyed on its own index — is what makes low-poly read
// as plumage rather than plastic.
class GeoSink {
  positions: number[] = [];
  colors: number[] = [];
  components: { name: string; pin?: string; start: number; end: number }[] = [];
  private palette: THREE.Color[];
  private c = new THREE.Color();
  private face = 0;

  constructor() {
    this.palette = ZONE_COLORS.map((hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace));
  }

  begin(name: string, pin?: string): void {
    this.components.push({ name, pin, start: this.positions.length / 3, end: 0 });
  }
  finish(): void {
    const comp = this.components[this.components.length - 1];
    if (comp) comp.end = this.positions.length / 3;
  }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, zone: number): void {
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const mottle = 0.93 + 0.14 * hash1(this.face++);
    this.c.copy(this.palette[zone]).multiplyScalar(mottle);
    for (let k = 0; k < 3; k++) this.colors.push(this.c.r, this.c.g, this.c.b);
  }
}

const tangent = new THREE.Vector3();
const uAxis = new THREE.Vector3();
const vAxis = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

// ring vertices for one station: frame from the path tangent, u as close to
// world ±x as the tangent allows (keeps left/right symmetric), v completing it
function ringPoints(st: Station, prev: Station | null, next: Station | null, segments: number, flip: boolean, out: number[]): void {
  const a = prev ?? st, b = next ?? st;
  tangent.set(b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]);
  if (tangent.lengthSq() < 1e-10) tangent.set(0, 0, 1);
  tangent.normalize();
  uAxis.copy(X).addScaledVector(tangent, -tangent.x).normalize();
  if (uAxis.lengthSq() < 1e-6) uAxis.copy(Y).cross(tangent).normalize();
  vAxis.crossVectors(tangent, uAxis).normalize();
  if (vAxis.y < -0.7) vAxis.negate(); // keep "up" up so shape thetas stay honest
  out.length = 0;
  for (let s = 0; s < segments; s++) {
    const theta = (s / segments) * Math.PI * 2;
    const shape = st.shape ? st.shape(theta) : 1;
    const ca = Math.cos(theta) * st.rx * shape;
    const sa = Math.sin(theta) * st.ry * shape;
    const mx = flip ? -1 : 1;
    out.push(
      (st.c[0] + uAxis.x * ca + vAxis.x * sa) * mx,
      st.c[1] + uAxis.y * ca + vAxis.y * sa,
      st.c[2] + uAxis.z * ca + vAxis.z * sa,
    );
  }
}

function loftInto(sink: GeoSink, loft: Loft, flip: boolean): void {
  const pin = loft.pin && flip ? loft.pin.replace(/L$/, "R") : loft.pin;
  sink.begin(loft.name + (flip ? "-R" : ""), pin);
  const segs = loft.segments;
  const ringA: number[] = [];
  const ringB: number[] = [];
  let zone = loft.zone;

  // mirrored copies negate x, which reverses winding — swap two corners back
  const tri = (a: number[], b: number[], c: number[]): void => {
    if (flip) sink.tri(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], zone);
    else sink.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], zone);
  };
  const at = (ring: number[], s: number): number[] => [ring[s * 3], ring[s * 3 + 1], ring[s * 3 + 2]];

  const stations = loft.stations;
  ringPoints(stations[0], null, stations[1] ?? null, segs, flip, ringA);

  if (loft.capStart) {
    const c0 = stations[0].c;
    const center = [(flip ? -1 : 1) * c0[0], c0[1], c0[2]];
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      tri(center, at(ringA, s2), at(ringA, s)); // faces backward along the path
    }
  }

  for (let i = 1; i < stations.length; i++) {
    if (stations[i].zone !== undefined) zone = stations[i].zone!;
    ringPoints(stations[i], stations[i - 1], stations[i + 1] ?? null, segs, flip, ringB);
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      tri(at(ringA, s), at(ringA, s2), at(ringB, s2));
      tri(at(ringA, s), at(ringB, s2), at(ringB, s));
    }
    ringA.length = 0;
    ringA.push(...ringB);
  }

  if (loft.capEnd) {
    const cN = stations[stations.length - 1].c;
    const center = [(flip ? -1 : 1) * cN[0], cN[1], cN[2]];
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      tri(center, at(ringA, s), at(ringA, s2));
    }
  }
  sink.finish();
}

export interface BodyBuild {
  geometry: THREE.BufferGeometry;
  components: { name: string; pin?: string; start: number; end: number }[];
  vertexCount: number;
  triangleCount: number;
  buildMs: number;
}

export interface BodyOptions {
  bulk?: number; // scales every radius — the fluff dial
  lofts?: Loft[]; // override the parts list (the loft demo edits stations live)
}

export function buildEagleBody(opts: BodyOptions = {}): BodyBuild {
  const t0 = performance.now();
  const sink = new GeoSink();
  const lofts = opts.lofts ?? eagleLofts(opts.bulk ?? 1);
  for (const loft of lofts) {
    loftInto(sink, loft, false);
    if (loft.mirror) loftInto(sink, loft, true);
  }

  const positions = new Float32Array(sink.positions);
  const colors = new Float32Array(sink.colors);
  const nVerts = positions.length / 3;
  const normals = new Float32Array(nVerts * 3);
  // flat normals: one cross product per triangle, fixed to face outward later
  // by winding (the loft winds consistently; mirrored copies flip)
  for (let t = 0; t < nVerts / 3; t++) {
    const i = t * 9;
    const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      normals[i + k * 3] = nx;
      normals[i + k * 3 + 1] = ny;
      normals[i + k * 3 + 2] = nz;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  return {
    geometry,
    components: sink.components,
    vertexCount: nVerts,
    triangleCount: nVerts / 3,
    buildMs: performance.now() - t0,
  };
}

// ---- the face: riders, not loft -----------------------------------------------------
// The eyes are glossy spheres parented to where the head will be: a yellow
// iris, a black pupil, a white glint — under the brow ridge, which is what
// turns "bird" into "raptor". `pivot` re-bases the rest-pose world positions
// into a parent's local frame so part 2 can hang the face off the head joint.
export function addFace(parent: THREE.Object3D, pivot: [number, number, number] = [0, 0, 0]): void {
  const irisMat = new THREE.MeshStandardMaterial({ color: 0xeec43e, roughness: 0.25, flatShading: true });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.15 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x - pivot[0], y - pivot[1], z - pivot[2]);
    parent.add(m);
  };
  const iris = new THREE.IcosahedronGeometry(0.0165, 1);
  const pupil = new THREE.SphereGeometry(0.0085, 10, 8);
  const glint = new THREE.SphereGeometry(0.0035, 8, 6);
  for (const sx of [1, -1]) {
    add(iris, irisMat, sx * 0.062, 0.662, 0.318);
    add(pupil, pupilMat, sx * 0.068, 0.662, 0.326);
    add(glint, glintMat, sx * 0.071, 0.667, 0.331);
  }
}

// world-space anchor info other modules need (feather roots, the face pivot)
export function boneVec(name: string): THREE.Vector3 {
  const b = BIRD_BONES[BONE_INDEX.get(name)!];
  return new THREE.Vector3(...b.head);
}

// The raw rings of one loft, station by station — the part-1 demos draw
// these as hoops before any skin exists. Same code path the mesh uses.
export function loftRings(loft: Loft, flip = false): number[][] {
  const rings: number[][] = [];
  const scratch: number[] = [];
  for (let i = 0; i < loft.stations.length; i++) {
    ringPoints(loft.stations[i], loft.stations[i - 1] ?? null, loft.stations[i + 1] ?? null, loft.segments, flip, scratch);
    rings.push([...scratch]);
  }
  return rings;
}

// One loft as its own little faceted geometry (the loft demo stitches a
// single component live; the full build concatenates all of them).
export function buildLoftGeometry(loft: Loft): THREE.BufferGeometry {
  return buildEagleBody({ lofts: [{ ...loft, mirror: false }] }).geometry;
}
