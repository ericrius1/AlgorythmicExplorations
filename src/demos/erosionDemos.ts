// The figures of Ground Truth part 2: droplets tracing drainage on the flat
// map, the full storm carving the relief in 3D, and a hero where the rain
// falls live while the camera watches the mountains age.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D } from "../lib/stage3d";
import { TERRAIN_DEFAULTS, type TerrainParams } from "../lib/terrain/heightmap";
import {
  EROSION_DEFAULTS,
  makeErosionGrid,
  traceDroplet,
  rain,
  buildGridGeometry,
  updateGridGeometry,
  type ErosionGrid,
  type ErosionParams,
} from "../lib/terrain/erosion";
import { hash2 } from "../lib/terrain/noise";

const DUSK_STAGE = {
  skyTop: [0.07, 0.09, 0.16] as [number, number, number],
  skyBottom: [0.21, 0.17, 0.2] as [number, number, number],
  hemi: { sky: 0x8fa8cc, ground: 0x4a4238, intensity: 0.7 },
  key: { color: 0xffd9b0, intensity: 2.0, position: [6, 4, 3] as [number, number, number] },
  rim: { color: 0x7d96d6, intensity: 0.5, position: [-5, 3, -4] as [number, number, number] },
};

// ---- droplets on the map: paths finding the drainage --------------------------------

export function mountDropletTrace(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;

  const W = 220;
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 23 };
  const ep: ErosionParams = { ...EROSION_DEFAULTS };
  let grid = makeErosionGrid(tp, 26, W);
  const path = new Float32Array(ep.maxSteps * 2);

  // the base map rendered once; droplet trails accumulate on top
  const base = document.createElement("canvas");
  base.width = W;
  base.height = W;
  const bctx = base.getContext("2d")!;
  const trails = document.createElement("canvas");
  trails.width = shell.canvas.width;
  trails.height = shell.canvas.height;
  const tctx = trails.getContext("2d")!;

  let traced = 0;
  let raining = false;

  const drawBase = (): void => {
    const img = bctx.createImageData(W, W);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < grid.heights.length; i++) {
      lo = Math.min(lo, grid.heights[i]);
      hi = Math.max(hi, grid.heights[i]);
    }
    for (let i = 0; i < W * W; i++) {
      const g = ((grid.heights[i] - lo) / (hi - lo)) * 235;
      img.data[i * 4] = g;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = g;
      img.data[i * 4 + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
  };
  drawBase();

  const compose = (): void => {
    const cw = shell.canvas.width, ch = shell.canvas.height;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, 0, 0, cw, ch);
    ctx.drawImage(trails, 0, 0);
    shell.readout.textContent = `${traced.toLocaleString()} droplets traced · cyan = young and fast, amber = laden and slow`;
  };
  compose();

  const traceOne = (): void => {
    const x = 1 + hash2(traced, 17, 5) * (W - 3);
    const y = 1 + hash2(traced, 91, 5) * (W - 3);
    const steps = traceDroplet(grid, ep, x, y, path);
    traced++;
    const sx = shell.canvas.width / W, sy = shell.canvas.height / W;
    for (let s = 1; s < steps; s++) {
      const t = s / Math.max(1, steps - 1);
      tctx.strokeStyle = `rgba(${103 + t * 140}, ${232 - t * 90}, ${249 - t * 120}, 0.5)`;
      tctx.lineWidth = 1.2;
      tctx.beginPath();
      tctx.moveTo(path[(s - 1) * 2] * sx, path[(s - 1) * 2 + 1] * sy);
      tctx.lineTo(path[s * 2] * sx, path[s * 2 + 1] * sy);
      tctx.stroke();
    }
  };

  shell.button("rain 25", () => {
    for (let k = 0; k < 25; k++) traceOne();
    drawBase();
    compose();
  });
  shell.button("storm (keep raining)", () => { raining = !raining; });
  shell.slider({ label: "inertia", min: 0, max: 0.6, step: 0.01, value: ep.inertia, onInput: (v) => { ep.inertia = v; } });
  shell.button("reset", () => {
    grid = makeErosionGrid(tp, 26, W);
    traced = 0;
    tctx.clearRect(0, 0, trails.width, trails.height);
    drawBase();
    compose();
  });

  let frame = 0;
  return {
    frame() {
      if (!raining) return;
      for (let k = 0; k < 6; k++) traceOne();
      // trails slowly fade so the storm shows living drainage, not a smear
      tctx.fillStyle = "rgba(0, 0, 0, 0.02)";
      tctx.globalCompositeOperation = "destination-out";
      tctx.fillRect(0, 0, trails.width, trails.height);
      tctx.globalCompositeOperation = "source-over";
      if (++frame % 10 === 0) drawBase();
      compose();
    },
  };
}

// ---- the storm in three dimensions ---------------------------------------------------

export async function mountErode3D(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    ...DUSK_STAGE,
    target: [0, 1.0, 0],
    distance: 11,
    minDistance: 4,
    maxDistance: 28,
    elevation: 0.42,
    azimuth: 0.8,
    fov: 45,
    far: 200,
  });

  const W = 256;
  const SIZE = 16;
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 23 };
  const ep: ErosionParams = { ...EROSION_DEFAULTS };

  let grid: ErosionGrid = makeErosionGrid(tp, SIZE, W);
  let pristine = new Float32Array(grid.heights); // for the before/after toggle
  let geometry = buildGridGeometry(grid, tp.amplitude);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const mesh = new THREE.Mesh(geometry, material);
  stage.scene.add(mesh);

  let raining = false;
  let showBefore = false;
  let tint = true;
  let dirty = false;

  const refresh = (): void => {
    updateGridGeometry(geometry, grid, tp.amplitude, { tint: tint && !showBefore });
    dirty = false;
  };

  const swapHeights = (h: Float32Array): void => {
    const view = grid.heights;
    grid.heights = h;
    refresh();
    grid.heights = view;
  };

  shell.button("rain ⏵⏸", () => { raining = !raining; });
  shell.slider({ label: "capacity", min: 0.5, max: 8, step: 0.1, value: ep.capacity, onInput: (v) => { ep.capacity = v; } });
  shell.slider({ label: "deposition", min: 0.02, max: 0.8, step: 0.01, value: ep.deposition, onInput: (v) => { ep.deposition = v; } });
  shell.slider({ label: "brush radius", min: 1, max: 5, step: 0.25, value: ep.radius, onInput: (v) => { ep.radius = v; } });
  shell.button("before/after", () => {
    showBefore = !showBefore;
    if (showBefore) swapHeights(pristine);
    else refresh();
  });
  shell.button("sediment paint", () => { tint = !tint; if (!showBefore) refresh(); });
  shell.button("reroll", () => {
    tp.seed = (Math.random() * 1e6) | 0;
    grid = makeErosionGrid(tp, SIZE, W);
    pristine = new Float32Array(grid.heights);
    showBefore = false;
    refresh();
  });
  shell.setInfo(() => (showBefore ? "showing the uneroded function" : `${grid.droplets.toLocaleString()} droplets`));

  let frame = 0;
  return {
    frame() {
      if (raining && !showBefore) {
        rain(grid, ep, 700, 99 + frame);
        dirty = true;
      }
      if (dirty && ++frame % 4 === 0) refresh();
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- hero: the rain falls while you watch --------------------------------------------

export async function mountErosionHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createStage3D(shell.canvas, {
    ...DUSK_STAGE,
    fog: { color: 0x131722, near: 18, far: 78 },
    fov: 55,
    far: 300,
  });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, frequency: 0.055, amplitude: 7, seed: 12 };
  const ep: ErosionParams = { ...EROSION_DEFAULTS, radius: 2 };
  const W = 300;
  const grid = makeErosionGrid(tp, 110, W);
  const geometry = buildGridGeometry(grid, tp.amplitude);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  stage.scene.add(mesh);

  const heightAt = (x: number, z: number): number => {
    const gx = Math.min(W - 1, Math.max(0, ((x + 55) / 110) * (W - 1)));
    const gz = Math.min(W - 1, Math.max(0, ((z + 55) / 110) * (W - 1)));
    return grid.heights[Math.round(gx) + Math.round(gz) * W];
  };

  let theta = 0;
  let camY = 12;
  let last = performance.now();
  let frame = 0;
  const R = 26;
  const BUDGET = 120_000; // droplets; after this the storm has passed

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * 0.022;

      if (grid.droplets < BUDGET) {
        rain(grid, ep, 900, 7);
        if (++frame % 6 === 0) updateGridGeometry(geometry, grid, tp.amplitude);
      }

      const cx = Math.cos(theta) * R;
      const cz = Math.sin(theta) * R;
      camY += (Math.max(heightAt(cx, cz) + 3.2, 6.5) - camY) * Math.min(1, dt * 1.5);
      stage.camera.position.set(cx, camY, cz);

      const la = theta + 0.55;
      const lx = Math.cos(la) * R * 0.7;
      const lz = Math.sin(la) * R * 0.7;
      stage.camera.lookAt(lx, heightAt(lx, lz) + 1.2, lz);

      stage.renderer.render(stage.scene, stage.camera);
    },
    dispose: () => stage.dispose(),
  };
}
