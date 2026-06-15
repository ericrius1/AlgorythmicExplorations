import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { createStage3D } from "../../lib/stage3d";
import { SolarPunkAudio, type PulseGrade } from "./solarPunkAudio";

const TAU = Math.PI * 2;
const LOOP_SECONDS = 12;
const GAME_SECONDS = 42;

interface Petal {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  phase: number;
  baseTilt: number;
  amplitude: number;
}

interface Resonator {
  group: THREE.Group;
  core: THREE.Mesh;
  coreMaterial: THREE.MeshStandardMaterial;
  ringA: THREE.Mesh;
  ringB: THREE.Mesh;
  phase: number;
}

interface PulseRing {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  life: number;
}

type GameMode = "playing" | "paused" | "won" | "failed";

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing solar-punk UI element: ${selector}`);
  return element;
}

function makeLeafGeometry(length = 1.5, width = 0.42): THREE.BufferGeometry {
  const rows = [
    { y: 0, w: 0.025, z: 0 },
    { y: 0.18, w: 0.58, z: 0.02 },
    { y: 0.48, w: 1, z: 0.07 },
    { y: 0.78, w: 0.72, z: 0.045 },
    { y: 1, w: 0, z: 0 },
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const dark = new THREE.Color(0x063d38);
  const light = new THREE.Color(0x39e0aa);
  const c = new THREE.Color();

  for (const row of rows) {
    for (const side of [-1, 1]) {
      positions.push(side * row.w * width, row.y * length, row.z);
      c.copy(dark).lerp(light, row.y * 0.82);
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let row = 0; row < rows.length - 1; row++) {
    const a = row * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeHelix(radius: number, turns: number, y0: number, y1: number, offset: number): THREE.TubeGeometry {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 180; i++) {
    const t = i / 180;
    const a = t * TAU * turns + offset;
    const r = radius * (0.86 + 0.14 * Math.sin(t * TAU * 3));
    points.push(new THREE.Vector3(Math.cos(a) * r, y0 + (y1 - y0) * t, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 240, 0.045, 8, false);
}

function addCylinderBetween(
  parent: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): void {
  const delta = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.12, delta.length(), 7), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  parent.add(mesh);
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function makeResonator(
  index: number,
  y: number,
  scale: number,
  brass: THREE.Material,
  darkMetal: THREE.Material,
): Resonator {
  const group = new THREE.Group();
  group.position.y = y;
  group.scale.setScalar(scale);

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: index === 1 ? 0x70ffe0 : 0xffd877,
    emissive: index === 1 ? 0x0b8f72 : 0x9a5e09,
    emissiveIntensity: 1.2,
    metalness: 0.28,
    roughness: 0.18,
  });
  const coreGeometry =
    index === 0 ? new THREE.OctahedronGeometry(0.25, 1) :
    index === 1 ? new THREE.DodecahedronGeometry(0.23, 0) :
    new THREE.IcosahedronGeometry(0.24, 1);
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  group.add(core);

  const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.026, 6, 48), brass);
  ringA.rotation.x = 0.72 + index * 0.28;
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.018, 6, 48), darkMetal);
  ringB.rotation.y = 0.82 + index * 0.23;
  group.add(ringA, ringB);

  for (let i = 0; i < 4 + index; i++) {
    const a = (i / (4 + index)) * TAU;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.23, 4), brass);
    fin.position.set(Math.cos(a) * 0.34, Math.sin(a * 2) * 0.08, Math.sin(a) * 0.34);
    fin.rotation.z = a - Math.PI / 2;
    group.add(fin);
  }
  return { group, core, coreMaterial, ringA, ringB, phase: index * 2.1 };
}

export async function mountSolarPunk(container: HTMLElement): Promise<Demo> {
  const aspect = Math.max(0.5, Math.min(1.15, window.innerHeight / Math.max(window.innerWidth, 1)));
  const shell = new Shell(container, aspect);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.003, 0.018, 0.019],
    skyBottom: [0.018, 0.105, 0.083],
    fog: { color: 0x052a25, near: 10, far: 29 },
    hemi: { sky: 0xcaffed, ground: 0x13251b, intensity: 1.45 },
    key: { color: 0xffe4a5, intensity: 4.2, position: [4, 7, 5] },
    rim: { color: 0x4affd2, intensity: 2.6, position: [-5, 3, -4] },
    target: [0, 2.55, 0],
    distance: 8.35,
    minDistance: 4.8,
    maxDistance: 13,
    elevation: 0.13,
    azimuth: 0.65,
    fov: 41,
    far: 70,
  });
  stage.orbit.autoSpin = 0;
  stage.renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.renderer.toneMappingExposure = 1.14;

  const brass = new THREE.MeshPhysicalMaterial({
    color: 0xbe7a27,
    emissive: 0x2a1002,
    metalness: 0.9,
    roughness: 0.22,
    clearcoat: 0.58,
    clearcoatRoughness: 0.18,
  });
  const paleBrass = new THREE.MeshPhysicalMaterial({
    color: 0xffd875,
    emissive: 0x5a2b04,
    emissiveIntensity: 0.75,
    metalness: 0.84,
    roughness: 0.2,
    clearcoat: 0.72,
    clearcoatRoughness: 0.15,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x102f2b,
    emissive: 0x02110e,
    metalness: 0.78,
    roughness: 0.36,
  });
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: 0xd4e5d9,
    emissive: 0x0e251d,
    metalness: 0.08,
    roughness: 0.38,
    clearcoat: 0.72,
    clearcoatRoughness: 0.3,
  });
  const panel = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    emissive: 0x06483c,
    emissiveIntensity: 0.75,
    metalness: 0.56,
    roughness: 0.2,
    clearcoat: 0.86,
    clearcoatRoughness: 0.17,
    side: THREE.DoubleSide,
  });
  const moss = new THREE.MeshStandardMaterial({
    color: 0x357447,
    emissive: 0x071c0b,
    roughness: 0.94,
  });
  const glow = new THREE.MeshBasicMaterial({ color: 0x83ffd7 });
  const warmGlow = new THREE.MeshBasicMaterial({ color: 0xffdc78 });
  const softGlow = new THREE.MeshBasicMaterial({
    color: 0x69ffcf,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  const world = new THREE.Group();
  stage.scene.add(world);

  // Environment layers: a terraced garden, near pylons, midground arches, and far motes.
  const outerTerrace = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.68, 0.28, 16), darkMetal);
  outerTerrace.position.y = -0.11;
  world.add(outerTerrace);
  const terraceTrim = new THREE.Mesh(new THREE.TorusGeometry(3.29, 0.035, 7, 128), paleBrass);
  terraceTrim.rotation.x = Math.PI / 2;
  terraceTrim.position.y = 0.04;
  world.add(terraceTrim);
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(2.15, 64),
    new THREE.MeshBasicMaterial({ color: 0x00120e, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.045;
  world.add(contact);

  const pylonCount = 18;
  const pylonGeometry = new THREE.CylinderGeometry(0.075, 0.14, 0.72, 6);
  const pylonInstances = new THREE.InstancedMesh(pylonGeometry, darkMetal, pylonCount);
  const lampInstances = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.095, 0), warmGlow, pylonCount);
  const staticMatrix = new THREE.Matrix4();
  const staticQuaternion = new THREE.Quaternion();
  const staticScale = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < pylonCount; i++) {
    const a = (i / pylonCount) * TAU;
    const radius = 3.12 + 0.13 * Math.sin(i * 2.7);
    const height = 0.48 + 0.18 * hash(i + 90);
    staticMatrix.compose(new THREE.Vector3(Math.cos(a) * radius, height * 0.5, Math.sin(a) * radius), staticQuaternion, new THREE.Vector3(1, height / 0.72, 1));
    pylonInstances.setMatrixAt(i, staticMatrix);
    staticMatrix.compose(new THREE.Vector3(Math.cos(a) * radius, height + 0.08, Math.sin(a) * radius), staticQuaternion, staticScale);
    lampInstances.setMatrixAt(i, staticMatrix);
  }
  pylonInstances.instanceMatrix.needsUpdate = true;
  lampInstances.instanceMatrix.needsUpdate = true;
  world.add(pylonInstances, lampInstances);

  for (let i = 0; i < 3; i++) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(3.7 + i * 0.44, 0.024, 6, 100, Math.PI * 1.12), softGlow);
    arch.position.set(0, 2.2 + i * 0.42, -2.6 - i * 0.55);
    arch.rotation.z = Math.PI * 0.94;
    arch.rotation.y = (i - 1) * 0.16;
    stage.scene.add(arch);
  }

  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.55, 0.42, 12, 1), darkMetal);
  base.position.y = 0.21;
  world.add(base);
  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.055, 8, 96), paleBrass);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.43;
  world.add(baseRing);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.26, 0.035, 7, 72), glow);
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.49;
  world.add(innerRing);
  const baseCore = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 0.3, 8), ceramic);
  baseCore.position.y = 0.55;
  world.add(baseCore);

  const leafGeometry = makeLeafGeometry();
  const gardenPetals: Petal[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 1.05, 0.47, Math.sin(a) * 1.05);
    pivot.rotation.y = -a + Math.PI / 2;
    const leaf = new THREE.Mesh(leafGeometry, i % 3 === 0 ? panel : moss);
    leaf.scale.setScalar(0.82 + (i % 4) * 0.05);
    leaf.rotation.x = 1.37;
    pivot.add(leaf);
    world.add(pivot);
    gardenPetals.push({ pivot, mesh: leaf, phase: a, baseTilt: 1.37, amplitude: 0.07 });
  }

  const stems = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    stems.add(new THREE.Mesh(makeHelix(0.45, 2.55, 0.48, 4.8, (i / 3) * TAU), i === 1 ? paleBrass : brass));
  }
  world.add(stems);

  const resonators = [
    makeResonator(0, 1.55, 0.8, paleBrass, darkMetal),
    makeResonator(1, 2.75, 0.92, brass, darkMetal),
    makeResonator(2, 4.05, 1.02, paleBrass, darkMetal),
  ];
  for (const resonator of resonators) world.add(resonator.group);

  const crown = new THREE.Group();
  crown.position.y = 3.05;
  world.add(crown);

  const knotA = new THREE.Mesh(new THREE.TorusKnotGeometry(0.82, 0.075, 160, 9, 2, 3), brass);
  knotA.rotation.x = 0.9;
  crown.add(knotA);
  const knotB = new THREE.Mesh(new THREE.TorusKnotGeometry(1.08, 0.035, 180, 7, 3, 5), glow);
  knotB.rotation.x = -0.5;
  crown.add(knotB);

  const core = new THREE.Group();
  core.position.y = 0.08;
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 3), warmGlow);
  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 1),
    new THREE.MeshBasicMaterial({ color: 0xffd26a, wireframe: true, transparent: true, opacity: 0.72 }),
  );
  core.add(orb, cage);
  crown.add(core);

  const crownPetals: Petal[] = [];
  for (let ring = 0; ring < 3; ring++) {
    const count = 10 + ring * 3;
    const radius = 0.48 + ring * 0.3;
    const y = -0.12 + ring * 0.2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + ring * 0.43;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
      pivot.rotation.y = -a + Math.PI / 2;
      const leaf = new THREE.Mesh(leafGeometry, panel);
      const s = 0.42 + ring * 0.12;
      leaf.scale.set(s, s, s);
      pivot.add(leaf);
      crown.add(pivot);
      crownPetals.push({
        pivot,
        mesh: leaf,
        phase: a + ring * 1.7,
        baseTilt: 0.68 + ring * 0.2,
        amplitude: 0.2 + ring * 0.045,
      });
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    addCylinderBetween(
      crown,
      new THREE.Vector3(Math.cos(a) * 0.2, -0.22, Math.sin(a) * 0.2),
      new THREE.Vector3(Math.cos(a) * 1.25, 0.32, Math.sin(a) * 1.25),
      0.018,
      paleBrass,
    );
  }

  const phaseGateMaterial = new THREE.MeshStandardMaterial({
    color: 0x50ffd0,
    emissive: 0x13a680,
    emissiveIntensity: 1.3,
    metalness: 0.5,
    roughness: 0.22,
  });
  const phaseGate = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.032, 7, 128), phaseGateMaterial);
  phaseGate.position.y = 3.1;
  phaseGate.rotation.x = 0.32;
  world.add(phaseGate);

  const beadCount = 96;
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 10, 8), glow, beadCount);
  beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  world.add(beads);

  const moteCount = 160;
  const motes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.028, 0), warmGlow, moteCount);
  motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stage.scene.add(motes);

  const sails: Petal[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 2.08, 0.58, Math.sin(a) * 2.08);
    pivot.rotation.y = -a + Math.PI / 2;
    const leaf = new THREE.Mesh(leafGeometry, panel);
    leaf.scale.set(1.08, 0.92, 1);
    pivot.add(leaf);
    world.add(pivot);
    sails.push({ pivot, mesh: leaf, phase: a, baseTilt: 0.92, amplitude: 0.2 });
  }

  const greenLight = new THREE.PointLight(0x3effc2, 18, 7, 2);
  greenLight.position.set(0, 3.1, 0);
  stage.scene.add(greenLight);
  const warmLight = new THREE.PointLight(0xffc85c, 15, 6, 2);
  warmLight.position.set(0, 1.1, 0);
  stage.scene.add(warmLight);

  // Event-driven pulse VFX: expanding rings, a vertical energy beam, and pooled shards.
  const pulseRings: PulseRing[] = [];
  for (let i = 0; i < 6; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x7affe1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.026, 6, 72), material);
    mesh.position.y = 3.13;
    mesh.visible = false;
    stage.scene.add(mesh);
    pulseRings.push({ mesh, material, age: 99, life: 0.95 });
  }
  const pulseBeamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffdf7e,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const pulseBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.08, 5.4, 8), pulseBeamMaterial);
  pulseBeam.position.y = 2.75;
  stage.scene.add(pulseBeam);

  const shardCount = 48;
  const shards = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.045, 0), warmGlow, shardCount);
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stage.scene.add(shards);
  const shardPosition = Array.from({ length: shardCount }, () => new THREE.Vector3(0, -100, 0));
  const shardVelocity = Array.from({ length: shardCount }, () => new THREE.Vector3());
  const shardLife = new Float32Array(shardCount);

  const uiRoot = required<HTMLElement>(document, ".solar-punk-stage");
  const chargeFill = required<HTMLElement>(uiRoot, "[data-solar-charge-fill]");
  const chargeText = required<HTMLElement>(uiRoot, "[data-solar-charge]");
  const timerText = required<HTMLElement>(uiRoot, "[data-solar-time]");
  const scoreText = required<HTMLElement>(uiRoot, "[data-solar-score]");
  const streakText = required<HTMLElement>(uiRoot, "[data-solar-streak]");
  const statusText = required<HTMLElement>(uiRoot, "[data-solar-status]");
  const phaseNeedle = required<HTMLElement>(uiRoot, "[data-solar-phase]");
  const pulseButton = required<HTMLButtonElement>(uiRoot, "[data-solar-pulse]");
  const pauseButton = required<HTMLButtonElement>(uiRoot, "[data-solar-pause]");
  const soundButton = required<HTMLButtonElement>(uiRoot, "[data-solar-sound]");
  const restartButton = required<HTMLButtonElement>(uiRoot, "[data-solar-restart]");
  const modal = required<HTMLElement>(uiRoot, "[data-solar-modal]");
  const modalKicker = required<HTMLElement>(uiRoot, "[data-solar-modal-kicker]");
  const modalTitle = required<HTMLElement>(uiRoot, "[data-solar-modal-title]");
  const modalBody = required<HTMLElement>(uiRoot, "[data-solar-modal-body]");
  const modalAction = required<HTMLButtonElement>(uiRoot, "[data-solar-modal-action]");

  const audio = new SolarPunkAudio();
  let elapsed = 0;
  let mode: GameMode = "playing";
  let timeLeft = GAME_SECONDS;
  let charge = 18;
  let streak = 0;
  let score = 0;
  let pulseCount = 0;
  let currentQuality = 0;
  let pulseCooldown = 0;
  let pulseImpulse = 0;
  let cameraImpulse = 0;
  let last = performance.now();
  let status = "Pulse when the phase ring turns gold.";

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const shardEuler = new THREE.Euler();
  const coolColor = new THREE.Color(0x50ffd0);
  const hotColor = new THREE.Color(0xffd66e);

  const spawnPulse = (grade: PulseGrade): void => {
    const ring = pulseRings.find((candidate) => !candidate.mesh.visible) ?? pulseRings[0];
    ring.age = 0;
    ring.mesh.visible = true;
    ring.material.color.setHex(grade === "perfect" ? 0xffe18a : grade === "aligned" ? 0x7affe1 : 0xff7d5e);
    ring.material.opacity = 0.9;
    ring.mesh.scale.setScalar(0.6);
    ring.mesh.rotation.set(grade === "miss" ? 0.9 : 0.2, pulseCount * 0.7, 0);

    const shardPower = grade === "perfect" ? 1.45 : grade === "aligned" ? 0.95 : 0.55;
    for (let i = 0; i < shardCount; i++) {
      const a = hash(i + pulseCount * 53) * TAU;
      const y = hash(i + pulseCount * 97) * 2 - 0.35;
      shardPosition[i].set(0, 3.1, 0);
      shardVelocity[i].set(Math.cos(a) * shardPower, y * shardPower, Math.sin(a) * shardPower);
      shardLife[i] = 0.55 + hash(i + 200) * 0.55;
    }
  };

  const finish = (result: "won" | "failed"): void => {
    mode = result;
    modal.classList.add("is-visible");
    if (result === "won") {
      charge = 100;
      status = "The Heliotrope is awake.";
      modalKicker.textContent = "Harmonic lock achieved";
      modalTitle.textContent = "Garden awake";
      modalBody.textContent = `${score.toLocaleString()} resonance points · ${pulseCount} pulses · best chain x${streak}`;
      void audio.enable().then(() => audio.win());
    } else {
      status = "The daylight current dispersed.";
      modalKicker.textContent = "Cycle lost";
      modalTitle.textContent = "Signal faded";
      modalBody.textContent = "Catch the gold alignment window and rebuild the charge before the cycle ends.";
      void audio.enable().then(() => audio.fail());
    }
    audio.setPaused(true);
  };

  const restart = (): void => {
    elapsed = 0;
    mode = "playing";
    timeLeft = GAME_SECONDS;
    charge = 18;
    streak = 0;
    score = 0;
    pulseCount = 0;
    pulseCooldown = 0;
    pulseImpulse = 0;
    cameraImpulse = 0;
    status = "Pulse when the phase ring turns gold.";
    modal.classList.remove("is-visible");
    audio.setPaused(false);
  };

  const togglePause = (): void => {
    if (mode === "won" || mode === "failed") return;
    mode = mode === "paused" ? "playing" : "paused";
    audio.setPaused(mode === "paused");
    status = mode === "paused" ? "Cycle held." : "Pulse when the phase ring turns gold.";
  };

  const pulse = (): void => {
    if (mode === "won" || mode === "failed") {
      restart();
      return;
    }
    if (mode === "paused" || pulseCooldown > 0) return;

    pulseCooldown = 0.32;
    pulseCount++;
    let grade: PulseGrade;
    if (currentQuality > 0.82) {
      grade = "perfect";
      streak++;
      charge += 29 + Math.min(streak, 5) * 2;
      score += 1800 + streak * 240;
      status = `Perfect phase. Chain x${streak}.`;
    } else if (currentQuality > 0.5) {
      grade = "aligned";
      streak++;
      charge += 17 + Math.min(streak, 4);
      score += 720 + streak * 120;
      status = `Current aligned. Chain x${streak}.`;
    } else {
      grade = "miss";
      streak = 0;
      charge -= 9;
      score = Math.max(0, score - 250);
      status = "Phase scattered. Wait for gold.";
    }
    charge = Math.max(0, Math.min(100, charge));
    pulseImpulse = grade === "perfect" ? 1.25 : grade === "aligned" ? 0.72 : 0.35;
    cameraImpulse = grade === "miss" ? -0.35 : pulseImpulse;
    spawnPulse(grade);
    soundButton.dataset.state = "on";
    soundButton.textContent = "Sound on";
    void audio.enable()
      .then(() => audio.pulse(grade))
      .catch(() => {
        soundButton.dataset.state = "off";
        soundButton.textContent = "Sound";
      });
    if (charge >= 100) finish("won");
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space") {
      event.preventDefault();
      pulse();
    } else if (event.code === "KeyP") {
      togglePause();
    } else if (event.code === "KeyR") {
      restart();
    } else if (event.code === "KeyM") {
      void audio.toggleMuted().then((muted) => {
        soundButton.dataset.state = muted ? "muted" : "on";
        soundButton.textContent = muted ? "Sound off" : "Sound on";
      });
    }
  };
  const onVisibility = (): void => {
    if (document.hidden && mode === "playing") togglePause();
  };

  pulseButton.addEventListener("pointerdown", pulse);
  pauseButton.addEventListener("click", togglePause);
  restartButton.addEventListener("click", restart);
  modalAction.addEventListener("click", restart);
  soundButton.addEventListener("click", () => {
    void audio.toggleMuted().then((muted) => {
      soundButton.dataset.state = muted ? "muted" : "on";
      soundButton.textContent = muted ? "Sound off" : "Sound on";
    });
  });
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibility);

  const resize = (): void => {
    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    stage.renderer.setSize(Math.floor(width * dpr), Math.floor(height * dpr), false);
    stage.camera.aspect = width / height;
    stage.camera.updateProjectionMatrix();
    if (width / height < 0.8) stage.orbit.distance = Math.max(stage.orbit.distance, 10);
  };
  window.addEventListener("resize", resize);
  resize();

  let meshCount = 0;
  let instancedCount = 0;
  const materialSet = new Set<THREE.Material>();
  stage.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshCount++;
      if (object instanceof THREE.InstancedMesh) instancedCount++;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) materialSet.add(material);
    }
  });
  const diagnosticsWindow = window as typeof window & { __THREE_GAME_DIAGNOSTICS__?: unknown };
  diagnosticsWindow.__THREE_GAME_DIAGNOSTICS__ = {
    renderer: stage.renderer.info,
    scene: { meshes: meshCount, instancedMeshes: instancedCount, uniqueMaterials: materialSet.size },
    get state() {
      return { mode, charge, timeLeft, streak, score, pulseCount, currentQuality };
    },
  };

  let diagnosticFrame = 0;
  let previousRenderCalls = 0;
  let previousRenderTriangles = 0;
  const updateHud = (phase: number): void => {
    chargeFill.style.transform = `scaleX(${charge / 100})`;
    chargeText.textContent = `${Math.round(charge).toString().padStart(3, "0")}%`;
    timerText.textContent = timeLeft.toFixed(1).padStart(4, "0");
    scoreText.textContent = Math.round(score).toString().padStart(6, "0");
    streakText.textContent = `chain x${streak}`;
    statusText.textContent = status;
    phaseNeedle.style.transform = `rotate(${phase * 4}rad)`;
    pulseButton.classList.toggle("is-hot", currentQuality > 0.82);
    pulseButton.classList.toggle("is-aligned", currentQuality > 0.5 && currentQuality <= 0.82);
    pauseButton.textContent = mode === "paused" ? "Resume" : "Pause";
    uiRoot.dataset.gameMode = mode;
  };

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const active = mode === "playing";
      if (active) {
        elapsed += dt;
        timeLeft = Math.max(0, timeLeft - dt);
        pulseCooldown = Math.max(0, pulseCooldown - dt);
        if (timeLeft <= 0) finish("failed");
      }
      const phase = ((elapsed % LOOP_SECONDS) / LOOP_SECONDS) * TAU;
      currentQuality = Math.pow((Math.cos(phase * 4) + 1) * 0.5, 1.55);
      const sync = Math.min(1, currentQuality * 1.2);

      pulseImpulse *= Math.exp(-dt * 4.5);
      cameraImpulse *= Math.exp(-dt * 7);
      stage.orbit.distance = Math.max(stage.orbit.minDistance, Math.min(stage.orbit.maxDistance, stage.orbit.distance - cameraImpulse * dt * 0.65));

      stems.rotation.y = phase;
      stems.position.y = Math.sin(phase * 2) * 0.025 + pulseImpulse * 0.035;
      crown.rotation.y = -phase * 2;
      crown.position.y = 3.05 + Math.sin(phase * 2) * 0.08 + pulseImpulse * 0.07;
      knotA.rotation.z = phase * 3;
      knotB.rotation.y = -phase * 2;
      core.rotation.y = phase * 4;
      cage.rotation.x = phase * 2;
      const corePulse = 1 + Math.sin(phase * 4) * 0.08 + pulseImpulse * 0.18;
      orb.scale.setScalar(corePulse);
      greenLight.intensity = 16 + Math.sin(phase * 4) * 4 + pulseImpulse * 10;
      warmLight.intensity = 13 + Math.sin(phase * 2 + 1) * 3 + pulseImpulse * 7;
      baseRing.rotation.z = phase;
      innerRing.rotation.z = -phase * 2;
      pulseBeamMaterial.opacity = Math.min(0.62, pulseImpulse * 0.42);
      pulseBeam.scale.x = pulseBeam.scale.z = 0.7 + pulseImpulse * 1.8;

      phaseGate.rotation.y = phase * 4;
      phaseGate.rotation.z = Math.sin(phase * 2) * 0.35;
      phaseGateMaterial.color.copy(coolColor).lerp(hotColor, sync);
      phaseGateMaterial.emissive.copy(coolColor).lerp(hotColor, sync);
      phaseGateMaterial.emissiveIntensity = 0.8 + sync * 2.4 + pulseImpulse;
      phaseGate.scale.setScalar(1 + sync * 0.07 + pulseImpulse * 0.12);
      panel.emissiveIntensity = 0.65 + charge / 180 + pulseImpulse * 0.65;

      resonators.forEach((resonator, i) => {
        resonator.group.rotation.y = phase * (i % 2 === 0 ? 2 : -3) + resonator.phase;
        resonator.group.position.x = Math.sin(phase * (i + 1) + resonator.phase) * 0.13;
        resonator.ringA.rotation.z = phase * (2 + i);
        resonator.ringB.rotation.x = -phase * (1 + i);
        const localCharge = Math.max(0, Math.min(1, charge / 100 * 1.35 - i * 0.22));
        resonator.coreMaterial.emissiveIntensity = 0.45 + localCharge * 2.7 + pulseImpulse * 1.6;
        resonator.core.scale.setScalar(0.82 + localCharge * 0.24 + pulseImpulse * 0.08);
      });

      for (const petal of crownPetals) {
        const wave = Math.sin(phase * 2 + petal.phase);
        petal.mesh.rotation.x = petal.baseTilt + wave * petal.amplitude - pulseImpulse * 0.12;
        petal.mesh.rotation.z = Math.sin(phase * 3 - petal.phase) * 0.08;
      }
      for (const petal of gardenPetals) {
        petal.mesh.rotation.x = petal.baseTilt + Math.sin(phase * 2 + petal.phase) * petal.amplitude - pulseImpulse * 0.04;
      }
      for (const sail of sails) {
        sail.mesh.rotation.x = sail.baseTilt + Math.sin(phase + sail.phase) * sail.amplitude;
        sail.pivot.position.y = 0.58 + Math.sin(phase * 2 + sail.phase) * 0.06;
      }

      for (let i = 0; i < beadCount; i++) {
        const t = (i / beadCount + phase / TAU) % 1;
        const a = t * TAU * 3 + (i % 3) * (TAU / 3);
        const r = 0.5 + Math.sin(t * TAU * 3) * 0.05 + pulseImpulse * 0.025;
        position.set(Math.cos(a) * r, 0.55 + t * 4.35, Math.sin(a) * r);
        scale.setScalar(0.65 + 0.45 * Math.sin(t * Math.PI) + pulseImpulse * 0.25);
        matrix.compose(position, quaternion, scale);
        beads.setMatrixAt(i, matrix);
      }
      beads.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < moteCount; i++) {
        const seed = hash(i);
        const a = seed * TAU + phase * (i % 2 === 0 ? 1 : -1) * (1 + (i % 3));
        const r = 2.7 + hash(i + 31) * 3.2;
        const y = 0.55 + hash(i + 73) * 5.1 + Math.sin(phase * 2 + seed * TAU) * 0.22;
        position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        scale.setScalar(0.55 + 0.75 * (0.5 + 0.5 * Math.sin(phase * 4 + seed * TAU)));
        matrix.compose(position, quaternion, scale);
        motes.setMatrixAt(i, matrix);
      }
      motes.instanceMatrix.needsUpdate = true;

      for (const ring of pulseRings) {
        if (!ring.mesh.visible) continue;
        ring.age += dt;
        const t = ring.age / ring.life;
        ring.mesh.scale.setScalar(0.6 + t * 5.2);
        ring.material.opacity = Math.max(0, (1 - t) * 0.9);
        ring.mesh.rotation.z += dt * 1.8;
        if (t >= 1) ring.mesh.visible = false;
      }

      for (let i = 0; i < shardCount; i++) {
        if (shardLife[i] > 0) {
          shardLife[i] = Math.max(0, shardLife[i] - dt);
          shardVelocity[i].y -= dt * 0.9;
          shardPosition[i].addScaledVector(shardVelocity[i], dt);
          position.copy(shardPosition[i]);
          scale.setScalar(shardLife[i] * 0.85);
        } else {
          position.set(0, -100, 0);
          scale.setScalar(0);
        }
        shardEuler.set(phase * (i % 3), phase * 2, 0);
        quaternion.setFromEuler(shardEuler);
        matrix.compose(position, quaternion, scale);
        shards.setMatrixAt(i, matrix);
      }
      shards.instanceMatrix.needsUpdate = true;
      quaternion.identity();

      updateHud(phase);
      stage.render();
      if (++diagnosticFrame % 30 === 0) {
        const renderCalls = stage.renderer.info.render.calls;
        const renderTriangles = stage.renderer.info.render.triangles;
        uiRoot.dataset.rendererCalls = String(Math.round((renderCalls - previousRenderCalls) / 30));
        uiRoot.dataset.rendererTriangles = String(Math.round((renderTriangles - previousRenderTriangles) / 30));
        uiRoot.dataset.rendererGeometries = String(stage.renderer.info.memory.geometries);
        uiRoot.dataset.rendererTextures = String(stage.renderer.info.memory.textures);
        previousRenderCalls = renderCalls;
        previousRenderTriangles = renderTriangles;
      }
      shell.tick();
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      delete diagnosticsWindow.__THREE_GAME_DIAGNOSTICS__;
      audio.dispose();
      stage.dispose();
    },
  };
}
