// Inverse kinematics for the bear. Two solvers, two philosophies:
//   · two-bone analytic — a triangle has no secrets; the law of cosines gives
//     the elbow angle in closed form, a pole vector picks the bend plane.
//   · FABRIK — iterative "reach and re-root" for chains of any length.
// Both write ordinary joint rotations back into the rig, which is the point:
// IK is just a smarter way of choosing the same numbers FK dials by hand.

import * as THREE from "three/webgpu";
import type { Rig } from "./rig";

const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _q = new THREE.Quaternion();

// Solve joints [root, mid, tip] (e.g. upperArm, forearm, hand) so the tip
// joint's head (the wrist) lands on `target`. `pole` is a world-space hint:
// the bend (elbow/knee) leans toward it. `blend` ∈ [0,1] lerps between the
// rig's current pose and the IK result.
export function solveTwoBone(
  rig: Rig,
  chain: [string, string, string],
  target: THREE.Vector3,
  pole: THREE.Vector3,
  blend = 1,
): void {
  const [na, nb, nc] = chain;
  const ia = rig.index(na), ib = rig.index(nb);

  const L1 = rig.joints[ib].restOffset.length();
  const L2 = rig.joints[rig.index(nc)].restOffset.length();

  rig.jointPos(na, _a);
  _t.copy(target);
  _dir.copy(_t).sub(_a);
  // Clamp the reach: no triangle exists past full extension or full fold.
  const d = Math.min(Math.max(_dir.length(), Math.abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4);
  _dir.normalize();

  // Law of cosines: angle at the root between "toward target" and the upper bone.
  const cosA = (d * d + L1 * L1 - L2 * L2) / (2 * d * L1);
  const a = Math.acos(Math.min(1, Math.max(-1, cosA)));

  // Bend plane: span(dir, pole). The elbow sits at distance L1, rotated `a`
  // off the target line, toward the pole.
  _pole.copy(pole).sub(_a);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z); // degenerate pole: pick anything perpendicular
  _pole.normalize();
  _elbow.copy(_a).addScaledVector(_dir, Math.cos(a) * L1).addScaledVector(_pole, Math.sin(a) * L1);

  // Desired world directions of the two bones…
  _d1.copy(_elbow).sub(_a).normalize();
  _d2.copy(_a).addScaledVector(_dir, d).sub(_elbow).normalize();

  // …converted into local rotations: express the desired direction in the
  // joint's parent frame, then take the shortest arc from the bone's rest
  // direction. (Shortest-arc leaves the twist free — fine inside fur.)

  // root joint
  {
    const j = rig.joints[ia];
    rig.parentQuat(na, _pq).invert();
    const desiredLocal = _d1.clone().applyQuaternion(_pq);
    const rest = rig.joints[ib].restOffset.clone().normalize();
    _q.setFromUnitVectors(rest, desiredLocal);
    if (blend < 1) j.rotation.slerp(_q, blend);
    else j.rotation.copy(_q);
  }
  rig.update();

  // mid joint
  {
    const j = rig.joints[ib];
    rig.parentQuat(nb, _pq).invert();
    const desiredLocal = _d2.clone().applyQuaternion(_pq);
    const rest = rig.joints[rig.index(nc)].restOffset.clone().normalize();
    _q.setFromUnitVectors(rest, desiredLocal);
    if (blend < 1) j.rotation.slerp(_q, blend);
    else j.rotation.copy(_q);
  }
  rig.update();
}

// The bear models face +z; gaze joints aim this, not their bone axis.
export const GAZE_FORWARD = new THREE.Vector3(0, 0, 1);

// Aim a joint at a world target, clamped to a cone of `maxDeg` around rest,
// blended by `weight`. `restDir` is the rest-pose direction that should end up
// pointing at the target — the bone's own axis by default (leaning a spine),
// but for a gaze it must be the *face* direction: the head bone runs up
// through the skull, and aiming that at a target tips the crown, not the
// eyes. This is all "look at" ever is: one shortest-arc rotation.
export function aimJoint(
  rig: Rig,
  name: string,
  target: THREE.Vector3,
  maxDeg: number,
  weight = 1,
  restDir?: THREE.Vector3,
): void {
  const i = rig.index(name);
  const j = rig.joints[i];
  rig.jointPos(name, _a);
  _dir.copy(target).sub(_a).normalize();
  rig.parentQuat(name, _pq).invert();
  const desiredLocal = _dir.applyQuaternion(_pq);
  const rest = _r.copy(restDir ?? j.tailOffset).normalize();
  _q.setFromUnitVectors(rest, desiredLocal);
  // clamp: limit rotation angle to the cone
  const angle = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
  const max = (maxDeg * Math.PI) / 180;
  if (angle > max) _q.slerp(IDENTITY, 1 - max / angle);
  j.rotation.slerp(_q, weight);
}

const IDENTITY = new THREE.Quaternion();

// ---- FABRIK (2D, for the diagram demo) ------------------------------------------
// Forward-And-Backward Reaching IK: drag the tip to the target and let the
// chain follow (lengths re-imposed tip-to-root), then drag the root back home
// (lengths re-imposed root-to-tip). Repeat. Aristidou & Lasenby, 2011.

export interface Fabrik2D {
  pts: { x: number; y: number }[]; // joint positions, root first
  lengths: number[];
}

export function makeFabrik(rootX: number, rootY: number, segLengths: number[]): Fabrik2D {
  const pts = [{ x: rootX, y: rootY }];
  let x = rootX;
  for (const l of segLengths) {
    x += l;
    pts.push({ x, y: rootY });
  }
  return { pts, lengths: segLengths.slice() };
}

// One full iteration (backward + forward pass). Returns distance to target.
export function fabrikStep(f: Fabrik2D, tx: number, ty: number): number {
  const n = f.pts.length;
  const rootX = f.pts[0].x, rootY = f.pts[0].y;
  // backward: tip snaps to target, work toward the root
  f.pts[n - 1].x = tx;
  f.pts[n - 1].y = ty;
  for (let i = n - 2; i >= 0; i--) {
    const dx = f.pts[i].x - f.pts[i + 1].x;
    const dy = f.pts[i].y - f.pts[i + 1].y;
    const r = Math.hypot(dx, dy) || 1e-6;
    const s = f.lengths[i] / r;
    f.pts[i].x = f.pts[i + 1].x + dx * s;
    f.pts[i].y = f.pts[i + 1].y + dy * s;
  }
  // forward: root snaps home, work toward the tip
  f.pts[0].x = rootX;
  f.pts[0].y = rootY;
  for (let i = 1; i < n; i++) {
    const dx = f.pts[i].x - f.pts[i - 1].x;
    const dy = f.pts[i].y - f.pts[i - 1].y;
    const r = Math.hypot(dx, dy) || 1e-6;
    const s = f.lengths[i - 1] / r;
    f.pts[i].x = f.pts[i - 1].x + dx * s;
    f.pts[i].y = f.pts[i - 1].y + dy * s;
  }
  return Math.hypot(f.pts[n - 1].x - tx, f.pts[n - 1].y - ty);
}
