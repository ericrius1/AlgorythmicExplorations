// The finale of both series. Everything built across eleven articles, in one
// place: an eagle lofted from rings, feathered quill by quill, rigged by
// distances, flapped by inverse kinematics, flown by forces, and landed by
// guidance — loose over a world of mountains the sister series raised from
// noise, with trees it grew by space colonization standing as the bird's
// landing targets. You can fly her, or let the autopilot. This is where
// Feather & Bone and Ground Truth stop being two series and become one demo.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D } from "../lib/stage3d";
import { FLAP_DEFAULTS } from "../lib/bird/wing";
import { stepFlight, flightQuaternion, trimSpeed, FLIGHT_DEFAULTS, type FlightState } from "../lib/bird/flight";
import { LandingController, inboundState, type PerchTarget } from "../lib/bird/landing";
import { Syrinx, generatePhrase } from "../lib/bird/syrinx";
import { waveform, audioOn } from "../lib/audio";
import { makeEagle, orientEagle, type Eagle } from "./birdLanding";
import { terrainHeight, buildTerrainGeometry, TERRAIN_DEFAULTS, type TerrainParams } from "../lib/terrain/heightmap";
import { growTree, buildTreeGeometry, findPerches, TREE_DEFAULTS, type Perch } from "../lib/terrain/trees";

// ---- the world: terrain + trees, with a height function and a perch list -----------

interface World {
  group: THREE.Group;
  params: TerrainParams;
  height(x: number, z: number): number;
  perches: PerchTarget[];
  size: number;
}

// Eagle country: the same noise mountains as before, but the patch is nearly
// three times wider and the relief three times taller — at 13 m/s the old
// songbird-sized world went by in six seconds.
function buildWorld(seed = 7, size = 220): World {
  const params: TerrainParams = { ...TERRAIN_DEFAULTS, seed, amplitude: 16, frequency: 0.019 };
  const group = new THREE.Group();

  const terr = buildTerrainGeometry(params, { size, segments: 170 });
  const ground = new THREE.Mesh(terr.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  group.add(ground);

  const height = (x: number, z: number): number => terrainHeight(x, z, params);

  // scatter big trees on the gentler, lower ground and collect their perches
  const perches: PerchTarget[] = [];
  const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  let placed = 0;
  for (let i = 0; placed < 12 && i < 90; i++) {
    const x = (hash(i * 3 + 1) - 0.5) * size * 0.8;
    const z = (hash(i * 3 + 2) - 0.5) * size * 0.8;
    const h = height(x, z);
    if (h > params.amplitude * 0.62) continue; // no trees on the snowy peaks
    // local slope: too steep, no tree
    const e = 1.6;
    const slope = Math.abs(height(x + e, z) - height(x - e, z)) + Math.abs(height(x, z + e) - height(x, z - e));
    if (slope > 4.2) continue;

    const skel = growTree({ ...TREE_DEFAULTS, seed: 100 + i, attractors: 170, trunkHeight: 1.4 + hash(i) * 0.8 });
    const tb = buildTreeGeometry(skel);
    const tree = new THREE.Group();
    tree.add(new THREE.Mesh(tb.bark, bark), new THREE.Mesh(tb.leaves, leaf));
    tree.position.set(x, h, z);
    const treeScale = 2.6 + hash(i * 7) * 1.6; // eagle-sized timber
    tree.scale.setScalar(treeScale);
    group.add(tree);

    // hoist this tree's perches into world space (only the stouter boughs)
    const local: Perch[] = findPerches(skel, { minRadius: 0.016, maxRadius: 0.07, minHeadroom: 0.24 })
      .filter((pc) => pc.position.y * treeScale > 3.4)
      .slice(0, 4);
    for (const pc of local) {
      perches.push({
        position: pc.position.clone().multiplyScalar(treeScale).add(new THREE.Vector3(x, h, z)),
        tangent: pc.tangent.clone(),
      });
    }
    placed++;
  }
  // a guaranteed fallback perch so guidance always has a target
  if (!perches.length) perches.push({ position: new THREE.Vector3(0, height(0, 0) + 6, 0), tangent: new THREE.Vector3(1, 0, 0) });

  return { group, params, height, perches, size };
}

// keep the eagle above the ground; return true if she touched
function clampToGround(s: FlightState, world: World, clearance = 0.6): boolean {
  const g = world.height(s.pos.x, s.pos.z) + clearance;
  if (s.pos.y < g) {
    s.pos.y = g;
    if (s.vel.y < 0) s.vel.y *= -0.2; // soft bounce
    return true;
  }
  return false;
}

// keep her inside the patch so she never flies off the edge into the fog void
function clampToBounds(s: FlightState, world: World): void {
  const lim = world.size * 0.46;
  for (const ax of ["x", "z"] as const) {
    if (s.pos[ax] > lim && s.vel[ax] > 0) s.vel[ax] -= (s.pos[ax] - lim) * 0.3;
    if (s.pos[ax] < -lim && s.vel[ax] < 0) s.vel[ax] += (-lim - s.pos[ax]) * 0.3;
  }
}

// ---- shared flight body: eagle + state + wing/camera plumbing ------------------------

interface Pilot {
  eagle: Eagle;
  state: FlightState;
  phase: number;
  syrinx: Syrinx;
}

function makePilot(world: World): Pilot {
  const eagle = makeEagle();
  const p = { ...FLIGHT_DEFAULTS };
  const state = inboundState(new THREE.Vector3(0, world.height(0, 0) + 24, -world.size * 0.3), new THREE.Vector3(0, 18, 0), p);
  return { eagle, state, phase: 0, syrinx: new Syrinx() };
}

// pose the wings for a flight condition: flap hard when powered, glide when
// coasting, fold when slow/perched
function poseFlying(eagle: Eagle, state: FlightState, phase: number, perched: number): void {
  const speed = state.vel.length();
  const spread = THREE.MathUtils.clamp(0.55 + speed * 0.03, 0.45, 1) * (1 - perched) + 0.1 * perched;
  const flap = state.flapEffort * (1 - perched);
  eagle.pose({ phase, spread, flap, tailFan: 0.5 * (1 - perched) + 0.2 * perched, beak: 0, theta: phase * Math.PI * 2 });
}

// third-person chase camera
const camPos = new THREE.Vector3();
const heading = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
function chase(stage: { camera: THREE.PerspectiveCamera }, state: FlightState, look: THREE.Vector3, dt: number, back = 7, lift = 2.4): void {
  heading.copy(state.vel).setY(0);
  if (heading.lengthSq() < 1e-4) heading.set(0, 0, 1);
  heading.normalize();
  camPos.copy(state.pos).addScaledVector(heading, -back).addScaledVector(up, lift);
  stage.camera.position.lerp(camPos, Math.min(1, dt * 3));
  look.lerp(state.pos, Math.min(1, dt * 5));
  stage.camera.lookAt(look);
}

// ---- the AI brain: wander, pick a perch, land, scream, take off ----------------------

class AIBrain {
  mode: "wander" | "approach" | "perched" | "takeoff" = "wander";
  ctrl: LandingController | null = null;
  target: PerchTarget;
  private wanderBank = 0;
  private nextWander = 0;
  private perchedUntil = 0;
  private singEnds = 0;
  private seed = 5;
  beak = 0;

  constructor(private pilot: Pilot, private world: World, private params = { ...FLIGHT_DEFAULTS }) {
    this.target = this.pick();
  }

  private hash(n: number): number { const s = Math.sin(n * 91.7 + 47.3) * 9871.23; return s - Math.floor(s); }
  private pick(): PerchTarget {
    const list = this.world.perches;
    const pc = list[Math.floor(this.hash(this.seed++) * list.length) % list.length];
    return { position: pc.position.clone(), tangent: pc.tangent.clone() };
  }

  step(dt: number, t: number): { perched: number } {
    const s = this.pilot.state;
    if (this.mode === "wander") {
      // cruise and meander; after a spell of open-air flying, commit to a perch
      if (this.commitAt < 0) this.commitAt = t + 6 + this.hash(this.seed++) * 6;
      s.pitchCmd += (0.08 - s.pitchCmd) * 0.05 - s.vel.y * 0.03;
      s.flapEffort = 0.5;
      if (t > this.nextWander) { this.wanderBank = (this.hash(this.seed++) - 0.5) * 0.8; this.nextWander = t + 1.5 + this.hash(this.seed++) * 2.5; }
      s.bank += (this.wanderBank - s.bank) * 0.02;
      stepFlight(s, this.params, dt);
      if (t > this.commitAt) { this.target = this.pick(); this.ctrl = new LandingController(s, this.target, this.params); this.mode = "approach"; this.approachUntil = t + 22; }
      return { perched: 0 };
    }
    if (this.mode === "approach") {
      this.ctrl!.step(dt);
      if (this.ctrl!.phase === "perched") {
        this.mode = "perched";
        this.perchedUntil = t + 3 + this.hash(this.seed++) * 2.5;
        this.startSing();
      } else if (t > this.approachUntil) {
        // this perch is proving unreachable — climb out and pick another
        this.mode = "takeoff";
        this.commitAt = -1;
      }
      return { perched: this.ctrl!.phase === "perched" ? this.ctrl!.perchProgress : 0 };
    }
    if (this.mode === "perched") {
      let tgt = 0;
      if (t < this.singEnds && audioOn()) {
        const w = waveform();
        let sum = 0;
        for (let i = 0; i < w.length; i += 8) sum += w[i] * w[i];
        tgt = Math.min(1, Math.sqrt(sum / (w.length / 8)) * 6);
      }
      this.beak += (tgt - this.beak) * Math.min(1, dt * 18);
      if (t > this.perchedUntil && (t > this.singEnds || !audioOn())) {
        // launch toward open air
        s.vel.set((this.hash(this.seed++) - 0.5) * 4, 3, (this.hash(this.seed++) - 0.5) * 4);
        s.flapEffort = 1;
        this.mode = "takeoff";
        this.commitAt = -1; // re-armed on the next wander
        this.nextWander = 0;
      }
      return { perched: 1 };
    }
    // takeoff: full power climb-out for a moment, then back to wander
    s.flapEffort = 1;
    s.pitchCmd = 0.16;
    stepFlight(s, this.params, dt);
    if (s.vel.length() > trimSpeed(this.params) * 1.1) this.mode = "wander";
    return { perched: 0 };
  }

  private commitAt = -1; // armed (set to an absolute time) on first wander frame
  private approachUntil = 0; // give up on an unreachable perch after this time
  private async startSing(): Promise<void> {
    const dur = await this.pilot.syrinx.sing(generatePhrase(Math.floor(this.seed * 7)));
    this.singEnds = performance.now() / 1000 + dur;
  }
}

// ---- keyboard piloting --------------------------------------------------------------

class Keys {
  private down = new Set<string>();
  hovered = false;
  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerenter", () => (this.hovered = true));
    canvas.addEventListener("pointerleave", () => (this.hovered = false));
    window.addEventListener("keydown", (e) => {
      if (!this.hovered) return;
      this.down.add(e.key.toLowerCase());
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.key.toLowerCase()));
  }
  has(...keys: string[]): boolean { return keys.some((k) => this.down.has(k)); }
}

function flyByKeys(state: FlightState, keys: Keys, dt: number): void {
  const bankTarget = keys.has("a", "arrowleft") ? 0.7 : keys.has("d", "arrowright") ? -0.7 : 0;
  state.bank += (bankTarget - state.bank) * Math.min(1, dt * 4);
  const pitchTarget = keys.has("w", "arrowup") ? -0.04 : keys.has("s", "arrowdown") ? 0.18 : 0.08;
  state.pitchCmd += (pitchTarget - state.pitchCmd) * Math.min(1, dt * 4);
  const boost = keys.has(" ", "shift");
  state.flapEffort = boost ? 1 : 0.45;
}

// ---- the world, just to orbit -------------------------------------------------------

export async function mountWorld(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const world = buildWorld(7, 220);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.05, 0.08, 0.14], skyBottom: [0.13, 0.15, 0.19],
    target: [0, world.params.amplitude * 0.4, 0], distance: 130, azimuth: 0.7, elevation: 0.28,
    far: 1100, fog: { color: 0x1a1e26, near: 110, far: 420 },
  });
  stage.scene.add(world.group);
  stage.orbit.maxElevation = 1.2;
  stage.orbit.minDistance = 30;
  stage.orbit.maxDistance = 230;

  // mark the perches with faint motes so the landing targets are legible
  const moteGeo = new THREE.SphereGeometry(0.18, 6, 5);
  const moteMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.5 });
  const motes = new THREE.InstancedMesh(moteGeo, moteMat, world.perches.length);
  const m = new THREE.Matrix4();
  world.perches.forEach((pc, i) => { m.makeTranslation(pc.position.x, pc.position.y, pc.position.z); motes.setMatrixAt(i, m); });
  stage.scene.add(motes);

  shell.setInfo(() => `${world.perches.length} perches on this grown world — every one a bough that can take her weight`);
  return {
    frame() { stage.render(); shell.tick(); },
    dispose: () => stage.dispose(),
  };
}

// ---- you fly ------------------------------------------------------------------------

export async function mountPilot(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const world = buildWorld(11, 220);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.05, 0.08, 0.14], skyBottom: [0.13, 0.15, 0.19],
    target: [0, 18, 0], distance: 8, azimuth: 0.6, elevation: 0.1, far: 1100,
    fog: { color: 0x1a1e26, near: 120, far: 460 },
  });
  stage.scene.add(world.group);
  const pilot = makePilot(world);
  stage.scene.add(pilot.eagle.group);
  const keys = new Keys(shell.canvas);
  const look = new THREE.Vector3().copy(pilot.state.pos);
  let last = performance.now() / 1000;
  let touched = false;

  shell.setInfo(() => keys.hovered ? "A/D steer · W/S climb-dive · Space flap · she stays a bird either way" : "hover and use A/D · W/S · Space to fly her");

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;
      flyByKeys(pilot.state, keys, dt);
      stepFlight(pilot.state, FLIGHT_DEFAULTS, dt);
      touched = clampToGround(pilot.state, world);
      clampToBounds(pilot.state, world);
      pilot.phase = (pilot.phase + dt * FLAP_DEFAULTS.rate * (0.4 + pilot.state.flapEffort)) % 1;
      pilot.eagle.group.position.copy(pilot.state.pos);
      flightQuaternion(pilot.state, pilot.eagle.group.quaternion);
      poseFlying(pilot.eagle, pilot.state, pilot.phase, touched ? 0.3 : 0);
      chase(stage, pilot.state, look, dt);
      stage.renderer.render(stage.scene, stage.camera);
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- AI flies / the whole sandbox (also the hero) -----------------------------------

export async function mountSandbox(container: HTMLElement, opts: { hero?: boolean } = {}): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  const world = buildWorld(opts.hero ? 5 : 7, 220);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.05, 0.08, 0.14], skyBottom: [0.13, 0.15, 0.2],
    target: [0, 18, 0], distance: 10, azimuth: 0.6, elevation: 0.12, far: 1100,
    fog: { color: 0x1a1e26, near: 130, far: 500 },
  });
  stage.scene.add(world.group);

  const pilot = makePilot(world);
  stage.scene.add(pilot.eagle.group);
  const brain = new AIBrain(pilot, world);
  const keys = new Keys(shell.canvas);

  let ai = true;
  if (!opts.hero) {
    shell.button("AI flies", function (this: HTMLButtonElement) {
      ai = !ai;
      this.textContent = ai ? "AI flies" : "you fly";
    });
    shell.setInfo(() => ai ? `autopilot · ${brain.mode} · ${world.perches.length} perches` : (keys.hovered ? "A/D steer · W/S climb-dive · Space flap" : "hover to take the controls"));
  }

  const look = new THREE.Vector3().copy(pilot.state.pos);
  let last = performance.now() / 1000;

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;

      let perched = 0;
      if (ai) {
        const r = brain.step(dt, t);
        perched = r.perched;
        clampToGround(pilot.state, world);
        clampToBounds(pilot.state, world);
        pilot.phase = (pilot.phase + dt * FLAP_DEFAULTS.rate * (0.35 + pilot.state.flapEffort)) % 1;
        pilot.eagle.group.position.copy(pilot.state.pos);
        if (brain.mode === "perched" && brain.ctrl) {
          orientEagle(pilot.eagle.group, pilot.state, brain.target, perched);
          const breath = Math.sin(t * 2.4) * 0.35;
          pilot.eagle.pose({ phase: 0, spread: 0.1, flap: 0, tailFan: 0.22, beak: brain.beak, theta: breath });
          pilot.eagle.rig.bone("head").rotation.x = -brain.beak * 0.5;
        } else {
          flightQuaternion(pilot.state, pilot.eagle.group.quaternion);
          poseFlying(pilot.eagle, pilot.state, pilot.phase, perched);
        }
      } else {
        flyByKeys(pilot.state, keys, dt);
        stepFlight(pilot.state, FLIGHT_DEFAULTS, dt);
        clampToGround(pilot.state, world);
        clampToBounds(pilot.state, world);
        pilot.phase = (pilot.phase + dt * FLAP_DEFAULTS.rate * (0.4 + pilot.state.flapEffort)) % 1;
        pilot.eagle.group.position.copy(pilot.state.pos);
        flightQuaternion(pilot.state, pilot.eagle.group.quaternion);
        poseFlying(pilot.eagle, pilot.state, pilot.phase, 0);
      }

      chase(stage, pilot.state, look, dt, opts.hero ? 8.5 : 7.2, 2.6);
      stage.renderer.render(stage.scene, stage.camera);
      if (!opts.hero) shell.tick();
    },
    dispose: () => { stage.dispose(); pilot.syrinx.dispose(); },
  };
}
