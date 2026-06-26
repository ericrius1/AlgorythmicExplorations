import { Shell, type Demo } from "../lib/demoShell";

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;

function hash01(n: number): number {
  const value = Math.sin(n * 12.9898 + 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function clear(ctx: Ctx, w: number, h: number, top = "#06070b", bottom = "#11131c"): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function text(ctx: Ctx, value: string, x: number, y: number, size = 13, color = "#d7dbe6", align: CanvasTextAlign = "left"): void {
  ctx.fillStyle = color;
  ctx.font = `${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

function mono(ctx: Ctx, value: string, x: number, y: number, size = 12, color = "#c4cdf0", align: CanvasTextAlign = "left"): void {
  ctx.fillStyle = color;
  ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

function panel(ctx: Ctx, x: number, y: number, w: number, h: number, title: string): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = "rgba(17, 19, 28, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(122, 162, 255, 0.22)";
  ctx.stroke();
  text(ctx, title, x + 16, y + 23, 13, "#7aa2ff");
  ctx.restore();
}

function arrow(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color = "#5f677e"): void {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.48) * 10, y2 - Math.sin(a - 0.48) * 10);
  ctx.lineTo(x2 - Math.cos(a + 0.48) * 10, y2 - Math.sin(a + 0.48) * 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function sparkle(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(0.26, color.replace("1)", `${alpha})`));
  g.addColorStop(1, color.replace("1)", "0)"));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

export function mountHeroFireworks(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.46);
  shell.controls.style.display = "none";
  shell.readout.parentElement?.remove();
  const ctx = shell.canvas.getContext("2d")!;

  return {
    frame() {
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      const t = performance.now() * 0.001;
      clear(ctx, w, h, "#05060b", "#17101f");

      const sky = ctx.createRadialGradient(w * 0.5, h * 0.08, 0, w * 0.5, h * 0.08, h * 0.9);
      sky.addColorStop(0, "rgba(70, 84, 140, 0.34)");
      sky.addColorStop(0.5, "rgba(34, 19, 42, 0.3)");
      sky.addColorStop(1, "rgba(255, 139, 55, 0.12)");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      for (let ridge = 0; ridge < 2; ridge++) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i <= 28; i++) {
          const x = (i / 28) * w;
          const y = h * (0.68 + ridge * 0.11) + Math.sin(i * 0.7 + ridge) * h * 0.035 + hash01(i + ridge * 50) * h * 0.07;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = ridge === 0 ? "rgba(8, 11, 21, 0.72)" : "rgba(4, 7, 12, 0.95)";
        ctx.fill();
      }

      for (let b = 0; b < 5; b++) {
        const phase = (t * 0.23 + b * 0.21) % 1;
        const cx = w * (0.18 + hash01(b * 12.7) * 0.68);
        const cy = h * (0.16 + hash01(b * 31.1) * 0.36);
        const hue = b % 3 === 0 ? "255, 187, 84" : b % 3 === 1 ? "94, 192, 255" : "248, 106, 255";
        if (phase < 0.32) {
          const launch = phase / 0.32;
          const sx = cx + Math.sin(b * 2.1) * w * 0.04;
          const sy = h * 0.9;
          const x = lerp(sx, cx, launch);
          const y = lerp(sy, cy, 1 - Math.pow(1 - launch, 2));
          ctx.strokeStyle = `rgba(${hue}, ${0.25 + launch * 0.65})`;
          ctx.lineWidth = Math.max(1, w * 0.002);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(x, y);
          ctx.stroke();
          sparkle(ctx, x, y, h * 0.035, `rgba(${hue}, 1)`, 0.6);
        } else {
          const age = (phase - 0.32) / 0.68;
          for (let i = 0; i < 110; i++) {
            const seed = b * 1000 + i * 3.17;
            const a = hash01(seed) * TAU;
            const speed = h * (0.08 + hash01(seed + 2) * 0.34);
            const rr = speed * Math.sin(age * Math.PI * 0.84);
            const fall = h * 0.17 * age * age;
            const x = cx + Math.cos(a) * rr * (1 + hash01(seed + 5) * 0.35);
            const y = cy + Math.sin(a) * rr * 0.72 + fall;
            const alpha = Math.pow(1 - age, 1.4) * (0.4 + hash01(seed + 8) * 0.6);
            if (alpha <= 0) continue;
            sparkle(ctx, x, y, h * (0.008 + hash01(seed + 9) * 0.012), `rgba(${hue}, 1)`, alpha);
          }
        }
      }

      text(ctx, "CPU: launch intent", 24, h - 50, 13, "#8a91a5");
      arrow(ctx, 150, h - 50, 245, h - 50, "#5f677e");
      text(ctx, "GPU: millions of independent fragments of light", 260, h - 50, 13, "#d7dbe6");
    },
  };
}

export function mountCommandBudget(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.52);
  const ctx = shell.canvas.getContext("2d")!;
  const state = { bursts: 12, sparks: 50000 };

  shell.slider({
    label: "bursts in one frame",
    min: 1,
    max: 80,
    step: 1,
    value: state.bursts,
    format: (v) => v.toFixed(0),
    onInput: (v) => {
      state.bursts = Math.round(v);
    },
  });
  shell.slider({
    label: "sparks per burst",
    min: 500,
    max: 120000,
    step: 500,
    value: state.sparks,
    format: (v) => v.toLocaleString(),
    onInput: (v) => {
      state.sparks = Math.round(v);
    },
  });

  shell.setInfo(() => {
    const commandBytes = state.bursts * 96;
    const naiveBytes = state.bursts * state.sparks * 80;
    return `${formatBytes(commandBytes)} commands vs ${formatBytes(naiveBytes)} particles`;
  });

  return {
    frame() {
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      clear(ctx, w, h);
      const commandBytes = state.bursts * 96;
      const naiveBytes = state.bursts * state.sparks * 80;
      const maxLog = Math.log10(Math.max(naiveBytes, commandBytes, 10));
      const bar = (label: string, bytes: number, y: number, color: string): void => {
        const x = w * 0.12;
        const bw = w * 0.72;
        const filled = (Math.log10(Math.max(bytes, 10)) / maxLog) * bw;
        text(ctx, label, x, y - 22, 14, "#d7dbe6");
        mono(ctx, formatBytes(bytes), x + bw, y - 22, 13, "#ffb86b", "right");
        roundRect(ctx, x, y, bw, h * 0.09, 12);
        ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
        ctx.fill();
        roundRect(ctx, x, y, Math.max(2, filled), h * 0.09, 12);
        ctx.fillStyle = color;
        ctx.fill();
      };

      text(ctx, "Same visual request, radically different upload", w * 0.5, h * 0.12, 18, "#eef1f8", "center");
      text(ctx, `${state.bursts.toLocaleString()} bursts x ${state.sparks.toLocaleString()} sparks`, w * 0.5, h * 0.19, 13, "#8a91a5", "center");
      bar("CPU uploads one command per burst", commandBytes, h * 0.33, "rgba(122, 162, 255, 0.78)");
      bar("CPU uploads every particle", naiveBytes, h * 0.58, "rgba(255, 184, 107, 0.78)");
      const ratio = naiveBytes / Math.max(commandBytes, 1);
      text(ctx, `${ratio.toLocaleString(undefined, { maximumFractionDigits: 0 })}x less CPU-to-GPU traffic`, w * 0.5, h * 0.84, 17, "#7dd6a0", "center");
      text(ctx, "The GPU still creates every spark. The CPU just stops spelling them out.", w * 0.5, h * 0.91, 12, "#8a91a5", "center");
      shell.tick();
    },
  };
}

export function mountLiveCompaction(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.58);
  const ctx = shell.canvas.getContext("2d")!;
  const particles = Array.from({ length: 96 }, (_, i) => ({
    age: hash01(i * 17.1),
    life: 0.32 + hash01(i * 41.3) * 0.68,
    hue: hash01(i * 9.7),
  }));
  let paused = false;
  shell.button("reseed", () => {
    for (let i = 0; i < particles.length; i++) {
      particles[i].age = hash01(i * 23.7 + performance.now() * 0.001) * 0.4;
      particles[i].life = 0.32 + hash01(i * 19.4 + performance.now() * 0.002) * 0.68;
    }
  });
  shell.button("pause", () => {
    paused = !paused;
  });
  shell.setInfo(() => {
    const live = particles.filter((p) => p.age < p.life).length;
    return `${live} live slots -> draw ${live} instances`;
  });

  return {
    frame() {
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      if (!paused) {
        for (let i = 0; i < particles.length; i++) {
          particles[i].age += 0.0035 + hash01(i) * 0.0015;
          if (particles[i].age > 1.18) {
            particles[i].age = 0;
            particles[i].life = 0.32 + hash01(i * 31.7 + performance.now() * 0.001) * 0.68;
            particles[i].hue = hash01(i * 13.1 + performance.now() * 0.0007);
          }
        }
      }

      clear(ctx, w, h);
      panel(ctx, w * 0.05, h * 0.1, w * 0.9, h * 0.32, "read buffer: old state with gaps");
      panel(ctx, w * 0.05, h * 0.54, w * 0.9, h * 0.28, "write buffer: compacted live list");
      const live = particles.filter((p) => p.age < p.life);
      drawCells(ctx, particles, w * 0.09, h * 0.18, w * 0.82, h * 0.16, false);
      drawCells(ctx, live, w * 0.09, h * 0.62, w * 0.82, h * 0.12, true);
      arrow(ctx, w * 0.5, h * 0.44, w * 0.5, h * 0.52, "#7aa2ff");
      text(ctx, "simulate, discard expired particles, atomicAdd live survivors", w * 0.5, h * 0.49, 13, "#d7dbe6", "center");
      mono(ctx, `counter.write = ${live.length}`, w * 0.09, h * 0.88, 13, "#7dd6a0");
      mono(ctx, `drawIndirect.instanceCount = ${live.length}`, w * 0.48, h * 0.88, 13, "#ffb86b");
      shell.tick();
    },
  };
}

function drawCells(
  ctx: Ctx,
  particles: Array<{ age: number; life: number; hue: number }>,
  x: number,
  y: number,
  w: number,
  h: number,
  compact: boolean,
): void {
  const cols = 24;
  const rows = compact ? 3 : 4;
  const gap = 3;
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;
  const slots = cols * rows;
  for (let i = 0; i < slots; i++) {
    const p = particles[i];
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + gap);
    roundRect(ctx, cx, cy, cw, ch, 3);
    if (!p) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    } else if (p.age >= p.life && !compact) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
    } else {
      const hot = p.hue < 0.5 ? "122, 162, 255" : "255, 184, 107";
      const a = compact ? 0.78 : clamp(1 - p.age / p.life, 0.16, 0.92);
      ctx.fillStyle = `rgba(${hot}, ${a})`;
    }
    ctx.fill();
  }
}

export function mountPipelineGraph(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.54);
  const ctx = shell.canvas.getContext("2d")!;
  const state = { pass: 0 };
  const names = ["begin", "simulate", "emit", "finish", "draw"];
  shell.slider({
    label: "pass",
    min: 0,
    max: 4,
    step: 1,
    value: state.pass,
    format: (v) => names[Math.round(v)],
    onInput: (v) => {
      state.pass = Math.round(v);
    },
  });
  shell.setInfo(() => names[state.pass]);

  return {
    frame() {
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      clear(ctx, w, h);
      text(ctx, "One frame as a command buffer", w * 0.5, h * 0.1, 18, "#eef1f8", "center");

      const blocks = [
        { label: "beginFrame", sub: "reset write + overflow", x: 0.08, y: 0.27 },
        { label: "simulateCompact", sub: "read A, append live to B", x: 0.29, y: 0.27 },
        { label: "emitParticles", sub: "commands -> new particles", x: 0.5, y: 0.27 },
        { label: "finishFrame", sub: "write counters + indirect args", x: 0.71, y: 0.27 },
        { label: "drawIndirect", sub: "render exactly live count", x: 0.39, y: 0.66 },
      ];
      for (let i = 0; i < 3; i++) {
        arrow(ctx, w * (blocks[i].x + 0.15), h * blocks[i].y, w * blocks[i + 1].x - 8, h * blocks[i + 1].y, "#5f677e");
      }
      arrow(ctx, w * 0.79, h * 0.4, w * 0.58, h * 0.61, "#5f677e");

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const bw = w * 0.17;
        const bh = h * 0.18;
        const x = w * b.x;
        const y = h * b.y - bh * 0.5;
        roundRect(ctx, x, y, bw, bh, 12);
        ctx.fillStyle = i === state.pass ? "rgba(122, 162, 255, 0.2)" : "rgba(255, 255, 255, 0.05)";
        ctx.fill();
        ctx.strokeStyle = i === state.pass ? "rgba(122, 162, 255, 0.95)" : "rgba(122, 162, 255, 0.18)";
        ctx.stroke();
        text(ctx, b.label, x + bw * 0.5, y + bh * 0.38, 13, "#eef1f8", "center");
        text(ctx, b.sub, x + bw * 0.5, y + bh * 0.66, 10.5, "#8a91a5", "center");
      }

      drawBuffer(ctx, w * 0.12, h * 0.79, w * 0.24, h * 0.1, "particle buffer A", state.pass === 1 ? "#ffb86b" : "#5f677e");
      drawBuffer(ctx, w * 0.4, h * 0.79, w * 0.24, h * 0.1, "particle buffer B", state.pass === 1 || state.pass === 2 ? "#7dd6a0" : "#5f677e");
      drawBuffer(ctx, w * 0.68, h * 0.79, w * 0.2, h * 0.1, "indirect args", state.pass >= 3 ? "#7aa2ff" : "#5f677e");
      mono(ctx, state.pass < 3 ? "CPU knows commands, not live count" : "GPU writes the live count the renderer consumes", w * 0.5, h * 0.94, 13, "#c4cdf0", "center");
      shell.tick();
    },
  };
}

function drawBuffer(ctx: Ctx, x: number, y: number, w: number, h: number, label: string, color: string): void {
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.stroke();
  mono(ctx, label, x + w * 0.5, y + h * 0.5, 11, "#d7dbe6", "center");
}

export function mountCapacityMap(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  const state = { limitMiB: 128 };
  shell.slider({
    label: "max storage binding",
    min: 64,
    max: 512,
    step: 32,
    value: state.limitMiB,
    format: (v) => `${v.toFixed(0)} MiB`,
    onInput: (v) => {
      state.limitMiB = Math.round(v);
    },
  });
  shell.setInfo(() => {
    const cap = Math.floor((state.limitMiB * 1024 * 1024) / 80);
    return `${cap.toLocaleString()} particles`;
  });

  return {
    frame() {
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      clear(ctx, w, h);
      const bindingBytes = state.limitMiB * 1024 * 1024;
      const capacity = Math.floor(bindingBytes / 80);
      const particleMiB = (capacity * 80) / 1024 / 1024;
      const totalMiB = particleMiB * 2 + (65536 * 96) / 1024 / 1024 + 0.001;
      text(ctx, "Capacity is a device fact", w * 0.5, h * 0.12, 18, "#eef1f8", "center");
      mono(ctx, `floor(${state.limitMiB} MiB / 80 bytes) = ${capacity.toLocaleString()} particles`, w * 0.5, h * 0.22, 14, "#c4cdf0", "center");

      const x = w * 0.14;
      const bw = w * 0.72;
      memoryBar(ctx, x, h * 0.36, bw, h * 0.1, "read particle buffer", particleMiB, state.limitMiB, "#ffb86b");
      memoryBar(ctx, x, h * 0.53, bw, h * 0.1, "write particle buffer", particleMiB, state.limitMiB, "#7dd6a0");
      memoryBar(ctx, x, h * 0.7, bw, h * 0.1, "commands + counters", totalMiB - particleMiB * 2, state.limitMiB, "#7aa2ff");
      text(ctx, `total fireworks GPU allocation: ${totalMiB.toFixed(1)} MiB`, w * 0.5, h * 0.9, 15, "#d7dbe6", "center");
      shell.tick();
    },
  };
}

function memoryBar(ctx: Ctx, x: number, y: number, w: number, h: number, label: string, usedMiB: number, limitMiB: number, color: string): void {
  text(ctx, label, x, y - 16, 12, "#8a91a5");
  mono(ctx, `${usedMiB.toFixed(1)} MiB`, x + w, y - 16, 12, "#ffb86b", "right");
  roundRect(ctx, x, y, w, h, 9);
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  ctx.fill();
  roundRect(ctx, x, y, w * clamp(usedMiB / limitMiB, 0, 1), h, 9);
  ctx.fillStyle = color;
  ctx.fill();
}
