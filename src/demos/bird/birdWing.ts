// The figures of Feather & Bone part 3: a draggable wingtip with the
// two-bone solver underneath (feathers following live), the one-slider
// unfold from folded silhouette to full span, the wingbeat cycle with its
// knobs out and the tip drawing its own diagram, and the whole eagle
// flapping with tail, body, and feather slots joining in.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { createStage3D, addGroundDisc, type Stage3D } from "../../lib/stage3d";
import { buildEagleBody } from "../../lib/bird/body";
import { createSkinnedBird, bakeSkin, SkeletonViz } from "../../lib/bird/rig";
import { FeatherCoat, COAT_POSE_REST, type CoatPose } from "../../lib/bird/feathers";
import { createEagle } from "../../lib/bird/bird";
import {
  WINGS,
  applyWingTip,
  unfoldTarget,
  applyFlap,
  coatPoseFromFlap,
  setTail,
  wingReach,
  FLAP_DEFAULTS,
  freshFlapSample,
  type FlapSample,
  type WingSolveResult,
} from "../../lib/bird/wing";
import { EAGLE_STAGE } from "./birdModel";

const WING_STAGE = { ...EAGLE_STAGE, distance: 2.9, target: [0, 0.5, 0] as [number, number, number] };

function ghostMaterial(opacity = 0.3): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// a skinned ghost body + live feather coat — the part-3 workbench bird
function makeBench(opacity?: number): { mesh: THREE.SkinnedMesh; rig: ReturnType<typeof createSkinnedBird>["rig"]; coat: FeatherCoat; coatPose: CoatPose } {
  const built = buildEagleBody();
  bakeSkin(built.geometry, built.components);
  const { mesh, rig } = createSkinnedBird(built.geometry, opacity === undefined ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }) : ghostMaterial(opacity));
  const coat = new FeatherCoat();
  return { mesh, rig, coat, coatPose: { ...COAT_POSE_REST } };
}

// shared orb-dragging: orbit pauses while held
function draggable(stage: Stage3D, shell: Shell, orb: THREE.Mesh, onMove?: () => void): void {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  let held = false;
  const toNdc = (e: PointerEvent): void => {
    const r = shell.canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  };
  shell.canvas.addEventListener(
    "pointerdown",
    (e) => {
      toNdc(e);
      ray.setFromCamera(ndc, stage.camera);
      if (ray.intersectObject(orb).length > 0) {
        held = true;
        stage.orbit.enabled = false;
        shell.canvas.setPointerCapture(e.pointerId);
        plane.setFromNormalAndCoplanarPoint(stage.camera.getWorldDirection(new THREE.Vector3()).negate(), orb.position);
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  shell.canvas.addEventListener(
    "pointermove",
    (e) => {
      if (!held) return;
      toNdc(e);
      ray.setFromCamera(ndc, stage.camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        orb.position.copy(hit);
        onMove?.();
      }
      e.stopImmediatePropagation();
    },
    true,
  );
  shell.canvas.addEventListener(
    "pointerup",
    () => {
      held = false;
      stage.orbit.enabled = true;
    },
    true,
  );
}

// ---- wingtip, be there: the solver with a handle on it -----------------------------

export async function mountWingIK(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, WING_STAGE);
  addGroundDisc(stage.scene, { radius: 1.7, shadowRadius: 0.35 });

  const { mesh, rig, coat, coatPose } = makeBench(0.3);
  stage.scene.add(mesh, coat.group);
  const viz = new SkeletonViz();
  stage.scene.add(viz.group);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffc163, emissive: 0xa86a18, roughness: 0.4 }),
  );
  orb.position.set(0.75, 0.7, 0.05);
  stage.scene.add(orb);
  draggable(stage, shell, orb);

  // joint beads so the article can point at "shoulder, elbow, wrist"
  const beadMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, depthTest: false });
  const beads = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), beadMat);
    m.renderOrder = 12;
    stage.scene.add(m);
    return m;
  });

  let poleLift = 20; // degrees the elbow hint leans up from straight back
  let twist = 0;
  shell.slider({ label: "elbow lift", min: -60, max: 80, step: 1, value: poleLift, onInput: (v) => (poleLift = v) });
  shell.slider({ label: "blade twist", min: -40, max: 40, step: 1, value: 0, onInput: (v) => (twist = v) });

  const pole = new THREE.Vector3();
  const solve: WingSolveResult = { elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), tip: new THREE.Vector3(), clamped: false };
  let clamped = false;
  shell.setInfo(() => (clamped ? "out of reach — the wing goes straight and waits" : "drag the orb · drag elsewhere to orbit"));

  return {
    frame() {
      const a = (poleLift * Math.PI) / 180;
      pole.set(0, Math.sin(a), -Math.cos(a));
      applyWingTip(rig, WINGS.L, orb.position, { pole, twist: (twist * Math.PI) / 180 }, solve);
      clamped = solve.clamped;
      beads[0].position.copy(solve.elbow);
      beads[1].position.copy(solve.wrist);

      // feathers follow: fan opens with how far out the tip actually is
      const spread = Math.min(1, Math.abs(orb.position.x - WINGS.L.shoulder.x) / (wingReach(WINGS.L) * 0.8));
      coatPose.spread = spread;
      coatPose.tailSpread = 0.25;
      rig.root.updateWorldMatrix(true, true);
      coat.update(rig.bones, coatPose);

      viz.update(rig);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the unfold ---------------------------------------------------------------------

export async function mountUnfold(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, WING_STAGE);
  addGroundDisc(stage.scene, { radius: 1.7, shadowRadius: 0.35 });

  const eagle = createEagle();
  stage.scene.add(eagle.group);
  const viz = new SkeletonViz();
  viz.group.visible = false;
  stage.scene.add(viz.group);
  const solid = eagle.mesh.material as THREE.MeshStandardMaterial;

  let f = 0;
  const tL = new THREE.Vector3();
  const tR = new THREE.Vector3();
  const span = (): number => {
    unfoldTarget(WINGS.L, f, tL);
    unfoldTarget(WINGS.R, f, tR);
    return tL.distanceTo(tR);
  };

  shell.slider({ label: "unfold", min: 0, max: 1, step: 0.005, value: 0, onInput: (v) => (f = v) });
  shell.button("x-ray", () => {
    viz.group.visible = !viz.group.visible;
    solid.opacity = viz.group.visible ? 0.32 : 1;
    solid.transparent = viz.group.visible;
    solid.depthWrite = !viz.group.visible;
    solid.needsUpdate = true;
  });
  shell.setInfo(() => `span ${span().toFixed(2)} m — the same three segments, redistributed, and ${eagle.coat.featherCount} feathers fanning to fill them`);

  return {
    frame() {
      eagle.pose({ phase: 0, spread: f, flap: 0, tailFan: 0.2 + f * 0.4, beak: 0, theta: 0 });
      if (viz.group.visible) viz.update(eagle.rig);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the cycle, with its knobs out --------------------------------------------------

export async function mountFlapCycle(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, { ...WING_STAGE, azimuth: 1.2, distance: 3.1 });
  addGroundDisc(stage.scene, { radius: 1.7, shadowRadius: 0.35 });

  const { mesh, rig, coat, coatPose } = makeBench();
  stage.scene.add(mesh, coat.group);

  const fp = { ...FLAP_DEFAULTS };
  let slow = false;
  let phase = 0;
  let last = performance.now() / 1000;

  // the wingtip draws its own diagram: a rolling trail of the last beat
  const TRAIL = 140;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffc163, transparent: true, opacity: 0.85 }));
  trail.frustumCulled = false;
  stage.scene.add(trail);
  let trailHead = 0;

  shell.slider({ label: "beats / s", min: 0.4, max: 6, step: 0.1, value: fp.rate, onInput: (v) => (fp.rate = v) });
  shell.slider({ label: "amplitude", min: 0.08, max: 0.45, step: 0.005, value: fp.amp, onInput: (v) => (fp.amp = v) });
  shell.slider({ label: "downstroke %", min: 0.35, max: 0.75, step: 0.01, value: fp.downFrac, onInput: (v) => (fp.downFrac = v) });
  shell.slider({ label: "wrist fold", min: 0, max: 1, step: 0.01, value: fp.foldUp, onInput: (v) => (fp.foldUp = v) });
  shell.slider({ label: "twist", min: 0, max: 0.7, step: 0.01, value: fp.twistAmp, onInput: (v) => (fp.twistAmp = v) });
  shell.slider({ label: "feather lag", min: 0, max: 0.5, step: 0.01, value: fp.lagAmp, onInput: (v) => (fp.lagAmp = v) });
  shell.button("slow motion", () => (slow = !slow));

  let sample: FlapSample = freshFlapSample();
  shell.setInfo(() => `${slow ? "0.15× · " : ""}${sample.down ? "downstroke — sealed, splayed, paying the bills" : "upstroke — folded, slotted open, cheap"}`);

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;
      phase = (phase + dt * fp.rate * (slow ? 0.15 : 1)) % 1;
      sample = applyFlap(rig, phase, fp);
      setTail(rig, -6 + 5 * Math.cos(sample.theta), 0);
      coatPoseFromFlap(sample, 0.96, 0.3, 1, coatPose);
      rig.root.updateWorldMatrix(true, true);
      coat.update(rig.bones, coatPose);

      trailPos[trailHead * 3] = sample.tip.x;
      trailPos[trailHead * 3 + 1] = sample.tip.y;
      trailPos[trailHead * 3 + 2] = sample.tip.z;
      trailHead = (trailHead + 1) % TRAIL;
      trailGeo.setDrawRange(0, TRAIL);
      trailGeo.attributes.position.needsUpdate = true;

      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- everything at once --------------------------------------------------------------

export async function mountFlapAll(container: HTMLElement, opts: { hero?: boolean } = {}): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  const stage = await createStage3D(shell.canvas, { ...WING_STAGE, distance: opts.hero ? 2.7 : 2.9 });
  addGroundDisc(stage.scene, { radius: 1.7, shadowRadius: 0.35 });

  const eagle = createEagle();
  stage.scene.add(eagle.group);

  const fp = { ...FLAP_DEFAULTS };
  let tailFan = 0.45;
  let speed = opts.hero ? 0.5 : 1;
  let phase = 0;
  let last = performance.now() / 1000;

  if (!opts.hero) {
    shell.slider({ label: "beats / s", min: 0.4, max: 6, step: 0.1, value: fp.rate, onInput: (v) => (fp.rate = v) });
    shell.slider({ label: "tail fan", min: 0, max: 1, step: 0.01, value: tailFan, onInput: (v) => (tailFan = v) });
    shell.slider({ label: "time ×", min: 0.1, max: 1, step: 0.05, value: 1, onInput: (v) => (speed = v) });
    shell.setInfo(() => "wings, slots, splay, tail, body, head — one phase drives all of it");
  }

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;
      phase = (phase + dt * fp.rate * speed) % 1;
      eagle.pose({ phase, spread: 1, flap: 1, tailFan, beak: 0, fp });
      stage.render();
      if (!opts.hero) shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
