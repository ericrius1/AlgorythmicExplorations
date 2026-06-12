// The animator. The core idea of part 4 in one sentence: nothing ever plays
// an animation — every joint *chases* a target with a critically-damped
// spring, and "animation" is just the schedule of where the targets go.
// Because the spring starts from the joint's current rotation and velocity,
// switching moves mid-flow is automatically seamless: there is no blend code,
// only physics that refuses to teleport.
//
// Layers, applied in order each frame:
//   1. the move player writes FK pose targets (tables from poses.ts)
//   2. breath adds a slow sine on the spine, shoulders, and head
//   3. springs integrate every joint toward its target
//   4. foot IK re-plants the ankles the pose layer disturbed
//   5. gaze IK turns the neck and head toward whatever deserves watching

import * as THREE from "three/webgpu";
import { Rig } from "./rig";
import { solveTwoBone, aimJoint, GAZE_FORWARD } from "./ik";
import { MOVES, WUJI, sampleMove, type Move, type Pose } from "./poses";

const DEG = Math.PI / 180;

// Critically damped spring on a quaternion, integrated in rotation-vector
// space: error = log(target · current⁻¹), acceleration = k·error − c·velocity.
class JointSpring {
  q = new THREE.Quaternion();
  vel = new THREE.Vector3(); // angular velocity, radians/s
  private err = new THREE.Quaternion();
  private e = new THREE.Vector3();
  private dq = new THREE.Quaternion();

  step(target: THREE.Quaternion, dt: number, freqHz: number): void {
    const k = (2 * Math.PI * freqHz) ** 2;
    const c = 2 * Math.sqrt(k); // ζ = 1: fastest approach with no overshoot
    // shortest-path error as a rotation vector
    this.err.copy(target).multiply(this.q.clone().invert());
    if (this.err.w < 0) {
      this.err.x *= -1; this.err.y *= -1; this.err.z *= -1; this.err.w *= -1;
    }
    const w = Math.min(1, Math.max(-1, this.err.w));
    const angle = 2 * Math.acos(w);
    const s = Math.sqrt(1 - w * w);
    if (s > 1e-5) this.e.set(this.err.x / s, this.err.y / s, this.err.z / s).multiplyScalar(angle);
    else this.e.set(0, 0, 0);

    this.vel.addScaledVector(this.e, k * dt).addScaledVector(this.vel, -Math.min(0.95, c * dt));
    // integrate: rotate q by vel·dt
    const wl = this.vel.length() * dt;
    if (wl > 1e-7) {
      const axis = this.e.copy(this.vel).normalize();
      this.dq.setFromAxisAngle(axis, wl);
      this.q.premultiply(this.dq).normalize();
    }
  }
}

export interface AnimatorOptions {
  footIK?: boolean;
  gazeIK?: boolean;
  autoFlow?: boolean; // pick a new move whenever the queue runs dry
}

export class Animator {
  readonly rig: Rig;
  freqHz = 1.35; // spring stiffness — the bear's "muscle speed"
  breathAmp = 1.0;
  breathRate = 0.16; // Hz — slow qi gong breath
  speed = 1.0;
  footIK: boolean;
  gazeIK: boolean;
  autoFlow: boolean;

  queue: Move[] = [];
  current: Move | null = null;
  moveT = 0; // seconds into the current move
  onMoveStart: ((m: Move) => void) | null = null;

  private springs: JointSpring[];
  private targets: THREE.Quaternion[];
  private euler = new THREE.Euler();
  private time = 0;
  private gazePoint = new THREE.Vector3(0, 1.55, 2.5);
  private gazeCurrent = new THREE.Vector3(0, 1.55, 2.5);
  private ankleRestL: THREE.Vector3;
  private ankleRestR: THREE.Vector3;
  private poleL = new THREE.Vector3();
  private poleR = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private liftY = 0;
  private lastAuto = -1;

  constructor(rig: Rig, opts: AnimatorOptions = {}) {
    this.rig = rig;
    this.footIK = opts.footIK ?? true;
    this.gazeIK = opts.gazeIK ?? true;
    this.autoFlow = opts.autoFlow ?? false;
    this.springs = rig.joints.map(() => new JointSpring());
    this.targets = rig.joints.map(() => new THREE.Quaternion());
    // remember where the feet were born: that is where they stay planted
    this.ankleRestL = rig.jointPos("footL").clone();
    this.ankleRestR = rig.jointPos("footR").clone();
  }

  enqueue(move: Move): void {
    this.queue.push(move);
  }

  // Drop the queue and head for this move *now* — the springs absorb the cut.
  play(move: Move): void {
    this.queue.length = 0;
    this.startMove(move);
  }

  private startMove(m: Move): void {
    this.current = m;
    this.moveT = 0;
    this.onMoveStart?.(m);
  }

  private nextMove(): void {
    if (this.queue.length > 0) {
      this.startMove(this.queue.shift()!);
    } else if (this.autoFlow) {
      // wander the form: any move but the one that just ended
      let pick = Math.floor(Math.random() * MOVES.length);
      if (pick === this.lastAuto) pick = (pick + 1) % MOVES.length;
      this.lastAuto = pick;
      this.startMove(MOVES[pick]);
    } else {
      this.current = null;
    }
  }

  update(dt: number): void {
    dt = Math.min(dt, 1 / 20); // a hiccuped tab must not explode the springs
    this.time += dt;
    const rig = this.rig;

    // ---- 1 · the move player writes targets -------------------------------------
    let pose: Pose = WUJI;
    let breathMul = 1;
    let gazeWanted: [number, number, number] | null = [0, 1.55, 2.5];
    if (this.current) {
      this.moveT += dt * this.speed;
      const t = this.moveT / this.current.duration;
      if (t >= 1) {
        this.nextMove();
        pose = this.current ? sampleMove(this.current, 0) : WUJI;
      } else {
        pose = sampleMove(this.current, t);
        breathMul = this.current.breath ?? 1;
        if (this.current.gaze) gazeWanted = this.current.gaze(t);
      }
    } else if (this.autoFlow) {
      this.nextMove();
    }

    // ---- 2 · breath layer --------------------------------------------------------
    // Applied as an *overlay* at target time, never written into the pose
    // tables — sampleMove hands out shared pose objects (WUJI itself when the
    // bear is idle), and mutating those accumulates the offset frame after
    // frame until the spine random-walks somewhere anatomically actionable.
    const br = Math.sin(this.time * 2 * Math.PI * this.breathRate);
    const breath = br * this.breathAmp * breathMul;
    const BREATH: Record<string, [number, number, number]> = {
      chest: [-1.8 * breath, 0, 0],
      spine: [-0.9 * breath, 0, 0],
      neck: [0.8 * breath, 0, 0],
      upperArmL: [0, 0, 1.5 * breath],
      upperArmR: [0, 0, -1.5 * breath],
    };

    // ---- 3 · springs chase -------------------------------------------------------
    for (let i = 0; i < rig.joints.length; i++) {
      const name = rig.joints[i].name;
      const e = pose.joints[name] ?? [0, 0, 0];
      const b = BREATH[name];
      this.euler.set(
        (e[0] + (b ? b[0] : 0)) * DEG,
        (e[1] + (b ? b[1] : 0)) * DEG,
        (e[2] + (b ? b[2] : 0)) * DEG,
        "XYZ",
      );
      this.targets[i].setFromEuler(this.euler);
      this.springs[i].step(this.targets[i], dt, this.freqHz);
      rig.joints[i].rotation.copy(this.springs[i].q);
    }
    // root lift breathes a little too, plus whatever the pose asks for
    const hips = rig.joints[rig.index("hips")];
    const lift = (pose.lift ?? 0) + breath * 0.004;
    this.liftY += (lift - this.liftY) * Math.min(1, dt * 8);
    hips.posOffset.set(0, this.liftY, 0);
    rig.update();

    // ---- 4 · foot IK: re-plant what the pose disturbed ----------------------------
    if (this.footIK) {
      // The pose's knee bends moved the FK ankles relative to the hips; since
      // the ankles are about to be pinned, the *hips* must sink by the same
      // amount — that is what turns "bent knees" into an actual crouch.
      const relL = rig.jointPos("footL", this.tmpA).y - rig.jointPos("hips", this.tmpB).y;
      const relR = rig.jointPos("footR", this.tmpA).y - rig.jointPos("hips", this.tmpB).y;
      const relRest = this.ankleRestL.y - 0.92; // rest ankle height below rest hips
      hips.posOffset.y -= (relL + relR) / 2 - relRest;
      rig.update();
      // knees bend forward: pole well in front of the body
      this.poleL.set(0.3, 0.5, 1.5);
      this.poleR.set(-0.3, 0.5, 1.5);
      solveTwoBone(rig, ["thighL", "shinL", "footL"], this.ankleRestL, this.poleL);
      solveTwoBone(rig, ["thighR", "shinR", "footR"], this.ankleRestR, this.poleR);
      // keep the soles flat: foot keeps its rest orientation in world space
      this.flattenFoot("footL");
      this.flattenFoot("footR");
      rig.update();
    }

    // ---- 5 · gaze: the head wants things -----------------------------------------
    if (this.gazeIK && gazeWanted) {
      this.gazePoint.set(gazeWanted[0], gazeWanted[1], gazeWanted[2]);
      // the gaze itself is eased so glances feel intentional, not servo-driven
      this.gazeCurrent.lerp(this.gazePoint, Math.min(1, dt * 3.5));
      aimJoint(rig, "neck", this.gazeCurrent, 28, 0.45, GAZE_FORWARD);
      rig.update();
      aimJoint(rig, "head", this.gazeCurrent, 45, 0.75, GAZE_FORWARD);
      rig.update();
    }
  }

  private fq = new THREE.Quaternion();
  private flattenFoot(name: string): void {
    const j = this.rig.joints[this.rig.index(name)];
    this.rig.parentQuat(name, this.fq).invert();
    j.rotation.copy(this.fq); // world rotation = identity → sole stays flat
  }
}
