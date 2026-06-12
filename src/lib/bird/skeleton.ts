// The wren's one source of truth: a list of capsules. The same table drives
// everything in this series — the modeling field (part 1 blends these capsules
// into a body), the skin weights (part 2 asks "which capsule is this vertex
// near"), the wing-fold IK (part 3 unfolds the Z hiding under the plumage),
// and the flight poses (part 4 onward). Change a number here and the bird is
// re-sculpted, re-rigged, and re-flown to match.

export interface BirdBone {
  name: string;
  parent: string | null; // joint hierarchy (deform bones only)
  head: [number, number, number]; // joint pivot, rest pose, world space
  tail: [number, number, number]; // capsule far end
  r0: number; // radius at head
  r1: number; // radius at tail
  zone: number; // color zone (see ZONES)
  deform: boolean; // true = a real joint; false = shape-only blob
  blend: number; // smooth-union k against the rest of the body
  // Feathers are panels, not sausages: an optional squash that thins the
  // capsule along one world axis (s = thickness scale, 1 = round).
  flat?: { axis: [number, number, number]; s: number };
}

// Color zones, baked per-vertex at mesh time.
export const ZONES = ["body", "belly", "wing", "tail", "beak", "brow", "leg"] as const;

// The wren perches on the origin: y up, facing +z, tail cocked the way wrens
// insist on. About 0.9 units beak-to-tail — she is small in real life too.
interface RawBone {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
  r0: number;
  r1?: number;
  zone?: number;
  deform?: boolean;
  blend?: number;
  flat?: { axis: [number, number, number]; s: number };
}

const CORE: RawBone[] = [
  // -- the egg ---------------------------------------------------------------------
  { name: "body", parent: null, head: [0, 0.40, -0.16], tail: [0, 0.46, 0.12], r0: 0.155, r1: 0.145, blend: 0.10 },
  { name: "breast", parent: null, head: [0, 0.36, 0.04], tail: [0, 0.42, 0.13], r0: 0.125, r1: 0.105, zone: 1, deform: false, blend: 0.10 },

  // -- neck and head ---------------------------------------------------------------
  { name: "neck", parent: "body", head: [0, 0.50, 0.10], tail: [0, 0.56, 0.15], r0: 0.085, r1: 0.08, blend: 0.07 },
  { name: "head", parent: "neck", head: [0, 0.56, 0.15], tail: [0, 0.62, 0.20], r0: 0.105, r1: 0.095, blend: 0.05 },
  { name: "beak", parent: "head", head: [0, 0.585, 0.27], tail: [0, 0.563, 0.40], r0: 0.027, r1: 0.005, zone: 4, blend: 0.012 },

  // -- the famous tail, cocked at fifty degrees -------------------------------------
  // A fan, not a rod: wide at the tip, thinned to a blade perpendicular to its
  // own axis (the flatten axis is the YZ-perpendicular of the bone direction).
  { name: "tailFan", parent: "body", head: [0, 0.44, -0.18], tail: [0, 0.62, -0.42], r0: 0.035, r1: 0.07, zone: 3, blend: 0.04, flat: { axis: [0, 0.8, 0.6], s: 0.3 } },
];

const LEFT: RawBone[] = [
  // -- folded wing (x > 0 = wren's left): a Z pressed flat against the body --------
  { name: "humerusL", parent: "body", head: [0.13, 0.50, 0.08], tail: [0.165, 0.46, -0.04], r0: 0.065, r1: 0.05, zone: 2, blend: 0.05, flat: { axis: [1, 0, 0], s: 0.55 } },
  { name: "forearmL", parent: "humerusL", head: [0.165, 0.46, -0.04], tail: [0.14, 0.485, -0.17], r0: 0.05, r1: 0.04, zone: 2, blend: 0.04, flat: { axis: [1, 0, 0], s: 0.5 } },
  { name: "handL", parent: "forearmL", head: [0.14, 0.485, -0.17], tail: [0.10, 0.50, -0.33], r0: 0.038, r1: 0.012, zone: 2, blend: 0.03, flat: { axis: [1, 0, 0], s: 0.45 } },

  // -- leg: a feathered thigh, then the bare stick birds actually stand on ---------
  { name: "thighL", parent: "body", head: [0.06, 0.38, -0.02], tail: [0.075, 0.20, 0.0], r0: 0.05, r1: 0.032, blend: 0.05 },
  { name: "tarsusL", parent: "thighL", head: [0.075, 0.20, 0.0], tail: [0.08, 0.045, 0.02], r0: 0.022, r1: 0.019, zone: 6, blend: 0.012 },
  { name: "footL", parent: "tarsusL", head: [0.08, 0.045, 0.02], tail: [0.085, 0.01, 0.10], r0: 0.017, r1: 0.011, zone: 6, blend: 0.01 },
  { name: "halluxL", parent: null, head: [0.08, 0.045, 0.02], tail: [0.075, 0.01, -0.045], r0: 0.015, r1: 0.009, zone: 6, deform: false, blend: 0.01 },

  // -- the supercilium: the pale eyebrow that makes a wren look permanently alert --
  { name: "browL", parent: null, head: [0.075, 0.625, 0.235], tail: [0.092, 0.605, 0.16], r0: 0.018, r1: 0.014, zone: 5, deform: false, blend: 0.015 },
];

function mirror(b: RawBone): RawBone {
  const flip = (v: [number, number, number]): [number, number, number] => [-v[0], v[1], v[2]];
  return {
    ...b,
    name: b.name.slice(0, -1) + "R",
    parent: b.parent && /L$/.test(b.parent) ? b.parent.slice(0, -1) + "R" : b.parent,
    head: flip(b.head),
    tail: flip(b.tail),
    flat: b.flat ? { axis: flip(b.flat.axis), s: b.flat.s } : undefined,
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
    deform: b.deform ?? true,
    blend: b.blend ?? 0.05,
    flat: b.flat,
  };
}

export const BIRD_BONES: BirdBone[] = [...CORE, ...LEFT, ...LEFT.map(mirror)].map(finish);

export const BONE_INDEX = new Map(BIRD_BONES.map((b, i) => [b.name, i]));

// The joints, in parents-first order (the table is written that way), so one
// forward pass computes every world matrix. Part 2's skeleton and skin
// weights index bones by this list, not by BIRD_BONES.
export const DEFORM_BONES: BirdBone[] = BIRD_BONES.filter((b) => b.deform);

export const DEFORM_INDEX = new Map(DEFORM_BONES.map((b, i) => [b.name, i]));

// Shape-only blobs attach to a deform bone so they will follow the skeleton
// when part 2 makes it move.
export const SHAPE_PARENT: Record<string, string> = {
  breast: "body",
  browL: "head",
  browR: "head",
  halluxL: "footL",
  halluxR: "footR",
};

export function boneLength(b: BirdBone): number {
  const dx = b.tail[0] - b.head[0];
  const dy = b.tail[1] - b.head[1];
  const dz = b.tail[2] - b.head[2];
  return Math.hypot(dx, dy, dz);
}
