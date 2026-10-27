// The figures of Ground Truth part 1: octaves stacking in one dimension, the
// warped map in two, the relief standing up in three, and the hero flyover,
// which is the same height function with a camera drifting over it.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";
import { perlin1 } from "../../lib/terrain/noise";
import { terrainHeight, buildTerrainGeometry, TERRAIN_DEFAULTS, type TerrainParams } from "../../lib/terrain/heightmap";
import { createTerrainStage, terrainMaterial, GOLDEN, Smooth } from "../../lib/terrain/look";
import { buildVista } from "../../lib/terrain/vista";
import { reliefRgb } from "./mapColors";

// ---- one dimension: octaves, stacked ----------------------------------------------

export function mountOctaves1D(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;

  let octaves = 5;
  let gain = 0.5;
  let lacunarity = 2;
  let seed = 7;
  let dirty = true;

  const draw = (): void => {
    const w = shell.canvas.width, h = shell.canvas.height;
    const dpr = pixelRatio(shell.canvas);
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, w, h);

    const span = 6; // world units across the canvas
    let norm = 0;
    for (let o = 0; o < octaves; o++) norm += Math.pow(gain, o);

    // top: each octave alone, in its own lane, drawn at its real amplitude
    const laneTop = h * 0.05, laneBottom = h * 0.5;
    const laneH = (laneBottom - laneTop) / octaves;
    const labelW = 64 * dpr;
    const font = Math.round(11 * dpr);
    ctx.font = `${font}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "middle";
    for (let o = 0; o < octaves; o++) {
      const amp = Math.pow(gain, o);
      const freq = Math.pow(lacunarity, o);
      const mid = laneTop + laneH * (o + 0.5);
      ctx.fillStyle = "rgba(150, 168, 210, 0.75)";
      ctx.fillText(`×${freq.toFixed(freq < 10 ? 1 : 0)}  ${amp.toFixed(2)}`, 8 * dpr, mid);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(labelW + 12 * dpr, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();
      ctx.strokeStyle = `rgba(150, 178, 235, ${0.85 - o * 0.06})`;
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      for (let px = labelW + 12 * dpr; px <= w; px += 1.5 * dpr) {
        const x = ((px - labelW) / (w - labelW)) * span;
        const y = mid - perlin1(x * freq, seed + o * 131) * amp * laneH * 0.8;
        px === labelW + 12 * dpr ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
      }
      ctx.stroke();
    }

    // bottom: their sum, as a mountain profile
    const base = h * 0.95, mid = h * 0.74, yScale = h * 0.2;
    const sumAt = (px: number): number => {
      const x = ((px - labelW) / (w - labelW)) * span;
      let s = 0;
      for (let o = 0; o < octaves; o++) s += perlin1(x * Math.pow(lacunarity, o), seed + o * 131) * Math.pow(gain, o);
      return mid - (s / norm) * yScale * 1.6;
    };
    const x0 = labelW + 12 * dpr;
    const grad = ctx.createLinearGradient(0, mid - yScale * 1.6, 0, base);
    grad.addColorStop(0, "rgba(103, 232, 249, 0.38)");
    grad.addColorStop(1, "rgba(103, 232, 249, 0.02)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0, base);
    for (let px = x0; px <= w; px += dpr) ctx.lineTo(px, sumAt(px));
    ctx.lineTo(w, base);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#67e8f9";
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    for (let px = x0; px <= w; px += dpr) (px === x0 ? ctx.moveTo(px, sumAt(px)) : ctx.lineTo(px, sumAt(px)));
    ctx.stroke();
    ctx.fillStyle = "rgba(103, 232, 249, 0.9)";
    ctx.fillText("sum", 8 * dpr, mid);

    shell.readout.textContent = `${octaves} octave${octaves > 1 ? "s" : ""} · each lane is one octave (frequency ×, amplitude) · the filled profile is their sum`;
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

  const RW = 320, RH = 198;
  const off = document.createElement("canvas");
  off.width = RW;
  off.height = RH;
  const octx = off.getContext("2d")!;
  const img = octx.createImageData(RW, RH);
  const hs = new Float32Array(RW * RH);

  const params: TerrainParams = { ...TERRAIN_DEFAULTS };
  let dirty = true;
  const span = 32; // world units across the map
  const cell = span / RW;

  const draw = (): void => {
    const t0 = performance.now();
    for (let j = 0; j < RH; j++) {
      const z = (j / RH - 0.5) * span * (RH / RW); // same world units per pixel on both axes
      for (let i = 0; i < RW; i++) hs[i + j * RW] = terrainHeight((i / RW - 0.5) * span, z, params) / params.amplitude;
    }
    const data = img.data;
    for (let j = 0; j < RH; j++) {
      for (let i = 0; i < RW; i++) {
        const q = i + j * RW;
        const [r, g, b] = reliefRgb(hs, RW, RH, i, j, cell / params.amplitude);
        data[q * 4] = r; data[q * 4 + 1] = g; data[q * 4 + 2] = b; data[q * 4 + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, shell.canvas.width, shell.canvas.height);
    shell.readout.textContent = `brighter = higher, lit from the upper left · ${RW * RH / 1000 | 0}k samples in ${(performance.now() - t0).toFixed(0)} ms`;
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
  const stage = await createTerrainStage(shell.canvas, GOLDEN, {
    target: [0, 0.6, 0],
    distance: 21,
    minDistance: 6,
    maxDistance: 34,
    elevation: 0.5,
    azimuth: 2.3,
    fov: 40,
    far: 300,
  });

  const params: TerrainParams = { ...TERRAIN_DEFAULTS };
  const terrain = terrainMaterial(stage.look, { amplitude: params.amplitude });
  let mesh: THREE.Mesh | null = null;
  let stats = "";
  let timer = 0;

  const rebuild = (): void => {
    terrain.amplitude.value = params.amplitude;
    const built = buildTerrainGeometry(params, { size: 16, segments: 200, skirt: 1.6, skirtTint: [0.05, 0.04, 0.035, 1], light: { sun: stage.look.sunDir, reach: 12 } });
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = built.geometry;
    } else {
      mesh = new THREE.Mesh(built.geometry, terrain.material);
      stage.scene.add(mesh);
    }
    const tris = (200 * 200 * 2).toLocaleString();
    stats = `${(201 * 201).toLocaleString()} verts · ${tris} tris · built and lit in ${built.buildMs.toFixed(0)} ms`;
  };
  rebuild();

  const queueRebuild = (): void => {
    stats = "building…";
    clearTimeout(timer);
    timer = window.setTimeout(rebuild, 160);
  };

  shell.slider({ label: "octaves", min: 1, max: 8, step: 1, value: params.octaves, onInput: (v) => { params.octaves = v; queueRebuild(); } });
  shell.slider({ label: "ridge", min: 0, max: 1, step: 0.02, value: params.ridge, onInput: (v) => { params.ridge = v; queueRebuild(); } });
  shell.slider({ label: "warp", min: 0, max: 2, step: 0.05, value: params.warp, onInput: (v) => { params.warp = v; queueRebuild(); } });
  shell.slider({ label: "height", min: 0.5, max: 6, step: 0.1, value: params.amplitude, onInput: (v) => { params.amplitude = v; queueRebuild(); } });
  shell.button("wireframe", () => { terrain.material.wireframe = !terrain.material.wireframe; });
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
  const stage = await createTerrainStage(shell.canvas, GOLDEN, { fov: 50, near: 0.1, far: 1200 });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, frequency: 0.035, amplitude: 15, ridge: 0.65, seed: 12, octaves: 7 };
  const terrain = terrainMaterial(stage.look, { amplitude: tp.amplitude, snowLine: [0.64, 0.76] });
    const vista = buildVista(tp, stage.look.sunDir, terrain.material, [
    { half: 36, step: 0.25 },
    { half: 108, step: 0.75 },
    { half: 540, step: 4.5 },
  ], { reach: 60 });
  stage.scene.add(vista.group);

  // a slow circle; altitude follows the ground ahead and behind, heavily
  // smoothed, so the camera never bobs over a single bump
  const R = 15;
  const speed = 0.012; // radians per second: a lap every nine minutes
  let theta = 2.2;
  let last = performance.now();
  const alt = new Smooth(3);
  const lookY = new Smooth(3);
  const groundEnvelope = (th: number): number => {
    let m = -Infinity;
    for (let k = -3; k <= 6; k++) {
      const a = th + k * 0.06;
      m = Math.max(m, vista.heightAt(Math.cos(a) * R, Math.sin(a) * R));
    }
    return m;
  };

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * speed;

      const cx = Math.cos(theta) * R, cz = Math.sin(theta) * R;
      const cy = alt.step(groundEnvelope(theta) + 4.5, dt);
      stage.camera.position.set(cx, cy, cz);

      // look along the path, a little outward, toward the far ranges
      const la = theta + 0.5;
      const lx = Math.cos(la) * R * 1.9, lz = Math.sin(la) * R * 1.9;
      stage.camera.lookAt(lx, lookY.step(cy - 3.2, dt), lz);
      stage.draw();
    },
    dispose: () => stage.dispose(),
  };
}
