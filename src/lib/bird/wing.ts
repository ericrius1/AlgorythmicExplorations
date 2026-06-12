// The wing as a mechanism. The bone table gives three segments per side —
// humerus, forearm, hand — and this module turns "wingtip, be there" into
// joint rotations: a two-bone solve for shoulder and elbow, the hand laid
// along the remaining reach with its own sweep, and every segment rolled so
// the feathered surface faces where the air will be. On top of that sits the
// wingbeat itself: a phase-warped loop for the tip, span pulled in on the
// upstroke, twist flipping sign with the stroke — plus the three signals the
// feather coat feeds on: slot (the upstroke louver-opening), splay (the
// finger spread at the bottom of the power stroke), and lag (the whip the
// stroke drags through the fan). Part 4 turns these shapes into forces.

import * as THREE from "three/webgpu";
import { BIRD_BONES, BONE_INDEX, type BirdBone } from "./skeleton";
import { solveTwoBone, quatFromFrames, type TwoBoneResult } from "./ik";
import type { BirdRig } from "./rig";
import type { CoatPose } from "./feathers";

interface WingSide {
  sign: 1 | -1;
  shoulder: THREE.Vector3;
  restDir: { hum: THREE.Vector3; fore: THREE.Vector3; hand: THREE.Vector3 };
  restNormal: THREE.Vector3; // the blade's flat axis at rest
  len: { hum: number; fore: number; hand: number };
  names: { hum: string; fore: string; hand: string };
}

function boneDir(b: BirdBone): THREE.Vector3 {
  return new THREE.Vector3(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]).normalize();
}
function boneLen(b: BirdBone): number {
  return new THREE.Vector3(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]).length();
}

function makeSide(suffix: "L" | "R"): WingSide {
  const hum = BIRD_BONES[BONE_INDEX.get("humerus" + suffix)!];
  const fore = BIRD_BONES[BONE_INDEX.get("forearm" + suffix)!];
  const hand = BIRD_BONES[BONE_INDEX.get("hand" + suffix)!];
  const sign = suffix === "L" ? 1 : -1;
  return {
    sign,
    shoulder: new THREE.Vector3(...hum.head),
    restDir: { hum: boneDir(hum), fore: boneDir(fore), hand: boneDir(hand) },
    restNormal: new THREE.Vector3(sign, 0, 0),
    len: { hum: boneLen(hum), fore: boneLen(fore), hand: boneLen(hand) },
    names: { hum: "humerus" + suffix, fore: "forearm" + suffix, hand: "hand" + suffix },
  };
}

export const WINGS: { L: WingSide; R: WingSide } = { L: makeSide("L"), R: makeSide("R") };
export type { WingSide };

export function wingReach(side: WingSide = WINGS.L): number {
  return side.len.hum + side.len.fore + side.len.hand;
}

export interface WingSolveOptions {
  pole?: THREE.Vector3; // elbow bias, body space; default back and slightly up
  twist?: number; // radians; + pitches the leading edge down
  // how much of the chain the hand keeps for itself when the target is
  // close: 1 = hand stays in line, smaller = hand sweeps back first
  handAlign?: number;
}

export interface WingSolveResult {
  elbow: THREE.Vector3;
  wrist: THREE.Vector3;
  tip: THREE.Vector3;
  clamped: boolean;
}

const DEFAULT_POLE = new THREE.Vector3(0, 0.35, -1).normalize();
const sTwo: TwoBoneResult = {
  upperDir: new THREE.Vector3(),
  lowerDir: new THREE.Vector3(),
  elbow: new THREE.Vector3(),
  end: new THREE.Vector3(),
  clamped: false,
};
const wTarget = new THREE.Vector3();
const handDir = new THREE.Vector3();
const nHint = new THREE.Vector3();
const nBone = new THREE.Vector3();
const qHum = new THREE.Quaternion();
const qFore = new THREE.Quaternion();
const qHand = new THREE.Quaternion();
const qTwist = new THREE.Quaternion();
const qInv = new THREE.Quaternion();
const pole = new THREE.Vector3();

// Solve one wing so its tip lands on `target` (body space) and write the
// three local quaternions into the rig. The hand is handled by successive
// approximation: guess its direction, pull the two-bone target back by one
// hand-length, solve, re-aim the hand from the actual wrist, repeat once —
// two passes land within a feather's width.
export function applyWingTip(
  rig: BirdRig,
  side: WingSide,
  target: THREE.Vector3,
  opts: WingSolveOptions = {},
  out?: WingSolveResult,
): WingSolveResult {
  const { shoulder, len } = side;
  pole.copy(opts.pole ?? DEFAULT_POLE);
  pole.x *= side.sign;
  const twist = opts.twist ?? 0;

  handDir.subVectors(target, shoulder).normalize();
  for (let pass = 0; pass < 2; pass++) {
    wTarget.copy(target).addScaledVector(handDir, -len.hand);
    solveTwoBone(shoulder, wTarget, len.hum, len.fore, pole, sTwo);
    handDir.subVectors(target, sTwo.end).normalize();
    if (handDir.lengthSq() < 1e-8) handDir.copy(sTwo.lowerDir);
  }

  // blade roll: folded against the body the normal is sideways; spread, it
  // faces up. Blend by how far laterally the wing actually got, then twist
  // about each bone's own axis — the hand carries the most (primaries).
  const spread = Math.min(1, Math.abs(target.x - shoulder.x) / (wingReach(side) * 0.8));
  nHint.set(side.sign * (1 - spread), spread, 0).normalize();

  const setBone = (name: string, restDir: THREE.Vector3, dir: THREE.Vector3, twistShare: number, parentQ: THREE.Quaternion | null, outQ: THREE.Quaternion): void => {
    nBone.copy(nHint);
    if (twist !== 0 && twistShare !== 0) {
      qTwist.setFromAxisAngle(dir, side.sign * twist * twistShare);
      nBone.applyQuaternion(qTwist);
    }
    quatFromFrames(restDir, side.restNormal, dir, nBone, outQ);
    const local = rig.bone(name).quaternion.copy(outQ);
    if (parentQ) local.premultiply(qInv.copy(parentQ).invert());
  };

  setBone(side.names.hum, side.restDir.hum, sTwo.upperDir, 0.25, null, qHum);
  setBone(side.names.fore, side.restDir.fore, sTwo.lowerDir, 0.6, qHum, qFore);
  setBone(side.names.hand, side.restDir.hand, handDir, 1.0, qFore, qHand);

  const r = out ?? { elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), tip: new THREE.Vector3(), clamped: false };
  r.elbow.copy(sTwo.elbow);
  r.wrist.copy(sTwo.end);
  r.tip.copy(sTwo.end).addScaledVector(handDir, len.hand);
  r.clamped = sTwo.clamped;
  return r;
}

// ---- the unfold: one scalar from sleeping bird to full span ---------------------

const foldedTip = new THREE.Vector3();
const extendedTip = new THREE.Vector3();
const arcTip = new THREE.Vector3();

// f = 0 puts the tip back at its rest-pose position (the folded silhouette
// part 1 lofted); f = 1 reaches it out level with the shoulder at ~96% of
// full extension. In between the tip rides an arc and the elbow, biased
// backward by the pole, passes through every fold the real wing makes.
export function unfoldTarget(side: WingSide, f: number, out = new THREE.Vector3()): THREE.Vector3 {
  const hand = BIRD_BONES[BONE_INDEX.get(side.names.hand)!];
  foldedTip.set(...hand.tail);
  const reach = wingReach(side);
  extendedTip.copy(side.shoulder).add(arcTip.set(side.sign * reach * 0.96, reach * 0.05, -reach * 0.10));
  // lerp through the shoulder's sphere: direction slerps, radius lerps
  const a = foldedTip.sub(side.shoulder);
  const b = extendedTip.sub(side.shoulder);
  const ra = a.length(), rb = b.length();
  a.normalize();
  b.normalize();
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const ang = Math.acos(dot);
  const s = Math.sin(ang) || 1e-6;
  out.copy(a).multiplyScalar(Math.sin((1 - f) * ang) / s).addScaledVector(b, Math.sin(f * ang) / s);
  out.multiplyScalar(THREE.MathUtils.lerp(ra * 0.985, rb, f)).add(side.shoulder);
  return out;
}

// ---- the wingbeat ----------------------------------------------------------------

export interface FlapParams {
  rate: number; // beats per second
  amp: number; // tip excursion, body units
  downFrac: number; // fraction of the period spent on the downstroke
  foldUp: number; // 0..1, how much the wrist folds on the upstroke
  twistAmp: number; // radians of blade twist at mid-downstroke
  lagAmp: number; // radians the primary fan is dragged by the stroke
}

// An eagle beats slow and deep: ~2.3 strokes a second, the tip carving a
// third of the reach up and down, more than half the period spent on the
// downstroke because that's the half that pays.
export const FLAP_DEFAULTS: FlapParams = {
  rate: 2.3,
  amp: 0.30,
  downFrac: 0.56,
  foldUp: 0.7,
  twistAmp: 0.42,
  lagAmp: 0.26,
};

export interface FlapSample {
  tip: THREE.Vector3;
  twist: number;
  theta: number; // warped stroke angle, for readouts
  down: boolean;
  lag: number; // signed radians for the feather fan (whip)
  slot: number; // 0..1 — how far the primaries louver open
  splay: number; // 0..1 — finger spread near the bottom of the stroke
}

export function freshFlapSample(): FlapSample {
  return { tip: new THREE.Vector3(), twist: 0, theta: 0, down: true, lag: 0, slot: 0, splay: 0 };
}

// One wing's tip position at phase p ∈ [0,1). The stroke plane is a tilted
// ellipse: down-and-forward, up-and-back, with a scoop at the bottom (the
// tip's real path is closer to a figure eight than a circle). Time is warped
// so the downstroke gets `downFrac` of the period. On the upstroke the tip
// pulls inboard as the wrist folds — less span, less drag — and the primary
// fan louvers open so the air pours through instead of being pushed down.
export function flapTip(side: WingSide, p: number, fp: FlapParams, out: FlapSample): FlapSample {
  const down = p < fp.downFrac;
  const theta = down ? (p / fp.downFrac) * Math.PI : Math.PI + ((p - fp.downFrac) / (1 - fp.downFrac)) * Math.PI;
  const vert = Math.cos(theta); // +1 at the top of the stroke
  const sweep = Math.sin(theta); // + during the downstroke
  const upAmount = down ? 0 : Math.sin(((p - fp.downFrac) / (1 - fp.downFrac)) * Math.PI);
  const scoop = Math.max(0, -Math.cos(theta)) * Math.sin(theta * 2) * 0.18; // bottom figure-eight

  const reach = wingReach(side);
  const ext = reach * (0.93 - 0.34 * fp.foldUp * upAmount);
  out.tip.set(
    side.shoulder.x + side.sign * ext,
    side.shoulder.y + 0.04 + fp.amp * vert,
    side.shoulder.z - 0.06 + fp.amp * (0.55 * sweep + scoop),
  );
  out.twist = fp.twistAmp * sweep;
  out.theta = theta;
  out.down = down;

  // stroke-rate signal: d(vert)/dt up to a constant — fast on whichever half
  // is shorter. Drives the lag whip through the primary fan.
  const rateWarp = down ? 1 / fp.downFrac : 1 / (1 - fp.downFrac);
  out.lag = THREE.MathUtils.clamp(Math.sin(theta) * rateWarp * 0.6, -1.4, 1.4) * fp.lagAmp;
  out.slot = upAmount; // open on the upstroke, sealed on the down
  out.splay = down
    ? THREE.MathUtils.clamp((theta - 2.0) / 1.0, 0, 1)
    : Math.max(0, 1 - (theta - Math.PI) / 0.9);
  return out;
}

const sampleL = freshFlapSample();
const sampleR = freshFlapSample();
const solveScratch: WingSolveResult = { elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), tip: new THREE.Vector3(), clamped: false };

// Drive both wings from a single phase. Returns the left tip sample so
// callers can draw trails, read the stroke, and feed the feather coat.
export function applyFlap(rig: BirdRig, p: number, fp: FlapParams, phaseOffsetR = 0): FlapSample {
  flapTip(WINGS.L, p, fp, sampleL);
  flapTip(WINGS.R, (p + phaseOffsetR) % 1, fp, sampleR);
  applyWingTip(rig, WINGS.L, sampleL.tip, { twist: sampleL.twist }, solveScratch);
  applyWingTip(rig, WINGS.R, sampleR.tip, { twist: sampleR.twist }, solveScratch);
  return sampleL;
}

// Translate a flap sample into the feather coat's pose. `spread` is the IK
// unfold amount the wings are flying at; the flap signals ride on top.
export function coatPoseFromFlap(
  sample: FlapSample,
  spread: number,
  tailSpread: number,
  flapAmt: number,
  out: CoatPose,
): CoatPose {
  out.spread = spread;
  out.tailSpread = tailSpread;
  out.slot = sample.slot * flapAmt;
  out.splay = sample.splay * flapAmt * 0.8;
  out.lagL = sample.lag * flapAmt;
  out.lagR = sample.lag * flapAmt;
  return out;
}

// Tail attitude: the rectrix fan itself is the coat's job (tailSpread); the
// bone carries pitch and yaw — brake up, steer across.
export function setTail(rig: BirdRig, pitchDeg: number, yawDeg: number): void {
  rig.bone("tailFan").rotation.set((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0);
}
