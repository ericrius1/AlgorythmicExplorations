// Part 3 in three dimensions: the bear wants things.
//   hero  — a firefly drifts by on a Lissajous path; the gaze tracks it, and
//           when it strays into range the near paw reaches out for it
//   reach — a draggable orb, the full solver exposed: pole vector, spine
//           assist, gaze toggle — FK layers and IK corrections in one body
// IK never replaces the rig: it just writes better numbers into the same
// joint rotations FK owns.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { createStage, Face } from "../lib/bear/stage";
import { buildBearMesh } from "../lib/bear/build";
import { createBearMaterial, paintZones } from "../lib/bear/material";
import { Rig, SkeletonViz } from "../lib/bear/rig";
import { solveTwoBone, aimJoint, GAZE_FORWARD } from "../lib/bear/ik";

export interface ReachStudioOptions {
  hero?: boolean;
  view: "hero" | "reach";
}

export async function mountReachStudio(container: HTMLElement, opts: ReachStudioOptions): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.52 : 0.62);
  let stage;
  try {
    stage = await createStage(shell.canvas);
  } catch (err) {
    console.error("three/webgpu failed to init", err);
    return gpuMissing(container);
  }
  const { scene, camera } = stage;

  const built = buildBearMesh();
  paintZones(built.geometry, "cinnamon");
  const rig = new Rig();
  const skin = { matrices: rig.skinMatrices };
  const bearMat = createBearMaterial(skin);
  scene.add(new THREE.Mesh(built.geometry, bearMat.material));
  const face = new Face();
  scene.add(face.group);

  let time = 0;
  let last = performance.now();
  const tick = (): number => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    return dt;
  };

  // breathing baseline shared by both views — IK rides on top of living FK
  const breathe = (): void => {
    const b = Math.sin(time * 0.9);
    rig.setEulerDeg("spine", 3 + b * 1.0, 0, 0);
    rig.setEulerDeg("chest", -2 + b * 2.0, 0, 0);
    rig.setEulerDeg("neck", 4, 0, 0);
    rig.setEulerDeg("head", -4, 0, 0);
    rig.setEulerDeg("upperArmR", -4 + b * 1.5, 0, 14);
    rig.setEulerDeg("forearmR", -10, 0, 2);
    rig.setEulerDeg("tail", 0, Math.sin(time * 1.7) * 10, 0);
  };

  // ---- hero: the firefly -----------------------------------------------------------
  if (opts.view === "hero") {
    const fly = new THREE.Group();
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    const light = new THREE.PointLight(0xffd34d, 0.9, 2.5);
    fly.add(bulb, halo, light);
    scene.add(fly);
    stage.orbit.distance = 3.0;
    // gaze demo: hold a mostly-frontal view so the tracking reads; no idle spin
    stage.orbit.azimuth = 0.3;
    stage.orbit.autoSpin = 0;

    const flyPos = new THREE.Vector3();
    const shoulder = new THREE.Vector3();
    const pole = new THREE.Vector3();
    let reachAmount = 0;

    return {
      frame: () => {
        const dt = tick();
        // Lissajous drift, mostly in front of the bear
        flyPos.set(
          Math.sin(time * 0.43) * 0.65,
          1.25 + Math.sin(time * 0.31 + 1.7) * 0.35,
          0.55 + Math.sin(time * 0.57 + 0.4) * 0.35,
        );
        fly.position.copy(flyPos);
        halo.scale.setScalar(1 + Math.sin(time * 7) * 0.15);

        breathe();
        // reach when the firefly wanders into range of the left paw — and on
        // the left-front side, so the arm never sweeps across the torso
        rig.update();
        rig.jointPos("upperArmL", shoulder);
        const dist = shoulder.distanceTo(flyPos);
        const maxReach = rig.joints[rig.index("forearmL")].restOffset.length()
          + rig.joints[rig.index("handL")].restOffset.length();
        const onReachableSide = flyPos.x > 0.05 && flyPos.z > 0.25;
        const want = onReachableSide && dist < maxReach * 1.15 ? 1 : 0;
        reachAmount += (want - reachAmount) * Math.min(1, dt * 2.2);

        rig.setEulerDeg("upperArmL", -4, 0, -14);
        rig.setEulerDeg("forearmL", -10, 0, -2);
        rig.setEulerDeg("handL", -6, 0, 0);
        rig.update();
        if (reachAmount > 0.01) {
          pole.set(shoulder.x + 0.3, shoulder.y - 0.8, shoulder.z + 0.45);
          solveTwoBone(rig, ["upperArmL", "forearmL", "handL"], flyPos, pole, reachAmount);
        }
        // the gaze never stops tracking, reach or no reach: aim the *face*
        // direction, not the bone axis (which runs up through the skull)
        aimJoint(rig, "neck", flyPos, 26, 0.4, GAZE_FORWARD);
        rig.update();
        aimJoint(rig, "head", flyPos, 44, 0.8, GAZE_FORWARD);
        rig.update();
        face.update(rig);
        stage.render();
        shell.tick();
      },
      dispose: () => stage.dispose(),
    };
  }

  // ---- reach: the lab ---------------------------------------------------------------
  const viz = new SkeletonViz();
  scene.add(viz.group);
  stage.orbit.autoSpin = 0; // you're aiming an orb; the camera holds still

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffc163, emissive: 0xa86a18, roughness: 0.4 }),
  );
  orb.position.set(0.55, 1.25, 0.42);
  scene.add(orb);

  let poleSwing = 0; // degrees around the shoulder→target axis, 0 = elbow down
  let spineAssist = 0.35;
  let gazeOn = true;

  shell.slider({ label: "elbow swing", min: -90, max: 90, step: 1, value: 0, onInput: (v) => (poleSwing = v) });
  shell.slider({ label: "spine assist", min: 0, max: 1, step: 0.01, value: spineAssist, onInput: (v) => (spineAssist = v) });
  shell.button("gaze: on", () => {
    gazeOn = !gazeOn;
    shell.controls.querySelector("button")!.textContent = `gaze: ${gazeOn ? "on" : "off"}`;
  });

  // drag the orb on a camera-facing plane through its current position
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  let draggingOrb = false;
  const pointToNdc = (e: PointerEvent): void => {
    const r = shell.canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    pointToNdc(e);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObject(orb).length > 0) {
      draggingOrb = true;
      stage.orbit.enabled = false;
      shell.canvas.setPointerCapture(e.pointerId);
      plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), orb.position);
      e.stopImmediatePropagation();
    }
  }, true);
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!draggingOrb) return;
    pointToNdc(e);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) {
      hit.y = Math.max(0.15, hit.y);
      orb.position.copy(hit);
    }
    e.stopImmediatePropagation();
  }, true);
  shell.canvas.addEventListener("pointerup", () => {
    draggingOrb = false;
    stage.orbit.enabled = true;
  }, true);

  const shoulder = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const n = new THREE.Vector3();
  const baseDown = new THREE.Vector3();
  const q = new THREE.Quaternion();
  let clamped = false;

  shell.setInfo(() => (clamped ? "out of reach — the arm goes straight and waits" : "drag the orb · drag elsewhere to orbit"));

  return {
    frame: () => {
      tick();
      breathe();
      rig.update();

      // FK layer first: the spine leans a fraction of the way toward the goal
      if (spineAssist > 0.005) {
        aimJoint(rig, "spine", orb.position, 18 * spineAssist, 0.5 * spineAssist);
        aimJoint(rig, "chest", orb.position, 26 * spineAssist, 0.6 * spineAssist);
        rig.update();
      }

      // then the IK layer: two bones, one triangle, no iteration
      rig.jointPos("upperArmL", shoulder);
      n.copy(orb.position).sub(shoulder).normalize();
      baseDown.set(0, -1, 0).addScaledVector(n, -n.dot(new THREE.Vector3(0, -1, 0))).normalize();
      q.setFromAxisAngle(n, (poleSwing * Math.PI) / 180);
      pole.copy(baseDown).applyQuaternion(q).multiplyScalar(0.6).add(shoulder);
      solveTwoBone(rig, ["upperArmL", "forearmL", "handL"], orb.position, pole);

      const maxReach = rig.joints[rig.index("forearmL")].restOffset.length()
        + rig.joints[rig.index("handL")].restOffset.length();
      clamped = shoulder.distanceTo(orb.position) > maxReach;

      if (gazeOn) {
        aimJoint(rig, "neck", orb.position, 26, 0.4, GAZE_FORWARD);
        rig.update();
        aimJoint(rig, "head", orb.position, 44, 0.8, GAZE_FORWARD);
      }
      rig.update();
      viz.update(rig);
      face.update(rig);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
