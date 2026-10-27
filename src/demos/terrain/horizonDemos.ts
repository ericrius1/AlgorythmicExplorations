// The figures of Ground Truth part 6: the chunk ring seen from above (the
// world as a moving window), the infinite flight where you steer with a
// drag, and a hero that flies into the sunset and never reaches an edge.

import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";
import { TERRAIN_DEFAULTS, type TerrainParams } from "../../lib/terrain/heightmap";
import { SCATTER_DEFAULTS, type ScatterParams } from "../../lib/terrain/scatter";
import { ChunkWorld, CHUNK_DEFAULTS, lodClass } from "../../lib/terrain/chunks";
import { createTerrainStage, GOLDEN, SUNSET, Smooth } from "../../lib/terrain/look";

// ---- the ring from above ------------------------------------------------------------------

interface DiagramChunk { ci: number; cj: number; lod: number; flash: number }

export function mountChunkDiagram(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = pixelRatio(shell.canvas);

  let ring = CHUNK_DEFAULTS.ringRadius;
  let speed = 1.2; // chunks per second of camera motion
  let perFrame = 2; // builds allowed per frame (a stand-in for the millisecond budget)
  let camX = 0.5, camZ = 0.5;
  let t = 0;
  const chunks = new Map<string, DiagramChunk>();
  let queued = 0;

  // vertices per chunk at each class, skirt included: (n+1)² + 4(n+1)
  const segs = [CHUNK_DEFAULTS.nearSegments, CHUNK_DEFAULTS.midSegments, CHUNK_DEFAULTS.farSegments];
  const vertsOf = (lod: number): number => (segs[lod] + 1) ** 2 + 4 * (segs[lod] + 1);
  const COLORS = ["#67e8f9", "#e8b45a", "#d6685a"];

  const heading = (): number => Math.sin(t * 0.21) * 1.2;

  const step = (dt: number): void => {
    t += dt;
    camX += Math.cos(heading()) * speed * dt;
    camZ += Math.sin(heading()) * speed * dt;
    const cci = Math.floor(camX), ccj = Math.floor(camZ);

    for (const [key, ch] of chunks) {
      if (Math.max(Math.abs(ch.ci - cci), Math.abs(ch.cj - ccj)) > ring + 1) chunks.delete(key);
    }

    // the build queue: nearest first, a fixed number of builds per frame
    const wanted: { ci: number; cj: number; r: number }[] = [];
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        wanted.push({ ci: cci + di, cj: ccj + dj, r: Math.max(Math.abs(di), Math.abs(dj)) });
      }
    }
    wanted.sort((a, b) => a.r - b.r);
    let built = 0;
    queued = 0;
    for (const w of wanted) {
      const key = `${w.ci},${w.cj}`;
      const want = lodClass(w.r);
      const ch = chunks.get(key);
      if (ch && ch.lod === want) continue;
      if (built >= perFrame) { queued++; continue; }
      if (!ch) chunks.set(key, { ci: w.ci, cj: w.cj, lod: want, flash: 1 });
      else { ch.lod = want; ch.flash = 1; }
      built++;
    }
  };

  const draw = (): void => {
    const w = shell.canvas.width, h = shell.canvas.height;
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, w, h);

    const px = h / (2 * ring + 4); // pixels per chunk
    const toX = (cx: number): number => w / 2 + (cx - camX) * px;
    const toY = (cz: number): number => h / 2 + (cz - camZ) * px;

    // the backdrop: everything past the ring, one coarse mesh
    ctx.fillStyle = "rgba(150, 120, 230, 0.07)";
    ctx.fillRect(0, 0, w, h);

    const counts = [0, 0, 0];
    let verts = 0;
    for (const ch of chunks.values()) {
      const x = toX(ch.ci), y = toY(ch.cj);
      counts[ch.lod]++;
      verts += vertsOf(ch.lod);
      ctx.fillStyle = "#0a0b10";
      ctx.fillRect(x + dpr, y + dpr, px - 2 * dpr, px - 2 * dpr);
      ctx.globalAlpha = [0.85, 0.55, 0.32][ch.lod];
      ctx.fillStyle = COLORS[ch.lod];
      ctx.fillRect(x + dpr, y + dpr, px - 2 * dpr, px - 2 * dpr);
      // the grid inside each chunk, drawn at a sixth of its real density
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "#0a0b10";
      ctx.lineWidth = dpr;
      const lines = segs[ch.lod] / 6;
      ctx.beginPath();
      for (let k = 1; k < lines; k++) {
        const f = (k / lines) * px;
        ctx.moveTo(x + f, y + dpr); ctx.lineTo(x + f, y + px - dpr);
        ctx.moveTo(x + dpr, y + f); ctx.lineTo(x + px - dpr, y + f);
      }
      ctx.stroke();
      if (ch.flash > 0) {
        ctx.globalAlpha = ch.flash;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x + dpr, y + dpr, px - 2 * dpr, px - 2 * dpr);
        ch.flash = Math.max(0, ch.flash - 0.05);
      }
      ctx.globalAlpha = 1;
    }

    // the camera and its heading
    const hd = heading();
    ctx.fillStyle = "#f4f6fb";
    ctx.strokeStyle = "#f4f6fb";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.cos(hd) * px * 1.4, h / 2 + Math.sin(hd) * px * 1.4);
    ctx.stroke();

    const all = chunks.size * vertsOf(0);
    shell.readout.textContent =
      `${chunks.size} chunks: ${counts[0]} full, ${counts[1]} half, ${counts[2]} quarter · ` +
      `${(verts / 1000).toFixed(0)}k vertices (${(all / 1000).toFixed(0)}k if all were full) · ${queued} queued`;
  };

  shell.slider({ label: "view radius", min: 2, max: 7, step: 1, value: ring, format: (v) => `${v} chunks`, onInput: (v) => { ring = v; } });
  shell.slider({ label: "flight speed", min: 0.3, max: 5, step: 0.1, value: speed, format: (v) => `${v.toFixed(1)} chunks/s`, onInput: (v) => { speed = v; } });
  shell.slider({ label: "builds per frame", min: 1, max: 8, step: 1, value: perFrame, onInput: (v) => { perFrame = v; } });

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

// ---- a camera that stays above the ground it's heading for -------------------------------

function flightCamera(world: ChunkWorld, clearance: number) {
  const alt = new Smooth(1.8);
  const pitch = new Smooth(1.2);
  return (x: number, z: number, heading: number, dt: number, extra = 0): [number, number, number, number, number, number] => {
    const cx = Math.cos(heading), cz = Math.sin(heading);
    // the highest ground over the next stretch of the path, so the camera
    // climbs before a ridge instead of into it
    let ahead = -Infinity;
    for (let d = 0; d <= 36; d += 6) ahead = Math.max(ahead, world.heightAt(x + cx * d, z + cz * d) - d * 0.06);
    const y = alt.step(Math.max(ahead, world.heightAt(x, z)) + clearance + extra, dt);
    const lx = x + cx * 30, lz = z + cz * 30;
    const ly = pitch.step(Math.min(y - 1.5, world.heightAt(lx, lz) + clearance * 0.5), dt);
    return [x, y, z, lx, ly, lz];
  };
}

// ---- the infinite flight --------------------------------------------------------------------

export async function mountInfiniteFlight(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createTerrainStage(shell.canvas, GOLDEN, { orbit: false, fov: 60, near: 0.1, far: 1500 });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 12, frequency: 0.03, amplitude: 12 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 12 };
  const world = new ChunkWorld(stage.scene, stage.look, tp, sp);
  const cam = flightCamera(world, 4.5);

  let x = 12, z = 12;
  let heading = 2.3;
  let speed = 6;
  let altOffset = 0;
  let frozen = false;
  await world.prefill(x, z);

  // drag steers: sideways turns, up and down climbs or descends
  let dragging = false, lx = 0, ly = 0;
  shell.canvas.style.touchAction = "none";
  shell.canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    shell.canvas.setPointerCapture(e.pointerId);
  });
  shell.canvas.addEventListener("pointerup", () => { dragging = false; });
  shell.canvas.addEventListener("pointercancel", () => { dragging = false; });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    heading += (e.clientX - lx) * 0.004;
    altOffset = Math.min(30, Math.max(-2, altOffset + (e.clientY - ly) * -0.05));
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
      world.rebuildBackdropNow(x, z);
    },
  });
  const freezeBtn = shell.button("freeze streaming", () => {
    frozen = !frozen;
    freezeBtn.textContent = frozen ? "resume streaming" : "freeze streaming";
  });
  const tintBtn = shell.button("LOD tint", () => {
    world.showLodTint = !world.showLodTint;
    tintBtn.textContent = world.showLodTint ? "natural colour" : "LOD tint";
  });
  shell.setInfo(() => {
    const s = world.stats;
    return `${s.live} chunks · ${s.queued} queued · last build ${s.lastBuildMs.toFixed(1)} ms · ${(s.vertices / 1000).toFixed(0)}k terrain vertices · ${s.trees} trees · drag to steer`;
  });

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

      const [px, py, pz, ax, ay, az] = cam(x, z, heading, dt, altOffset);
      stage.camera.position.set(px, py, pz);
      stage.camera.lookAt(ax, ay, az);
      stage.draw();
      shell.tick();
    },
    dispose: () => {
      world.dispose();
      stage.dispose();
    },
  };
}

// ---- hero: into the sunset -------------------------------------------------------------------

export async function mountHorizonHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createTerrainStage(shell.canvas, SUNSET, { orbit: false, fov: 52, near: 0.1, far: 1500 });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 7, frequency: 0.03, amplitude: 12 };
  const sp: ScatterParams = { ...SCATTER_DEFAULTS, seed: 7 };
  const world = new ChunkWorld(stage.scene, stage.look, tp, sp, { budgetMs: 5 });
  const cam = flightCamera(world, 8);

  // fly with the low sun ahead and to the left, so every ridge throws a long shadow toward the camera
  const base = Math.atan2(stage.look.sunDir.z, stage.look.sunDir.x) + 0.75;
  let x = 0, z = 0;
  let t = 0;
  await world.prefill(x, z);

  let last = performance.now();
  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;

      const heading = base + Math.sin(t * 0.045) * 0.45; // long lazy arcs, never a loop
      x += Math.cos(heading) * 5 * dt;
      z += Math.sin(heading) * 5 * dt;
      world.update(x, z);
      world.setTime((now / 1000) % 10000);

      const [px, py, pz, ax, ay, az] = cam(x, z, heading, dt);
      stage.camera.position.set(px, py, pz);
      stage.camera.lookAt(ax, ay, az);
      stage.draw();
    },
    dispose: () => {
      world.dispose();
      stage.dispose();
    },
  };
}
