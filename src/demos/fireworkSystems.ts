// Figures for "Fireworks at GPU Scale": the hero, four diagrams that explain
// the frame, and a live figure that runs the real thing with its counters.

import { Shell, type Demo } from "../lib/demoShell";
import { getDevice } from "../lib/gpu";
import {
  autoShow,
  EMIT_COMMAND_BYTES,
  FireworksView,
  FireworksWorld,
  PARTICLE_STRIDE,
  type FireworkSystemId,
} from "./fireworkHeroGpu";

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
const SANS = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const C = {
  bg0: "#080a12",
  bg1: "#0d1019",
  panel: "rgba(255, 255, 255, 0.035)",
  line: "rgba(122, 162, 255, 0.18)",
  text: "#e3e7f2",
  muted: "#8a91a5",
  dim: "#5d6479",
  blue: "#7aa2ff",
  amber: "#ffb86b",
  green: "#7dd6a0",
  red: "#ff8585",
  violet: "#c59bff",
};

function hash01(n: number): number {
  const value = Math.sin(n * 12.9898 + 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

// Draw in CSS pixels whatever the canvas resolution is.
function begin(canvas: HTMLCanvasElement): { ctx: Ctx; w: number; h: number } {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  const dpr = canvas.width / Math.max(w, 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.bg0);
  g.addColorStop(1, C.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return { ctx, w, h };
}

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  opts: { size?: number; color?: string; align?: CanvasTextAlign; mono?: boolean; weight?: number } = {},
): void {
  ctx.fillStyle = opts.color ?? C.text;
  ctx.font = `${opts.weight ?? (opts.mono ? 400 : 500)} ${opts.size ?? 13}px ${opts.mono ? MONO : SANS}`;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, w / 2, h / 2));
}

// ---------------------------------------------------------------------------
// Hero

export async function mountHeroFireworks(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.46);
  shell.controls.style.display = "none";
  shell.readout.parentElement?.remove();

  const world = await FireworksWorld.get();
  if (!world) return mountHeroFallback(shell);

  const view = new FireworksView(world, shell.canvas);
  view.resize();
  const tick = autoShow(
    world,
    () => view.aspect(),
    () => ({ sparks: 920, rockets: [1, 3], interval: [0.9, 1.5], collapseEvery: 4 }),
  );
  // start mid-show rather than on an empty sky
  if (!world.prewarmed) world.prewarm(2.6, tick);
  let last = performance.now();

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tick(world.clock);
      world.step(now);
      world.render(view, dt);
    },
    dispose() {
      view.dispose();
    },
  };
}

// Without WebGPU: a few soft 2D bursts over the same kind of ridge line.
function mountHeroFallback(shell: Shell): Demo {
  return {
    frame() {
      const { ctx, w, h } = begin(shell.canvas);
      const t = performance.now() * 0.001;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#04050d");
      sky.addColorStop(0.7, "#1a1636");
      sky.addColorStop(1, "#45293a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let b = 0; b < 4; b++) {
        const phase = (t * 0.18 + b * 0.27) % 1;
        const cx = w * (0.15 + hash01(b * 12.7 + Math.floor(t * 0.18 + b * 0.27)) * 0.7);
        const cy = h * (0.18 + hash01(b * 31.1) * 0.3);
        const hue = ["255, 187, 84", "94, 192, 255", "248, 106, 255", "140, 255, 120"][b];
        if (phase < 0.25) continue;
        const age = (phase - 0.25) / 0.75;
        for (let i = 0; i < 90; i++) {
          const s = b * 1000 + i * 3.17;
          const a = hash01(s) * TAU;
          const r = h * (0.06 + hash01(s + 2) * 0.22) * Math.sin(age * Math.PI * 0.5);
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r + h * 0.12 * age * age;
          const alpha = Math.pow(1 - age, 1.4) * 0.8;
          ctx.fillStyle = `rgba(${hue}, ${alpha})`;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#05060c";
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= 40; i++) ctx.lineTo((i / 40) * w, h * (0.8 + Math.sin(i * 0.7) * 0.03 + hash01(i) * 0.04));
      ctx.lineTo(w, h);
      ctx.fill();
    },
  };
}

// ---------------------------------------------------------------------------
// Fig. 1: bytes the CPU uploads for one frame of launches

export function mountCommandBudget(container: HTMLElement): Demo {
  const narrow = (container.clientWidth || 700) < 560;
  const shell = new Shell(container, narrow ? 0.95 : 0.5);
  const state = { bursts: 12, sparks: 50000 };
  // A shell is more than its sparks: the explosion command also expands into
  // the centre flash, crackle, embers and smoke (see spawnClassic).
  const extras = 1 + Math.round(11 * 11 * 0.34) + 64 + 30;

  shell.slider({
    label: "shells in one frame",
    min: 1,
    max: 80,
    step: 1,
    value: state.bursts,
    format: (v) => v.toFixed(0),
    onInput: (v) => (state.bursts = Math.round(v)),
  });
  shell.slider({
    label: "sparks per shell",
    min: 500,
    max: 120000,
    step: 500,
    value: state.sparks,
    format: (v) => v.toLocaleString(),
    onInput: (v) => (state.sparks = Math.round(v)),
  });
  const bytes = (): { commands: number; particles: number; count: number } => {
    const count = state.bursts * (state.sparks + extras);
    return { commands: state.bursts * EMIT_COMMAND_BYTES, particles: count * PARTICLE_STRIDE, count };
  };
  shell.setInfo(() => {
    const b = bytes();
    return `${b.count.toLocaleString()} particles · ${formatBytes(b.commands)} of commands vs ${formatBytes(b.particles)} of particles`;
  });

  return {
    frame() {
      const { ctx, w, h } = begin(shell.canvas);
      const small = w < 520;
      const b = bytes();
      const padL = small ? 16 : w * 0.08;
      const padR = small ? 16 : w * 0.08;
      const x0 = padL;
      const x1 = w - padR;
      // fixed log axis from 10 B to 4 GiB, so the bars move as you drag
      const lo = 1;
      const hi = Math.log10(4 * 1024 ** 3);
      const xOf = (v: number): number => x0 + ((Math.log10(Math.max(v, 10)) - lo) / (hi - lo)) * (x1 - x0);

      const head = `${state.bursts} shell${state.bursts === 1 ? "" : "s"} × ${state.sparks.toLocaleString()} sparks`;
      if (small) {
        text(ctx, head, w / 2, h * 0.07, { size: 13, align: "center", weight: 600 });
        text(ctx, "launched in the same frame", w / 2, h * 0.07 + 17, { size: 11, align: "center", color: C.muted });
      } else {
        text(ctx, `${head}, launched in the same frame`, w / 2, h * 0.1, { size: 15, align: "center", weight: 600 });
      }

      const row = (label: string, value: number, y: number, color: string, glow: string): void => {
        const bh = small ? 18 : Math.max(16, h * 0.085);
        text(ctx, label, x0, y - bh * 0.5 - 10, { size: small ? 11 : 13, color: C.muted });
        roundRect(ctx, x0, y - bh / 2, x1 - x0, bh, bh / 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
        ctx.fill();
        const xe = xOf(value);
        const g = ctx.createLinearGradient(x0, 0, xe, 0);
        g.addColorStop(0, glow);
        g.addColorStop(1, color);
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        roundRect(ctx, x0, y - bh / 2, Math.max(bh, xe - x0), bh, bh / 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
        const label2 = formatBytes(value);
        const inside = xe - x0 > 110;
        text(ctx, label2, inside ? xe - 10 : xe + 8, y, {
          size: small ? 11 : 13,
          mono: true,
          color: inside ? "#0b0d14" : color,
          align: inside ? "right" : "left",
          weight: 600,
        });
      };
      row(small ? "one 96-byte command per shell" : "upload one emit command per shell (96 bytes each)", b.commands, h * (small ? 0.3 : 0.33), C.blue, "rgba(122,162,255,0.35)");
      row(small ? "every particle, 80 bytes each" : "upload every particle (80 bytes each)", b.particles, h * (small ? 0.47 : 0.55), C.amber, "rgba(255,184,107,0.35)");

      // axis
      const ay = h * (small ? 0.6 : 0.7);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, ay);
      ctx.lineTo(x1, ay);
      ctx.stroke();
      for (let d = 1; d <= 9; d++) {
        const x = xOf(10 ** d);
        ctx.beginPath();
        ctx.moveTo(x, ay - 3);
        ctx.lineTo(x, ay + 3);
        ctx.stroke();
      }
      const ticks: Array<[number, string]> = [
        ...(small ? [] : ([[100, "100 B"]] as Array<[number, string]>)),
        [1024, "1 KiB"],
        [1024 ** 2, "1 MiB"],
        [1024 ** 3, "1 GiB"],
      ];
      for (const [v, l] of ticks) {
        const x = xOf(v);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.beginPath();
        ctx.moveTo(x, ay - 6);
        ctx.lineTo(x, ay + 6);
        ctx.stroke();
        text(ctx, l, x, ay + 16, { size: small ? 10 : 11, mono: true, color: C.dim, align: "center" });
      }
      text(ctx, "bytes, log scale", x0, ay - 12, { size: small ? 9 : 11, color: C.dim });

      const ratio = b.particles / b.commands;
      text(ctx, `${Math.round(ratio).toLocaleString()}× less to send`, w / 2, h * (small ? 0.76 : 0.86), {
        size: small ? 16 : 19,
        color: C.green,
        align: "center",
        weight: 600,
      });
      if (small) {
        text(ctx, "Either way the GPU still writes", w / 2, h * 0.86, { size: 11, color: C.muted, align: "center" });
        text(ctx, "every particle. Only the upload changes.", w / 2, h * 0.86 + 15, { size: 11, color: C.muted, align: "center" });
      } else {
        text(ctx, "Either way the GPU still writes every particle. Only the upload changes.", w / 2, h * 0.94, {
          size: 12,
          color: C.muted,
          align: "center",
        });
      }
      shell.tick();
    },
  };
}

// ---------------------------------------------------------------------------
// Fig. 2: two buffers, compacted every frame

interface Slot {
  id: number;
  hue: number; // 0..1, which burst it came from
  life: number; // frames left
}

export function mountLiveCompaction(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.6);
  const CAP = 40;
  const FRAME_S = 2.2;
  let nextId = 0;
  const newBurst = (n: number): Slot[] => {
    const hue = Math.random();
    return Array.from({ length: n }, () => ({ id: nextId++, hue, life: 1 + Math.floor(Math.random() * 4) }));
  };
  let read: Slot[] = [...newBurst(9), ...newBurst(7), ...newBurst(8)];
  let survivors: Array<{ s: Slot; from: number; to: number }> = [];
  let born: Slot[] = [];
  let dead: number[] = [];
  let readIsA = true;
  let phase = 0;
  let paused = false;
  let overflow = 0;

  // One simulated frame: age everything, hand survivors slots in the order
  // their (pretend) threads finish, then append the new burst.
  const plan = (): void => {
    survivors = [];
    dead = [];
    const alive: number[] = [];
    read.forEach((s, i) => (s.life > 1 ? alive.push(i) : dead.push(i)));
    // atomicAdd hands out slots in arrival order, which isn't index order:
    // shuffle within groups of 8, like workgroups racing each other
    for (let g = 0; g < alive.length; g += 8) {
      const chunk = alive.slice(g, g + 8);
      for (let i = chunk.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chunk[i], chunk[j]] = [chunk[j], chunk[i]];
      }
      alive.splice(g, chunk.length, ...chunk);
    }
    alive.forEach((from, to) => survivors.push({ s: read[from], from, to }));
    const room = CAP - survivors.length;
    const want = read.length < 22 ? 9 + Math.floor(Math.random() * 6) : 4 + Math.floor(Math.random() * 6);
    born = newBurst(Math.min(want, room));
    overflow = Math.max(0, want - room);
  };
  const commit = (): void => {
    read = [...survivors.map((v) => ({ ...v.s, life: v.s.life - 1 })), ...born];
    readIsA = !readIsA;
  };
  plan();

  shell.button("pause", () => {
    paused = !paused;
    pauseButton.textContent = paused ? "play" : "pause";
  });
  const pauseButton = shell.controls.lastElementChild as HTMLButtonElement;
  shell.button("next frame", () => {
    paused = true;
    pauseButton.textContent = "play";
    phase = 0;
    commit();
    plan();
  });
  shell.setInfo(
    () =>
      `${read.length} live → ${survivors.length} survive, ${born.length} emitted · instanceCount = ${survivors.length + born.length}`,
  );

  let last = performance.now();
  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!paused) {
        phase += dt / FRAME_S;
        if (phase >= 1) {
          phase = 0;
          commit();
          plan();
        }
      }
      const { ctx, w, h } = begin(shell.canvas);
      const small = w < 520;
      const cols = 20;
      const rows = CAP / cols;
      const padX = small ? 12 : w * 0.07;
      const gap = small ? 2 : 4;
      const cw = (w - padX * 2 - gap * (cols - 1)) / cols;
      const ch = Math.min(cw, h * 0.075);
      const blockH = rows * ch + (rows - 1) * gap;
      const topY = h * 0.15;
      const botY = h * 0.62 - blockH * 0.5;
      const yA = topY;
      const yB = botY;
      const readY = readIsA ? yA : yB;
      const writeY = readIsA ? yB : yA;
      const slotXY = (i: number, by: number): [number, number] => [
        padX + (i % cols) * (cw + gap),
        by + Math.floor(i / cols) * (ch + gap),
      ];
      const colorOf = (s: Slot, a: number): string => {
        const r = Math.round(122 + (255 - 122) * s.hue);
        const g = Math.round(162 + (184 - 162) * s.hue);
        const b = Math.round(255 + (107 - 255) * s.hue);
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      };

      // buffer frames
      const frame = (by: number, name: string, role: string, active: boolean, below: boolean): void => {
        const ly = below ? by + blockH + (small ? 13 : 18) : by - (small ? 12 : 16);
        text(ctx, name, padX, ly, { size: small ? 11 : 13, weight: 600 });
        text(ctx, role, padX + (small ? 66 : 92), ly, {
          size: small ? 10 : 12,
          mono: true,
          color: active ? C.amber : C.blue,
        });
        for (let i = 0; i < CAP; i++) {
          const [x, y] = slotXY(i, by);
          roundRect(ctx, x, y, cw, ch, 3);
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.fill();
        }
      };
      frame(yA, "buffer A", readIsA ? "read · last frame" : "write · this frame", !readIsA, false);
      frame(yB, "buffer B", readIsA ? "write · this frame" : "read · last frame", readIsA, true);

      const pDie = ease(phase / 0.3);
      const pMove = ease((phase - 0.3) / 0.4);
      const pBorn = ease((phase - 0.68) / 0.18);

      // read buffer contents: the dying fade, survivors lift off
      read.forEach((s, i) => {
        const [x, y] = slotXY(i, readY);
        const dying = s.life <= 1;
        const a = dying ? 0.85 * (1 - pDie) + 0.08 : 0.85 * (1 - pMove * 0.75);
        roundRect(ctx, x, y, cw, ch, 3);
        ctx.fillStyle = colorOf(s, a);
        ctx.fill();
        if (dying && pDie > 0.4) {
          ctx.strokeStyle = `rgba(255,133,133,${0.7 * (1 - pMove)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x + 3, y + 3);
          ctx.lineTo(x + cw - 3, y + ch - 3);
          ctx.stroke();
        }
      });

      // survivors travel to the slot their atomicAdd returned
      for (const v of survivors) {
        const [fx, fy] = slotXY(v.from, readY);
        const [tx, ty] = slotXY(v.to, writeY);
        if (pMove > 0 && pMove < 1) {
          ctx.strokeStyle = colorOf(v.s, 0.18);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(fx + cw / 2, fy + ch / 2);
          ctx.bezierCurveTo(fx + cw / 2, (fy + ty) / 2, tx + cw / 2, (fy + ty) / 2, tx + cw / 2, ty + ch / 2);
          ctx.stroke();
        }
        if (pMove <= 0) continue;
        const t = pMove;
        const mx = (1 - t) ** 3 * fx + 3 * (1 - t) ** 2 * t * fx + 3 * (1 - t) * t * t * tx + t ** 3 * tx;
        const midY = (fy + ty) / 2;
        const my = (1 - t) ** 3 * fy + 3 * (1 - t) ** 2 * t * midY + 3 * (1 - t) * t * t * midY + t ** 3 * ty;
        ctx.save();
        ctx.shadowColor = colorOf(v.s, 0.8);
        ctx.shadowBlur = 8;
        roundRect(ctx, mx, my, cw, ch, 3);
        ctx.fillStyle = colorOf(v.s, 0.9);
        ctx.fill();
        ctx.restore();
      }

      // newly emitted particles append after the survivors
      born.forEach((s, k) => {
        const [x, y] = slotXY(survivors.length + k, writeY);
        if (pBorn <= 0) return;
        roundRect(ctx, x, y, cw, ch, 3);
        ctx.fillStyle = colorOf(s, 0.9 * pBorn);
        ctx.fill();
        ctx.strokeStyle = `rgba(125, 214, 160, ${pBorn})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // the pass between them
      const midY = (yA + blockH + yB) / 2;
      const down = readIsA;
      const ax = w - padX - (small ? 6 : 12);
      ctx.strokeStyle = C.blue;
      ctx.fillStyle = C.blue;
      ctx.lineWidth = 2;
      const y0 = down ? yA + blockH + 8 : yB - 8;
      const y1 = down ? yB - (small ? 26 : 30) : yA + blockH + (small ? 26 : 30);
      ctx.beginPath();
      ctx.moveTo(ax, y0);
      ctx.lineTo(ax, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax, y1 + (down ? 6 : -6));
      ctx.lineTo(ax - 5, y1);
      ctx.lineTo(ax + 5, y1);
      ctx.fill();
      text(ctx, small ? "simulate → append" : "simulate, drop the expired, atomicAdd the rest", ax - 14, midY, {
        size: small ? 10 : 12,
        color: C.muted,
        align: "right",
      });

      const n = survivors.length + born.length;
      const y = h * 0.87;
      text(ctx, `counters.write = ${survivors.length} + ${born.length} = ${n}`, padX, y, { size: small ? 10 : 13, mono: true, color: C.green });
      text(ctx, `instanceCount = ${n}`, w - padX, y, { size: small ? 10 : 13, mono: true, color: C.amber, align: "right" });
      if (overflow > 0) {
        text(ctx, `${overflow} didn't fit → overflow`, w / 2, h * 0.97, { size: small ? 10 : 11, mono: true, color: C.red, align: "center" });
      }
      shell.tick();
    },
  };
}

// ---------------------------------------------------------------------------
// Fig. 3: one frame as a table of passes and the buffers they touch

export function mountPipelineGraph(container: HTMLElement): Demo {
  const narrow = (container.clientWidth || 700) < 560;
  const shell = new Shell(container, narrow ? 0.98 : 0.62);
  const passes = [
    { name: "CPU", full: "queue.writeBuffer", what: "The CPU uploads this frame's emit commands, the emit totals in the counters, and the uniforms." },
    { name: "begin", full: "beginFrame", what: "One thread zeroes the write counter and the draw instance count." },
    {
      name: "simulate",
      full: "simulateCompact",
      what: "One thread per live particle, sized by last frame's dispatch args. Survivors are appended to the other buffer.",
    },
    { name: "emit", full: "emitParticles", what: "One thread per new particle. Each finds its command, hashes seed + index, and appends." },
    { name: "finish", full: "finishFrame", what: "One thread copies the write counter into live, the draw args, and next frame's dispatch args." },
    { name: "draw", full: "drawIndirect", what: "Six vertices per particle, instance count read from the buffer finishFrame just wrote." },
  ];
  // r = read, w = write, rw = both (atomics), per resource per pass
  const resources: Array<{ name: string; ops: string[] }> = [
    { name: "emit commands", ops: ["w", "", "", "r", "", ""] },
    { name: "counters", ops: ["w", "w", "rw", "rw", "rw", ""] },
    { name: "particles (old)", ops: ["", "", "r", "", "", ""] },
    { name: "particles (new)", ops: ["", "", "w", "w", "", "r"] },
    { name: "draw args", ops: ["", "w", "", "", "w", "r"] },
    { name: "dispatch args", ops: ["", "", "r", "", "w", ""] },
  ];
  let pass = 0;
  let auto = true;
  let clock = 0;
  const slider = shell.slider({
    label: "pass",
    min: 0,
    max: passes.length - 1,
    step: 1,
    value: 0,
    format: (v) => passes[Math.round(v)].full,
    onInput: (v) => {
      pass = Math.round(v);
      auto = false;
    },
  });
  shell.button("play", () => {
    auto = true;
    clock = 0;
  });
  shell.setInfo(() => (auto ? "playing · drag the slider to stop on a pass" : `${passes[pass].full}`));
  let last = performance.now();

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (auto) {
        clock += dt;
        if (clock > 1.9) {
          clock = 0;
          pass = (pass + 1) % passes.length;
          slider.value = String(pass);
          slider.dispatchEvent(new Event("input"));
          auto = true;
        }
      }
      const { ctx, w, h } = begin(shell.canvas);
      const small = w < 520;
      const labelW = small ? 84 : 150;
      const x0 = small ? 10 : w * 0.05;
      const x1 = w - (small ? 10 : w * 0.05);
      const colW = (x1 - x0 - labelW) / passes.length;
      const y0 = h * (small ? 0.09 : 0.13);
      const rowH = (h * (small ? 0.6 : 0.62)) / resources.length;

      // column headers and the highlighted pass
      const hx = x0 + labelW + pass * colW;
      roundRect(ctx, hx + 2, y0 - (small ? 16 : 20), colW - 4, rowH * resources.length + (small ? 22 : 28), 8);
      ctx.fillStyle = "rgba(122, 162, 255, 0.1)";
      ctx.fill();
      ctx.strokeStyle = "rgba(122, 162, 255, 0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      const short = ["CPU", "begin", "sim", "emit", "finish", "draw"];
      passes.forEach((p, i) => {
        text(ctx, small ? short[i] : p.name, x0 + labelW + (i + 0.5) * colW, y0 - 6, {
          size: small ? 10 : 12,
          align: "center",
          weight: 600,
          color: i === pass ? C.text : C.muted,
        });
      });
      // order arrows
      for (let i = 0; i < (small ? 0 : passes.length - 1); i++) {
        const xa = x0 + labelW + (i + 1) * colW;
        ctx.fillStyle = C.dim;
        ctx.beginPath();
        ctx.moveTo(xa - 3, y0 - 9);
        ctx.lineTo(xa + 3, y0 - 6);
        ctx.lineTo(xa - 3, y0 - 3);
        ctx.fill();
      }

      resources.forEach((r, j) => {
        const y = y0 + 8 + j * rowH;
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.moveTo(x0, y + rowH);
        ctx.lineTo(x1, y + rowH);
        ctx.stroke();
        const touched = r.ops[pass] !== "";
        text(ctx, r.name, x0, y + rowH / 2, { size: small ? 10 : 13, color: touched ? C.text : C.muted, weight: touched ? 600 : 500 });
        r.ops.forEach((op, i) => {
          if (!op) return;
          const cx = x0 + labelW + (i + 0.5) * colW;
          const cy = y + rowH / 2;
          const on = i === pass;
          const rad = small ? 6 : 8;
          const draw = (dx: number, color: string, letter: string): void => {
            ctx.save();
            if (on) {
              ctx.shadowColor = color;
              ctx.shadowBlur = 12;
            }
            ctx.beginPath();
            ctx.arc(cx + dx, cy, rad, 0, TAU);
            ctx.fillStyle = on ? color : "rgba(255,255,255,0.08)";
            ctx.fill();
            ctx.restore();
            text(ctx, letter, cx + dx, cy + 0.5, { size: small ? 8 : 10, align: "center", weight: 700, color: on ? "#0b0d14" : color });
          };
          if (op === "rw") {
            draw(-rad * 0.95, C.blue, "R");
            draw(rad * 0.95, C.amber, "W");
          } else if (op === "r") draw(0, C.blue, "R");
          else draw(0, C.amber, "W");
        });
      });

      // what the highlighted pass does, wrapped to the canvas
      const desc = `${passes[pass].full}: ${passes[pass].what}`;
      ctx.font = `${small ? 11 : 13}px ${SANS}`;
      const words = desc.split(" ");
      const lines: string[] = [];
      let cur = "";
      for (const word of words) {
        const next = cur ? `${cur} ${word}` : word;
        if (ctx.measureText(next).width > x1 - x0 && cur) {
          lines.push(cur);
          cur = word;
        } else cur = next;
      }
      lines.push(cur);
      lines.slice(0, 4).forEach((l, i) => {
        text(ctx, l, x0, h * (small ? 0.78 : 0.84) + i * (small ? 15 : 18), { size: small ? 11 : 13, color: i === 0 ? C.text : C.muted });
      });
      shell.tick();
    },
  };
}

// ---------------------------------------------------------------------------
// Fig. 4: capacity from the device's storage binding limit

export function mountCapacityMap(container: HTMLElement): Demo {
  const narrow = (container.clientWidth || 700) < 560;
  const shell = new Shell(container, narrow ? 0.9 : 0.5);
  const MiB = 1024 * 1024;
  const state = { limitMiB: 128, deviceMiB: 0, adapterMiB: 0 };
  const slider = shell.slider({
    label: "storage binding limit",
    min: 20.48, // a log range of exactly 2.00, so the slider's 0.01 steps reach both ends
    max: 2048,
    step: 32,
    value: state.limitMiB,
    log: true,
    format: (v) => (v >= 1024 ? `${(v / 1024).toFixed(2)} GiB` : `${v.toFixed(0)} MiB`),
    onInput: (v) => (state.limitMiB = v),
  });
  // read the real numbers off this machine
  void getDevice().then((device) => {
    if (!device) return;
    state.deviceMiB = device.limits.maxStorageBufferBindingSize / MiB;
    state.limitMiB = state.deviceMiB;
    slider.value = String(Math.log10(state.limitMiB));
    slider.dispatchEvent(new Event("input"));
  });
  void navigator.gpu
    ?.requestAdapter()
    .then((adapter) => {
      if (adapter) state.adapterMiB = adapter.limits.maxStorageBufferBindingSize / MiB;
    })
    .catch(() => {});
  shell.setInfo(() => {
    const cap = Math.floor((state.limitMiB * MiB) / PARTICLE_STRIDE);
    return `${cap.toLocaleString()} particles per buffer`;
  });

  return {
    frame() {
      const { ctx, w, h } = begin(shell.canvas);
      const small = w < 520;
      const bytes = state.limitMiB * MiB;
      const capacity = Math.floor(bytes / PARTICLE_STRIDE);
      const bufMiB = (capacity * PARTICLE_STRIDE) / MiB;
      const cmdMiB = (65536 * EMIT_COMMAND_BYTES) / MiB;
      const totalMiB = bufMiB * 2 + cmdMiB;

      if (small) {
        text(ctx, `floor(${formatBytes(bytes)} ÷ 80 B)`, w / 2, h * 0.07, { size: 13, mono: true, align: "center", weight: 600 });
        text(ctx, `= ${capacity.toLocaleString()} particles`, w / 2, h * 0.07 + 18, { size: 13, mono: true, align: "center", weight: 600 });
        text(ctx, "per buffer, and there are two of them", w / 2, h * 0.07 + 38, { size: 11, color: C.muted, align: "center" });
      } else {
        text(ctx, `floor(${formatBytes(bytes)} ÷ 80 B) = ${capacity.toLocaleString()} particles`, w / 2, h * 0.11, {
          size: 16,
          mono: true,
          align: "center",
          weight: 600,
        });
        text(ctx, "per buffer, and there are two of them", w / 2, h * 0.19, { size: 12, color: C.muted, align: "center" });
      }

      // memory map: both particle buffers plus the command buffer, to scale
      const x0 = small ? 12 : w * 0.07;
      const x1 = w - x0;
      const y = h * (small ? 0.33 : 0.36);
      const bh = small ? 46 : h * 0.16;
      const scale = (x1 - x0) / totalMiB;
      const seg = (from: number, size: number, color: string, label: string, sub: string): void => {
        const x = x0 + from * scale;
        const sw = size * scale;
        const g = ctx.createLinearGradient(0, y, 0, y + bh);
        g.addColorStop(0, color);
        g.addColorStop(1, color + "99");
        roundRect(ctx, x + 1, y, sw - 2, bh, 6);
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (sw > 70) {
          text(ctx, label, x + 10, y + bh * 0.36, { size: small ? 10 : 13, color: "#0b0d14", weight: 700 });
          text(ctx, sub, x + 10, y + bh * 0.7, { size: small ? 9 : 11, color: "#0b0d14", mono: true });
        }
      };
      seg(0, bufMiB, C.amber, "particles A", formatBytes(bufMiB * MiB));
      seg(bufMiB, bufMiB, C.green, "particles B", formatBytes(bufMiB * MiB));
      seg(bufMiB * 2, cmdMiB, C.blue, "", "");
      text(ctx, small ? `+ ${cmdMiB.toFixed(0)} MiB of emit commands, + counters` : `+ ${cmdMiB.toFixed(0)} MiB of emit commands, and a few bytes of counters and indirect args`, x1, y + bh + 16, {
        size: small ? 9 : 11,
        color: C.muted,
        align: "right",
      });
      text(ctx, `total ${formatBytes(totalMiB * MiB)}`, x1, y - 14, { size: small ? 11 : 13, mono: true, align: "right", color: C.text });

      // facts from this machine
      const fy = h * (small ? 0.66 : 0.74);
      const line = (label: string, value: string, yy: number, color: string): void => {
        text(ctx, label, x0, yy, { size: small ? 10 : 13, color: C.muted });
        text(ctx, value, x1, yy, { size: small ? 10 : 13, mono: true, color, align: "right" });
      };
      line(
        small ? "this page's device (defaults)" : "this page's device (default WebGPU limits)",
        state.deviceMiB ? formatBytes(state.deviceMiB * MiB) : "no WebGPU",
        fy,
        C.text,
      );
      line(
        small ? "your GPU would grant up to" : "most your GPU adapter would grant if asked",
        state.adapterMiB ? formatBytes(state.adapterMiB * MiB) : "…",
        fy + (small ? 18 : 24),
        C.green,
      );
      const shells = Math.floor(capacity / (50000 + 1 + 41 + 64 + 30));
      line(small ? "50,000-spark shells per buffer" : "50,000-spark shells that fit in one buffer", shells.toLocaleString(), fy + (small ? 36 : 48), C.amber);
      shell.tick();
    },
  };
}

// ---------------------------------------------------------------------------
// Fig. 5: the real thing, with its counters

export async function mountFireworksLive(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.56);
  const world = await FireworksWorld.get();
  if (!world) {
    const note = document.createElement("p");
    note.className = "demo-fallback";
    note.textContent = "This figure needs WebGPU (Chrome or Edge 113+, or a recent Safari).";
    container.appendChild(note);
    return { frame() {} };
  }
  const view = new FireworksView(world, shell.canvas);
  view.resize();
  const state = { sparks: 3000, rockets: 3, system: "classic" as FireworkSystemId, auto: true };
  shell.canvas.style.touchAction = "none";
  shell.canvas.style.cursor = "crosshair";

  shell.slider({
    label: "sparks per shell",
    min: 100,
    max: 100000,
    step: 100,
    value: state.sparks,
    log: true,
    format: (v) => Math.round(v).toLocaleString(),
    onInput: (v) => (state.sparks = Math.round(v)),
  });
  shell.slider({
    label: "rockets per launch",
    min: 1,
    max: 12,
    step: 1,
    value: state.rockets,
    format: (v) => v.toFixed(0),
    onInput: (v) => (state.rockets = Math.round(v)),
  });
  const systemButton = shell.button("shell: classic", () => {
    state.system = state.system === "classic" ? "collapse" : "classic";
    systemButton.textContent = `shell: ${state.system}`;
  });
  shell.button("salvo of 24", () => {
    const a = view.aspect();
    for (let i = 0; i < 24; i++) {
      world.launch([-0.85 + (1.7 * (i + 0.5)) / 24, 0.2 + Math.random() * 0.55], { system: state.system, sparks: state.sparks }, a);
    }
  });
  const autoButton = shell.button("auto: on", () => {
    state.auto = !state.auto;
    autoButton.textContent = `auto: ${state.auto ? "on" : "off"}`;
  });

  // live counters, below the canvas
  const panel = document.createElement("div");
  panel.className = "fw-stats";
  const cells: Record<string, HTMLSpanElement> = {};
  const rows: Array<[string, string]> = [
    ["live", "live particles"],
    ["overflow", "overflowed, total"],
    ["capacity", "capacity per buffer"],
    ["emitted", "emitted, last second"],
    ["commands", "emit commands, last second"],
    ["memory", "GPU memory"],
  ];
  for (const [key, label] of rows) {
    const cell = document.createElement("div");
    cell.className = "fw-stat";
    const v = document.createElement("span");
    v.className = "fw-stat-value";
    v.textContent = "–";
    const l = document.createElement("span");
    l.className = "fw-stat-label";
    l.textContent = label;
    cell.append(v, l);
    panel.appendChild(cell);
    cells[key] = v;
  }
  shell.canvas.after(panel);

  // press and hold to keep launching where the pointer is
  let held: [number, number] | null = null;
  let nextHold = 0;
  const toPoint = (e: PointerEvent): [number, number] => {
    const r = shell.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    held = toPoint(e);
    nextHold = 0;
    shell.canvas.setPointerCapture(e.pointerId);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (held) held = toPoint(e);
  });
  const release = (): void => {
    held = null;
  };
  shell.canvas.addEventListener("pointerup", release);
  shell.canvas.addEventListener("pointercancel", release);

  const tick = autoShow(
    world,
    () => view.aspect(),
    () => ({ sparks: state.sparks, rockets: [1, 3], interval: [0.8, 1.5], collapseEvery: state.system === "collapse" ? 1 : 0 }),
  );

  // emitted totals over the last second (these numbers start on the CPU anyway)
  const history: Array<{ t: number; emitted: number; commands: number }> = [];
  let lastStats = 0;
  let last = performance.now();
  shell.setInfo(() => "press and hold on the sky to launch");

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (state.auto && !held) tick(world.clock);
      if (held && world.clock >= nextHold) {
        // eight launches every half second while the pointer is down
        nextHold = world.clock + 0.5 / 8;
        const a = view.aspect();
        for (let r = 0; r < state.rockets; r++) {
          world.launch(world.spread(held, r, state.rockets, a), { system: state.system, sparks: state.sparks }, a);
        }
      }
      world.step(now);
      world.render(view, dt);
      shell.tick();

      const s = world.stats();
      if (s && now - lastStats > 250) {
        lastStats = now;
        history.push({ t: now, emitted: world.emittedSinceLastRead(), commands: world.commandsSinceLastRead() });
        while (history.length && now - history[0].t > 1000) history.shift();
        cells.live.textContent = s.live.toLocaleString();
        cells.overflow.textContent = s.overflow.toLocaleString();
        cells.overflow.classList.toggle("is-bad", s.overflow > 0);
        cells.capacity.textContent = s.capacity.toLocaleString();
        cells.emitted.textContent = history.reduce((sum, x) => sum + x.emitted, 0).toLocaleString();
        cells.commands.textContent = history.reduce((sum, x) => sum + x.commands, 0).toLocaleString();
        cells.memory.textContent = formatBytes(s.gpuBytes);
      }
    },
    dispose() {
      view.dispose();
    },
  };
}
