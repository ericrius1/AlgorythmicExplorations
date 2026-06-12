// The bear's one source of truth: a list of capsules. The same table drives
// everything in this series — the modeling field (part 1 blends these capsules
// into a body), the skin weights (part 2 asks "which capsule is this vertex
// near"), the IK chains (part 3 reads segment lengths from it), and the pose
// library (part 4 rotates its joints). Change a number here and the bear is
// re-sculpted, re-rigged, and re-animated to match.

export interface BoneDef {
  name: string;
  parent: string | null; // joint hierarchy (deform bones only)
  head: [number, number, number]; // joint pivot, rest pose, world space
  tail: [number, number, number]; // capsule far end
  r0: number; // radius at head
  r1: number; // radius at tail
  zone: number; // color zone (see ZONES)
  deform: boolean; // true = a real joint; false = shape-only blob
  blend: number; // smooth-union k against the rest of the body
}

// Color zones, baked per-vertex at mesh time, palette applied in the shader.
export const ZONES = ["body", "belly", "muzzle", "ear", "paw", "foot", "tail"] as const;

// The bear stands upright (a qi gong practitioner, after all): y up, facing +z,
// about 1.7 units tall. Mirrored limbs are generated below.
const S = 1.0; // global scale knob

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
}

const CORE: RawBone[] = [
  // -- torso column -------------------------------------------------------------
  { name: "hips", parent: null, head: [0, 0.92, 0], tail: [0, 1.06, 0.01], r0: 0.21, r1: 0.22, blend: 0.10 },
  { name: "spine", parent: "hips", head: [0, 1.06, 0.01], tail: [0, 1.24, 0.015], r0: 0.215, r1: 0.205, blend: 0.10 },
  { name: "chest", parent: "spine", head: [0, 1.24, 0.015], tail: [0, 1.4, 0.0], r0: 0.20, r1: 0.165, blend: 0.09 },
  { name: "neck", parent: "chest", head: [0, 1.4, 0.0], tail: [0, 1.49, 0.025], r0: 0.115, r1: 0.105, blend: 0.07 },
  { name: "head", parent: "neck", head: [0, 1.49, 0.025], tail: [0, 1.62, 0.03], r0: 0.155, r1: 0.145, blend: 0.05 },
  { name: "tail", parent: "hips", head: [0, 0.95, -0.19], tail: [0, 0.99, -0.27], r0: 0.075, r1: 0.05, zone: 6, blend: 0.05 },

  // -- shape-only blobs (no joints; they ride whatever deform bone is nearest) ---
  { name: "belly", parent: null, head: [0, 0.98, 0.06], tail: [0, 1.16, 0.05], r0: 0.235, r1: 0.21, zone: 1, deform: false, blend: 0.12 },
  { name: "muzzle", parent: null, head: [0, 1.56, 0.16], tail: [0, 1.55, 0.235], r0: 0.075, r1: 0.058, zone: 2, deform: false, blend: 0.035 },
  { name: "browL", parent: null, head: [0.055, 1.64, 0.115], tail: [0.055, 1.645, 0.12], r0: 0.045, deform: false, blend: 0.05 },
  { name: "browR", parent: null, head: [-0.055, 1.64, 0.115], tail: [-0.055, 1.645, 0.12], r0: 0.045, deform: false, blend: 0.05 },
];

const LEFT: RawBone[] = [
  // -- arm (x > 0 = bear's left) -------------------------------------------------
  { name: "upperArmL", parent: "chest", head: [0.205, 1.345, 0.0], tail: [0.295, 1.09, 0.02], r0: 0.095, r1: 0.075, blend: 0.06 },
  { name: "forearmL", parent: "upperArmL", head: [0.295, 1.09, 0.02], tail: [0.33, 0.875, 0.045], r0: 0.07, r1: 0.06, blend: 0.045 },
  { name: "handL", parent: "forearmL", head: [0.33, 0.875, 0.045], tail: [0.345, 0.78, 0.07], r0: 0.082, r1: 0.062, zone: 4, blend: 0.035 },

  // -- leg -----------------------------------------------------------------------
  { name: "thighL", parent: "hips", head: [0.115, 0.94, 0.0], tail: [0.15, 0.52, 0.005], r0: 0.135, r1: 0.10, blend: 0.09 },
  { name: "shinL", parent: "thighL", head: [0.15, 0.52, 0.005], tail: [0.16, 0.16, -0.015], r0: 0.095, r1: 0.078, blend: 0.05 },
  { name: "footL", parent: "shinL", head: [0.16, 0.16, -0.015], tail: [0.165, 0.075, 0.135], r0: 0.085, r1: 0.083, zone: 5, blend: 0.04 },

  // -- ear (shape-only) ------------------------------------------------------------
  { name: "earL", parent: null, head: [0.105, 1.715, 0.0], tail: [0.125, 1.755, -0.005], r0: 0.062, r1: 0.05, zone: 3, deform: false, blend: 0.03 },
];

function mirror(b: RawBone): RawBone {
  const flip = (v: [number, number, number]): [number, number, number] => [-v[0], v[1], v[2]];
  return { ...b, name: b.name.slice(0, -1) + "R", parent: b.parent && /L$/.test(b.parent) ? b.parent.slice(0, -1) + "R" : b.parent, head: flip(b.head), tail: flip(b.tail) };
}

function finish(b: RawBone): BoneDef {
  const s = (v: [number, number, number]): [number, number, number] => [v[0] * S, v[1] * S, v[2] * S];
  return {
    name: b.name,
    parent: b.parent ?? null,
    head: s(b.head),
    tail: s(b.tail),
    r0: b.r0 * S,
    r1: (b.r1 ?? b.r0) * S,
    zone: b.zone ?? 0,
    deform: b.deform ?? true,
    blend: (b.blend ?? 0.06) * S,
  };
}

export const BONES: BoneDef[] = [...CORE, ...LEFT, ...LEFT.map(mirror)].map(finish);

export const BONE_INDEX = new Map(BONES.map((b, i) => [b.name, i]));

// Deform bones in a stable order — this is the order of the skin matrices
// uniform array, of the weight attributes, and of every pose table.
export const DEFORM_BONES = BONES.filter((b) => b.deform);
export const DEFORM_INDEX = new Map(DEFORM_BONES.map((b, i) => [b.name, i]));

// Shape-only blobs attach to a deform bone so they follow the skeleton: the
// ears and brows ride the head, the belly rides the spine, etc.
export const SHAPE_PARENT: Record<string, string> = {
  belly: "spine",
  muzzle: "head",
  browL: "head",
  browR: "head",
  earL: "head",
  earR: "head",
};

export function boneLength(b: BoneDef): number {
  const dx = b.tail[0] - b.head[0];
  const dy = b.tail[1] - b.head[1];
  const dz = b.tail[2] - b.head[2];
  return Math.hypot(dx, dy, dz);
}
