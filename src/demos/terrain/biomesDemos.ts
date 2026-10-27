// The figures of Ground Truth part 5: the biome map (a pocket Whittaker
// diagram painted over the terrain), the populated patch where the rules
// place every tree and rock, and a hero drifting over an inhabited valley.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { TERRAIN_DEFAULTS, buildTerrainGeometry, terrainHeight, type TerrainParams } from "../../lib/terrain/heightmap";
import { buildGrassGeometry, makeGrassMaterial } from "../../lib/terrain/grass";
import { gridSampler } from "../../lib/terrain/light";
import { stampTreeShadows } from "../../lib/terrain/forest";
import { makePlantKit, plantItems, disposePlanting, type PlantKit } from "../../lib/terrain/populate";
import { buildVista } from "../../lib/terrain/vista";
import { createTerrainStage, terrainMaterial, MORNING, Smooth, type Look } from "../../lib/terrain/look";
import {
  SCATTER_DEFAULTS,
  moistureRaw,
  classify,
  scatterItems,
  grassBlades,
  biomeTint,
  BIOME_COLORS,
  type Biome,
  type ScatterParams,
} from "../../lib/terrain/scatter";

const BIOMES: Biome[] = ["forest", "meadow", "scrub", "scree", "alpine", "cliff"];

// ---- the map ------------------------------------------------------------------------------

export function mountBiomeMap(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;

  const RW = 320, RH = Math.round(320 * 0.62);
  const off = document.createElement("canvas");
  off.width = RW;
  off.height = RH;
  const octx = off.getContext("2d")!;
  const img = octx.createImageData(RW, RH);

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 23 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 23 };
  let showMoisture = false;
  let dirty = true;

  // the palette straight from the hex values, as sRGB bytes
  const palette = {} as Record<Biome, [number, number, number]>;
  for (const b of BIOMES) {
    const hex = BIOME_COLORS[b];
    palette[b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  }

  // The expensive noise is paid into cached grids (heights once per seed,
  // raw moisture once per seed and climate scale), a few rows per frame so
  // the page never freezes. The dials then redraw from the arrays in a
  // millisecond or two, because classifying is cheap; only the noise costs.
  const SPAN = 64;
  const cell = SPAN / RW;
  const xAt = (i: number): number => (i / RW - 0.5) * SPAN;
  const zAt = (j: number): number => (j / RH - 0.5) * SPAN * (RH / RW);
  const h01g = new Float32Array(RW * RH);
  const slopeg = new Float32Array(RW * RH);
  const mrawg = new Float32Array(RW * RH);
  let hRow = 0, mRow = 0; // chunked-compute cursors; RH = pass complete

  const computeRows = (budgetMs: number): void => {
    const t0 = performance.now();
    while (hRow < RH && performance.now() - t0 < budgetMs) {
      const j = hRow++;
      for (let i = 0; i < RW; i++) h01g[i + j * RW] = terrainHeight(xAt(i), zAt(j), tp) / tp.amplitude;
      if (hRow === RH) {
        // slope straight off the height grid: array math, no more noise
        for (let j2 = 0; j2 < RH; j2++) {
          for (let i = 0; i < RW; i++) {
            const i0 = Math.max(0, i - 1), i1 = Math.min(RW - 1, i + 1);
            const j0 = Math.max(0, j2 - 1), j1 = Math.min(RH - 1, j2 + 1);
            const dhdx = ((h01g[i1 + j2 * RW] - h01g[i0 + j2 * RW]) * tp.amplitude) / ((i1 - i0) * cell);
            const dhdz = ((h01g[i + j1 * RW] - h01g[i + j0 * RW]) * tp.amplitude) / ((j1 - j0) * cell);
            slopeg[i + j2 * RW] = Math.hypot(dhdx, dhdz);
          }
        }
      }
    }
    while (hRow === RH && mRow < RH && performance.now() - t0 < budgetMs) {
      const j = mRow++;
      for (let i = 0; i < RW; i++) mrawg[i + j * RW] = moistureRaw(xAt(i), zAt(j), sp);
    }
  };

  const draw = (): void => {
    const data = img.data;
    const counts: Record<Biome, number> = { forest: 0, meadow: 0, scrub: 0, scree: 0, alpine: 0, cliff: 0 };
    let p = 0;
    for (let j = 0; j < RH; j++) {
      for (let i = 0; i < RW; i++) {
        const q = i + j * RW;
        const m = Math.min(1, Math.max(0, mrawg[q] * 0.5 + 0.5 + sp.moistureOffset));
        // a little hillshade from the height grid so the relief shows through
        const e = h01g[Math.min(RW - 1, i + 1) + j * RW] - h01g[Math.max(0, i - 1) + j * RW];
        const n = h01g[i + Math.min(RH - 1, j + 1) * RW] - h01g[i + Math.max(0, j - 1) * RW];
        const shade = Math.min(1.25, Math.max(0.55, 0.92 + ((-e - n) * tp.amplitude) / (cell * 2) * 0.35));
        if (showMoisture) {
          data[p++] = (24 + m * 40) * shade;
          data[p++] = (44 + m * 110) * shade;
          data[p++] = (70 + m * 170) * shade;
        } else {
          const b = classify(h01g[q], slopeg[q], m, sp);
          counts[b]++;
          const [r, g, bb] = palette[b];
          data[p++] = r * shade;
          data[p++] = g * shade;
          data[p++] = bb * shade;
        }
        data[p++] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, shell.canvas.width, shell.canvas.height);
    if (showMoisture) {
      shell.readout.textContent = "moisture alone: darker is drier, brighter blue is wetter";
    } else {
      const total = RW * RH;
      shell.readout.textContent = BIOMES.map((b) => `${b} ${Math.round((counts[b] / total) * 100)}%`).join(" · ");
    }
  };

  shell.slider({
    label: "wet ↔ dry",
    min: -0.35,
    max: 0.35,
    step: 0.01,
    value: -sp.moistureOffset,
    format: (v) => (Math.abs(v) < 0.005 ? "neutral" : v > 0 ? `drier by ${v.toFixed(2)}` : `wetter by ${(-v).toFixed(2)}`),
    onInput: (v) => { sp.moistureOffset = -v; dirty = true; },
  });
  shell.slider({ label: "tree line", min: 0.3, max: 0.62, step: 0.01, value: sp.treeLine, format: (v) => `${Math.round(v * 100)}% of peak`, onInput: (v) => { sp.treeLine = v; dirty = true; } });
  shell.slider({ label: "climate scale", min: 0.015, max: 0.09, step: 0.002, value: sp.moistureFreq, format: (v) => `${(1 / v).toFixed(0)} u`, onInput: (v) => { sp.moistureFreq = v; mRow = 0; } });
  const viewBtn = shell.button("show moisture", () => {
    showMoisture = !showMoisture;
    viewBtn.textContent = showMoisture ? "show biomes" : "show moisture";
    dirty = true;
  });
  shell.button("new terrain", () => { tp.seed = (Math.random() * 1e6) | 0; sp.seed = tp.seed; hRow = 0; mRow = 0; });

  return {
    frame() {
      if (hRow < RH || mRow < RH) {
        computeRows(10);
        // draw what's there so far, so the map fills in instead of popping
        if (hRow === RH && mRow === RH) dirty = true;
        else {
          shell.readout.textContent = `computing the climate… ${(((hRow + mRow) / (2 * RH)) * 100) | 0}%`;
          return;
        }
      }
      if (dirty) {
        dirty = false;
        draw();
      }
    },
  };
}

// ---- shared: a populated piece of ground -------------------------------------------------------

interface Ground {
  mesh: THREE.Mesh;
  heights: Float32Array;
  W: number;
  x0: number;
  step: number;
}

function buildGround(tp: TerrainParams, sp: ScatterParams, look: Look, size: number, segments: number, material: THREE.Material, skirt?: number): Ground {
  const built = buildTerrainGeometry(tp, {
    size,
    segments,
    skirt,
    skirtTint: skirt ? [0.05, 0.04, 0.035, 1] : undefined,
    light: { sun: look.sunDir, reach: 30 },
    tint: biomeTint(tp, sp),
  });
  const mesh = new THREE.Mesh(built.geometry, material);
  mesh.frustumCulled = false;
  return { mesh, heights: built.heights, W: segments + 1, x0: -size / 2, step: size / segments };
}

// Re-paint an existing ground by biome after a climate change: height and
// slope from the geometry, the class from the scatter rules.
function repaint(g: Ground, tp: TerrainParams, sp: ScatterParams, keepRim: boolean): void {
  const tintFn = biomeTint(tp, sp);
  const pos = g.mesh.geometry.getAttribute("position");
  const nor = g.mesh.geometry.getAttribute("normal");
  const tint = g.mesh.geometry.getAttribute("aTint") as THREE.BufferAttribute;
  const n = g.W * g.W;
  for (let v = 0; v < n; v++) {
    if (keepRim && tint.getW(v) === 1) continue; // the painted cut at the block's edge
    const slope = Math.hypot(nor.getX(v), nor.getZ(v)) / Math.max(0.05, nor.getY(v));
    const [r, gg, b, w] = tintFn(pos.getX(v), pos.getZ(v), pos.getY(v), slope);
    tint.setXYZW(v, r, gg, b, w);
  }
  tint.needsUpdate = true;
}

interface Population {
  group: THREE.Group;
  trees: number;
  rocks: number;
  blades: number;
}

function populate(
  kit: PlantKit,
  g: Ground,
  tp: TerrainParams,
  sp: ScatterParams,
  look: Look,
  grassMat: ReturnType<typeof makeGrassMaterial>,
  grassCandidates: number,
  treeLod: number,
): Population {
  const half = ((g.W - 1) * g.step) / 2;
  const region = { minX: -half, minZ: -half, maxX: half, maxZ: half };
  const items = scatterItems(tp, sp, region);
  const planted = plantItems(kit, items, treeLod);

  // crown shadows into the ground's light, then grass that knows where the shade is
  const light = g.mesh.geometry.getAttribute("aLight") as THREE.BufferAttribute;
  const arr = light.array as Float32Array;
  const n = g.W * g.W;
  // start from the clean bake each time (stored on first use)
  const clean = (g.mesh.userData.cleanLight as Float32Array | undefined) ?? arr.slice(0, n * 2);
  g.mesh.userData.cleanLight = clean;
  arr.set(clean);
  stampTreeShadows(arr, g.W, g.W, g.x0, g.x0, g.step, planted.spots, kit.variants[treeLod], look.sunDir);
  light.needsUpdate = true;
  const sunGrid = new Float32Array(n);
  for (let v = 0; v < n; v++) sunGrid[v] = arr[v * 2];
  const sun = gridSampler(sunGrid, g.W, g.W, g.x0, g.x0, g.step);
  const heightAt = gridSampler(g.heights, g.W, g.W, g.x0, g.x0, g.step);

  const blades = grassBlades(tp, sp, region, grassCandidates, sp.seed + 5, { scale: 1.4, sun, heightAt });
  const grass = new THREE.Mesh(buildGrassGeometry(blades).geometry, grassMat.material);
  grass.frustumCulled = false;
  planted.group.add(grass);
  return { group: planted.group, trees: planted.trees, rocks: planted.rocks, blades: blades.length };
}

function dropPopulation(pop: Population): void {
  disposePlanting(pop.group);
  pop.group.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) o.geometry.dispose();
  });
}

// ---- the populated patch ---------------------------------------------------------------------

export async function mountBiomePatch(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createTerrainStage(shell.canvas, MORNING, {
    target: [0, 1.2, 0],
    distance: 34,
    minDistance: 8,
    maxDistance: 60,
    elevation: 0.55,
    azimuth: 0.8,
    fov: 42,
    far: 400,
  });
  const look = stage.look;
  look.uHaze.value = 0.003; // a block on a table, not a view: keep the air clear

  const SIZE = 40, SEG = 200;
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 17, frequency: 0.05, amplitude: 5 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 17 };
  const kit = makePlantKit(look, [1]);
  kit.treeMats.wind.value = 0.6;
  // snow only where the rules say alpine, so the paint and the plants agree
  const ground = terrainMaterial(look, { amplitude: tp.amplitude, snowLine: [sp.treeLine + 0.17, sp.treeLine + 0.27] });

  let g = buildGround(tp, sp, look, SIZE, SEG, ground.material, 1.5);
  stage.scene.add(g.mesh);
  const grassMat = makeGrassMaterial(look);
  grassMat.strength.value = 0.45;
  let pop = populate(kit, g, tp, sp, look, grassMat, 120_000, 1);
  stage.scene.add(pop.group);

  let timer = 0;
  const rebuild = (newTerrain: boolean): void => {
    if (newTerrain) {
      stage.scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      g = buildGround(tp, sp, look, SIZE, SEG, ground.material, 1.5);
      stage.scene.add(g.mesh);
    } else {
      repaint(g, tp, sp, true);
    }
    stage.scene.remove(pop.group);
    dropPopulation(pop);
    pop = populate(kit, g, tp, sp, look, grassMat, 120_000, 1);
    stage.scene.add(pop.group);
  };
  const queue = (newTerrain: boolean): void => {
    clearTimeout(timer);
    timer = window.setTimeout(() => rebuild(newTerrain), 250);
  };

  shell.slider({
    label: "wet ↔ dry",
    min: -0.35,
    max: 0.35,
    step: 0.01,
    value: -sp.moistureOffset,
    format: (v) => (Math.abs(v) < 0.005 ? "neutral" : v > 0 ? `drier by ${v.toFixed(2)}` : `wetter by ${(-v).toFixed(2)}`),
    onInput: (v) => { sp.moistureOffset = -v; queue(false); },
  });
  shell.slider({ label: "tree line", min: 0.3, max: 0.62, step: 0.01, value: sp.treeLine, format: (v) => `${Math.round(v * 100)}% of peak`, onInput: (v) => { sp.treeLine = v; queue(false); } });
  shell.button("new terrain", () => {
    tp.seed = (Math.random() * 1e6) | 0;
    sp.seed = tp.seed;
    queue(true);
  });
  shell.setInfo(() => `${pop.trees} trees · ${pop.rocks} rocks · ${pop.blades.toLocaleString()} blades, all placed by the rules`);

  return {
    frame() {
      const time = (performance.now() / 1000) % 10000;
      grassMat.time.value = time;
      kit.treeMats.time.value = time;
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- hero: the inhabited valley ---------------------------------------------------------------

export async function mountBiomesHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createTerrainStage(shell.canvas, MORNING, { orbit: false, fov: 46, near: 0.1, far: 1500 });
  const look = stage.look;
  look.uHaze.value = 0.0055;

  const SIZE = 96, SEG = 384;
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 23, frequency: 0.04, amplitude: 9 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 23 };
  const terrain = terrainMaterial(look, { amplitude: tp.amplitude, snowLine: [sp.treeLine + 0.17, sp.treeLine + 0.27] });
  const kit = makePlantKit(look, [1]);
  kit.treeMats.wind.value = 0.6;

  // the populated valley, and plain land beyond it out to the haze (tinted
  // by the same biome rules, so far forests still read as forest)
  const g = buildGround(tp, sp, look, SIZE, SEG, terrain.material);
  stage.scene.add(g.mesh);
  const vista = buildVista(tp, look.sunDir, terrain.material, [
    { half: 192, step: 1.5 },
    { half: 800, step: 8 },
  ], { core: SIZE / 2, reach: 60, tint: biomeTint(tp, sp) });
  stage.scene.add(vista.group);

  const grassMat = makeGrassMaterial(look);
  grassMat.strength.value = 0.5;
  stage.scene.add(populate(kit, g, tp, sp, look, grassMat, 260_000, 1).group);

  // a slow circle over the valley, high enough to see the pattern
  const R = 30;
  let theta = 0.4;
  let last = performance.now();
  const alt = new Smooth(3);
  const aim = new Smooth(3);
  const heightAt = (x: number, z: number): number => terrainHeight(x, z, tp);
  const envelope = (th: number): number => {
    let m = -Infinity;
    for (let k = -1; k <= 4; k++) m = Math.max(m, heightAt(Math.cos(th + k * 0.06) * R, Math.sin(th + k * 0.06) * R));
    return m;
  };

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * 0.02;
      const time = (now / 1000) % 10000;
      grassMat.time.value = time;
      kit.treeMats.time.value = time;

      const cx = Math.cos(theta) * R, cz = Math.sin(theta) * R;
      const cy = alt.step(envelope(theta) + 13, dt);
      stage.camera.position.set(cx, cy, cz);
      // look across the valley to its far side, a little down
      const la = theta + Math.PI * 0.8;
      const lx = Math.cos(la) * R * 0.7, lz = Math.sin(la) * R * 0.7;
      stage.camera.lookAt(lx, aim.step(heightAt(lx, lz) - 1, dt), lz);
      stage.draw();
    },
    dispose: () => stage.dispose(),
  };
}
