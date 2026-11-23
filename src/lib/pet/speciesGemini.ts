// Three original procedural 3D pet species crafted by Gemini 4 Neon:
//   1. Pip      — Plush Barn Owlet (constellation plumage & starry crest)
//   2. Bramble  — Cloud Red Panda Cub (ringed tail, cream brows, botanical crown)
//   3. Luma     — Starlight Dumbo Octopus (translucent pulsing bell & trailing ribbons)
// Every species implements PetModelRig: feet/base at y = 0, facing +Z, 4-stage
// visual evolution, smooth look-at tracking, mood poses, and all 6 tricks.

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

/** Shared trick motion helper returning body offset, pitch, yaw, roll, squash */
function computeTrickTransform(pose: PetPoseInput): {
  y: number;
  x: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
  squashY: number;
  wingBoost: number;
} {
  const t = pose.trickPhase;
  const out = { y: 0, x: 0, z: 0, pitch: 0, yaw: 0, roll: 0, squashY: 1, wingBoost: 0 };
  if (!pose.activeTrick) return out;

  switch (pose.activeTrick) {
    case "hop": {
      if (t < 0.16) {
        const u = t / 0.16;
        out.squashY = 1 - 0.22 * Math.sin(u * Math.PI * 0.5);
      } else if (t < 0.84) {
        const u = (t - 0.16) / 0.68;
        out.y = Math.sin(u * Math.PI) * 0.68;
        out.squashY = 1 + 0.16 * Math.sin(u * Math.PI);
        out.pitch = -0.18 * Math.sin(u * Math.PI * 2);
        out.wingBoost = 1;
      } else {
        const u = (t - 0.84) / 0.16;
        out.squashY = 1 - 0.2 * Math.sin(u * Math.PI);
      }
      break;
    }
    case "spin": {
      const hop = Math.sin(t * Math.PI) * 0.26;
      out.y = hop;
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      out.yaw = eased * Math.PI * 4;
      out.squashY = 1 + 0.1 * Math.sin(t * Math.PI);
      out.wingBoost = 0.85;
      break;
    }
    case "sing": {
      out.pitch = -0.26 * Math.sin(t * Math.PI);
      out.roll = Math.sin(t * Math.PI * 6) * 0.11;
      out.y = Math.abs(Math.sin(t * Math.PI * 3)) * 0.08;
      out.squashY = 1 + 0.08 * Math.sin(t * Math.PI * 6);
      out.wingBoost = 0.45;
      break;
    }
    case "dash": {
      const ang = t * Math.PI * 2;
      out.x = Math.sin(ang) * 0.55;
      out.z = Math.sin(ang * 2) * 0.28;
      out.yaw = Math.cos(ang) * 0.7;
      out.pitch = 0.22;
      out.y = Math.abs(Math.sin(t * Math.PI * 8)) * 0.12;
      out.wingBoost = 0.9;
      break;
    }
    case "bow": {
      const env = Math.sin(t * Math.PI);
      out.pitch = 0.48 * env;
      out.y = -0.06 * env;
      out.squashY = 1 - 0.1 * env;
      out.wingBoost = 0.3 * env;
      break;
    }
    case "flip": {
      const air = Math.sin(t * Math.PI);
      out.y = air * 0.92;
      out.pitch = -t * Math.PI * 2;
      out.squashY = 1 + 0.14 * air;
      out.wingBoost = 1.2;
      break;
    }
  }
  return out;
}

/** Creates an adorable glossy eye with pupil, twin catchlights, eyelid, and happy squint arc */
function makeExpressiveEye(
  radius: number,
  irisHex: number,
  lidHex: number,
): {
  group: THREE.Group;
  lid: THREE.Mesh;
  squint: THREE.Mesh;
  pupilGroup: THREE.Group;
} {
  const group = new THREE.Group();

  const sclera = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 16),
    new THREE.MeshStandardMaterial({ color: irisHex, roughness: 0.14, metalness: 0.08 }),
  );
  sclera.scale.set(1, 1, 0.68);
  group.add(sclera);

  const pupilGroup = new THREE.Group();
  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.68, 16, 14),
    new THREE.MeshStandardMaterial({ color: 0x0c0e18, roughness: 0.06, metalness: 0.1 }),
  );
  pupil.scale.set(1, 1, 0.65);
  pupil.position.z = radius * 0.34;
  pupilGroup.add(pupil);

  const catch1 = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.23, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  catch1.position.set(radius * 0.25, radius * 0.25, radius * 0.64);
  pupilGroup.add(catch1);

  const catch2 = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.1, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xe6f0ff }),
  );
  catch2.position.set(-radius * 0.2, -radius * 0.16, radius * 0.66);
  pupilGroup.add(catch2);
  group.add(pupilGroup);

  // Blinking upper eyelid hemisphere
  const lid = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.06, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: lidHex, roughness: 0.82 }),
  );
  lid.scale.set(1, 1, 0.72);
  lid.rotation.x = -Math.PI * 0.55;
  group.add(lid);

  // Happy crescent squint arc (shown when petted or joyful)
  const squint = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.68, radius * 0.13, 10, 20, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x1b1622, roughness: 0.5 }),
  );
  squint.position.set(0, -radius * 0.06, radius * 0.56);
  squint.visible = false;
  group.add(squint);

  return { group, lid, squint, pupilGroup };
}

// ============================================================================
// 1. PIP — Plush Barn Owlet (Gemini 4 Neon)
// ============================================================================

function buildPipRig(): PetModelRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const hitMeshes: THREE.Object3D[] = [];

  const creamMat = new THREE.MeshStandardMaterial({ color: 0xf7eee0, roughness: 0.88 });
  const tawnyMat = new THREE.MeshStandardMaterial({ color: 0xc9966a, roughness: 0.84 });
  const mochaMat = new THREE.MeshStandardMaterial({ color: 0x7b563c, roughness: 0.82 });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xffb357, roughness: 0.38 });
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff8ea4,
    emissive: 0xff6e8d,
    emissiveIntensity: 0.15,
    roughness: 0.75,
  });
  const starMat = new THREE.MeshStandardMaterial({
    color: 0xffe49e,
    emissive: 0xffc864,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });

  // Feet / perched talons resting cleanly on y = 0
  const feetGroup = new THREE.Group();
  for (const side of [-1, 1]) {
    const foot = new THREE.Group();
    foot.position.set(side * 0.14, 0.035, 0.05);
    for (let toe = -1; toe <= 1; toe++) {
      const tMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.075, 6, 10), beakMat);
      tMesh.rotation.x = Math.PI / 2;
      tMesh.rotation.z = -toe * 0.35;
      tMesh.position.set(toe * 0.035, 0, 0.03);
      foot.add(tMesh);
    }
    feetGroup.add(foot);
  }
  bodyPivot.add(feetGroup);

  // Plump pear-shaped owl torso
  const torso = new THREE.Group();
  torso.position.set(0, 0.38, 0);
  bodyPivot.add(torso);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.32, 28, 22), creamMat);
  belly.scale.set(1.02, 1.08, 0.95);
  torso.add(belly);
  hitMeshes.push(belly);

  // Warm tawny mantle cloak wrapping back & shoulders
  const cloak = new THREE.Mesh(
    new THREE.SphereGeometry(0.33, 26, 20, 0, Math.PI * 2, 0, Math.PI * 0.72),
    tawnyMat,
  );
  cloak.rotation.x = -0.35;
  cloak.position.set(0, 0.02, -0.04);
  torso.add(cloak);
  hitMeshes.push(cloak);

  // Cute speckled tummy feathers
  for (let i = 0; i < 7; i++) {
    const row = Math.floor(i / 3);
    const col = (i % 3) - 1;
    const speck = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), mochaMat);
    speck.scale.set(1.2, 0.55, 0.4);
    speck.position.set(col * 0.095 + (row % 2 ? 0.04 : 0), -0.02 - row * 0.08, 0.29 - row * 0.015);
    torso.add(speck);
  }

  // Articulated plush wings
  const leftWing = new THREE.Group();
  leftWing.position.set(-0.3, 0.08, -0.02);
  const rightWing = new THREE.Group();
  rightWing.position.set(0.3, 0.08, -0.02);
  const wingStarTips: THREE.Mesh[] = [];

  for (const [wg, side] of [
    [leftWing, -1],
    [rightWing, 1],
  ] as [THREE.Group, number][]) {
    const main = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 14), tawnyMat);
    main.scale.set(0.5, 1.35, 0.95);
    main.position.set(side * 0.05, -0.1, -0.01);
    main.rotation.z = side * 0.18;
    wg.add(main);
    hitMeshes.push(main);

    // Layered feather tips
    for (let f = 0; f < 3; f++) {
      const feather = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.09, 6, 8), mochaMat);
      feather.position.set(side * (0.04 + f * 0.018), -0.27 + f * 0.03, -0.05 + f * 0.045);
      feather.rotation.z = side * (0.22 + f * 0.06);
      wg.add(feather);
    }

    // Stage 3+ glowing constellation feather tip
    const tipStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), starMat);
    tipStar.position.set(side * 0.09, -0.32, 0.01);
    tipStar.visible = false;
    wg.add(tipStar);
    wingStarTips.push(tipStar);
    torso.add(wg);
  }

  // Short fluffy tail feathers
  const tail = new THREE.Group();
  tail.position.set(0, -0.18, -0.26);
  for (let i = -1; i <= 1; i++) {
    const tf = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.14, 6, 10), mochaMat);
    tf.position.set(i * 0.065, 0, -0.03);
    tf.rotation.x = 0.8;
    tf.rotation.z = -i * 0.18;
    tail.add(tf);
  }
  torso.add(tail);

  // Oversized round owl head (swivels smoothly!)
  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.02);
  torso.add(head);

  const headSphere = new THREE.Mesh(new THREE.SphereGeometry(0.285, 28, 22), tawnyMat);
  headSphere.scale.set(1.08, 0.96, 0.98);
  head.add(headSphere);
  hitMeshes.push(headSphere);

  // Heart-shaped plush barn-owl facial disc
  for (const side of [-1, 1]) {
    const disc = new THREE.Mesh(new THREE.SphereGeometry(0.165, 20, 16), creamMat);
    disc.scale.set(0.95, 1.02, 0.42);
    disc.position.set(side * 0.095, -0.01, 0.22);
    head.add(disc);
  }
  const chinDisc = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), creamMat);
  chinDisc.scale.set(1.1, 0.85, 0.4);
  chinDisc.position.set(0, -0.09, 0.23);
  head.add(chinDisc);

  // Plush feathery ear tufts
  const tufts: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const tuft = new THREE.Group();
    tuft.position.set(side * 0.2, 0.21, 0.02);
    const tMain = new THREE.Mesh(new THREE.ConeGeometry(0.068, 0.18, 12), mochaMat);
    tMain.position.set(0, 0.07, 0);
    tMain.rotation.z = -side * 0.38;
    tuft.add(tMain);
    const tInner = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.11, 10), creamMat);
    tInner.position.set(-side * 0.015, 0.055, 0.025);
    tInner.rotation.z = -side * 0.35;
    tuft.add(tInner);
    head.add(tuft);
    tufts.push(tuft);
  }

  // Expressive amber-gold owl eyes
  const leftEye = makeExpressiveEye(0.076, 0xe8a034, 0xc9966a);
  leftEye.group.position.set(-0.115, 0.02, 0.245);
  head.add(leftEye.group);

  const rightEye = makeExpressiveEye(0.076, 0xe8a034, 0xc9966a);
  rightEye.group.position.set(0.115, 0.02, 0.245);
  head.add(rightEye.group);

  // Rosy cheek blushes
  for (const side of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.044, 12, 10), blushMat);
    blush.scale.set(1.2, 0.72, 0.35);
    blush.position.set(side * 0.175, -0.055, 0.235);
    head.add(blush);
  }

  // Cute curved golden beak (upper + tiny lower jaw for speaking!)
  const beak = new THREE.Group();
  beak.position.set(0, -0.03, 0.285);
  const upperBeak = new THREE.Mesh(new THREE.ConeGeometry(0.046, 0.095, 10), beakMat);
  upperBeak.rotation.x = Math.PI * 0.58;
  upperBeak.position.set(0, 0.008, 0.02);
  beak.add(upperBeak);
  const lowerBeak = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.06, 8), beakMat);
  lowerBeak.rotation.x = Math.PI * 0.65;
  lowerBeak.position.set(0, -0.018, 0.01);
  beak.add(lowerBeak);
  head.add(beak);

  // Evolution ornaments
  // Stage 2: Little astronomer scarf & golden brooch
  const scarfGroup = new THREE.Group();
  const scarf = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.042, 12, 28),
    new THREE.MeshStandardMaterial({ color: 0x3b58a8, roughness: 0.78 }),
  );
  scarf.rotation.x = Math.PI / 2;
  scarf.position.set(0, 0.18, 0.02);
  scarfGroup.add(scarf);
  const brooch = new THREE.Mesh(new THREE.OctahedronGeometry(0.048, 0), starMat);
  brooch.position.set(0, 0.16, 0.265);
  scarfGroup.add(brooch);
  scarfGroup.visible = false;
  torso.add(scarfGroup);

  // Stage 3: Orbiting star motes
  const orbitGroup = new THREE.Group();
  orbitGroup.position.set(0, 0.3, 0);
  const orbitMotes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const mote = new THREE.Mesh(new THREE.OctahedronGeometry(0.034, 0), starMat);
    orbitGroup.add(mote);
    orbitMotes.push(mote);
  }
  orbitGroup.visible = false;
  torso.add(orbitGroup);

  // Stage 4: Luminous crescent-moon crest halo above head
  const haloGroup = new THREE.Group();
  haloGroup.position.set(0, 0.36, -0.02);
  const haloRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.016, 10, 36),
    new THREE.MeshStandardMaterial({
      color: 0xa8c8ff,
      emissive: 0x7aa2ff,
      emissiveIntensity: 1.25,
      roughness: 0.2,
    }),
  );
  haloRing.rotation.x = Math.PI / 2 - 0.18;
  haloGroup.add(haloRing);
  const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.018, 10, 20, Math.PI * 1.25), starMat);
  crescent.position.set(0, 0.06, 0.09);
  crescent.rotation.z = 0.6;
  haloGroup.add(crescent);
  haloGroup.visible = false;
  head.add(haloGroup);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.44, 0);
  head.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 2.4;
  let blinkVal = 0;
  let smoothHeadYaw = 0;
  let smoothHeadPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage): void => {
    curStage = stage;
    const s = [0.86, 0.95, 1.04, 1.12][stage - 1];
    root.scale.setScalar(s);
    scarfGroup.visible = stage >= 2;
    orbitGroup.visible = stage >= 3;
    wingStarTips.forEach((m) => (m.visible = stage >= 3));
    haloGroup.visible = stage >= 4;
  };
  setEvolution(1);

  return {
    root,
    headAnchor,
    hitMeshes,
    setEvolution,
    update(pose: PetPoseInput) {
      const { time, dt, mood, speaking, petted, attentionPulse } = pose;
      const trick = computeTrickTransform(pose);

      // Blink cycle
      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.2 + ((Math.sin(time * 13.7) + 1) * 1.5);
      const isBlinking = blinkTimer < 0.14;
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "happy" || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.92 : isBlinking ? 1 : 0, 22, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.pupilGroup.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.55 + blinkVal * 0.92;
      }

      // Smooth head look-at
      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      const targetYaw = THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.65, 0.65);
      const targetPitch = THREE.MathUtils.clamp(-(localLook.y - 0.72) * 0.35, -0.35, 0.3);
      smoothHeadYaw = damp(smoothHeadYaw, sleeping ? 0 : targetYaw, 6, dt);
      smoothHeadPitch = damp(smoothHeadPitch, sleeping ? 0.22 : targetPitch, 6, dt);

      // Breathing & mood motion
      const breathe = Math.sin(time * (sleeping ? 1.8 : 3.1)) * 0.025;
      const curiousTilt = mood === "curious" ? 0.24 * Math.sin(time * 1.6) : 0;
      const petWiggle = petted * Math.sin(time * 22) * 0.14;
      const walkBob = Math.min(1, pose.speed * 1.5) * Math.abs(Math.sin(time * 11)) * 0.06;

      bodyPivot.position.set(trick.x, trick.y + walkBob + (sleeping ? -0.04 : 0), trick.z);
      bodyPivot.rotation.set(trick.pitch, trick.yaw, trick.roll + petWiggle);
      const sy = trick.squashY * (1 + breathe + petted * 0.06);
      const sxz = 1 / Math.sqrt(Math.max(0.6, sy));
      torso.scale.set(sxz, sy, sxz);

      head.rotation.set(
        smoothHeadPitch + (speaking > 0.05 ? Math.sin(time * 18) * 0.08 * speaking : 0),
        smoothHeadYaw,
        curiousTilt + petWiggle * 0.8,
      );
      lowerBeak.rotation.x = Math.PI * 0.65 + speaking * (0.25 + 0.22 * Math.sin(time * 26));

      // Wing flap
      const flapAmp = 0.08 + trick.wingBoost * 0.65 + petted * 0.35 + pose.speed * 0.25;
      const flapFreq = trick.wingBoost > 0.1 ? 15 : 4.2;
      const flap = Math.max(0, Math.sin(time * flapFreq)) * flapAmp;
      leftWing.rotation.z = -0.08 - flap;
      rightWing.rotation.z = 0.08 + flap;

      // Ear tuft perk
      const perk = mood === "curious" || mood === "playful" ? 0.18 : sleeping ? -0.25 : 0;
      tufts[0].rotation.z = perk;
      tufts[1].rotation.z = -perk;

      // Glow & orbits respond to live WebGPU attention pulse
      starMat.emissiveIntensity = 0.75 + attentionPulse * 1.2 + petted * 0.6;
      blushMat.emissiveIntensity = 0.12 + petted * 0.75 + (mood === "happy" ? 0.25 : 0);

      if (curStage >= 3) {
        orbitMotes.forEach((m, i) => {
          const a = time * 1.4 + (i * Math.PI * 2) / orbitMotes.length;
          m.position.set(Math.cos(a) * 0.56, Math.sin(a * 1.5 + i) * 0.14, Math.sin(a) * 0.56);
          m.rotation.y = time * 2 + i;
        });
      }
      if (curStage >= 4) {
        haloGroup.rotation.y = time * 0.8;
        haloGroup.position.y = 0.36 + Math.sin(time * 2.4) * 0.025;
      }
    },
    dispose() {
      disposeHierarchy(root);
    },
  };
}

// ============================================================================
// 2. BRAMBLE — Cloud Red Panda Cub (Gemini 4 Neon)
// ============================================================================

function buildBrambleRig(): PetModelRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const hitMeshes: THREE.Object3D[] = [];

  const rustMat = new THREE.MeshStandardMaterial({ color: 0xd96338, roughness: 0.86 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xfaf0e2, roughness: 0.88 });
  const cocoaMat = new THREE.MeshStandardMaterial({ color: 0x382522, roughness: 0.84 });
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff8a96,
    emissive: 0xff6276,
    emissiveIntensity: 0.12,
    roughness: 0.72,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x5ee09a,
    emissive: 0x35c47b,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const auroraMat = new THREE.MeshStandardMaterial({
    color: 0x8ef5d4,
    emissive: 0x5ef0b5,
    emissiveIntensity: 1.0,
    roughness: 0.2,
  });

  // Four cute cocoa paws resting at y = 0
  const paws: THREE.Mesh[] = [];
  const pawPositions: [number, number, number][] = [
    [-0.17, 0.09, 0.17],
    [0.17, 0.09, 0.17],
    [-0.18, 0.09, -0.14],
    [0.18, 0.09, -0.14],
  ];
  for (const [px, py, pz] of pawPositions) {
    const paw = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.075, 8, 12), cocoaMat);
    paw.position.set(px, py, pz);
    bodyPivot.add(paw);
    paws.push(paw);
    hitMeshes.push(paw);
  }

  // Round plush body
  const torso = new THREE.Group();
  torso.position.set(0, 0.34, 0);
  bodyPivot.add(torso);

  const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.29, 26, 20), rustMat);
  bodyMesh.scale.set(1.02, 0.96, 1.18);
  torso.add(bodyMesh);
  hitMeshes.push(bodyMesh);

  // Dark cocoa underside belly
  const bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), cocoaMat);
  bellyMesh.scale.set(0.95, 0.75, 1.08);
  bellyMesh.position.set(0, -0.09, 0.05);
  torso.add(bellyMesh);

  // Lush ringed red-panda tail (5 alternating rust & cream puffs!)
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, -0.02, -0.28);
  torso.add(tailPivot);
  const tailSegs: THREE.Group[] = [];
  let prevParent: THREE.Object3D = tailPivot;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.02 : 0.035, i === 0 ? -0.04 : -0.115);
    const r = 0.115 - Math.abs(i - 2.3) * 0.015;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 14), i % 2 === 0 ? rustMat : creamMat);
    puff.scale.set(0.95, 0.92, 1.15);
    seg.add(puff);
    hitMeshes.push(puff);
    prevParent.add(seg);
    tailSegs.push(seg);
    prevParent = seg;
  }

  // Cute round head
  const head = new THREE.Group();
  head.position.set(0, 0.31, 0.15);
  torso.add(head);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 26, 20), rustMat);
  headMesh.scale.set(1.12, 0.96, 0.98);
  head.add(headMesh);
  hitMeshes.push(headMesh);

  // Cream cheek puffs & muzzle
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 14), creamMat);
    cheek.scale.set(1.05, 0.85, 0.72);
    cheek.position.set(side * 0.145, -0.06, 0.17);
    head.add(cheek);

    // Signature cream red-panda eyebrow dots!
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), creamMat);
    brow.scale.set(1.15, 0.75, 0.45);
    brow.position.set(side * 0.1, 0.11, 0.22);
    head.add(brow);

    // Soft blush
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), blushMat);
    blush.scale.set(1.2, 0.65, 0.35);
    blush.position.set(side * 0.165, -0.035, 0.215);
    head.add(blush);
  }

  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), creamMat);
  snout.scale.set(1.12, 0.82, 0.85);
  snout.position.set(0, -0.065, 0.225);
  head.add(snout);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), cocoaMat);
  nose.scale.set(1.18, 0.85, 0.85);
  nose.position.set(0, -0.038, 0.295);
  head.add(nose);

  // Rounded cream-rimmed ears
  const ears: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.2, 0.18, 0.01);
    const outer = new THREE.Mesh(new THREE.SphereGeometry(0.088, 16, 12), creamMat);
    outer.scale.set(0.95, 1.08, 0.48);
    outer.rotation.z = -side * 0.32;
    ear.add(outer);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.056, 12, 10), cocoaMat);
    inner.scale.set(0.9, 1.0, 0.4);
    inner.position.set(0, -0.005, 0.025);
    inner.rotation.z = -side * 0.32;
    ear.add(inner);
    head.add(ear);
    ears.push(ear);
  }

  // Expressive eyes
  const leftEye = makeExpressiveEye(0.058, 0x2b1b17, 0xd96338);
  leftEye.group.position.set(-0.105, 0.025, 0.225);
  head.add(leftEye.group);

  const rightEye = makeExpressiveEye(0.058, 0x2b1b17, 0xd96338);
  rightEye.group.position.set(0.105, 0.025, 0.225);
  head.add(rightEye.group);

  // Evolution ornaments
  // Stage 2: Twin sprouting botanical leaves on forehead
  const sproutGroup = new THREE.Group();
  sproutGroup.position.set(0, 0.24, 0.05);
  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), leafMat);
    leaf.scale.set(0.55, 1.45, 0.28);
    leaf.position.set(side * 0.045, 0.055, 0);
    leaf.rotation.z = -side * 0.55;
    sproutGroup.add(leaf);
  }
  sproutGroup.visible = false;
  head.add(sproutGroup);

  // Stage 3: Glowing aurora bandana & floating blossom sparks
  const bandana = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.036, 10, 26),
    new THREE.MeshStandardMaterial({ color: 0x3b8c6e, emissive: 0x236950, emissiveIntensity: 0.45, roughness: 0.6 }),
  );
  bandana.rotation.x = Math.PI / 2 + 0.12;
  bandana.position.set(0, 0.16, 0.1);
  bandana.visible = false;
  torso.add(bandana);

  // Stage 4: Floating emerald-aurora wreath & orbiting seed-of-light motes
  const wreathGroup = new THREE.Group();
  wreathGroup.position.set(0, 0.34, 0);
  const wreathRing = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.015, 10, 32), auroraMat);
  wreathRing.rotation.x = Math.PI / 2;
  wreathGroup.add(wreathRing);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    const bud = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), auroraMat);
    bud.position.set(Math.cos(a) * 0.21, 0.02, Math.sin(a) * 0.21);
    wreathGroup.add(bud);
  }
  wreathGroup.visible = false;
  head.add(wreathGroup);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.42, 0);
  head.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 1.9;
  let blinkVal = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage): void => {
    curStage = stage;
    const s = [0.85, 0.95, 1.04, 1.12][stage - 1];
    root.scale.setScalar(s);
    sproutGroup.visible = stage >= 2;
    bandana.visible = stage >= 3;
    wreathGroup.visible = stage >= 4;
  };
  setEvolution(1);

  return {
    root,
    headAnchor,
    hitMeshes,
    setEvolution,
    update(pose: PetPoseInput) {
      const { time, dt, mood, speaking, petted, attentionPulse } = pose;
      const trick = computeTrickTransform(pose);

      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.0 + ((Math.cos(time * 11.3) + 1) * 1.4);
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "happy" || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.92 : blinkTimer < 0.13 ? 1 : 0, 22, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.pupilGroup.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.55 + blinkVal * 0.92;
      }

      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      smoothYaw = damp(smoothYaw, sleeping ? 0 : THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.6, 0.6), 6, dt);
      smoothPitch = damp(smoothPitch, sleeping ? 0.25 : THREE.MathUtils.clamp(-(localLook.y - 0.68) * 0.35, -0.3, 0.3), 6, dt);

      const breathe = Math.sin(time * (sleeping ? 1.9 : 3.4)) * 0.028;
      const walkCycle = pose.speed > 0.04 ? time * 13 : time * 3;
      const walkAmp = Math.min(1, pose.speed * 1.8) + (pose.activeTrick === "dash" ? 1 : 0);

      bodyPivot.position.set(trick.x, trick.y + (sleeping ? -0.05 : 0), trick.z);
      bodyPivot.rotation.set(trick.pitch, trick.yaw, trick.roll + petted * Math.sin(time * 20) * 0.12);
      const sy = trick.squashY * (1 + breathe + petted * 0.05);
      const sxz = 1 / Math.sqrt(Math.max(0.6, sy));
      torso.scale.set(sxz, sy, sxz);

      head.rotation.set(
        smoothPitch + (speaking > 0.05 ? Math.sin(time * 19) * 0.09 * speaking : 0),
        smoothYaw,
        (mood === "curious" ? 0.22 : 0) + petted * Math.sin(time * 18) * 0.1,
      );

      // Paws bounce when running or excited
      paws.forEach((p, idx) => {
        const phase = idx % 2 === 0 ? 0 : Math.PI;
        const lift = Math.max(0, Math.sin(walkCycle + phase)) * 0.06 * walkAmp;
        p.position.y = 0.09 + lift;
        p.rotation.x = Math.sin(walkCycle + phase) * 0.38 * walkAmp;
      });

      // Swishy multi-segment ringed tail
      const wagSpeed = mood === "playful" || petted > 0.1 ? 7.5 : 2.6;
      const wagAmp = mood === "playful" || petted > 0.1 ? 0.26 : 0.11;
      tailSegs.forEach((seg, i) => {
        seg.rotation.y = Math.sin(time * wagSpeed - i * 0.45) * wagAmp;
        seg.rotation.x = 0.06 + Math.cos(time * wagSpeed * 0.5 - i * 0.3) * 0.05;
      });

      // Ear bounce
      const earPerk = mood === "curious" || mood === "playful" ? 0.14 : sleeping ? -0.22 : 0;
      ears[0].rotation.z = earPerk;
      ears[1].rotation.z = -earPerk;

      leafMat.emissiveIntensity = 0.35 + attentionPulse * 0.9;
      auroraMat.emissiveIntensity = 0.8 + attentionPulse * 1.1;
      blushMat.emissiveIntensity = 0.12 + petted * 0.7;

      if (curStage >= 4) {
        wreathGroup.rotation.y = time * 0.9;
      }
    },
    dispose() {
      disposeHierarchy(root);
    },
  };
}

// ============================================================================
// 3. LUMA — Starlight Dumbo Octopus / Cosmic Jelly (Gemini 4 Neon)
// ============================================================================

function buildLumaRig(): PetModelRig {
  const root = new THREE.Group();
  const floatPivot = new THREE.Group();
  root.add(floatPivot);
  const hitMeshes: THREE.Object3D[] = [];

  const bellMat = new THREE.MeshPhysicalMaterial({
    color: 0x7cb8ff,
    emissive: 0x3b6dff,
    emissiveIntensity: 0.42,
    roughness: 0.18,
    metalness: 0.05,
    transmission: 0.32,
    transparent: true,
    opacity: 0.92,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xe6f4ff,
    emissive: 0x9bd6ff,
    emissiveIntensity: 0.95,
    roughness: 0.25,
  });
  const finMat = new THREE.MeshStandardMaterial({
    color: 0xb7a6ff,
    emissive: 0x7b63ff,
    emissiveIntensity: 0.45,
    roughness: 0.3,
    transparent: true,
    opacity: 0.88,
  });
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: 0x6ef2e6,
    emissive: 0x3fd8cf,
    emissiveIntensity: 0.72,
    roughness: 0.25,
  });
  const starMat = new THREE.MeshStandardMaterial({
    color: 0xfff0b8,
    emissive: 0xffd36e,
    emissiveIntensity: 1.15,
    roughness: 0.18,
  });

  // Translucent floating dome bell hovering cleanly above y = 0
  const body = new THREE.Group();
  body.position.set(0, 0.56, 0);
  floatPivot.add(body);

  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 30, 24), bellMat);
  bell.scale.set(1.06, 0.96, 1.0);
  body.add(bell);
  hitMeshes.push(bell);

  // Soft glowing inner star-core heart visible inside the translucent bell!
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), coreMat);
  core.position.set(0, 0.02, -0.02);
  body.add(core);

  // Ruffled skirt rim around bottom of bell
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.052, 14, 32), finMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, -0.18, 0);
  body.add(rim);

  // Adorable flapping Dumbo-octopus ear-fins on either side of the head!
  const leftFin = new THREE.Group();
  leftFin.position.set(-0.27, 0.06, -0.01);
  const rightFin = new THREE.Group();
  rightFin.position.set(0.27, 0.06, -0.01);
  for (const [fg, side] of [
    [leftFin, -1],
    [rightFin, 1],
  ] as [THREE.Group, number][]) {
    const fMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 14), finMat);
    fMesh.scale.set(1.35, 0.52, 0.72);
    fMesh.position.set(side * 0.1, 0.02, 0);
    fg.add(fMesh);
    hitMeshes.push(fMesh);
    body.add(fg);
  }

  // Expressive starry eyes + soft bioluminescent blush
  const leftEye = makeExpressiveEye(0.062, 0x101730, 0x7cb8ff);
  leftEye.group.position.set(-0.115, -0.02, 0.255);
  body.add(leftEye.group);

  const rightEye = makeExpressiveEye(0.062, 0x101730, 0x7cb8ff);
  rightEye.group.position.set(0.115, -0.02, 0.255);
  body.add(rightEye.group);

  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xff9ad5,
    emissive: 0xff6ec4,
    emissiveIntensity: 0.45,
    roughness: 0.4,
  });
  for (const side of [-1, 1]) {
    const bl = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), blushMat);
    bl.scale.set(1.25, 0.65, 0.35);
    bl.position.set(side * 0.18, -0.075, 0.23);
    body.add(bl);
  }

  // 6 gracefully trailing undulating glowing tentacles (touching near y ~ 0.05)
  const tentacles: THREE.Group[][] = [];
  for (let t = 0; t < 6; t++) {
    const ang = (t * Math.PI * 2) / 6 + Math.PI / 6;
    const baseGroup = new THREE.Group();
    baseGroup.position.set(Math.cos(ang) * 0.18, -0.2, Math.sin(ang) * 0.18);
    body.add(baseGroup);
    const segs: THREE.Group[] = [];
    let parent: THREE.Object3D = baseGroup;
    for (let s = 0; s < 4; s++) {
      const seg = new THREE.Group();
      seg.position.set(0, s === 0 ? -0.04 : -0.088, 0);
      const r = 0.042 * (1 - s * 0.19);
      const bead = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.055, 6, 10), s === 3 ? ribbonMat : finMat);
      seg.add(bead);
      parent.add(seg);
      segs.push(seg);
      parent = seg;
    }
    tentacles.push(segs);
  }

  // Evolution ornaments
  // Stage 2: Equatorial bioluminescent starlight belt
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.014, 10, 36), ribbonMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.set(0, -0.06, 0);
  belt.visible = false;
  body.add(belt);

  // Stage 3: Orbiting star-pearls
  const pearlGroup = new THREE.Group();
  const pearls: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.036, 0), starMat);
    pearlGroup.add(p);
    pearls.push(p);
  }
  pearlGroup.visible = false;
  body.add(pearlGroup);

  // Stage 4: Twin intersecting cosmic astrolabe halo rings!
  const astroGroup = new THREE.Group();
  astroGroup.position.set(0, 0.34, 0);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.013, 10, 40), starMat);
  ringA.rotation.x = Math.PI / 2 - 0.25;
  astroGroup.add(ringA);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.011, 10, 32), ribbonMat);
  ringB.rotation.x = Math.PI / 2 + 0.35;
  astroGroup.add(ringB);
  astroGroup.visible = false;
  body.add(astroGroup);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.42, 0);
  body.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 2.6;
  let blinkVal = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage): void => {
    curStage = stage;
    const s = [0.86, 0.95, 1.04, 1.12][stage - 1];
    root.scale.setScalar(s);
    belt.visible = stage >= 2;
    pearlGroup.visible = stage >= 3;
    astroGroup.visible = stage >= 4;
  };
  setEvolution(1);

  return {
    root,
    headAnchor,
    hitMeshes,
    setEvolution,
    update(pose: PetPoseInput) {
      const { time, dt, mood, speaking, petted, attentionPulse } = pose;
      const trick = computeTrickTransform(pose);

      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.5 + ((Math.sin(time * 9.1) + 1) * 1.4);
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "happy" || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.92 : blinkTimer < 0.13 ? 1 : 0, 20, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.pupilGroup.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.55 + blinkVal * 0.92;
      }

      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      smoothYaw = damp(smoothYaw, sleeping ? 0 : THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.7, 0.7), 5, dt);
      smoothPitch = damp(smoothPitch, sleeping ? 0.18 : THREE.MathUtils.clamp(-(localLook.y - 0.65) * 0.3, -0.25, 0.25), 5, dt);

      // Gentle buoyant hover + jelly pulse!
      const pulse = Math.sin(time * (sleeping ? 1.5 : 2.9));
      const hoverY = (sleeping ? -0.06 : 0.055 * pulse) + trick.y;
      floatPivot.position.set(trick.x, hoverY, trick.z);
      floatPivot.rotation.set(
        trick.pitch + smoothPitch * 0.6,
        trick.yaw + smoothYaw * 0.7,
        trick.roll + (mood === "curious" ? 0.18 : 0) + petted * Math.sin(time * 18) * 0.14,
      );

      const sy = trick.squashY * (1 + pulse * 0.055 + speaking * Math.sin(time * 20) * 0.05);
      const sxz = 1 / Math.sqrt(Math.max(0.65, sy));
      bell.scale.set(1.06 * sxz, 0.96 * sy, 1.0 * sxz);

      // Flapping Dumbo ear fins
      const finAmp = 0.28 + trick.wingBoost * 0.45 + petted * 0.3;
      const finWave = Math.sin(time * (trick.wingBoost > 0.1 ? 12 : 4.2)) * finAmp;
      leftFin.rotation.z = 0.15 + finWave;
      rightFin.rotation.z = -0.15 - finWave;

      // Trailing undulating tentacles
      tentacles.forEach((segs, tIdx) => {
        segs.forEach((seg, sIdx) => {
          seg.rotation.x = Math.sin(time * 3.1 - sIdx * 0.65 + tIdx * 0.8) * (0.14 + sIdx * 0.05);
          seg.rotation.z = Math.cos(time * 2.4 - sIdx * 0.55 + tIdx * 1.1) * (0.12 + sIdx * 0.04);
        });
      });

      // Glowing neural core pulses directly with WebGPU attention energy!
      core.rotation.y = time * 0.9;
      core.rotation.x = time * 0.6;
      const coreScale = 1 + attentionPulse * 0.28 + speaking * 0.15;
      core.scale.setScalar(coreScale);
      coreMat.emissiveIntensity = 0.85 + attentionPulse * 1.4 + petted * 0.7;
      bellMat.emissiveIntensity = 0.35 + attentionPulse * 0.55;
      blushMat.emissiveIntensity = 0.4 + petted * 0.85;

      if (curStage >= 3) {
        pearls.forEach((p, i) => {
          const a = time * 1.2 + (i * Math.PI * 2) / pearls.length;
          p.position.set(Math.cos(a) * 0.48, Math.sin(a * 2 + i) * 0.14, Math.sin(a) * 0.48);
          p.rotation.y = time * 2.2;
        });
      }
      if (curStage >= 4) {
        astroGroup.rotation.y = time * 0.75;
        ringB.rotation.z = -time * 1.1;
      }
    },
    dispose() {
      disposeHierarchy(root);
    },
  };
}

// ============================================================================
// Export Gemini 4 Neon's Species Catalog
// ============================================================================

export const GEMINI_SPECIES: SpeciesDefinition[] = [
  {
    id: "pip",
    name: "Pip",
    species: "Barn Owlet",
    author: "Gemini 4 Neon",
    accentHex: "#ffcb77",
    tagline: "Plush starry owlet who tilts their head at every new word.",
    personalitySeed:
      "user: who are you\npet: hoo! i am pip, a tiny starry owlet learning new words with you.\nuser: stars\npet: i love counting constellations while my weights settle!\n",
    favoriteWords: ["hoo", "stars", "lantern", "feather", "moonlight"],
    voicePitch: 659.25,
    buildRig: buildPipRig,
  },
  {
    id: "bramble",
    name: "Bramble",
    species: "Cloud Red Panda",
    author: "Gemini 4 Neon",
    accentHex: "#ff7e57",
    tagline: "Bouncy red panda cub with a ringed fluffy tail and curious paws.",
    personalitySeed:
      "user: who are you\npet: chirp! i am bramble, a cloud red panda who loves zoomies and soft moss.\nuser: play\npet: toss the glowing orb and watch my ringed tail swish!\n",
    favoriteWords: ["chirp", "moss", "clover", "zoomies", "cozy"],
    voicePitch: 493.88,
    buildRig: buildBrambleRig,
  },
  {
    id: "luma",
    name: "Luma",
    species: "Starlight Dumbo",
    author: "Gemini 4 Neon",
    accentHex: "#6ef2e6",
    tagline: "Bioluminescent deep-sky dumbo jelly whose core glows with attention.",
    personalitySeed:
      "user: who are you\npet: bloop! i am luma, a drifting starlight sprite whose heart pulses with your GPU.\nuser: dream\npet: floating softly through ripples of light while dreaming wiser weights.\n",
    favoriteWords: ["bloop", "ripple", "shimmer", "nebula", "glow"],
    voicePitch: 783.99,
    buildRig: buildLumaRig,
  },
];
