// The four figures of Feather & Bone part 4: the force balance drawn as
// arrows you can tip out of trim, a glide that trades height for distance and
// reports its ratio, a banked turn carving a circle nobody scripted, and free
// flight — full integration, flapping wings, a chase camera, and an autopilot
// that holds altitude by feel.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D, addGroundDisc } from "../lib/stage3d";
import { buildBirdMesh, addFace } from "../lib/bird/build";
import { createSkinnedWren, attachRider, type BirdRig } from "../lib/bird/rig";
import { applyFlap, setTail, FLAP_DEFAULTS } from "../lib/bird/wing";
import {
  FLIGHT_DEFAULTS,
  computeForces,
  stepFlight,
  trimSpeed,
  flightQuaternion,
  type FlightState,
  type ForceReport,
  type FlightParams,
} from "../lib/bird/flight";
import { WREN_STAGE } from "./birdModel";

function solidMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
}

// a wren group ready to fly: skinned mesh + face, wings driven externally
function makeFlyer(): { group: THREE.Group; rig: BirdRig; flap: (phase: number) => void } {
  const built = buildBirdMesh({ res: 56, skin: true });
  const { mesh, rig } = createSkinnedWren(built.geometry, solidMaterial());
  const group = new THREE.Group();
  group.add(mesh);
  const face = new THREE.Group();
  addFace(face);
  attachRider(rig, "head", face);
  const bodyRest = rig.bone("body").position.clone();
  const flap = (phase: number): void => {
    const s = applyFlap(rig, phase, FLAP_DEFAULTS);
    const body = rig.bone("body");
    body.position.set(bodyRest.x, bodyRest.y - Math.cos(s.theta) * 0.01, bodyRest.z);
    setTail(rig, 0.5, -8 + 6 * Math.cos(s.theta), 0);
  };
  return { group, rig, flap };
}

function freshState(p: FlightParams): FlightState {
  return {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(0, 0, trimSpeed(p)),
    bank: 0,
    pitchCmd: 0.08,
    flapEffort: 0,
  };
}

// ---- the force balance --------------------------------------------------------------

export async function mountForceDiagram(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    ...WREN_STAGE,
    target: [0, 0.45, 0],
    distance: 2.4,
    azimuth: 0.0,
    elevation: 0.05,
  });
  addGroundDisc(stage.scene, { radius: 1.4, shadowRadius: 0.3 });

  const { group, flap } = makeFlyer();
  group.position.set(0, 0.45, 0);
  stage.scene.add(group);

  const p = { ...FLIGHT_DEFAULTS };
  const state = freshState(p);
  let speedMul = 1;
  let bankDeg = 0;
  let flapEffort = 0;

  // four labeled arrows, scaled to read clearly against the bird
  const colors = { lift: 0x6ad08a, drag: 0xe57777, thrust: 0x7fb4ff, weight: 0xd9c27a };
  const arrows: Record<string, THREE.ArrowHelper> = {};
  for (const [k, c] of Object.entries(colors)) {
    const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.45, 0), 0.3, c, 0.07, 0.045);
    arrows[k] = a;
    stage.scene.add(a);
  }
  const netArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.45, 0), 0.3, 0xffffff, 0.08, 0.05);
  stage.scene.add(netArrow);

  const report: ForceReport = {
    lift: new THREE.Vector3(), drag: new THREE.Vector3(), thrust: new THREE.Vector3(),
    weight: new THREE.Vector3(), total: new THREE.Vector3(), speed: 0, alpha: 0, cl: 0, stalled: false,
  };

  shell.slider({ label: "speed ×", min: 0.4, max: 2.2, step: 0.05, value: 1, onInput: (v) => (speedMul = v) });
  shell.slider({ label: "angle of attack°", min: -6, max: 22, step: 0.5, value: 4.6, onInput: (v) => (state.pitchCmd = (v * Math.PI) / 180) });
  shell.slider({ label: "bank°", min: -50, max: 50, step: 1, value: 0, onInput: (v) => (bankDeg = v) });
  shell.slider({ label: "flap effort", min: 0, max: 1, step: 0.01, value: 0, onInput: (v) => (flapEffort = v) });

  const origin = new THREE.Vector3(0, 0.45, 0);
  const SCALE = 2.6; // force units → world length
  const place = (a: THREE.ArrowHelper, v: THREE.Vector3): void => {
    const len = v.length() * SCALE;
    if (len < 1e-4) { a.visible = false; return; }
    a.visible = true;
    a.position.copy(origin);
    a.setDirection(v.clone().multiplyScalar(1 / v.length()));
    a.setLength(Math.min(len, 1.2), Math.min(0.07, len * 0.25), Math.min(0.045, len * 0.16));
  };

  let phase = 0;
  let last = performance.now() / 1000;
  shell.setInfo(() => `${report.stalled ? "⚠ STALLED — lift collapsing · " : ""}speed ${report.speed.toFixed(1)} · CL ${report.cl.toFixed(2)}`);

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;
      const base = trimSpeed(p);
      state.vel.set(0, 0, base * speedMul);
      state.bank = (bankDeg * Math.PI) / 180;
      state.flapEffort = flapEffort;
      computeForces(state, p, report);

      place(arrows.lift, report.lift);
      place(arrows.drag, report.drag);
      place(arrows.thrust, report.thrust);
      place(arrows.weight, report.weight);
      place(netArrow, report.total);

      const q = new THREE.Quaternion();
      flightQuaternion(state, q);
      group.quaternion.copy(q);

      phase = (phase + dt * FLAP_DEFAULTS.rate * (0.3 + flapEffort)) % 1;
      flap(phase);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the glide ----------------------------------------------------------------------

export async function mountGlide(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.05, 0.07, 0.12], skyBottom: [0.1, 0.12, 0.16],
    target: [0, 2, 6], distance: 8, azimuth: 0.7, elevation: 0.12, far: 200,
  });

  const { group, flap } = makeFlyer();
  stage.scene.add(group);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x2a3326, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  stage.scene.add(ground);

  const p = { ...FLIGHT_DEFAULTS };
  let state = freshState(p);
  const reset = (): void => {
    state = freshState(p);
    state.pos.set(0, 6, -2);
    state.vel.set(0, 0, trimSpeed(p) * 1.1);
    startPos.copy(state.pos);
    trailPts.length = 0;
  };

  let aoa = 4.6;
  shell.slider({ label: "angle of attack°", min: 0, max: 14, step: 0.2, value: aoa, onInput: (v) => { aoa = v; state.pitchCmd = (v * Math.PI) / 180; } });
  shell.button("release again", reset);

  // a trail polyline showing the descending path; glide ratio = horiz/vert
  const trailPts: THREE.Vector3[] = [];
  const trailGeo = new THREE.BufferGeometry();
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffc163 }));
  trail.frustumCulled = false;
  stage.scene.add(trail);
  const startPos = new THREE.Vector3();
  reset();

  const q = new THREE.Quaternion();
  let phase = 0;
  let last = performance.now() / 1000;
  let glideRatio = 0;
  shell.setInfo(() => `glide ratio ${glideRatio.toFixed(1)} : 1 · altitude ${Math.max(0, state.pos.y).toFixed(1)}`);

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;
      state.pitchCmd = (aoa * Math.PI) / 180;
      if (state.pos.y > 0.15) {
        stepFlight(state, p, dt);
        trailPts.push(state.pos.clone());
        if (trailPts.length > 600) trailPts.shift();
        trailGeo.setFromPoints(trailPts);
        const dropped = startPos.y - state.pos.y;
        const ran = Math.hypot(state.pos.x - startPos.x, state.pos.z - startPos.z);
        glideRatio = dropped > 0.05 ? ran / dropped : 0;
      }
      group.position.copy(state.pos);
      flightQuaternion(state, q);
      group.quaternion.copy(q);
      stage.orbit.target.lerp(state.pos, 0.06);

      phase = (phase + dt * FLAP_DEFAULTS.rate * 0.25) % 1; // a lazy idle flap
      flap(phase);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the banked turn ----------------------------------------------------------------

export async function mountBankedTurn(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.05, 0.07, 0.12], skyBottom: [0.1, 0.12, 0.16],
    target: [0, 3, 0], distance: 9, azimuth: 0.5, elevation: 0.62, far: 200,
  });

  const { group, flap } = makeFlyer();
  stage.scene.add(group);
  const grid = new THREE.GridHelper(60, 30, 0x3a4456, 0x222a38);
  grid.position.y = 0;
  stage.scene.add(grid);

  const p = { ...FLIGHT_DEFAULTS };
  const state = freshState(p);
  state.pos.set(0, 3, 0);
  state.vel.set(0, 0, trimSpeed(p) * 1.15);
  state.flapEffort = 0.55; // powered, so the turn is sustained

  let bankDeg = 28;
  shell.slider({ label: "bank°", min: -55, max: 55, step: 1, value: bankDeg, onInput: (v) => (bankDeg = v) });
  shell.slider({ label: "flap effort", min: 0.2, max: 1, step: 0.01, value: 0.55, onInput: (v) => (state.flapEffort = v) });

  const trailPts: THREE.Vector3[] = [];
  const trailGeo = new THREE.BufferGeometry();
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffc163 }));
  trail.frustumCulled = false;
  stage.scene.add(trail);

  const q = new THREE.Quaternion();
  const camCenter = new THREE.Vector3();
  let phase = 0;
  let last = performance.now() / 1000;
  shell.setInfo(() => "roll the lift vector sideways — the horizontal slice IS the turn");

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;
      state.bank = (bankDeg * Math.PI) / 180;
      // hold altitude loosely: nudge angle of attack toward level flight
      state.pitchCmd += (0.09 - state.pitchCmd) * 0.05 - state.vel.y * 0.02;
      stepFlight(state, p, dt);
      trailPts.push(state.pos.clone());
      if (trailPts.length > 800) trailPts.shift();
      trailGeo.setFromPoints(trailPts);

      group.position.copy(state.pos);
      flightQuaternion(state, q);
      group.quaternion.copy(q);
      // the camera tracks her so the circle stays framed wherever it drifts;
      // height held so we look down on the coil
      camCenter.copy(state.pos);
      camCenter.y = 3;
      stage.orbit.target.lerp(camCenter, 0.05);

      phase = (phase + dt * FLAP_DEFAULTS.rate * (0.4 + state.flapEffort)) % 1;
      flap(phase);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- free flight: autopilot + chase cam ---------------------------------------------

export async function mountFreeFlight(container: HTMLElement, opts: { hero?: boolean } = {}): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.04, 0.06, 0.11], skyBottom: [0.12, 0.13, 0.16],
    target: [0, 3, 0], distance: 4.5, azimuth: 0.6, elevation: 0.12, far: 300,
    fog: { color: 0x1a1e26, near: 14, far: 90 },
  });
  stage.orbit.autoSpin = 0;

  const { group, flap } = makeFlyer();
  stage.scene.add(group);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a3326, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  stage.scene.add(ground);
  // scattered posts so motion reads against something
  const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.4, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 1 });
  const posts = new THREE.InstancedMesh(postGeo, postMat, 60);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) {
    const a = i * 2.39963;
    const r = 6 + (i * 1.7) % 50;
    m.makeTranslation(Math.cos(a) * r, 0.7, Math.sin(a) * r);
    posts.setMatrixAt(i, m);
  }
  stage.scene.add(posts);

  const p = { ...FLIGHT_DEFAULTS };
  const state = freshState(p);
  state.pos.set(0, 5, 0);
  state.vel.set(0, 0, trimSpeed(p) * 1.1);
  state.flapEffort = 0.5;

  let targetAlt = 5;
  let turnRate = 0.25; // how aggressively the autopilot wanders
  let autopilot = true;
  shell.slider({ label: "cruise altitude", min: 2, max: 14, step: 0.5, value: targetAlt, onInput: (v) => (targetAlt = v) });
  shell.slider({ label: "wander", min: 0, max: 1, step: 0.05, value: 0.4, onInput: (v) => (turnRate = v) });
  if (!opts.hero) shell.button("autopilot: on", () => (autopilot = !autopilot));

  const q = new THREE.Quaternion();
  const camPos = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const lookTarget = new THREE.Vector3().copy(state.pos);
  const UP_OFFSET = new THREE.Vector3(0, 1.1, 0);
  let phase = 0;
  let wanderTarget = 0;
  let nextWander = 0;
  let seed = 3;
  let last = performance.now() / 1000;
  const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5; return s - Math.floor(s); };

  shell.setInfo(() => `${Math.round(state.vel.length() * 10) / 10} m/s · alt ${state.pos.y.toFixed(1)} · ${state.flapEffort > 0.05 ? "powered" : "gliding"}`);

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;

      if (autopilot) {
        // altitude hold: command angle of attack and flap effort from the
        // error between where she is and where she wants to be
        const altErr = targetAlt - state.pos.y;
        state.pitchCmd = THREE.MathUtils.clamp(0.08 + altErr * 0.03 - state.vel.y * 0.04, -0.05, 0.22);
        state.flapEffort = THREE.MathUtils.clamp(0.45 + altErr * 0.08, 0.1, 1);
        // gentle wandering bank
        if (t > nextWander) {
          wanderTarget = (hash(seed++) - 0.5) * 0.9 * turnRate;
          nextWander = t + 1.5 + hash(seed++) * 3;
        }
        state.bank += (wanderTarget - state.bank) * 0.02;
      }
      stepFlight(state, p, dt);
      if (state.pos.y < 0.6) { state.pos.y = 0.6; if (state.vel.y < 0) state.vel.y = 0.4; }

      group.position.copy(state.pos);
      flightQuaternion(state, q);
      group.quaternion.copy(q);

      // chase cam: sit behind and above along the heading, look at the bird.
      // We drive the camera directly and render ourselves, bypassing the
      // stage's orbit (this demo flies the camera, it doesn't orbit a subject).
      heading.copy(state.vel).setY(0);
      if (heading.lengthSq() < 1e-5) heading.set(0, 0, 1);
      heading.normalize();
      camPos.copy(state.pos).addScaledVector(heading, -3.2).add(UP_OFFSET);
      stage.camera.position.lerp(camPos, 0.08);
      lookTarget.lerp(state.pos, 0.15);
      stage.camera.lookAt(lookTarget);

      phase = (phase + dt * FLAP_DEFAULTS.rate * (0.4 + state.flapEffort)) % 1;
      flap(phase);
      stage.renderer.render(stage.scene, stage.camera);
      if (!opts.hero) shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
