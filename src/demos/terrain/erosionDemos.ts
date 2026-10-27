// The figures of Ground Truth part 2: droplets tracing drainage on the flat
// map, the storm carving a block of terrain in 3D, and a hero where the rain
// falls live while the camera circles and the streams fill in.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";
import { TERRAIN_DEFAULTS, type TerrainParams } from "../../lib/terrain/heightmap";
import {
  EROSION_DEFAULTS,
  makeErosionGrid,
  traceDroplet,
  rain,
  buildGridGeometry,
  updateGridGeometry,
  relightGrid,
  type ErosionGrid,
  type ErosionParams,
} from "../../lib/terrain/erosion";
import { hash2 } from "../../lib/terrain/noise";
import { gridSampler } from "../../lib/terrain/light";
import { createTerrainStage, terrainMaterial, GOLDEN, Smooth, type Mood } from "../../lib/terrain/look";
import { buildVista } from "../../lib/terrain/vista";
import { reliefRgb } from "./mapColors";

// Rain until the frame's time budget is spent. Returns droplets run.
function rainFor(grid: ErosionGrid, p: ErosionParams, budgetMs: number, cap: number, seed: number): number {
  const t0 = performance.now();
  let n = 0;
  while (grid.droplets < cap && performance.now() - t0 < budgetMs) {
    rain(grid, p, 25, seed);
    n += 25;
  }
  return n;
}

// ---- droplets on the map: paths finding the drainage --------------------------------

export function mountDropletTrace(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = pixelRatio(shell.canvas);

  const W = 220;
  const SIZE = 26;
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 23 };
  const ep: ErosionParams = { ...EROSION_DEFAULTS };
  let grid = makeErosionGrid(tp, SIZE, W);
  const path = new Float32Array(ep.maxSteps * 4);

  // the map is drawn into a W×W image and stretched over the canvas, so the
  // map's x and y scales differ; trails use the same stretch
  const base = document.createElement("canvas");
  base.width = W;
  base.height = W;
  const bctx = base.getContext("2d")!;
  const img = bctx.createImageData(W, W);
  const hs = new Float32Array(W * W);
  const trails = document.createElement("canvas");
  trails.width = shell.canvas.width;
  trails.height = shell.canvas.height;
  const tctx = trails.getContext("2d")!;

  let traced = 0;
  let raining = true;
  let lo = 0, hi = 1;

  const drawBase = (): void => {
    lo = Infinity; hi = -Infinity;
    for (let i = 0; i < grid.heights.length; i++) {
      lo = Math.min(lo, grid.heights[i]);
      hi = Math.max(hi, grid.heights[i]);
    }
    for (let i = 0; i < W * W; i++) hs[i] = (grid.heights[i] - lo) / (hi - lo);
    const cellOverAmp = grid.cellWorld / (hi - lo);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const [r, g, b] = reliefRgb(hs, W, W, i, j, cellOverAmp);
        const q = (i + j * W) * 4;
        // dimmed, so the bright trails read on top
        img.data[q] = r * 0.62; img.data[q + 1] = g * 0.62; img.data[q + 2] = b * 0.66; img.data[q + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
  };
  drawBase();

  const compose = (): void => {
    const cw = shell.canvas.width, ch = shell.canvas.height;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, 0, 0, cw, ch);
    ctx.drawImage(trails, 0, 0);
    shell.readout.textContent = `${traced.toLocaleString()} droplets · cyan = carrying little, amber = carrying a full load, blue = pooled in a pit · ${raining ? "raining" : "paused"}`;
  };

  // colour by load: a droplet that has picked up 0.12 units of sediment or
  // more is drawn fully amber. The trail stops once the droplet has gone six
  // steps without reaching a new low, which means it's sloshing about in a
  // pit until it dries up; that spot gets a faint blue dot instead, and the
  // dots pile up into ponds.
  const trailColor = (sed: number): string => {
    const t = Math.min(1, sed / 0.12);
    const r = 90 + t * 165, g = 220 - t * 64, b = 255 - t * 160;
    return `rgba(${r | 0}, ${g | 0}, ${b | 0}, 0.3)`;
  };
  let sampler = gridSampler(grid.heights, W, W, 0, 0, 1);

  const traceOne = (): void => {
    const x = 1 + hash2(traced, 17, 5) * (W - 3);
    const y = 1 + hash2(traced, 91, 5) * (W - 3);
    const steps = traceDroplet(grid, ep, x, y, path);
    traced++;
    let end = steps - 1, lowStep = 0, low = Infinity, pooled = false;
    for (let s = 0; s < steps; s++) {
      const h = sampler(path[s * 4], path[s * 4 + 1]);
      if (h < low) { low = h; lowStep = s; }
      else if (s - lowStep >= 6) { end = lowStep; pooled = true; break; }
    }
    const sx = shell.canvas.width / W, sy = shell.canvas.height / W;
    tctx.globalCompositeOperation = "lighter";
    tctx.lineCap = "round";
    tctx.lineWidth = 1.4 * dpr;
    for (let s = 1; s <= end; s++) {
      tctx.strokeStyle = trailColor(path[s * 4 + 3]);
      tctx.beginPath();
      tctx.moveTo(path[(s - 1) * 4] * sx, path[(s - 1) * 4 + 1] * sy);
      tctx.lineTo(path[s * 4] * sx, path[s * 4 + 1] * sy);
      tctx.stroke();
    }
    if (pooled) {
      tctx.fillStyle = "rgba(70, 140, 255, 0.14)";
      tctx.beginPath();
      tctx.arc(path[end * 4] * sx, path[end * 4 + 1] * sy, 3 * dpr, 0, Math.PI * 2);
      tctx.fill();
    }
    tctx.globalCompositeOperation = "source-over";
  };

  const pauseBtn = shell.button("pause rain", () => {
    raining = !raining;
    pauseBtn.textContent = raining ? "pause rain" : "rain";
  });
  shell.button("downpour (500)", () => {
    for (let k = 0; k < 500; k++) traceOne();
    drawBase();
  });
  shell.slider({ label: "inertia", min: 0, max: 0.6, step: 0.01, value: ep.inertia, onInput: (v) => { ep.inertia = v; } });
  shell.button("reset", () => {
    grid = makeErosionGrid(tp, SIZE, W);
    sampler = gridSampler(grid.heights, W, W, 0, 0, 1);
    traced = 0;
    tctx.clearRect(0, 0, trails.width, trails.height);
    drawBase();
  });

  // a short head start, so the drainage is already visible when you arrive
  for (let k = 0; k < 160; k++) traceOne();

  let frame = 0;
  return {
    frame() {
      if (raining) {
        for (let k = 0; k < 3; k++) traceOne();
        // trails fade slowly, so what you see is the drainage of the last few
        // seconds, not a smear of everything ever
        tctx.globalCompositeOperation = "destination-out";
        tctx.fillStyle = "rgba(0, 0, 0, 0.022)";
        tctx.fillRect(0, 0, trails.width, trails.height);
        tctx.globalCompositeOperation = "source-over";
        if (++frame % 30 === 0) drawBase();
      }
      compose();
    },
  };
}

// ---- the storm in three dimensions ---------------------------------------------------

export async function mountErode3D(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createTerrainStage(shell.canvas, GOLDEN, {
    target: [0, 0.4, 0],
    distance: 21,
    minDistance: 6,
    maxDistance: 34,
    elevation: 0.55,
    azimuth: 2.3,
    fov: 40,
    far: 300,
  });

  const W = 256;
  const SIZE = 16;
  const CAP = 200_000; // the storm stops here
  const BUDGET = 2.5; // ms of each frame spent raining
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 23 };
  const ep: ErosionParams = { ...EROSION_DEFAULTS };
  const look = stage.look;
  const meshOpts = { tint: true, water: true, skirt: 1.6, skirtTint: [0.05, 0.04, 0.035, 1] as [number, number, number, number], sun: look.sunDir, reach: 12 };

  let grid: ErosionGrid = makeErosionGrid(tp, SIZE, W);
  let pristine = new Float32Array(grid.heights); // for the before/after toggle
  const terrain = terrainMaterial(look, { amplitude: tp.amplitude, water: true });
  let geometry = buildGridGeometry(grid, meshOpts);
  const mesh = new THREE.Mesh(geometry, terrain.material);
  stage.scene.add(mesh);

  let raining = true;
  let showBefore = false;
  let tint = true;
  let dirty = false;
  let rate = 0; // droplets per second, smoothed

  const refresh = (): void => {
    if (showBefore) updateGridGeometry(geometry, grid, { heights: pristine, tint: false, water: false });
    else updateGridGeometry(geometry, grid, { tint, wetScale: Math.min(1, grid.droplets / 40_000) });
    dirty = false;
  };

  const rainBtn = shell.button("pause rain", () => {
    raining = !raining;
    rainBtn.textContent = raining ? "pause rain" : "rain";
  });
  shell.slider({ label: "capacity", min: 0.5, max: 8, step: 0.1, value: ep.capacity, onInput: (v) => { ep.capacity = v; } });
  shell.slider({ label: "deposition", min: 0.02, max: 0.8, step: 0.01, value: ep.deposition, onInput: (v) => { ep.deposition = v; } });
  shell.slider({ label: "brush radius", min: 1, max: 5, step: 0.25, value: ep.radius, onInput: (v) => { ep.radius = v; } });
  shell.button("before / after", () => {
    showBefore = !showBefore;
    refresh();
  });
  shell.button("sediment paint", () => { tint = !tint; refresh(); });
  shell.button("new terrain", () => {
    tp.seed = (Math.random() * 1e6) | 0;
    grid = makeErosionGrid(tp, SIZE, W);
    pristine = new Float32Array(grid.heights);
    geometry.dispose();
    geometry = buildGridGeometry(grid, meshOpts);
    mesh.geometry = geometry;
    showBefore = false;
    raining = true;
    rainBtn.textContent = "pause rain";
  });
  shell.setInfo(() =>
    showBefore
      ? "showing the terrain before any rain"
      : `${grid.droplets.toLocaleString()} droplets${grid.droplets >= CAP ? " · storm over" : raining ? ` · ${(Math.round(rate / 100) * 100).toLocaleString()} a second` : " · paused"}`,
  );

  let frame = 0;
  let last = performance.now();
  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (raining && !showBefore && grid.droplets < CAP) {
        const n = rainFor(grid, ep, BUDGET, CAP, 99);
        rate += (n / Math.max(dt, 1e-3) - rate) * 0.05;
        relightGrid(geometry, grid, 4);
        dirty = true;
      }
      if (dirty && ++frame % 6 === 0) refresh();
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- hero: the rain falls while you watch --------------------------------------------

const AFTER_RAIN: Mood = {
  ...GOLDEN,
  sunDir: [0.7, 0.24, -0.68],
  sun: [3.0, 2.3, 1.6],
  horizon: [0.25, 0.28, 0.35],
  glow: [1.0, 0.6, 0.32],
};

export async function mountErosionHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createTerrainStage(shell.canvas, AFTER_RAIN, { fov: 50, near: 0.1, far: 1500 });
  const look = stage.look;

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, frequency: 0.04, amplitude: 11, seed: 12, octaves: 7 };
  const ep: ErosionParams = { ...EROSION_DEFAULTS, radius: 2, capacity: 2.2, erosion: 0.35 };
  const W = 289;
  const SIZE = 108; // a cell every 0.375 units
  const STORM = 90_000; // droplets; after this the storm has passed
  const PER_SECOND = 3_000; // so it takes about thirty seconds

  const terrain = terrainMaterial(look, { amplitude: tp.amplitude, water: true, snowLine: [0.66, 0.78] });
  const grid = makeErosionGrid(tp, SIZE, W);
  const vista = buildVista(tp, look.sunDir, terrain.material, [
    { half: 162, step: 1.5 },
    { half: 648, step: 6 },
  ], { core: SIZE / 2, reach: 60 });
  stage.scene.add(vista.group);
  const coreSampler = gridSampler(grid.heights, W, W, -SIZE / 2, -SIZE / 2, grid.cellWorld);
  const geometry = buildGridGeometry(grid, { tint: false, water: true, skirt: 1, taper: 24, sun: look.sunDir, reach: 60, outside: vista.heightAt });
  const core = new THREE.Mesh(geometry, terrain.material);
  core.frustumCulled = false;
  stage.scene.add(core);
  const heightAt = (x: number, z: number): number =>
    Math.abs(x) < SIZE / 2 && Math.abs(z) < SIZE / 2 ? coreSampler(x, z) : vista.heightAt(x, z);

  const R = 22;
  const speed = 0.014;
  let theta = 0.4;
  let last = performance.now();
  let owed = 0;
  let sinceUpdate = 0;
  const alt = new Smooth(3);
  const envelope = (th: number): number => {
    let m = -Infinity;
    for (let k = -3; k <= 6; k++) {
      const a = th + k * 0.06;
      m = Math.max(m, heightAt(Math.cos(a) * R, Math.sin(a) * R));
    }
    return m;
  };

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * speed;

      if (grid.droplets < STORM) {
        owed += PER_SECOND * dt;
        const n = Math.min(STORM - grid.droplets, Math.floor(owed));
        if (n > 0) {
          rain(grid, ep, n, 7);
          owed -= n;
        }
        relightGrid(geometry, grid, 3);
        sinceUpdate += dt;
        if (sinceUpdate > 0.5 || grid.droplets >= STORM) {
          sinceUpdate = 0;
          updateGridGeometry(geometry, grid, { wetScale: Math.min(1, grid.droplets / 30_000) });
        }
      }

      const cx = Math.cos(theta) * R, cz = Math.sin(theta) * R;
      const cy = alt.step(envelope(theta) + 6, dt);
      stage.camera.position.set(cx, cy, cz);
      // look across the circle, down into the valleys the water is cutting
      const la = theta + 1.9;
      stage.camera.lookAt(Math.cos(la) * R * 0.5, cy - 7, Math.sin(la) * R * 0.5);
      stage.draw();
    },
    dispose: () => stage.dispose(),
  };
}
