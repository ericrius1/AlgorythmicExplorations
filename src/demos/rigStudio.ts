// Part 2's figures. One bear mesh with skin attributes, one Rig, and the
// skin-matrix array shared with the GPU through a uniformArray:
//   hero    — x-ray view: ghost shell over the skeleton, idly waving
//   fk      — forward kinematics by hand: sliders dial joint angles
//   weights — the heatmap: who owns each vertex, and how sharply
//   skin    — the stress test: rigid binding vs blended, elbow at extremes
//   dance   — everything driven by sine waves: animation before animation

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { createStage, Face } from "../lib/bear/stage";
import { buildBearMesh, computeSkinWeights } from "../lib/bear/build";
import { createBearMaterial, createWeightMaterial, createGhostMaterial, paintZones } from "../lib/bear/material";
import { Rig, SkeletonViz } from "../lib/bear/rig";
import { DEFORM_BONES } from "../lib/bear/skeleton";

export interface RigStudioOptions {
  hero?: boolean;
  view: "hero" | "fk" | "weights" | "skin" | "dance";
}

export async function mountRigStudio(container: HTMLElement, opts: RigStudioOptions): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.52 : 0.62);
  let stage;
  try {
    stage = await createStage(shell.canvas);
  } catch (err) {
    console.error("three/webgpu failed to init", err);
    return gpuMissing(container);
  }
  const { scene } = stage;

  const built = buildBearMesh({ res: 56 });
  paintZones(built.geometry, "cinnamon");
  const rig = new Rig();
  const skin = { matrices: rig.skinMatrices };

  let time = 0;
  let last = performance.now();
  const tick = (): number => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    return dt;
  };

  // ---- hero: the x-ray ------------------------------------------------------------
  if (opts.view === "hero") {
    const ghost = createGhostMaterial(skin);
    const mesh = new THREE.Mesh(built.geometry, ghost);
    scene.add(mesh);
    const viz = new SkeletonViz();
    scene.add(viz.group);
    stage.orbit.distance = 3.0;

    return {
      frame: () => {
        tick();
        // an idle wave: the whole animation is four sine waves on six joints
        const breathe = Math.sin(time * 0.9);
        rig.setEulerDeg("chest", -2 + breathe * 2.2, 0, 0);
        rig.setEulerDeg("spine", 3 + breathe * 1.0, 0, 0);
        rig.setEulerDeg("head", -4 + Math.sin(time * 0.6) * 6, Math.sin(time * 0.4) * 14, 0);
        const wave = Math.max(0, Math.sin(time * 0.5));
        const flap = Math.sin(time * 4.2);
        rig.setEulerDeg("upperArmR", -10 - wave * 130, 0, -10 - wave * 30);
        rig.setEulerDeg("forearmR", -8 - wave * 30 + wave * flap * 16, 0, 0);
        rig.setEulerDeg("handR", -6 + wave * flap * 18, 0, 0);
        rig.setEulerDeg("upperArmL", -4 + breathe * 1.5, 0, 10);
        rig.setEulerDeg("tail", 0, Math.sin(time * 2.3) * 18, 0);
        rig.update();
        viz.update(rig);
        stage.render();
        shell.tick();
      },
      dispose: () => stage.dispose(),
    };
  }

  // ---- fk: dial the angles yourself ------------------------------------------------
  if (opts.view === "fk") {
    const bearMat = createBearMaterial(skin);
    const mesh = new THREE.Mesh(built.geometry, bearMat.material);
    scene.add(mesh);
    const viz = new SkeletonViz();
    scene.add(viz.group);
    const face = new Face();
    scene.add(face.group);
    stage.orbit.azimuth = 0.9;

    const angles = { shoulderX: -40, shoulderZ: 20, elbow: -40, wrist: -10 };
    const apply = (): void => {
      rig.setEulerDeg("upperArmL", angles.shoulderX, 0, angles.shoulderZ);
      rig.setEulerDeg("forearmL", angles.elbow, 0, 0);
      rig.setEulerDeg("handL", angles.wrist, 0, 0);
      rig.update();
    };
    apply();
    shell.slider({ label: "shoulder pitch", min: -170, max: 40, step: 1, value: angles.shoulderX, onInput: (v) => { angles.shoulderX = v; apply(); } });
    shell.slider({ label: "shoulder raise", min: -20, max: 120, step: 1, value: angles.shoulderZ, onInput: (v) => { angles.shoulderZ = v; apply(); } });
    shell.slider({ label: "elbow", min: -130, max: 10, step: 1, value: angles.elbow, onInput: (v) => { angles.elbow = v; apply(); } });
    shell.slider({ label: "wrist", min: -60, max: 60, step: 1, value: angles.wrist, onInput: (v) => { angles.wrist = v; apply(); } });
    shell.setInfo(() => {
      const p = rig.tailPos("handL");
      return `paw at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) — nobody chose that number`;
    });

    return {
      frame: () => { viz.update(rig); face.update(rig); stage.render(); shell.tick(); },
      dispose: () => stage.dispose(),
    };
  }

  // ---- weights: the heatmap --------------------------------------------------------
  if (opts.view === "weights") {
    const wm = createWeightMaterial(skin);
    const mesh = new THREE.Mesh(built.geometry, wm.material);
    scene.add(mesh);
    const viz = new SkeletonViz(0x4a5668);
    scene.add(viz.group);
    viz.update(rig);

    // a gentle pose so the chosen bone's influence is visible in motion
    rig.setEulerDeg("upperArmL", -50, 0, 30);
    rig.setEulerDeg("forearmL", -50, 0, 0);
    rig.setEulerDeg("head", -4, 25, 0);
    rig.update();
    viz.update(rig);

    let boneIdx = wm.selectedBone.value as number;
    let power = 2.4;
    const positions = built.geometry.getAttribute("position") as THREE.BufferAttribute;
    const recompute = (): void => {
      const { skinIndex, skinWeight } = computeSkinWeights(positions.array as Float32Array, power);
      (built.geometry.getAttribute("skinIndex") as THREE.BufferAttribute).copyArray(skinIndex).needsUpdate = true;
      (built.geometry.getAttribute("skinWeight") as THREE.BufferAttribute).copyArray(skinWeight).needsUpdate = true;
    };

    shell.button(`bone: ${DEFORM_BONES[boneIdx].name}`, () => {
      boneIdx = (boneIdx + 1) % DEFORM_BONES.length;
      wm.selectedBone.value = boneIdx;
      const b = shell.controls.querySelectorAll("button")[0];
      b.textContent = `bone: ${DEFORM_BONES[boneIdx].name}`;
    });
    shell.slider({ label: "falloff power", min: 1, max: 6, step: 0.1, value: power, onInput: (v) => { power = v; recompute(); } });
    shell.setInfo(() => `amber = owned by ${DEFORM_BONES[boneIdx].name} · power ${power.toFixed(1)}`);

    return {
      frame: () => { stage.render(); shell.tick(); },
      dispose: () => stage.dispose(),
    };
  }

  // ---- skin: rigid vs blended ------------------------------------------------------
  if (opts.view === "skin") {
    const bearMat = createBearMaterial(skin);
    const mesh = new THREE.Mesh(built.geometry, bearMat.material);
    scene.add(mesh);
    const face = new Face();
    scene.add(face.group);
    stage.orbit.azimuth = 1.1;
    stage.orbit.distance = 2.4;
    stage.orbit.target.set(0.25, 1.0, 0);

    // keep the original blended weights, and build a rigid alternative where
    // each vertex belongs 100% to its dominant bone
    const idxAttr = built.geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
    const wgtAttr = built.geometry.getAttribute("skinWeight") as THREE.BufferAttribute;
    const blendedIdx = (idxAttr.array as Float32Array).slice();
    const blendedWgt = (wgtAttr.array as Float32Array).slice();
    const rigidIdx = blendedIdx.slice();
    const rigidWgt = new Float32Array(blendedWgt.length);
    for (let v = 0; v < rigidWgt.length / 4; v++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (blendedWgt[v * 4 + k] > blendedWgt[v * 4 + best]) best = k;
      rigidIdx[v * 4] = blendedIdx[v * 4 + best];
      rigidWgt[v * 4] = 1;
    }
    let rigid = false;
    shell.button("binding: blended", () => {
      rigid = !rigid;
      (idxAttr.array as Float32Array).set(rigid ? rigidIdx : blendedIdx);
      (wgtAttr.array as Float32Array).set(rigid ? rigidWgt : blendedWgt);
      idxAttr.needsUpdate = true;
      wgtAttr.needsUpdate = true;
      const b = shell.controls.querySelectorAll("button")[0];
      b.textContent = `binding: ${rigid ? "rigid" : "blended"}`;
    });

    let bend = -100;
    shell.slider({ label: "elbow bend", min: -130, max: 0, step: 1, value: bend, onInput: (v) => (bend = v) });
    shell.setInfo(() => (rigid ? "rigid: watch the elbow crack open" : "blended: four bones vote per vertex"));

    return {
      frame: () => {
        tick();
        rig.setEulerDeg("upperArmL", -55, 0, 14);
        rig.setEulerDeg("forearmL", bend, 0, 0);
        rig.setEulerDeg("handL", -10, 0, 0);
        rig.update();
        face.update(rig);
        stage.render();
        shell.tick();
      },
      dispose: () => stage.dispose(),
    };
  }

  // ---- dance: sine-wave choreography ------------------------------------------------
  const bearMat = createBearMaterial(skin);
  const mesh = new THREE.Mesh(built.geometry, bearMat.material);
  scene.add(mesh);
  const face = new Face();
  scene.add(face.group);

  let freq = 1.6;
  let amp = 1.0;
  shell.slider({ label: "groove (Hz)", min: 0.4, max: 3.5, step: 0.05, value: freq, onInput: (v) => (freq = v) });
  shell.slider({ label: "commitment", min: 0, max: 2, step: 0.01, value: amp, onInput: (v) => (amp = v) });
  shell.setInfo(() => "11 oscillators, 0 keyframes");

  return {
    frame: () => {
      tick();
      const t = time * freq * Math.PI * 2;
      const s = (phase: number, mul = 1): number => Math.sin(t * mul + phase) * amp;
      rig.setEulerDeg("hips", 0, 0, s(0) * 9);
      rig.setEulerDeg("spine", 3, 0, s(Math.PI) * 7);
      rig.setEulerDeg("chest", -2, s(Math.PI / 2) * 6, s(Math.PI) * 4);
      rig.setEulerDeg("head", -4 + s(Math.PI / 2, 2) * 4, 0, s(0) * 6);
      rig.setEulerDeg("upperArmL", -20 + s(0, 2) * 12, 0, 35 + s(0) * 30);
      rig.setEulerDeg("upperArmR", -20 - s(0, 2) * 12, 0, -35 + s(0) * 30);
      rig.setEulerDeg("forearmL", -50 + s(Math.PI / 2) * 25, 0, 0);
      rig.setEulerDeg("forearmR", -50 - s(Math.PI / 2) * 25, 0, 0);
      rig.setEulerDeg("thighL", -8 + s(0) * 5, 0, -3);
      rig.setEulerDeg("thighR", -8 - s(0) * 5, 0, 3);
      rig.setEulerDeg("tail", 0, s(0, 2) * 24, 0);
      const hips = rig.joints[rig.index("hips")];
      hips.posOffset.set(0, -0.02 + Math.abs(Math.sin(t)) * 0.035 * amp, 0);
      rig.update();
      face.update(rig);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
