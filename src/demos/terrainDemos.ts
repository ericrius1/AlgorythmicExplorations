// The figures of Ground Truth part 1: octaves stacking in one dimension, the
// warped map in two, the relief standing up in three — and the hero flyover,
// which is the same height function with a camera drifting over it.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D } from "../lib/stage3d";
import { perlin1 } from "../lib/terrain/noise";
import { terrainHeight, buildTerrainGeometry, TERRAIN_DEFAULTS, type TerrainParams } from "../lib/terrain/heightmap";

const DUSK_STAGE = {
  skyTop: [0.07, 0.09, 0.16] as [number, number, number],
  skyBottom: [0.21, 0.17, 0.20] as [number, number, number],
  hemi: { sky: 0x8fa8cc, ground: 0x4a4238, intensity: 0.7 },
  key: { color: 0xffd9b0, intensity: 2.0, position: [6, 4, 3] as [number, number, number] },
  rim: { color: 0x7d96d6, intensity: 0.5, position: [-5, 3, -4] as [number, number, number] },
};

// ---- one dimension: octaves, stacked ----------------------------------------------

export function mountOctaves1D(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.52);
  const ctx = shell.canvas.getContext("2d")!;

  let octaves = 4;
  let gain = 0.5;
  let lacunarity = 2;
  let seed = 7;
  let dirty = true;

  const draw = (): void => {
    const w = shell.canvas.width, h = shell.canvas.height;
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, w, h);

    const mid = h * 0.5;
    const span = 6; // world units across the canvas
    const baseFreq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) norm += Math.pow(gain, o);
    const yScale = h * 0.36;

    // each octave alone, faint
    for (let o = 0; o < octaves; o++) {
      const amp = Math.pow(gain, o) / norm;
      const freq = baseFreq * Math.pow(lacunarity, o);
      ctx.strokeStyle = `rgba(150, 168, 210, ${0.4 - o * 0.03})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 2) {
        const x = (px / w) * span;
        const y = mid - perlin1(x * freq, seed + o * 131) * amp * yScale;
        px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
      }
      ctx.stroke();
    }

    // the sum, bold
    ctx.strokeStyle = "#67e8f9";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let px = 0; px <= w; px += 1) {
      const x = (px / w) * span;
      let sum = 0;
      for (let o = 0; o < octaves; o++) {
        sum += perlin1(x * baseFreq * Math.pow(lacunarity, o), seed + o * 131) * Math.pow(gain, o);
      }
      const y = mid - (sum / norm) * yScale;
      px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    ctx.stroke();

    shell.readout.textContent = `${octaves} octave${octaves > 1 ? "s" : ""} · faint lines are each octave alone, the cyan line is their sum`;
  };

  shell.slider({ label: "octaves", min: 1, max: 8, step: 1, value: octaves, onInput: (v) => { octaves = v; dirty = true; } });
  shell.slider({ label: "persistence", min: 0.2, max: 0.85, step: 0.01, value: gain, onInput: (v) => { gain = v; dirty = true; } });
  shell.slider({ label: "lacunarity", min: 1.4, max: 3.4, step: 0.05, value: lacunarity, onInput: (v) => { lacunarity = v; dirty = true; } });
  shell.button("reroll", () => { seed = (Math.random() * 1e6) | 0; dirty = true; });

  return {
    frame() {
      if (dirty) {
        dirty = false;
        draw();
      }
    },
  };
}

// ---- two dimensions: the warped, ridged map ----------------------------------------

export function mountMap2D(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;

  const RW = 288, RH = 180;
  const off = document.createElement("canvas");
  off.width = RW;
  off.height = RH;
  const octx = off.getContext("2d")!;
  const img = octx.createImageData(RW, RH);

  const params: TerrainParams = { ...TERRAIN_DEFAULTS };
  let dirty = true;

  const draw = (): void => {
    const data = img.data;
    const span = 32; // world units across the map
    let p = 0;
    for (let j = 0; j < RH; j++) {
      const z = (j / RH - 0.5) * span * (RH / RW); // same world units per pixel on both axes
      for (let i = 0; i < RW; i++) {
        const x = (i / RW - 0.5) * span;
        const h = terrainHeight(x, z, params) / params.amplitude;
        const g = Math.max(0, Math.min(255, h * 255));
        data[p++] = g; data[p++] = g; data[p++] = g; data[p++] = 255;
      }
    }
    octx.putImageData(img, 0, 0);

    const cw = shell.canvas.width, ch = shell.canvas.height;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, cw, ch);
    shell.readout.textContent = `white = high · ridge ${params.ridge.toFixed(2)} · warp ${params.warp.toFixed(2)}`;
  };

  shell.slider({ label: "octaves", min: 1, max: 8, step: 1, value: params.octaves, onInput: (v) => { params.octaves = v; dirty = true; } });
  shell.slider({ label: "ridge", min: 0, max: 1, step: 0.02, value: params.ridge, onInput: (v) => { params.ridge = v; dirty = true; } });
  shell.slider({ label: "warp", min: 0, max: 2, step: 0.05, value: params.warp, onInput: (v) => { params.warp = v; dirty = true; } });
  shell.button("reroll", () => { params.seed = (Math.random() * 1e6) | 0; dirty = true; });

  return {
    frame() {
      if (dirty) {
        dirty = false;
        draw();
      }
    },
  };
}

// ---- three dimensions: the relief ---------------------------------------------------

export async function mountRelief(container: HTMLElement): Promise<Demo> {
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

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const params: TerrainParams = { ...TERRAIN_DEFAULTS };
  let mesh: THREE.Mesh | null = null;
  let stats = "";
  let timer = 0;

  const rebuild = (): void => {
    const built = buildTerrainGeometry(params, { size: 16, segments: 200 });
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = built.geometry;
    } else {
      mesh = new THREE.Mesh(built.geometry, material);
      stage.scene.add(mesh);
    }
    stats = `${built.vertexCount.toLocaleString()} verts · ${built.triangleCount.toLocaleString()} tris · built in ${built.buildMs.toFixed(0)} ms`;
  };
  rebuild();

  const queueRebuild = (): void => {
    stats = "building…";
    clearTimeout(timer);
    timer = window.setTimeout(rebuild, 200);
  };

  shell.slider({ label: "octaves", min: 1, max: 8, step: 1, value: params.octaves, onInput: (v) => { params.octaves = v; queueRebuild(); } });
  shell.slider({ label: "ridge", min: 0, max: 1, step: 0.02, value: params.ridge, onInput: (v) => { params.ridge = v; queueRebuild(); } });
  shell.slider({ label: "warp", min: 0, max: 2, step: 0.05, value: params.warp, onInput: (v) => { params.warp = v; queueRebuild(); } });
  shell.slider({ label: "height", min: 0.5, max: 6, step: 0.1, value: params.amplitude, onInput: (v) => { params.amplitude = v; queueRebuild(); } });
  shell.button("wireframe", () => { material.wireframe = !material.wireframe; });
  shell.button("reroll", () => { params.seed = (Math.random() * 1e6) | 0; queueRebuild(); });
  shell.setInfo(() => stats);

  return {
    frame() {
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the hero: a camera drifting over a big build of the same function --------------

export async function mountTerrainHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createStage3D(shell.canvas, {
    ...DUSK_STAGE,
    fog: { color: 0x131722, near: 18, far: 78 },
    fov: 55,
    far: 300,
  });

  const params: TerrainParams = { ...TERRAIN_DEFAULTS, frequency: 0.055, amplitude: 7, seed: 12 };
  const built = buildTerrainGeometry(params, { size: 110, segments: 384 });
  const mesh = new THREE.Mesh(built.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  stage.scene.add(mesh);

  let theta = 0;
  let camY = 12;
  let last = performance.now();
  const R = 26;

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * 0.022;

      const cx = Math.cos(theta) * R;
      const cz = Math.sin(theta) * R;
      const groundY = terrainHeight(cx, cz, params);
      camY += (Math.max(groundY + 3.2, 6.5) - camY) * Math.min(1, dt * 1.5);
      stage.camera.position.set(cx, camY, cz);

      const la = theta + 0.55;
      const lx = Math.cos(la) * R * 0.7;
      const lz = Math.sin(la) * R * 0.7;
      stage.camera.lookAt(lx, terrainHeight(lx, lz, params) + 1.2, lz);

      stage.renderer.render(stage.scene, stage.camera);
    },
    dispose: () => stage.dispose(),
  };
}
