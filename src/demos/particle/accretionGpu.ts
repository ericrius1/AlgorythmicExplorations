// Demos 1, 4 & 5 of part four: the combined solver, in two arrangements.
// mode "collapse": a cold dust cloud, with gravity and contacts toggleable —
// gravity alone makes a ghost, both together make a planetesimal.
// mode "disk": a Keplerian ring of dust around a star, accreting moonlets.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { ParticleRenderer } from "../../lib/particleRenderer";
import { AccretionSolver } from "../../lib/accretionSolver";
import { chooseHashTableSize } from "../../lib/hashSort";
import { GpuProfiler } from "../../lib/gpuProfiler";

// Grain diameter = hash cell. Sized so the default seeds sit well under
// random close packing — overlapped seeds detonate the contact springs.
const CELL_DISK = 0.004;
const CELL_CLOUD = 0.007;

export interface AccretionDemoOptions {
  mode: "collapse" | "disk";
  count?: number;
  hero?: boolean;
  physics?: "gravity" | "contacts" | "both"; // collapse mode's starting toggle
}

// Cold disc of dust: uniform density, gentle solid-body spin, almost no heat.
function seedCloud(count: number): Float32Array {
  const state = new Float32Array(count * 4);
  const R = 0.55;
  const spin = 0.35;
  for (let i = 0; i < count; i++) {
    const r = R * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    state[i * 4] = x;
    state[i * 4 + 1] = y;
    state[i * 4 + 2] = -y * spin + (Math.random() - 0.5) * 0.02;
    state[i * 4 + 3] = x * spin + (Math.random() - 0.5) * 0.02;
  }
  return state;
}

// Annulus of dust on near-circular orbits around the (analytic) star.
function seedRing(count: number, starGM: number): Float32Array {
  const state = new Float32Array(count * 4);
  const r0 = 0.32;
  const r1 = 0.85;
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * Math.random());
    const a = Math.random() * Math.PI * 2;
    const v = Math.sqrt(starGM / r) * (1 + (Math.random() - 0.5) * 0.02);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    state[i * 4] = x + (Math.random() - 0.5) * 0.004;
    state[i * 4 + 1] = y + (Math.random() - 0.5) * 0.004;
    state[i * 4 + 2] = (-y / r) * v;
    state[i * 4 + 3] = (x / r) * v;
  }
  return state;
}

export async function mountAccretion(container: HTMLElement, opts: AccretionDemoOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.5 : 0.7);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new ParticleRenderer(dev, ctx);
  const disk = opts.mode === "disk";

  const aspect = shell.canvas.width / shell.canvas.height;
  const renderScale = disk ? 1.05 : 1.45;

  // Total dust gravity is fixed; the slider only changes how finely it is
  // sampled — the same resolution-knob contract as part one's galaxy.
  const GM_DUST = disk ? 0.12 : 0.12;
  const STAR_GM = disk ? 0.066 : 0;

  const cell = disk ? CELL_DISK : CELL_CLOUD;
  let count = opts.count ?? 20000;
  let steps = 4;
  let stickiness = 30;
  let gravity = opts.physics !== "contacts";
  let contacts = opts.physics === "contacts" || (opts.physics ?? "both") === "both";
  let solver = new AccretionSolver(dev, chooseHashTableSize(count));
  const profiler = new GpuProfiler(dev);

  let bufs: [GPUBuffer, GPUBuffer] = [null!, null!];
  let cur = 0;

  const rebuild = (): void => {
    for (const b of bufs) b?.destroy();
    const table = chooseHashTableSize(count);
    if (solver.sort.table !== table) {
      solver.dispose();
      solver = new AccretionSolver(dev, table);
    }
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    bufs = [dev.createBuffer({ size: count * 16, usage }), dev.createBuffer({ size: count * 16, usage })];
    dev.queue.writeBuffer(bufs[0], 0, (disk ? seedRing(count, STAR_GM) : seedCloud(count)) as BufferSource);
    solver.setBuffers(bufs);
    cur = 0;
  };
  rebuild();

  // The star is drawn, not simulated: one quad, fake velocity for warm color.
  const starBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(starBuf, 0, new Float32Array([0, 0, 6, 0]));
  const starRenderer = disk ? new ParticleRenderer(dev, ctx) : null;
  starRenderer?.bind(starBuf);

  // Cursor stirring, same scheme as part three's fluid.
  let mouse: [number, number] = [99, 99];
  let mouseVel: [number, number] = [0, 0];
  let lastMove = 0;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const wx = (cx * aspect) / renderScale;
    const wy = cy / renderScale;
    const now = performance.now();
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016;
    lastMove = now;
    if (mouse[0] < 90) {
      const vx = (wx - mouse[0]) / dtm;
      const vy = (wy - mouse[1]) / dtm;
      const mag = Math.hypot(vx, vy);
      const clamp = mag > 4 ? 4 / mag : 1;
      mouseVel = [mouseVel[0] * 0.6 + vx * clamp * 0.4, mouseVel[1] * 0.6 + vy * clamp * 0.4];
    }
    mouse = [wx, wy];
  });
  shell.canvas.addEventListener("pointerleave", () => {
    mouse = [99, 99];
    mouseVel = [0, 0];
  });

  if (!opts.hero) {
    if (opts.mode === "collapse") {
      const modeButton = (label: string, g: boolean, c: boolean): void =>
        shell.button(label, () => {
          gravity = g;
          contacts = c;
          rebuild();
        });
      modeButton("gravity only", true, false);
      modeButton("contacts only", false, true);
      modeButton("both", true, true);
    } else {
      shell.slider({
        label: "grains",
        min: 10000,
        max: 150000,
        step: 1000,
        value: count,
        log: true,
        format: (v) => Math.round(v).toLocaleString(),
        onInput: (v) => {
          count = Math.round(v);
          rebuild();
        },
      });
    }
    shell.slider({
      label: "stickiness",
      min: 0,
      max: 80,
      step: 1,
      value: stickiness,
      format: (v) => String(Math.round(v)),
      onInput: (v) => (stickiness = v),
    });
    shell.button("re-seed", rebuild);
  }
  shell.setInfo(() => {
    const timing = profiler.format();
    if (opts.hero) return `${count.toLocaleString()} dust grains around one star${timing ? ` · ${timing}` : ""} — stir the ring`;
    const phys =
      gravity && contacts ? "tree + grid" : gravity ? "tree only — ghosts" : "grid only — loose sand";
    return (
      `${count.toLocaleString()} grains · ${phys} · sorted into ${solver.sort.table.toLocaleString()} buckets ` +
      `${steps}× per frame${timing ? ` · ${timing}` : ""} · stir with your cursor`
    );
  });

  return {
    frame() {
      shell.tick();
      profiler.beginFrame();
      solver.writeParams({
        count,
        gravity,
        contacts,
        dt: 0.0022,
        gGrain: GM_DUST / count,
        softening: disk ? 0.012 : 0.02,
        theta: 0.75,
        cellSize: cell,
        stiffness: 3000,
        damping: stickiness,
        starGM: STAR_GM,
        starSoft: 0.05,
        confineR: disk ? 1.4 : 0.85,
        confineK: 4.0,
        mouseRadius: 0.15,
        mouseStrength: 40,
        maxSpeed: 3,
        mouse,
        mouseVel,
      });
      const enc = dev.createCommandEncoder();
      for (let s = 0; s < steps; s++) cur = solver.encode(enc, cur, count, profiler);
      renderer.bind(bufs[cur]);
      renderer.encode(enc, count, {
        scale: renderScale,
        size: disk ? 0.0028 : 0.0042,
        colorScale: disk ? 1.4 : 2.5,
      });
      starRenderer?.encode(enc, 1, { scale: renderScale, size: 0.035, colorScale: 0.2, load: true });
      profiler.resolve(enc);
      dev.queue.submit([enc.finish()]);
      profiler.afterSubmit();
    },
    dispose() {
      solver.dispose();
      profiler.dispose();
      for (const b of bufs) b?.destroy();
      starBuf.destroy();
    },
  };
}
