// The whole eagle, assembled: lofted body skinned to the rig, feather coat
// riding the bones, eyes riding the head. One pose() call drives everything —
// wing spread, wingbeat overlay, tail fan, gape — so parts 4, 5, and 6 can
// fly one creature instead of plumbing four subsystems each.

import * as THREE from "three/webgpu";
import { buildEagleBody, addFace, type BodyBuild } from "./body";
import { bakeSkin, createSkinnedBird, attachRider, type BirdRig } from "./rig";
import { FeatherCoat, COAT_POSE_REST, type CoatPose } from "./feathers";
import {
  WINGS,
  applyWingTip,
  unfoldTarget,
  flapTip,
  setTail,
  coatPoseFromFlap,
  freshFlapSample,
  FLAP_DEFAULTS,
  type FlapParams,
  type FlapSample,
} from "./wing";

export interface EaglePoseOpts {
  phase: number; // wingbeat phase 0..1
  spread: number; // 0 folded .. 1 full span
  flap: number; // 0 = hold the spread pose, 1 = full wingbeat overlay
  tailFan: number; // 0..1 rectrix fan
  beak: number; // 0 shut .. 1 screaming
  theta?: number; // stroke angle override (breath, when not flapping)
  splay?: number; // extra finger spread (a flare), on top of the stroke's own
  slot?: number; // extra primary venting, on top of the stroke's own
  legExtend?: number; // 0 tucked under the tail in flight .. 1 dropped for landing
  legCrouch?: number; // 0..1 grip fold when perched (on top of extend)
  fp?: FlapParams;
}

// Eagles fly with legs tucked; they drop only on final approach. `extend`
// lerps from the tucked pose to the rest hang; `crouch` folds for a perch.
// Rotations are tuned on this rig's world-aligned joints: positive thigh X
// swings the hanging leg up and back under the tail; positive tarsus X folds
// the shank against the thigh (rest talon tip ≈ y 0.01 → tucked ≈ y 0.53).
function applyLegPose(rig: BirdRig, extend: number, crouch = 0): void {
  const e = THREE.MathUtils.clamp(extend, 0, 1);
  const c = THREE.MathUtils.clamp(crouch, 0, 1);
  const tuck = 1 - e;
  const thighX = 85 * tuck + 30 * c;
  const thighZL = -8 * tuck;
  const tarsusX = 80 * tuck - 36 * c;
  rig.setEulerDeg("thighL", thighX, 0, thighZL);
  rig.setEulerDeg("thighR", thighX, 0, -thighZL);
  rig.setEulerDeg("tarsusL", tarsusX, 0, 0);
  rig.setEulerDeg("tarsusR", tarsusX, 0, 0);
  rig.setEulerDeg("footL", 0, 0, 0);
  rig.setEulerDeg("footR", 0, 0, 0);
}

export interface Eagle {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  rig: BirdRig;
  coat: FeatherCoat;
  build: BodyBuild;
  bodyRest: THREE.Vector3;
  pose(opts: EaglePoseOpts): FlapSample;
}

export function solidMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
}

export function createEagle(opts: { material?: THREE.Material; bulk?: number } = {}): Eagle {
  const build = buildEagleBody({ bulk: opts.bulk });
  bakeSkin(build.geometry, build.components);
  const { mesh, rig } = createSkinnedBird(build.geometry, opts.material ?? solidMaterial());

  const group = new THREE.Group();
  group.add(mesh);

  const face = new THREE.Group();
  addFace(face);
  attachRider(rig, "head", face);

  const coat = new FeatherCoat();
  group.add(coat.group);

  const bodyRest = rig.bone("body").position.clone();
  const sample = freshFlapSample();
  const coatPose: CoatPose = { ...COAT_POSE_REST };
  const tL = new THREE.Vector3();
  const tR = new THREE.Vector3();
  const mixT = new THREE.Vector3();
  const invRoot = new THREE.Matrix4();

  const pose = (o: EaglePoseOpts): FlapSample => {
    const fp = o.fp ?? FLAP_DEFAULTS;
    const flap = THREE.MathUtils.clamp(o.flap, 0, 1);

    unfoldTarget(WINGS.L, o.spread, tL);
    unfoldTarget(WINGS.R, o.spread, tR);

    if (flap > 0) {
      flapTip(WINGS.L, o.phase, fp, sample);
      mixT.lerpVectors(tL, sample.tip, flap);
      applyWingTip(rig, WINGS.L, mixT, { twist: sample.twist * flap + 0.1 * o.spread * (1 - flap) });
      flapTip(WINGS.R, o.phase, fp, sample);
      mixT.lerpVectors(tR, sample.tip, flap);
      applyWingTip(rig, WINGS.R, mixT, { twist: sample.twist * flap + 0.1 * o.spread * (1 - flap) });
      // recompute the left sample so callers read consistent stroke signals
      flapTip(WINGS.L, o.phase, fp, sample);
    } else {
      sample.theta = o.theta ?? 0;
      sample.lag = 0;
      sample.slot = 0;
      sample.splay = 0;
      sample.twist = 0;
      sample.down = false;
      applyWingTip(rig, WINGS.L, tL, { twist: 0.1 * o.spread });
      applyWingTip(rig, WINGS.R, tR, { twist: 0.1 * o.spread });
    }

    const theta = o.theta ?? sample.theta;

    // the body rides the reaction: pushed up through the downstroke, sagging
    // through the recovery — and the head counter-pitches to hold its gaze,
    // because a bird's head is a camera gimbal with feathers
    const body = rig.bone("body");
    const heave = -Math.cos(theta) * 0.018 * flap;
    const bodyPitch = Math.sin(theta) * 0.05 * flap;
    body.position.set(bodyRest.x, bodyRest.y + heave, bodyRest.z);
    body.rotation.set(bodyPitch, 0, 0);
    rig.bone("head").rotation.x = -bodyPitch * 1.6;

    setTail(rig, -6 + 6 * Math.cos(theta) * (0.3 + 0.7 * flap), 0);
    rig.bone("beak").rotation.set(o.beak * 0.6, 0, 0);
    applyLegPose(rig, o.legExtend ?? 0, o.legCrouch ?? 0);

    // feathers last: they read the bones the IK just wrote
    coatPoseFromFlap(sample, o.spread, o.tailFan, flap, coatPose);
    if (o.splay !== undefined) coatPose.splay = Math.max(coatPose.splay, o.splay);
    if (o.slot !== undefined) coatPose.slot = Math.max(coatPose.slot, o.slot);
    group.updateWorldMatrix(true, false);
    rig.root.updateWorldMatrix(false, true);
    invRoot.copy(group.matrixWorld).invert();
    coat.update(rig.bones, coatPose, invRoot);
    return sample;
  };

  return { group, mesh, rig, coat, build, bodyRest, pose };
}
