// The figures of Feather & Bone part 2: skin weights painted on the lofted
// body (with the falloff and the pinned components exposed), the skeleton
// x-ray with forward kinematics on sliders, the full puppet with pose dials
// and preset poses, and the eagle brought to idle life by fidget timers.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D, addGroundDisc } from "../lib/stage3d";
import { BIRD_BONES } from "../lib/bird/skeleton";
import { buildEagleBody, addFace } from "../lib/bird/body";
import {
  createSkinnedBird,
  computeSkinWeights,
  pinWeights,
  bakeSkin,
  attachRider,
  SkeletonViz,
  WEIGHT_POWER_DEFAULT,
  type BirdRig,
} from "../lib/bird/rig";
import { FeatherCoat, COAT_POSE_REST, type CoatPose } from "../lib/bird/feathers";
import { createEagle } from "../lib/bird/bird";
import { EAGLE_STAGE } from "./birdModel";

// one distinct color per joint, walked around the hue wheel by golden ratio
const jointColor = (i: number): THREE.Color => new THREE.Color().setHSL((i * 0.618034) % 1, 0.62, 0.6);

// a small stress pose: enough articulation to make bad weights embarrassing
function stressPose(rig: BirdRig): void {
  rig.setEulerDeg("head", -14, 42, 0);
  rig.setEulerDeg("neck", -16, 14, 0);
  rig.setEulerDeg("tailFan", -26, 16, 0);
  rig.setEulerDeg("body", 0, 0, 8);
}

// ---- skin weights, painted on the bird ---------------------------------------------

export async function mountRigWeights(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, EAGLE_STAGE);
  addGroundDisc(stage.scene, { radius: 1.5, shadowRadius: 0.35 });

  const built = buildEagleBody();
  bakeSkin(built.geometry, built.components);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const { mesh, rig } = createSkinnedBird(built.geometry, material);
  stage.scene.add(mesh);

  let power = WEIGHT_POWER_DEFAULT;
  let mode: "blend" | "single" = "blend";
  let joint = 2; // start on the head — the most legible territory
  let posed = false;
  let timer = 0;

  const recolor = (): void => {
    const idx = built.geometry.getAttribute("skinIndex").array as Uint16Array;
    const wts = built.geometry.getAttribute("skinWeight").array as Float32Array;
    const col = built.geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    const palette = BIRD_BONES.map((_, i) => jointColor(i));
    const nVerts = arr.length / 3;
    for (let v = 0; v < nVerts; v++) {
      let r = 0, g = 0, b = 0;
      if (mode === "blend") {
        for (let k = 0; k < 4; k++) {
          const w = wts[v * 4 + k];
          const c = palette[idx[v * 4 + k]];
          r += c.r * w; g += c.g * w; b += c.b * w;
        }
      } else {
        let w = 0;
        for (let k = 0; k < 4; k++) if (idx[v * 4 + k] === joint) w += wts[v * 4 + k];
        const t = Math.sqrt(Math.min(w, 1)); // sqrt: make the faint outer falloff visible
        r = 0.05 + 0.95 * t; g = 0.07 + 0.78 * t; b = 0.18 + 0.12 * t;
      }
      arr[v * 3] = r; arr[v * 3 + 1] = g; arr[v * 3 + 2] = b;
    }
    col.needsUpdate = true;
  };

  const reweight = (): void => {
    const pos = built.geometry.getAttribute("position").array as Float32Array;
    const { skinIndex, skinWeight } = computeSkinWeights(pos, power);
    for (const comp of built.components) {
      if (comp.pin) pinWeights(skinIndex, skinWeight, comp.start, comp.end, comp.pin);
    }
    built.geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    built.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
    recolor();
  };
  recolor();

  shell.slider({
    label: "falloff power",
    min: 1,
    max: 6,
    step: 0.1,
    value: power,
    onInput: (v) => {
      power = v;
      clearTimeout(timer);
      timer = window.setTimeout(reweight, 160);
    },
  });
  shell.slider({
    label: "joint",
    min: 0,
    max: BIRD_BONES.length - 1,
    step: 1,
    value: joint,
    format: (v) => BIRD_BONES[Math.round(v)].name,
    onInput: (v) => {
      joint = Math.round(v);
      if (mode === "single") recolor();
    },
  });
  shell.button("blend ⇄ one joint", () => {
    mode = mode === "blend" ? "single" : "blend";
    recolor();
  });
  shell.button("stress pose ⇄ rest", () => {
    posed = !posed;
    rig.reset();
    if (posed) stressPose(rig);
  });
  shell.setInfo(() => `${BIRD_BONES.length} joints · 4 influences per vertex · ${mode === "single" ? BIRD_BONES[joint].name : "all territories"}`);

  return {
    frame() {
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- forward kinematics: the x-ray --------------------------------------------------

export async function mountRigFK(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, EAGLE_STAGE);
  addGroundDisc(stage.scene, { radius: 1.5, shadowRadius: 0.35 });

  const built = buildEagleBody();
  bakeSkin(built.geometry, built.components);
  const ghost = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const { mesh, rig } = createSkinnedBird(built.geometry, ghost);
  stage.scene.add(mesh);

  const viz = new SkeletonViz();
  stage.scene.add(viz.group);

  const pose = { bodyRoll: 0, neckPitch: 0, headYaw: 0, tailPitch: 0 };
  const apply = (): void => {
    rig.setEulerDeg("body", 0, 0, pose.bodyRoll);
    rig.setEulerDeg("neck", pose.neckPitch, 0, 0);
    rig.setEulerDeg("head", 0, pose.headYaw, 0);
    rig.setEulerDeg("tailFan", pose.tailPitch, 0, 0);
  };

  shell.slider({ label: "body roll", min: -25, max: 25, step: 1, value: 0, onInput: (v) => { pose.bodyRoll = v; apply(); } });
  shell.slider({ label: "neck pitch", min: -30, max: 30, step: 1, value: 0, onInput: (v) => { pose.neckPitch = v; apply(); } });
  shell.slider({ label: "head yaw", min: -70, max: 70, step: 1, value: 0, onInput: (v) => { pose.headYaw = v; apply(); } });
  shell.slider({ label: "tail pitch", min: -40, max: 25, step: 1, value: 0, onInput: (v) => { pose.tailPitch = v; apply(); } });
  shell.setInfo(() => "roll the body: every joint downstream follows — that's all FK is");

  return {
    frame() {
      viz.update(rig);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the puppet: pose dials ---------------------------------------------------------

interface PuppetPose {
  headYaw: number;
  headPitch: number;
  gape: number;
  tailPitch: number;
  tailFan: number;
  wingDroop: number;
  crouch: number;
}

const REST: PuppetPose = { headYaw: 0, headPitch: 0, gape: 0, tailPitch: 0, tailFan: 0.18, wingDroop: 0, crouch: 0 };
const ALERT: PuppetPose = { headYaw: 32, headPitch: -10, gape: 0, tailPitch: -14, tailFan: 0.4, wingDroop: 0, crouch: 0 };
const MANTLE: PuppetPose = { headYaw: 0, headPitch: 16, gape: 0.2, tailPitch: 10, tailFan: 0.85, wingDroop: 26, crouch: 0.55 };
const SCREAM: PuppetPose = { headYaw: 0, headPitch: -26, gape: 1, tailPitch: -10, tailFan: 0.3, wingDroop: 8, crouch: 0.1 };

function applyPuppet(rig: BirdRig, coatPose: CoatPose, p: PuppetPose): void {
  rig.setEulerDeg("head", p.headPitch, p.headYaw, 0);
  rig.setEulerDeg("beak", p.gape * 34, 0, 0);
  rig.setEulerDeg("tailFan", p.tailPitch, 0, 0);
  rig.setEulerDeg("humerusL", 0, p.wingDroop * 0.45, -p.wingDroop);
  rig.setEulerDeg("humerusR", 0, -p.wingDroop * 0.45, p.wingDroop);
  coatPose.tailSpread = p.tailFan;
  coatPose.spread = p.wingDroop / 90; // a drooped wing lets the fan crack open
  // crouch: the body sinks while thigh and tarsus fold against each other,
  // which keeps the feet roughly where the ground thinks they are
  rig.setEulerDeg("thighL", p.crouch * 30, 0, 0);
  rig.setEulerDeg("thighR", p.crouch * 30, 0, 0);
  rig.setEulerDeg("tarsusL", -p.crouch * 36, 0, 0);
  rig.setEulerDeg("tarsusR", -p.crouch * 36, 0, 0);
  const body = rig.bone("body");
  const rest = BIRD_BONES.find((b) => b.name === "body")!.head;
  body.position.set(rest[0], rest[1] - p.crouch * 0.06, rest[2]);
}

export async function mountRigPose(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, EAGLE_STAGE);
  addGroundDisc(stage.scene, { radius: 1.5, shadowRadius: 0.35 });

  const built = buildEagleBody();
  bakeSkin(built.geometry, built.components);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const { mesh, rig } = createSkinnedBird(built.geometry, material);
  stage.scene.add(mesh);

  const face = new THREE.Group();
  addFace(face); // children at rest-pose world positions; attachRider re-bases the group
  attachRider(rig, "head", face);

  const coat = new FeatherCoat();
  stage.scene.add(coat.group);
  const coatPose: CoatPose = { ...COAT_POSE_REST };

  const p: PuppetPose = { ...REST };
  const sliders: Record<keyof PuppetPose, HTMLInputElement> = {} as never;
  const apply = (): void => applyPuppet(rig, coatPose, p);

  const dial = (key: keyof PuppetPose, label: string, min: number, max: number, step = 1): void => {
    sliders[key] = shell.slider({
      label,
      min,
      max,
      step,
      value: p[key],
      onInput: (v) => {
        p[key] = v;
        apply();
      },
    });
  };
  dial("headYaw", "head yaw", -70, 70);
  dial("headPitch", "head pitch", -35, 25);
  dial("gape", "gape", 0, 1, 0.01);
  dial("tailPitch", "tail pitch", -40, 25);
  dial("tailFan", "tail fan", 0, 1, 0.01);
  dial("wingDroop", "wing droop", 0, 40);
  dial("crouch", "crouch", 0, 1, 0.01);

  const setPose = (target: PuppetPose): void => {
    Object.assign(p, target);
    for (const k of Object.keys(sliders) as (keyof PuppetPose)[]) {
      sliders[k].value = String(p[k]);
      sliders[k].dispatchEvent(new Event("input"));
    }
    apply();
  };
  shell.button("rest", () => setPose(REST));
  shell.button("alert", () => setPose(ALERT));
  shell.button("mantle", () => setPose(MANTLE));
  shell.button("scream", () => setPose(SCREAM));
  shell.setInfo(() => "the eyes ride the head joint; the feathers ride their bones — turn anything and its passengers come along");
  apply();

  return {
    frame() {
      rig.root.updateWorldMatrix(true, true);
      coat.update(rig.bones, coatPose);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- alive: fidget timers ------------------------------------------------------------

const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export async function mountRigAlive(container: HTMLElement, opts: { hero?: boolean } = {}): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  const stage = await createStage3D(shell.canvas, { ...EAGLE_STAGE, distance: opts.hero ? 2.2 : 2.4 });
  addGroundDisc(stage.scene, { radius: 1.6, shadowRadius: 0.35 });

  const eagle = createEagle();
  stage.scene.add(eagle.group);

  // the whole performance is a handful of timers and two springs
  let vigilance = 1; // how often she finds something worth glaring at
  let temper = 1; // how often the tail and hackles have an opinion
  let lookYaw = 0, lookPitch = 0; // current head angles (deg)
  let targetYaw = 0, targetPitch = 0;
  let nextLook = 0;
  let seed = 1;
  let tailAngle = 0, tailVel = 0; // spring around the rest carriage
  let nextFlick = 1.2;
  let rouseUntil = -1; // a body-shake that resettles the coat
  let nextRouse = 6;
  let last = performance.now() / 1000;

  if (!opts.hero) {
    shell.slider({ label: "vigilance", min: 0.3, max: 3, step: 0.1, value: 1, onInput: (v) => (vigilance = v) });
    shell.slider({ label: "temper", min: 0.3, max: 3, step: 0.1, value: 1, onInput: (v) => (temper = v) });
    shell.setInfo(() => "five timers, two springs, zero keyframes");
  }

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;

      if (t > nextLook) {
        targetYaw = (hash1(seed++) - 0.5) * 110;
        targetPitch = (hash1(seed++) - 0.5) * 30;
        nextLook = t + (0.9 + hash1(seed++) * 2.8) / vigilance;
      }
      // saccade: fast exponential approach, then the raptor stare
      const k = 1 - Math.exp(-dt * 10);
      lookYaw += (targetYaw - lookYaw) * k;
      lookPitch += (targetPitch - lookPitch) * k;

      if (t > nextFlick) {
        tailVel += 180 + hash1(seed++) * 140;
        nextFlick = t + (1.6 + hash1(seed++) * 3.5) / temper;
      }
      // underdamped spring: the flick overshoots and settles
      tailVel += (-tailAngle * 80 - tailVel * 6.5) * dt;
      tailAngle += tailVel * dt;

      if (t > nextRouse) {
        rouseUntil = t + 0.7;
        nextRouse = t + (8 + hash1(seed++) * 10) / temper;
      }
      const rousing = t < rouseUntil ? 1 - (rouseUntil - t) / 0.7 : 0;
      const shake = rousing > 0 ? Math.sin(t * 38) * Math.sin(rousing * Math.PI) : 0;

      const breath = Math.sin(t * Math.PI * 2 * 0.35) * 1.1;
      const shift = Math.sin(t * 0.27) * 2.0;

      eagle.pose({
        phase: 0,
        spread: Math.abs(shake) * 0.06,
        flap: 0,
        tailFan: 0.18 + Math.abs(tailAngle) * 0.002,
        beak: 0,
        theta: breath * 0.5,
      });
      eagle.rig.setEulerDeg("head", lookPitch, lookYaw * 0.65, shake * 4);
      eagle.rig.setEulerDeg("neck", breath * 0.5, lookYaw * 0.35, 0);
      eagle.rig.setEulerDeg("body", breath * 0.4 + shake * 1.5, 0, shift + shake * 2.5);
      eagle.rig.setEulerDeg("tailFan", -tailAngle * 0.1, Math.sin(t * 0.7) * 4, 0);

      stage.render();
      if (!opts.hero) shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
