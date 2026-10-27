// The figures of Ground Truth part 3: one blade bending in two dimensions,
// the planted meadow with its wind dials, and a hero camera down in the
// grass, looking into a low sun while the gusts come through.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";
import { TERRAIN_DEFAULTS, type TerrainParams } from "../../lib/terrain/heightmap";
import { EROSION_DEFAULTS, makeErosionGrid, rain, buildGridGeometry, type ErosionGrid } from "../../lib/terrain/erosion";
import { scatterOnGrid, buildGrassGeometry, makeGrassMaterial, sampleGrid, grassGroundTint } from "../../lib/terrain/grass";
import { gridSampler } from "../../lib/terrain/light";
import { createTerrainStage, terrainMaterial, GOLDEN, Smooth } from "../../lib/terrain/look";
import { buildVista } from "../../lib/terrain/vista";

// ---- one blade, sideways -------------------------------------------------------------

export function mountBladeAnatomy(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const ctx = shell.canvas.getContext("2d")!;

  let segments = 3;
  let lean = 0.5;
  let windOn = true;

  // the blade in world units, as grass.ts builds it: 0.26 tall, 0.024 wide
  const HEIGHT = 0.26, WIDTH = 0.024, FLEX = 1.25, STRENGTH = 0.5;

  // centreline at fraction t up the blade, in world units (x sideways, y up)
  const centre = (t: number, gust: number): [number, number] => {
    const sway = windOn ? (gust * 0.5 + 0.62) * STRENGTH * t * t * FLEX * HEIGHT : 0;
    const x = lean * t * t * HEIGHT + sway;
    const y = t * HEIGHT - lean * lean * t * t * 0.3 * HEIGHT - 0.45 * sway * sway;
    return [x, y];
  };

  const draw = (time: number): void => {
    const w = shell.canvas.width, h = shell.canvas.height;
    const dpr = pixelRatio(shell.canvas);
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, w, h);

    const scale = (h * 0.78) / HEIGHT; // px per world unit
    const rootX = w * 0.42, rootY = h * 0.9;
    const gust = Math.sin(time * 1.7) * 0.7 + Math.sin(time * 3.4 + 1.3) * 0.3;
    const toPx = ([x, y]: [number, number]): [number, number] => [rootX + x * scale, rootY - y * scale];

    // ground line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(w * 0.08, rootY);
    ctx.lineTo(w * 0.92, rootY);
    ctx.stroke();

    // the ideal curve, ghosted
    ctx.strokeStyle = "rgba(150, 168, 210, 0.45)";
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const [x, y] = toPx(centre(i / 60, gust));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // the ribbon the GPU draws: a pair of vertices per row, one at the tip
    const left: [number, number][] = [], right: [number, number][] = [];
    for (let r = 0; r <= segments; r++) {
      const t = r / segments;
      const c = centre(t, gust);
      const halfW = (WIDTH * (1 - t * 0.85)) / 2;
      // widen the drawing 3× so the triangles are visible at this scale
      left.push(toPx([c[0] - halfW * 3, c[1]]));
      right.push(toPx([c[0] + halfW * 3, c[1]]));
    }
    const tip = toPx(centre(1, gust));
    const grad = ctx.createLinearGradient(0, rootY, 0, tip[1]);
    grad.addColorStop(0, "#2f4a1c");
    grad.addColorStop(1, "#9fd067");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let r = 1; r < segments; r++) ctx.lineTo(left[r][0], left[r][1]);
    ctx.lineTo(tip[0], tip[1]);
    for (let r = segments - 1; r >= 0; r--) ctx.lineTo(right[r][0], right[r][1]);
    ctx.closePath();
    ctx.fill();

    // triangle edges
    ctx.strokeStyle = "rgba(233, 238, 244, 0.35)";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let r = 0; r < segments - 1; r++) {
      ctx.moveTo(left[r][0], left[r][1]); ctx.lineTo(right[r][0], right[r][1]);
      ctx.lineTo(left[r + 1][0], left[r + 1][1]); ctx.lineTo(left[r][0], left[r][1]);
      ctx.moveTo(right[r][0], right[r][1]); ctx.lineTo(right[r + 1][0], right[r + 1][1]);
      ctx.lineTo(left[r + 1][0], left[r + 1][1]);
    }
    const lr = segments - 1;
    ctx.moveTo(left[lr][0], left[lr][1]); ctx.lineTo(right[lr][0], right[lr][1]);
    ctx.lineTo(tip[0], tip[1]); ctx.lineTo(left[lr][0], left[lr][1]);
    ctx.stroke();

    // the vertices
    ctx.fillStyle = "#e9eef4";
    const dots = [...left.slice(0, segments), ...right.slice(0, segments), tip];
    for (const [x, y] of dots) {
      ctx.beginPath();
      ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // labels
    ctx.font = `${Math.round(12 * dpr)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = "rgba(150, 168, 210, 0.85)";
    ctx.textBaseline = "top";
    // narrow canvases (phones) get the short form of each label
    const narrow = ctx.measureText("sideways bend ∝ t²: stiff at the root, loose at the tip").width > shell.canvas.width - 28 * dpr;
    const tipPct = (centre(1, gust)[1] / HEIGHT * 100).toFixed(0);
    ctx.fillText(narrow ? "bend ∝ t²: stiff root, loose tip" : "sideways bend ∝ t²: stiff at the root, loose at the tip", 14 * dpr, 12 * dpr);
    ctx.fillText(narrow ? `tip height ${tipPct}% of length` : `tip height ${tipPct}% of the blade's length`, 14 * dpr, 32 * dpr);

    const verts = segments * 2 + 1, tris = segments * 2 - 1;
    shell.readout.textContent = `${segments} segment${segments > 1 ? "s" : ""} = ${verts} vertices, ${tris} triangle${tris > 1 ? "s" : ""} · dashed line is the ideal curve · width drawn 3× for clarity`;
  };

  shell.slider({ label: "segments", min: 1, max: 8, step: 1, value: segments, onInput: (v) => { segments = v; } });
  shell.slider({ label: "lean", min: 0, max: 1, step: 0.02, value: lean, onInput: (v) => { lean = v; } });
  const windBtn = shell.button("wind off", () => {
    windOn = !windOn;
    windBtn.textContent = windOn ? "wind off" : "wind on";
  });

  return {
    frame() {
      draw(performance.now() / 1000);
    },
  };
}

// ---- the meadow ------------------------------------------------------------------------

function erodedPatch(tp: TerrainParams, size: number, W: number, droplets: number): ErosionGrid {
  const grid = makeErosionGrid(tp, size, W);
  rain(grid, { ...EROSION_DEFAULTS, radius: 2 }, droplets, tp.seed + 5);
  return grid;
}

export async function mountMeadow(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createTerrainStage(shell.canvas, GOLDEN, {
    target: [0, 0.6, 0],
    distance: 13,
    minDistance: 2,
    maxDistance: 30,
    elevation: 0.42,
    azimuth: 2.1,
    fov: 42,
    far: 300,
  });
  const look = stage.look;

  const SIZE = 16, W = 220, DROPS = 25_000;
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 31, amplitude: 2.6 };
  let grid = erodedPatch(tp, SIZE, W, DROPS);

  const ground = terrainMaterial(look, { amplitude: tp.amplitude });
  const groundMesh = (): THREE.BufferGeometry =>
    buildGridGeometry(grid, {
      skirt: 1.2,
      skirtTint: [0.05, 0.04, 0.035, 1],
      sun: look.sunDir,
      reach: 10,
      groundTint: grassGroundTint(grid, tp.amplitude),
    });
  const groundM = new THREE.Mesh(groundMesh(), ground.material);
  stage.scene.add(groundM);

  const grassMat = makeGrassMaterial(look);
  let grass: THREE.Mesh | null = null;
  let candidates = 150_000;
  let planted = 0, verts = 0;
  let timer = 0;

  const replant = (): void => {
    const light = groundM.geometry.userData.state.light as Float32Array;
    const sun = gridSampler(light.filter((_, i) => i % 2 === 0), W, W, -SIZE / 2, -SIZE / 2, SIZE / (W - 1));
    const blades = scatterOnGrid(grid, tp.amplitude, { count: candidates, seed: tp.seed + 13, sun });
    const built = buildGrassGeometry(blades);
    planted = built.bladeCount;
    verts = built.vertexCount;
    if (grass) {
      grass.geometry.dispose();
      grass.geometry = built.geometry;
    } else {
      grass = new THREE.Mesh(built.geometry, grassMat.material);
      grass.frustumCulled = false;
      stage.scene.add(grass);
    }
  };
  replant();

  const queueReplant = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(replant, 250);
  };

  shell.slider({
    label: "candidates",
    min: 5_000,
    max: 400_000,
    step: 5_000,
    value: candidates,
    log: true,
    format: (v) => `${Math.round(v / 1000)}k`,
    onInput: (v) => { candidates = Math.round(v); queueReplant(); },
  });
  shell.slider({ label: "wind", min: 0, max: 1.4, step: 0.02, value: grassMat.strength.value, onInput: (v) => { grassMat.strength.value = v; } });
  shell.slider({ label: "gust size", min: 0.15, max: 2, step: 0.05, value: grassMat.gustScale.value, format: (v) => `${(1 / v).toFixed(1)} u`, onInput: (v) => { grassMat.gustScale.value = v; } });
  shell.button("new ground", () => {
    tp.seed = (Math.random() * 1e6) | 0;
    grid = erodedPatch(tp, SIZE, W, DROPS);
    groundM.geometry.dispose();
    groundM.geometry = groundMesh();
    replant();
  });
  shell.setInfo(() => `${planted.toLocaleString()} blades · ${verts.toLocaleString()} grass vertices · one draw call`);

  return {
    frame() {
      grassMat.time.value = (performance.now() / 1000) % 10000;
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- hero: down in the grass ------------------------------------------------------------

export async function mountGrassHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createTerrainStage(shell.canvas, GOLDEN, { orbit: false, fov: 48, near: 0.05, far: 1500 });
  const look = stage.look;

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 31, amplitude: 7, frequency: 0.045, octaves: 7 };
  const SIZE = 64, W = 257; // a cell every 0.25 units
  const grid = erodedPatch(tp, SIZE, W, 45_000);

  const terrain = terrainMaterial(look, { amplitude: tp.amplitude });
  const vista = buildVista(tp, look.sunDir, terrain.material, [
    { half: 128, step: 1 },
    { half: 640, step: 5 },
  ], { core: SIZE / 2, reach: 60 });
  stage.scene.add(vista.group);
  const coreGeometry = buildGridGeometry(grid, {
    skirt: 0.6,
    taper: 20,
    sun: look.sunDir,
    reach: 60,
    outside: vista.heightAt,
    groundTint: grassGroundTint(grid, tp.amplitude, {}, 0.9),
  });
  const core = new THREE.Mesh(coreGeometry, terrain.material);
  core.frustumCulled = false;
  stage.scene.add(core);

  // pick a standing spot: flat, on rain-laid soil, in sunlight, away from the
  // edges, with the ground ahead (toward the sun) staying low
  const light = coreGeometry.userData.state.light as Float32Array;
  const sunAt = gridSampler(light.filter((_, i) => i % 2 === 0), W, W, -SIZE / 2, -SIZE / 2, SIZE / (W - 1));
  const sunH = new THREE.Vector2(look.sunDir.x, look.sunDir.z).normalize();
  // the camera looks a little to the right of the sun
  const heading = Math.atan2(sunH.y, sunH.x) + 0.4;
  const fx = Math.cos(heading), fz = Math.sin(heading);
  let best = { x: 0, z: 0, score: -Infinity };
  const inCore = (x: number, z: number): boolean => Math.abs(x) < SIZE / 2 - 3 && Math.abs(z) < SIZE / 2 - 3;
  for (let j = -24; j <= 24; j += 1) {
    for (let i = -24; i <= 24; i += 1) {
      // the meadow ahead has to stay on the eroded patch, where the grass is
      if (!inCore(i - fx * 3, j - fz * 3) || !inCore(i + fx * 22, j + fz * 22)) continue;
      const g = sampleGrid(grid, i, j);
      if (g.h / tp.amplitude > 0.5) continue; // grass thins out above this
      // how far the ground ahead rises above a line just under eye level
      let rise = 0, rough = 0;
      for (let k = -2; k <= 16; k++) {
        const d = k * 1.5;
        const a = sampleGrid(grid, i + fx * d, j + fz * d);
        if (k > 0) rise = Math.max(rise, a.h - g.h - 0.2 - d * 0.03);
        rough += a.slope;
      }
      const score = -rise * 12 - g.slope * 3 + Math.min(0.3, g.delta) * 4 + sunAt(i, j) * 2 - rough * 0.1 - (g.h / tp.amplitude) * 3;
      if (score > best.score) best = { x: i, z: j, score };
    }
  }
  const camX = best.x, camZ = best.z;

  // blades, thickest around the camera and thinning with distance
  const grassMat = makeGrassMaterial(look);
  grassMat.strength.value = 0.6;
  grassMat.gustScale.value = 0.45;
  const blades = scatterOnGrid(grid, tp.amplitude, {
    count: 340_000,
    seed: 77,
    scale: 1.7,
    sun: sunAt,
    candidate: (_k, u, v) => {
      const r = 0.3 + 26 * Math.pow(u, 1.7);
      const a = v * Math.PI * 2;
      return [camX + Math.cos(a) * r, camZ + Math.sin(a) * r];
    },
  });
  const grass = new THREE.Mesh(buildGrassGeometry(blades).geometry, grassMat.material);
  grass.frustumCulled = false;
  stage.scene.add(grass);

  const ground = sampleGrid(grid, camX, camZ).h;
  let t = 0;
  let last = performance.now();
  const lookY = new Smooth(2);

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      grassMat.time.value = (now / 1000) % 10000;

      // a slow look around, swinging either side of the sun, with a little drift
      const yaw = heading + Math.sin(t * 0.075) * 0.35;
      const drift = Math.sin(t * 0.05) * 0.8;
      const px = camX - Math.cos(heading) * (1.5 + drift), pz = camZ - Math.sin(heading) * (1.5 + drift);
      const py = Math.max(ground, sampleGrid(grid, px, pz).h) + 0.62;
      stage.camera.position.set(px, py, pz);
      const tx = px + Math.cos(yaw) * 20, tz = pz + Math.sin(yaw) * 20;
      stage.camera.lookAt(tx, lookY.step(py - 0.9, dt), tz);
      stage.draw();
    },
    dispose: () => stage.dispose(),
  };
}
