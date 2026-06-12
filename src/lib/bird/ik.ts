// Inverse kinematics, the two-bone case. Forward kinematics asks "given
// these angles, where is the wingtip?"; IK asks the useful inverse: "the
// wingtip should be THERE — what are the angles?" For a two-segment limb the
// answer is closed-form, because once you fix the shoulder, the target, and
// the two segment lengths, the elbow has nowhere to hide: the three sides of
// the triangle are known, and the law of cosines hands over every angle. The
// only freedom left is which way the elbow points around the shoulder→target
// axis — the pole — and that is a style choice, not a math problem.

import * as THREE from "three/webgpu";

export interface TwoBoneResult {
  upperDir: THREE.Vector3; // unit, shoulder → elbow
  lowerDir: THREE.Vector3; // unit, elbow → effective target
  elbow: THREE.Vector3;
  end: THREE.Vector3; // where the chain actually ends (= target unless clamped)
  clamped: boolean; // target out of reach — chain went straight and waits
}

const tmpN = new THREE.Vector3();
const tmpBend = new THREE.Vector3();
const tmpTo = new THREE.Vector3();

export function solveTwoBone(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  a: number, // upper length
  b: number, // lower length
  pole: THREE.Vector3, // which way the elbow would like to point
  out: TwoBoneResult = {
    upperDir: new THREE.Vector3(),
    lowerDir: new THREE.Vector3(),
    elbow: new THREE.Vector3(),
    end: new THREE.Vector3(),
    clamped: false,
  },
): TwoBoneResult {
  tmpTo.subVectors(target, shoulder);
  let d = tmpTo.length();
  out.clamped = d >= (a + b) * 0.9999;
  d = Math.min(Math.max(d, Math.abs(a - b) + 1e-4), (a + b) * 0.9999);
  const dn = tmpTo.normalize();

  // law of cosines: angle at the shoulder between the target line and the
  // upper segment. cos A = (a² + d² − b²) / 2ad
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  // the bend plane contains shoulder, target, and (as nearly as possible)
  // the pole; bendDir is the in-plane perpendicular on the pole's side
  tmpN.crossVectors(dn, pole);
  if (tmpN.lengthSq() < 1e-8) tmpN.set(0, 1, 0).cross(dn); // pole degenerate
  tmpN.normalize();
  tmpBend.crossVectors(tmpN, dn).normalize();
  if (tmpBend.dot(pole) < 0) tmpBend.negate();

  out.upperDir.copy(dn).multiplyScalar(cosA).addScaledVector(tmpBend, sinA);
  out.elbow.copy(shoulder).addScaledVector(out.upperDir, a);
  out.end.copy(shoulder).addScaledVector(dn, d);
  out.lowerDir.subVectors(out.end, out.elbow).normalize();
  return out;
}

// Orientation from a direction plus a roll hint: a bone is not just an arrow
// — a wing segment is a blade, and the blade has to face somewhere. Build an
// orthonormal frame from (dir, normal-hint) for both the rest pose and the
// desired pose; the rotation between the two frames is the bone's quaternion,
// with zero twist ambiguity left over.
const mA = new THREE.Matrix4();
const mB = new THREE.Matrix4();
const x = new THREE.Vector3();
const y = new THREE.Vector3();
const z = new THREE.Vector3();

function basis(m: THREE.Matrix4, dir: THREE.Vector3, normalHint: THREE.Vector3): void {
  x.copy(dir).normalize();
  y.copy(normalHint).addScaledVector(x, -normalHint.dot(x)).normalize();
  if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(x, -x.y).normalize();
  z.crossVectors(x, y);
  m.makeBasis(x, y, z);
}

export function quatFromFrames(
  restDir: THREE.Vector3,
  restNormal: THREE.Vector3,
  dir: THREE.Vector3,
  normalHint: THREE.Vector3,
  out: THREE.Quaternion,
): THREE.Quaternion {
  basis(mA, restDir, restNormal);
  basis(mB, dir, normalHint);
  mA.invert().premultiply(mB); // desired ∘ rest⁻¹
  return out.setFromRotationMatrix(mA);
}
