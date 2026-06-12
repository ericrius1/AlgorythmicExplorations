// The eagle's one source of truth: a table of bones. Each row is a segment —
// a pivot, a far end, a thickness — and the same table drives everything in
// this series: the lofted body mesh wraps rings around these segments (part
// 1), the skin weights ask "which bone is this vertex near" (part 2), the
// wing-fold IK reads segment lengths to unfold the Z hiding under the plumage
// (part 3), and the flight poses build on all of it (part 4 onward). Change a
// number here and the bird is re-lofted, re-rigged, and re-flown to match.

export interface BirdBone {
  name: string;
  parent: string | null; // joint hierarchy
  head: [number, number, number]; // joint pivot, rest pose, world space
  tail: [number, number, number]; // segment far end
  r0: number; // flesh radius at head — used by skin weights
  r1: number; // flesh radius at tail
  zone: number; // color zone (see ZONES)
}

// Color zones, baked per-vertex at loft time.
export const ZONES = ["body", "head", "wing", "tail", "beak", "leg", "talon"] as const;
export const ZONE = {
  body: 0,
  head: 1,
  wing: 2,
  tail: 3,
  beak: 4,
  leg: 5,
  talon: 6,
} as const;

// The eagle perches on the origin: y up, facing +z, wings folded. Around
// 0.95 units beak-to-tail — call them meters, she's a big bird. The folded
// wing is a Z: humerus swept back and down, forearm forward and up to the
// wrist, hand swept back again along the body toward the tail.
interface RawBone {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
  r0: number;
  r1?: number;
  zone?: number;
}

const CORE: RawBone[] = [
  // -- the torso: rump to chest, the keel the whole bird hangs from ---------------
  { name: "body", parent: null, head: [0, 0.46, -0.12], tail: [0, 0.51, 0.16], r0: 0.155, r1: 0.135 },

  // -- neck and head: an eagle carries its head forward, hunched into the
  //    shoulders when perched, periscoped up when alert ---------------------------
  { name: "neck", parent: "body", head: [0, 0.54, 0.18], tail: [0, 0.62, 0.25], r0: 0.085, r1: 0.075, zone: 1 },
  { name: "head", parent: "neck", head: [0, 0.62, 0.25], tail: [0, 0.685, 0.33], r0: 0.092, r1: 0.08, zone: 1 },
  { name: "beak", parent: "head", head: [0, 0.675, 0.365], tail: [0, 0.63, 0.475], r0: 0.034, r1: 0.007, zone: 4 },

  // -- the tail: carried level-ish, a hand of feathers fanning off this bone ------
  { name: "tailFan", parent: "body", head: [0, 0.45, -0.20], tail: [0, 0.40, -0.52], r0: 0.045, r1: 0.02, zone: 3 },
];

const LEFT: RawBone[] = [
  // -- folded wing (x > 0 = eagle's left): the Z pressed against the body ---------
  { name: "humerusL", parent: "body", head: [0.135, 0.535, 0.10], tail: [0.185, 0.50, -0.10], r0: 0.06, r1: 0.05, zone: 2 },
  { name: "forearmL", parent: "humerusL", head: [0.185, 0.50, -0.10], tail: [0.155, 0.53, 0.16], r0: 0.05, r1: 0.04, zone: 2 },
  { name: "handL", parent: "forearmL", head: [0.155, 0.53, 0.16], tail: [0.115, 0.50, -0.18], r0: 0.035, r1: 0.015, zone: 2 },

  // -- leg: feathered trousers down to the bare yellow tarsus and the toes --------
  { name: "thighL", parent: "body", head: [0.065, 0.40, 0.0], tail: [0.085, 0.22, 0.03], r0: 0.062, r1: 0.038 },
  { name: "tarsusL", parent: "thighL", head: [0.085, 0.22, 0.03], tail: [0.095, 0.055, 0.05], r0: 0.024, r1: 0.02, zone: 5 },
  { name: "footL", parent: "tarsusL", head: [0.095, 0.055, 0.05], tail: [0.10, 0.012, 0.14], r0: 0.018, r1: 0.012, zone: 5 },
];

function mirror(b: RawBone): RawBone {
  const flip = (v: [number, number, number]): [number, number, number] => [-v[0], v[1], v[2]];
  return {
    ...b,
    name: b.name.slice(0, -1) + "R",
    parent: b.parent && /L$/.test(b.parent) ? b.parent.slice(0, -1) + "R" : b.parent,
    head: flip(b.head),
    tail: flip(b.tail),
  };
}

function finish(b: RawBone): BirdBone {
  return {
    name: b.name,
    parent: b.parent ?? null,
    head: b.head,
    tail: b.tail,
    r0: b.r0,
    r1: b.r1 ?? b.r0,
    zone: b.zone ?? 0,
  };
}

export const BIRD_BONES: BirdBone[] = [...CORE, ...LEFT, ...LEFT.map(mirror)].map(finish);

export const BONE_INDEX = new Map(BIRD_BONES.map((b, i) => [b.name, i]));

export function boneLength(b: BirdBone): number {
  const dx = b.tail[0] - b.head[0];
  const dy = b.tail[1] - b.head[1];
  const dz = b.tail[2] - b.head[2];
  return Math.hypot(dx, dy, dz);
}

// Distance from a point to a bone's segment, minus the lerped flesh radius —
// negative inside the flesh, positive outside. This is the question the skin
// weights ask for every (vertex, bone) pair, and the zone painter asks for
// every vertex. (It used to be the modeling primitive too, back when the bird
// was a distance field; now the mesh is lofted directly and this survives
// purely as the rigging metric.)
export function boneDistance(b: BirdBone, px: number, py: number, pz: number): number {
  const ax = b.head[0], ay = b.head[1], az = b.head[2];
  const bax = b.tail[0] - ax, bay = b.tail[1] - ay, baz = b.tail[2] - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  let h = l2 > 1e-12 ? (pax * bax + pay * bay + paz * baz) / l2 : 0;
  h = Math.max(0, Math.min(1, h));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.hypot(dx, dy, dz) - (b.r0 + (b.r1 - b.r0) * h);
}
