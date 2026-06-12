// Landing: the hardest thing a bird does. Flying is a steady balance;
// landing is a controlled crisis — arrive at a precise point in space with
// almost no speed left, having spent the last of it on a flare that buys one
// heartbeat of extra lift at the very edge of the stall. This controller
// flies the part-four physics toward a perch: it steers by banking, holds a
// glide slope by pitch, schedules its speed by distance, and at the last
// moment pitches up hard to stop. No path is drawn; the guidance laws fly the
// force model, the same way a real approach is flown.

import * as THREE from "three/webgpu";
import {
  stepFlight,
  trimSpeed,
  type FlightState,
  type FlightParams,
} from "./flight";

export type LandingPhase = "cruise" | "approach" | "flare" | "perched";

export interface PerchTarget {
  position: THREE.Vector3;
  tangent: THREE.Vector3; // along the branch; the bird lands across it
}

export interface LandingTuning {
  approachDist: number; // begin the descent within this range
  flareDist: number; // begin the flare within this range
  grabDist: number; // close enough, slow enough → touchdown
  glideSlope: number; // radians below horizontal on final
  bankGain: number; // heading error → commanded bank
  cruiseSpeedMul: number;
}

// Distances sized for an eagle arriving near 13 m/s — everything roughly 2.5×
// the songbird numbers this controller was first tuned on.
export const LANDING_TUNING: LandingTuning = {
  approachDist: 30,
  // the flare capture radius must exceed the bird's minimum turn radius, or
  // she orbits the perch forever without ever getting close enough to flare
  flareDist: 13,
  grabDist: 1.6,
  glideSlope: 0.2,
  bankGain: 1.7,
  cruiseSpeedMul: 1.0,
};

const toTarget = new THREE.Vector3();
const flatToTarget = new THREE.Vector3();
const heading = new THREE.Vector3();

export class LandingController {
  phase: LandingPhase = "cruise";
  perchProgress = 0; // 0 on touchdown, climbs to 1 as she settles (for the fold)
  speed = 0;
  distance = 0;

  constructor(
    public state: FlightState,
    public target: PerchTarget,
    public params: FlightParams,
    public tuning: LandingTuning = LANDING_TUNING,
  ) {}

  retarget(target: PerchTarget): void {
    this.target = target;
    if (this.phase === "perched") this.phase = "cruise";
    this.perchProgress = 0;
  }

  // One control step. Sets the bird's bank / angle of attack / flap effort
  // from where she is relative to the perch, then integrates the physics.
  step(dt: number): void {
    const s = this.state;
    const t = this.tuning;

    if (this.phase === "perched") {
      this.perchProgress = Math.min(1, this.perchProgress + dt * 2.2);
      s.vel.multiplyScalar(0); // sitting still, gripping
      this.speed = 0;
      this.distance = s.pos.distanceTo(this.target.position);
      return;
    }

    toTarget.subVectors(this.target.position, s.pos);
    const dist = toTarget.length();
    this.distance = dist;
    this.speed = s.vel.length();

    // touchdown test: close and slow enough to grab
    if (dist < t.grabDist && this.speed < trimSpeed(this.params) * 0.7) {
      this.phase = "perched";
      s.pos.copy(this.target.position);
      s.vel.set(0, 0, 0);
      this.perchProgress = 0;
      return;
    }

    // ---- lateral guidance: bank toward the target's heading ----------------
    flatToTarget.copy(toTarget).setY(0);
    if (flatToTarget.lengthSq() < 1e-6) flatToTarget.set(0, 0, 1);
    flatToTarget.normalize();
    heading.copy(s.vel).setY(0);
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, 1);
    heading.normalize();
    // signed heading error: + means target is to the left of the nose
    const cross = heading.x * flatToTarget.z - heading.z * flatToTarget.x;
    const dotH = THREE.MathUtils.clamp(heading.dot(flatToTarget), -1, 1);
    const headErr = Math.atan2(cross, dotH);
    const wantBank = THREE.MathUtils.clamp(-headErr * t.bankGain, -0.9, 0.9);
    s.bank += (wantBank - s.bank) * Math.min(1, dt * 6);

    // ---- phase selection by range -----------------------------------------
    if (dist > t.approachDist) {
      this.phase = "cruise";
    } else if (dist > t.flareDist) {
      this.phase = "approach";
    } else {
      this.phase = "flare";
    }

    if (this.phase === "cruise") {
      // hold a comfortable cruise: level altitude relative to nothing in
      // particular, full-ish power
      s.pitchCmd += (0.08 - s.pitchCmd) * 0.05 - s.vel.y * 0.03;
      s.flapEffort = 0.5;
    } else if (this.phase === "approach") {
      // ride a glide slope down to the perch: command pitch from the error
      // between the descent rate she has and the one the slope wants
      const desiredDescent = -Math.sin(t.glideSlope) * Math.max(this.speed, 0.5);
      const vyErr = desiredDescent - s.vel.y;
      s.pitchCmd = THREE.MathUtils.clamp(0.07 + vyErr * 0.05, -0.05, 0.16);
      // ease off the throttle so she bleeds toward perching speed — slow
      // enough that her turn radius shrinks below the flare capture radius,
      // or she'd circle the perch without ever closing on it
      const speedWant = trimSpeed(this.params) * THREE.MathUtils.lerp(0.55, 0.95, (dist - t.flareDist) / (t.approachDist - t.flareDist));
      s.flapEffort = THREE.MathUtils.clamp(0.3 + (speedWant - this.speed) * 0.14, 0.05, 0.7);
    } else {
      // FLARE: pitch up toward the stall, kill thrust. Lift spikes then
      // collapses — the cushion. The cupped, near-stalled wing is also a huge
      // air brake, so on top of the integrated forces we bleed velocity
      // directly here (the alternative — modeling a 90° wing as drag — is the
      // same number with more arithmetic) and steer what speed remains onto
      // the branch, so she converges instead of sailing past.
      const flareAmt = 1 - dist / t.flareDist; // 0 at flare start, 1 at the branch
      s.pitchCmd = THREE.MathUtils.lerp(0.12, 0.32, flareAmt); // up to past-stall
      s.flapEffort = THREE.MathUtils.lerp(0.2, 0, flareAmt);
      s.bank *= 1 - Math.min(1, dt * 5); // wings level for the touchdown

      stepFlight(s, this.params, dt, 3);

      // home: pull the velocity toward the perch and brake it, hard near the end
      const want = toTarget.clone().setLength(Math.max(1.2, this.speed * (1 - flareAmt)));
      s.vel.lerp(want, Math.min(1, dt * (3 + 9 * flareAmt)));
      s.pos.addScaledVector(toTarget.normalize(), Math.min(dist, this.speed * dt * flareAmt));
      return;
    }

    stepFlight(s, this.params, dt, 3);
    // never sink through the world before the perch
    if (s.pos.y < this.target.position.y - 0.05 && dist > t.grabDist) {
      // missed low — gentle recovery so the demo doesn't bury her
      s.pos.y = this.target.position.y - 0.05;
      if (s.vel.y < 0) s.vel.y = 0.2;
    }
  }
}

// Convenience: a fresh flight state trimmed for an inbound cruise from `from`
// toward `to`, already pointed roughly the right way.
export function inboundState(from: THREE.Vector3, to: THREE.Vector3, p: FlightParams): FlightState {
  const dir = new THREE.Vector3().subVectors(to, from).setY(0).normalize();
  return {
    pos: from.clone(),
    vel: dir.multiplyScalar(trimSpeed(p) * LANDING_TUNING.cruiseSpeedMul),
    bank: 0,
    pitchCmd: 0.08,
    flapEffort: 0.5,
  };
}
