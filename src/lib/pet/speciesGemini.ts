// Three studio-grade procedural 3D companions crafted by Gemini 4 Neon:
//   1. Pip      — Starlight Barn Owlet (SDF plush body, layered feather shells,
//                 carved heart facial disc, brass astronomer compass & armillary halo)
//   2. Bramble  — Cloud Red Panda Cub (SDF organic body, Mana-style volumetric fur shells,
//                 banded plush tail, botanical acorn-lantern scarf & emerald antler-wreath)
//   3. Luma     — Abyssal Starlight Dumbo (SDF translucent backlit SSS jelly bell,
//                 visible inner constellation core, trailing bioluminescent tentacles & astrolabe)

import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import {
  buildSdfGeometry,
  sdEllipsoid,
  sdRoundCone,
  sdSphere,
  sdfNoise3,
  smax,
  smin,
  smoothstep,
} from "./sdfSculpt";
import {
  addFurShells,
  makeArtisanMetalMaterial,
  makeBioSssMaterial,
  makeHdrGlowMaterial,
  makeJewelEyeMaterial,
  makePlushSssMaterial,
  makeSilkFabricMaterial,
} from "./petShaders";
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
  const out = { y: 0, x: 0, z: 0, pitch: 0, yaw: 0, roll: 0, squashY: 1, boost: 0 };
  if (!pose.activeTrick) return out;
  switch (pose.activeTrick) {
    case "hop":
      if (t < 0.16) out.squashY = 1 - 0.22 * Math.sin((t / 0.16) * Math.PI * 0.5);
      else if (t < 0.84) {
        const u = (t - 0.16) / 0.68;
        out.y = Math.sin(u * Math.PI) * 0.72;
        out.squashY = 1 + 0.16 * Math.sin(u * Math.PI);
        out.pitch = -0.16 * Math.sin(u * Math.PI * 2);
        out.boost = 1;
      } else out.squashY = 1 - 0.2 * Math.sin(((t - 0.84) / 0.16) * Math.PI);
      break;
    case "spin": {
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      out.y = Math.sin(t * Math.PI) * 0.3;
      out.yaw = eased * Math.PI * 4;
      out.squashY = 1 + 0.1 * Math.sin(t * Math.PI);
      out.boost = 0.9;
      break;
    }
    case "sing":
      out.pitch = -0.26 * Math.sin(t * Math.PI);
      out.roll = Math.sin(t * Math.PI * 6) * 0.12;
      out.y = Math.abs(Math.sin(t * Math.PI * 3)) * 0.08;
      out.squashY = 1 + 0.07 * Math.sin(t * Math.PI * 6);
      out.boost = 0.55;
      break;
    case "dash": {
      const a = t * Math.PI * 2;
      out.x = Math.sin(a) * 0.58;
      out.z = Math.sin(a * 2) * 0.28;
      out.yaw = Math.cos(a) * 0.72;
      out.pitch = 0.22;
      out.y = Math.abs(Math.sin(t * Math.PI * 8)) * 0.12;
      out.boost = 1.0;
      break;
    }
    case "bow": {
      const e = Math.sin(t * Math.PI);
      out.pitch = 0.44 * e;
      out.y = -0.02 * e;
      out.squashY = 1 - 0.1 * e;
      out.boost = 0.35 * e;
      break;
    }
    case "flip":
      out.y = Math.sin(t * Math.PI) * 0.96;
      out.pitch = -t * Math.PI * 2;
      out.squashY = 1 + 0.14 * Math.sin(t * Math.PI);
      out.boost = 1.25;
      break;
  }
  return out;
}

/** Deep studio jewel eye with sculpted blinking lid and happy crescent squint */
function makeStudioEye(radius: number, irisHex: number, hiHex: number, lidHex: number, pupilR = 0.42) {
  const group = new THREE.Group();
  const eyeMat = makeJewelEyeMaterial(irisHex, hiHex, pupilR);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 22), eyeMat);
  ball.scale.set(1, 1, 0.74);
  group.add(ball);

  const lidMat = makePlushSssMaterial({
    baseColor: lidHex,
    useSdfAttrs: false,
    sssColor: 0xffb899,
    sssStrength: 0.45,
    roughness: 0.85,
  });
  const lid = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.07, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
    lidMat,
  );
  lid.scale.set(1, 1, 0.78);
  lid.rotation.x = -Math.PI * 0.56;
  group.add(lid);

  const squint = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.68, radius * 0.12, 12, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x1b1524, roughness: 0.4 }),
  );
  squint.position.set(0, -radius * 0.05, radius * 0.62);
  squint.visible = false;
  group.add(squint);

  return { group, ball, lid, squint };
}

function rgbMix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// ============================================================================
// 1. PIP — Starlight Barn Owlet (SDF Sculpt + Feather Shells + Brass Armillary)
// ============================================================================

let cachedPipBodyGeo: THREE.BufferGeometry | null = null;
let cachedPipHeadGeo: THREE.BufferGeometry | null = null;

function getPipGeometries() {
  if (!cachedPipBodyGeo) {
    cachedPipBodyGeo = buildSdfGeometry({
      min: [-0.42, -0.02, -0.44],
      max: [0.42, 0.72, 0.42],
      cell: 0.025,
      smoothPasses: 1,
      sdf(x, y, z) {
        // Plump pear-shaped owl torso resting above talons
        let d = sdEllipsoid(x, y, z, 0, 0.34, -0.01, 0.3, 0.33, 0.29);
        // Fuller puffed chest + soft rump
        d = smin(d, sdEllipsoid(x, y, z, 0, 0.42, 0.08, 0.24, 0.22, 0.22), 0.12);
        d = smin(d, sdEllipsoid(x, y, z, 0, 0.18, -0.08, 0.25, 0.17, 0.24), 0.11);
        // Sculpted fluffy tail fan integrated into rump
        const ax = Math.abs(x);
        const tail = sdRoundCone(ax, y, z, 0.04, 0.14, -0.22, 0.1, 0.08, -0.4, 0.085, 0.032);
        const tailMid = sdRoundCone(x, y, z, 0, 0.14, -0.23, 0, 0.075, -0.42, 0.09, 0.036);
        d = smin(d, Math.min(tail, tailMid), 0.07);
        // Subtle organic feather-contour fluff
        const n = sdfNoise3(x * 11.5 + 3.1, y * 9.5 + 1.7, z * 11.5) - 0.5;
        return d - n * 0.014;
      },
      paint(x, y, z, _nx, ny, nz) {
        const cream: [number, number, number] = [0.95, 0.89, 0.77];
        const honey: [number, number, number] = [0.76, 0.52, 0.33];
        const espresso: [number, number, number] = [0.36, 0.22, 0.15];
        // Cream belly front fading into warm tawny-honey back mantle
        const backMask = smoothstep(0.18, -0.14, nz + z * 0.9);
        let col = rgbMix(cream, honey, backMask);
        // Tail feathers & scapulars darker espresso
        const tailMask = smoothstep(-0.22, -0.34, z);
        col = rgbMix(col, espresso, tailMask * 0.78);
        // Delicate barn-owl speckles on chest!
        const speck =
          smoothstep(0.68, 0.84, sdfNoise3(x * 26 + 7, y * 22 + 3, z * 26)) *
          (1 - backMask) *
          smoothstep(0.08, 0.25, y);
        col = rgbMix(col, espresso, speck * 0.55);
        // Subtle sunlit cream highlight on top shoulders
        col = rgbMix(col, [0.92, 0.76, 0.58], smoothstep(0.55, 0.92, ny) * backMask * 0.35);
        return [col[0], col[1], col[2], tailMask * 0.55];
      },
    });
  }

  if (!cachedPipHeadGeo) {
    cachedPipHeadGeo = buildSdfGeometry({
      min: [-0.38, -0.26, -0.34],
      max: [0.38, 0.44, 0.36],
      cell: 0.022,
      smoothPasses: 1,
      sdf(x, y, z) {
        const ax = Math.abs(x);
        // Round plush owl head
        let d = sdEllipsoid(x, y, z, 0, 0.02, 0.0, 0.275, 0.245, 0.255);
        // Sculpted heart-shaped barn-owl facial disc rim!
        const cheekDisc = sdEllipsoid(ax, y, z, 0.1, 0.0, 0.18, 0.145, 0.155, 0.095);
        d = smin(d, cheekDisc, 0.055);
        // Subtle recessed eye sockets so jewel eyes nest seamlessly
        const socket = sdSphere(ax, y, z, 0.108, 0.02, 0.245, 0.072);
        d = smax(d, -socket, 0.025);
        // Swept feathered ear tufts (backlit SSS!)
        const tuftMain = sdRoundCone(ax, y, z, 0.155, 0.18, 0.01, 0.255, 0.37, -0.06, 0.068, 0.016);
        const tuftSub = sdRoundCone(ax, y, z, 0.18, 0.13, -0.01, 0.285, 0.26, -0.07, 0.045, 0.012);
        d = smin(d, Math.min(tuftMain, tuftSub), 0.045);
        // Fluffy cheek ruff flares
        const ruff = sdRoundCone(ax, y, z, 0.18, -0.05, 0.08, 0.27, -0.1, 0.03, 0.055, 0.018);
        d = smin(d, ruff, 0.04);
        const n = sdfNoise3(x * 13 + 5, y * 13 + 2, z * 13) - 0.5;
        return d - n * 0.01;
      },
      paint(x, y, z, _nx, _ny, nz) {
        const ax = Math.abs(x);
        const cream: [number, number, number] = [0.97, 0.93, 0.85];
        const honey: [number, number, number] = [0.76, 0.51, 0.32];
        const dark: [number, number, number] = [0.32, 0.2, 0.14];
        const blush: [number, number, number] = [0.96, 0.56, 0.62];

        // Heart-shaped bright cream facial disc with warm cinnamon rim!
        const heartDist = Math.hypot((ax - 0.085) * 1.1, (y - 0.01 + ax * 0.28) * 1.05);
        const inFace = smoothstep(0.2, 0.14, heartDist) * smoothstep(0.08, 0.2, nz + z * 0.45);
        const rimRing = smoothstep(0.19, 0.155, heartDist) * smoothstep(0.11, 0.155, heartDist) * smoothstep(0.05, 0.18, nz);

        let col = rgbMix(honey, cream, inFace);
        col = rgbMix(col, dark, rimRing * 0.65);

        // Dark espresso ear-tuft tips with warm sunlit SSS translucency!
        const tuftTip = smoothstep(0.2, 0.34, y);
        col = rgbMix(col, dark, tuftTip * 0.72);

        // Soft rosy cheek blush beneath eyes
        const blushD = Math.hypot((ax - 0.165) * 1.2, (y + 0.055) * 1.6, (z - 0.2) * 1.3);
        col = rgbMix(col, blush, smoothstep(0.085, 0.03, blushD) * 0.55);

        return [col[0], col[1], col[2], Math.max(tuftTip * 0.9, inFace * 0.25)];
      },
    });
  }
  return { bodyGeo: cachedPipBodyGeo, headGeo: cachedPipHeadGeo };
}

function buildPipRig(): PetModelRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const hitMeshes: THREE.Object3D[] = [];
  const uPulse = uniform(0.2);

  const { bodyGeo, headGeo } = getPipGeometries();

  const bodyMat = makePlushSssMaterial({
    sssColor: 0xffb478,
    sssStrength: 0.82,
    roughness: 0.84,
    sheen: 0.78,
    grainScale: 42,
    pulseUniform: uPulse,
  });
  const headMat = makePlushSssMaterial({
    sssColor: 0xffbd88,
    sssStrength: 0.85,
    roughness: 0.82,
    sheen: 0.8,
    grainScale: 46,
    pulseUniform: uPulse,
  });

  const brassMat = makeArtisanMetalMaterial(0xe8bf68, 0.22);
  const scarfMat = makeSilkFabricMaterial(0x283e85, 0x8fb8ff);
  const starGlow = makeHdrGlowMaterial(0xffde85, 1.8, uPulse);
  const cyanGlow = makeHdrGlowMaterial(0x88c8ff, 1.5, uPulse);
  const beakMat = new THREE.MeshPhysicalMaterial({ color: 0xf4a846, roughness: 0.28, clearcoat: 0.45 });

  // Sculpted owl talons resting cleanly at y = 0
  for (const side of [-1, 1]) {
    const foot = new THREE.Group();
    foot.position.set(side * 0.135, 0.028, 0.045);
    for (let toe = -1; toe <= 1; toe++) {
      const tMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.075, 8, 12), beakMat);
      tMesh.rotation.x = Math.PI / 2;
      tMesh.rotation.z = -toe * 0.36;
      tMesh.position.set(toe * 0.032, 0, 0.028);
      tMesh.castShadow = true;
      foot.add(tMesh);
    }
    bodyPivot.add(foot);
  }

  // Main SDF Torso + Volumetric Feather Shells
  const torso = new THREE.Group();
  bodyPivot.add(torso);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  torso.add(bodyMesh);
  hitMeshes.push(bodyMesh);
  addFurShells(torso, bodyGeo, { layers: 5, length: 0.019, density: 62, sssColor: 0xffcca0, groom: [0, -0.6, -0.25] });

  // Sculpted Multi-Layered Articulated Wings (primary + covert feather fans!)
  const wingBaseMat = makePlushSssMaterial({
    baseColor: 0xc28554,
    useSdfAttrs: false,
    sssColor: 0xffaa68,
    sssStrength: 0.78,
  });
  const wingTipMat = makePlushSssMaterial({
    baseColor: 0x5c3c28,
    useSdfAttrs: false,
    sssColor: 0xffb36e,
    sssStrength: 0.65,
  });

  const leftWing = new THREE.Group();
  leftWing.position.set(-0.27, 0.45, -0.02);
  const rightWing = new THREE.Group();
  rightWing.position.set(0.27, 0.45, -0.02);
  const wingStars: THREE.Mesh[] = [];

  for (const [wg, side] of [
    [leftWing, -1],
    [rightWing, 1],
  ] as [THREE.Group, number][]) {
    // Upper covert cushion
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), wingBaseMat);
    shoulder.scale.set(0.46, 1.15, 0.92);
    shoulder.position.set(side * 0.04, -0.06, -0.01);
    shoulder.castShadow = true;
    wg.add(shoulder);
    hitMeshes.push(shoulder);

    // 5 fanned primary feathers!
    for (let f = 0; f < 5; f++) {
      const frac = f / 4;
      const feather = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.135 - frac * 0.03, 8, 12), f % 2 ? wingTipMat : wingBaseMat);
      feather.position.set(side * (0.045 + frac * 0.018), -0.18 + frac * 0.035, -0.09 + frac * 0.045);
      feather.rotation.z = side * (0.16 + frac * 0.08);
      feather.rotation.x = 0.12 - frac * 0.08;
      feather.castShadow = true;
      wg.add(feather);
    }

    // Stage 3+ glowing starlight feather brooch on wing edge
    const tipStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), starGlow);
    tipStar.position.set(side * 0.095, -0.25, 0.02);
    tipStar.visible = false;
    wg.add(tipStar);
    wingStars.push(tipStar);
    torso.add(wg);
  }

  // Articulated SDF Head + Volumetric Feather Shells
  const head = new THREE.Group();
  head.position.set(0, 0.65, 0.03);
  torso.add(head);

  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);
  hitMeshes.push(headMesh);
  addFurShells(head, headGeo, { layers: 4, length: 0.016, density: 68, sssColor: 0xffd5a8, groom: [0, -0.35, -0.4] });

  // Studio Jewel Golden Owl Eyes
  const leftEye = makeStudioEye(0.068, 0xd8881c, 0xffe484, 0xc28658, 0.44);
  leftEye.group.position.set(-0.106, 0.02, 0.215);
  leftEye.group.rotation.y = -0.2;
  head.add(leftEye.group);

  const rightEye = makeStudioEye(0.068, 0xd8881c, 0xffe484, 0xc28658, 0.44);
  rightEye.group.position.set(0.106, 0.02, 0.215);
  rightEye.group.rotation.y = 0.2;
  head.add(rightEye.group);

  // Sculpted curved amber beak (upper + articulated lower jaw!)
  const beak = new THREE.Group();
  beak.position.set(0, -0.025, 0.255);
  const upperBeak = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.095, 14), beakMat);
  upperBeak.rotation.x = Math.PI * 0.62;
  upperBeak.position.set(0, 0.008, 0.025);
  beak.add(upperBeak);
  const lowerBeak = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.06, 12), beakMat);
  lowerBeak.rotation.x = Math.PI * 0.68;
  lowerBeak.position.set(0, -0.016, 0.014);
  beak.add(lowerBeak);
  head.add(beak);

  // ---- Artisanal Evolution Adornments (Stages 1 → 4) ----
  // Stage 2: Embroidered midnight-blue astronomer scarf + brass compass medallion!
  const scarfGroup = new THREE.Group();
  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.04, 16, 36), scarfMat);
  scarfRing.rotation.x = Math.PI / 2 + 0.08;
  scarfRing.position.set(0, 0.51, 0.02);
  scarfRing.castShadow = true;
  scarfGroup.add(scarfRing);

  // Trailing draped scarf tail with golden hem trim
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.2, 0.022), scarfMat);
  scarfTail.position.set(0.11, 0.39, 0.215);
  scarfTail.rotation.set(-0.22, 0.25, 0.16);
  scarfGroup.add(scarfTail);
  const hem = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.022, 0.026), brassMat);
  hem.position.set(0.125, 0.3, 0.236);
  hem.rotation.set(-0.22, 0.25, 0.16);
  scarfGroup.add(hem);

  // Antique brass compass clasp with glowing star crystal center
  const compassRing = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.01, 10, 24), brassMat);
  compassRing.position.set(0, 0.48, 0.255);
  scarfGroup.add(compassRing);
  const compassGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), starGlow);
  compassGem.position.set(0, 0.48, 0.258);
  scarfGroup.add(compassGem);
  scarfGroup.visible = false;
  torso.add(scarfGroup);

  // Stage 3: Orbiting star-lantern motes
  const orbitGroup = new THREE.Group();
  orbitGroup.position.set(0, 0.56, 0);
  const orbitMotes: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), i % 2 === 0 ? starGlow : cyanGlow);
    orbitGroup.add(m);
    orbitMotes.push(m);
  }
  orbitGroup.visible = false;
  torso.add(orbitGroup);

  // Stage 4: Rotating Brass & Starlight Armillary Sphere Halo!
  const armillary = new THREE.Group();
  armillary.position.set(0, 0.39, -0.02);
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.011, 12, 48), brassMat);
  outerRing.rotation.x = Math.PI / 2 - 0.18;
  armillary.add(outerRing);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.008, 10, 40), cyanGlow);
  innerRing.rotation.x = Math.PI / 2 + 0.35;
  armillary.add(innerRing);
  const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.015, 12, 24, Math.PI * 1.25), starGlow);
  crescent.position.set(0, 0.055, 0.1);
  crescent.rotation.z = 0.6;
  armillary.add(crescent);
  armillary.visible = false;
  head.add(armillary);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.44, 0);
  head.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 2.4;
  let blinkVal = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage) => {
    curStage = stage;
    root.scale.setScalar([0.88, 0.96, 1.04, 1.12][stage - 1]);
    scarfGroup.visible = stage >= 2;
    orbitGroup.visible = stage >= 3;
    wingStars.forEach((m) => (m.visible = stage >= 3));
    armillary.visible = stage >= 4;
  };
  setEvolution(1);

  return {
    root,
    headAnchor,
    hitMeshes,
    setEvolution,
    update(pose: PetPoseInput) {
      const { time, dt, mood, speaking, petted, attentionPulse } = pose;
      uPulse.value = attentionPulse + petted * 0.5;
      const trick = computeTrick(pose);

      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.3 + ((Math.sin(time * 13.7) + 1) * 1.4);
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.94 : blinkTimer < 0.13 ? 1 : 0, 22, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.ball.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.56 + blinkVal * 0.95;
      }

      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      smoothYaw = damp(smoothYaw, sleeping ? 0 : THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.68, 0.68), 6, dt);
      smoothPitch = damp(smoothPitch, sleeping ? 0.24 : THREE.MathUtils.clamp(-(localLook.y - 0.72) * 0.35, -0.34, 0.3), 6, dt);

      const breathe = Math.sin(time * (sleeping ? 1.8 : 3.0)) * 0.022;
      const walkBob = Math.min(1, pose.speed * 1.5) * Math.abs(Math.sin(time * 11)) * 0.055;
      bodyPivot.position.set(trick.x, trick.y + walkBob, trick.z);
      bodyPivot.rotation.set(trick.pitch, trick.yaw, trick.roll + petted * Math.sin(time * 22) * 0.13);

      const sy = trick.squashY * (1 + breathe + petted * 0.05);
      const sxz = 1 / Math.sqrt(Math.max(0.65, sy));
      torso.scale.set(sxz, sy, sxz);

      head.rotation.set(
        smoothPitch + (speaking > 0.05 ? Math.sin(time * 18) * 0.08 * speaking : 0),
        smoothYaw,
        (mood === "curious" ? 0.24 * Math.sin(time * 1.7) : 0) + petted * Math.sin(time * 18) * 0.1,
      );
      lowerBeak.rotation.x = Math.PI * 0.68 + speaking * (0.25 + 0.22 * Math.sin(time * 26));

      const flap = Math.max(0, Math.sin(time * (trick.boost > 0.1 ? 15 : 4.0))) * (0.07 + trick.boost * 0.65 + petted * 0.32 + pose.speed * 0.22);
      leftWing.rotation.z = -0.06 - flap;
      rightWing.rotation.z = 0.06 + flap;

      if (curStage >= 3) {
        orbitMotes.forEach((m, i) => {
          const a = time * 1.3 + (i * Math.PI * 2) / orbitMotes.length;
          m.position.set(Math.cos(a) * 0.56, Math.sin(a * 1.8 + i) * 0.15, Math.sin(a) * 0.56);
          m.rotation.y = time * 2.2 + i;
        });
      }
      if (curStage >= 4) {
        armillary.rotation.y = time * 0.75;
        innerRing.rotation.z = -time * 1.1;
        armillary.position.y = 0.39 + Math.sin(time * 2.2) * 0.022;
      }
    },
    dispose: () => disposeHierarchy(root),
  };
}

// ============================================================================
// 2. BRAMBLE — Cloud Red Panda Cub (SDF Plush + Fur Shells + Botanical Lantern)
// ============================================================================

let cachedBrambleBodyGeo: THREE.BufferGeometry | null = null;
let cachedBrambleHeadGeo: THREE.BufferGeometry | null = null;

function getBrambleGeometries() {
  if (!cachedBrambleBodyGeo) {
    cachedBrambleBodyGeo = buildSdfGeometry({
      min: [-0.38, -0.01, -0.42],
      max: [0.38, 0.64, 0.42],
      cell: 0.025,
      smoothPasses: 1,
      sdf(x, y, z) {
        const ax = Math.abs(x);
        // Chubby organic red panda torso + haunches
        let d = sdEllipsoid(x, y, z, 0, 0.32, -0.02, 0.26, 0.23, 0.31);
        d = smin(d, sdEllipsoid(x, y, z, 0, 0.36, 0.14, 0.22, 0.2, 0.21), 0.1);
        d = smin(d, sdEllipsoid(x, y, z, 0, 0.28, -0.18, 0.24, 0.2, 0.22), 0.1);
        // Seamless blended limbs resting cleanly at y = 0!
        const frontLeg = sdRoundCone(ax, y, z, 0.16, 0.22, 0.17, 0.155, 0.062, 0.18, 0.088, 0.062);
        const hindLeg = sdRoundCone(ax, y, z, 0.175, 0.21, -0.15, 0.17, 0.062, -0.14, 0.095, 0.064);
        d = smin(d, Math.min(frontLeg, hindLeg), 0.065);
        // Soft fur contour bumps
        const n = sdfNoise3(x * 11 + 2.3, y * 11 + 4.1, z * 11) - 0.5;
        return d - n * 0.014;
      },
      paint(_x, y, _z, _nx, ny) {
        const rust: [number, number, number] = [0.84, 0.33, 0.15];
        const ginger: [number, number, number] = [0.94, 0.5, 0.25];
        const espresso: [number, number, number] = [0.16, 0.1, 0.09];
        // Iconic dark espresso legs & underside belly!
        const darkLegs = smoothstep(0.24, 0.13, y);
        const darkBelly = smoothstep(-0.15, -0.65, ny) * smoothstep(0.32, 0.15, y);
        let col = rgbMix(rust, ginger, smoothstep(0.35, 0.85, ny) * 0.55);
        col = rgbMix(col, espresso, Math.max(darkLegs, darkBelly));
        return [col[0], col[1], col[2], smoothstep(0.2, 0.05, y) * 0.25];
      },
    });
  }

  if (!cachedBrambleHeadGeo) {
    cachedBrambleHeadGeo = buildSdfGeometry({
      min: [-0.36, -0.24, -0.32],
      max: [0.36, 0.36, 0.36],
      cell: 0.022,
      smoothPasses: 1,
      sdf(x, y, z) {
        const ax = Math.abs(x);
        // Wide plush panda skull
        let d = sdEllipsoid(x, y, z, 0, 0.02, 0.0, 0.26, 0.215, 0.235);
        // Fluffy white cheek ruffs & cute protruding muzzle!
        d = smin(d, sdEllipsoid(ax, y, z, 0.15, -0.055, 0.12, 0.125, 0.095, 0.115), 0.055);
        d = smin(d, sdEllipsoid(x, y, z, 0, -0.06, 0.21, 0.105, 0.075, 0.105), 0.05);
        // Carved eye sockets
        const sock = sdSphere(ax, y, z, 0.102, 0.022, 0.225, 0.058);
        d = smax(d, -sock, 0.02);
        // Rounded plush ears with carved hollows (high backlit SSS!)
        const ear = sdEllipsoid(ax, y, z, 0.195, 0.195, 0.0, 0.092, 0.102, 0.052);
        const earHollow = sdEllipsoid(ax, y, z, 0.195, 0.19, 0.042, 0.056, 0.065, 0.036);
        d = smin(d, smax(ear, -earHollow, 0.018), 0.038);
        const n = sdfNoise3(x * 13 + 9, y * 13 + 3, z * 13) - 0.5;
        return d - n * 0.01;
      },
      paint(x, y, z) {
        const ax = Math.abs(x);
        const rust: [number, number, number] = [0.85, 0.34, 0.16];
        const cream: [number, number, number] = [0.98, 0.94, 0.87];
        const dark: [number, number, number] = [0.22, 0.13, 0.11];
        const blush: [number, number, number] = [0.98, 0.54, 0.6];

        // Cream muzzle, fluffy cheek patches, white ear rims, and iconic cream eyebrows!
        const muzzle = smoothstep(0.14, 0.08, Math.hypot(x * 0.9, (y + 0.065) * 1.1, (z - 0.22) * 0.85));
        const cheek = smoothstep(0.125, 0.07, Math.hypot((ax - 0.165) * 0.9, (y + 0.06) * 1.2, (z - 0.14) * 0.9));
        const brow = smoothstep(0.058, 0.028, Math.hypot((ax - 0.095) * 1.1, (y - 0.105) * 1.35, (z - 0.19) * 1.1));
        const earRim = smoothstep(0.12, 0.18, y) * smoothstep(0.11, 0.17, ax);
        const earIn = smoothstep(0.065, 0.03, Math.hypot(ax - 0.195, y - 0.19, z - 0.02));
        // Classic red-panda teardrop cheek stripe
        const stripe = smoothstep(0.055, 0.022, Math.hypot((ax - 0.115) * 1.5, (y + 0.04) * 0.8, (z - 0.195) * 1.2));

        let col = rgbMix(rust, cream, Math.max(muzzle, cheek, brow, earRim * 0.9));
        col = rgbMix(col, dark, Math.max(earIn * 0.85, stripe * 0.65));
        const blushD = Math.hypot((ax - 0.16) * 1.1, (y + 0.035) * 1.5, (z - 0.195) * 1.2);
        col = rgbMix(col, blush, smoothstep(0.075, 0.025, blushD) * 0.45);
        return [col[0], col[1], col[2], Math.max(earRim * 0.92, cheek * 0.25)];
      },
    });
  }

  return { bodyGeo: cachedBrambleBodyGeo, headGeo: cachedBrambleHeadGeo };
}

function buildBrambleRig(): PetModelRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const hitMeshes: THREE.Object3D[] = [];
  const uPulse = uniform(0.2);

  const { bodyGeo, headGeo } = getBrambleGeometries();
  const furMat = makePlushSssMaterial({
    sssColor: 0xff8c5a,
    sssStrength: 0.85,
    roughness: 0.85,
    sheen: 0.8,
    grainScale: 40,
    pulseUniform: uPulse,
  });
  const brassMat = makeArtisanMetalMaterial(0xdeb862, 0.26);
  const scarfMat = makeSilkFabricMaterial(0x286e54, 0x8ef5c8);
  const leafGlow = makeHdrGlowMaterial(0x64f2a6, 1.4, uPulse);
  const lanternGlow = makeHdrGlowMaterial(0xffd275, 2.0, uPulse);

  const torso = new THREE.Group();
  bodyPivot.add(torso);
  const bodyMesh = new THREE.Mesh(bodyGeo, furMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  torso.add(bodyMesh);
  hitMeshes.push(bodyMesh);
  addFurShells(torso, bodyGeo, { layers: 5, length: 0.022, density: 58, sssColor: 0xff9f6b, groom: [0, -0.5, -0.35] });

  // Lush articulated ringed tail (with volumetric fur shell plumes!)
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.28, -0.28);
  torso.add(tailPivot);
  const rustTailMat = makePlushSssMaterial({ baseColor: 0xd9582b, useSdfAttrs: false, sssColor: 0xff9c66, sssStrength: 0.8 });
  const creamTailMat = makePlushSssMaterial({ baseColor: 0xf7e7cf, useSdfAttrs: false, sssColor: 0xffcca0, sssStrength: 0.8 });
  const tailSegs: THREE.Group[] = [];
  let tp: THREE.Object3D = tailPivot;
  for (let i = 0; i < 6; i++) {
    const sg = new THREE.Group();
    sg.position.set(0, i === 0 ? 0.01 : 0.032, i === 0 ? -0.05 : -0.115);
    const r = 0.115 - Math.abs(i - 2.3) * 0.014;
    const g = new THREE.SphereGeometry(r, 20, 16);
    g.scale(0.95, 0.92, 1.2);
    const puff = new THREE.Mesh(g, i % 2 === 0 ? rustTailMat : creamTailMat);
    puff.castShadow = true;
    sg.add(puff);
    addFurShells(sg, g, { layers: 3, length: 0.022, density: 48, tint: i % 2 === 0 ? 0xd9582b : 0xf7e7cf, sssColor: 0xffb382 });
    hitMeshes.push(puff);
    tp.add(sg);
    tailSegs.push(sg);
    tp = sg;
  }

  // Articulated SDF Head + Volumetric Fur Shells
  const head = new THREE.Group();
  head.position.set(0, 0.57, 0.14);
  torso.add(head);

  const headMesh = new THREE.Mesh(headGeo, furMat);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);
  hitMeshes.push(headMesh);
  addFurShells(head, headGeo, { layers: 5, length: 0.018, density: 64, sssColor: 0xffb88c, groom: [0, -0.35, -0.4] });

  // Wet button nose + glossy dark amber eyes
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 16, 12),
    new THREE.MeshPhysicalMaterial({ color: 0x1a1212, roughness: 0.14, clearcoat: 0.9 }),
  );
  nose.scale.set(1.22, 0.85, 0.85);
  nose.position.set(0, -0.038, 0.302);
  head.add(nose);

  const leftEye = makeStudioEye(0.054, 0x3b2218, 0xffaa64, 0xd85a2e, 0.48);
  leftEye.group.position.set(-0.098, 0.022, 0.2);
  leftEye.group.rotation.y = -0.22;
  head.add(leftEye.group);

  const rightEye = makeStudioEye(0.054, 0x3b2218, 0xffaa64, 0xd85a2e, 0.48);
  rightEye.group.position.set(0.098, 0.022, 0.2);
  rightEye.group.rotation.y = 0.22;
  head.add(rightEye.group);

  // ---- Artisanal Evolution Adornments (Stages 1 → 4) ----
  // Stage 2: Botanical sprout + glowing miniature acorn-lantern on woven emerald neckerchief!
  const sproutGroup = new THREE.Group();
  sproutGroup.position.set(0, 0.225, 0.04);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.013, 0.07, 8), scarfMat);
  stem.position.y = 0.03;
  sproutGroup.add(stem);
  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 12), leafGlow);
    leaf.scale.set(0.5, 1.45, 0.24);
    leaf.position.set(side * 0.044, 0.075, 0);
    leaf.rotation.z = -side * 0.62;
    sproutGroup.add(leaf);
  }
  sproutGroup.visible = false;
  head.add(sproutGroup);

  const scarfGroup = new THREE.Group();
  const bandana = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.036, 14, 34), scarfMat);
  bandana.rotation.x = Math.PI / 2 + 0.16;
  bandana.position.set(0, 0.43, 0.12);
  bandana.castShadow = true;
  scarfGroup.add(bandana);
  // Hanging tiny brass-capped acorn lantern!
  const acornCap = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), brassMat);
  acornCap.position.set(0, 0.38, 0.34);
  scarfGroup.add(acornCap);
  const acornGlow = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 12), lanternGlow);
  acornGlow.scale.set(0.95, 1.25, 0.95);
  acornGlow.position.set(0, 0.355, 0.34);
  scarfGroup.add(acornGlow);
  scarfGroup.visible = false;
  torso.add(scarfGroup);

  // Stage 3: Orbiting forest firefly blossom petals
  const blossomGroup = new THREE.Group();
  blossomGroup.position.set(0, 0.45, 0);
  const petals: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), i % 2 === 0 ? leafGlow : lanternGlow);
    blossomGroup.add(p);
    petals.push(p);
  }
  blossomGroup.visible = false;
  torso.add(blossomGroup);

  // Stage 4: Glowing Emerald Aurora Botanical Wreath Crown!
  const wreathGroup = new THREE.Group();
  wreathGroup.position.set(0, 0.32, 0);
  const vineRing = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.015, 12, 40), brassMat);
  vineRing.rotation.x = Math.PI / 2 - 0.12;
  wreathGroup.add(vineRing);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.034, 0), i % 2 === 0 ? leafGlow : lanternGlow);
    gem.position.set(Math.cos(a) * 0.21, 0.02, Math.sin(a) * 0.21);
    wreathGroup.add(gem);
  }
  wreathGroup.visible = false;
  head.add(wreathGroup);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.42, 0);
  head.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 2.0;
  let blinkVal = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage) => {
    curStage = stage;
    root.scale.setScalar([0.87, 0.95, 1.04, 1.12][stage - 1]);
    sproutGroup.visible = stage >= 2;
    scarfGroup.visible = stage >= 2;
    blossomGroup.visible = stage >= 3;
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
      uPulse.value = attentionPulse + petted * 0.5;
      const trick = computeTrick(pose);

      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.1 + ((Math.cos(time * 11.3) + 1) * 1.3);
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.94 : blinkTimer < 0.13 ? 1 : 0, 22, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.ball.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.56 + blinkVal * 0.95;
      }

      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      smoothYaw = damp(smoothYaw, sleeping ? 0 : THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.62, 0.62), 6, dt);
      smoothPitch = damp(smoothPitch, sleeping ? 0.25 : THREE.MathUtils.clamp(-(localLook.y - 0.68) * 0.35, -0.32, 0.3), 6, dt);

      const breathe = Math.sin(time * (sleeping ? 1.9 : 3.3)) * 0.024;
      const walkBob = Math.min(1, pose.speed * 1.5) * Math.abs(Math.sin(time * 12)) * 0.055;
      bodyPivot.position.set(trick.x, trick.y + walkBob, trick.z);
      bodyPivot.rotation.set(trick.pitch, trick.yaw, trick.roll + petted * Math.sin(time * 20) * 0.12);

      const sy = trick.squashY * (1 + breathe + petted * 0.05);
      const sxz = 1 / Math.sqrt(Math.max(0.65, sy));
      torso.scale.set(sxz, sy, sxz);

      head.rotation.set(
        smoothPitch + (speaking > 0.05 ? Math.sin(time * 19) * 0.09 * speaking : 0),
        smoothYaw,
        (mood === "curious" ? 0.24 : 0) + petted * Math.sin(time * 18) * 0.1,
      );

      const wagSpd = mood === "playful" || petted > 0.1 ? 7.2 : 2.6;
      const wagAmp = mood === "playful" || petted > 0.1 ? 0.26 : 0.12;
      tailSegs.forEach((seg, i) => {
        seg.rotation.y = Math.sin(time * wagSpd - i * 0.45) * wagAmp;
        seg.rotation.x = 0.06 + Math.cos(time * wagSpd * 0.5 - i * 0.3) * 0.05;
      });

      if (curStage >= 3) {
        petals.forEach((p, i) => {
          const a = time * 1.35 + (i * Math.PI * 2) / petals.length;
          p.position.set(Math.cos(a) * 0.55, Math.sin(a * 2 + i) * 0.14, Math.sin(a) * 0.55);
          p.rotation.y = time * 2.5 + i;
        });
      }
      if (curStage >= 4) {
        wreathGroup.rotation.y = time * 0.85;
      }
    },
    dispose: () => disposeHierarchy(root),
  };
}

// ============================================================================
// 3. LUMA — Abyssal Starlight Dumbo (SDF Backlit SSS Bell + Nebula Core)
// ============================================================================

let cachedLumaBellGeo: THREE.BufferGeometry | null = null;

function getLumaBellGeo(): THREE.BufferGeometry {
  if (!cachedLumaBellGeo) {
    cachedLumaBellGeo = buildSdfGeometry({
      min: [-0.46, -0.34, -0.38],
      max: [0.46, 0.38, 0.38],
      cell: 0.022,
      smoothPasses: 1,
      sdf(x, y, z) {
        const ax = Math.abs(x);
        // Sculpted dome bell with graceful flared fluted skirt!
        let d = sdEllipsoid(x, y, z, 0, 0.04, 0, 0.3, 0.275, 0.295);
        // Subtle 6-fold jellyfish umbrella scallop along lower rim!
        const ang = Math.atan2(z, x);
        const rimWave = Math.sin(ang * 6) * 0.026;
        const skirt = sdEllipsoid(x, y, z, 0, -0.14 + rimWave * 0.5, 0, 0.33 + rimWave, 0.1, 0.33 + rimWave);
        d = smin(d, skirt, 0.08);
        // Carve soft concave underside so the translucent bell glows hollow!
        const hollow = sdEllipsoid(x, y, z, 0, -0.26, 0, 0.24, 0.16, 0.24);
        d = smax(d, -hollow, 0.04);
        // Cute rounded cheek puffs
        d = smin(d, sdEllipsoid(ax, y, z, 0.16, -0.06, 0.2, 0.09, 0.065, 0.08), 0.045);
        return d;
      },
      paint(x, y, z) {
        const ax = Math.abs(x);
        const cobalt: [number, number, number] = [0.36, 0.56, 0.98];
        const orchid: [number, number, number] = [0.68, 0.52, 0.98];
        const aqua: [number, number, number] = [0.44, 0.94, 0.92];
        const blush: [number, number, number] = [1.0, 0.58, 0.84];

        const skirtT = smoothstep(0.05, -0.18, y);
        const crownT = smoothstep(0.05, 0.28, y);
        let col = rgbMix(cobalt, aqua, skirtT);
        col = rgbMix(col, orchid, crownT * 0.65);

        // Bioluminescent cheek glow
        const bD = Math.hypot((ax - 0.17) * 1.1, (y + 0.07) * 1.4, (z - 0.22) * 1.2);
        col = rgbMix(col, blush, smoothstep(0.085, 0.025, bD) * 0.72);
        return [col[0], col[1], col[2], Math.max(0.55, skirtT * 0.95)];
      },
    });
  }
  return cachedLumaBellGeo;
}

function buildLumaRig(): PetModelRig {
  const root = new THREE.Group();
  const floatPivot = new THREE.Group();
  root.add(floatPivot);
  const hitMeshes: THREE.Object3D[] = [];
  const uPulse = uniform(0.3);

  const bellMat = makeBioSssMaterial({
    sssColor: 0x52f2e8,
    iridColor: 0xd09cff,
    sssStrength: 1.35,
    clearcoat: 0.95,
    roughness: 0.12,
    opacity: 0.84,
    pulseUniform: uPulse,
  });
  const finMat = makeBioSssMaterial({
    baseColor: 0x9c8aff,
    useSdfAttrs: false,
    sssColor: 0x70f5ea,
    iridColor: 0xff9ad8,
    sssStrength: 1.2,
    clearcoat: 0.85,
    opacity: 0.86,
    pulseUniform: uPulse,
  });
  const coreGlow = makeHdrGlowMaterial(0xa8f0ff, 2.2, uPulse);
  const starGlow = makeHdrGlowMaterial(0xffe896, 1.9, uPulse);
  const brassMat = makeArtisanMetalMaterial(0xeac878, 0.2);

  const body = new THREE.Group();
  body.position.set(0, 0.6, 0);
  floatPivot.add(body);

  // Translucent SDF-sculpted jelly dome!
  const bellGeo = getLumaBellGeo();
  const bell = new THREE.Mesh(bellGeo, bellMat);
  bell.castShadow = true;
  body.add(bell);
  hitMeshes.push(bell);

  // Visible luminous constellation star-heart floating inside the translucent bell!
  const coreGroup = new THREE.Group();
  coreGroup.position.set(0, 0.04, -0.02);
  const coreCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 1), coreGlow);
  coreGroup.add(coreCrystal);
  const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.009, 10, 32), starGlow);
  coreRing.rotation.x = Math.PI / 3;
  coreGroup.add(coreRing);
  body.add(coreGroup);

  // Sculpted graceful flapping Dumbo ear-fins!
  const leftFin = new THREE.Group();
  leftFin.position.set(-0.26, 0.09, -0.01);
  const rightFin = new THREE.Group();
  rightFin.position.set(0.26, 0.09, -0.01);
  for (const [fg, side] of [
    [leftFin, -1],
    [rightFin, 1],
  ] as [THREE.Group, number][]) {
    const fMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 22, 16), finMat);
    fMesh.scale.set(1.45, 0.42, 0.78);
    fMesh.position.set(side * 0.11, 0.015, 0);
    fg.add(fMesh);
    hitMeshes.push(fMesh);
    body.add(fg);
  }

  // Deep Starry Jewel Eyes
  const leftEye = makeStudioEye(0.062, 0x1e3c8c, 0x9cf0ff, 0x6f98f5, 0.5);
  leftEye.group.position.set(-0.115, -0.02, 0.255);
  leftEye.group.rotation.y = -0.22;
  body.add(leftEye.group);

  const rightEye = makeStudioEye(0.062, 0x1e3c8c, 0x9cf0ff, 0x6f98f5, 0.5);
  rightEye.group.position.set(0.115, -0.02, 0.255);
  rightEye.group.rotation.y = 0.22;
  body.add(rightEye.group);

  // 6 gracefully tapering undulating bioluminescent tentacles with glowing pearl tips!
  const tentacles: THREE.Group[][] = [];
  for (let t = 0; t < 6; t++) {
    const ang = (t * Math.PI * 2) / 6 + Math.PI / 6;
    const baseG = new THREE.Group();
    baseG.position.set(Math.cos(ang) * 0.18, -0.2, Math.sin(ang) * 0.18);
    body.add(baseG);
    const segs: THREE.Group[] = [];
    let parent: THREE.Object3D = baseG;
    for (let s = 0; s < 5; s++) {
      const seg = new THREE.Group();
      seg.position.set(0, s === 0 ? -0.035 : -0.075, 0);
      const r = 0.036 * (1 - s * 0.17);
      const bead = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.052, 8, 12), s === 4 ? coreGlow : finMat);
      seg.add(bead);
      parent.add(seg);
      segs.push(seg);
      parent = seg;
    }
    tentacles.push(segs);
  }

  // ---- Artisanal Evolution Adornments (Stages 1 → 4) ----
  // Stage 2: Filigree golden equatorial starlight belt
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.011, 10, 48), brassMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.set(0, -0.06, 0);
  belt.visible = false;
  body.add(belt);

  // Stage 3: Orbiting bioluminescent pearl lanterns
  const pearlGroup = new THREE.Group();
  const pearls: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), i % 2 === 0 ? starGlow : coreGlow);
    pearlGroup.add(p);
    pearls.push(p);
  }
  pearlGroup.visible = false;
  body.add(pearlGroup);

  // Stage 4: Twin intersecting golden deep-sky astrolabe halo!
  const astroGroup = new THREE.Group();
  astroGroup.position.set(0, 0.34, 0);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.012, 12, 48), brassMat);
  ringA.rotation.x = Math.PI / 2 - 0.22;
  astroGroup.add(ringA);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.009, 10, 40), coreGlow);
  ringB.rotation.x = Math.PI / 2 + 0.35;
  astroGroup.add(ringB);
  astroGroup.visible = false;
  body.add(astroGroup);

  const headAnchor = new THREE.Object3D();
  headAnchor.position.set(0, 0.44, 0);
  body.add(headAnchor);

  let curStage: EvolutionStage = 1;
  let blinkTimer = 2.5;
  let blinkVal = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  const localLook = new THREE.Vector3();

  const setEvolution = (stage: EvolutionStage) => {
    curStage = stage;
    root.scale.setScalar([0.88, 0.96, 1.04, 1.12][stage - 1]);
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
      uPulse.value = attentionPulse + petted * 0.6;
      const trick = computeTrick(pose);

      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkTimer = 2.4 + ((Math.sin(time * 9.1) + 1) * 1.4);
      const sleeping = mood === "dreaming" || mood === "sleepy";
      const happySquint = petted > 0.12 || mood === "proud";
      blinkVal = damp(blinkVal, sleeping ? 0.94 : blinkTimer < 0.13 ? 1 : 0, 20, dt);

      for (const eye of [leftEye, rightEye]) {
        eye.squint.visible = happySquint && !sleeping;
        eye.ball.visible = !eye.squint.visible;
        eye.lid.rotation.x = -Math.PI * 0.56 + blinkVal * 0.95;
      }

      localLook.copy(pose.lookTarget);
      root.worldToLocal(localLook);
      smoothYaw = damp(smoothYaw, sleeping ? 0 : THREE.MathUtils.clamp(Math.atan2(localLook.x, Math.max(0.4, localLook.z)), -0.7, 0.7), 5, dt);
      smoothPitch = damp(smoothPitch, sleeping ? 0.18 : THREE.MathUtils.clamp(-(localLook.y - 0.68) * 0.3, -0.25, 0.25), 5, dt);

      const pulse = Math.sin(time * (sleeping ? 1.5 : 2.8));
      const hoverY = (sleeping ? -0.05 : 0.06 * pulse) + trick.y;
      floatPivot.position.set(trick.x, hoverY, trick.z);
      floatPivot.rotation.set(
        trick.pitch + smoothPitch * 0.6,
        trick.yaw + smoothYaw * 0.7,
        trick.roll + (mood === "curious" ? 0.18 : 0) + petted * Math.sin(time * 18) * 0.14,
      );

      const sy = trick.squashY * (1 + pulse * 0.055 + speaking * Math.sin(time * 20) * 0.05);
      const sxz = 1 / Math.sqrt(Math.max(0.65, sy));
      bell.scale.set(sxz, sy, sxz);

      const finWave = Math.sin(time * (trick.boost > 0.1 ? 12 : 4.2)) * (0.28 + trick.boost * 0.45 + petted * 0.3);
      leftFin.rotation.z = 0.14 + finWave;
      rightFin.rotation.z = -0.14 - finWave;

      tentacles.forEach((segs, tIdx) => {
        segs.forEach((seg, sIdx) => {
          seg.rotation.x = Math.sin(time * 3.1 - sIdx * 0.65 + tIdx * 0.8) * (0.14 + sIdx * 0.045);
          seg.rotation.z = Math.cos(time * 2.4 - sIdx * 0.55 + tIdx * 1.1) * (0.12 + sIdx * 0.04);
        });
      });

      coreGroup.rotation.y = time * 1.1;
      coreRing.rotation.z = -time * 1.4;
      coreCrystal.scale.setScalar(1 + attentionPulse * 0.25 + speaking * 0.15);

      if (curStage >= 3) {
        pearls.forEach((p, i) => {
          const a = time * 1.2 + (i * Math.PI * 2) / pearls.length;
          p.position.set(Math.cos(a) * 0.52, Math.sin(a * 2 + i) * 0.14, Math.sin(a) * 0.52);
          p.rotation.y = time * 2.2;
        });
      }
      if (curStage >= 4) {
        astroGroup.rotation.y = time * 0.75;
        ringB.rotation.z = -time * 1.15;
      }
    },
    dispose: () => disposeHierarchy(root),
  };
}

export const GEMINI_SPECIES: SpeciesDefinition[] = [
  {
    id: "pip",
    name: "Pip",
    species: "Barn Owlet",
    author: "Gemini 4 Neon",
    accentHex: "#ffcb77",
    tagline: "Plush starry owlet with layered feather shells and an astronomer's brass armillary.",
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
    tagline: "Velvety red panda cub wearing a glowing acorn-lantern and botanical aurora wreath.",
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
    tagline: "Translucent backlit sea-sky sprite with a pulsing inner constellation core.",
    personalitySeed:
      "user: who are you\npet: bloop! i am luma, a drifting starlight sprite whose heart pulses with your GPU.\nuser: dream\npet: floating softly through ripples of light while dreaming wiser weights.\n",
    favoriteWords: ["bloop", "ripple", "shimmer", "nebula", "glow"],
    voicePitch: 783.99,
    buildRig: buildLumaRig,
  },
];
