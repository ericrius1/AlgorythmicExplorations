// The four figures of Feather & Bone part 2: skin weights painted on the
// body (with the falloff exposed), the skeleton x-ray with forward kinematics
// on sliders, the full puppet with pose dials and preset poses, and the wren
// brought to idle life by a handful of fidget timers.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D, addGroundDisc } from "../lib/stage3d";
import { DEFORM_BONES } from "../lib/bird/skeleton";
import { buildBirdMesh, addFace } from "../lib/bird/build";
import {
  createSkinnedWren,
  computeSkinWeights,
  attachRider,
  SkeletonViz,
  WEIGHT_POWER_DEFAULT,
  type BirdRig,
} from "../lib/bird/rig";
import { WREN_STAGE } from "./birdModel";

// one distinct color per joint, walked around the hue wheel by golden ratio
const jointColor = (i: number): THREE.Color => new THREE.Color().setHSL((i * 0.618034) % 1, 0.62, 0.6);

// a small stress pose: enough articulation to make bad weights embarrassing
function stressPose(rig: BirdRig): void {
  rig.setEulerDeg("head", -12, 38, 0);
  rig.setEulerDeg("neck", -14, 12, 0);
  rig.setEulerDeg("tailFan", -28, 14, 0);
  rig.setEulerDeg("body", 0, 0, 8);
}

// ---- skin weights, painted on the bird ---------------------------------------------

export async function mountRigWeights(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, WREN_STAGE);
  addGroundDisc(stage.scene, { radius: 1.3, shadowRadius: 0.3 });

  const built = buildBirdMesh({ res: 48, skin: true });
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const { mesh, rig } = createSkinnedWren(built.geometry, material);
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
    const palette = DEFORM_BONES.map((_, i) => jointColor(i));
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
        for (let k = 0; k < 4; k++) if (idx[v * 4 + k] === joint) w = wts[v * 4 + k];
        const t = Math.sqrt(w); // sqrt: make the faint outer falloff visible
        r = 0.05 + 0.95 * t; g = 0.07 + 0.78 * t; b = 0.18 + 0.12 * t;
      }
      arr[v * 3] = r; arr[v * 3 + 1] = g; arr[v * 3 + 2] = b;
    }
    col.needsUpdate = true;
  };

  const reweight = (): void => {
    const pos = built.geometry.getAttribute("position").array as Float32Array;
    const { skinIndex, skinWeight } = computeSkinWeights(pos, power);
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
    max: DEFORM_BONES.length - 1,
    step: 1,
    value: joint,
    format: (v) => DEFORM_BONES[Math.round(v)].name,
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
  shell.setInfo(() => `${DEFORM_BONES.length} joints · 4 influences per vertex · ${mode === "single" ? DEFORM_BONES[joint].name : "all territories"}`);

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
  const stage = await createStage3D(shell.canvas, WREN_STAGE);
  addGroundDisc(stage.scene, { radius: 1.3, shadowRadius: 0.3 });

  const built = buildBirdMesh({ res: 56, skin: true });
  const ghost = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const { mesh, rig } = createSkinnedWren(built.geometry, ghost);
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
  beak: number;
  tailPitch: number;
  tailYaw: number;
  wingDroop: number;
  crouch: number;
}

const REST: PuppetPose = { headYaw: 0, headPitch: 0, beak: 0, tailPitch: 0, tailYaw: 0, wingDroop: 0, crouch: 0 };
const ALERT: PuppetPose = { headYaw: 28, headPitch: -8, beak: 0, tailPitch: -30, tailYaw: 0, wingDroop: 0, crouch: 0 };
const SING: PuppetPose = { headYaw: 0, headPitch: -24, beak: -20, tailPitch: 12, tailYaw: 0, wingDroop: 6, crouch: 0.25 };

function applyPuppet(rig: BirdRig, p: PuppetPose): void {
  rig.setEulerDeg("head", p.headPitch, p.headYaw, 0);
  rig.setEulerDeg("beak", p.beak, 0, 0);
  rig.setEulerDeg("tailFan", p.tailPitch, p.tailYaw, 0);
  rig.setEulerDeg("humerusL", 0, 0, -p.wingDroop);
  rig.setEulerDeg("humerusR", 0, 0, p.wingDroop);
  // crouch: the body sinks while thigh and tarsus fold against each other,
  // which keeps the feet roughly where the ground thinks they are
  rig.setEulerDeg("thighL", p.crouch * 32, 0, 0);
  rig.setEulerDeg("thighR", p.crouch * 32, 0, 0);
  rig.setEulerDeg("tarsusL", -p.crouch * 38, 0, 0);
  rig.setEulerDeg("tarsusR", -p.crouch * 38, 0, 0);
  const body = rig.bone("body");
  const rest = DEFORM_BONES.find((b) => b.name === "body")!.head;
  body.position.set(rest[0], rest[1] - p.crouch * 0.055, rest[2]);
}

export async function mountRigPose(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, WREN_STAGE);
  addGroundDisc(stage.scene, { radius: 1.3, shadowRadius: 0.3 });

  const built = buildBirdMesh({ res: 64, skin: true });
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const { mesh, rig } = createSkinnedWren(built.geometry, material);
  stage.scene.add(mesh);

  const face = new THREE.Group();
  addFace(face); // children at rest-pose world positions; attachRider re-bases the group
  attachRider(rig, "head", face);

  const p: PuppetPose = { ...REST };
  const sliders: Record<keyof PuppetPose, HTMLInputElement> = {} as never;
  const apply = (): void => applyPuppet(rig, p);

  const dial = (key: keyof PuppetPose, label: string, min: number, max: number): void => {
    sliders[key] = shell.slider({
      label,
      min,
      max,
      step: key === "crouch" ? 0.01 : 1,
      value: p[key],
      onInput: (v) => {
        p[key] = v;
        apply();
      },
    });
  };
  dial("headYaw", "head yaw", -70, 70);
  dial("headPitch", "head pitch", -35, 25);
  dial("beak", "beak", -28, 0);
  dial("tailPitch", "tail pitch", -40, 25);
  dial("tailYaw", "tail wag", -30, 30);
  dial("wingDroop", "wing droop", 0, 18);
  dial("crouch", "crouch", 0, 1);

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
  shell.button("sing", () => setPose(SING));
  shell.setInfo(() => "the eyes are riders on the head joint — turn her head and the face just comes along");

  return {
    frame() {
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
  const stage = await createStage3D(shell.canvas, { ...WREN_STAGE, distance: opts.hero ? 1.7 : 1.9 });
  addGroundDisc(stage.scene, { radius: 1.3, shadowRadius: 0.3 });

  const built = buildBirdMesh({ res: opts.hero ? 64 : 56, skin: true });
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const { mesh, rig } = createSkinnedWren(built.geometry, material);
  stage.scene.add(mesh);

  const face = new THREE.Group();
  addFace(face); // children at rest-pose world positions; attachRider re-bases the group
  attachRider(rig, "head", face);

  // the whole performance is four timers and two springs
  let curiosity = 1; // how often she finds something new to look at
  let sass = 1; // how often the tail has an opinion
  let lookYaw = 0, lookPitch = 0; // current head angles (deg)
  let targetYaw = 0, targetPitch = 0;
  let nextLook = 0;
  let seed = 1;
  let tailAngle = 0, tailVel = 0; // spring around the rest cock
  let nextFlick = 1.2;
  let last = performance.now() / 1000;

  if (!opts.hero) {
    shell.slider({ label: "curiosity", min: 0.3, max: 3, step: 0.1, value: 1, onInput: (v) => (curiosity = v) });
    shell.slider({ label: "tail sass", min: 0.3, max: 3, step: 0.1, value: 1, onInput: (v) => (sass = v) });
    shell.setInfo(() => "four timers, two springs, zero keyframes");
  }

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;

      if (t > nextLook) {
        targetYaw = (hash1(seed++) - 0.5) * 90;
        targetPitch = (hash1(seed++) - 0.5) * 26;
        nextLook = t + (0.7 + hash1(seed++) * 2.4) / curiosity;
      }
      // saccade: fast exponential approach, then hold
      const k = 1 - Math.exp(-dt * 9);
      lookYaw += (targetYaw - lookYaw) * k;
      lookPitch += (targetPitch - lookPitch) * k;

      if (t > nextFlick) {
        tailVel += 220 + hash1(seed++) * 160;
        nextFlick = t + (1.4 + hash1(seed++) * 3.5) / sass;
      }
      // underdamped spring: the flick overshoots and settles, like a real tail
      tailVel += (-tailAngle * 90 - tailVel * 7) * dt;
      tailAngle += tailVel * dt;

      const breath = Math.sin(t * Math.PI * 2 * 0.5) * 1.3;
      const shift = Math.sin(t * 0.31) * 2.2;

      rig.setEulerDeg("head", lookPitch, lookYaw * 0.65, 0);
      rig.setEulerDeg("neck", breath * 0.5, lookYaw * 0.35, 0);
      rig.setEulerDeg("body", breath * 0.4, 0, shift);
      rig.setEulerDeg("tailFan", -tailAngle * 0.12, Math.sin(t * 0.7) * 4, 0);

      stage.render();
      if (!opts.hero) shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
