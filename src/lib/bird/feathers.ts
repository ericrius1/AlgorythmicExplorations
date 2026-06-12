// Feathers. The wren this series used to star was a skinned blob with wing-
// shaped bulges; the eagle gets the real thing: every flight feather is its
// own little mesh — a tent-folded, tapered plane — hung on the wing skeleton
// like a louver. Primaries off the hand (the outer six emarginated into the
// fingers every soaring raptor shows), secondaries off the forearm, covert
// rows shingled over their bases, an alula at the wrist, twelve rectrices
// fanning off the tail bone. None of them are skinned: each is a rigid
// instance whose matrix is recomputed every frame from its bone, a fan
// angle, a louver cant, and the stroke's lag — which is why the wing can
// fold, spread, splay, and let air through the slots like a live one.

import * as THREE from "three/webgpu";
import { BIRD_BONES, BONE_INDEX, boneLength, type BirdBone } from "./skeleton";

// ---- one feather, as geometry -------------------------------------------------------

export interface FeatherShape {
  rows?: number; // segments along the shaft
  peak?: number; // where the vane is widest (fraction of length)
  baseW?: number; // width at the calamus, fraction of max width
  fold?: number; // tent-ridge height, fraction of half-width
  droop?: number; // tip sag, fraction of length
  emarginate?: number; // 0 = none; else the narrow tip's width fraction
  tip?: "round" | "point" | "square";
}

// Unit feather: base at origin, shaft along +z (length 1), vane across x
// (max half-width 0.5 before per-instance width scaling), ridge up +y.
// Vertex colors carry the pale shaft and the darker vane edge; the per-
// instance color multiplies on top.
export function makeFeatherGeometry(shape: FeatherShape = {}): THREE.BufferGeometry {
  const rows = shape.rows ?? 5;
  const peak = shape.peak ?? 0.42;
  const baseW = shape.baseW ?? 0.42;
  const fold = shape.fold ?? 0.5;
  const droop = shape.droop ?? 0.1;
  const emarginate = shape.emarginate ?? 0;
  const tip = shape.tip ?? "round";

  const half = (t: number): number => {
    // grow from the calamus to the peak, then taper
    let h = t < peak ? baseW + (1 - baseW) * Math.sin((t / peak) * Math.PI * 0.5) : 1;
    if (emarginate > 0 && t > 0.55) {
      // the notch: the vane steps down to a narrow finger
      const k = THREE.MathUtils.smoothstep(t, 0.55, 0.72);
      h *= 1 - (1 - emarginate) * k;
    }
    const tipStart = tip === "square" ? 0.9 : 0.72;
    if (t > tipStart) {
      const u = (t - tipStart) / (1 - tipStart);
      if (tip === "round") h *= Math.sqrt(Math.max(0, 1 - u * u));
      else if (tip === "point") h *= 1 - u * 0.92;
      else h *= 1 - u * u * 0.55; // square-ish, softly broken corner
    }
    return 0.5 * Math.max(h, 0.02);
  };

  const pos: number[] = [];
  const col: number[] = [];
  const xs = [-1, -0.45, 0, 0.45, 1];
  const ridgeY = [0, 0.62, 1, 0.62, 0];
  const shade = [0.82, 0.95, 1.18, 0.95, 0.82]; // pale rachis, darker edges
  const row = (t: number): number[][] => {
    const h = half(t);
    const sag = -droop * t * t;
    return xs.map((x, i) => [x * h, ridgeY[i] * fold * h * 0.55 + sag, t]);
  };

  let prev = row(0);
  for (let r = 1; r <= rows; r++) {
    const t = r / rows;
    const cur = row(t);
    for (let i = 0; i < 4; i++) {
      const a = prev[i], b = prev[i + 1], c = cur[i + 1], d = cur[i];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      const sa = shade[i], sb = shade[i + 1];
      col.push(sa, sa, sa, sb, sb, sb, sb, sb, sb, sa, sa, sa, sb, sb, sb, sa, sa, sa);
    }
    prev = cur;
  }

  const positions = new Float32Array(pos);
  const colors = new Float32Array(col.length).fill(0);
  for (let i = 0; i < col.length; i++) colors[i] = col[i];
  const nVerts = positions.length / 3;
  const normals = new Float32Array(nVerts * 3);
  for (let t = 0; t < nVerts / 3; t++) {
    const i = t * 9;
    const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      normals[i + k * 3] = nx; normals[i + k * 3 + 1] = ny; normals[i + k * 3 + 2] = nz;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ---- where every feather goes -------------------------------------------------------

export const FEATHER_CLASSES = ["primary", "secondary", "covert", "alula", "scapular", "rectrix"] as const;
export type FeatherClass = (typeof FEATHER_CLASSES)[number];

export interface FeatherSlot {
  cls: FeatherClass;
  bone: string;
  t: number; // anchor along the bone segment
  fanFolded: number; // radians from the bone direction, wing folded
  fanSpread: number; // radians at full span
  len: number;
  width: number;
  cant: number; // louver pitch about the shaft, radians
  lift: number; // stacking offset along the wing normal
  splayW: number; // how much extra fan this feather takes during a flare
  lagW: number; // how much stroke lag bends this feather's angle
  slotW: number; // how far this feather feathers open on the upstroke
  color: THREE.Color;
}

const dark = (l: number): THREE.Color => new THREE.Color().setHSL(0.075, 0.32, l);
const white = (l: number): THREE.Color => new THREE.Color().setHSL(0.10, 0.18, l);

function wingSlots(side: "L" | "R"): FeatherSlot[] {
  const slots: FeatherSlot[] = [];
  const hash = (n: number): number => {
    const s = Math.sin(n * 91.7 + 47.3) * 9871.23;
    return s - Math.floor(s);
  };

  // primaries: ten per hand, P1 innermost. Fan convention: 0 rad points along
  // the bone toward the tip; positive sweeps back toward the trailing edge.
  for (let i = 0; i < 10; i++) {
    const u = i / 9; // 0 = inner, 1 = outermost
    const peakLen = 1 - Math.pow(Math.abs(u - 0.75) / 0.75, 1.6) * 0.42;
    slots.push({
      cls: "primary",
      bone: "hand" + side,
      t: 0.12 + u * 0.84,
      fanFolded: 0.06 + u * 0.10,
      fanSpread: 1.18 - u * 1.04, // inner trails back hard, outer reaches out
      len: 0.30 + peakLen * 0.235,
      width: 0.062 + 0.012 * (1 - u),
      cant: 0.10 + u * 0.05,
      lift: 0.0035 * i,
      splayW: u * u,
      lagW: 0.35 + u * 0.65,
      slotW: u > 0.35 ? (u - 0.35) / 0.65 : 0,
      color: dark(0.16 + 0.05 * hash(i * 3 + (side === "L" ? 0 : 50))),
    });
  }
  // secondaries: a dozen along the forearm, all trailing back toward the body
  for (let i = 0; i < 12; i++) {
    const u = i / 11; // 0 at the wrist end, 1 at the elbow end
    slots.push({
      cls: "secondary",
      bone: "forearm" + side,
      t: 0.92 - u * 0.80,
      fanFolded: 0.10 + u * 0.05,
      fanSpread: 1.62 - u * 0.30,
      len: 0.285 - u * 0.035,
      width: 0.082,
      cant: 0.12,
      lift: 0.0030 * i,
      splayW: 0,
      lagW: 0.18,
      slotW: 0,
      color: dark(0.17 + 0.05 * hash(i * 7 + 11 + (side === "L" ? 0 : 50))),
    });
  }
  // greater coverts shingled over the secondary bases, median row above them
  for (let i = 0; i < 11; i++) {
    const u = i / 10;
    slots.push({
      cls: "covert",
      bone: "forearm" + side,
      t: 0.92 - u * 0.80,
      fanFolded: 0.12 + u * 0.05,
      fanSpread: 1.55 - u * 0.28,
      len: 0.145,
      width: 0.062,
      cant: 0.18,
      lift: 0.006 + 0.0028 * i,
      splayW: 0,
      lagW: 0.1,
      slotW: 0,
      color: dark(0.24 + 0.06 * hash(i * 13 + 23 + (side === "L" ? 0 : 50))),
    });
  }
  for (let i = 0; i < 8; i++) {
    const u = i / 7;
    slots.push({
      cls: "covert",
      bone: "forearm" + side,
      t: 0.88 - u * 0.72,
      fanFolded: 0.14 + u * 0.05,
      fanSpread: 1.42 - u * 0.24,
      len: 0.095,
      width: 0.052,
      cant: 0.24,
      lift: 0.011 + 0.0026 * i,
      splayW: 0,
      lagW: 0.06,
      slotW: 0,
      color: dark(0.28 + 0.07 * hash(i * 17 + 41 + (side === "L" ? 0 : 50))),
    });
  }
  // hand coverts over the primary bases
  for (let i = 0; i < 7; i++) {
    const u = i / 6;
    slots.push({
      cls: "covert",
      bone: "hand" + side,
      t: 0.12 + u * 0.70,
      fanFolded: 0.08 + u * 0.08,
      fanSpread: 1.0 - u * 0.82,
      len: 0.12,
      width: 0.055,
      cant: 0.20,
      lift: 0.008 + 0.0028 * i,
      splayW: u * 0.3,
      lagW: 0.15,
      slotW: 0,
      color: dark(0.25 + 0.06 * hash(i * 19 + 67 + (side === "L" ? 0 : 50))),
    });
  }
  // the alula: the bird's thumb, three stiff little feathers at the wrist —
  // pops up at high angle of attack like a leading-edge slat. Negative fan:
  // it hugs the leading edge, slightly ahead of the bone.
  for (let i = 0; i < 3; i++) {
    slots.push({
      cls: "alula",
      bone: "hand" + side,
      t: 0.04,
      fanFolded: -(0.04 + i * 0.05),
      fanSpread: -(0.10 + i * 0.09),
      len: 0.10 + i * 0.018,
      width: 0.034,
      cant: -0.25 - i * 0.06,
      lift: 0.004 + 0.004 * i,
      splayW: -0.4, // a flare pops it forward, like the slat it is
      lagW: 0.2,
      slotW: 0,
      color: dark(0.20),
    });
  }
  // scapulars: four broad feathers smoothing the wing root into the back
  for (let i = 0; i < 4; i++) {
    const u = i / 3;
    slots.push({
      cls: "scapular",
      bone: "humerus" + side,
      t: 0.15 + u * 0.7,
      fanFolded: 0.12 + u * 0.10,
      fanSpread: 0.7 + u * 0.35,
      len: 0.17 - u * 0.02,
      width: 0.075,
      cant: 0.3,
      lift: 0.012 + 0.004 * i,
      splayW: 0,
      lagW: 0.05,
      slotW: 0,
      color: dark(0.27 + 0.05 * hash(i * 29 + 5 + (side === "L" ? 0 : 50))),
    });
  }
  return slots;
}

function tailSlots(): FeatherSlot[] {
  const slots: FeatherSlot[] = [];
  for (let i = 0; i < 12; i++) {
    const u = (i - 5.5) / 5.5; // -1 .. 1 across the fan
    slots.push({
      cls: "rectrix",
      bone: "tailFan",
      t: 0.25,
      fanFolded: u * 0.10,
      fanSpread: u * 1.05,
      len: 0.40 - Math.abs(u) * 0.045,
      width: 0.085,
      cant: u * 0.10,
      lift: (1 - Math.abs(u)) * 0.009, // center stacks on top
      splayW: 0,
      lagW: 0,
      slotW: 0,
      color: white(0.88 - 0.04 * Math.abs(u)),
    });
  }
  return slots;
}

export function allFeatherSlots(): FeatherSlot[] {
  return [...wingSlots("L"), ...wingSlots("R"), ...tailSlots()];
}

// ---- the coat: instanced classes, posed every frame ----------------------------------

export interface CoatPose {
  spread: number; // 0 folded .. 1 full span (matches the wing IK's unfold)
  tailSpread: number; // 0 .. 1
  splay: number; // extra fan for flare / soaring fingers
  slot: number; // 0 closed .. 1 feathered open (the upstroke trick)
  lagL: number; // signed stroke lag, radians — bends the primary fan
  lagR: number;
}

export const COAT_POSE_REST: CoatPose = { spread: 0, tailSpread: 0.15, splay: 0, slot: 0, lagL: 0, lagR: 0 };

interface SlotRuntime extends FeatherSlot {
  anchorLocal: THREE.Vector3; // in bone-local (rest) space
  span: THREE.Vector3; // bone direction, rest
  normal: THREE.Vector3; // wing-blade normal, rest (out of the upper surface)
  boneIdx: number;
}

const SHAPES: Record<FeatherClass, FeatherShape> = {
  primary: { emarginate: 0.34, tip: "point", droop: 0.07, fold: 0.55 },
  secondary: { tip: "round", droop: 0.12, peak: 0.5, fold: 0.5 },
  covert: { tip: "round", droop: 0.16, peak: 0.55, baseW: 0.55, fold: 0.45 },
  alula: { tip: "point", droop: 0.04, rows: 3, fold: 0.6 },
  scapular: { tip: "round", droop: 0.2, peak: 0.6, baseW: 0.6, fold: 0.4 },
  rectrix: { tip: "square", droop: 0.05, peak: 0.3, baseW: 0.62, fold: 0.4 },
};

export class FeatherCoat {
  readonly group = new THREE.Group();
  private byClass = new Map<FeatherClass, { mesh: THREE.InstancedMesh; slots: SlotRuntime[] }>();
  private m = new THREE.Matrix4();
  private mBasis = new THREE.Matrix4();
  private shaft = new THREE.Vector3();
  private up = new THREE.Vector3();
  private sideV = new THREE.Vector3();
  private upScaled = new THREE.Vector3();
  private shaftScaled = new THREE.Vector3();
  private pos = new THREE.Vector3();

  constructor(material?: THREE.Material) {
    const mat =
      material ??
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        side: THREE.DoubleSide,
        flatShading: true,
      });

    const slots = allFeatherSlots();
    for (const cls of FEATHER_CLASSES) {
      const mine = slots.filter((s) => s.cls === cls);
      if (!mine.length) continue;
      const runtime: SlotRuntime[] = mine.map((s) => {
        const bone = BIRD_BONES[BONE_INDEX.get(s.bone)!];
        const span = boneDir(bone);
        // rest blade normal: wings lie flat against the body, blade facing
        // outward (±x); the tail blade faces up.
        const sign = /R$/.test(s.bone) ? -1 : 1;
        const normal =
          s.bone === "tailFan"
            ? new THREE.Vector3(0, 1, 0).addScaledVector(span, -span.y).normalize()
            : new THREE.Vector3(sign, 0, 0).addScaledVector(span, -span.x * sign).normalize();
        const len = boneLength(bone);
        const anchorLocal = span.clone().multiplyScalar(len * s.t);
        return { ...s, anchorLocal, span, normal, boneIdx: BONE_INDEX.get(s.bone)! };
      });
      const mesh = new THREE.InstancedMesh(makeFeatherGeometry(SHAPES[cls]), mat, runtime.length);
      mesh.frustumCulled = false;
      for (let i = 0; i < runtime.length; i++) mesh.setColorAt(i, runtime[i].color);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.byClass.set(cls, { mesh, slots: runtime });
    }
  }

  get featherCount(): number {
    let n = 0;
    for (const { slots } of this.byClass.values()) n += slots.length;
    return n;
  }

  // Recompute every instance matrix from the rig's current bone matrices.
  // Each feather: anchor on its bone, fan about the wing normal, cant about
  // its own shaft, stacking lift, then the bone's world matrix on top.
  // `invRoot` re-bases bone world matrices into the coat group's own frame
  // (pass the inverse of the shared parent's matrixWorld when the bird moves).
  update(bones: THREE.Bone[], pose: CoatPose, invRoot?: THREE.Matrix4): void {
    for (const [cls, { mesh, slots }] of this.byClass) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const sign = /R$/.test(s.bone) ? -1 : 1;
        const isTail = cls === "rectrix";
        const spread = isTail ? pose.tailSpread : pose.spread;
        const lag = sign > 0 ? pose.lagL : pose.lagR;

        let fan = THREE.MathUtils.lerp(s.fanFolded, s.fanSpread, spread);
        fan -= pose.splay * s.splayW * 0.22; // flare pushes the fingers apart
        fan += lag * s.lagW; // stroke lag drags the fan against the motion

        // build the feather frame in bone-local space
        this.shaft.copy(s.span).applyAxisAngle(s.normal, sign * fan);
        const cant = s.cant * (0.4 + 0.6 * spread) + pose.slot * s.slotW * 0.9;
        this.up.copy(s.normal).applyAxisAngle(this.shaft, sign * cant);
        this.sideV.crossVectors(this.up, this.shaft).normalize();
        this.up.crossVectors(this.shaft, this.sideV);

        const w = s.width * (isTail ? 0.65 + 0.55 * pose.tailSpread : 0.7 + 0.45 * spread);
        this.mBasis.makeBasis(
          this.sideV.multiplyScalar(w),
          this.upScaled.copy(this.up).multiplyScalar(w),
          this.shaftScaled.copy(this.shaft).multiplyScalar(s.len),
        );
        this.pos.copy(s.anchorLocal).addScaledVector(s.normal, s.lift);
        this.mBasis.setPosition(this.pos);
        this.m.multiplyMatrices(bones[s.boneIdx].matrixWorld, this.mBasis);
        if (invRoot) this.m.premultiply(invRoot);
        mesh.setMatrixAt(i, this.m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function boneDir(b: BirdBone): THREE.Vector3 {
  return new THREE.Vector3(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]).normalize();
}
