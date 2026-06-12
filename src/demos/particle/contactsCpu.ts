// Demo 1 of part three: short-range contacts the honest way — every pair,
// every step. The counter shows the new kind of waste: almost every check
// returns zero force. Poke the pile with your cursor.

import { Shell, type Demo } from "../../lib/demoShell";

const R = 0.016; // disc radius
const VIEW = 0.92;

export interface ContactSim {
  state: Float32Array; // x, y, vx, vy
  count: number;
}

export function seedBox(count: number): ContactSim {
  const state = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    state[i * 4] = (Math.random() * 2 - 1) * 0.92;
    state[i * 4 + 1] = Math.random() * 1.6 - 0.65;
  }
  return { state, count };
}

export interface ContactParams {
  dt: number;
  mouse: [number, number] | null;
}

// Shared by both CPU demos: contact spring + integration for one pair-tested
// particle, given its accumulated acceleration.
export function integrateContacts(s: Float32Array, count: number, ax: Float32Array, ay: Float32Array, p: ContactParams): void {
  for (let i = 0; i < count; i++) {
    let axi = ax[i];
    let ayi = ay[i] - 1.4; // gravity
    if (p.mouse) {
      const dx = s[i * 4] - p.mouse[0];
      const dy = s[i * 4 + 1] - p.mouse[1];
      const d = Math.hypot(dx, dy);
      if (d < 0.25 && d > 1e-6) {
        const f = (30 * (1 - d / 0.25)) / d;
        axi += dx * f;
        ayi += dy * f;
      }
    }
    s[i * 4 + 2] = (s[i * 4 + 2] + axi * p.dt) * 0.999;
    s[i * 4 + 3] = (s[i * 4 + 3] + ayi * p.dt) * 0.999;
    s[i * 4] += s[i * 4 + 2] * p.dt;
    s[i * 4 + 1] += s[i * 4 + 3] * p.dt;
    // hard box
    if (s[i * 4] < -1 + R) { s[i * 4] = -1 + R; s[i * 4 + 2] *= -0.3; }
    if (s[i * 4] > 1 - R) { s[i * 4] = 1 - R; s[i * 4 + 2] *= -0.3; }
    if (s[i * 4 + 1] < -1 + R) { s[i * 4 + 1] = -1 + R; s[i * 4 + 3] *= -0.3; }
    if (s[i * 4 + 1] > 1 - R) { s[i * 4 + 1] = 1 - R; s[i * 4 + 3] *= -0.3; }
  }
}

export function contactForce(s: Float32Array, i: number, j: number, ax: Float32Array, ay: Float32Array): boolean {
  const dx = s[i * 4] - s[j * 4];
  const dy = s[i * 4 + 1] - s[j * 4 + 1];
  const r2 = dx * dx + dy * dy;
  const dia = R * 2;
  if (r2 >= dia * dia || r2 < 1e-12) return false;
  const r = Math.sqrt(r2);
  const nx = dx / r;
  const ny = dy / r;
  const f = (dia - r) * 320;
  const vn = (s[i * 4 + 2] - s[j * 4 + 2]) * nx + (s[i * 4 + 3] - s[j * 4 + 3]) * ny;
  const fx = nx * f - nx * vn * 5;
  const fy = ny * f - ny * vn * 5;
  ax[i] += fx;
  ay[i] += fy;
  ax[j] -= fx;
  ay[j] -= fy;
  return true;
}

export function drawContacts(ctx: CanvasRenderingContext2D, sim: ContactSim, mouse: [number, number] | null): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = "#06070b";
  ctx.fillRect(0, 0, width, height);
  const sc = (Math.min(width, height) / 2) * VIEW;
  const ox = width / 2;
  const oy = height / 2;
  ctx.strokeStyle = "rgba(80, 90, 120, 0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox - sc, oy - sc, sc * 2, sc * 2);
  ctx.fillStyle = "rgba(140, 170, 255, 0.85)";
  ctx.beginPath();
  const pr = Math.max(R * sc, 1.2);
  for (let i = 0; i < sim.count; i++) {
    const x = ox + sim.state[i * 4] * sc;
    const y = oy - sim.state[i * 4 + 1] * sc;
    ctx.moveTo(x + pr, y);
    ctx.arc(x, y, pr, 0, Math.PI * 2);
  }
  ctx.fill();
  if (mouse) {
    ctx.strokeStyle = "rgba(255, 205, 80, 0.4)";
    ctx.beginPath();
    ctx.arc(ox + mouse[0] * sc, oy - mouse[1] * sc, 0.25 * sc, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function canvasMouse(shell: Shell): { get: () => [number, number] | null } {
  let mouse: [number, number] | null = null;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const sc = (Math.min(r.width, r.height) / 2) * VIEW;
    mouse = [(e.clientX - r.left - r.width / 2) / sc, -(e.clientY - r.top - r.height / 2) / sc];
  });
  shell.canvas.addEventListener("pointerleave", () => (mouse = null));
  return { get: () => mouse };
}

export function mountContactsCpu(container: HTMLElement): Demo {
  const shell = new Shell(container);
  const ctx = shell.canvas.getContext("2d")!;
  let count = 2000;
  let sim = seedBox(count);
  let ax = new Float32Array(count);
  let ay = new Float32Array(count);
  let stepMs = 0;
  let checked = 0;
  let touching = 0;
  const mouse = canvasMouse(shell);

  const reseed = (): void => {
    sim = seedBox(count);
    ax = new Float32Array(count);
    ay = new Float32Array(count);
  };

  shell.slider({
    label: "particles",
    min: 200,
    max: 4000,
    step: 100,
    value: count,
    log: true,
    format: (v) => String(Math.round(v)),
    onInput: (v) => {
      count = Math.round(v);
      reseed();
    },
  });
  shell.button("re-seed", reseed);
  shell.setInfo(
    () =>
      `${checked.toLocaleString()} pair checks · ${touching.toLocaleString()} touching ` +
      `(${((touching / Math.max(checked, 1)) * 100).toFixed(2)}%) · ${stepMs.toFixed(1)} ms/step`,
  );

  return {
    frame() {
      shell.tick();
      const t0 = performance.now();
      ax.fill(0);
      ay.fill(0);
      touching = 0;
      const s = sim.state;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          if (contactForce(s, i, j, ax, ay)) touching++;
        }
      }
      checked = (count * (count - 1)) / 2;
      integrateContacts(s, count, ax, ay, { dt: 0.016, mouse: mouse.get() });
      stepMs = performance.now() - t0;
      drawContacts(ctx, sim, mouse.get());
    },
  };
}
