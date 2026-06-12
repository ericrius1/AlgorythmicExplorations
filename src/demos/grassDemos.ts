// The figures of Ground Truth part 3: one blade bending in two dimensions,
// the planted meadow with its wind dials, and a hero camera down in the
// grass while the gusts come through.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D } from "../lib/stage3d";
import { TERRAIN_DEFAULTS, type TerrainParams } from "../lib/terrain/heightmap";
import { EROSION_DEFAULTS, makeErosionGrid, rain, buildGridGeometry, type ErosionGrid } from "../lib/terrain/erosion";
import { scatterOnGrid, buildGrassGeometry, makeGrassMaterial, sampleGrid } from "../lib/terrain/grass";

const MORNING_STAGE = {
  skyTop: [0.09, 0.13, 0.22] as [number, number, number],
  skyBottom: [0.23, 0.21, 0.22] as [number, number, number],
  hemi: { sky: 0xa8c0e0, ground: 0x46503a, intensity: 0.9 },
  key: { color: 0xfff0c8, intensity: 2.2, position: [5, 6, 2] as [number, number, number] },
  rim: { color: 0x88a8e8, intensity: 0.45, position: [-5, 3, -4] as [number, number, number] },
};

// ---- one blade, sideways -------------------------------------------------------------

export function mountBladeAnatomy(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const ctx = shell.canvas.getContext("2d")!;

  let segments = 3;
  let lean = 0.5;
  let windOn = true;

  const draw = (t: number): void => {
    const w = shell.canvas.width, h = shell.canvas.height;
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, w, h);

    const rootX = w * 0.5, rootY = h * 0.88;
    const H = h * 0.72;
    const sway = windOn ? (Math.sin(t * 1.7) * 0.7 + Math.sin(t * 3.4) * 0.3) * 0.5 + 0.3 : 0;
    const bend = lean + sway;

    // the true curve, ghosted — what the blade "wants" to be
    ctx.strokeStyle = "rgba(150, 168, 210, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      const x = rootX + bend * u * u * H * 0.55;
      const y = rootY - u * H * (1 - bend * bend * u * u * 0.18);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // the blade the GPU actually draws: straight runs between joints
    const px: number[] = [], py: number[] = [];
    for (let r = 0; r <= segments; r++) {
      const u = r / segments;
      px.push(rootX + bend * u * u * H * 0.55);
      py.push(rootY - u * H * (1 - bend * bend * u * u * 0.18));
    }
    ctx.strokeStyle = "#8ddf7a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let r = 0; r <= segments; r++) (r === 0 ? ctx.moveTo(px[r], py[r]) : ctx.lineTo(px[r], py[r]));
    ctx.stroke();

    ctx.fillStyle = "#e9eef4";
    for (let r = 0; r <= segments; r++) {
      ctx.beginPath();
      ctx.arc(px[r], py[r], 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // t² annotation: equal steps up the blade, unequal steps sideways
    ctx.fillStyle = "rgba(150, 168, 210, 0.8)";
    ctx.font = `${Math.round(h * 0.034)}px ui-monospace, monospace`;
    ctx.fillText("bend ∝ t²  — stiff at the root, loose at the tip", w * 0.05, h * 0.12);

    shell.readout.textContent = `${segments} segments = ${segments * 2 + 1} vertices per blade · ghost line is the ideal curve`;
  };

  shell.slider({ label: "segments", min: 1, max: 8, step: 1, value: segments, onInput: (v) => { segments = v; } });
  shell.slider({ label: "lean", min: 0, max: 1, step: 0.02, value: lean, onInput: (v) => { lean = v; } });
  shell.button("wind on/off", () => { windOn = !windOn; });

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
  const stage = await createStage3D(shell.canvas, {
    ...MORNING_STAGE,
    target: [0, 1.4, 0],
    distance: 7,
    minDistance: 2,
    maxDistance: 24,
    elevation: 0.3,
    azimuth: 0.7,
    fov: 45,
    far: 200,
  });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 31, amplitude: 2.6 };
  let grid = erodedPatch(tp, 16, 220, 25_000);

  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const ground = new THREE.Mesh(buildGridGeometry(grid, tp.amplitude), groundMat);
  stage.scene.add(ground);

  const grassMat = makeGrassMaterial();
  let grass: THREE.Mesh | null = null;
  let candidates = 120_000;
  let planted = 0, verts = 0;
  let timer = 0;

  const replant = (): void => {
    const blades = scatterOnGrid(grid, tp.amplitude, { count: candidates, seed: tp.seed + 13 });
    const built = buildGrassGeometry(blades);
    planted = built.bladeCount;
    verts = built.vertexCount;
    if (grass) {
      grass.geometry.dispose();
      grass.geometry = built.geometry;
    } else {
      grass = new THREE.Mesh(built.geometry, grassMat.material);
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
    max: 250_000,
    step: 5_000,
    value: candidates,
    log: true,
    format: (v) => `${Math.round(v / 1000)}k`,
    onInput: (v) => { candidates = Math.round(v); queueReplant(); },
  });
  shell.slider({ label: "wind", min: 0, max: 1.4, step: 0.02, value: grassMat.strength.value, onInput: (v) => { grassMat.strength.value = v; } });
  shell.slider({ label: "gust size", min: 0.15, max: 2, step: 0.05, value: grassMat.gustScale.value, format: (v) => `${(1 / v).toFixed(1)} u`, onInput: (v) => { grassMat.gustScale.value = v; } });
  shell.button("reroll", () => {
    tp.seed = (Math.random() * 1e6) | 0;
    grid = erodedPatch(tp, 16, 220, 25_000);
    ground.geometry.dispose();
    ground.geometry = buildGridGeometry(grid, tp.amplitude);
    replant();
  });
  shell.setInfo(() => `${planted.toLocaleString()} blades · ${verts.toLocaleString()} grass verts`);

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
  const stage = await createStage3D(shell.canvas, {
    ...MORNING_STAGE,
    fog: { color: 0x151a24, near: 10, far: 55 },
    fov: 55,
    far: 200,
  });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 31, amplitude: 3.2, frequency: 0.06 };
  const grid = erodedPatch(tp, 56, 280, 50_000);
  stage.scene.add(new THREE.Mesh(buildGridGeometry(grid, tp.amplitude), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));

  const grassMat = makeGrassMaterial();
  grassMat.strength.value = 0.65;
  const blades = scatterOnGrid(grid, tp.amplitude, { count: 320_000, seed: 77 });
  stage.scene.add(new THREE.Mesh(buildGrassGeometry(blades).geometry, grassMat.material));

  let theta = 0;
  let camY = 4;
  let last = performance.now();
  const R = 9;

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * 0.03;
      grassMat.time.value = (now / 1000) % 10000;

      const cx = Math.cos(theta) * R;
      const cz = Math.sin(theta) * R;
      camY += (sampleGrid(grid, cx, cz).h + 1.0 - camY) * Math.min(1, dt * 2);
      stage.camera.position.set(cx, camY, cz);

      const la = theta + 0.6;
      const lx = Math.cos(la) * R * 1.4;
      const lz = Math.sin(la) * R * 1.4;
      stage.camera.lookAt(lx, sampleGrid(grid, lx, lz).h + 0.7, lz);

      stage.renderer.render(stage.scene, stage.camera);
    },
    dispose: () => stage.dispose(),
  };
}
