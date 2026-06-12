// Flight as a balance of forces. Until now the wingbeat was choreography —
// the wing moved and nothing came of it. Here the air pushes back. The eagle
// becomes a point mass with an orientation, and four forces decide where she
// goes: gravity always down, lift perpendicular to her path, drag opposing
// it, and thrust from the flap stolen out of the downstroke. Integrate those
// every frame and flight stops being an animation and becomes an outcome —
// including the turn, which nobody scripts here: it falls out of rolling the
// lift vector sideways, exactly as a banking bird does it.

import * as THREE from "three/webgpu";

export interface FlightParams {
  mass: number; // kg-ish, arbitrary but consistent units
  gravity: number;
  wingArea: number; // sets the scale of lift and drag together
  liftSlope: number; // dCL/dα near cruise (per radian)
  cl0: number; // lift coefficient at zero angle of attack (camber)
  clStall: number; // lift coefficient ceiling — past it the wing lets go
  cd0: number; // parasitic drag (body + friction)
  inducedK: number; // induced drag: the price of making lift, ∝ CL²
  thrustPerFlap: number; // forward force at full flap effort
  airDensity: number;
}

// An eagle's numbers, not a songbird's: four and a third kilos on more than
// half a square meter of wing. Trim works out near 13 m/s — she flies fast,
// and everything downstream (turn radii, approach distances, the size of the
// world) is scaled to that.
export const FLIGHT_DEFAULTS: FlightParams = {
  mass: 4.3,
  gravity: 9.81,
  wingArea: 0.55,
  liftSlope: 5.0,
  cl0: 0.30,
  clStall: 1.6,
  cd0: 0.05,
  inducedK: 0.06,
  // tuned so a half-effort flap holds roughly the trim speed (~13 m/s) rather
  // than accelerating without bound — thrust must balance drag near cruise
  thrustPerFlap: 9.0,
  airDensity: 1.225,
};

export interface FlightState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  bank: number; // roll about the velocity axis, radians
  pitchCmd: number; // commanded angle of attack offset, radians
  flapEffort: number; // 0 = glide, 1 = full power
}

// The instantaneous force breakdown — handy for the diagram demo, and the
// honest record of why she is about to move the way she is.
export interface ForceReport {
  lift: THREE.Vector3;
  drag: THREE.Vector3;
  thrust: THREE.Vector3;
  weight: THREE.Vector3;
  total: THREE.Vector3;
  speed: number;
  alpha: number; // angle of attack, radians
  cl: number;
  stalled: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const liftDir = new THREE.Vector3();
const tmp = new THREE.Vector3();

// Build the wing's frame from the velocity and the bank. Forward is the
// flight direction; "right" is horizontal and across it; lift points along
// the body-up, which is `right × forward` rolled by the bank angle. With
// zero bank, lift is vertical and only fights gravity; banked, part of it
// points inward and curves the path — a turn, for free.
function frame(state: FlightState): void {
  fwd.copy(state.vel);
  const speed = fwd.length();
  if (speed < 1e-4) {
    fwd.set(0, 0, 1);
  } else {
    fwd.multiplyScalar(1 / speed);
  }
  right.crossVectors(fwd, UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0); // flying straight up/down
  right.normalize();
  // un-banked lift axis: perpendicular to forward, in the vertical plane
  liftDir.crossVectors(right, fwd).normalize();
  // roll the lift axis about the forward axis by the bank angle
  liftDir.applyAxisAngle(fwd, state.bank);
}

export function computeForces(state: FlightState, p: FlightParams, out: ForceReport): ForceReport {
  frame(state);
  const speed = state.vel.length();
  const q = 0.5 * p.airDensity * speed * speed * p.wingArea; // dynamic pressure × area

  // angle of attack: the wing is held a little nose-up plus whatever pitch is
  // commanded; in this reduced model we read it straight off pitchCmd, since
  // the velocity frame already absorbs the flight-path angle.
  const alpha = state.pitchCmd;
  let cl = p.cl0 + p.liftSlope * alpha;
  const stalled = Math.abs(cl) > p.clStall;
  if (stalled) cl = Math.sign(cl) * p.clStall * (1 - 0.4 * (Math.abs(cl) - p.clStall)); // post-stall collapse
  const cd = p.cd0 + p.inducedK * cl * cl;

  out.lift.copy(liftDir).multiplyScalar(q * cl);
  out.drag.copy(state.vel).multiplyScalar(speed > 1e-4 ? -q * cd / speed : 0);
  out.thrust.copy(fwd).multiplyScalar(p.thrustPerFlap * state.flapEffort);
  out.weight.set(0, -p.mass * p.gravity, 0);

  out.total.copy(out.lift).add(out.drag).add(out.thrust).add(out.weight);
  out.speed = speed;
  out.alpha = alpha;
  out.cl = cl;
  out.stalled = stalled;
  return out;
}

const report: ForceReport = {
  lift: new THREE.Vector3(),
  drag: new THREE.Vector3(),
  thrust: new THREE.Vector3(),
  weight: new THREE.Vector3(),
  total: new THREE.Vector3(),
  speed: 0,
  alpha: 0,
  cl: 0,
  stalled: false,
};

// Semi-implicit Euler: F = ma, integrate velocity then position. Returns the
// force report so callers can both render and read what happened. Substep for
// stability when a frame is long or the bird is fast.
export function stepFlight(state: FlightState, p: FlightParams, dt: number, substeps = 2): ForceReport {
  const h = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    computeForces(state, p, report);
    tmp.copy(report.total).multiplyScalar(h / p.mass);
    state.vel.add(tmp);
    state.pos.addScaledVector(state.vel, h);
  }
  return report;
}

// The trim speed: how fast she must fly for lift to exactly carry her weight
// at a given angle of attack. The glide demo starts here so she doesn't drop
// out of the sky on frame one.
export function trimSpeed(p: FlightParams, alpha = 0.08): number {
  const cl = p.cl0 + p.liftSlope * alpha;
  const denom = 0.5 * p.airDensity * p.wingArea * Math.max(cl, 0.05);
  return Math.sqrt((p.mass * p.gravity) / denom);
}

// Orientation for rendering: face along velocity, bank by the roll, with a
// little extra nose attitude from the angle of attack. Returns a quaternion
// that turns the model's rest forward (+z) into the flight frame.
const mFrame = new THREE.Matrix4();
const qNoseUp = new THREE.Quaternion();
const fwdAxis = new THREE.Vector3();
export function flightQuaternion(state: FlightState, out: THREE.Quaternion): THREE.Quaternion {
  frame(state);
  // model faces +z at rest; build a basis with z=forward, y=liftDir, x=right
  fwdAxis.copy(fwd);
  tmp.crossVectors(liftDir, fwdAxis).normalize(); // model-right
  mFrame.makeBasis(tmp, liftDir, fwdAxis);
  out.setFromRotationMatrix(mFrame);
  // pitch the nose up by the angle of attack about the model-right axis
  qNoseUp.setFromAxisAngle(tmp, -state.pitchCmd);
  return out.premultiply(qNoseUp);
}
