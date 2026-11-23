// Five interactive 3D Sanctuary Environments inspired directly by the other
// series in Algorythmic Explorations:
//   1. Meadow Valley     (Ground Truth: procedural hill + instanced wind grass + fireflies)
//   2. Starlight Nebula  (Particle Worlds: orbiting gravitational dust ring & starfield)
//   3. Bonfire Clearing  (Bounced Light: crackling embers, stones, flickering warm light)
//   4. Harmonic Hall     (Living Music / Acoustic Spaces: standing-wave floor rings)
//   5. Ferro Sanctuary   (Strange Matter: reactive magnetic obsidian pool with ripples)

import * as THREE from "three/webgpu";
import { screenUV, mix, vec3, float } from "three/tsl";

export type EnvironmentId = "meadow" | "nebula" | "bonfire" | "harmonic" | "ferro";

export interface EnvironmentMeta {
  id: EnvironmentId;
  name: string;
  inspiredBy: string;
  tagline: string;
  skyTop: [number, number, number];
  skyBottom: [number, number, number];
  fogColor: number;
  hemi: { sky: number; ground: number; intensity: number };
  key: { color: number; intensity: number; position: [number, number, number] };
  rim: { color: number; intensity: number; position: [number, number, number] };
}

export const ENVIRONMENTS: EnvironmentMeta[] = [
  {
    id: "meadow",
    name: "Meadow Valley",
    inspiredBy: "Ground Truth",
    tagline: "Procedural hills, swaying grass blades, and twilight fireflies.",
    skyTop: [0.055, 0.085, 0.175],
    skyBottom: [0.22, 0.145, 0.135],
    fogColor: 0x1a1724,
    hemi: { sky: 0xbcd4ff, ground: 0x3b4d2e, intensity: 0.95 },
    key: { color: 0xffddb5, intensity: 1.85, position: [3.2, 4.2, 2.4] },
    rim: { color: 0x8fbaff, intensity: 0.75, position: [-2.8, 2.5, -2.5] },
  },
  {
    id: "nebula",
    name: "Starlight Nebula",
    inspiredBy: "Particle Worlds",
    tagline: "An orbital dust sanctuary with swirling gravitational motes.",
    skyTop: [0.015, 0.02, 0.052],
    skyBottom: [0.055, 0.045, 0.11],
    fogColor: 0x0b0c18,
    hemi: { sky: 0x99b8ff, ground: 0x2a1f45, intensity: 0.9 },
    key: { color: 0xdbe7ff, intensity: 1.65, position: [2.5, 4.0, 2.5] },
    rim: { color: 0xc07aff, intensity: 1.05, position: [-2.8, 2.2, -2.4] },
  },
  {
    id: "bonfire",
    name: "Bonfire Clearing",
    inspiredBy: "Bounced Light",
    tagline: "Warm flickering campfire light and rising glowing embers.",
    skyTop: [0.022, 0.024, 0.042],
    skyBottom: [0.11, 0.055, 0.04],
    fogColor: 0x130d10,
    hemi: { sky: 0x7b8fb8, ground: 0x452414, intensity: 0.65 },
    key: { color: 0xffa857, intensity: 1.9, position: [1.8, 2.6, 2.2] },
    rim: { color: 0x6f94e8, intensity: 0.7, position: [-2.5, 2.8, -2.2] },
  },
  {
    id: "harmonic",
    name: "Harmonic Hall",
    inspiredBy: "Living Music & Acoustic Spaces",
    tagline: "Resonant acoustic chamber whose floor rings chime on every hop.",
    skyTop: [0.032, 0.042, 0.075],
    skyBottom: [0.09, 0.11, 0.165],
    fogColor: 0x111524,
    hemi: { sky: 0xcce0ff, ground: 0x2b3248, intensity: 0.95 },
    key: { color: 0xfff3e0, intensity: 1.75, position: [2.8, 4.5, 2.5] },
    rim: { color: 0x6ee7ff, intensity: 0.9, position: [-2.5, 2.4, -2.8] },
  },
  {
    id: "ferro",
    name: "Ferro Sanctuary",
    inspiredBy: "Strange Matter",
    tagline: "Glossy magnetic liquid pool that ripples and spikes under your pet.",
    skyTop: [0.02, 0.026, 0.038],
    skyBottom: [0.055, 0.078, 0.095],
    fogColor: 0x0c1016,
    hemi: { sky: 0x9fd8ff, ground: 0x192028, intensity: 0.85 },
    key: { color: 0xe6f4ff, intensity: 1.95, position: [2.6, 4.2, 2.2] },
    rim: { color: 0x5ef0b5, intensity: 1.0, position: [-2.6, 2.4, -2.6] },
  },
];

export interface EnvironmentInstance {
  id: EnvironmentId;
  group: THREE.Group;
  pulse(x: number, z: number, strength: number): void;
  update(time: number, dt: number, dreaming: boolean, petPos: THREE.Vector3): void;
  dispose(): void;
}

function disposeGroup(g: THREE.Group): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) {
      if (Array.isArray(m.material)) m.material.forEach((mm) => mats.add(mm));
      else mats.add(m.material);
    }
  });
  geos.forEach((geo) => geo.dispose());
  mats.forEach((mat) => mat.dispose());
}

export function applyEnvironmentBackdrop(
  scene: THREE.Scene,
  lights: { hemi: THREE.HemisphereLight; key: THREE.DirectionalLight; rim: THREE.DirectionalLight },
  meta: EnvironmentMeta,
  dreaming = false,
): void {
  const dim = dreaming ? 0.58 : 1.0;
  const top = meta.skyTop.map((v) => v * dim) as [number, number, number];
  const bot = meta.skyBottom.map((v) => v * dim) as [number, number, number];
  const horizon = mix(vec3(...bot), vec3(...top), screenUV.y.oneMinus());
  const glow = float(1).sub(screenUV.sub(0.5).length().mul(1.6)).max(0).pow(2).mul(dreaming ? 0.06 : 0.04);
  scene.backgroundNode = horizon.add(glow);
  scene.fog = new THREE.Fog(meta.fogColor, 6.5, 22);

  lights.hemi.color.setHex(meta.hemi.sky);
  lights.hemi.groundColor.setHex(meta.hemi.ground);
  lights.hemi.intensity = meta.hemi.intensity * (dreaming ? 0.65 : 1);

  lights.key.color.setHex(meta.key.color);
  lights.key.intensity = meta.key.intensity * (dreaming ? 0.55 : 1);
  lights.key.position.set(...meta.key.position);

  lights.rim.color.setHex(meta.rim.color);
  lights.rim.intensity = meta.rim.intensity * (dreaming ? 1.15 : 1);
  lights.rim.position.set(...meta.rim.position);
}

export function createEnvironment(id: EnvironmentId): EnvironmentInstance {
  const group = new THREE.Group();
  let pulseEnergy = 0;
  const pulsePos = new THREE.Vector2(0, 0);

  if (id === "meadow") {
    // Rolling procedural meadow disc + flat center clearing at y = 0
    const groundGeo = new THREE.CircleGeometry(6.5, 64, 0, Math.PI * 2);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const edge = Math.max(0, (r - 1.65) / 4.8);
      const hill = edge * edge * (0.45 + 0.35 * Math.sin(x * 0.9) * Math.cos(z * 0.8));
      pos.setY(i, hill - 0.01);
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ color: 0x2d4a2f, roughness: 0.95 }),
    );
    group.add(ground);

    // Instanced swaying grass blades around the clearing (Ground Truth tribute!)
    const bladeCount = 520;
    const bladeGeo = new THREE.ConeGeometry(0.022, 0.24, 4);
    bladeGeo.translate(0, 0.12, 0);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x5d9448, roughness: 0.85 });
    const blades = new THREE.InstancedMesh(bladeGeo, bladeMat, bladeCount);
    const baseData: { x: number; y: number; z: number; yaw: number; h: number; phase: number }[] = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < bladeCount; i++) {
      const a = (i * 2.39996) % (Math.PI * 2);
      const r = 1.15 + Math.sqrt(i / bladeCount) * 4.2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const edge = Math.max(0, (r - 1.65) / 4.8);
      const y = edge * edge * (0.45 + 0.35 * Math.sin(x * 0.9) * Math.cos(z * 0.8)) - 0.02;
      const h = 0.75 + ((i * 37) % 100) / 140;
      baseData.push({ x, y, z, yaw: a, h, phase: i * 0.31 });
      dummy.position.set(x, y, z);
      dummy.scale.set(1, h, 1);
      dummy.rotation.set(0, a, 0);
      dummy.updateMatrix();
      blades.setMatrixAt(i, dummy.matrix);
    }
    group.add(blades);

    // Stepping stones & glowing fireflies
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5c6373, roughness: 0.92 });
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + 0.3;
      const r = 1.6 + (i % 2) * 0.45;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14 + (i % 3) * 0.05, 0), stoneMat);
      st.scale.set(1.2, 0.55, 1.0);
      st.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
      group.add(st);
    }

    const fireflyMat = new THREE.MeshBasicMaterial({ color: 0xffe484 });
    const fireflies: { mesh: THREE.Mesh; r: number; y: number; spd: number; phase: number }[] = [];
    for (let i = 0; i < 24; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), fireflyMat);
      group.add(f);
      fireflies.push({
        mesh: f,
        r: 1.0 + (i % 7) * 0.55,
        y: 0.35 + (i % 5) * 0.25,
        spd: 0.28 + (i % 4) * 0.12,
        phase: i * 1.1,
      });
    }

    return {
      id,
      group,
      pulse(x, z, s) {
        pulsePos.set(x, z);
        pulseEnergy = Math.min(1.5, pulseEnergy + s);
      },
      update(time, dt) {
        pulseEnergy = Math.max(0, pulseEnergy - dt * 1.4);
        for (let i = 0; i < bladeCount; i++) {
          const b = baseData[i];
          const wind = Math.sin(time * 2.1 + b.x * 0.8 + b.phase) * 0.16;
          dummy.position.set(b.x, b.y, b.z);
          dummy.scale.set(1, b.h, 1);
          dummy.rotation.set(wind, b.yaw, wind * 0.6);
          dummy.updateMatrix();
          blades.setMatrixAt(i, dummy.matrix);
        }
        blades.instanceMatrix.needsUpdate = true;

        for (const f of fireflies) {
          const a = time * f.spd + f.phase;
          f.mesh.position.set(
            Math.cos(a) * f.r,
            f.y + Math.sin(time * 2.2 + f.phase) * 0.16,
            Math.sin(a) * f.r,
          );
          const sc = 0.65 + 0.55 * Math.sin(time * 4.5 + f.phase);
          f.mesh.scale.setScalar(sc);
        }
      },
      dispose: () => disposeGroup(group),
    };
  }

  if (id === "nebula") {
    // Floating crystalline sanctuary plinth + orbiting gravitational particle ring!
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.75, 1.45, 0.14, 48),
      new THREE.MeshStandardMaterial({ color: 0x171b30, roughness: 0.45, metalness: 0.35 }),
    );
    plinth.position.y = -0.075;
    group.add(plinth);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.76, 0.025, 12, 64),
      new THREE.MeshStandardMaterial({ color: 0x8eb4ff, emissive: 0x5c8aff, emissiveIntensity: 1.1, roughness: 0.2 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.0;
    group.add(rim);

    // 320 orbiting gravitational dust motes (Particle Worlds tribute!)
    const moteCount = 320;
    const moteGeo = new THREE.OctahedronGeometry(0.026, 0);
    const moteMat = new THREE.MeshBasicMaterial({ color: 0xa8c8ff });
    const motes = new THREE.InstancedMesh(moteGeo, moteMat, moteCount);
    const orbits: { r: number; angle: number; spd: number; y: number; s: number }[] = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < moteCount; i++) {
      const r = 1.9 + ((i * 73) % 100) / 28;
      orbits.push({
        r,
        angle: (i * 2.39996) % (Math.PI * 2),
        spd: 0.45 / Math.sqrt(r), // Keplerian orbital velocity!
        y: ((i % 19) - 9) * 0.12,
        s: 0.5 + ((i * 19) % 10) * 0.11,
      });
    }
    group.add(motes);

    return {
      id,
      group,
      pulse(_x, _z, s) {
        pulseEnergy = Math.min(1.5, pulseEnergy + s);
      },
      update(time, dt) {
        pulseEnergy = Math.max(0, pulseEnergy - dt * 1.2);
        for (let i = 0; i < moteCount; i++) {
          const o = orbits[i];
          const a = o.angle + time * o.spd * (1 + pulseEnergy * 0.6);
          dummy.position.set(Math.cos(a) * o.r, o.y + Math.sin(time * 1.4 + i) * 0.08, Math.sin(a) * o.r);
          dummy.scale.setScalar(o.s * (1 + pulseEnergy * 0.3));
          dummy.rotation.set(time + i, time * 0.7, 0);
          dummy.updateMatrix();
          motes.setMatrixAt(i, dummy.matrix);
        }
        motes.instanceMatrix.needsUpdate = true;
      },
      dispose: () => disposeGroup(group),
    };
  }

  if (id === "bonfire") {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 48),
      new THREE.MeshStandardMaterial({ color: 0x1d171a, roughness: 0.96 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.005;
    group.add(floor);

    // Cozy campfire offset gently behind-right so the pet sits warmly beside it
    const fireBase = new THREE.Group();
    fireBase.position.set(-1.35, 0, -1.05);
    group.add(fireBase);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4b444a, roughness: 0.92 });
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), stoneMat);
      st.scale.set(1.2, 0.75, 1.0);
      st.position.set(Math.cos(a) * 0.38, 0.05, Math.sin(a) * 0.38);
      fireBase.add(st);
    }

    const logMat = new THREE.MeshStandardMaterial({ color: 0x3b2419, roughness: 0.92 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.56, 8), logMat);
      log.rotation.z = Math.PI / 2 - 0.32;
      log.rotation.y = (i * Math.PI * 2) / 3;
      log.position.y = 0.09;
      fireBase.add(log);
    }

    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xffb347,
      emissive: 0xff6e24,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.52, 10), flameMat);
    flame.position.y = 0.28;
    fireBase.add(flame);

    const fireLight = new THREE.PointLight(0xff8e3c, 5.2, 9, 1.6);
    fireLight.position.set(0, 0.65, 0);
    fireBase.add(fireLight);

    // Rising glowing embers (Bounced Light tribute!)
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xffc066 });
    const embers: { mesh: THREE.Mesh; phase: number; r: number; spd: number }[] = [];
    for (let i = 0; i < 42; i++) {
      const em = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), emberMat);
      fireBase.add(em);
      embers.push({ mesh: em, phase: i * 0.37, r: 0.08 + (i % 7) * 0.045, spd: 0.45 + (i % 5) * 0.14 });
    }

    return {
      id,
      group,
      pulse(_x, _z, s) {
        pulseEnergy = Math.min(1.5, pulseEnergy + s);
      },
      update(time, dt) {
        pulseEnergy = Math.max(0, pulseEnergy - dt * 1.4);
        const flick = 0.85 + Math.sin(time * 13) * 0.09 + Math.cos(time * 21) * 0.07 + pulseEnergy * 0.35;
        fireLight.intensity = 5.0 * flick;
        flame.scale.set(0.95 + Math.sin(time * 9) * 0.08, 0.9 + flick * 0.25, 0.95 + Math.cos(time * 11) * 0.08);

        for (const e of embers) {
          const h = ((time * e.spd + e.phase) % 2.4);
          const a = time * 1.4 + e.phase * 3;
          e.mesh.position.set(Math.cos(a) * (e.r + h * 0.18), 0.18 + h, Math.sin(a) * (e.r + h * 0.18));
          const fade = Math.max(0.05, 1 - h / 2.4);
          e.mesh.scale.setScalar(fade * (1 + pulseEnergy * 0.4));
        }
      },
      dispose: () => disposeGroup(group),
    };
  }

  if (id === "harmonic") {
    // Serene acoustic hall with resonant concentric floor rings (Living Music / Acoustic Spaces)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5.2, 64),
      new THREE.MeshStandardMaterial({ color: 0x161b2c, roughness: 0.42, metalness: 0.25 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.005;
    group.add(floor);

    const rings: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; baseR: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = 0.65 + i * 0.52;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x80c8ff,
        emissive: 0x5c9eff,
        emissiveIntensity: 0.45,
        roughness: 0.2,
      });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 10, 64), mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 0.008;
      group.add(mesh);
      rings.push({ mesh, mat, baseR: r });
    }

    // Floating acoustic tuning pillars around the rim
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x262f4a, roughness: 0.5, metalness: 0.3 });
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      const h = 0.7 + (i % 3) * 0.35;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, h, 14), pillarMat);
      p.position.set(Math.cos(a) * 3.5, h * 0.5, Math.sin(a) * 3.5);
      group.add(p);
    }

    return {
      id,
      group,
      pulse(x, z, s) {
        pulsePos.set(x, z);
        pulseEnergy = Math.min(2.0, pulseEnergy + s * 1.2);
      },
      update(time, dt) {
        pulseEnergy = Math.max(0, pulseEnergy - dt * 1.1);
        rings.forEach((r, i) => {
          const wave = Math.sin(time * 2.6 - i * 0.75);
          r.mat.emissiveIntensity = 0.35 + Math.max(0, wave) * 0.55 + pulseEnergy * 0.9;
          r.mesh.position.y = 0.008 + Math.max(0, wave) * 0.02 * (1 + pulseEnergy);
        });
      },
      dispose: () => disposeGroup(group),
    };
  }

  // Default: "ferro" — Strange Matter reactive magnetic fluid pool!
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.22, 0.06, 48),
    new THREE.MeshStandardMaterial({ color: 0x181e28, roughness: 0.22, metalness: 0.75 }),
  );
  plinth.position.y = -0.03;
  group.add(plinth);

  const poolGeo = new THREE.PlaneGeometry(7.2, 7.2, 56, 56);
  poolGeo.rotateX(-Math.PI / 2);
  const basePos = Float32Array.from(poolGeo.attributes.position.array as Float32Array);
  const poolMat = new THREE.MeshStandardMaterial({
    color: 0x101722,
    emissive: 0x12323d,
    emissiveIntensity: 0.32,
    roughness: 0.14,
    metalness: 0.92,
  });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.y = -0.06;
  group.add(pool);

  return {
    id: "ferro",
    group,
    pulse(x, z, s) {
      pulsePos.set(x, z);
      pulseEnergy = Math.min(2.0, pulseEnergy + s * 1.25);
    },
    update(time, dt, _dreaming, petPos) {
      pulseEnergy = Math.max(0, pulseEnergy - dt * 1.15);
      const pos = poolGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const bx = basePos[i * 3];
        const bz = basePos[i * 3 + 2];
        const distCenter = Math.hypot(bx, bz);
        if (distCenter < 1.1) {
          pos.setY(i, -0.04);
          continue;
        }
        const dPet = Math.hypot(bx - petPos.x, bz - petPos.z);
        const ringFade = Math.min(1, (distCenter - 1.1) * 0.9) * Math.max(0, 1 - distCenter / 3.8);
        // Rosensweig-inspired hexagonal magnetic crown spikes!
        const spikes =
          Math.pow(0.5 + 0.5 * Math.cos(bx * 5.2 + time * 1.1) * Math.cos(bz * 5.2 - time * 0.9), 2.5) *
          (0.18 + pulseEnergy * 0.22);
        const ripple = Math.sin(dPet * 6.5 - time * 6.0) * Math.exp(-dPet * 0.7) * (0.04 + pulseEnergy * 0.12);
        pos.setY(i, (spikes + ripple) * ringFade);
      }
      pos.needsUpdate = true;
      poolGeo.computeVertexNormals();
    },
    dispose: () => disposeGroup(group),
  };
}
