// The bear as carpentry. No field, no marching: each chain of bones gets a
// tube of triangles lofted directly around it — a ring of vertices at every
// station along the chain, consecutive rings stitched with quads (two
// triangles each), hemispherical caps fanned onto the open ends. The belly is
// not a part at all; it is torso ring vertices pushed forward, which is the
// whole philosophy of mesh modeling in one move.

import { BONES, BONE_INDEX, boneLength } from "./skeleton";

export interface LoftOptions {
  sides?: number; // vertices per ring — the polygon budget knob
  rings?: number; // ring-density multiplier along the bones
  radiusScale?: number; // inflate/deflate the whole animal
  belly?: number; // how far the torso's front vertices get pushed (0 = ascetic bear)
}

export const LOFT_DEFAULTS = { sides: 10, rings: 1, radiusScale: 1, belly: 1 };

export interface PartGeometry {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  zones: Float32Array; // one color-zone id per vertex
  center: [number, number, number]; // rest centroid — the explode demo pulls on this
}

// ---- small vector kit (plain arrays; THREE never sees this file) ----------------

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Rodrigues rotation of v around unit axis k by angle.
function rotate(v: V3, k: V3, angle: number): V3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const kxv = cross(k, v);
  const kdv = dot(k, v) * (1 - c);
  return [
    v[0] * c + kxv[0] * s + k[0] * kdv,
    v[1] * c + kxv[1] * s + k[1] * kdv,
    v[2] * c + kxv[2] * s + k[2] * kdv,
  ];
}

// ---- stations: where the rings go ------------------------------------------------

interface Station {
  c: V3; // ring center
  t: V3; // chain tangent (unit) — the ring lies in the plane ⊥ t
  r: number; // ring radius
  zone: number;
}

// March down a chain of bones laying ring stations roughly every 0.11 units
// (× the rings option). Shared joints emit one station, not two — that single
// shared ring is what makes the tube continuous, and later lets the skin
// weights blend across the joint without a seam.
function chainStations(boneNames: string[], rings: number, radiusScale: number): Station[] {
  const stations: Station[] = [];
  for (let i = 0; i < boneNames.length; i++) {
    const b = BONES[BONE_INDEX.get(boneNames[i])!];
    const subdiv = Math.max(1, Math.round((boneLength(b) / 0.11) * rings));
    // Where the radius jumps at a joint (neck → skull, forearm → paw), the
    // shared miter ring keeps the *previous* radius — slip in one early ring
    // at the new bone's full radius so the mass reads (a skull, a mitt)
    // instead of a long cone.
    const prev = i > 0 ? BONES[BONE_INDEX.get(boneNames[i - 1])!] : null;
    if (prev && Math.abs(b.r0 - prev.r1) > 0.015 && subdiv === 1) {
      stations.push({ c: lerp(b.head, b.tail, 0.3), t: [0, 0, 0], r: b.r0 * radiusScale, zone: b.zone });
    }
    for (let k = i === 0 ? 0 : 1; k <= subdiv; k++) {
      const u = k / subdiv;
      stations.push({
        c: lerp(b.head, b.tail, u),
        t: [0, 0, 0], // filled below from neighbors
        r: (b.r0 + (b.r1 - b.r0) * u) * radiusScale,
        zone: b.zone,
      });
    }
  }
  // Central-difference tangents: at a joint the ring plane splits the angle
  // between the two bones (a miter joint, same as a picture frame).
  for (let i = 0; i < stations.length; i++) {
    const prev = stations[Math.max(0, i - 1)].c;
    const next = stations[Math.min(stations.length - 1, i + 1)].c;
    stations[i].t = norm(sub(next, prev));
  }
  return stations;
}

// ---- the loft itself --------------------------------------------------------------

// Optional radius modulation: given a station's height and the outward
// direction of one vertex, return a multiplier (1 = leave it alone) — this is
// how the belly happens. Vertices pushed past BELLY_ZONE_AT get the belly color.
type ShapeFn = (y: number, dirX: number, dirY: number, dirZ: number) => number;
const BELLY_ZONE_AT = 1.1;

interface TubeSpec {
  name: string;
  bones: string[];
  shape?: ShapeFn;
  shapeZone?: number; // zone for vertices the shape pushed out
  // Cap depth multipliers (1 = full hemisphere). Caps that live buried inside
  // another part get flattened so two near-parallel surfaces never sit close
  // enough to z-fight — the groin learned this the visible way.
  capStart?: number;
  capEnd?: number;
}

function emitTube(spec: TubeSpec, opts: Required<LoftOptions>): PartGeometry {
  const sides = Math.max(3, Math.round(opts.sides));
  const main = chainStations(spec.bones, opts.rings, opts.radiusScale);

  // Caps: two shrinking rings plus an apex on each end — a low-poly hemisphere.
  // Cap rings reuse the end station's frame so the stitching loop below
  // doesn't need to know caps exist.
  const CAP_RINGS = 2;
  const capRings = (s: Station, sign: 1 | -1, depth: number): Station[] => {
    const out: Station[] = [];
    for (let k = 1; k <= CAP_RINGS; k++) {
      const ang = (k / (CAP_RINGS + 1)) * (Math.PI / 2);
      out.push({
        c: add(s.c, scale(s.t, sign * Math.sin(ang) * s.r * 0.85 * depth)),
        t: s.t,
        r: s.r * Math.cos(ang),
        zone: s.zone,
      });
    }
    return out;
  };
  const dStart = spec.capStart ?? 1, dEnd = spec.capEnd ?? 1;
  const first = main[0], last = main[main.length - 1];
  const stations = [...capRings(first, -1, dStart).reverse(), ...main, ...capRings(last, 1, dEnd)];
  const apexStart: V3 = add(first.c, scale(first.t, -first.r * 0.92 * dStart));
  const apexEnd: V3 = add(last.c, scale(last.t, last.r * 0.92 * dEnd));

  // Frames by parallel transport: pick any normal for the first ring, then
  // carry it station to station with the minimal rotation between tangents —
  // no twist accumulates, so the tube never "candy-wraps".
  const frames: { n: V3; b: V3 }[] = [];
  {
    const t0 = stations[0].t;
    const ref: V3 = Math.abs(t0[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let n = norm(cross(ref, t0));
    frames.push({ n, b: cross(t0, n) });
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1].t, t = stations[i].t;
      const axis = cross(a, t);
      const l = len(axis);
      if (l > 1e-6) n = rotate(n, scale(axis, 1 / l), Math.asin(Math.min(1, l)));
      n = norm(sub(n, scale(t, dot(n, t)))); // re-orthogonalize against drift
      frames.push({ n, b: cross(t, n) });
    }
  }

  // Vertices: sides per ring, then the two apexes at the very end.
  const nRings = stations.length;
  const positions = new Float32Array((nRings * sides + 2) * 3);
  const zones = new Float32Array(nRings * sides + 2);
  let centroid: V3 = [0, 0, 0];
  for (let i = 0; i < nRings; i++) {
    const s = stations[i];
    const { n, b } = frames[i];
    for (let j = 0; j < sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const dx = Math.cos(th) * n[0] + Math.sin(th) * b[0];
      const dy = Math.cos(th) * n[1] + Math.sin(th) * b[1];
      const dz = Math.cos(th) * n[2] + Math.sin(th) * b[2];
      let r = s.r;
      let zone = s.zone;
      if (spec.shape) {
        const m = spec.shape(s.c[1], dx, dy, dz);
        r *= m;
        if (m > BELLY_ZONE_AT && spec.shapeZone !== undefined) zone = spec.shapeZone;
      }
      const v = i * sides + j;
      positions[v * 3] = s.c[0] + dx * r;
      positions[v * 3 + 1] = s.c[1] + dy * r;
      positions[v * 3 + 2] = s.c[2] + dz * r;
      zones[v] = zone;
      centroid = add(centroid, [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    }
  }
  const iApexStart = nRings * sides;
  const iApexEnd = nRings * sides + 1;
  positions.set(apexStart, iApexStart * 3);
  positions.set(apexEnd, iApexEnd * 3);
  zones[iApexStart] = first.zone;
  zones[iApexEnd] = last.zone;
  centroid = scale(centroid, 1 / (nRings * sides));

  // Triangles: a quad (two tris) per side per ring pair, plus the apex fans.
  // Winding is outward for the right-handed frames built above.
  const indices = new Uint32Array(((nRings - 1) * sides * 2 + sides * 2) * 3);
  let w = 0;
  for (let i = 0; i < nRings - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const a1 = i * sides + ((j + 1) % sides);
      const b = (i + 1) * sides + j;
      const b1 = (i + 1) * sides + ((j + 1) % sides);
      indices[w++] = a; indices[w++] = a1; indices[w++] = b;
      indices[w++] = a1; indices[w++] = b1; indices[w++] = b;
    }
  }
  for (let j = 0; j < sides; j++) {
    const j1 = (j + 1) % sides;
    indices[w++] = j1; indices[w++] = j; indices[w++] = iApexStart;
    const base = (nRings - 1) * sides;
    indices[w++] = base + j; indices[w++] = base + j1; indices[w++] = iApexEnd;
  }

  return { name: spec.name, positions, indices, zones, center: [centroid[0], centroid[1], centroid[2]] };
}

// ---- the bear's part list ----------------------------------------------------------

// smooth 0→1→0 bump over u ∈ [0, 1]
const bump = (u: number): number => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2);

export function buildParts(options: LoftOptions = {}): PartGeometry[] {
  const opts = { ...LOFT_DEFAULTS, ...options };

  // The belly: torso vertices facing forward (+z), at belly height, pushed
  // out by up to ~45%. A sculptor would call this "pulling the tummy"; the
  // mesh just calls it multiplying a radius.
  const belly: ShapeFn = (y, _dx, _dy, dz) =>
    1 + opts.belly * 0.45 * Math.max(0, dz) ** 1.4 * bump((y - 0.84) / 0.46);

  const specs: TubeSpec[] = [
    { name: "torso", bones: ["hips", "spine", "chest", "neck", "head"], shape: belly, shapeZone: 1, capStart: 0.85 },
    { name: "tail", bones: ["tail"], capStart: 0.4 },
    { name: "muzzle", bones: ["muzzle"], capStart: 0.4 },
    { name: "earL", bones: ["earL"], capStart: 0.5 },
    { name: "earR", bones: ["earR"], capStart: 0.5 },
    { name: "armL", bones: ["upperArmL", "forearmL", "handL"], capStart: 0.45 },
    { name: "armR", bones: ["upperArmR", "forearmR", "handR"], capStart: 0.45 },
    { name: "legL", bones: ["thighL", "shinL", "footL"], capStart: 0.45 },
    { name: "legR", bones: ["thighR", "shinR", "footR"], capStart: 0.45 },
  ];

  return specs.map((s) => emitTube(s, opts));
}
