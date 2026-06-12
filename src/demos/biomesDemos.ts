// The figures of Ground Truth part 5: the biome map (a pocket Whittaker
// diagram painted over the terrain), the populated patch where the rules
// place every tree and rock, and a hero drifting over an inhabited valley.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D } from "../lib/stage3d";
import { hash2 } from "../lib/terrain/noise";
import { TERRAIN_DEFAULTS, buildTerrainGeometry, type TerrainParams } from "../lib/terrain/heightmap";
import { buildGrassGeometry, makeGrassMaterial } from "../lib/terrain/grass";
import { growTree, buildTreeGeometry, TREE_DEFAULTS } from "../lib/terrain/trees";
import {
  SCATTER_DEFAULTS,
  groundAt,
  moisture,
  scatterItems,
  grassBlades,
  buildRockGeometry,
  BIOME_COLORS,
  type Biome,
  type ScatterParams,
} from "../lib/terrain/scatter";

const MORNING_STAGE = {
  skyTop: [0.09, 0.13, 0.22] as [number, number, number],
  skyBottom: [0.23, 0.21, 0.22] as [number, number, number],
  hemi: { sky: 0xa8c0e0, ground: 0x46503a, intensity: 0.9 },
  key: { color: 0xfff0c8, intensity: 2.2, position: [5, 6, 2] as [number, number, number] },
  rim: { color: 0x88a8e8, intensity: 0.45, position: [-5, 3, -4] as [number, number, number] },
};

// ---- the map ------------------------------------------------------------------------------

export function mountBiomeMap(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;

  const RW = 300, RH = 188;
  const off = document.createElement("canvas");
  off.width = RW;
  off.height = RH;
  const octx = off.getContext("2d")!;
  const img = octx.createImageData(RW, RH);

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 23 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS };
  let showMoisture = false;
  let dirty = true;

  const palette: Record<Biome, [number, number, number]> = Object.fromEntries(
    Object.entries(BIOME_COLORS).map(([k, hex]) => {
      const c = new THREE.Color(hex);
      return [k, [c.r * 255, c.g * 255, c.b * 255]];
    }),
  ) as Record<Biome, [number, number, number]>;

  const draw = (): void => {
    const data = img.data;
    const span = 64;
    let p = 0;
    for (let j = 0; j < RH; j++) {
      const z = (j / RH - 0.5) * span * (RH / RW);
      for (let i = 0; i < RW; i++) {
        const x = (i / RW - 0.5) * span;
        if (showMoisture) {
          const m = moisture(x, z, sp);
          data[p++] = 30 + m * 60;
          data[p++] = 60 + m * 120;
          data[p++] = 80 + m * 175;
          data[p++] = 255;
        } else {
          const g = groundAt(x, z, tp, sp);
          const [r, gg, b] = palette[g.biome];
          const shade = 0.55 + 0.45 * g.h01; // relief whispers through the classes
          data[p++] = r * shade;
          data[p++] = gg * shade;
          data[p++] = b * shade;
          data[p++] = 255;
        }
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, shell.canvas.width, shell.canvas.height);
    shell.readout.textContent = showMoisture
      ? "the rainfall field alone — brighter is wetter"
      : "dark green forest · light green meadow · tan scrub · gray scree · white alpine";
  };

  shell.slider({ label: "wet ↔ dry", min: -0.35, max: 0.35, step: 0.01, value: -sp.moistureOffset, format: (v) => (v >= 0 ? `dry +${v.toFixed(2)}` : `wet ${(-v).toFixed(2)}`), onInput: (v) => { sp.moistureOffset = -v; dirty = true; } });
  shell.slider({ label: "tree line", min: 0.3, max: 0.62, step: 0.01, value: sp.treeLine, onInput: (v) => { sp.treeLine = v; dirty = true; } });
  shell.slider({ label: "climate scale", min: 0.015, max: 0.09, step: 0.002, value: sp.moistureFreq, format: (v) => `${(1 / v).toFixed(0)} u`, onInput: (v) => { sp.moistureFreq = v; dirty = true; } });
  shell.button("moisture / biomes", () => { showMoisture = !showMoisture; dirty = true; });
  shell.button("reroll", () => { tp.seed = (Math.random() * 1e6) | 0; sp.seed = tp.seed; dirty = true; });

  return {
    frame() {
      if (dirty) {
        dirty = false;
        draw();
      }
    },
  };
}

// ---- shared: populate a scene from the scatter rules ---------------------------------------

interface Population {
  group: THREE.Group;
  trees: number;
  rocks: number;
  blades: number;
}

const treeVariantCache: ReturnType<typeof buildTreeGeometry>[] = [];
function treeVariants(): ReturnType<typeof buildTreeGeometry>[] {
  if (treeVariantCache.length === 0) {
    for (let k = 0; k < 4; k++) treeVariantCache.push(buildTreeGeometry(growTree({ ...TREE_DEFAULTS, seed: 100 + k * 17 })));
  }
  return treeVariantCache;
}
const rockVariantCache: THREE.BufferGeometry[] = [];
function rockVariants(): THREE.BufferGeometry[] {
  if (rockVariantCache.length === 0) {
    for (let k = 0; k < 3; k++) rockVariantCache.push(buildRockGeometry(k));
  }
  return rockVariantCache;
}

const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 });

function populate(
  tp: TerrainParams,
  sp: ScatterParams,
  region: { minX: number; minZ: number; maxX: number; maxZ: number },
  grassMat: ReturnType<typeof makeGrassMaterial>,
  grassCandidates: number,
): Population {
  const group = new THREE.Group();
  const items = scatterItems(tp, sp, region);
  const m4 = new THREE.Matrix4();
  const sc = new THREE.Vector3();

  const tv = treeVariants(), rv = rockVariants();
  let trees = 0, rocks = 0;
  for (let v = 0; v < tv.length; v++) {
    const mine = items.filter((it) => it.kind === "tree" && it.variant === v);
    if (mine.length === 0) continue;
    trees += mine.length;
    const bark = new THREE.InstancedMesh(tv[v].bark, barkMat, mine.length);
    const leaf = new THREE.InstancedMesh(tv[v].leaves, leafMat, mine.length);
    mine.forEach((it, i) => {
      sc.setScalar(it.scale);
      m4.makeRotationY(it.yaw).scale(sc).setPosition(it.x, it.y, it.z);
      bark.setMatrixAt(i, m4);
      leaf.setMatrixAt(i, m4);
    });
    group.add(bark, leaf);
  }
  for (let v = 0; v < rv.length; v++) {
    const mine = items.filter((it) => it.kind === "rock" && it.variant === v);
    if (mine.length === 0) continue;
    rocks += mine.length;
    const rock = new THREE.InstancedMesh(rv[v], rockMat, mine.length);
    mine.forEach((it, i) => {
      sc.setScalar(it.scale);
      m4.makeRotationY(it.yaw).scale(sc).setPosition(it.x, it.y, it.z);
      rock.setMatrixAt(i, m4);
    });
    group.add(rock);
  }

  const blades = grassBlades(tp, sp, region, grassCandidates, sp.seed + 5);
  group.add(new THREE.Mesh(buildGrassGeometry(blades).geometry, grassMat.material));

  return { group, trees, rocks, blades: blades.length };
}

// Re-tint an existing terrain geometry by biome, so the ground itself admits
// which climate it's in (the part-1 palette only knew height and slope).
function biomeTint(geometry: THREE.BufferGeometry, tp: TerrainParams, sp: ScatterParams): void {
  const pos = geometry.getAttribute("position");
  const col = geometry.getAttribute("color");
  const c = new THREE.Color(), b = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const g = groundAt(pos.getX(i), pos.getZ(i), tp, sp);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    b.setHex(BIOME_COLORS[g.biome]);
    const mottle = 0.9 + 0.2 * hash2(i, 5, sp.seed);
    c.lerp(b, 0.42).multiplyScalar(mottle);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

// ---- the populated patch ---------------------------------------------------------------------

export async function mountBiomePatch(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    ...MORNING_STAGE,
    target: [0, 1.6, 0],
    distance: 22,
    minDistance: 5,
    maxDistance: 50,
    elevation: 0.5,
    azimuth: 0.8,
    fov: 45,
    far: 300,
  });

  const SIZE = 40;
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 23, frequency: 0.05, amplitude: 5 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 23 };
  const region = { minX: -SIZE / 2, minZ: -SIZE / 2, maxX: SIZE / 2, maxZ: SIZE / 2 };

  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  let ground = new THREE.Mesh(buildTerrainGeometry(tp, { size: SIZE, segments: 256 }).geometry, groundMat);
  biomeTint(ground.geometry, tp, sp);
  stage.scene.add(ground);

  const grassMat = makeGrassMaterial();
  grassMat.strength.value = 0.5;
  let pop = populate(tp, sp, region, grassMat, 110_000);
  stage.scene.add(pop.group);

  let timer = 0;
  const rebuild = (newTerrain: boolean): void => {
    if (newTerrain) {
      ground.geometry.dispose();
      ground.geometry = buildTerrainGeometry(tp, { size: SIZE, segments: 256 }).geometry;
    }
    biomeTint(ground.geometry, tp, sp);
    stage.scene.remove(pop.group);
    pop.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    pop = populate(tp, sp, region, grassMat, 110_000);
    stage.scene.add(pop.group);
  };
  const queue = (newTerrain: boolean): void => {
    clearTimeout(timer);
    timer = window.setTimeout(() => rebuild(newTerrain), 300);
  };

  shell.slider({ label: "wet ↔ dry", min: -0.35, max: 0.35, step: 0.01, value: -sp.moistureOffset, format: (v) => (v >= 0 ? `dry +${v.toFixed(2)}` : `wet ${(-v).toFixed(2)}`), onInput: (v) => { sp.moistureOffset = -v; queue(false); } });
  shell.slider({ label: "tree line", min: 0.3, max: 0.62, step: 0.01, value: sp.treeLine, onInput: (v) => { sp.treeLine = v; queue(false); } });
  shell.button("reroll", () => {
    tp.seed = (Math.random() * 1e6) | 0;
    sp.seed = tp.seed;
    queue(true);
  });
  shell.setInfo(() => `${pop.trees} trees · ${pop.rocks} rocks · ${pop.blades.toLocaleString()} blades — nobody placed any of them`);

  return {
    frame() {
      grassMat.time.value = (performance.now() / 1000) % 10000;
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- hero: the inhabited valley ---------------------------------------------------------------

export async function mountBiomesHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createStage3D(shell.canvas, {
    ...MORNING_STAGE,
    fog: { color: 0x151a24, near: 14, far: 70 },
    fov: 55,
    far: 300,
  });

  const SIZE = 96;
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 12, frequency: 0.05, amplitude: 6 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 12 };
  const region = { minX: -SIZE / 2, minZ: -SIZE / 2, maxX: SIZE / 2, maxZ: SIZE / 2 };

  const ground = new THREE.Mesh(
    buildTerrainGeometry(tp, { size: SIZE, segments: 340 }).geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  );
  biomeTint(ground.geometry, tp, sp);
  stage.scene.add(ground);

  const grassMat = makeGrassMaterial();
  grassMat.strength.value = 0.55;
  stage.scene.add(populate(tp, sp, region, grassMat, 220_000).group);

  let theta = 0;
  let camY = 8;
  let last = performance.now();
  const R = 22;

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * 0.024;
      grassMat.time.value = (now / 1000) % 10000;

      const cx = Math.cos(theta) * R;
      const cz = Math.sin(theta) * R;
      camY += (Math.max(groundAt(cx, cz, tp, sp).h + 2.6, 4.5) - camY) * Math.min(1, dt * 1.5);
      stage.camera.position.set(cx, camY, cz);

      const la = theta + 0.6;
      const lx = Math.cos(la) * R * 0.8;
      const lz = Math.sin(la) * R * 0.8;
      stage.camera.lookAt(lx, groundAt(lx, lz, tp, sp).h + 1.2, lz);

      stage.renderer.render(stage.scene, stage.camera);
    },
    dispose: () => stage.dispose(),
  };
}
