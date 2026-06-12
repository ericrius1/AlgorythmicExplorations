// The figures of Ground Truth part 6: the chunk ring seen from above (the
// world as a moving window), the infinite flight where you steer with a
// drag, and a hero that just keeps going.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { createStage3D } from "../../lib/stage3d";
import { TERRAIN_DEFAULTS, type TerrainParams } from "../../lib/terrain/heightmap";
import { SCATTER_DEFAULTS, type ScatterParams } from "../../lib/terrain/scatter";
import { ChunkWorld } from "../../lib/terrain/chunks";

const MORNING_STAGE = {
  skyTop: [0.09, 0.13, 0.22] as [number, number, number],
  skyBottom: [0.23, 0.21, 0.22] as [number, number, number],
  hemi: { sky: 0xa8c0e0, ground: 0x46503a, intensity: 0.9 },
  key: { color: 0xfff0c8, intensity: 2.2, position: [5, 6, 2] as [number, number, number] },
  rim: { color: 0x88a8e8, intensity: 0.45, position: [-5, 3, -4] as [number, number, number] },
};

// ---- the ring from above ------------------------------------------------------------------

interface DiagramChunk { ci: number; cj: number; lod: number; flash: number }

export function mountChunkDiagram(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;

  let ring = 4;
  let speed = 1.6; // chunks per second of camera motion
  let camX = 0, camZ = 0;
  let t = 0;
  const chunks = new Map<string, DiagramChunk>();
  let builtThisFrame = 0;

  const lodOf = (r: number): number => (r <= 1 ? 2 : r <= 3 ? 1 : 0);
  const LOD_COLORS = ["rgba(214, 116, 100, 0.8)", "rgba(222, 178, 97, 0.85)", "rgba(103, 232, 249, 0.9)"];

  const step = (dt: number): void => {
    t += dt;
    // a wandering flight path: forward plus a slow sinusoidal heading
    const heading = Math.sin(t * 0.21) * 1.2;
    camX += Math.cos(heading) * speed * dt;
    camZ += Math.sin(heading) * speed * dt;

    const cci = Math.floor(camX), ccj = Math.floor(camZ);

    for (const [key, ch] of chunks) {
      if (Math.max(Math.abs(ch.ci - cci), Math.abs(ch.cj - ccj)) > ring + 1) chunks.delete(key);
    }

    // the build queue: nearest first, two chunks per frame — slow enough
    // that you can watch the wavefront chase the camera
    const wanted: { ci: number; cj: number; r: number }[] = [];
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        wanted.push({ ci: cci + di, cj: ccj + dj, r: Math.max(Math.abs(di), Math.abs(dj)) });
      }
    }
    wanted.sort((a, b) => a.r - b.r);
    builtThisFrame = 0;
    for (const w of wanted) {
      if (builtThisFrame >= 2) break;
      const key = `${w.ci},${w.cj}`;
      const want = lodOf(w.r);
      const ch = chunks.get(key);
      if (!ch) {
        chunks.set(key, { ci: w.ci, cj: w.cj, lod: want, flash: 1 });
        builtThisFrame++;
      } else if (ch.lod !== want) {
        ch.lod = want;
        ch.flash = 1;
        builtThisFrame++;
      }
    }
  };

  const draw = (): void => {
    const w = shell.canvas.width, h = shell.canvas.height;
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, w, h);

    const px = h / (2 * ring + 4); // pixels per chunk
    const toX = (cx: number): number => w / 2 + (cx - camX) * px;
    const toY = (cz: number): number => h / 2 + (cz - camZ) * px;

    for (const ch of chunks.values()) {
      const x = toX(ch.ci), y = toY(ch.cj);
      ctx.fillStyle = LOD_COLORS[ch.lod];
      ctx.globalAlpha = 0.25 + 0.5 * (ch.lod / 2);
      ctx.fillRect(x + 1, y + 1, px - 2, px - 2);
      if (ch.flash > 0) {
        ctx.globalAlpha = ch.flash;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x + 1, y + 1, px - 2, px - 2);
        ch.flash = Math.max(0, ch.flash - 0.06);
      }
    }
    ctx.globalAlpha = 1;

    // the camera, and the direction it's dragging the whole world ring
    ctx.fillStyle = "#e9eef4";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    const heading = Math.sin(t * 0.21) * 1.2;
    ctx.strokeStyle = "#e9eef4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.cos(heading) * px * 1.4, h / 2 + Math.sin(heading) * px * 1.4);
    ctx.stroke();

    shell.readout.textContent = `${chunks.size} chunks live · cyan full detail, amber half, red quarter · white flash = just (re)built`;
  };

  shell.slider({ label: "view radius", min: 2, max: 7, step: 1, value: ring, onInput: (v) => { ring = v; } });
  shell.slider({ label: "flight speed", min: 0.3, max: 5, step: 0.1, value: speed, onInput: (v) => { speed = v; } });

  let last = performance.now();
  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      step(dt);
      draw();
    },
  };
}

// ---- the infinite flight --------------------------------------------------------------------

export async function mountInfiniteFlight(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    ...MORNING_STAGE,
    fog: { color: 0x151a24, near: 30, far: 105 },
    fov: 60,
    far: 400,
  });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 12, frequency: 0.045, amplitude: 6.5 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 12 };
  const world = new ChunkWorld(stage.scene, tp, sp);

  let x = 12, z = 12;
  let heading = 0.6;
  let speed = 6;
  let altOffset = 0;
  let camY = 12;
  let frozen = false;

  // drag steers: horizontal = heading, vertical = altitude trim
  let dragging = false, lx = 0, ly = 0;
  shell.canvas.addEventListener("pointerdown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener("pointerup", () => { dragging = false; });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    heading += (e.clientX - lx) * 0.004;
    altOffset = Math.min(14, Math.max(-2, altOffset + (e.clientY - ly) * -0.03));
    lx = e.clientX;
    ly = e.clientY;
  });

  shell.slider({ label: "speed", min: 0, max: 24, step: 0.5, value: speed, format: (v) => `${v.toFixed(1)} u/s`, onInput: (v) => { speed = v; } });
  shell.slider({
    label: "view radius",
    min: 3,
    max: 7,
    step: 1,
    value: world.p.ringRadius,
    format: (v) => `${v} chunks`,
    onInput: (v) => {
      world.p.ringRadius = v;
      const far = (v - 0.3) * world.p.chunkSize;
      stage.scene.fog = new THREE.Fog(0x151a24, far * 0.3, far);
    },
  });
  shell.button("freeze streaming", () => { frozen = !frozen; });
  shell.button("LOD tint", () => { world.showLodTint = !world.showLodTint; });
  shell.setInfo(
    () =>
      `${world.stats.live} chunks · ${world.stats.queued} queued · last build ${world.stats.lastBuildMs.toFixed(1)} ms — drag to steer`,
  );

  let last = performance.now();
  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      x += Math.cos(heading) * speed * dt;
      z += Math.sin(heading) * speed * dt;
      if (!frozen) world.update(x, z);
      world.setTime((now / 1000) % 10000);

      const groundY = world.heightAt(x, z);
      camY += (groundY + 4.5 + altOffset - camY) * Math.min(1, dt * 2);
      stage.camera.position.set(x, camY, z);
      const ax = x + Math.cos(heading) * 14;
      const az = z + Math.sin(heading) * 14;
      stage.camera.lookAt(ax, camY - 1.6 + (world.heightAt(ax, az) - groundY) * 0.3, az);

      stage.renderer.render(stage.scene, stage.camera);
      shell.tick();
    },
    dispose: () => {
      world.dispose();
      stage.dispose();
    },
  };
}

// ---- hero: it just keeps going ----------------------------------------------------------------

export async function mountHorizonHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createStage3D(shell.canvas, {
    ...MORNING_STAGE,
    fog: { color: 0x151a24, near: 26, far: 92 },
    fov: 58,
    far: 400,
  });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 7, frequency: 0.045, amplitude: 6.5 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 7 };
  const world = new ChunkWorld(stage.scene, tp, sp, { ringRadius: 4, budgetMs: 7 });

  let x = 0, z = 0;
  let camY = 12;
  let t = 0;
  let last = performance.now();

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;

      const heading = Math.sin(t * 0.07) * 0.7; // long lazy arcs, never a loop
      x += Math.cos(heading) * 5.5 * dt;
      z += Math.sin(heading) * 5.5 * dt;
      world.update(x, z);
      world.setTime((now / 1000) % 10000);

      const groundY = world.heightAt(x, z);
      camY += (groundY + 4.2 - camY) * Math.min(1, dt * 1.6);
      stage.camera.position.set(x, camY, z);
      const ax = x + Math.cos(heading) * 16;
      const az = z + Math.sin(heading) * 16;
      stage.camera.lookAt(ax, world.heightAt(ax, az) + 2.2, az);

      stage.renderer.render(stage.scene, stage.camera);
    },
    dispose: () => {
      world.dispose();
      stage.dispose();
    },
  };
}
