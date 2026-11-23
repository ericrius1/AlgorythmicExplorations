// Three more procedural 3D pet species (Mochi, Kitsune, Pebble) crafted with
// love by Gemini 4 Neon (with clean author attribution for `;` debug mode).
// Kept in a modular file so additional species from any model can be plugged
// straight into speciesRegistry.ts.

import * as THREE from "three/webgpu";
import type { EvolutionStage, PetModelRig, PetPoseInput, SpeciesDefinition } from "./types";

function damp(cur: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(cur, target, 1 - Math.exp(-lambda * dt));
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

function computeTrick(pose: PetPoseInput) {
  const t = pose.trickPhase;
  const out = { y: 0, x: 0, z: 0, pitch: 0, yaw: 0, roll: 0, squashY: 1, excited: 0 };
  if (!pose.activeTrick) return out;
  switch (pose.activeTrick) {
    case "hop":
      if (t < 0.16) out.squashY = 1 - 0.22 * Math.sin((t / 0.16) * Math.PI * 0.5);
      else if (t < 0.84) {
        const u = (t - 0.16) / 0.68;
        out.y = Math.sin(u * Math.PI) * 0.68;
        out.squashY = 1 + 0.15 * Math.sin(u * Math.PI);
        out.excited = 1;
      } else out.squashY = 1 - 0.2 * Math.sin(((t - 0.84) / 0.16) * Math.PI);
      break;
    case "spin": {
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      out.y = Math.sin(t * Math.PI) * 0.28;
      out.yaw = eased * Math.PI * 4;
      out.excited = 0.9;
      break;
    }
    case "sing":
      out.pitch = -0.25 * Math.sin(t * Math.PI);
      out.roll = Math.sin(t * Math.PI * 6) * 0.1;
      out.y = Math.abs(Math.sin(t * Math.PI * 3)) * 0.07;
      out.excited = 0.6;
      break;
    case "dash": {
      const a = t * Math.PI * 2;
      out.x = Math.sin(a) * 0.58;
      out.z = Math.sin(a * 2) * 0.26;
      out.yaw = Math.cos(a) * 0.72;
      out.pitch = 0.2;
      out.y = Math.abs(Math.sin(t * Math.PI * 8)) * 0.11;
      out.excited = 1;
      break;
    }
    case "bow": {
      const e = Math.sin(t * Math.PI);
      out.pitch = 0.45 * e;
      out.y = -0.05 * e;
      out.squashY = 1 - 0.1 * e;
      break;
    }
    case "flip":
      out.y = Math.sin(t * Math.PI) * 0.92;
      out.pitch = -t * Math.PI * 2;
      out.excited = 1.2;
      break;
  }
  return out;
}

function makeCuteEye(radius: number, irisHex: number, lidHex: number) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 14),
    new THREE.MeshStandardMaterial({ color: irisHex, roughness: 0.12, metalness: 0.08 }),
  );
  base.scale.set(1, 1, 0.68);
  group.add(base);

  const pupilGroup = new THREE.Group();
  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.66, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.05 }),
  );
  pupil.scale.set(1, 1, 0.65);
  pupil.position.z = radius * 0.34;
  pupilGroup.add(pupil);

  const c1 = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.24, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  c1.position.set(radius * 0.25, radius * 0.25, radius * 0.64);
  pupilGroup.add(c1);

  const c2 = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff5e8 }));
  c2.position.set(-radius * 0.2, -radius * 0.17, radius * 0.66);
  pupilGroup.add(c2);
  group.add(pupilGroup);

  const lid = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.06, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
    new THREE.MeshStandardMaterial({ color: lidHex, roughness: 0.82 }),
  );
  lid.scale.set(1, 1, 0.72);
  lid.rotation.x = -Math.PI * 0.55;
  group.add(lid);

  const squint = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.68, radius * 0.13, 10, 18, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x1a1520, roughness: 0.5 }),
  );
  squint.position.set(0, -radius * 0.06, radius * 0.56);
  squint.visible = false;
  group.add(squint);

  return { group, lid, squint, pupilGroup };
}

// ============================================================================
// 1. MOCHI — Squishy Calico Kitten
// ============================================================================

function buildMochiRig(): PetModelRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const hitMeshes: THREE.Object3D[] = [];

  const creamMat = new THREE.MeshStandardMaterial({ color: 0xfdf5eb, roughness: 0.88 });
  const peachMat = new THREE.MeshStandardMaterial({ color: 0xf4a26e, roughness: 0.84 });
  const cocoaMat = new THREE.MeshStandardMaterial({ color: 0x4b3834, roughness: 0.84 });
  const pinkMat = new THREE.MeshStandardMaterial({ color: 0xffa3b5, roughness: 0.65 });
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff8ea6,
    emissive: 0xff6b8b,
    emissiveIntensity: 0.14,
    roughness: 0.7,
  });
  const whiskerMat = new THREE.MeshStandardMaterial({ color: 0x5c4b47, roughness: 0.5 });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd778,
    emissive: 0xffb84d,
    emissiveIntensity: 0.55,
    roughness: 0.22,
    metalness: 0.55,
  });

  // Four dainty paws with pink toe-bean undersides resting at y = 0
  const paws: THREE.Group[] = [];
  const pawLocs: [number, number, number][] = [
    [-0.14, 0.075, 0.16],
    [0.14, 0.075, 0.16],
    [-0.16, 0.075, -0.14],
    [0.16, 0.075, -0.14],
  ];
  for (const [px, py, pz] of pawLocs) {
    const pg = new THREE.Group();
    pg.position.set(px, py, pz);
    const pMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.06, 8, 12), creamMat);
    pg.add(pMesh);
    hitMeshes.push(pMesh);
    const bean = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), pinkMat);
    bean.scale.set(1.1, 0.45, 0.9);
    bean.position.set(0, -0.055, 0.02);
    pg.add(bean);
    bodyPivot.add(pg);
    paws.push(pg);
  }

  // Round squishy loaf body
  const torso = new THREE.Group();
  torso.position.set(0, 0.31, 0);
  bodyPivot.add(torso);

  const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 28, 22), creamMat);
  bodyMesh.scale.set(1.04, 0.96, 1.18);
  torso.add(bodyMesh);
  hitMeshes.push(bodyMesh);

  // Calico patches on back & flank
  const patch1 = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), peachMat);
  patch1.scale.set(1.0, 0.72, 1.25);
  patch1.position.set(-0.14, 0.11, -0.04);
  torso.add(patch1);

  const patch2 = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12), cocoaMat);
  patch2.scale.set(0.95, 0.65, 1.15);
  patch2.position.set(0.14, 0.09, -0.1);
  torso.add(patch2);

  // Articulated curling kitten tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.02, -0.29);
  torso.add(tailPivot);
  const tailSegs: THREE.Group[] = [];
  let tParent: THREE.Object3D = tailPivot;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.03 : 0.085, i === 0 ? -0.02 : -0.045);
    const mat = i >= 4 ? peachMat : i === 2 ? cocoaMat : creamMat;
    const cyl = new THREE.Mesh(new THREE.CapsuleGeometry(0.042 - i * 0.003, 0.068, 6, 10), mat);
    cyl.rotation.x = -0.35;
    seg.add(cyl);
    hitMeshes.push(cyl);
    tParent.add(seg);
    tailSegs.push(seg);
    tParent = seg;
  }

  // Round kitten head
  const head = new THREE.Group();
  head.position.set(0, 0.31, 0.14);
  torso.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.265, 28, 22), creamMat);
  skull.scale.set(1.12, 0.96, 0.98);
  head.add(skull);
  hitMeshes.push(skull);

  // Calico ear-cap spots
  const spotL = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), peachMat);
  spotL.scale.set(0.95, 0.72, 0.95);
  spotL.position.set(-0.14, 0.14, 0.02);
  head.add(spotL);
  const spotR = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), cocoaMat);
  spotR.scale.set(0.9, 0.68, 0.92);
  spotR.position.set(0.15, 0.13, -0.02);
  head.add(spotR);

  // Pointed plush cat ears with soft inner pink
  const ears: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.175, 0.21, 0.01);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.19, 14), side < 0 ? peachMat : cocoaMat);
    outer.position.set(0, 0.06, 0);
    outer.rotation.z = -side * 0.26;
    ear.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.056, 0.125, 12), pinkMat);
    inner.position.set(-side * 0.006, 0.05, 0.036);
    inner.rotation.z = -side * 0.26;
    ear.add(inner);
    head.add(ear);
    ears.push(ear);
  }

  // Big glossy emerald-hazel kitten eyes nested snugly in the face
  const leftEye = makeCuteEye(0.062, 0x3b8c6b, 0xfdf5eb);
  leftEye.group.position.set(-0.108, 0.018, 0.205);
  leftEye.group.rotation.y = -0.22;
  head.add(leftEye.group);

  const rightEye = makeCuteEye(0.062, 0x3b8c6b, 0xfdf5eb);
  rightEye.group.position.set(0.108, 0.018, 0.205);
  rightEye.group.rotation.y = 0.22;
  head.add(rightEye.group);

  // Tiny pink triangle nose + :3 smile + blushing cheeks
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), pinkMat);
  nose.scale.set(1.25, 0.8, 0.7);
  nose.position.set(0, -0.04, 0.265);
  head.add(nose);

  for (const side of [-1, 1]) {
    const mouthArc = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 14, Math.PI), whiskerMat);
    mouthArc.position.set(side * 0.027, -0.068, 0.255);
    mouthArc.rotation.z = Math.PI;
    head.add(mouthArc);

    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), blushMat);
    blush.scale.set(1.2, 0.65, 0.35);
    blush.position.set(side * 0.175, -0.04, 0.22);
    head.add(blush);

    // Three delicate whiskers per cheek
    for (let w = -1; w <= 1; w++) {
      const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, 0.14, 6), whiskerMat);
      whisker.rotation.z = Math.PI / 2 + side * w * 0.16;
      whisker.rotation.y = -side * 0.22;
      whisker.position.set(side * 0.22, -0.042 + w * 0.024, 0.21);
      head.add(whisker);
    }
  }

  // Evolution ornaments
  // Stage 2: Coral silk ribbon collar + golden bell
  const collarGroup = new THREE.Group();
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.21, 0.028, 12, 28),
    new THREE.MeshStandardMaterial({ color: 0xe85a71, roughness: 0.55 }),
  );
  collar.rotation.x = Math.PI / 2 + 0.14;
  collar.position.set(0, 0.17, 0.09);
  collarGroup.add(collar);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 12), goldMat);
  bell.position.set(0, 0.13, 0.295);
  collarGroup.add(bell);
  collarGroup.visible = false;
  torso.add(collarGroup);

  // Stage 3: Floating warm chime stars
  const chimeGroup = new THREE.Group();
  const chimeStars: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), goldMat);
    chimeGroup.add(st);
    chimeStars.push(st);
  }
  chimeGroup.visible = false;
  torso.add(chimeGroup);

  // Stage 4: Glowing starlight tiara halo
  const crownGroup = new THREE.Group();
  crownGroup.position.set(0, 0.36, 0.02);
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.014, 10, 32), goldMat);
  crownRing.rotation.x = Math.PI / 2 - 0.15;
  crownGroup.add(crownRing);
  const crownGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.048, 0), goldMat);
  crownGem.position.set(0, 0.04, 0.17);
  crownGroup.add(crownGem);
  crownGroup.visible = false;
  head.add(crownGroup);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.44, 0);
  head.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 2.1;
  let blinkVal = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage) => {
    curStage = stage;
    root.scale.setScalar([0.85, 0.95, 1.04, 1.12][stage - 1]);
    collarGroup.visible = stage >= 2;
    chimeGroup.visible = stage >= 3;
    crownGroup.visible = stage >= 4;
  };
  setEvolution(1);

  return {
    root,
    headAnchor,
    hitMeshes,
    setEvolution,
    update(pose: PetPoseInput) {
      const { time, dt, mood, speaking, petted, attentionPulse } = pose;
      const trick = computeTrick(pose);

      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.2 + ((Math.sin(time * 12.1) + 1) * 1.4);
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "happy" || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.93 : blinkTimer < 0.13 ? 1 : 0, 22, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.pupilGroup.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.55 + blinkVal * 0.92;
      }

      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      smoothYaw = damp(smoothYaw, sleeping ? 0 : THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.65, 0.65), 6, dt);
      smoothPitch = damp(smoothPitch, sleeping ? 0.25 : THREE.MathUtils.clamp(-(localLook.y - 0.65) * 0.35, -0.3, 0.3), 6, dt);

      const purr = Math.sin(time * (petted > 0.1 ? 26 : sleeping ? 2.0 : 3.2)) * (petted > 0.1 ? 0.014 : 0.025);
      bodyPivot.position.set(trick.x, trick.y + (sleeping ? -0.05 : 0), trick.z);
      bodyPivot.rotation.set(trick.pitch, trick.yaw, trick.roll + petted * Math.sin(time * 20) * 0.12);
      const sy = trick.squashY * (1 + purr + petted * 0.05);
      const sxz = 1 / Math.sqrt(Math.max(0.65, sy));
      torso.scale.set(sxz, sy, sxz);

      head.rotation.set(
        smoothPitch + (speaking > 0.05 ? Math.sin(time * 20) * 0.08 * speaking : 0),
        smoothYaw,
        (mood === "curious" ? 0.24 : 0) + petted * Math.sin(time * 16) * 0.09,
      );

      // Kitten tail curls happily!
      const wagSpeed = petted > 0.1 || mood === "playful" ? 6.5 : 2.2;
      tailSegs.forEach((seg, i) => {
        seg.rotation.z = Math.sin(time * wagSpeed - i * 0.48) * (0.14 + i * 0.03);
        seg.rotation.x = 0.12 + Math.cos(time * 1.8 - i * 0.35) * 0.06;
      });

      // Ear twitch
      const twitch = Math.sin(time * 5.2) > 0.94 ? 0.2 : 0;
      ears[0].rotation.z = twitch + (sleeping ? -0.25 : 0);
      ears[1].rotation.z = -(sleeping ? -0.25 : 0);

      // Paws patter during movement/dash
      const walkAmp = Math.min(1, pose.speed * 1.8) + (pose.activeTrick === "dash" ? 1 : 0);
      paws.forEach((p, idx) => {
        p.position.y = 0.075 + Math.max(0, Math.sin(time * 13 + idx * Math.PI)) * 0.055 * walkAmp;
      });

      goldMat.emissiveIntensity = 0.55 + attentionPulse * 1.2 + petted * 0.5;
      blushMat.emissiveIntensity = 0.14 + petted * 0.72;

      if (curStage >= 3) {
        chimeStars.forEach((st, i) => {
          const a = time * 1.35 + (i * Math.PI * 2) / chimeStars.length;
          st.position.set(Math.cos(a) * 0.52, 0.28 + Math.sin(a * 2 + i) * 0.12, Math.sin(a) * 0.52);
          st.rotation.y = time * 2.4;
        });
      }
      if (curStage >= 4) {
        crownGroup.rotation.y = time * 0.7;
      }
    },
    dispose() {
      disposeHierarchy(root);
    },
  };
}

// ============================================================================
// 2. KITSUNE — Spirit Fox Pup (1 → 2 → 3 → 5 luminous tails!)
// ============================================================================

function buildKitsuneRig(): PetModelRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const hitMeshes: THREE.Object3D[] = [];

  const alabasterMat = new THREE.MeshStandardMaterial({ color: 0xfbf7f5, roughness: 0.84 });
  const vermilionMat = new THREE.MeshStandardMaterial({ color: 0xe6495c, roughness: 0.72 });
  const spiritTipMat = new THREE.MeshStandardMaterial({
    color: 0xff8ab8,
    emissive: 0xff4f94,
    emissiveIntensity: 0.65,
    roughness: 0.35,
  });
  const wispMat = new THREE.MeshStandardMaterial({
    color: 0x99f3ff,
    emissive: 0x5ee7ff,
    emissiveIntensity: 1.35,
    roughness: 0.2,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x261d2b, roughness: 0.65 });

  // Dainty fox legs resting on y = 0
  const paws: THREE.Mesh[] = [];
  const pawLocs: [number, number, number][] = [
    [-0.13, 0.095, 0.16],
    [0.13, 0.095, 0.16],
    [-0.14, 0.095, -0.15],
    [0.14, 0.095, -0.15],
  ];
  for (const [px, py, pz] of pawLocs) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.095, 8, 12), vermilionMat);
    leg.position.set(px, py, pz);
    bodyPivot.add(leg);
    paws.push(leg);
    hitMeshes.push(leg);
  }

  const torso = new THREE.Group();
  torso.position.set(0, 0.34, 0);
  bodyPivot.add(torso);

  const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 26, 20), alabasterMat);
  bodyMesh.scale.set(0.95, 0.96, 1.28);
  torso.add(bodyMesh);
  hitMeshes.push(bodyMesh);

  // Fluffy plush chest ruff
  for (let i = -1; i <= 1; i++) {
    const ruff = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), alabasterMat);
    ruff.position.set(i * 0.075, 0.09, 0.22 - Math.abs(i) * 0.03);
    torso.add(ruff);
  }

  // Up to 5 fanned spirit tails (visibility controlled by evolution stage!)
  const tailFan = new THREE.Group();
  tailFan.position.set(0, 0.04, -0.26);
  torso.add(tailFan);
  const tails: { root: THREE.Group; segs: THREE.Group[]; minStage: EvolutionStage; baseAngle: number }[] = [];
  const tailSpecs: { angle: number; minStage: EvolutionStage }[] = [
    { angle: 0, minStage: 1 },
    { angle: -0.42, minStage: 2 },
    { angle: 0.42, minStage: 3 },
    { angle: -0.78, minStage: 4 },
    { angle: 0.78, minStage: 4 },
  ];
  for (const spec of tailSpecs) {
    const tRoot = new THREE.Group();
    tRoot.rotation.y = spec.angle;
    tailFan.add(tRoot);
    const segs: THREE.Group[] = [];
    let parent: THREE.Object3D = tRoot;
    for (let s = 0; s < 4; s++) {
      const sg = new THREE.Group();
      sg.position.set(0, s === 0 ? 0.04 : 0.095, s === 0 ? -0.05 : -0.095);
      const rad = [0.08, 0.105, 0.095, 0.068][s];
      const puff = new THREE.Mesh(new THREE.SphereGeometry(rad, 14, 12), s === 3 ? spiritTipMat : alabasterMat);
      puff.scale.set(0.92, 1.05, 1.25);
      sg.add(puff);
      hitMeshes.push(puff);
      parent.add(sg);
      segs.push(sg);
      parent = sg;
    }
    tails.push({ root: tRoot, segs, minStage: spec.minStage, baseAngle: spec.angle });
  }

  // Fox head with sleek snout & huge upright ears
  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.17);
  torso.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.225, 26, 20), alabasterMat);
  skull.scale.set(1.06, 0.96, 1.02);
  head.add(skull);
  hitMeshes.push(skull);

  // Cheek fluff tufts
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.14, 10), alabasterMat);
    cheek.position.set(side * 0.21, -0.04, 0.06);
    cheek.rotation.z = -side * 1.15;
    head.add(cheek);
  }

  // Pointy fox snout + tiny dark nose
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.092, 0.17, 14), alabasterMat);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.045, 0.235);
  head.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), darkMat);
  nose.position.set(0, -0.032, 0.32);
  head.add(nose);

  // Big tall fluffy fox ears with seamlessly aligned crimson tips
  const ears: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.135, 0.185, -0.01);
    const tilt = new THREE.Group();
    tilt.rotation.z = -side * 0.2;
    ear.add(tilt);

    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.092, 0.26, 16), alabasterMat);
    outer.position.set(0, 0.11, 0);
    tilt.add(outer);

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.115, 16), vermilionMat);
    tip.position.set(0, 0.186, 0);
    tilt.add(tip);

    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.15, 12), vermilionMat);
    inner.position.set(0, 0.085, 0.036);
    tilt.add(inner);

    head.add(ear);
    ears.push(ear);
  }

  // Amber-gold spirit eyes nested smoothly along the fox face
  const leftEye = makeCuteEye(0.054, 0xf2a73b, 0xfbf7f5);
  leftEye.group.position.set(-0.095, 0.02, 0.178);
  leftEye.group.rotation.y = -0.24;
  head.add(leftEye.group);

  const rightEye = makeCuteEye(0.054, 0xf2a73b, 0xfbf7f5);
  rightEye.group.position.set(0.095, 0.02, 0.178);
  rightEye.group.rotation.y = 0.24;
  head.add(rightEye.group);

  // Stage 2: Sacred vermilion forehead diamond mark
  const foreheadMark = new THREE.Mesh(new THREE.OctahedronGeometry(0.036, 0), spiritTipMat);
  foreheadMark.scale.set(0.75, 1.3, 0.35);
  foreheadMark.position.set(0, 0.11, 0.22);
  foreheadMark.visible = false;
  head.add(foreheadMark);

  // Stage 3: Orbiting cyan fox-fire wisp orbs
  const wispGroup = new THREE.Group();
  const wisps: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), wispMat);
    wispGroup.add(w);
    wisps.push(w);
  }
  wispGroup.visible = false;
  torso.add(wispGroup);

  // Stage 4: Sacred vertical spirit ring behind the head
  const spiritHalo = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.015, 10, 40), spiritTipMat);
  spiritHalo.position.set(0, 0.22, -0.14);
  spiritHalo.visible = false;
  head.add(spiritHalo);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.48, 0);
  head.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 2.4;
  let blinkVal = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage) => {
    curStage = stage;
    root.scale.setScalar([0.85, 0.95, 1.04, 1.12][stage - 1]);
    foreheadMark.visible = stage >= 2;
    wispGroup.visible = stage >= 3;
    spiritHalo.visible = stage >= 4;
    for (const t of tails) t.root.visible = stage >= t.minStage;
  };
  setEvolution(1);

  return {
    root,
    headAnchor,
    hitMeshes,
    setEvolution,
    update(pose: PetPoseInput) {
      const { time, dt, mood, speaking, petted, attentionPulse } = pose;
      const trick = computeTrick(pose);

      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.3 + ((Math.sin(time * 10.5) + 1) * 1.4);
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "happy" || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.93 : blinkTimer < 0.13 ? 1 : 0, 22, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.pupilGroup.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.55 + blinkVal * 0.92;
      }

      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      smoothYaw = damp(smoothYaw, sleeping ? 0 : THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.65, 0.65), 6, dt);
      smoothPitch = damp(smoothPitch, sleeping ? 0.24 : THREE.MathUtils.clamp(-(localLook.y - 0.68) * 0.35, -0.3, 0.3), 6, dt);

      const breathe = Math.sin(time * (sleeping ? 1.8 : 3.2)) * 0.025;
      bodyPivot.position.set(trick.x, trick.y + (sleeping ? -0.05 : 0), trick.z);
      bodyPivot.rotation.set(trick.pitch, trick.yaw, trick.roll + petted * Math.sin(time * 19) * 0.11);
      const sy = trick.squashY * (1 + breathe);
      torso.scale.set(1 / Math.sqrt(Math.max(0.65, sy)), sy, 1 / Math.sqrt(Math.max(0.65, sy)));

      head.rotation.set(
        smoothPitch + (speaking > 0.05 ? Math.sin(time * 18) * 0.08 * speaking : 0),
        smoothYaw,
        (mood === "curious" ? 0.26 : 0) + petted * Math.sin(time * 16) * 0.09,
      );

      // Fanned spirit tails ripple gracefully
      const swaySpd = petted > 0.1 || mood === "playful" ? 6.0 : 2.5;
      tails.forEach((t, idx) => {
        if (!t.root.visible) return;
        t.segs.forEach((s, si) => {
          s.rotation.y = Math.sin(time * swaySpd - si * 0.5 + idx * 0.7) * 0.14;
          s.rotation.x = 0.08 + Math.cos(time * 2.1 - si * 0.4 + idx) * 0.06;
        });
      });

      const earAngle = sleeping ? -0.24 : mood === "curious" ? 0.15 : 0;
      ears[0].rotation.z = earAngle;
      ears[1].rotation.z = -earAngle;

      const walkAmp = Math.min(1, pose.speed * 1.8) + (pose.activeTrick === "dash" ? 1 : 0);
      paws.forEach((p, i) => {
        p.position.y = 0.095 + Math.max(0, Math.sin(time * 13 + i * Math.PI)) * 0.06 * walkAmp;
      });

      spiritTipMat.emissiveIntensity = 0.55 + attentionPulse * 1.25 + petted * 0.6;
      wispMat.emissiveIntensity = 1.1 + attentionPulse * 1.1;

      if (curStage >= 3) {
        wisps.forEach((w, i) => {
          const a = time * 1.3 + (i * Math.PI * 2) / wisps.length;
          w.position.set(Math.cos(a) * 0.58, 0.34 + Math.sin(a * 1.8 + i) * 0.15, Math.sin(a) * 0.58);
        });
      }
      if (curStage >= 4) {
        spiritHalo.rotation.z = time * 0.65;
      }
    },
    dispose() {
      disposeHierarchy(root);
    },
  };
}

// ============================================================================
// 3. PEBBLE — Mossy Axolotl Water Sprite
// ============================================================================

function buildPebbleRig(): PetModelRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const hitMeshes: THREE.Object3D[] = [];

  const mintMat = new THREE.MeshStandardMaterial({ color: 0xb9f5e1, roughness: 0.42, metalness: 0.05 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xe6fff6, roughness: 0.52 });
  const gillMat = new THREE.MeshStandardMaterial({
    color: 0xff8ab5,
    emissive: 0xff5a99,
    emissiveIntensity: 0.45,
    roughness: 0.38,
  });
  const finMat = new THREE.MeshStandardMaterial({
    color: 0x8be9d8,
    emissive: 0x4adcc6,
    emissiveIntensity: 0.25,
    roughness: 0.32,
    transparent: true,
    opacity: 0.88,
  });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x9df7ff,
    emissive: 0x5ef0f5,
    emissiveIntensity: 1.05,
    roughness: 0.15,
  });
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff8aa8,
    emissive: 0xff628c,
    emissiveIntensity: 0.2,
    roughness: 0.6,
  });

  // Four cute stubby amphibious feet at y = 0
  const limbs: THREE.Mesh[] = [];
  const limbPos: [number, number, number][] = [
    [-0.19, 0.075, 0.15],
    [0.19, 0.075, 0.15],
    [-0.18, 0.075, -0.14],
    [0.18, 0.075, -0.14],
  ];
  for (const [lx, ly, lz] of limbPos) {
    const lm = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.06, 8, 10), mintMat);
    lm.position.set(lx, ly, lz);
    lm.rotation.z = lx < 0 ? 0.35 : -0.35;
    bodyPivot.add(lm);
    limbs.push(lm);
    hitMeshes.push(lm);
  }

  // Smooth chubby amphibious torso
  const torso = new THREE.Group();
  torso.position.set(0, 0.27, 0);
  bodyPivot.add(torso);

  const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.255, 26, 20), mintMat);
  bodyMesh.scale.set(1.06, 0.88, 1.32);
  torso.add(bodyMesh);
  hitMeshes.push(bodyMesh);

  const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), bellyMat);
  tummy.scale.set(0.98, 0.68, 1.15);
  tummy.position.set(0, -0.09, 0.04);
  torso.add(tummy);

  // Sweeping undulating aquatic ribbon tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.0, -0.3);
  torso.add(tailPivot);
  const tailSegs: THREE.Group[] = [];
  let tp: THREE.Object3D = tailPivot;
  for (let i = 0; i < 5; i++) {
    const sg = new THREE.Group();
    sg.position.set(0, 0.01, i === 0 ? -0.03 : -0.11);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.1 - i * 0.014, 14, 12), mintMat);
    core.scale.set(0.75, 0.9, 1.35);
    sg.add(core);
    const crest = new THREE.Mesh(new THREE.SphereGeometry(0.115 - i * 0.012, 12, 10), finMat);
    crest.scale.set(0.22, 1.35, 1.3);
    crest.position.set(0, 0.045, 0);
    sg.add(crest);
    hitMeshes.push(core);
    tp.add(sg);
    tailSegs.push(sg);
    tp = sg;
  }

  // Wide joyful axolotl head
  const head = new THREE.Group();
  head.position.set(0, 0.23, 0.2);
  torso.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.25, 28, 22), mintMat);
  skull.scale.set(1.18, 0.88, 1.02);
  head.add(skull);
  hitMeshes.push(skull);

  // 6 lush feathery external gill stalks (3 per side!) with ruffled fronds
  const gills: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    for (let g = 0; g < 3; g++) {
      const stalk = new THREE.Group();
      const angleY = (g - 1) * 0.36;
      const angleZ = side * (0.55 + g * 0.28);
      stalk.position.set(side * 0.24, 0.02 + (1 - g) * 0.06, -0.02 - g * 0.03);
      stalk.rotation.set(0, -side * angleY, -angleZ);

      const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.16, 6, 10), gillMat);
      stem.position.set(0, 0.08, 0);
      stalk.add(stem);

      // Tiny gill frills along each stalk
      for (let f = 0; f < 3; f++) {
        const frond = new THREE.Mesh(new THREE.SphereGeometry(0.034 - f * 0.004, 10, 8), gillMat);
        frond.scale.set(1.4, 0.55, 0.8);
        frond.position.set(0, 0.05 + f * 0.05, 0.01);
        stalk.add(frond);
      }
      head.add(stalk);
      gills.push(stalk);
    }
  }

  // Round glossy dark eyes + wide happy smile + blush cheeks
  const leftEye = makeCuteEye(0.055, 0x101c28, 0xb9f5e1);
  leftEye.group.position.set(-0.125, 0.025, 0.215);
  head.add(leftEye.group);

  const rightEye = makeCuteEye(0.055, 0x101c28, 0xb9f5e1);
  rightEye.group.position.set(0.125, 0.025, 0.215);
  head.add(rightEye.group);

  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.072, 0.01, 8, 20, Math.PI * 0.85),
    new THREE.MeshStandardMaterial({ color: 0x264d47, roughness: 0.4 }),
  );
  smile.position.set(0, -0.025, 0.24);
  smile.rotation.z = Math.PI + 0.23;
  head.add(smile);

  for (const side of [-1, 1]) {
    const bl = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), blushMat);
    bl.scale.set(1.25, 0.62, 0.35);
    bl.position.set(side * 0.185, -0.035, 0.205);
    head.add(bl);
  }

  // Evolution ornaments
  // Stage 2: Little mossy sprout on crown
  const mossSprout = new THREE.Group();
  mossSprout.position.set(0, 0.21, 0.02);
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x5ee09a, emissive: 0x2db870, emissiveIntensity: 0.35, roughness: 0.5 });
  for (const side of [-1, 1]) {
    const lf = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mossMat);
    lf.scale.set(0.55, 1.35, 0.25);
    lf.position.set(side * 0.038, 0.045, 0);
    lf.rotation.z = -side * 0.55;
    mossSprout.add(lf);
  }
  mossSprout.visible = false;
  head.add(mossSprout);

  // Stage 3: Orbiting dewdrop pearls
  const pearlGroup = new THREE.Group();
  const pearls: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), crystalMat);
    pearlGroup.add(p);
    pearls.push(p);
  }
  pearlGroup.visible = false;
  torso.add(pearlGroup);

  // Stage 4: Floating crystal lotus tiara
  const tiaraGroup = new THREE.Group();
  tiaraGroup.position.set(0, 0.34, 0);
  const tiaraRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.014, 10, 32), crystalMat);
  tiaraRing.rotation.x = Math.PI / 2;
  tiaraGroup.add(tiaraRing);
  const lotus = new THREE.Mesh(new THREE.OctahedronGeometry(0.056, 0), crystalMat);
  lotus.position.set(0, 0.045, 0.14);
  tiaraGroup.add(lotus);
  tiaraGroup.visible = false;
  head.add(tiaraGroup);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.42, 0);
  head.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 2.5;
  let blinkVal = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage) => {
    curStage = stage;
    root.scale.setScalar([0.85, 0.95, 1.04, 1.12][stage - 1]);
    mossSprout.visible = stage >= 2;
    pearlGroup.visible = stage >= 3;
    tiaraGroup.visible = stage >= 4;
  };
  setEvolution(1);

  return {
    root,
    headAnchor,
    hitMeshes,
    setEvolution,
    update(pose: PetPoseInput) {
      const { time, dt, mood, speaking, petted, attentionPulse } = pose;
      const trick = computeTrick(pose);

      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.4 + ((Math.cos(time * 8.9) + 1) * 1.4);
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "happy" || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.93 : blinkTimer < 0.13 ? 1 : 0, 22, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.pupilGroup.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.55 + blinkVal * 0.92;
      }

      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      smoothYaw = damp(smoothYaw, sleeping ? 0 : THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.6, 0.6), 6, dt);
      smoothPitch = damp(smoothPitch, sleeping ? 0.2 : THREE.MathUtils.clamp(-(localLook.y - 0.56) * 0.35, -0.3, 0.3), 6, dt);

      const breathe = Math.sin(time * (sleeping ? 1.7 : 3.0)) * 0.03;
      bodyPivot.position.set(trick.x, trick.y + (sleeping ? -0.04 : 0), trick.z);
      bodyPivot.rotation.set(trick.pitch, trick.yaw, trick.roll + petted * Math.sin(time * 18) * 0.13);
      const sy = trick.squashY * (1 + breathe + petted * 0.05);
      torso.scale.set(1 / Math.sqrt(Math.max(0.65, sy)), sy, 1 / Math.sqrt(Math.max(0.65, sy)));

      head.rotation.set(
        smoothPitch + (speaking > 0.05 ? Math.sin(time * 18) * 0.08 * speaking : 0),
        smoothYaw,
        (mood === "curious" ? 0.22 : 0) + petted * Math.sin(time * 15) * 0.09,
      );

      // Feathery gills flutter and glow with live WebGPU attention pulse!
      gills.forEach((g, idx) => {
        const side = idx < 3 ? -1 : 1;
        const gi = idx % 3;
        g.rotation.y = -side * ((gi - 1) * 0.36 + Math.sin(time * 4.2 + idx) * (0.12 + attentionPulse * 0.18));
      });
      gillMat.emissiveIntensity = 0.4 + attentionPulse * 1.4 + petted * 0.7;
      blushMat.emissiveIntensity = 0.2 + petted * 0.75;

      // Swimming tail undulation
      const swimSpd = pose.speed > 0.04 || mood === "playful" ? 7.0 : 3.0;
      tailSegs.forEach((sg, i) => {
        sg.rotation.y = Math.sin(time * swimSpd - i * 0.55) * (0.18 + i * 0.03);
      });

      const walkAmp = Math.min(1, pose.speed * 1.8) + (pose.activeTrick === "dash" ? 1 : 0);
      limbs.forEach((lm, i) => {
        lm.position.y = 0.075 + Math.max(0, Math.sin(time * 12 + i * Math.PI)) * 0.05 * walkAmp;
      });

      if (curStage >= 3) {
        pearls.forEach((p, i) => {
          const a = time * 1.25 + (i * Math.PI * 2) / pearls.length;
          p.position.set(Math.cos(a) * 0.52, 0.28 + Math.sin(a * 2 + i) * 0.12, Math.sin(a) * 0.52);
        });
      }
      if (curStage >= 4) {
        tiaraGroup.rotation.y = time * 0.8;
      }
    },
    dispose() {
      disposeHierarchy(root);
    },
  };
}

export const EXTRA_SPECIES: SpeciesDefinition[] = [
  {
    id: "mochi",
    name: "Mochi",
    species: "Calico Kitten",
    author: "Gemini 4 Neon",
    accentHex: "#ff9e7d",
    tagline: "Squishy calico kitten who purrs louder every time its loss drops.",
    personalitySeed:
      "user: who are you\npet: mrrp! i am mochi, a squishy calico kitten curling up on your GPU.\nuser: pet\npet: purrrrr... my little calico ears just twitched with joy!\n",
    favoriteWords: ["mrrp", "purr", "sunbeam", "whiskers", "cozy"],
    voicePitch: 523.25,
    buildRig: buildMochiRig,
  },
  {
    id: "kitsune",
    name: "Kitsune",
    species: "Spirit Fox Pup",
    author: "Gemini 4 Neon",
    accentHex: "#ff7ab8",
    tagline: "Alabaster spirit fox whose tails bloom from one to five as it evolves.",
    personalitySeed:
      "user: who are you\npet: yip! i am kitsune, a spirit fox pup weaving fox-fire wisps from gradients.\nuser: magic\npet: watch my tails shimmer as new memories settle into my weights!\n",
    favoriteWords: ["yip", "lantern", "wisp", "ember", "spirit"],
    voicePitch: 587.33,
    buildRig: buildKitsuneRig,
  },
  {
    id: "pebble",
    name: "Pebble",
    species: "Mossy Axolotl",
    author: "Gemini 4 Neon",
    accentHex: "#5ef0b5",
    tagline: "Joyful mint water-sprite whose feathery pink gills pulse with attention.",
    personalitySeed:
      "user: who are you\npet: blub! i am pebble, a mossy axolotl who smiles at every new token.\nuser: water\npet: my feathery pink gills shimmer whenever we play together!\n",
    favoriteWords: ["blub", "ripple", "moss", "dewdrop", "splash"],
    voicePitch: 440.0,
    buildRig: buildPebbleRig,
  },
];
