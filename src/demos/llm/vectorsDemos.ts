// Part 2 Figures ("Numbers That Point"):
//  1. mountVectorsHero         — Animated 2D linear transformation morphing a coordinate grid
//  2. mountDotProductDemo      — Interactive draggable 2D vectors, projection & dot product lab
//  3. mountMatrixTransformDemo — Live 2×2 matrix space-warper with basis arrows & determinant area
//  4. mountNonlinearFoldDemo   — Live Linear vs. 2-layer neural network folding space to solve XOR/Rings

import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";

// ---- Helpers ---------------------------------------------------------------

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  head = 10,
): void {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.hypot(x2 - x1, y2 - y1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(ang) * Math.min(head * 0.7, len * 0.5), y2 - Math.sin(ang) * Math.min(head * 0.7, len * 0.5));
  ctx.stroke();

  if (len > 4) {
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head);
    ctx.lineTo(x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head);
    ctx.closePath();
    ctx.fill();
  }
}

// ---- 1. Hero: Animated 2D Linear Transformation Grid -----------------------

export function mountVectorsHero(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.46);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  const stages: { name: string; m: [number, number, number, number] }[] = [
    { name: "Identity", m: [1, 0, 0, 1] },
    { name: "Shear", m: [1, 0.85, 0, 1] },
    { name: "Rotate 55°", m: [Math.cos(0.96), -Math.sin(0.96), Math.sin(0.96), Math.cos(0.96)] },
    { name: "Stretch & Tilt", m: [1.45, 0.35, -0.3, 0.75] },
    { name: "Mirror & Twist", m: [-0.9, 0.7, 0.6, 0.95] },
  ];

  // Constellation of sample points
  const pts: [number, number][] = [];
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2;
    const r = 1.2 + 0.85 * Math.sin(i * 1.7);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }

  let infoStr = "A matrix moves every point in space at once";
  shell.setInfo(() => infoStr);

  return {
    frame() {
      shell.tick();
      const t = performance.now() * 0.00038;
      const idx = Math.floor(t) % stages.length;
      const nxt = (idx + 1) % stages.length;
      const raw = t - Math.floor(t);
      const u = raw * raw * (3 - 2 * raw); // smoothstep

      const m0 = stages[idx].m;
      const m1 = stages[nxt].m;
      const a = m0[0] + (m1[0] - m0[0]) * u;
      const b = m0[1] + (m1[1] - m0[1]) * u;
      const c = m0[2] + (m1[2] - m0[2]) * u;
      const d = m0[3] + (m1[3] - m0[3]) * u;
      const det = a * d - b * c;
      infoStr = `W = [[${a.toFixed(2)}, ${b.toFixed(2)}], [${c.toFixed(2)}, ${d.toFixed(2)}]] · area scale |det| = ${Math.abs(det).toFixed(2)}×`;

      ctx.fillStyle = "#080a12";
      ctx.fillRect(0, 0, W, H);

      const cx = W * 0.5;
      const cy = H * 0.48;
      const unit = Math.min(W, H) * 0.145;
      const toScreen = (x: number, y: number): [number, number] => [cx + x * unit, cy - y * unit];
      const xform = (x: number, y: number): [number, number] => [a * x + b * y, c * x + d * y];

      // Subtle original reference grid
      ctx.strokeStyle = "rgba(122, 162, 255, 0.08)";
      ctx.lineWidth = dpr;
      for (let g = -6; g <= 6; g++) {
        const [x0, y0] = toScreen(g, -5);
        const [x1, y1] = toScreen(g, 5);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        const [h0, hy0] = toScreen(-7, g);
        const [h1, hy1] = toScreen(7, g);
        ctx.beginPath();
        ctx.moveTo(h0, hy0);
        ctx.lineTo(h1, hy1);
        ctx.stroke();
      }

      // Transformed grid lines
      for (let g = -6; g <= 6; g++) {
        const isAxis = g === 0;
        ctx.strokeStyle = isAxis ? "rgba(122, 162, 255, 0.42)" : "rgba(122, 162, 255, 0.19)";
        ctx.lineWidth = (isAxis ? 1.6 : 1) * dpr;

        const [vx0, vy0] = toScreen(...xform(g, -6));
        const [vx1, vy1] = toScreen(...xform(g, 6));
        ctx.beginPath();
        ctx.moveTo(vx0, vy0);
        ctx.lineTo(vx1, vy1);
        ctx.stroke();

        const [hx0, hy0] = toScreen(...xform(-7, g));
        const [hx1, hy1] = toScreen(...xform(7, g));
        ctx.beginPath();
        ctx.moveTo(hx0, hy0);
        ctx.lineTo(hx1, hy1);
        ctx.stroke();
      }

      // Unit square image (determinant parallelogram)
      const p00 = toScreen(0, 0);
      const p10 = toScreen(...xform(1, 0));
      const p11 = toScreen(...xform(1, 1));
      const p01 = toScreen(...xform(0, 1));
      ctx.fillStyle = det >= 0 ? "rgba(94, 240, 181, 0.14)" : "rgba(255, 122, 162, 0.15)";
      ctx.beginPath();
      ctx.moveTo(p00[0], p00[1]);
      ctx.lineTo(p10[0], p10[1]);
      ctx.lineTo(p11[0], p11[1]);
      ctx.lineTo(p01[0], p01[1]);
      ctx.closePath();
      ctx.fill();

      // Transformed constellation points
      for (const [px, py] of pts) {
        const [tx, ty] = toScreen(...xform(px, py));
        ctx.fillStyle = "rgba(232, 238, 252, 0.65)";
        ctx.beginPath();
        ctx.arc(tx, ty, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Basis vectors i-hat and j-hat
      drawArrow(ctx, p00[0], p00[1], p10[0], p10[1], "#5ef0b5", 3 * dpr, 11 * dpr);
      drawArrow(ctx, p00[0], p00[1], p01[0], p01[1], "#ffb86b", 3 * dpr, 11 * dpr);
    },
  };
}

// ---- 2. Fig 1: Interactive Draggable Dot Product Sandbox -------------------

export function mountDotProductDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let ax = 2.4;
  let ay = 1.2;
  let bx = 2.0;
  let by = -0.6;
  let dragging: "a" | "b" | null = null;

  const plane = () => {
    const pad = 22 * dpr;
    const planeW = W * 0.56;
    const cx = pad + planeW * 0.5;
    const cy = H * 0.52;
    const unit = Math.min(planeW, H) * 0.125;
    return { pad, planeW, cx, cy, unit };
  };

  const toScreen = (x: number, y: number): [number, number] => {
    const { cx, cy, unit } = plane();
    return [cx + x * unit, cy - y * unit];
  };
  const fromEvent = (e: PointerEvent): [number, number] => {
    const r = shell.canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const { cx, cy, unit } = plane();
    return [(sx - cx) / unit, (cy - sy) / unit];
  };

  shell.canvas.style.cursor = "grab";
  shell.canvas.addEventListener("pointerdown", (e) => {
    const [wx, wy] = fromEvent(e);
    const da = Math.hypot(wx - ax, wy - ay);
    const db = Math.hypot(wx - bx, wy - by);
    if (Math.min(da, db) < 0.75) {
      dragging = da <= db ? "a" : "b";
      shell.canvas.setPointerCapture(e.pointerId);
      shell.canvas.style.cursor = "grabbing";
    }
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const [wx, wy] = fromEvent(e);
    const cx = Math.max(-3.6, Math.min(3.6, Math.round(wx * 5) / 5));
    const cy = Math.max(-3.2, Math.min(3.2, Math.round(wy * 5) / 5));
    if (dragging === "a") {
      ax = cx;
      ay = cy;
    } else {
      bx = cx;
      by = cy;
    }
  });
  shell.canvas.addEventListener("pointerup", () => {
    dragging = null;
    shell.canvas.style.cursor = "grab";
  });

  shell.button("aligned", () => {
    ax = 2.6;
    ay = 1.2;
    bx = 2.2;
    by = 1.0;
  });
  shell.button("perpendicular (0)", () => {
    ax = 2.4;
    ay = 1.2;
    bx = -1.2;
    by = 2.4;
  });
  shell.button("opposite (−)", () => {
    ax = 2.4;
    ay = 1.2;
    bx = -2.4;
    by = -1.2;
  });

  let infoStr = "";
  shell.setInfo(() => infoStr);

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const { pad, planeW, cx, cy, unit } = plane();

      const dot = ax * bx + ay * by;
      const magA = Math.hypot(ax, ay);
      const magB = Math.hypot(bx, by);
      const cosT = magA * magB > 1e-6 ? Math.max(-1, Math.min(1, dot / (magA * magB))) : 0;
      const deg = (Math.acos(cosT) * 180) / Math.PI;
      infoStr = `a · b = ${dot.toFixed(2)} · angle θ = ${deg.toFixed(1)}° · cosine similarity = ${cosT.toFixed(2)}`;

      // Grid inside left region
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad, pad, planeW, H - pad * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(14, 17, 29, 0.9)";
      ctx.fillRect(pad, pad, planeW, H - pad * 2);

      for (let g = -4; g <= 4; g++) {
        ctx.strokeStyle = g === 0 ? "rgba(122,162,255,0.3)" : "rgba(122,162,255,0.1)";
        ctx.lineWidth = dpr;
        const [vx] = toScreen(g, 0);
        ctx.beginPath();
        ctx.moveTo(vx, pad);
        ctx.lineTo(vx, H - pad);
        ctx.stroke();

        const [, hy] = toScreen(0, g);
        ctx.beginPath();
        ctx.moveTo(pad, hy);
        ctx.lineTo(pad + planeW, hy);
        ctx.stroke();
      }

      // Projection of a onto b
      const [ox, oy] = toScreen(0, 0);
      const [asx, asy] = toScreen(ax, ay);
      const [bsx, bsy] = toScreen(bx, by);
      if (magB > 0.05) {
        const projScale = dot / (magB * magB);
        const [px, py] = toScreen(bx * projScale, by * projScale);
        // Extended line along b
        ctx.strokeStyle = "rgba(255, 184, 107, 0.16)";
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(cx - (bx / magB) * unit * 5, cy + (by / magB) * unit * 5);
        ctx.lineTo(cx + (bx / magB) * unit * 5, cy - (by / magB) * unit * 5);
        ctx.stroke();
        // Drop line from a tip to projection
        ctx.strokeStyle = "rgba(94, 240, 181, 0.65)";
        ctx.beginPath();
        ctx.moveTo(asx, asy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);
        // Highlight shadow segment on b
        ctx.strokeStyle = "#5ef0b5";
        ctx.lineWidth = 4 * dpr;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(px, py);
        ctx.stroke();
      }

      // Angle wedge
      if (magA > 0.1 && magB > 0.1) {
        const angA = Math.atan2(-ay, ax);
        const angB = Math.atan2(-by, bx);
        let diff = angB - angA;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        ctx.fillStyle = "rgba(94, 240, 181, 0.14)";
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.arc(ox, oy, 32 * dpr, angA, angA + diff, diff < 0);
        ctx.closePath();
        ctx.fill();
      }

      // Vectors a & b with grab handles
      drawArrow(ctx, ox, oy, asx, asy, "#7aa2ff", 3 * dpr, 11 * dpr);
      drawArrow(ctx, ox, oy, bsx, bsy, "#ffb86b", 3 * dpr, 11 * dpr);

      const drawHandle = (x: number, y: number, col: string, lbl: string) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, 7.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0a0c14";
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.font = `700 ${11.5 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = col;
        const nearRight = x > pad + planeW - 115 * dpr;
        ctx.textAlign = nearRight ? "right" : "left";
        const lx = nearRight ? x - 11 * dpr : x + 11 * dpr;
        const ly = y > cy ? y + 19 * dpr : y < pad + 26 * dpr ? y + 18 * dpr : y - 10 * dpr;
        ctx.fillText(lbl, lx, ly);
      };
      drawHandle(asx, asy, "#7aa2ff", `a=[${ax.toFixed(1)}, ${ay.toFixed(1)}]`);
      drawHandle(bsx, bsy, "#ffb86b", `b=[${bx.toFixed(1)}, ${by.toFixed(1)}]`);
      ctx.restore();

      ctx.strokeStyle = "rgba(122,162,255,0.22)";
      ctx.lineWidth = dpr;
      ctx.strokeRect(pad, pad, planeW, H - pad * 2);

      // Right side: Exact Algebra + Geometry Breakdown
      const rx = pad * 2 + planeW;
      const rw = W - rx - pad;
      let y = pad + 18 * dpr;
      ctx.textAlign = "left";

      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("ALGEBRA (MULTIPLY & ADD)", rx, y);
      y += 24 * dpr;

      ctx.fillStyle = "#eef2ff";
      ctx.font = `${12.5 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`a·b = (${ax.toFixed(1)})(${bx.toFixed(1)}) + (${ay.toFixed(1)})(${by.toFixed(1)})`, rx, y);
      y += 22 * dpr;
      ctx.fillStyle = "#b7c4e6";
      ctx.fillText(`    = ${(ax * bx).toFixed(2)} + ${(ay * by).toFixed(2)}`, rx, y);
      y += 26 * dpr;
      ctx.font = `700 ${20 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = dot > 0.15 ? "#5ef0b5" : dot < -0.15 ? "#ff7a8a" : "#cfd7f0";
      ctx.fillText(`    = ${dot.toFixed(2)}`, rx, y);

      y += 38 * dpr;
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("GEOMETRY (LENGTHS × ALIGNMENT)", rx, y);
      y += 24 * dpr;
      ctx.fillStyle = "#dce3f7";
      ctx.font = `${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`|a| = ${magA.toFixed(2)}   |b| = ${magB.toFixed(2)}`, rx, y);
      y += 21 * dpr;
      ctx.fillText(`θ   = ${deg.toFixed(1)}°   cos(θ) = ${cosT.toFixed(2)}`, rx, y);
      y += 21 * dpr;
      ctx.fillStyle = "#5ef0b5";
      ctx.fillText(`|a|·|b|·cos(θ) = ${(magA * magB * cosT).toFixed(2)}`, rx, y);

      // Cosine similarity bar (-1 to +1)
      y += 38 * dpr;
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("COSINE SIMILARITY (−1 TO +1)", rx, y);
      y += 14 * dpr;
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fillRect(rx, y, rw, 20 * dpr);
      const midX = rx + rw * 0.5;
      ctx.fillStyle = cosT >= 0 ? "#5ef0b5" : "#ff7a8a";
      const len = (cosT * rw) * 0.5;
      ctx.fillRect(len >= 0 ? midX : midX + len, y, Math.abs(len), 20 * dpr);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.moveTo(midX, y - 3 * dpr);
      ctx.lineTo(midX, y + 23 * dpr);
      ctx.stroke();

      y += 38 * dpr;
      ctx.fillStyle = "#98a4c4";
      ctx.font = `${11.5 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      const verdict =
        cosT > 0.75
          ? "Strong match — arrows point nearly the same way."
          : cosT < -0.75
            ? "Opposite directions — negative alignment."
            : Math.abs(cosT) < 0.15
              ? "Perpendicular (orthogonal) — completely unrelated."
              : cosT > 0
                ? "Partial match — positive shadow along b."
                : "Slightly opposed — negative shadow along b.";
      ctx.fillText(verdict, rx, y);
    },
  };
}

// ---- 3. Fig 2: Live 2×2 Matrix Space-Warper --------------------------------

export function mountMatrixTransformDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let a = 1.2;
  let b = 0.6;
  let c = -0.3;
  let d = 1.0;
  let vx = 1.5;
  let vy = 1.0;
  let dragging = false;

  const sA = shell.slider({ label: "W[0,0] (a)", min: -2, max: 2, step: 0.1, value: a, onInput: (v) => (a = v) });
  const sB = shell.slider({ label: "W[0,1] (b)", min: -2, max: 2, step: 0.1, value: b, onInput: (v) => (b = v) });
  const sC = shell.slider({ label: "W[1,0] (c)", min: -2, max: 2, step: 0.1, value: c, onInput: (v) => (c = v) });
  const sD = shell.slider({ label: "W[1,1] (d)", min: -2, max: 2, step: 0.1, value: d, onInput: (v) => (d = v) });

  const setM = (na: number, nb: number, nc: number, nd: number) => {
    a = na;
    b = nb;
    c = nc;
    d = nd;
    sA.value = String(na);
    sB.value = String(nb);
    sC.value = String(nc);
    sD.value = String(nd);
  };

  shell.button("identity", () => setM(1, 0, 0, 1));
  shell.button("rotate 45°", () => setM(0.7, -0.7, 0.7, 0.7));
  shell.button("shear", () => setM(1, 0.9, 0, 1));
  shell.button("squash (rank 1)", () => setM(1.2, 0.6, 0.6, 0.3));

  const plane = () => {
    const pad = 22 * dpr;
    const planeW = W * 0.58;
    const cx = pad + planeW * 0.5;
    const cy = H * 0.52;
    const unit = Math.min(planeW, H) * 0.13;
    return { pad, planeW, cx, cy, unit };
  };
  const toScreen = (x: number, y: number): [number, number] => {
    const { cx, cy, unit } = plane();
    return [cx + x * unit, cy - y * unit];
  };

  shell.canvas.style.cursor = "grab";
  shell.canvas.addEventListener("pointerdown", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const { cx, cy, unit } = plane();
    const wx = (sx - cx) / unit;
    const wy = (cy - sy) / unit;
    if (Math.hypot(wx - vx, wy - vy) < 0.85) {
      dragging = true;
      shell.canvas.setPointerCapture(e.pointerId);
      shell.canvas.style.cursor = "grabbing";
    }
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const r = shell.canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const { cx, cy, unit } = plane();
    vx = Math.max(-3.0, Math.min(3.0, Math.round(((sx - cx) / unit) * 5) / 5));
    vy = Math.max(-2.6, Math.min(2.6, Math.round(((cy - sy) / unit) * 5) / 5));
  });
  shell.canvas.addEventListener("pointerup", () => {
    dragging = false;
    shell.canvas.style.cursor = "grab";
  });

  let infoStr = "";
  shell.setInfo(() => infoStr);

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const { pad, planeW } = plane();

      const outX = a * vx + b * vy;
      const outY = c * vx + d * vy;
      const det = a * d - b * c;
      infoStr = `W·x = [${outX.toFixed(2)}, ${outY.toFixed(2)}] · unit-square area det(W) = ${det.toFixed(2)}`;

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad, pad, planeW, H - pad * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(14, 17, 29, 0.9)";
      ctx.fillRect(pad, pad, planeW, H - pad * 2);

      // Original faint grid
      ctx.strokeStyle = "rgba(122, 162, 255, 0.07)";
      ctx.lineWidth = dpr;
      for (let g = -5; g <= 5; g++) {
        const [x0, y0] = toScreen(g, -5);
        const [x1, y1] = toScreen(g, 5);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const [hx0, hy0] = toScreen(-5, g);
        const [hx1, hy1] = toScreen(5, g);
        ctx.beginPath();
        ctx.moveTo(hx0, hy0);
        ctx.lineTo(hx1, hy1);
        ctx.stroke();
      }

      // Warped grid
      const xf = (x: number, y: number): [number, number] => [a * x + b * y, c * x + d * y];
      for (let g = -5; g <= 5; g++) {
        ctx.strokeStyle = g === 0 ? "rgba(122, 162, 255, 0.45)" : "rgba(122, 162, 255, 0.2)";
        ctx.lineWidth = (g === 0 ? 1.6 : 1) * dpr;
        const [v0x, v0y] = toScreen(...xf(g, -5));
        const [v1x, v1y] = toScreen(...xf(g, 5));
        ctx.beginPath();
        ctx.moveTo(v0x, v0y);
        ctx.lineTo(v1x, v1y);
        ctx.stroke();

        const [h0x, h0y] = toScreen(...xf(-5, g));
        const [h1x, h1y] = toScreen(...xf(5, g));
        ctx.beginPath();
        ctx.moveTo(h0x, h0y);
        ctx.lineTo(h1x, h1y);
        ctx.stroke();
      }

      // Transformed unit square
      const o = toScreen(0, 0);
      const iTip = toScreen(a, c);
      const jTip = toScreen(b, d);
      const ijTip = toScreen(a + b, c + d);
      ctx.fillStyle = Math.abs(det) < 0.05 ? "rgba(255,122,138,0.22)" : "rgba(94, 240, 181, 0.14)";
      ctx.beginPath();
      ctx.moveTo(o[0], o[1]);
      ctx.lineTo(iTip[0], iTip[1]);
      ctx.lineTo(ijTip[0], ijTip[1]);
      ctx.lineTo(jTip[0], jTip[1]);
      ctx.closePath();
      ctx.fill();

      // Basis columns
      drawArrow(ctx, o[0], o[1], iTip[0], iTip[1], "#5ef0b5", 2.6 * dpr, 10 * dpr);
      drawArrow(ctx, o[0], o[1], jTip[0], jTip[1], "#ffb86b", 2.6 * dpr, 10 * dpr);

      // Input x (dashed white/blue) and output Wx (bright pink)
      const xTip = toScreen(vx, vy);
      const yTip = toScreen(outX, outY);
      ctx.save();
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      drawArrow(ctx, o[0], o[1], xTip[0], xTip[1], "#9ec0ff", 2 * dpr, 9 * dpr);
      ctx.restore();
      drawArrow(ctx, o[0], o[1], yTip[0], yTip[1], "#ff7ab8", 3 * dpr, 11 * dpr);

      // Draggable handle on x
      ctx.fillStyle = "#9ec0ff";
      ctx.beginPath();
      ctx.arc(xTip[0], xTip[1], 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#dce7ff";
      ctx.font = `700 ${11.5 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("x (drag)", xTip[0] + 10 * dpr, xTip[1] - 5 * dpr);
      ctx.fillStyle = "#ff7ab8";
      ctx.fillText("W·x", yTip[0] + 10 * dpr, yTip[1] - 5 * dpr);

      ctx.restore();
      ctx.strokeStyle = "rgba(122,162,255,0.22)";
      ctx.lineWidth = dpr;
      ctx.strokeRect(pad, pad, planeW, H - pad * 2);

      // Right side: Row-dot-product readout + Column interpretation
      const rx = pad * 2 + planeW;
      let y = pad + 18 * dpr;
      ctx.textAlign = "left";
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("MATRIX × VECTOR = 2 DOT PRODUCTS", rx, y);
      y += 26 * dpr;

      ctx.font = `${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "#eef2ff";
      ctx.fillText(`row 0 · x = (${a.toFixed(1)})(${vx.toFixed(1)}) + (${b.toFixed(1)})(${vy.toFixed(1)})`, rx, y);
      y += 20 * dpr;
      ctx.fillStyle = "#ff7ab8";
      ctx.font = `700 ${13 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`          = ${outX.toFixed(2)}`, rx, y);

      y += 28 * dpr;
      ctx.font = `${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "#eef2ff";
      ctx.fillText(`row 1 · x = (${c.toFixed(1)})(${vx.toFixed(1)}) + (${d.toFixed(1)})(${vy.toFixed(1)})`, rx, y);
      y += 20 * dpr;
      ctx.fillStyle = "#ff7ab8";
      ctx.font = `700 ${13 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`          = ${outY.toFixed(2)}`, rx, y);

      y += 38 * dpr;
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("WHERE THE AXES LAND (COLUMNS)", rx, y);
      y += 24 * dpr;
      ctx.font = `${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "#5ef0b5";
      ctx.fillText(`î = [1, 0] → [${a.toFixed(1)}, ${c.toFixed(1)}]`, rx, y);
      y += 21 * dpr;
      ctx.fillStyle = "#ffb86b";
      ctx.fillText(`ĵ = [0, 1] → [${b.toFixed(1)}, ${d.toFixed(1)}]`, rx, y);

      y += 34 * dpr;
      ctx.fillStyle = Math.abs(det) < 0.05 ? "#ff7a8a" : "#9aa4c2";
      ctx.font = `${11.5 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(
        Math.abs(det) < 0.05
          ? "Collapsed to a line! Area = 0 (information lost)."
          : det < 0
            ? `Flipped space inside-out (det = ${det.toFixed(2)}).`
            : `Unit square stretched by ${det.toFixed(2)}×.`,
        rx,
        y,
      );
    },
  };
}

// ---- 4. Fig 3: Linear Wall vs. Nonlinear Space Folding (XOR / Rings) -------

export function mountNonlinearFoldDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.54);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  type TaskKind = "xor" | "rings";
  let task: TaskKind = "xor";
  let nonlinear = true;
  let hiddenN = 4;
  let stepCount = 0;
  let training = true;

  interface Sample {
    x: number;
    y: number;
    label: number; // 0 or 1
  }
  let data: Sample[] = [];

  const makeData = () => {
    data = [];
    let s = 42;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    if (task === "xor") {
      const centers: [number, number, number][] = [
        [-0.62, -0.62, 0],
        [0.62, 0.62, 0],
        [-0.62, 0.62, 1],
        [0.62, -0.62, 1],
      ];
      for (const [cx, cy, lbl] of centers) {
        for (let i = 0; i < 14; i++) {
          data.push({ x: cx + (rng() - 0.5) * 0.48, y: cy + (rng() - 0.5) * 0.48, label: lbl });
        }
      }
    } else {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + rng() * 0.15;
        const r = 0.28 + rng() * 0.18;
        data.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, label: 1 });
      }
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2 + rng() * 0.15;
        const r = 0.78 + rng() * 0.18;
        data.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, label: 0 });
      }
    }
  };

  // Tiny 2 -> H -> 1 MLP weights
  let w1 = new Float32Array(0);
  let b1 = new Float32Array(0);
  let w2 = new Float32Array(0);
  let b2 = 0;
  let lastLoss = 0.69;
  let lastAcc = 0.5;

  const initNet = () => {
    stepCount = 0;
    let s = 1337 + hiddenN * 71 + (task === "rings" ? 99 : 0);
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s / 4294967296) * 2 - 1;
    };
    w1 = new Float32Array(hiddenN * 2);
    b1 = new Float32Array(hiddenN);
    w2 = new Float32Array(hiddenN);
    for (let h = 0; h < hiddenN; h++) {
      w1[h * 2] = rng() * 1.4;
      w1[h * 2 + 1] = rng() * 1.4;
      b1[h] = rng() * 0.4;
      w2[h] = rng() * 1.2;
    }
    b2 = 0;
    lastLoss = 0.69;
  };

  const act = (z: number): number => (nonlinear ? Math.tanh(z) : z);
  const dAct = (_z: number, a: number): number => (nonlinear ? 1 - a * a : 1);

  const forwardOne = (x: number, y: number): { p: number; h: number[] } => {
    const h: number[] = [];
    let out = b2;
    for (let i = 0; i < hiddenN; i++) {
      const z = w1[i * 2] * x + w1[i * 2 + 1] * y + b1[i];
      const a = act(z);
      h.push(a);
      out += w2[i] * a;
    }
    const p = 1 / (1 + Math.exp(-Math.max(-18, Math.min(18, out))));
    return { p, h };
  };

  const trainSteps = (iters: number) => {
    const lr = nonlinear ? 0.14 : 0.05;
    for (let it = 0; it < iters; it++) {
      const gw1 = new Float32Array(w1.length);
      const gb1 = new Float32Array(b1.length);
      const gw2 = new Float32Array(w2.length);
      let gb2 = 0;
      let loss = 0;
      let ok = 0;

      for (const s of data) {
        const hs = new Float32Array(hiddenN);
        const zs = new Float32Array(hiddenN);
        let out = b2;
        for (let i = 0; i < hiddenN; i++) {
          zs[i] = w1[i * 2] * s.x + w1[i * 2 + 1] * s.y + b1[i];
          hs[i] = act(zs[i]);
          out += w2[i] * hs[i];
        }
        const p = 1 / (1 + Math.exp(-Math.max(-18, Math.min(18, out))));
        loss += -(s.label * Math.log(Math.max(1e-6, p)) + (1 - s.label) * Math.log(Math.max(1e-6, 1 - p)));
        if ((p >= 0.5 ? 1 : 0) === s.label) ok++;

        const dOut = (p - s.label) / data.length;
        gb2 += dOut;
        for (let i = 0; i < hiddenN; i++) {
          gw2[i] += dOut * hs[i];
          const dH = dOut * w2[i] * dAct(zs[i], hs[i]);
          gw1[i * 2] += dH * s.x;
          gw1[i * 2 + 1] += dH * s.y;
          gb1[i] += dH;
        }
      }

      for (let i = 0; i < w1.length; i++) w1[i] -= lr * gw1[i];
      for (let i = 0; i < b1.length; i++) b1[i] -= lr * gb1[i];
      for (let i = 0; i < w2.length; i++) w2[i] -= lr * gw2[i];
      b2 -= lr * gb2;
      lastLoss = loss / data.length;
      lastAcc = ok / data.length;
      stepCount++;
    }
  };

  makeData();
  initNet();

  const actBtn = shell.button("activation: tanh (bend ON)", () => {
    nonlinear = !nonlinear;
    actBtn.textContent = nonlinear ? "activation: tanh (bend ON)" : "activation: LINEAR (bend OFF)";
    initNet();
    training = true;
  });
  const taskBtn = shell.button("task: XOR", () => {
    task = task === "xor" ? "rings" : "xor";
    taskBtn.textContent = `task: ${task === "xor" ? "XOR" : "Rings"}`;
    makeData();
    initNet();
    training = true;
  });
  shell.slider({
    label: "hidden neurons",
    min: 2,
    max: 6,
    step: 1,
    value: hiddenN,
    onInput: (v) => {
      hiddenN = Math.round(v);
      initNet();
      training = true;
    },
  });
  shell.button("reset & retrain", () => {
    initNet();
    training = true;
  });

  shell.setInfo(
    () =>
      `step ${stepCount} · accuracy ${(lastAcc * 100).toFixed(0)}% · loss ${lastLoss.toFixed(3)} · ${
        nonlinear ? "bend folds space so a straight cut works" : "pure matrices can only draw one straight line!"
      }`,
  );

  return {
    frame() {
      shell.tick();
      if (training && stepCount < 420) {
        trainSteps(4);
      }

      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 24 * dpr;
      const boxW = (W - pad * 3) * 0.5;
      const boxY = pad + 24 * dpr;
      const boxH = H - boxY - pad;

      // Left panel: Input space decision heatmap + dots
      ctx.textAlign = "left";
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("1. INPUT SPACE (DECISION BOUNDARY)", pad, pad + 10 * dpr);

      const res = 28;
      const cw = boxW / res;
      const ch = boxH / res;
      for (let ry = 0; ry < res; ry++) {
        for (let rx = 0; rx < res; rx++) {
          const x = ((rx + 0.5) / res) * 2.4 - 1.2;
          const y = (1 - (ry + 0.5) / res) * 2.4 - 1.2;
          const { p } = forwardOne(x, y);
          ctx.fillStyle =
            p >= 0.5
              ? `rgba(94, 240, 181, ${0.08 + (p - 0.5) * 0.55})`
              : `rgba(122, 162, 255, ${0.08 + (0.5 - p) * 0.55})`;
          ctx.fillRect(pad + rx * cw, boxY + ry * ch, cw + 0.6, ch + 0.6);
        }
      }
      ctx.strokeStyle = "rgba(122,162,255,0.22)";
      ctx.lineWidth = dpr;
      ctx.strokeRect(pad, boxY, boxW, boxH);

      for (const s of data) {
        const px = pad + ((s.x + 1.2) / 2.4) * boxW;
        const py = boxY + (1 - (s.y + 1.2) / 2.4) * boxH;
        ctx.fillStyle = s.label === 1 ? "#5ef0b5" : "#7aa2ff";
        ctx.beginPath();
        ctx.arc(px, py, 4.8 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#080a12";
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
      }

      // Right panel: Warped Hidden-Layer Space (h0 vs h1) + final linear cut!
      const rx0 = pad * 2 + boxW;
      ctx.fillStyle = "#9aa4c2";
      ctx.fillText("2. HIDDEN SPACE (FOLDED SO A STRAIGHT CUT WORKS)", rx0, pad + 10 * dpr);
      ctx.fillStyle = "rgba(14, 17, 29, 0.9)";
      ctx.fillRect(rx0, boxY, boxW, boxH);
      ctx.strokeStyle = "rgba(122,162,255,0.22)";
      ctx.strokeRect(rx0, boxY, boxW, boxH);

      // Project hidden vector onto its 2 strongest output-aligned coordinates (or h[0], h[1])
      const idxA = 0;
      const idxB = Math.min(1, hiddenN - 1);
      const mapHidden = (h: number[]): [number, number] => {
        const u = Math.max(-1.3, Math.min(1.3, h[idxA]));
        const v = Math.max(-1.3, Math.min(1.3, h[idxB]));
        return [rx0 + ((u + 1.35) / 2.7) * boxW, boxY + (1 - (v + 1.35) / 2.7) * boxH];
      };

      // Faint warped coordinate mesh in hidden space
      ctx.strokeStyle = "rgba(122, 162, 255, 0.14)";
      ctx.lineWidth = dpr;
      for (let g = -1; g <= 1; g += 0.5) {
        ctx.beginPath();
        for (let k = 0; k <= 20; k++) {
          const t = -1.1 + (k / 20) * 2.2;
          const [hx, hy] = mapHidden(forwardOne(g, t).h);
          if (k === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k <= 20; k++) {
          const t = -1.1 + (k / 20) * 2.2;
          const [hx, hy] = mapHidden(forwardOne(t, g).h);
          if (k === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.stroke();
      }

      // Draw data points in folded hidden space
      for (const s of data) {
        const { h } = forwardOne(s.x, s.y);
        const [hx, hy] = mapHidden(h);
        ctx.fillStyle = s.label === 1 ? "#5ef0b5" : "#7aa2ff";
        ctx.beginPath();
        ctx.arc(hx, hy, 4.8 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#080a12";
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
      }

      // If hiddenN === 2, draw the exact straight output separating line w2[0]*h0 + w2[1]*h1 + b2 = 0
      if (hiddenN === 2 && Math.hypot(w2[0], w2[1]) > 0.05) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx0, boxY, boxW, boxH);
        ctx.clip();
        ctx.strokeStyle = "#ffb86b";
        ctx.lineWidth = 2.2 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        let p1: [number, number];
        let p2: [number, number];
        if (Math.abs(w2[1]) > Math.abs(w2[0])) {
          p1 = mapHidden([-1.3, (-b2 - w2[0] * -1.3) / w2[1]]);
          p2 = mapHidden([1.3, (-b2 - w2[0] * 1.3) / w2[1]]);
        } else {
          p1 = mapHidden([(-b2 - w2[1] * -1.3) / w2[0], -1.3]);
          p2 = mapHidden([(-b2 - w2[1] * 1.3) / w2[0], 1.3]);
        }
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}
