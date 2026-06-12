// Part 4's figures. One bear, one Animator, zero animation clips:
//   hero — the bear practices alone: autoFlow wanders the form, every
//          transition courtesy of the springs
//   form — the full toy: call out any move in any order, tune the muscle
//          speed and tempo, and switch the layers off to see what each one
//          was quietly doing
//
// In a Browser Tab — drop-in for the Waking Bodies finale.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { createStage, Face } from "../../lib/bear/stage";
import { buildBearMesh } from "../../lib/bear/build";
import { createBearMaterial, paintZones } from "../../lib/bear/material";
import { Rig } from "../../lib/bear/rig";
import { Animator } from "../../lib/bear/animator";
import { MOVES } from "../../lib/bear/poses";

export interface QigongStudioOptions {
  hero?: boolean;
  view: "hero" | "form";
}

export async function mountQigongStudio(container: HTMLElement, opts: QigongStudioOptions): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.52 : 0.62);
  let stage;
  try {
    stage = await createStage(shell.canvas);
  } catch (err) {
    console.error("three/webgpu failed to init", err);
    return gpuMissing(container);
  }
  const { scene } = stage;

  const built = buildBearMesh();
  paintZones(built.geometry, "cinnamon");
  const rig = new Rig();
  const skin = { matrices: rig.skinMatrices };
  const bearMat = createBearMaterial(skin);
  scene.add(new THREE.Mesh(built.geometry, bearMat.material));
  const face = new Face();
  scene.add(face.group);

  let last = performance.now();
  const tick = (): number => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    return dt;
  };

  // ---- hero: the solitary practice ---------------------------------------------
  if (opts.view === "hero") {
    const anim = new Animator(rig, { autoFlow: true });
    let label = "…";
    anim.onMoveStart = (m) => (label = m.label);
    stage.orbit.distance = 3.1;
    shell.setInfo(() => label);

    return {
      frame: () => {
        anim.update(tick());
        face.update(rig);
        stage.render();
        shell.tick();
      },
      dispose: () => stage.dispose(),
    };
  }

  // ---- form: call the moves yourself ---------------------------------------------
  const anim = new Animator(rig, { autoFlow: false });
  let label = "wuji — standing";
  let sub = "call a move";
  anim.onMoveStart = (m) => {
    label = m.label;
    sub = m.sub;
  };
  stage.orbit.distance = 2.9;

  for (const m of MOVES) {
    shell.button(m.label, () => anim.play(m));
  }
  shell.slider({
    label: "muscle speed (Hz)",
    min: 0.4, max: 3.5, step: 0.05, value: anim.freqHz,
    onInput: (v) => (anim.freqHz = v),
  });
  shell.slider({
    label: "tempo",
    min: 0.4, max: 1.8, step: 0.05, value: anim.speed,
    onInput: (v) => (anim.speed = v),
  });
  shell.button("feet: planted", () => {
    anim.footIK = !anim.footIK;
    const b = [...shell.controls.querySelectorAll("button")].find((x) => x.textContent!.startsWith("feet"));
    if (b) b.textContent = `feet: ${anim.footIK ? "planted" : "FK only"}`;
  });
  shell.button("gaze: on", () => {
    anim.gazeIK = !anim.gazeIK;
    const b = [...shell.controls.querySelectorAll("button")].find((x) => x.textContent!.startsWith("gaze"));
    if (b) b.textContent = `gaze: ${anim.gazeIK ? "on" : "off"}`;
  });
  shell.setInfo(() => `${label} · ${sub}`);

  return {
    frame: () => {
      anim.update(tick());
      face.update(rig);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
