// Part 3 Figures ("Rolling Downhill"):
//  1. mountLearningHero      — Luminous contour loss landscape with racing optimizer trails
//  2. mountGradDescentDemo   — Click-to-drop Loss Canyon racing SGD vs. Momentum vs. Adam
//  3. mountBackpropGraphDemo — Live interactive backpropagation circuit (forward values + backward slopes!)

import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";

// ---- Shared 2D Loss Surfaces -----------------------------------------------

type SurfaceKind = "ravine" | "bowl" | "twins";

function evalSurface(kind: SurfaceKind, x: number, y: number): { L: number; gx: number; gy: number } {
  if (kind === "bowl") {
    return { L: 0.45 * (x * x + y * y), gx: 0.9 * x, gy: 0.9 * y };
  }
  if (kind === "ravine") {
    // Classic narrow elliptical canyon (10x steeper in y than x)
    const L = 0.14 * x * x + 1.85 * y * y;
    return { L, gx: 0.28 * x, gy: 3.7 * y };
  }
  // Two valleys + saddle ridge
  const e1 = Math.exp(-((x + 1.05) ** 2 + (y + 0.2) ** 2) * 0.95);
  const e2 = Math.exp(-((x - 1.1) ** 2 + (y - 0.15) ** 2) * 1.15);
  const L = 1.65 - 1.15 * e1 - 1.5 * e2 + 0.14 * (x * x + y * y);
  const gx =
    -1.15 * e1 * (-1.9 * (x + 1.05)) - 1.5 * e2 * (-2.3 * (x - 1.1)) + 0.28 * x;
  const gy =
    -1.15 * e1 * (-1.9 * (y + 0.2)) - 1.5 * e2 * (-2.3 * (y - 0.15)) + 0.28 * y;
  return { L, gx, gy };
}

const contourCache = new Map<string, HTMLCanvasElement>();

function renderContours(
  ctx: CanvasRenderingContext2D,
  kind: SurfaceKind,
  ox: number,
  oy: number,
  w: number,
  h: number,
): void {
  const key = `${kind}`;
  let off = contourCache.get(key);
  if (!off) {
    const cw = 320;
    const ch = 220;
    off = document.createElement("canvas");
    off.width = cw;
    off.height = ch;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(cw, ch);
    const data = img.data;
    for (let r = 0; r < ch; r++) {
      const wy = (1 - (r + 0.5) / ch) * 3.0 - 1.5;
      for (let c = 0; c < cw; c++) {
        const wx = ((c + 0.5) / cw) * 4.4 - 2.2;
        const { L, gx, gy } = evalSurface(kind, wx, wy);
        const norm = Math.min(1, L / 3.2);
        // Smooth anti-aliased contour line scaled by gradient magnitude so line width stays uniform
        const spacing = 0.28;
        const phase = Math.abs((((L / spacing) % 1) + 1) % 1 - 0.5) * 2; // 0 at line, 1 midway
        const gradNorm = Math.hypot(gx, gy) + 0.35;
        const lineW = Math.min(0.32, 0.045 * gradNorm);
        const band = Math.max(0, 1 - (1 - phase) / Math.max(0.02, lineW));
        const glow = band * band * 0.22;
        const idx = (r * cw + c) * 4;
        data[idx] = Math.min(255, Math.round(13 + norm * 36 + glow * 150));
        data[idx + 1] = Math.min(255, Math.round(19 + (1 - norm) * 26 + glow * 180));
        data[idx + 2] = Math.min(255, Math.round(36 + (1 - norm) * 44 + glow * 240));
        data[idx + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    contourCache.set(key, off);
  }
  ctx.drawImage(off, ox, oy, w, h);
}

// ---- 1. Hero: Glowing Optimizer Trails in a Loss Canyon --------------------

export function mountLearningHero(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.46);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  interface Runner {
    name: string;
    color: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    mx: number;
    my: number;
    sx: number;
    sy: number;
    t: number;
    trail: [number, number][];
  }

  let runners: Runner[] = [];
  let frameTick = 0;

  const spawn = (seedAngle: number) => {
    const sx = -1.85 + Math.cos(seedAngle) * 0.18;
    const sy = 1.05 * (Math.sin(seedAngle) >= 0 ? 1 : -1) * (0.75 + 0.25 * Math.abs(Math.sin(seedAngle)));
    const mk = (name: string, color: string): Runner => ({
      name,
      color,
      x: sx,
      y: sy,
      vx: 0,
      vy: 0,
      mx: 0,
      my: 0,
      sx: 0,
      sy: 0,
      t: 0,
      trail: [[sx, sy]],
    });
    runners = [mk("SGD", "#ff8d7a"), mk("Momentum", "#ffb86b"), mk("Adam", "#5ef0b5")];
  };
  spawn(0.4);

  const stepRunners = () => {
    for (const r of runners) {
      const { gx, gy } = evalSurface("ravine", r.x, r.y);
      r.t++;
      if (r.name === "SGD") {
        r.x -= 0.46 * gx;
        r.y -= 0.46 * gy;
      } else if (r.name === "Momentum") {
        r.vx = 0.82 * r.vx + gx;
        r.vy = 0.82 * r.vy + gy;
        r.x -= 0.12 * r.vx;
        r.y -= 0.12 * r.vy;
      } else {
        r.mx = 0.85 * r.mx + 0.15 * gx;
        r.my = 0.85 * r.my + 0.15 * gy;
        r.sx = 0.96 * r.sx + 0.04 * gx * gx;
        r.sy = 0.96 * r.sy + 0.04 * gy * gy;
        const mhX = r.mx / (1 - Math.pow(0.85, r.t));
        const mhY = r.my / (1 - Math.pow(0.85, r.t));
        const vhX = r.sx / (1 - Math.pow(0.96, r.t));
        const vhY = r.sy / (1 - Math.pow(0.96, r.t));
        r.x -= (0.14 * mhX) / (Math.sqrt(vhX) + 1e-4);
        r.y -= (0.14 * mhY) / (Math.sqrt(vhY) + 1e-4);
      }
      r.x = Math.max(-2.4, Math.min(2.4, r.x));
      r.y = Math.max(-1.6, Math.min(1.6, r.y));
      r.trail.push([r.x, r.y]);
      if (r.trail.length > 90) r.trail.shift();
    }
  };

  shell.setInfo(() => "SGD (coral) zig-zags · Momentum (amber) carries speed · Adam (mint) adapts per axis");

  let cycle = 0;
  return {
    frame() {
      shell.tick();
      frameTick++;
      if (frameTick % 4 === 0) stepRunners();
      if (frameTick % 260 === 0) {
        cycle++;
        spawn(cycle * 1.9);
      }

      renderContours(ctx, "ravine", 0, 0, W, H);

      const toS = (wx: number, wy: number): [number, number] => [
        ((wx + 2.2) / 4.4) * W,
        (1 - (wy + 1.5) / 3.0) * H,
      ];

      // Target minimum cross
      const [tx, ty] = toS(0, 0);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(tx, ty, 7 * dpr, 0, Math.PI * 2);
      ctx.stroke();

      for (const r of runners) {
        ctx.beginPath();
        r.trail.forEach(([wx, wy], i) => {
          const [sx, sy] = toS(wx, wy);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 2.6 * dpr;
        ctx.stroke();

        const [bx, by] = toS(r.x, r.y);
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(bx, by, 6 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#080a12";
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
    },
  };
}

// ---- 2. Fig 1: Interactive Loss Canyon & Optimizer Race --------------------

export function mountGradDescentDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let surface: SurfaceKind = "ravine";
  let lr = 0.22;
  let beta = 0.85;
  let playing = true;
  let startX = -1.75;
  let startY = 0.95;

  interface Ball {
    id: "sgd" | "mom" | "adam";
    label: string;
    color: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    mx: number;
    my: number;
    sx: number;
    sy: number;
    step: number;
    trail: [number, number][];
    losses: number[];
    exploded: boolean;
  }

  let balls: Ball[] = [];

  const resetBalls = () => {
    const initL = evalSurface(surface, startX, startY).L;
    const mk = (id: "sgd" | "mom" | "adam", label: string, color: string): Ball => ({
      id,
      label,
      color,
      x: startX,
      y: startY,
      vx: 0,
      vy: 0,
      mx: 0,
      my: 0,
      sx: 0,
      sy: 0,
      step: 0,
      trail: [[startX, startY]],
      losses: [initL],
      exploded: false,
    });
    balls = [mk("sgd", "SGD", "#ff8d7a"), mk("mom", "Momentum", "#ffb86b"), mk("adam", "Adam", "#5ef0b5")];
  };
  resetBalls();

  const takeStep = () => {
    for (const b of balls) {
      if (b.exploded || b.step >= 120) continue;
      const { gx, gy } = evalSurface(surface, b.x, b.y);
      b.step++;
      if (b.id === "sgd") {
        b.x -= lr * gx;
        b.y -= lr * gy;
      } else if (b.id === "mom") {
        b.vx = beta * b.vx + gx;
        b.vy = beta * b.vy + gy;
        b.x -= lr * 0.45 * b.vx;
        b.y -= lr * 0.45 * b.vy;
      } else {
        const b1 = 0.85;
        const b2 = 0.96;
        b.mx = b1 * b.mx + (1 - b1) * gx;
        b.my = b1 * b.my + (1 - b1) * gy;
        b.sx = b2 * b.sx + (1 - b2) * gx * gx;
        b.sy = b2 * b.sy + (1 - b2) * gy * gy;
        const mhx = b.mx / (1 - Math.pow(b1, b.step));
        const mhy = b.my / (1 - Math.pow(b1, b.step));
        const vhx = b.sx / (1 - Math.pow(b2, b.step));
        const vhy = b.sy / (1 - Math.pow(b2, b.step));
        b.x -= (lr * 0.45 * mhx) / (Math.sqrt(vhx) + 1e-4);
        b.y -= (lr * 0.45 * mhy) / (Math.sqrt(vhy) + 1e-4);
      }
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || Math.hypot(b.x, b.y) > 4.2) {
        b.exploded = true;
        b.x = Math.max(-2.3, Math.min(2.3, Number.isFinite(b.x) ? b.x : 2.3));
        b.y = Math.max(-1.6, Math.min(1.6, Number.isFinite(b.y) ? b.y : 1.6));
      }
      b.trail.push([b.x, b.y]);
      b.losses.push(evalSurface(surface, b.x, b.y).L);
    }
  };

  const mapRect = () => {
    const pad = 22 * dpr;
    const mapW = W * 0.62 - pad * 1.5;
    const mapY = pad + 22 * dpr;
    const mapH = H - mapY - pad;
    return { pad, mapW, mapY, mapH };
  };

  shell.canvas.style.cursor = "crosshair";
  shell.canvas.addEventListener("pointerdown", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const { pad, mapW, mapY, mapH } = mapRect();
    if (sx >= pad && sx <= pad + mapW && sy >= mapY && sy <= mapY + mapH) {
      startX = ((sx - pad) / mapW) * 4.4 - 2.2;
      startY = (1 - (sy - mapY) / mapH) * 3.0 - 1.5;
      resetBalls();
      playing = true;
      playBtn.textContent = "pause";
    }
  });

  shell.slider({
    label: "learning rate",
    min: 0.02,
    max: 0.7,
    step: 0.02,
    value: lr,
    format: (v) => v.toFixed(2),
    onInput: (v) => {
      lr = v;
      resetBalls();
    },
  });
  shell.slider({
    label: "momentum β",
    min: 0.0,
    max: 0.95,
    step: 0.05,
    value: beta,
    format: (v) => v.toFixed(2),
    onInput: (v) => {
      beta = v;
      resetBalls();
    },
  });
  const playBtn = shell.button("pause", () => {
    playing = !playing;
    playBtn.textContent = playing ? "pause" : "play";
  });
  shell.button("step 1", () => {
    playing = false;
    playBtn.textContent = "play";
    takeStep();
  });
  const surfBtn = shell.button("valley: Ravine", () => {
    surface = surface === "ravine" ? "twins" : surface === "twins" ? "bowl" : "ravine";
    surfBtn.textContent = `valley: ${surface === "ravine" ? "Ravine" : surface === "twins" ? "Two Valleys" : "Bowl"}`;
    resetBalls();
  });
  shell.button("reset", () => resetBalls());

  let infoStr = "";
  shell.setInfo(() => infoStr);

  let tick = 0;
  return {
    frame() {
      shell.tick();
      tick++;
      if (playing && tick % 4 === 0) takeStep();

      const sgd = balls[0];
      const mom = balls[1];
      const adam = balls[2];
      infoStr = `Step ${adam.step} · Loss → SGD: ${sgd.exploded ? "EXPLODED!" : sgd.losses[sgd.losses.length - 1].toFixed(3)} · Mom: ${mom.exploded ? "EXPLODED!" : mom.losses[mom.losses.length - 1].toFixed(3)} · Adam: ${adam.losses[adam.losses.length - 1].toFixed(3)}`;

      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const { pad, mapW, mapY, mapH } = mapRect();

      ctx.textAlign = "left";
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("CLICK ANYWHERE ON THE LOSS MAP TO DROP ALL 3 OPTIMIZERS", pad, pad + 10 * dpr);

      renderContours(ctx, surface, pad, mapY, mapW, mapH);
      ctx.strokeStyle = "rgba(122,162,255,0.25)";
      ctx.lineWidth = dpr;
      ctx.strokeRect(pad, mapY, mapW, mapH);

      const toS = (wx: number, wy: number): [number, number] => [
        pad + ((wx + 2.2) / 4.4) * mapW,
        mapY + (1 - (wy + 1.5) / 3.0) * mapH,
      ];

      // Mark minima
      const minima: [number, number][] = surface === "twins" ? [[-1.05, -0.2], [1.1, 0.15]] : [[0, 0]];
      for (const [mx, my] of minima) {
        const [sx, sy] = toS(mx, my);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(sx, sy, 6 * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw trails & marbles
      for (const b of balls) {
        ctx.beginPath();
        b.trail.forEach(([wx, wy], i) => {
          const [sx, sy] = toS(wx, wy);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2.2 * dpr;
        ctx.stroke();

        const [bx, by] = toS(b.x, b.y);
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(bx, by, 5.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#080a12";
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
      }

      // Right: Loss over steps chart
      const rx = pad * 2 + mapW;
      const rw = W - rx - pad;
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("LOSS VS. STEPS", rx, pad + 10 * dpr);

      ctx.fillStyle = "rgba(15, 19, 32, 0.92)";
      ctx.fillRect(rx, mapY, rw, mapH);
      ctx.strokeStyle = "rgba(122,162,255,0.22)";
      ctx.strokeRect(rx, mapY, rw, mapH);

      const maxL = Math.max(2.0, evalSurface(surface, startX, startY).L * 1.15);
      for (const b of balls) {
        ctx.beginPath();
        b.losses.forEach((lv, i) => {
          const px = rx + 10 * dpr + (i / 120) * (rw - 20 * dpr);
          const py = mapY + (1 - Math.min(maxL, lv) / maxL) * (mapH - 44 * dpr) + 34 * dpr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }

      // Legend at top of chart
      balls.forEach((b, i) => {
        ctx.fillStyle = b.color;
        ctx.font = `600 ${10.5 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`■ ${b.label}`, rx + 10 * dpr + i * (rw * 0.32), mapY + 18 * dpr);
      });
    },
  };
}

// ---- 3. Fig 2: Live Interactive Backpropagation Computation Graph ----------

export function mountBackpropGraphDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.54);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let x = 1.5;
  let w1 = 0.6;
  let b1 = -0.2;
  let w2 = -0.8;
  let target = 1.2;
  let stepNum = 0;

  const sW1 = shell.slider({ label: "weight w₁", min: -2, max: 2, step: 0.05, value: w1, onInput: (v) => (w1 = v) });
  const sB1 = shell.slider({ label: "bias b₁", min: -2, max: 2, step: 0.05, value: b1, onInput: (v) => (b1 = v) });
  const sW2 = shell.slider({ label: "weight w₂", min: -2, max: 2, step: 0.05, value: w2, onInput: (v) => (w2 = v) });
  shell.slider({ label: "target y", min: -2, max: 2, step: 0.1, value: target, onInput: (v) => (target = v) });

  const compute = () => {
    // Forward pass: u = w1 * x, z = u + b1, h = silu(z), yhat = w2 * h, err = yhat - target, L = 0.5 * err^2
    const u = w1 * x;
    const z = u + b1;
    const sig = 1 / (1 + Math.exp(-z));
    const h = z * sig;
    const yhat = w2 * h;
    const err = yhat - target;
    const L = 0.5 * err * err;

    // Backward pass (chain rule, right to left!)
    const dL_dyhat = err;
    const dL_dw2 = dL_dyhat * h;
    const dL_dh = dL_dyhat * w2;
    const dSiLU = sig * (1 + z * (1 - sig));
    const dL_dz = dL_dh * dSiLU;
    const dL_db1 = dL_dz * 1;
    const dL_du = dL_dz * 1;
    const dL_dw1 = dL_du * x;
    const dL_dx = dL_du * w1;

    return { u, z, h, yhat, err, L, dSiLU, dL_dyhat, dL_dw2, dL_dh, dL_dz, dL_db1, dL_du, dL_dw1, dL_dx };
  };

  const syncSliders = () => {
    sW1.value = String(Math.max(-2, Math.min(2, Number(w1.toFixed(3)))));
    sB1.value = String(Math.max(-2, Math.min(2, Number(b1.toFixed(3)))));
    sW2.value = String(Math.max(-2, Math.min(2, Number(w2.toFixed(3)))));
  };

  const takeGradSteps = (n: number) => {
    const lr = 0.12;
    for (let i = 0; i < n; i++) {
      const c = compute();
      w1 -= lr * c.dL_dw1;
      b1 -= lr * c.dL_db1;
      w2 -= lr * c.dL_dw2;
      stepNum++;
    }
    syncSliders();
  };

  shell.button("take 1 step", () => takeGradSteps(1));
  shell.button("run 20 steps", () => takeGradSteps(20));
  shell.button("reset", () => {
    x = 1.5;
    w1 = 0.6;
    b1 = -0.2;
    w2 = -0.8;
    target = 1.2;
    stepNum = 0;
    syncSliders();
  });

  let infoStr = "";
  shell.setInfo(() => infoStr);

  return {
    frame() {
      shell.tick();
      const c = compute();
      infoStr = `step ${stepNum} · pred ŷ = ${c.yhat.toFixed(3)} vs target ${target.toFixed(2)} · loss L = ${c.L.toFixed(4)} · ∂L/∂w₁ = ${c.dL_dw1.toFixed(3)}`;

      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 22 * dpr;

      // Top legend
      ctx.textAlign = "left";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "#7aa2ff";
      ctx.fillText("→ FORWARD VALUE (left to right)", pad, pad + 8 * dpr);
      ctx.fillStyle = "#ffb86b";
      ctx.fillText("← BACKWARD GRADIENT ∂L/∂node (right to left)", pad + 265 * dpr, pad + 8 * dpr);

      // Node coordinates across canvas
      const yMid = H * 0.42;
      const yTop = H * 0.22;
      const yBot = H * 0.62;
      const xs = [0.09, 0.252, 0.415, 0.578, 0.742, 0.91].map((f) => W * f);

      interface GNode {
        id: string;
        title: string;
        val: number;
        grad: number;
        px: number;
        py: number;
        param?: boolean;
        loss?: boolean;
      }

      const nodes: GNode[] = [
        { id: "x", title: "input x", val: x, grad: c.dL_dx, px: xs[0], py: yTop },
        { id: "w1", title: "w₁", val: w1, grad: c.dL_dw1, px: xs[0], py: yMid, param: true },
        { id: "b1", title: "b₁", val: b1, grad: c.dL_db1, px: xs[1], py: yBot, param: true },
        { id: "u", title: "u = w₁·x", val: c.u, grad: c.dL_du, px: xs[1], py: yMid - 28 * dpr },
        { id: "z", title: "z = u+b₁", val: c.z, grad: c.dL_dz, px: xs[2], py: yMid },
        { id: "h", title: "h = SiLU(z)", val: c.h, grad: c.dL_dh, px: xs[3], py: yMid },
        { id: "w2", title: "w₂", val: w2, grad: c.dL_dw2, px: xs[3], py: yBot, param: true },
        { id: "yhat", title: "ŷ = w₂·h", val: c.yhat, grad: c.dL_dyhat, px: xs[4], py: yMid },
        { id: "L", title: "Loss ½(ŷ−y)²", val: c.L, grad: 1.0, px: xs[5], py: yMid, loss: true },
      ];

      const byId = new Map(nodes.map((n) => [n.id, n]));
      const edges: [string, string][] = [
        ["x", "u"],
        ["w1", "u"],
        ["u", "z"],
        ["b1", "z"],
        ["z", "h"],
        ["h", "yhat"],
        ["w2", "yhat"],
        ["yhat", "L"],
      ];

      const bw = Math.min(98 * dpr, W * 0.125);
      const bh = 54 * dpr;

      // Draw wires
      for (const [fromId, toId] of edges) {
        const a = byId.get(fromId)!;
        const b = byId.get(toId)!;
        ctx.strokeStyle = "rgba(122, 162, 255, 0.42)";
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(a.px + bw * 0.48, a.py);
        ctx.lineTo(b.px - bw * 0.48, b.py);
        ctx.stroke();
      }

      // Draw boxes
      for (const n of nodes) {
        const rx = n.px - bw * 0.5;
        const ry = n.py - bh * 0.5;
        ctx.fillStyle = n.param
          ? "rgba(22, 34, 46, 0.96)"
          : n.loss
            ? "rgba(44, 22, 34, 0.95)"
            : "rgba(16, 20, 34, 0.96)";
        ctx.strokeStyle = n.param ? "#5ef0b5" : n.loss ? "#ff7a8a" : "rgba(122, 162, 255, 0.45)";
        ctx.lineWidth = (n.param || n.loss ? 1.8 : 1.2) * dpr;
        ctx.fillRect(rx, ry, bw, bh);
        ctx.strokeRect(rx, ry, bw, bh);

        ctx.textAlign = "center";
        ctx.fillStyle = n.param ? "#5ef0b5" : n.loss ? "#ff9eab" : "#b8c4e4";
        ctx.font = `600 ${10 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(n.title, n.px, ry + 15 * dpr);

        ctx.fillStyle = "#9ec0ff";
        ctx.font = `700 ${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`val ${n.val.toFixed(2)}`, n.px, ry + 32 * dpr);

        ctx.fillStyle = "#ffb86b";
        ctx.font = `600 ${10.5 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`grad ${n.grad >= 0 ? "+" : ""}${n.grad.toFixed(2)}`, n.px, ry + 47 * dpr);
      }

      // Bottom live Chain Rule strip so the reader can check the math!
      const sy = H - 72 * dpr;
      ctx.fillStyle = "rgba(15, 19, 32, 0.92)";
      ctx.strokeStyle = "rgba(255, 184, 107, 0.35)";
      ctx.lineWidth = dpr;
      ctx.fillRect(pad, sy, W - pad * 2, 54 * dpr);
      ctx.strokeRect(pad, sy, W - pad * 2, 54 * dpr);

      ctx.textAlign = "left";
      ctx.fillStyle = "#ffb86b";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("LIVE CHAIN RULE FOR w₁ (MULTIPLY LOCAL SLOPES RIGHT → LEFT):", pad + 12 * dpr, sy + 20 * dpr);

      ctx.fillStyle = "#eef2ff";
      ctx.font = `${11.5 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText(
        `∂L/∂w₁ = (ŷ − y)·(w₂)·(SiLU'(z))·(x) = (${c.err.toFixed(2)})·(${w2.toFixed(2)})·(${c.dSiLU.toFixed(2)})·(${x.toFixed(2)}) = ${c.dL_dw1.toFixed(3)}`,
        pad + 12 * dpr,
        sy + 41 * dpr,
      );
    },
  };
}
