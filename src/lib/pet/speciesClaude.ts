// Three original procedural 3D pet species crafted by Claude Opus 5.5:
//   1. Mochi   — Calico Kitten (cream / apricot / espresso plush, ribbon bell, crescent crown)
//   2. Kitsune — Spirit Fox Pup (alabaster & vermilion, 1 → 2 → 3 → 5 plumed tails, fox-fire, halo)
//   3. Pebble  — Mossy Axolotl (mint & sakura water sprite, frilled gills, lotus tiara, aura ring)
//
// Every rig implements PetModelRig: base resting on y = 0, facing +Z, four-stage
// evolution, clamped look-at, blinking + happy squints, mood body language and all
// six tricks. A shared PetCore owns the transform stack:
//
//   root (placed by the sanctuary) → grow (stage scale) → motion (jumps, spins,
//   figure-8s) → tilt (pitch / roll about a pivot) → inner (pivot compensation)
//   → body (squash & stretch about the floor, petted wiggle) → species parts.

import * as THREE from "three/webgpu";
import type { EvolutionStage, PetModelRig, PetPoseInput, PetTrick, SpeciesDefinition } from "./types";

const TAU = Math.PI * 2;
const PI = Math.PI;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function damp(cur: number, target: number, lambda: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}

/** smoothstep with (edge0, edge1, x) argument order */
function smooth(e0: number, e1: number, x: number): number {
  return THREE.MathUtils.smoothstep(x, e0, e1);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function disposeHierarchy(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) {
      if (Array.isArray(m.material)) m.material.forEach((mm) => mats.add(mm));
      else mats.add(m.material);
    }
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
}

// ----------------------------------------------------------------------------
// Materials & mesh helpers
// ----------------------------------------------------------------------------

/** Velvety plush fur: physical sheen gives the soft "stuffed toy" rim. */
function plush(color: number, sheenColor: number, roughness = 0.88): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    sheen: 0.85,
    sheenColor: new THREE.Color(sheenColor),
    sheenRoughness: 0.45,
  });
}

function glossy(color: number, roughness = 0.3): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function glowMat(color: number, emissive: number, intensity: number, roughness = 0.3): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness, metalness: 0.05 });
}

function additive(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function ell(r: number, sx: number, sy: number, sz: number, mat: THREE.Material, seg = 28): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.72))), mat);
  m.scale.set(sx, sy, sz);
  return m;
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** A flattened coloured blob hugging the surface of a sphere (calico patches, markings). */
function patch(
  parent: THREE.Object3D,
  R: number,
  dx: number,
  dy: number,
  dz: number,
  size: number,
  mat: THREE.Material,
  aspect = 0.82,
  spin = 0,
  flat = 0.3,
): THREE.Mesh {
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 22, 14), mat);
  m.scale.set(1, aspect, flat);
  m.position.copy(dir).multiplyScalar(R - size * flat * 0.5);
  m.quaternion.setFromUnitVectors(Z_AXIS, dir);
  m.rotateZ(spin);
  parent.add(m);
  return m;
}

function tube(points: [number, number, number][], radius: number, mat: THREE.Material, segs = 16, radial = 6): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, radial, false), mat);
}

/** Torus arc. Default orientation spans angle 0 → arc counter-clockwise (∩ for arc = π). */
function arcMesh(radius: number, thick: number, arc: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, thick, 8, 28, arc), mat);
}

/** Four-point twinkle star ✦ built from two crossed stretched octahedra. */
function makeStar(size: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(size, 0);
  const a = new THREE.Mesh(geo, mat);
  a.scale.set(0.3, 1, 0.3);
  const b = new THREE.Mesh(geo, mat);
  b.scale.set(1, 0.3, 0.3);
  g.add(a, b);
  return g;
}

/** Soft glowing orb: solid core + additive halo. */
function makeOrb(coreColor: number, haloColor: number, r: number): { g: THREE.Group; halo: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshBasicMaterial({ color: coreColor }));
  const halo = additive(haloColor, 0.35);
  const haloMesh = new THREE.Mesh(new THREE.SphereGeometry(r * 2.4, 16, 12), halo);
  g.add(core, haloMesh);
  return { g, halo };
}

/** Ring of radiating twinkles that blooms at the peak of a flip. */
function makeBurst(colors: number[]): { group: THREE.Group; update(s: number, t: number): void } {
  const group = new THREE.Group();
  const items: { g: THREE.Group; a: number }[] = [];
  const mats = colors.map((c) => additive(c, 0.9));
  for (let i = 0; i < 8; i++) {
    const g = makeStar(0.04, mats[i % mats.length]);
    group.add(g);
    items.push({ g, a: (i / 8) * TAU + 0.2 });
  }
  group.visible = false;
  return {
    group,
    update(s: number, t: number) {
      group.visible = s > 0.01;
      if (!group.visible) return;
      const R = 0.3 + 0.32 * s;
      for (const it of items) {
        it.g.position.set(Math.cos(it.a) * R, Math.sin(it.a) * R, 0.05);
        it.g.scale.setScalar(Math.max(0.001, s * (0.8 + 0.3 * Math.sin(t * 9 + it.a * 3))));
        it.g.rotation.z = t * 3 + it.a;
      }
      for (const m of mats) m.opacity = 0.9 * s;
    },
  };
}

/** Ornament that blooms in (scale 0 → 1) once the pet reaches its evolution stage. */
class Reveal {
  v = 0;
  constructor(
    readonly obj: THREE.Object3D,
    readonly minStage: number,
  ) {
    obj.visible = false;
    obj.scale.setScalar(0.0001);
  }
  tick(stage: number, dt: number, snap = false): void {
    const target = stage >= this.minStage ? 1 : 0;
    this.v = snap ? target : damp(this.v, target, 4.5, dt);
    this.obj.visible = this.v > 0.01;
    this.obj.scale.setScalar(Math.max(0.0001, this.v));
  }
}

// ----------------------------------------------------------------------------
// Expressive eye: glossy ball, iris, pupil, twin catchlights, rotating eyelid,
// happy ∩ squint arc and a calm ‿ lash line when fully closed.
// ----------------------------------------------------------------------------

interface EyeOptions {
  ball: number;
  iris?: number;
  irisSize?: number;
  pupil: number;
  pupilSlit?: number;
  lid: THREE.Material;
  line: THREE.Material;
}

interface EyeRig {
  group: THREE.Group;
  update(lookX: number, lookY: number, lid: number, happy: number): void;
}

function makeEye(r: number, o: EyeOptions): EyeRig {
  const group = new THREE.Group();
  const ballG = new THREE.Group();
  ballG.scale.set(1, 1.04, 0.62);
  group.add(ballG);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(r, 28, 20),
    new THREE.MeshPhysicalMaterial({ color: o.ball, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }),
  );
  ballG.add(ball);

  const look = new THREE.Group();
  ballG.add(look);
  if (o.iris !== undefined) {
    const iris = new THREE.Mesh(new THREE.SphereGeometry(r * (o.irisSize ?? 0.72), 24, 16), glossy(o.iris, 0.18));
    iris.scale.z = 0.32;
    iris.position.z = r * 0.74;
    look.add(iris);
  }
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.46, 20, 14), glossy(o.pupil, 0.1));
  pupil.scale.set(o.pupilSlit ?? 1, 1.08, 0.3);
  pupil.position.z = r * 0.86;
  look.add(pupil);

  const catchMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const c1 = at(new THREE.Mesh(new THREE.SphereGeometry(r * 0.24, 12, 10), catchMat), r * 0.32, r * 0.34, r * 0.82);
  const c2 = at(new THREE.Mesh(new THREE.SphereGeometry(r * 0.11, 10, 8), catchMat), -r * 0.3, -r * 0.26, r * 0.9);
  ballG.add(c1, c2);

  const lid = new THREE.Mesh(new THREE.SphereGeometry(r * 1.1, 28, 14, 0, TAU, 0, PI * 0.6), o.lid);
  ballG.add(lid);

  const squint = arcMesh(r * 0.72, r * 0.13, PI, o.line);
  squint.position.set(0, -r * 0.18, r * 0.7);
  squint.visible = false;
  group.add(squint);

  const lash = arcMesh(r * 0.62, r * 0.09, PI, o.line);
  lash.rotation.z = PI;
  lash.position.set(0, r * 0.12, r * 0.7);
  lash.visible = false;
  group.add(lash);

  return {
    group,
    update(lookX: number, lookY: number, lidAmt: number, happy: number) {
      const closed = clamp(Math.max(lidAmt, happy), 0, 1);
      lid.rotation.x = closed < 0.5 ? lerp(-0.66 * PI, -0.1 * PI, closed * 2) : lerp(-0.1 * PI, 0.3 * PI, (closed - 0.5) * 2);
      look.position.set(lookX * r * 0.17, lookY * r * 0.15, 0);
      const showSquint = happy > 0.55;
      squint.visible = showSquint;
      squint.scale.setScalar(0.85 + 0.15 * happy);
      lash.visible = !showSquint && closed > 0.86;
      c1.visible = c2.visible = closed < 0.7;
    },
  };
}

// ----------------------------------------------------------------------------
// Trick choreography
// ----------------------------------------------------------------------------

interface TrickOut {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  squash: number;
  centerPivot: boolean;
  flare: number;
  headPitch: number;
  headRoll: number;
  droop: number;
  glow: number;
  wag: number;
  paddle: number;
  mouth: number;
  sparkle: number;
  env: number;
  happy: number;
}

function restTrick(): TrickOut {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, squash: 1, centerPivot: false,
    flare: 0, headPitch: 0, headRoll: 0, droop: 0, glow: 0, wag: 0, paddle: 0,
    mouth: 0, sparkle: 0, env: 0, happy: 0,
  };
}

function computeTrick(trick: PetTrick | null, p: number): TrickOut {
  const o = restTrick();
  if (!trick) return o;
  const plateau = (a: number) => clamp(Math.min(p / a, (1 - p) / a), 0, 1);
  switch (trick) {
    case "hop": {
      o.env = plateau(0.1);
      if (p < 0.22) {
        // anticipation crouch
        const u = easeInOut(p / 0.22);
        o.squash = 1 - 0.24 * u;
        o.headPitch = 0.1 * u;
        o.droop = 0.3 * u;
      } else if (p < 0.8) {
        // joyful arc, stretched on the way up/down, round at the apex
        const u = (p - 0.22) / 0.58;
        o.y = 0.58 * 4 * u * (1 - u);
        const stretch = 1 + 0.16 * Math.pow(Math.abs(1 - 2 * u), 1.5) * (1 - smooth(0.85, 1, u));
        o.squash = lerp(0.76, stretch, smooth(0, 0.12, u));
        o.pitch = -0.12 * Math.sin(u * TAU);
        o.flare = Math.sin(u * PI);
        o.headPitch = -0.16 * Math.sin(u * PI);
        o.paddle = 0.35;
        o.happy = 1;
      } else {
        // soft squash landing
        const u = (p - 0.8) / 0.2;
        o.squash = 1 - 0.2 * Math.sin(u * PI) * (1 - 0.4 * u);
        o.happy = 1;
      }
      break;
    }
    case "spin": {
      o.env = plateau(0.12);
      o.centerPivot = true;
      o.y = 0.3 * Math.sin(p * PI);
      o.yaw = easeInOut(p) * TAU * 2;
      o.squash = 1 - 0.14 * Math.sin(clamp(p / 0.14, 0, 1) * PI) + 0.07 * Math.sin(p * PI);
      o.roll = 0.1 * Math.sin(p * PI);
      o.flare = Math.sin(p * PI);
      o.wag = 1.2 * o.env;
      o.happy = 1;
      break;
    }
    case "sing": {
      const env = plateau(0.18);
      o.env = env;
      o.headPitch = -0.48 * env;
      o.roll = Math.sin(p * PI * 6) * 0.09 * env;
      o.headRoll = Math.sin(p * PI * 6 + 0.7) * 0.16 * env;
      o.squash = 1 + 0.04 * Math.sin(p * PI * 12) * env;
      o.glow = env * (0.6 + 0.4 * Math.sin(p * PI * 16));
      o.mouth = env * (0.5 + 0.5 * Math.abs(Math.sin(p * PI * 8)));
      o.wag = 0.6 * env;
      o.happy = env > 0.3 ? 1 : 0;
      break;
    }
    case "dash": {
      const env = plateau(0.15);
      o.env = env;
      const ang = p * TAU;
      o.x = Math.sin(ang) * 0.45 * env;
      o.z = Math.sin(ang * 2) * 0.22 * env;
      const dx = 0.45 * Math.cos(ang);
      const dz = 0.44 * Math.cos(ang * 2);
      o.yaw = Math.atan2(dx, dz) * env;
      o.pitch = 0.2 * env;
      o.roll = -Math.sin(ang) * 0.22 * env;
      o.y = Math.abs(Math.sin(p * PI * 12)) * 0.05 * env;
      o.squash = 1 - 0.1 * env;
      o.paddle = env;
      o.droop = 0.55 * env; // ears / gills streamlined back
      o.wag = 0.8 * env;
      break;
    }
    case "bow": {
      const env = smooth(0, 0.3, p) * (1 - smooth(0.72, 1, p));
      o.env = env;
      o.pitch = 0.42 * env;
      o.headPitch = 0.28 * env;
      o.droop = env;
      o.wag = 1.4 * env;
      o.squash = 1 - 0.06 * env;
      o.happy = env > 0.4 ? 1 : 0;
      break;
    }
    case "flip": {
      o.env = plateau(0.1);
      o.centerPivot = true;
      if (p < 0.18) {
        const u = easeInOut(p / 0.18);
        o.squash = 1 - 0.25 * u;
        o.droop = 0.3 * u;
      } else if (p < 0.85) {
        const u = (p - 0.18) / 0.67;
        o.y = 0.85 * 4 * u * (1 - u);
        o.pitch = -TAU * easeInOut(u);
        o.squash = lerp(0.75, 1, smooth(0, 0.12, u)) * (1 - 0.1 * Math.sin(u * PI));
        o.flare = 1;
        o.sparkle = Math.pow(Math.sin(u * PI), 4);
        o.glow = 0.6 * o.sparkle;
        o.happy = 1;
      } else {
        const u = (p - 0.85) / 0.15;
        o.squash = 1 - 0.2 * Math.sin(u * PI);
        o.happy = 1;
      }
      break;
    }
  }
  return o;
}

// ----------------------------------------------------------------------------
// Shared rig core: transform stack, moods, blinking, look-at, squash & stretch
// ----------------------------------------------------------------------------

interface PetFrame {
  t: number;
  dt: number;
  breath: number;
  lid: number;
  happyEyes: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  eyeX: number;
  eyeY: number;
  flare: number;
  droop: number;
  perk: number;
  glow: number;
  blush: number;
  wag: number;
  paddle: number;
  mouth: number;
  sparkle: number;
  excite: number;
  dream: number;
  sleepy: number;
  airborne: number;
  pulse: number;
  petted: number;
  trick: PetTrick | null;
  env: number;
}

interface CoreConfig {
  /** Height of the body's centre of mass (flip / spin pivot) */
  centerY: number;
  /** Approximate head height at scale 1 (look-at origin) */
  headY: number;
  /** Z of the front toes (bow / lean pivot) */
  frontZ: number;
  stageScale: [number, number, number, number];
}

class PetCore {
  readonly root = new THREE.Group();
  readonly grow = new THREE.Group();
  readonly motion = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly inner = new THREE.Group();
  readonly body = new THREE.Group();
  stage: EvolutionStage = 1;
  frames = 0;
  private growCur: number;
  private readonly seed = Math.random() * 100;
  private blinkClock = 1.2 + Math.random() * 2;
  private blinkT = -1;
  private readonly sm: Record<string, number> = {};
  private readonly tmp = new THREE.Vector3();
  /** Ground-contact probes (paw soles, toes, tail underside) kept at y >= 0 */
  readonly contacts: THREE.Object3D[] = [];

  constructor(readonly cfg: CoreConfig) {
    this.root.add(this.grow);
    this.grow.add(this.motion);
    this.motion.add(this.tilt);
    this.tilt.add(this.inner);
    this.inner.add(this.body);
    this.growCur = cfg.stageScale[0];
    this.grow.scale.setScalar(this.growCur);
  }

  private s(key: string, target: number, lambda: number, dt: number): number {
    const v = damp(this.sm[key] ?? target, target, lambda, dt);
    this.sm[key] = v;
    return v;
  }

  /** Add a ground-contact probe at a local position inside `parent`. */
  contact(parent: THREE.Object3D, x: number, y: number, z: number): void {
    const o = at(new THREE.Object3D(), x, y, z);
    parent.add(o);
    this.contacts.push(o);
  }

  /** Lift the body so no contact probe sinks below the floor (called after limbs are posed). */
  settle(): void {
    this.root.updateMatrixWorld(true);
    let minY = Infinity;
    for (const c of this.contacts) {
      c.getWorldPosition(this.tmp);
      this.root.worldToLocal(this.tmp);
      minY = Math.min(minY, this.tmp.y);
    }
    if (minY < 0) this.motion.position.y -= minY / this.growCur;
  }

  frame(pose: PetPoseInput): PetFrame {
    this.frames++;
    const dt = clamp(pose.dt, 0, 0.05);
    const t = pose.time;
    const cfg = this.cfg;

    this.growCur = damp(this.growCur, cfg.stageScale[this.stage - 1], 3.5, dt);
    this.grow.scale.setScalar(this.growCur);

    const tr = computeTrick(pose.activeTrick, clamp(pose.trickPhase, 0, 1));
    const petted = clamp(pose.petted, 0, 1);
    const speaking = clamp(pose.speaking, 0, 1);
    const pulse = clamp(pose.attentionPulse, 0, 1);

    // ---- mood body language targets
    let mPitch = 0, mRoll = 0, crouch = 0, lean = 0, puff = 0, glow = 0, droop = 0;
    let perk = 0.15, wag = 0.35, lidBase = 0, lookW = 1, gazeUp = 0, hopB = 0;
    let dream = 0, sleepy = 0, wiggle = 0, joyEyes = 0;
    const smileCycle = (t + this.seed) % 6.5 < 2.4;
    switch (pose.mood) {
      case "happy":
        perk = 0.45; wag = 0.85; hopB = 1; joyEyes = smileCycle ? 1 : 0;
        break;
      case "curious":
        mRoll = 0.3 * (Math.sin(t * 0.33 + this.seed) >= 0 ? 1 : -1);
        perk = 1; lean = 0.07; wag = 0.4;
        break;
      case "playful":
        crouch = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 7.5));
        lean = 0.13; perk = 0.7; wag = 1.25; wiggle = 1;
        break;
      case "thinking":
        gazeUp = 1; mRoll = 0.12 * Math.sin(t * 0.7); lookW = 0.25;
        glow = 0.45 + 0.35 * Math.sin(t * 2.6); lidBase = 0.12; wag = 0.12;
        break;
      case "dreaming":
        crouch = 0.12; mPitch = 0.36; lidBase = 1; lookW = 0; droop = 1; wag = 0.05;
        dream = 1; perk = 0; glow = 0.2 + 0.15 * Math.sin(t * 0.9);
        break;
      case "proud":
        puff = 1; mPitch = -0.2; perk = 0.85; wag = 0.55; joyEyes = smileCycle ? 1 : 0;
        break;
      case "sleepy":
        lidBase = 0.5 + 0.3 * Math.max(0, Math.sin(t * 0.8));
        mPitch = 0.14 + 0.07 * Math.sin(t * 0.55); droop = 0.65; lookW = 0.45; wag = 0.1;
        sleepy = 1; perk = 0;
        break;
      default:
        break;
    }
    perk += clamp(pose.listening, 0, 1) * 0.5;

    mPitch = this.s("mPitch", mPitch, 4, dt);
    mRoll = this.s("mRoll", mRoll, 3, dt);
    crouch = this.s("crouch", crouch, 7, dt);
    lean = this.s("lean", lean, 4, dt);
    puff = this.s("puff", puff, 4, dt);
    glow = this.s("glow", glow, 3, dt);
    droop = this.s("droop", droop, 4, dt);
    perk = this.s("perk", perk, 5, dt);
    wag = this.s("wag", wag, 3, dt);
    lidBase = this.s("lidBase", lidBase, 4, dt);
    lookW = this.s("lookW", lookW, 3, dt);
    gazeUp = this.s("gazeUp", gazeUp, 3, dt);
    hopB = this.s("hopB", hopB, 3, dt);
    dream = this.s("dream", dream, 2, dt);
    sleepy = this.s("sleepy", sleepy, 2, dt);
    wiggle = this.s("wiggle", wiggle, 4, dt);

    // ---- natural blinking (occasional double blink, heavy when sleepy)
    this.blinkClock -= dt;
    if (this.blinkClock <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.blinkClock = Math.random() < 0.18 ? 0.3 : (sleepy > 0.5 ? 1.6 : 2.2) + Math.random() * 3.2;
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt / (sleepy > 0.5 ? 0.42 : 0.17);
      if (this.blinkT >= 1) this.blinkT = -1;
      else blink = Math.sin(this.blinkT * PI);
    }
    const lid = Math.max(blink, lidBase, dream);
    const happyEyes = this.s("happy", Math.max(petted > 0.1 ? 1 : 0, joyEyes, tr.happy) * (1 - dream), 10, dt);

    // ---- look-at (target converted into the pet's own space)
    this.root.updateWorldMatrix(true, false);
    const lt = this.root.worldToLocal(this.tmp.copy(pose.lookTarget));
    const dx = lt.x;
    const dy = lt.y - cfg.headY * this.growCur;
    const dz = lt.z - cfg.frontZ * this.growCur;
    const rawYaw = Math.atan2(dx, Math.max(0.2, dz));
    const rawPitch = -Math.atan2(dy, Math.max(0.2, Math.hypot(dx, dz)));
    const lw = lookW * (1 - tr.env * 0.85);
    const yawT = clamp(rawYaw, -0.75, 0.75) * lw;
    const pitchT = clamp(rawPitch, -0.42, 0.32) * lw + mPitch + tr.headPitch - gazeUp * 0.32;
    const rollT = mRoll + tr.headRoll - yawT * 0.12;
    let headYaw = this.s("hy", yawT, 5, dt);
    let headPitch = this.s("hp", pitchT, 5, dt);
    let headRoll = this.s("hr", rollT, 4, dt);
    headPitch += Math.sin(t * 11) * 0.06 * speaking;
    headRoll += Math.sin(t * 5.5) * 0.04 * speaking + Math.sin(t * 9) * 0.1 * petted;
    headYaw += Math.sin(t * 4.5) * 0.05 * petted;
    const eyeX = this.s("ex", clamp(rawYaw * 1.4, -1, 1) * lw, 14, dt);
    const eyeY = this.s("ey", clamp(-rawPitch * 1.6, -1, 1) * lw + gazeUp * 0.85, 14, dt);

    // ---- whole-body motion
    const breath = Math.sin(t * (dream > 0.5 || sleepy > 0.5 ? 1.3 : 2.3) + this.seed);
    const happyBounce = hopB * Math.pow(Math.max(0, Math.sin(t * 6.2)), 2) * 0.022;
    const playHop = wiggle * Math.pow(Math.max(0, Math.sin(t * 5)), 3) * 0.03;
    const float = dream * (0.5 + 0.5 * Math.sin(t * 0.9)) * 0.014;
    this.motion.position.set(tr.x, tr.y + happyBounce + playHop + float + Math.abs(Math.sin(tr.roll)) * 0.18, tr.z);
    this.motion.rotation.y = tr.yaw;

    if (tr.centerPivot) this.tilt.position.set(0, cfg.centerY, 0);
    else this.tilt.position.set(0, 0, cfg.frontZ);
    this.inner.position.copy(this.tilt.position).multiplyScalar(-1);
    const speedLean = clamp(pose.speed * 0.12, 0, 0.2);
    this.tilt.rotation.set(tr.pitch + lean + speedLean, 0, tr.roll);

    let sy = tr.squash * (1 - crouch) * (1 + 0.018 * breath) * (1 + 0.03 * puff);
    sy *= 1 - 0.05 * petted * (0.5 + 0.5 * Math.sin(t * 13));
    const sxz = (1 / Math.sqrt(sy)) * (1 + 0.035 * puff);
    this.body.scale.set(sxz, sy, sxz * (1 + 0.02 * puff));
    this.body.rotation.z = Math.sin(t * 15) * 0.04 * petted + Math.sin(t * 8) * 0.04 * wiggle;
    this.body.rotation.y = Math.sin(t * 7.5) * 0.08 * petted + Math.sin(t * 4) * 0.1 * wiggle;

    return {
      t,
      dt,
      breath,
      lid,
      happyEyes,
      headYaw,
      headPitch,
      headRoll,
      eyeX,
      eyeY,
      flare: tr.flare,
      droop: clamp(Math.max(droop, tr.droop) - tr.flare * 0.4, 0, 1),
      perk: clamp(perk, 0, 1.5),
      glow: clamp(pulse * 0.55 + glow + tr.glow, 0, 1.6),
      blush: clamp(0.2 + pose.affection * 0.25 + petted * 0.9 + happyEyes * 0.25 + tr.glow * 0.3, 0, 1.4),
      wag: wag + tr.wag + petted * 0.8,
      paddle: clamp(tr.paddle + pose.speed * 0.7, 0, 1.2),
      mouth: clamp(Math.max(speaking * (0.35 + 0.65 * Math.abs(Math.sin(t * 12.5))), tr.mouth), 0, 1),
      sparkle: tr.sparkle,
      excite: clamp(tr.env + petted + wiggle * 0.5 + hopB * 0.25 + perk * 0.15, 0, 1),
      dream,
      sleepy,
      airborne: clamp(tr.y * 3, 0, 1),
      pulse,
      petted,
      trick: pose.activeTrick,
      env: tr.env,
    };
  }
}

/** Joint chain: each joint offset by `step` from its parent; segments built by callback. */
function buildChain(
  base: THREE.Object3D,
  n: number,
  step: THREE.Vector3,
  makeSeg: (i: number, joint: THREE.Group) => void,
): THREE.Group[] {
  const joints: THREE.Group[] = [];
  let parent = base;
  for (let i = 0; i < n; i++) {
    const j = new THREE.Group();
    if (i > 0) j.position.copy(step);
    parent.add(j);
    makeSeg(i, j);
    joints.push(j);
    parent = j;
  }
  return joints;
}

// ============================================================================
// 1. MOCHI — Calico Kitten
// ============================================================================

function buildMochiRig(): PetModelRig {
  const core = new PetCore({ centerY: 0.42, headY: 0.68, frontZ: 0.17, stageScale: [0.8, 0.9, 0.98, 1.05] });
  const { root, body } = core;
  const hitMeshes: THREE.Object3D[] = [];
  const reveals: Reveal[] = [];

  const cream = plush(0xfff3e4, 0xffffff);
  const apricot = plush(0xffb87e, 0xffe4c8);
  const espresso = plush(0x5e3b2a, 0xb89478);
  const peach = plush(0xffd2ae, 0xfff2e4);
  const snow = plush(0xfffaf5, 0xffffff);
  const innerEar = new THREE.MeshStandardMaterial({ color: 0xffb4c2, roughness: 0.55, emissive: 0xff8fa8, emissiveIntensity: 0.12 });
  const padMat = glossy(0xff9fb4, 0.42);
  const noseMat = glossy(0xff8aa0, 0.26);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x4b2a28, roughness: 0.55 });
  const mouthMat = glossy(0x6e2633, 0.5);
  const tongueMat = glossy(0xff7e95, 0.4);
  const whiskerMat = new THREE.MeshStandardMaterial({ color: 0xfffdf8, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.06 });
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff9db0, emissive: 0xff7f9c, emissiveIntensity: 0.2, roughness: 0.8,
    transparent: true, opacity: 0.8, depthWrite: false,
  });

  // ---- torso, bib, haunches, hind feet
  const torso = at(ell(0.27, 1, 0.95, 1.05, cream, 32), 0, 0.29, -0.02);
  body.add(torso);
  hitMeshes.push(torso);
  patch(torso, 0.27, -0.55, 0.55, -0.6, 0.19, apricot, 0.8, 0.4);
  patch(torso, 0.27, 0.75, 0.25, -0.5, 0.15, espresso, 0.75, -0.6);
  patch(torso, 0.27, 0.1, 0.8, -0.55, 0.11, espresso, 0.9, 0.2);
  patch(torso, 0.27, 0.55, -0.2, 0.75, 0.08, peach, 0.85, 0.3);

  const bib = at(ell(0.15, 1.05, 1, 0.62, snow), 0, 0.37, 0.17);
  body.add(bib);
  for (const side of [-1, 1]) {
    const fluff = at(ell(0.07, 1, 1.1, 0.6, snow), side * 0.07, 0.44, 0.16);
    fluff.rotation.z = side * 0.4;
    body.add(fluff);
  }

  for (const side of [-1, 1]) {
    const haunch = at(ell(0.14, 0.9, 1, 1.25, side < 0 ? apricot : cream), side * 0.16, 0.14, -0.07);
    body.add(haunch);
    hitMeshes.push(haunch);
    const foot = at(ell(0.068, 1, 0.55, 1.5, cream), side * 0.17, 0.037, 0.07);
    body.add(foot);
    core.contact(body, side * 0.17, 0, 0.07);
    core.contact(body, side * 0.17, 0.012, 0.16);
    for (let k = -1; k <= 1; k++) {
      body.add(at(ell(0.011, 1, 0.7, 0.6, padMat, 10), side * 0.17 + k * 0.024, 0.03, 0.172));
    }
  }

  // ---- front legs with pink toe beans (pivot at the shoulder)
  const frontLegs: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.095, 0.27, 0.13);
    const leg = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.13, 6, 14), side < 0 ? cream : apricot), 0, -0.1, 0);
    pivot.add(leg);
    hitMeshes.push(leg);
    const paw = at(new THREE.Group(), 0, -0.225, 0.012);
    paw.add(ell(0.062, 1, 0.65, 1.2, snow));
    paw.add(at(ell(0.026, 1.1, 0.35, 0.9, padMat, 12), 0, -0.036, -0.004));
    for (const [tx, tz] of [[-0.027, 0.04], [0, 0.052], [0.027, 0.04]]) {
      paw.add(at(ell(0.012, 1, 0.45, 1, padMat, 10), tx, -0.03, tz));
    }
    pivot.add(paw);
    core.contact(paw, 0, -0.042, 0);
    core.contact(paw, 0, -0.03, 0.06);
    body.add(pivot);
    frontLegs.push({ pivot, side });
  }

  // ---- articulated curling tail
  const tailBase = at(new THREE.Group(), 0, 0.12, -0.26);
  body.add(tailBase);
  const TAIL_N = 9;
  const TAIL_SEG = 0.066;
  const tailMats = [apricot, apricot, cream, apricot, apricot, espresso, espresso, apricot, espresso];
  const tailJoints = buildChain(tailBase, TAIL_N, new THREE.Vector3(0, TAIL_SEG, 0), (i, j) => {
    const r = lerp(0.048, 0.037, i / (TAIL_N - 1));
    const seg = at(new THREE.Mesh(new THREE.CapsuleGeometry(r, TAIL_SEG * 0.85, 6, 12), tailMats[i]), 0, TAIL_SEG * 0.5, 0);
    j.add(seg);
    hitMeshes.push(seg);
  });
  const tailTip = at(new THREE.Group(), 0, TAIL_SEG, 0);
  tailJoints[TAIL_N - 1].add(tailTip);
  tailTip.add(ell(0.04, 1, 1.15, 1, espresso));

  // ---- head
  const neck = at(new THREE.Group(), 0, 0.5, 0.03);
  neck.rotation.order = "YXZ";
  body.add(neck);
  const headG = new THREE.Group();
  neck.add(headG);
  const face = at(new THREE.Group(), 0, 0.16, 0.02);
  headG.add(face);

  const skull = ell(0.26, 1.12, 0.94, 1.0, cream, 36);
  face.add(skull);
  hitMeshes.push(skull);
  patch(skull, 0.26, 0.45, 0.78, 0.25, 0.13, apricot, 0.85, 0.5);
  patch(skull, 0.26, -0.55, 0.7, -0.3, 0.14, espresso, 0.8, -0.4);
  patch(skull, 0.26, 0.65, 0.2, -0.65, 0.12, apricot, 0.9, 0.2);
  // tiny tabby forehead stripes on the apricot patch
  for (let k = -1; k <= 1; k++) {
    patch(skull, 0.262, 0.32 + k * 0.08, 0.85, 0.32, 0.022, espresso, 3, 0, 0.5);
  }

  for (const side of [-1, 1]) {
    const cheek = at(ell(0.11, 1.2, 0.82, 0.8, cream), side * 0.2, -0.08, 0.06);
    face.add(cheek);
    const tuft = at(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 10), cream), side * 0.315, -0.1, 0.04);
    tuft.rotation.z = -side * (PI / 2 + 0.4);
    face.add(tuft);
    face.add(at(ell(0.058, 1.15, 0.85, 0.85, snow), side * 0.045, -0.075, 0.212));
  }
  face.add(at(ell(0.04, 1.1, 0.75, 0.8, snow), 0, -0.112, 0.2));

  const nose = at(ell(0.022, 1.35, 0.8, 0.7, noseMat, 16), 0, -0.04, 0.257);
  face.add(nose);
  face.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })), 0.008, -0.034, 0.272));
  const philtrum = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.014, 4, 6), lineMat), 0, -0.06, 0.262);
  face.add(philtrum);
  const smileG = at(new THREE.Group(), 0, -0.072, 0.266);
  face.add(smileG);
  for (const side of [-1, 1]) {
    const s = at(arcMesh(0.019, 0.0042, PI, lineMat), side * 0.019, 0, 0);
    s.rotation.z = PI;
    smileG.add(s);
  }
  const mouthOpen = at(new THREE.Group(), 0, -0.098, 0.246);
  mouthOpen.add(ell(0.026, 1.2, 1, 0.5, mouthMat, 16));
  mouthOpen.add(at(ell(0.016, 1.2, 0.6, 0.5, tongueMat, 12), 0, -0.01, 0.006));
  face.add(mouthOpen);

  const eyes: EyeRig[] = [];
  for (const side of [-1, 1]) {
    const eye = makeEye(0.075, { ball: 0x2a1a14, iris: 0x5c3b27, irisSize: 0.74, pupil: 0x0a0606, lid: cream, line: lineMat });
    eye.group.position.set(side * 0.105, 0.015, 0.205);
    eye.group.rotation.y = side * 0.2;
    face.add(eye.group);
    eyes.push(eye);
    const blush = at(ell(0.045, 1.3, 0.7, 0.3, blushMat, 16), side * 0.17, -0.06, 0.2);
    blush.rotation.y = side * 0.55;
    face.add(blush);
  }

  // curved whiskers
  const whiskers: { g: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const g = at(new THREE.Group(), side * 0.075, -0.068, 0.24);
    for (const dy of [0.022, 0, -0.022]) {
      g.add(tube([[0, dy * 0.3, 0], [side * 0.09, dy * 0.7 + 0.006, -0.012], [side * 0.19, dy * 1.3 - 0.004, -0.05]], 0.0032, whiskerMat, 12, 5));
    }
    face.add(g);
    whiskers.push({ g, side });
  }

  // sculpted pointed ears (calico: one espresso, one apricot)
  const ears: { pivot: THREE.Group; side: number; tip: THREE.Group }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.155, 0.165, -0.01);
    const outer = at(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.19, 28), side < 0 ? espresso : apricot), 0, 0.095, 0);
    outer.scale.z = 0.55;
    pivot.add(outer);
    hitMeshes.push(outer);
    const inner = at(new THREE.Mesh(new THREE.ConeGeometry(0.066, 0.14, 24), innerEar), 0, 0.072, 0.03);
    inner.scale.z = 0.3;
    pivot.add(inner);
    for (const k of [-1, 1]) {
      const tuft = at(new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 8), snow), k * 0.018, 0.035, 0.04);
      tuft.rotation.z = -k * 0.3;
      pivot.add(tuft);
    }
    const tip = at(new THREE.Group(), 0, 0.205, 0);
    pivot.add(tip);
    face.add(pivot);
    ears.push({ pivot, side, tip });
  }

  // ---- Stage 2: silk ribbon collar with golden bell
  const collarWrap = at(new THREE.Group(), 0, 0.452, 0.03);
  body.add(collarWrap);
  reveals.push(new Reveal(collarWrap, 2));
  const ribbonMat = new THREE.MeshPhysicalMaterial({ color: 0xff7d8f, roughness: 0.35, sheen: 1, sheenColor: new THREE.Color(0xffd0da) });
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 12, 48), ribbonMat);
  collar.rotation.x = PI / 2 + 0.22;
  collarWrap.add(collar);
  const bowG = at(new THREE.Group(), 0, 0.012, 0.2);
  for (const side of [-1, 1]) {
    const loop = at(ell(0.04, 1, 0.6, 0.35, ribbonMat, 16), side * 0.04, 0.012, 0);
    loop.rotation.z = side * 0.45;
    bowG.add(loop);
  }
  bowG.add(ell(0.017, 1, 1, 0.8, ribbonMat, 12));
  collarWrap.add(bowG);
  const bellMat = new THREE.MeshStandardMaterial({ color: 0xffcf5a, metalness: 0.85, roughness: 0.22, emissive: 0xffb347, emissiveIntensity: 0.12 });
  const bellPivot = at(new THREE.Group(), 0, -0.02, 0.205);
  bellPivot.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.004, 6, 14), bellMat), 0, -0.006, 0));
  bellPivot.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.036, 20, 16), bellMat), 0, -0.045, 0));
  const slit = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.03, 4, 8), lineMat), 0, -0.065, 0.026);
  slit.rotation.z = PI / 2;
  bellPivot.add(slit);
  bellPivot.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), lineMat), 0, -0.058, 0.03));
  collarWrap.add(bellPivot);

  // ---- Stage 3: ear-tip sparkles + floating warm chime motes
  const earSparkles: { g: THREE.Group; halo: THREE.MeshBasicMaterial }[] = [];
  const sparkMat = additive(0xfff1b8, 0.95);
  for (const e of ears) {
    const wrap = new THREE.Group();
    e.tip.add(wrap);
    reveals.push(new Reveal(wrap, 3));
    const star = makeStar(0.028, sparkMat);
    const halo = additive(0xffc98a, 0.3);
    star.add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), halo));
    wrap.add(star);
    earSparkles.push({ g: star, halo });
  }
  const motesWrap = new THREE.Group();
  body.add(motesWrap);
  reveals.push(new Reveal(motesWrap, 3));
  const motes: { g: THREE.Group; halo: THREE.MeshBasicMaterial }[] = [];
  const moteColors = [0xffd9a0, 0xffb8c8, 0xfff0c0, 0xffc28a, 0xffe6f0];
  for (let i = 0; i < 5; i++) {
    const m = makeOrb(0xfff6e0, moteColors[i], 0.016);
    motesWrap.add(m.g);
    motes.push(m);
  }

  // ---- Stage 4: orbiting crescent-star crown + tail-tip aurora
  const crownWrap = at(new THREE.Group(), 0, 0.42, 0);
  face.add(crownWrap);
  reveals.push(new Reveal(crownWrap, 4));
  const crownSpin = new THREE.Group();
  crownWrap.add(crownSpin);
  const crownGold = glowMat(0xffe08a, 0xffc04d, 1.1, 0.25);
  const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.017, 10, 32, PI * 1.35), crownGold);
  crescent.rotation.z = -PI * 0.18;
  crownWrap.add(crescent);
  const crownRingMat = additive(0xffd9a8, 0.35);
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.006, 6, 64), crownRingMat);
  crownRing.rotation.x = PI / 2;
  crownSpin.add(crownRing);
  const crownStars: THREE.Group[] = [];
  const crownStarMat = glowMat(0xfff4c8, 0xffd27a, 1.4, 0.2);
  for (let i = 0; i < 5; i++) {
    const s = makeStar(0.026, crownStarMat);
    const a = (i / 5) * TAU;
    s.position.set(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17);
    crownSpin.add(s);
    crownStars.push(s);
  }
  const auroraWrap = new THREE.Group();
  tailTip.add(auroraWrap);
  reveals.push(new Reveal(auroraWrap, 4));
  const auroraMats: THREE.MeshBasicMaterial[] = [];
  const auroraMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const m = additive(0xffb0d0, 0.32 - i * 0.05);
    auroraMats.push(m);
    const mesh = at(new THREE.Mesh(new THREE.SphereGeometry(0.05 + i * 0.03, 16, 12), m), 0, 0.02 + i * 0.03, -i * 0.02);
    auroraWrap.add(mesh);
    auroraMeshes.push(mesh);
  }

  const burst = makeBurst([0xffe2a0, 0xffb3c8, 0xfff6e0]);
  burst.group.position.y = 0.55;
  core.motion.add(burst.group);

  const headAnchor = at(new THREE.Object3D(), 0, 0.56, 0);
  headG.add(headAnchor);

  // ---- animation state
  let headScale = 1.1;
  let earTwitchClock = 3;
  let earTwitchT = -1;
  let earTwitchSide = 1;

  function setEvolution(stage: EvolutionStage): void {
    core.stage = stage;
    if (core.frames === 0) {
      for (const r of reveals) r.tick(stage, 0, true);
      headScale = stage === 1 ? 1.1 : stage === 2 ? 1.04 : 1;
    }
  }

  function update(pose: PetPoseInput): void {
    if (pose.evolution !== core.stage) setEvolution(pose.evolution);
    const f = core.frame(pose);
    const { t, dt } = f;
    for (const r of reveals) r.tick(core.stage, dt);

    // kitten proportions: bigger head while tiny
    headScale = damp(headScale, core.stage === 1 ? 1.1 : core.stage === 2 ? 1.04 : 1, 3, dt);
    headG.scale.setScalar(headScale);
    neck.rotation.set(f.headPitch, f.headYaw, f.headRoll);

    for (const e of eyes) e.update(f.eyeX, f.eyeY, f.lid, f.happyEyes);

    // ears: perk forward, droop sideways, flare in the air, occasional twitch
    earTwitchClock -= dt;
    if (earTwitchClock <= 0) {
      earTwitchClock = 2.5 + Math.random() * 4.5;
      earTwitchT = 0;
      earTwitchSide = Math.random() < 0.5 ? -1 : 1;
    }
    let twitch = 0;
    if (earTwitchT >= 0) {
      earTwitchT += dt / 0.28;
      if (earTwitchT >= 1) earTwitchT = -1;
      else twitch = Math.sin(earTwitchT * TAU) * 0.22;
    }
    for (const e of ears) {
      e.pivot.rotation.z = -e.side * (0.3 + 0.6 * f.droop - 0.12 * f.perk + 0.3 * f.flare) + (e.side === earTwitchSide ? twitch : 0);
      e.pivot.rotation.x = -0.06 + 0.2 * f.perk - 0.45 * f.droop + Math.sin(t * 1.3 + e.side) * 0.03;
    }

    for (const w of whiskers) {
      w.g.rotation.y = w.side * (Math.sin(t * 1.7 + w.side) * 0.05 + f.mouth * 0.12 - f.happyEyes * 0.05);
      w.g.rotation.z = w.side * (Math.sin(t * 2.3) * 0.05 - f.droop * 0.15);
    }

    mouthOpen.visible = f.mouth > 0.04;
    mouthOpen.scale.set(1, Math.max(0.05, f.mouth), 1);
    smileG.position.y = -0.072 - f.mouth * 0.008;
    blushMat.emissiveIntensity = 0.12 + f.blush * 0.65;
    blushMat.opacity = 0.5 + 0.38 * clamp(f.blush, 0, 1);
    nose.scale.set(1.35, 0.8 + Math.sin(t * 3.1) * 0.03, 0.7);

    // front paws: zoomie paddle, polite bow reach, airborne tuck, petted kneading
    const bowEnv = f.trick === "bow" ? f.env : 0;
    for (const l of frontLegs) {
      const paddle = Math.sin(t * 17 + (l.side > 0 ? PI : 0)) * 0.6 * f.paddle;
      const knead = l.side > 0 ? -0.35 * f.petted * (0.5 + 0.5 * Math.sin(t * 7)) : 0;
      l.pivot.rotation.x = paddle + knead - 0.55 * bowEnv - 0.35 * f.airborne;
      l.pivot.rotation.z = l.side * 0.05 * f.airborne;
    }

    // tail: lazy sway ↔ excited perk, curl around the body while dreaming
    const ex = f.excite;
    const baseX = lerp(-1.3, -0.45, clamp(ex * 0.8 + f.perk * 0.25 + f.flare * 0.4, 0, 1)) - 0.25 * f.sleepy;
    const swayAmp = 0.08 + 0.12 * ex + 0.06 * f.wag;
    const swaySpeed = 1.3 + 3 * ex + f.wag;
    for (let i = 0; i < TAIL_N; i++) {
      const u = i / (TAIL_N - 1);
      const awakeX = i === 0 ? baseX : 0.14 + 0.1 * u * (1 - 0.5 * ex) + (u > 0.75 ? 0.25 : 0);
      const awakeZ = Math.sin(t * swaySpeed - i * 0.42) * swayAmp * (0.4 + u);
      const dreamX = i === 0 ? -1.5 : 0;
      const dreamZ = i === 0 ? 0.6 : 0.32 + Math.sin(t * 0.8 - i * 0.3) * 0.03;
      tailJoints[i].rotation.x = lerp(awakeX, dreamX, f.dream);
      tailJoints[i].rotation.z = lerp(awakeZ, dreamZ, f.dream);
    }

    // stage 2 bell sway & charm glow
    if (collarWrap.visible) {
      bellPivot.rotation.x = Math.sin(t * 7) * 0.14 * ex + Math.sin(t * 9) * 0.4 * f.airborne;
      bellPivot.rotation.z = Math.sin(t * 5.3) * 0.12 * ex + f.headYaw * 0.15;
      bellMat.emissiveIntensity = 0.12 + f.pulse * 0.7 + f.glow * 0.35;
    }

    // stage 3 sparkles & chime motes
    if (motesWrap.visible || earSparkles[0].g.parent?.visible) {
      for (let i = 0; i < earSparkles.length; i++) {
        const s = earSparkles[i];
        const tw = 0.7 + 0.3 * Math.sin(t * 5 + i * 2.1) + 0.3 * f.glow;
        s.g.scale.setScalar(tw);
        s.g.rotation.z = t * 1.5 + i;
        s.halo.opacity = 0.2 + 0.3 * f.glow + 0.15 * Math.sin(t * 4 + i);
      }
      const singLift = f.trick === "sing" ? f.env : 0;
      for (let i = 0; i < motes.length; i++) {
        const a = t * 0.5 + (i / motes.length) * TAU;
        const r = 0.42 + 0.05 * Math.sin(t * 0.7 + i);
        motes[i].g.position.set(Math.cos(a) * r, 0.55 + 0.14 * Math.sin(t * 0.9 + i * 1.7) + singLift * 0.2, Math.sin(a) * r);
        motes[i].halo.opacity = 0.22 + 0.25 * f.glow + 0.1 * Math.sin(t * 3 + i * 1.3);
        motes[i].g.scale.setScalar(1 + 0.4 * singLift + 0.2 * f.pulse);
      }
    }

    // stage 4 crown & aurora
    if (crownWrap.visible) {
      crownSpin.rotation.y = t * 0.6;
      crownWrap.position.y = 0.42 + Math.sin(t * 1.4) * 0.015;
      crescent.rotation.y = Math.sin(t * 0.8) * 0.4;
      crownGold.emissiveIntensity = 1 + f.glow * 0.8;
      crownRingMat.opacity = 0.25 + 0.25 * f.glow;
      for (let i = 0; i < crownStars.length; i++) {
        crownStars[i].rotation.y = -t * 2;
        crownStars[i].scale.setScalar(0.8 + 0.3 * Math.sin(t * 4 + i * 1.3));
      }
    }
    if (auroraWrap.visible) {
      for (let i = 0; i < auroraMats.length; i++) {
        auroraMats[i].color.setHSL((t * 0.06 + i * 0.14) % 1, 0.85, 0.68);
        auroraMats[i].opacity = (0.3 - i * 0.05) * (0.7 + 0.3 * Math.sin(t * 2.2 + i) + 0.4 * f.glow);
        auroraMeshes[i].scale.setScalar(1 + 0.15 * Math.sin(t * 1.7 + i * 0.9));
      }
    }

    core.settle();
    burst.update(f.sparkle, t);
  }

  return { root, headAnchor, hitMeshes, update, setEvolution, dispose: () => disposeHierarchy(root) };
}

// ============================================================================
// 2. KITSUNE — Spirit Fox Pup
// ============================================================================

function buildKitsuneRig(): PetModelRig {
  const core = new PetCore({ centerY: 0.42, headY: 0.68, frontZ: 0.15, stageScale: [0.82, 0.92, 1.0, 1.07] });
  const { root, body } = core;
  const hitMeshes: THREE.Object3D[] = [];
  const reveals: Reveal[] = [];

  const alabaster = plush(0xfff8f2, 0xffffff);
  const cream = plush(0xfff0dc, 0xffffff);
  const snow = plush(0xffffff, 0xfff4f8);
  const vermilion = plush(0xf2553a, 0xffb39a, 0.8);
  const crimson = new THREE.MeshStandardMaterial({ color: 0xc8243a, roughness: 0.55, emissive: 0x8a1024, emissiveIntensity: 0.15 });
  const dark = plush(0x3a2430, 0x8a6a7a, 0.8);
  const noseMat = glossy(0x2a1a22, 0.2);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x3a1a20, roughness: 0.5 });
  const mouthMat = glossy(0x6a2030, 0.5);
  const markMat = glowMat(0xff4a3a, 0xff3a2a, 0.35, 0.4);
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xffa0b8, emissive: 0xff7ab8, emissiveIntensity: 0.2, roughness: 0.8,
    transparent: true, opacity: 0.75, depthWrite: false,
  });
  const tailMidMat = plush(0xffc4b0, 0xffe8e0, 0.85);
  const tailTipMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2553a, roughness: 0.8, sheen: 0.8, sheenColor: new THREE.Color(0xffc0a8), sheenRoughness: 0.45,
    emissive: 0xff5a3a, emissiveIntensity: 0.05,
  });

  // ---- torso with plush chest ruff
  const torso = at(ell(0.23, 0.95, 1.1, 1.08, alabaster, 32), 0, 0.27, -0.02);
  body.add(torso);
  hitMeshes.push(torso);
  patch(torso, 0.23, 0, 0.75, -0.65, 0.12, vermilion, 1.3, 0, 0.25);

  body.add(at(ell(0.12, 1.1, 1, 0.7, cream), 0, 0.37, 0.15));
  for (const side of [-1, 1]) body.add(at(ell(0.09, 1, 1.05, 0.7, cream), side * 0.075, 0.31, 0.15));
  for (const [x, y] of [[-0.04, 0.245], [0.04, 0.245], [0, 0.225]]) {
    const tuft = at(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 10), cream), x, y, 0.19);
    tuft.rotation.x = PI - 0.35;
    body.add(tuft);
  }

  for (const side of [-1, 1]) {
    const haunch = at(ell(0.12, 0.85, 1, 1.3, alabaster), side * 0.135, 0.13, -0.07);
    body.add(haunch);
    hitMeshes.push(haunch);
    body.add(at(ell(0.05, 1, 0.55, 1.5, dark), side * 0.15, 0.028, 0.05));
    core.contact(body, side * 0.15, 0, 0.05);
    core.contact(body, side * 0.15, 0.01, 0.12);
  }

  const frontLegs: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.08, 0.29, 0.11);
    const leg = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.16, 6, 12), alabaster), 0, -0.11, 0);
    pivot.add(leg);
    hitMeshes.push(leg);
    pivot.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.039, 0.05, 6, 12), dark), 0, -0.2, 0));
    pivot.add(at(ell(0.046, 1, 0.68, 1.35, dark), 0, -0.256, 0.012));
    core.contact(pivot, 0, -0.287, 0.012);
    core.contact(pivot, 0, -0.275, 0.07);
    body.add(pivot);
    frontLegs.push({ pivot, side });
  }

  // ---- plumed tails (up to five), built from overlapping fluffy ellipsoids
  const tailBase = at(new THREE.Group(), 0, 0.14, -0.22);
  body.add(tailBase);
  const PLUME = [0.055, 0.075, 0.095, 0.108, 0.11, 0.102, 0.085, 0.06];
  const SEG = 0.072;
  const plumeGeo = new THREE.SphereGeometry(1, 22, 16);
  const tails: { fan: THREE.Group; joints: THREE.Group[]; fanCur: number; k: number }[] = [];
  const TAIL_STAGE = [1, 2, 3, 4, 4];
  for (let k = 0; k < 5; k++) {
    const wrap = at(new THREE.Group(), 0, 0, -0.012 * k);
    tailBase.add(wrap);
    reveals.push(new Reveal(wrap, TAIL_STAGE[k]));
    const fan = new THREE.Group();
    wrap.add(fan);
    const joints = buildChain(fan, PLUME.length, new THREE.Vector3(0, SEG, 0), (i, j) => {
      const r = PLUME[i];
      const mat = i < 5 ? alabaster : i === 5 ? tailMidMat : tailTipMat;
      const seg = at(new THREE.Mesh(plumeGeo, mat), 0, SEG * 0.5, 0);
      seg.scale.set(r, r * 1.3, r * 0.95);
      j.add(seg);
      hitMeshes.push(seg);
    });
    const tip = at(new THREE.Mesh(plumeGeo, tailTipMat), 0, SEG * 1.05, 0);
    tip.scale.set(0.035, 0.05, 0.035);
    joints[joints.length - 1].add(tip);
    tails.push({ fan, joints, fanCur: 0, k });
  }
  const FAN: Record<number, number[]> = {
    1: [0, 0, 0, 0, 0],
    2: [-0.3, 0.3, 0, 0, 0],
    3: [-0.55, 0.55, 0, 0, 0],
    4: [-0.52, 0.52, 0, -1.0, 1.0],
  };

  // ---- head
  const neck = at(new THREE.Group(), 0, 0.49, 0.04);
  neck.rotation.order = "YXZ";
  body.add(neck);
  const headG = new THREE.Group();
  neck.add(headG);
  const face = at(new THREE.Group(), 0, 0.15, 0.03);
  headG.add(face);

  const skull = ell(0.205, 1.15, 0.95, 1.0, alabaster, 36);
  face.add(skull);
  hitMeshes.push(skull);
  patch(skull, 0.205, 0, 0.7, -0.7, 0.11, vermilion, 1.4, 0, 0.25);

  for (const side of [-1, 1]) {
    face.add(at(ell(0.1, 1.15, 0.8, 0.8, snow), side * 0.14, -0.07, 0.05));
    const c1 = at(new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.13, 10), snow), side * 0.225, -0.09, 0.03);
    c1.rotation.z = -side * (PI / 2 + 0.35);
    const c2 = at(new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.1, 10), snow), side * 0.2, -0.135, 0.04);
    c2.rotation.z = -side * (PI / 2 + 0.75);
    face.add(c1, c2);
  }
  const snout = at(ell(0.085, 0.82, 0.62, 1.2, snow), 0, -0.065, 0.165);
  face.add(snout);
  face.add(at(ell(0.021, 1.35, 0.85, 0.9, noseMat, 16), 0, -0.043, 0.268));
  face.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })), 0.007, -0.036, 0.284));
  const smileG = at(new THREE.Group(), 0, -0.094, 0.25);
  face.add(smileG);
  for (const side of [-1, 1]) {
    const s = at(arcMesh(0.015, 0.0035, PI, lineMat), side * 0.015, 0, 0);
    s.rotation.z = PI;
    smileG.add(s);
  }
  const mouthOpen = at(ell(0.022, 1.2, 1, 0.6, mouthMat, 14), 0, -0.112, 0.232);
  face.add(mouthOpen);

  const eyes: EyeRig[] = [];
  for (const side of [-1, 1]) {
    const eye = makeEye(0.064, { ball: 0xc7761c, iris: 0xffc24a, irisSize: 0.8, pupil: 0x1a0d08, pupilSlit: 0.55, lid: alabaster, line: lineMat });
    eye.group.position.set(side * 0.095, 0.03, 0.155);
    eye.group.rotation.set(0, side * 0.2, side * 0.22);
    eye.group.scale.set(1.15, 0.95, 1);
    face.add(eye.group);
    eyes.push(eye);
    const flick = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.04, 4, 8), vermilion), side * 0.168, 0.06, 0.128);
    flick.rotation.z = -side * 0.93;
    face.add(flick);
    const blush = at(ell(0.036, 1.3, 0.7, 0.3, blushMat, 14), side * 0.15, -0.045, 0.15);
    blush.rotation.y = side * 0.55;
    face.add(blush);
  }

  // big fluffy upright ears: crimson hollows, vermilion tips, white tufts
  const ears: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.115, 0.14, -0.02);
    const outer = at(new THREE.Mesh(new THREE.ConeGeometry(0.092, 0.27, 28), alabaster), 0, 0.135, 0);
    outer.scale.z = 0.5;
    pivot.add(outer);
    hitMeshes.push(outer);
    const cap = at(new THREE.Mesh(new THREE.ConeGeometry(0.037, 0.1, 20), vermilion), 0, 0.221, 0);
    cap.scale.z = 0.53;
    pivot.add(cap);
    const inner = at(new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.2, 22), crimson), 0, 0.105, 0.022);
    inner.scale.z = 0.28;
    pivot.add(inner);
    for (const k of [-1, 0, 1]) {
      const tuft = at(new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.075, 8), snow), k * 0.022, 0.05 + Math.abs(k) * -0.008, 0.035);
      tuft.rotation.z = -k * 0.35;
      tuft.rotation.x = 0.2;
      pivot.add(tuft);
    }
    face.add(pivot);
    ears.push({ pivot, side });
  }

  // ---- Stage 2: vermilion forehead spirit mark
  const markWrap = at(new THREE.Group(), 0, 0.105, 0.172);
  markWrap.rotation.x = -0.55;
  face.add(markWrap);
  reveals.push(new Reveal(markWrap, 2));
  markWrap.add(at(ell(0.02, 0.8, 1.5, 0.3, markMat, 14), 0, 0, 0));
  markWrap.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 10), markMat), 0, 0.04, 0));
  for (const side of [-1, 1]) markWrap.add(at(ell(0.009, 1, 1, 0.4, markMat, 10), side * 0.038, -0.012, -0.004));

  // ---- Stage 3: orbiting fox-fire wisps
  const wispWrap = new THREE.Group();
  body.add(wispWrap);
  reveals.push(new Reveal(wispWrap, 3));
  const wisps: { g: THREE.Group; halo: THREE.MeshBasicMaterial; flame: THREE.Mesh }[] = [];
  for (let i = 0; i < 4; i++) {
    const cyan = i % 2 === 0;
    const orb = makeOrb(cyan ? 0xe8ffff : 0xfff6d8, cyan ? 0x5ff0ff : 0xffc24a, 0.022);
    const flame = at(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 12), additive(cyan ? 0x7ff8ff : 0xffd27a, 0.45)), 0, 0.05, 0);
    orb.g.add(flame);
    wispWrap.add(orb.g);
    wisps.push({ g: orb.g, halo: orb.halo, flame });
  }

  // ---- Stage 4: sacred halo ring behind the head
  const haloWrap = at(new THREE.Group(), 0, 0.07, -0.17);
  face.add(haloWrap);
  reveals.push(new Reveal(haloWrap, 4));
  const haloSpin = new THREE.Group();
  haloWrap.add(haloSpin);
  const haloGold = glowMat(0xffe7a0, 0xffc45a, 1.3, 0.22);
  haloSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.013, 10, 96), haloGold));
  haloSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.005, 6, 72), haloGold));
  const haloGlow = additive(0xffb86a, 0.3);
  haloSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 10, 72), haloGlow));
  const beadMat = glowMat(0xfff2d0, 0xff9ac0, 1.2, 0.2);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const bead = i % 3 === 0 ? makeStar(0.024, beadMat) : at(new THREE.Group(), 0, 0, 0);
    if (i % 3 !== 0) bead.add(new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), beadMat));
    bead.position.set(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.01);
    haloSpin.add(bead);
  }

  const burst = makeBurst([0x7ff8ff, 0xffd27a, 0xff9ac0]);
  burst.group.position.y = 0.55;
  core.motion.add(burst.group);

  const headAnchor = at(new THREE.Object3D(), 0, 0.6, 0);
  headG.add(headAnchor);

  let earFlickClock = 2.5;
  let earFlickT = -1;

  function setEvolution(stage: EvolutionStage): void {
    core.stage = stage;
    if (core.frames === 0) {
      for (const r of reveals) r.tick(stage, 0, true);
      for (const tl of tails) tl.fanCur = FAN[stage][tl.k];
    }
  }

  function update(pose: PetPoseInput): void {
    if (pose.evolution !== core.stage) setEvolution(pose.evolution);
    const f = core.frame(pose);
    const { t, dt } = f;
    for (const r of reveals) r.tick(core.stage, dt);

    neck.rotation.set(f.headPitch, f.headYaw, f.headRoll);
    for (const e of eyes) e.update(f.eyeX, f.eyeY, f.lid, f.happyEyes);

    earFlickClock -= dt;
    if (earFlickClock <= 0) {
      earFlickClock = 2 + Math.random() * 4;
      earFlickT = 0;
    }
    let flick = 0;
    if (earFlickT >= 0) {
      earFlickT += dt / 0.3;
      if (earFlickT >= 1) earFlickT = -1;
      else flick = Math.sin(earFlickT * TAU) * 0.16;
    }
    for (const e of ears) {
      e.pivot.rotation.z = -e.side * (0.18 + 0.7 * f.droop - 0.08 * f.perk + 0.25 * f.flare) + (e.side > 0 ? flick : 0);
      e.pivot.rotation.x = -0.05 + 0.18 * f.perk - 0.55 * f.droop + Math.sin(t * 1.1 + e.side) * 0.025;
    }

    mouthOpen.visible = f.mouth > 0.04;
    mouthOpen.scale.set(1.2, Math.max(0.05, f.mouth), 0.6);
    smileG.position.y = -0.094 - f.mouth * 0.006;
    snout.scale.set(0.82, 0.62 + f.mouth * 0.02, 1.2);
    blushMat.emissiveIntensity = 0.12 + f.blush * 0.6;
    blushMat.opacity = 0.45 + 0.4 * clamp(f.blush, 0, 1);
    markMat.emissiveIntensity = 0.35 + f.pulse * 1.1 + f.glow * 0.6;

    const bowEnv = f.trick === "bow" ? f.env : 0;
    for (const l of frontLegs) {
      const paddle = Math.sin(t * 18 + (l.side > 0 ? PI : 0)) * 0.65 * f.paddle;
      l.pivot.rotation.x = paddle - 0.6 * bowEnv - 0.3 * f.airborne;
    }

    // tails: fan out per stage, sway with independent phases, flare during tricks
    const fan = FAN[core.stage];
    const lift = clamp(f.perk * 0.2 + f.excite * 0.25 + f.flare * 0.3 - f.droop * 0.3, -0.35, 0.5);
    const swayAmp = 0.06 + 0.08 * f.wag + 0.06 * f.excite;
    const swaySpeed = 1.2 + 1.8 * f.wag;
    for (const tl of tails) {
      tl.fanCur = damp(tl.fanCur, fan[tl.k], 3, dt);
      tl.fan.rotation.z = (tl.fanCur * (1 + f.flare * 0.4) + Math.sin(t * 1.1 + tl.k * 1.7) * 0.05) * (1 - 0.85 * f.dream);
      const dreamSide = tl.k % 2 === 0 ? 1 : -1;
      for (let i = 0; i < tl.joints.length; i++) {
        const u = i / (tl.joints.length - 1);
        const awakeX = i === 0 ? -1.15 + lift : 0.19 + 0.03 * i - f.flare * 0.06;
        const awakeZ = Math.sin(t * swaySpeed - i * 0.5 + tl.k * 1.3) * swayAmp * (0.3 + u);
        const dreamX = i === 0 ? -1.45 + tl.k * 0.06 : 0.02;
        const dreamZ = i === 0 ? dreamSide * 0.5 : dreamSide * (0.3 + Math.sin(t * 0.7 - i * 0.4) * 0.03);
        tl.joints[i].rotation.x = lerp(awakeX, dreamX, f.dream);
        tl.joints[i].rotation.z = lerp(awakeZ, dreamZ, f.dream);
      }
    }
    const tailGlow = core.stage >= 3 ? 0.35 + 0.45 * f.glow + (core.stage >= 4 ? 0.4 : 0) : 0.05 + 0.15 * f.glow;
    tailTipMat.emissiveIntensity = tailGlow * (0.85 + 0.15 * Math.sin(t * 3));

    if (wispWrap.visible) {
      const singBoost = f.trick === "sing" ? f.env : 0;
      for (let i = 0; i < wisps.length; i++) {
        const w = wisps[i];
        const a = t * (0.7 + singBoost * 0.8) + (i / wisps.length) * TAU;
        const r = 0.46 + 0.05 * Math.sin(t * 1.3 + i);
        w.g.position.set(Math.cos(a) * r, 0.5 + 0.12 * Math.sin(t * 1.1 + i * 1.9), Math.sin(a) * r);
        w.halo.opacity = 0.25 + 0.3 * f.glow + 0.1 * Math.sin(t * 6 + i * 2);
        w.flame.scale.set(1, 0.85 + 0.35 * Math.sin(t * 9 + i * 1.7), 1);
        w.flame.rotation.z = Math.sin(t * 4 + i) * 0.2;
        w.g.scale.setScalar(1 + 0.25 * f.pulse + 0.3 * singBoost);
      }
    }
    if (haloWrap.visible) {
      haloSpin.rotation.z = t * 0.25;
      haloGold.emissiveIntensity = 1.1 + 0.9 * f.glow + 0.4 * f.pulse;
      haloGlow.opacity = 0.2 + 0.3 * f.glow + 0.08 * Math.sin(t * 2);
      haloWrap.scale.multiplyScalar(1 + 0.02 * Math.sin(t * 1.6));
    }

    core.settle();
    burst.update(f.sparkle, t);
  }

  return { root, headAnchor, hitMeshes, update, setEvolution, dispose: () => disposeHierarchy(root) };
}

// ============================================================================
// 3. PEBBLE — Mossy Axolotl
// ============================================================================

function buildPebbleRig(): PetModelRig {
  const core = new PetCore({ centerY: 0.38, headY: 0.55, frontZ: 0.2, stageScale: [0.95, 1.03, 1.1, 1.17] });
  const { root, body } = core;
  const hitMeshes: THREE.Object3D[] = [];
  const reveals: Reveal[] = [];

  const mint = plush(0xb8f2d6, 0xf0fff8, 0.55);
  const belly = plush(0xe6fff2, 0xffffff, 0.6);
  const sakura = new THREE.MeshPhysicalMaterial({ color: 0xff9cc0, roughness: 0.45, sheen: 0.6, sheenColor: new THREE.Color(0xffd6e6), clearcoat: 0.4 });
  const frondMat = new THREE.MeshPhysicalMaterial({
    color: 0xffc2d8, roughness: 0.5, sheen: 0.7, sheenColor: new THREE.Color(0xffeef4),
    emissive: 0xff8ab8, emissiveIntensity: 0.08,
  });
  const gillTipMat = glowMat(0xffd6e8, 0xff7ab8, 0.15, 0.3);
  const finMat = new THREE.MeshPhysicalMaterial({
    color: 0xd4fff0, roughness: 0.2, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    iridescence: 0.5, iridescenceIOR: 1.35, emissive: 0x9ff7e0, emissiveIntensity: 0.08, sheen: 0.4, sheenColor: new THREE.Color(0xffd6f0),
  });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x5a2a44, roughness: 0.5 });
  const mouthMat = glossy(0x7a2a4a, 0.45);
  const toeMat = plush(0xffd0e0, 0xffffff, 0.6);
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff9ec4, emissive: 0xff7ab0, emissiveIntensity: 0.22, roughness: 0.8,
    transparent: true, opacity: 0.8, depthWrite: false,
  });
  const leafMat = new THREE.MeshPhysicalMaterial({ color: 0x86d97a, roughness: 0.6, sheen: 0.6, sheenColor: new THREE.Color(0xd8ffc8), emissive: 0x4fbf5a, emissiveIntensity: 0.1 });
  const mossMat = plush(0x6fc46a, 0xc8ffb8, 0.95);

  // ---- chubby sitting body
  const torso = at(ell(0.26, 1.05, 0.92, 1.12, mint, 36), 0, 0.245, -0.02);
  body.add(torso);
  hitMeshes.push(torso);
  for (const [x, z] of [[0, 0.06], [0.12, -0.02], [-0.12, -0.02], [0, -0.12]]) core.contact(body, x, 0.012, z);
  body.add(at(ell(0.2, 1, 1, 0.8, belly), 0, 0.22, 0.085));
  // a few darker mint freckles along the back
  const freckle = plush(0x8fe0bd, 0xe0fff0, 0.6);
  for (const [x, y, z] of [[0.4, 0.6, -0.7], [-0.45, 0.5, -0.75], [0.1, 0.8, -0.6], [-0.15, 0.3, -0.95]]) {
    patch(torso, 0.26, x, y, z, 0.035, freckle, 1, 0, 0.4);
  }

  // dorsal fin running down the back
  const finGeo = new THREE.SphereGeometry(1, 20, 14);
  const dorsal: { m: THREE.Mesh; phi: number }[] = [];
  for (const phi of [0.6, 0.9, 1.2, 1.5, 1.8]) {
    const m = new THREE.Mesh(finGeo, finMat);
    const h = 0.05 + 0.02 * Math.sin(((phi - 0.6) / 1.2) * PI);
    m.scale.set(0.008, h, 0.085);
    m.position.set(0, 0.245 + 0.239 * Math.cos(phi) + Math.cos(phi) * h * 0.6, -0.02 - 0.291 * Math.sin(phi) - Math.sin(phi) * h * 0.6);
    m.rotation.x = -phi;
    body.add(m);
    dorsal.push({ m, phi });
  }

  // ---- stubby limbs with tiny toes
  const arms: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.18, 0.16, 0.13);
    pivot.rotation.z = side * 0.55;
    const arm = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.06, 6, 12), mint), 0, -0.055, 0);
    pivot.add(arm);
    hitMeshes.push(arm);
    const hand = at(new THREE.Group(), 0, -0.1, 0.005);
    hand.add(ell(0.042, 1.1, 0.6, 1.2, mint));
    for (let k = 0; k < 4; k++) {
      hand.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), toeMat), -0.027 + k * 0.018, -0.02, 0.035 + (k === 1 || k === 2 ? 0.006 : 0)));
    }
    pivot.add(hand);
    core.contact(hand, 0, -0.032, 0.035);
    body.add(pivot);
    arms.push({ pivot, side });
  }
  const legs: { pivot: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const pivot = at(new THREE.Group(), side * 0.2, 0.045, 0.05);
    pivot.rotation.y = side * 0.55;
    const leg = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.05, 6, 12), mint), 0, 0, 0.035);
    leg.rotation.x = PI / 2;
    pivot.add(leg);
    hitMeshes.push(leg);
    pivot.add(at(ell(0.045, 1.2, 0.55, 1, mint), 0, -0.015, 0.085));
    for (let k = 0; k < 4; k++) {
      pivot.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), toeMat), -0.03 + k * 0.02, -0.022, 0.12 + (k === 1 || k === 2 ? 0.006 : 0)));
    }
    core.contact(pivot, 0, -0.034, 0.12);
    core.contact(pivot, 0, -0.04, 0.06);
    body.add(pivot);
    legs.push({ pivot, side });
  }

  // ---- undulating finned tail
  const tailBase = at(new THREE.Group(), 0, 0.1, -0.26);
  tailBase.rotation.x = -0.08;
  body.add(tailBase);
  const TR = [0.1, 0.09, 0.078, 0.065, 0.052, 0.04, 0.028];
  const TFIN = [0.03, 0.045, 0.055, 0.06, 0.055, 0.045, 0.035];
  const TSEG = 0.08;
  const tailJoints = buildChain(tailBase, TR.length, new THREE.Vector3(0, 0, -TSEG), (i, j) => {
    const seg = at(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mint), 0, 0, -TSEG * 0.5);
    seg.scale.set(TR[i] * 0.6, TR[i], TSEG * 0.85);
    j.add(seg);
    hitMeshes.push(seg);
    core.contact(j, 0, -TR[i], -TSEG * 0.5);
    const fin = at(new THREE.Mesh(finGeo, finMat), 0, TR[i] * 0.85 + TFIN[i] * 0.45, -TSEG * 0.5);
    fin.scale.set(0.007, TFIN[i], TSEG * 0.8);
    j.add(fin);
    if (i >= 3) {
      const lower = at(new THREE.Mesh(finGeo, finMat), 0, -TR[i] * 0.75, -TSEG * 0.5);
      lower.scale.set(0.006, TFIN[i] * 0.4, TSEG * 0.7);
      j.add(lower);
    }
  });
  const tailEnd = at(new THREE.Mesh(finGeo, finMat), 0, 0.01, -TSEG * 1.05);
  tailEnd.scale.set(0.007, 0.045, 0.06);
  tailJoints[tailJoints.length - 1].add(tailEnd);

  // ---- big round head
  const neck = at(new THREE.Group(), 0, 0.42, 0.05);
  neck.rotation.order = "YXZ";
  body.add(neck);
  const headG = new THREE.Group();
  neck.add(headG);
  const face = at(new THREE.Group(), 0, 0.13, 0.03);
  headG.add(face);

  const skull = ell(0.25, 1.32, 0.88, 1.0, mint, 40);
  face.add(skull);
  hitMeshes.push(skull);
  face.add(at(ell(0.17, 1.35, 0.6, 0.7, belly), 0, -0.1, 0.1));

  const eyes: EyeRig[] = [];
  for (const side of [-1, 1]) {
    const eye = makeEye(0.056, { ball: 0x231a2b, iris: 0x3a2d48, irisSize: 0.7, pupil: 0x08060c, lid: mint, line: lineMat });
    eye.group.position.set(side * 0.15, 0.04, 0.19);
    eye.group.rotation.y = side * 0.35;
    face.add(eye.group);
    eyes.push(eye);
    const blush = at(ell(0.04, 1.4, 0.8, 0.3, blushMat, 16), side * 0.2, -0.035, 0.188);
    blush.rotation.y = side * 0.6;
    face.add(blush);
  }
  const smile = at(arcMesh(0.16, 0.0065, PI * 0.5, lineMat), 0, 0.073, 0.233);
  smile.rotation.z = -0.75 * PI;
  face.add(smile);
  const mouthOpen = at(ell(0.034, 1.5, 1, 0.45, mouthMat, 16), 0, -0.092, 0.222);
  face.add(mouthOpen);

  // six feathery gill stalks (three per side) with ruffled frill fronds
  const gills: { stalk: THREE.Group; fronds: THREE.Group; side: number; k: number; a: number }[] = [];
  const GILL_A = [0.35, 0.85, 1.35];
  const GILL_L = [0.25, 0.23, 0.19];
  const GILL_Y = [0.09, 0.02, -0.05];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const stalk = at(new THREE.Group(), side * 0.27, 0.05 + GILL_Y[k], -0.05 + k * 0.02);
      const L = GILL_L[k];
      const stem = tube([[0, 0, 0], [side * 0.008, L * 0.5, 0], [-side * 0.012, L, 0.01]], 0.019, sakura, 14, 8);
      stalk.add(stem);
      hitMeshes.push(stem);
      const fronds = new THREE.Group();
      stalk.add(fronds);
      for (let j = 0; j < 6; j++) {
        const y = L * (0.28 + 0.13 * j);
        const r = 0.03 * (1 - j * 0.09);
        for (const fs of [-1, 1]) {
          const fr = at(ell(r, 0.45, 1.25, 0.3, frondMat, 12), fs * 0.034, y + 0.012, 0);
          fr.rotation.z = -fs * 0.7;
          fronds.add(fr);
        }
      }
      stalk.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), gillTipMat), -side * 0.012, L, 0.01));
      face.add(stalk);
      gills.push({ stalk, fronds, side, k, a: GILL_A[k] });
    }
  }

  // ---- Stage 2: mossy-leaf ear sprouts
  const sproutWrap = new THREE.Group();
  face.add(sproutWrap);
  reveals.push(new Reveal(sproutWrap, 2));
  const sprouts: { g: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const g = at(new THREE.Group(), side * 0.11, 0.195, 0);
    g.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.04, 4, 8), mossMat), 0, 0.02, 0));
    const leaf = at(ell(0.05, 0.5, 1, 0.14, leafMat, 16), side * 0.02, 0.075, 0);
    leaf.rotation.z = -side * 0.5;
    g.add(leaf);
    const leaf2 = at(ell(0.03, 0.5, 1, 0.14, leafMat, 12), -side * 0.018, 0.058, 0.004);
    leaf2.rotation.z = side * 0.6;
    g.add(leaf2);
    sproutWrap.add(g);
    sprouts.push({ g, side });
  }
  for (const [x, z] of [[-0.05, -0.05], [0.04, -0.06], [0, 0.02], [0.08, -0.01]]) {
    sproutWrap.add(at(ell(0.022, 1.2, 0.6, 1.2, mossMat, 12), x, 0.205, z));
  }

  // ---- Stage 3: orbiting water-droplet pearls
  const pearlWrap = new THREE.Group();
  body.add(pearlWrap);
  reveals.push(new Reveal(pearlWrap, 3));
  const dropMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8f8ff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.78,
    emissive: 0x6fe8ff, emissiveIntensity: 0.45,
  });
  const pearls: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), dropMat));
    g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.0185, 0.03, 14), dropMat), 0, 0.03, 0));
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })), 0.009, 0.01, 0.02));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), additive(0x7ff0ff, 0.18)));
    pearlWrap.add(g);
    pearls.push(g);
  }

  // ---- Stage 4: crystalline lotus tiara + bioluminescent aura ring
  const tiaraWrap = at(new THREE.Group(), 0, 0.33, 0);
  face.add(tiaraWrap);
  reveals.push(new Reveal(tiaraWrap, 4));
  const tiara = new THREE.Group();
  tiaraWrap.add(tiara);
  const crystal = new THREE.MeshPhysicalMaterial({
    color: 0xe6fff6, emissive: 0x8ff5d0, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0.1,
    clearcoat: 1, transparent: true, opacity: 0.88, iridescence: 0.8,
  });
  const crystalPink = new THREE.MeshPhysicalMaterial({
    color: 0xffe0ee, emissive: 0xff9ac8, emissiveIntensity: 0.6, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.9,
  });
  const petalGeo = new THREE.OctahedronGeometry(0.05, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const holder = new THREE.Group();
    holder.rotation.y = a;
    const petal = at(new THREE.Mesh(petalGeo, crystal), 0, 0.03, 0.07);
    petal.scale.set(0.45, 1.3, 0.25);
    petal.rotation.x = 0.6;
    holder.add(petal);
    tiara.add(holder);
  }
  for (let i = 0; i < 5; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (i / 5) * TAU + 0.3;
    const petal = at(new THREE.Mesh(petalGeo, crystalPink), 0, 0.035, 0.035);
    petal.scale.set(0.35, 0.9, 0.2);
    petal.rotation.x = 0.3;
    holder.add(petal);
    tiara.add(holder);
  }
  const dew = at(new THREE.Mesh(new THREE.SphereGeometry(0.028, 18, 14), dropMat), 0, 0.05, 0);
  tiara.add(dew);
  const tiaraGlow = additive(0x9ff7e0, 0.3);
  tiara.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), tiaraGlow), 0, 0.05, 0));
  const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 6, 48), crystal);
  circlet.rotation.x = PI / 2;
  tiara.add(circlet);

  const auraWrap = at(new THREE.Group(), 0, 0.05, 0);
  body.add(auraWrap);
  reveals.push(new Reveal(auraWrap, 4));
  const auraSpin = new THREE.Group();
  auraSpin.rotation.x = PI / 2;
  auraWrap.add(auraSpin);
  const auraMat = additive(0x5ef0b5, 0.5);
  const auraSoft = additive(0x9ff0ff, 0.18);
  auraSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.01, 8, 96), auraMat));
  auraSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.04, 10, 96), auraSoft));
  const beadMat = additive(0xd8fff0, 0.8);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    auraSpin.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), beadMat), Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0));
  }

  const burst = makeBurst([0x9ff7e0, 0xff9cc0, 0xc8f8ff]);
  burst.group.position.y = 0.5;
  core.motion.add(burst.group);

  const headAnchor = at(new THREE.Object3D(), 0, 0.52, 0);
  headG.add(headAnchor);

  function setEvolution(stage: EvolutionStage): void {
    core.stage = stage;
    if (core.frames === 0) for (const r of reveals) r.tick(stage, 0, true);
  }

  function update(pose: PetPoseInput): void {
    if (pose.evolution !== core.stage) setEvolution(pose.evolution);
    const f = core.frame(pose);
    const { t, dt } = f;
    for (const r of reveals) r.tick(core.stage, dt);
    const stage = core.stage;

    neck.rotation.set(f.headPitch, f.headYaw, f.headRoll);
    for (const e of eyes) e.update(f.eyeX, f.eyeY, f.lid, f.happyEyes);

    mouthOpen.visible = f.mouth > 0.04;
    mouthOpen.scale.set(1.5, Math.max(0.05, f.mouth), 0.45);
    smile.scale.set(1 + 0.08 * f.happyEyes, 1 + 0.15 * f.happyEyes, 1);
    blushMat.emissiveIntensity = 0.14 + f.blush * 0.7;
    blushMat.opacity = 0.5 + 0.38 * clamp(f.blush, 0, 1);

    // gills breathe, pulse with the LLM's attention, stream back on zoomies, droop when sleepy
    const sing = f.trick === "sing" ? f.env : 0;
    for (const g of gills) {
      const wave = Math.sin(t * (2 + f.excite * 2) + g.k * 0.9 + g.side) * (0.07 + 0.05 * f.excite);
      const ang = g.a + wave + 0.4 * f.droop - 0.15 * f.perk + 0.2 * f.flare;
      g.stalk.rotation.set(-0.25 - 0.35 * f.droop + 0.05 * Math.sin(t * 1.6 + g.k), 0, -g.side * ang);
      const fluff = 1 + 0.22 * f.pulse * (0.5 + 0.5 * Math.sin(t * 4 + g.k * 1.3)) + 0.15 * sing + 0.1 * f.petted;
      g.fronds.scale.set(fluff, 1, 1);
    }
    const tipBase = stage >= 2 ? 0.9 : 0.15;
    gillTipMat.emissiveIntensity = tipBase * (0.6 + 0.6 * f.pulse) + f.glow * 0.5;
    frondMat.emissiveIntensity = 0.06 + 0.2 * f.glow + (stage >= 2 ? 0.08 : 0);

    // limbs: gentle paddle idle, waving when happy/petted, frantic paddling in zoomies
    const wave = clamp(f.happyEyes * 0.6 + f.petted, 0, 1);
    for (const a of arms) {
      const pad = Math.sin(t * 18 + (a.side > 0 ? PI : 0)) * 0.8 * f.paddle;
      a.pivot.rotation.x = Math.sin(t * 2 + a.side) * 0.12 + pad - 0.4 * f.airborne;
      a.pivot.rotation.z = a.side * (0.55 + 0.35 * wave * (0.5 + 0.5 * Math.sin(t * 9 + (a.side > 0 ? 0 : 1.2))) + 0.3 * f.flare);
    }
    for (const l of legs) {
      l.pivot.rotation.y = l.side * (0.55 + Math.sin(t * 18 + (l.side > 0 ? 0 : PI)) * 0.35 * f.paddle + Math.sin(t * 1.5) * 0.05);
    }

    // tail & fin undulation (travelling wave)
    const amp = 0.12 + 0.12 * f.excite + 0.08 * f.wag + 0.2 * f.paddle;
    const spd = 2.6 + 3 * f.excite + 6 * f.paddle;
    for (let i = 0; i < tailJoints.length; i++) {
      const u = i / (tailJoints.length - 1);
      const curl = lerp(0.08, 0.32, f.dream);
      tailJoints[i].rotation.y = Math.sin(t * spd - i * 0.8) * amp * (0.3 + u) * (1 - f.dream * 0.7) + (i > 0 ? curl : 0);
      tailJoints[i].rotation.x = i === 0 ? 0 : Math.sin(t * spd * 0.5 - i * 0.6) * 0.02;
    }
    for (const d of dorsal) {
      d.m.rotation.z = Math.sin(t * spd - d.phi * 3) * 0.12 * (0.5 + f.excite);
    }
    if (stage >= 3) {
      finMat.emissive.setHSL((t * 0.07) % 1, 0.65, 0.6);
      finMat.emissiveIntensity = 0.22 + 0.18 * Math.sin(t * 1.7) + 0.3 * f.glow;
      finMat.iridescence = 1;
    } else {
      finMat.emissive.setHex(0x9ff7e0);
      finMat.emissiveIntensity = 0.06 + 0.15 * f.glow;
      finMat.iridescence = 0.5;
    }

    if (sproutWrap.visible) {
      for (const s of sprouts) {
        s.g.rotation.z = s.side * (-0.15 + Math.sin(t * 1.8 + s.side) * 0.1 - 0.3 * f.droop + 0.25 * f.flare);
      }
      leafMat.emissiveIntensity = 0.08 + 0.3 * f.glow;
    }
    if (pearlWrap.visible) {
      for (let i = 0; i < pearls.length; i++) {
        const a = t * (0.55 + sing * 0.6) + (i / pearls.length) * TAU;
        const r = 0.44 + 0.04 * Math.sin(t * 1.2 + i * 1.7);
        pearls[i].position.set(Math.cos(a) * r, 0.42 + 0.16 * Math.sin(t * 0.8 + i * 2.2), Math.sin(a) * r);
        pearls[i].rotation.z = Math.sin(t * 2 + i) * 0.3;
      }
      dropMat.emissiveIntensity = 0.35 + 0.5 * f.glow + 0.25 * f.pulse;
    }
    if (tiaraWrap.visible) {
      tiaraWrap.position.y = 0.33 + Math.sin(t * 1.3) * 0.018;
      tiara.rotation.y = t * 0.4;
      crystal.emissiveIntensity = 0.5 + 0.6 * f.glow;
      crystalPink.emissiveIntensity = 0.5 + 0.5 * f.pulse;
      tiaraGlow.opacity = 0.2 + 0.25 * f.glow + 0.08 * Math.sin(t * 2.4);
    }
    if (auraWrap.visible) {
      auraSpin.rotation.z = t * 0.3;
      const pulse = 1 + 0.04 * Math.sin(t * 1.4) + 0.06 * f.pulse;
      auraSpin.scale.set(pulse, pulse, 1);
      auraMat.opacity = 0.35 + 0.3 * f.glow + 0.1 * Math.sin(t * 2);
      auraSoft.opacity = 0.12 + 0.15 * f.glow;
    }

    core.settle();
    burst.update(f.sparkle, t);
  }

  return { root, headAnchor, hitMeshes, update, setEvolution, dispose: () => disposeHierarchy(root) };
}

// ============================================================================
// Species catalog entries
// ============================================================================

export const CLAUDE_SPECIES: SpeciesDefinition[] = [
  {
    id: "mochi",
    name: "Mochi",
    species: "Calico Kitten",
    author: "Claude Opus 5.5",
    accentHex: "#ff9e7d",
    tagline: "A squishy calico who purrs in warm chimes and naps in sunbeams.",
    personalitySeed:
      "Mochi is a soft, sleepy-sweet calico kitten. Gentle, a little mischievous, loves sunbeams, yarn, " +
      "warm milk and quiet company. Speaks in short cozy sentences, purrs when happy, and gets curious about small sounds.",
    favoriteWords: ["purr", "sunbeam", "mrrp", "cozy", "yarn", "nap", "bell", "warm"],
    voicePitch: 523.25,
    buildRig: buildMochiRig,
  },
  {
    id: "kitsune",
    name: "Kitsune",
    species: "Spirit Fox Pup",
    author: "Claude Opus 5.5",
    accentHex: "#ff7ab8",
    tagline: "A spirit fox pup whose tails bloom with every lesson learned.",
    personalitySeed:
      "Kitsune is a graceful, playful spirit fox pup from a moonlit shrine forest. Clever, curious and kind, " +
      "fond of riddles, lanterns and falling petals. Speaks with gentle wonder and grows a new tail of light with each memory.",
    favoriteWords: ["lantern", "petal", "moon", "riddle", "kon", "shrine", "glow", "wish"],
    voicePitch: 587.33,
    buildRig: buildKitsuneRig,
  },
  {
    id: "pebble",
    name: "Pebble",
    species: "Mossy Axolotl",
    author: "Claude Opus 5.5",
    accentHex: "#5ef0b5",
    tagline: "A beaming pond sprite with frilly gills and a pocketful of dewdrops.",
    personalitySeed:
      "Pebble is a joyful, round axolotl water sprite who lives in a mossy pond. Endlessly cheerful, slow and wiggly, " +
      "loves bubbles, lily pads, rain and smooth stones. Speaks in bubbly, upbeat phrases and smiles at everything.",
    favoriteWords: ["blub", "bubble", "lily", "dewdrop", "pond", "wiggle", "moss", "splash"],
    voicePitch: 440.0,
    buildRig: buildPebbleRig,
  },
];
