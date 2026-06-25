import { Shell, type Demo } from "../lib/demoShell";

const TAU = Math.PI * 2;

const C = {
  bg0: "#06070b",
  bg1: "#0b1020",
  panel: "#11131c",
  grid: "#2a2f42",
  text: "#d7dbe6",
  muted: "#8a91a5",
  accent: "#7aa2ff",
  warm: "#ffb86b",
  good: "#7dd6a0",
  red: "#ff8585",
  purple: "#b99cff",
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = smooth01(fx);
  const sy = smooth01(fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy) * 2 - 1;
}

function fbm(x: number, y: number, seed: number, octaves: number, warp = 0): number {
  let px = x;
  let py = y;
  if (warp > 0) {
    px += valueNoise(x * 0.45 + 13.7, y * 0.45 - 2.1, seed + 21) * warp;
    py += valueNoise(x * 0.45 - 7.5, y * 0.45 + 9.8, seed + 39) * warp;
  }
  let amp = 0.56;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise(px * freq, py * freq, seed + i * 101);
    sum += n * amp;
    norm += amp;
    freq *= 2.04;
    amp *= 0.52;
  }
  return sum / Math.max(norm, 1e-6);
}

function clear(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, C.bg1);
  g.addColorStop(1, C.bg0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { color?: string; size?: number; align?: CanvasTextAlign; mono?: boolean; weight?: number } = {},
): void {
  ctx.fillStyle = opts.color ?? C.text;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "middle";
  const size = opts.size ?? 13;
  const weight = opts.weight ?? 650;
  ctx.font = opts.mono
    ? `${size}px ui-monospace, Menlo, monospace`
    : `${weight} ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(text, x, y);
}

function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color = C.grid,
  width = 1,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 8): void {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "rgba(17, 19, 28, 0.78)";
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(122, 162, 255, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function canvasMetrics(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number } {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable");
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  const dpr = canvas.width / Math.max(cssW, 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH, dpr };
}

function terrainColor(v: number): string {
  const t = clamp((v + 1) * 0.5, 0, 1);
  if (t < 0.34) {
    const k = t / 0.34;
    return `rgb(${Math.round(28 + k * 34)}, ${Math.round(54 + k * 56)}, ${Math.round(96 + k * 30)})`;
  }
  if (t < 0.56) {
    const k = (t - 0.34) / 0.22;
    return `rgb(${Math.round(43 + k * 55)}, ${Math.round(92 + k * 70)}, ${Math.round(58 + k * 30)})`;
  }
  if (t < 0.82) {
    const k = (t - 0.56) / 0.26;
    return `rgb(${Math.round(112 + k * 68)}, ${Math.round(98 + k * 70)}, ${Math.round(78 + k * 86)})`;
  }
  const k = (t - 0.82) / 0.18;
  return `rgb(${Math.round(195 + k * 50)}, ${Math.round(202 + k * 43)}, ${Math.round(214 + k * 35)})`;
}

function drawTerrainMap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  octaves: number,
  warp: number,
): void {
  const step = Math.max(3, Math.floor(w / 150));
  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
      const nx = (px / w) * 7.2;
      const ny = (py / h) * 4.8;
      const v = fbm(nx, ny, seed, octaves, warp);
      ctx.fillStyle = terrainColor(v);
      ctx.fillRect(x + px, y + py, step + 0.5, step + 0.5);
    }
  }
}

function drawProfile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fn: (u: number) => number,
  color: string,
  width = 2,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i <= 220; i++) {
    const u = i / 220;
    const v = fn(u);
    const px = x + u * w;
    const py = y + h * (0.5 - v * 0.42);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

export function mountSeededNoise(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.64);
  let seed = 7;
  let octaves = 5;
  let warp = 0.7;
  let query = { x: 0.64, y: 0.43 };
  let dragging = false;

  shell.slider({
    label: "seed",
    min: 1,
    max: 99,
    step: 1,
    value: seed,
    format: (v) => String(Math.round(v)),
    onInput: (v) => (seed = Math.round(v)),
  });
  shell.slider({
    label: "octaves",
    min: 1,
    max: 7,
    step: 1,
    value: octaves,
    format: (v) => String(Math.round(v)),
    onInput: (v) => (octaves = Math.round(v)),
  });
  shell.slider({
    label: "warp",
    min: 0,
    max: 1.8,
    step: 0.05,
    value: warp,
    onInput: (v) => (warp = v),
  });
  shell.button("reroll seed", () => {
    seed = ((seed * 37 + 19) % 99) + 1;
    const first = shell.controls.querySelector("input") as HTMLInputElement | null;
    if (first) {
      first.value = String(seed);
      first.dispatchEvent(new Event("input"));
    }
  });

  const updatePointer = (e: PointerEvent): void => {
    const rect = shell.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / Math.max(rect.width, 1));
    const y = ((e.clientY - rect.top) / Math.max(rect.height, 1));
    query = { x: clamp(x, 0.05, 0.95), y: clamp(y, 0.12, 0.88) };
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    shell.canvas.setPointerCapture(e.pointerId);
    updatePointer(e);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (dragging) updatePointer(e);
  });
  shell.canvas.addEventListener("pointerup", () => (dragging = false));
  shell.canvas.addEventListener("pointercancel", () => (dragging = false));

  shell.setInfo(() => {
    const v = fbm(query.x * 7.2, query.y * 4.8, seed, octaves, warp);
    return `terrain(seed=${seed}, x=${query.x.toFixed(2)}, z=${query.y.toFixed(2)}) = ${v.toFixed(3)}`;
  });

  return {
    frame: () => {
      const { ctx, w, h } = canvasMetrics(shell.canvas);
      clear(ctx, w, h);
      const mapX = w * 0.05;
      const mapY = h * 0.12;
      const mapW = w * 0.54;
      const mapH = h * 0.7;
      const profileX = w * 0.64;
      const profileY = h * 0.18;
      const profileW = w * 0.3;
      const profileH = h * 0.45;

      fillPanel(ctx, mapX - 10, mapY - 28, mapW + 20, mapH + 42);
      label(ctx, "seeded coordinate field", mapX, mapY - 16, { size: 13 });
      drawTerrainMap(ctx, mapX, mapY, mapW, mapH, seed, octaves, warp);

      const qx = mapX + query.x * mapW;
      const qy = mapY + query.y * mapH;
      line(ctx, mapX, qy, mapX + mapW, qy, "rgba(255,184,107,0.7)", 1.5);
      line(ctx, qx, mapY, qx, mapY + mapH, "rgba(122,162,255,0.7)", 1.5);
      ctx.fillStyle = C.bg0;
      ctx.beginPath();
      ctx.arc(qx, qy, 8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.stroke();

      fillPanel(ctx, profileX - 12, profileY - 44, profileW + 24, profileH + 142);
      label(ctx, "same function, sampled as a cross-section", profileX, profileY - 27, { size: 13 });
      for (let i = 0; i <= 4; i++) {
        const yy = profileY + (i / 4) * profileH;
        line(ctx, profileX, yy, profileX + profileW, yy, "rgba(255,255,255,0.06)");
      }
      drawProfile(
        ctx,
        profileX,
        profileY,
        profileW,
        profileH,
        (u) => fbm(u * 7.2, query.y * 4.8, seed, octaves, warp),
        C.warm,
        2.5,
      );
      const qpx = profileX + query.x * profileW;
      const qv = fbm(query.x * 7.2, query.y * 4.8, seed, octaves, warp);
      const qpy = profileY + profileH * (0.5 - qv * 0.42);
      line(ctx, qpx, profileY, qpx, profileY + profileH, "rgba(122,162,255,0.45)");
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.arc(qpx, qpy, 5, 0, TAU);
      ctx.fill();

      label(ctx, "Drag the map: the coordinate changes, not the stored data.", profileX, profileY + profileH + 42, {
        color: C.muted,
        size: 12,
      });
      label(ctx, "Change the seed: the whole world changes deterministically.", profileX, profileY + profileH + 64, {
        color: C.muted,
        size: 12,
      });
      label(ctx, `query value ${qv.toFixed(3)}`, profileX, profileY + profileH + 94, { color: C.accent, size: 12, mono: true });

      shell.tick();
    },
  };
}

function targetProfile(u: number): number {
  const ridge = Math.exp(-Math.pow((u - 0.58) / 0.08, 2)) * 0.55;
  const basin = -Math.exp(-Math.pow((u - 0.24) / 0.12, 2)) * 0.34;
  return (
    Math.sin(u * TAU * 1.2 + 0.4) * 0.18 +
    Math.sin(u * TAU * 3.4 - 0.7) * 0.08 +
    ridge +
    basin -
    0.05
  );
}

function noisyProfile(u: number, seed: number, bias = 0): number {
  return targetProfile(u) * 0.35 + valueNoise(u * 10.5 + bias, 1.7, seed) * 0.42;
}

export function mountDiffusionTiles(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.58);
  let step = 0.45;
  let seam = 0.55;
  let overlap = 0.28;

  shell.slider({
    label: "denoise step",
    min: 0,
    max: 1,
    step: 0.01,
    value: step,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (step = v),
  });
  shell.slider({
    label: "tile mismatch",
    min: 0,
    max: 1,
    step: 0.01,
    value: seam,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (seam = v),
  });
  shell.slider({
    label: "overlap",
    min: 0.05,
    max: 0.45,
    step: 0.01,
    value: overlap,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (overlap = v),
  });

  shell.setInfo(() => {
    const independentJump = Math.abs(
      lerp(noisyProfile(0.5, 11), targetProfile(0.5), step) -
        lerp(noisyProfile(0.5, 97, seam * 4), targetProfile(0.5) + seam * 0.18, step),
    );
    return `independent seam jump ${independentJump.toFixed(3)} · overlap shares ${Math.round(overlap * 100)}% context`;
  });

  return {
    frame: () => {
      const { ctx, w, h } = canvasMetrics(shell.canvas);
      clear(ctx, w, h);
      const x = w * 0.07;
      const graphW = w * 0.86;
      const graphH = h * 0.19;
      const y1 = h * 0.14;
      const y2 = h * 0.43;
      const y3 = h * 0.72;
      const mid = x + graphW * 0.5;

      function grid(y: number, title: string, sub: string): void {
        fillPanel(ctx, x - 14, y - 34, graphW + 28, graphH + 62);
        label(ctx, title, x, y - 18, { size: 13 });
        label(ctx, sub, x + graphW, y - 18, { size: 11, color: C.muted, align: "right" });
        line(ctx, x, y + graphH * 0.5, x + graphW, y + graphH * 0.5, "rgba(255,255,255,0.07)");
      }

      grid(y1, "learned landscape prior", "the target structure a model can learn");
      drawProfile(ctx, x, y1, graphW, graphH, targetProfile, C.good, 2.5);

      grid(y2, "independent tiles", "each tile denoises alone");
      ctx.fillStyle = "rgba(255,133,133,0.08)";
      ctx.fillRect(mid - 2, y2, 4, graphH);
      line(ctx, mid, y2 - 2, mid, y2 + graphH + 2, C.red, 2);
      drawProfile(
        ctx,
        x,
        y2,
        graphW * 0.5,
        graphH,
        (u) => lerp(noisyProfile(u * 0.5, 11), targetProfile(u * 0.5), step),
        C.accent,
        2.2,
      );
      drawProfile(
        ctx,
        mid,
        y2,
        graphW * 0.5,
        graphH,
        (u) => lerp(noisyProfile(0.5 + u * 0.5, 97, seam * 4), targetProfile(0.5 + u * 0.5) + seam * 0.18, step),
        C.warm,
        2.2,
      );
      label(ctx, "seam", mid + 8, y2 + graphH + 18, { color: C.red, size: 11, mono: true });

      grid(y3, "overlapping windows", "blend local predictions instead of cutting");
      const ovW = graphW * overlap;
      const leftStart = x;
      const leftEnd = mid + ovW * 0.5;
      const rightStart = mid - ovW * 0.5;
      const rightEnd = x + graphW;
      ctx.fillStyle = "rgba(125,214,160,0.09)";
      ctx.fillRect(rightStart, y3, ovW, graphH);
      line(ctx, rightStart, y3, rightStart, y3 + graphH, "rgba(125,214,160,0.45)");
      line(ctx, leftEnd, y3, leftEnd, y3 + graphH, "rgba(125,214,160,0.45)");
      drawProfile(ctx, leftStart, y3, leftEnd - leftStart, graphH, (u) => {
        const worldU = u * (leftEnd - leftStart) / graphW;
        return lerp(noisyProfile(worldU, 11), targetProfile(worldU), step);
      }, "rgba(122,162,255,0.65)", 1.6);
      drawProfile(ctx, rightStart, y3, rightEnd - rightStart, graphH, (u) => {
        const worldU = (rightStart - x + u * (rightEnd - rightStart)) / graphW;
        return lerp(noisyProfile(worldU, 97, seam * 4), targetProfile(worldU), step);
      }, "rgba(255,184,107,0.65)", 1.6);
      drawProfile(ctx, x, y3, graphW, graphH, (u) => {
        const inLeft = u <= (leftEnd - x) / graphW;
        const inRight = u >= (rightStart - x) / graphW;
        const l = lerp(noisyProfile(u, 11), targetProfile(u), step);
        const r = lerp(noisyProfile(u, 97, seam * 4), targetProfile(u), step);
        if (inLeft && inRight) {
          const t = smooth01((u - (rightStart - x) / graphW) / Math.max(overlap, 1e-3));
          return lerp(l, r, t);
        }
        return inLeft ? l : r;
      }, C.good, 2.8);
      label(ctx, "overlap", mid, y3 + graphH + 18, { color: C.good, size: 11, align: "center", mono: true });

      shell.tick();
    },
  };
}

export function mountInfiniteWindows(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.6);
  let queryCenter = 0;
  let querySize = 1.4;
  let stride = 0.72;
  let windowSize = 1.7;
  let dragging = false;

  shell.slider({
    label: "query x",
    min: -5,
    max: 5,
    step: 0.01,
    value: queryCenter,
    onInput: (v) => (queryCenter = v),
  });
  shell.slider({
    label: "query width",
    min: 0.6,
    max: 2.8,
    step: 0.05,
    value: querySize,
    onInput: (v) => (querySize = v),
  });
  shell.slider({
    label: "window stride",
    min: 0.45,
    max: 1.2,
    step: 0.01,
    value: stride,
    onInput: (v) => (stride = v),
  });
  shell.button("center query", () => (queryCenter = 0));

  const worldFromPointer = (e: PointerEvent): number => {
    const rect = shell.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / Math.max(rect.width, 1);
    return (x - 0.5) * 11;
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    shell.canvas.setPointerCapture(e.pointerId);
    queryCenter = worldFromPointer(e);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (dragging) queryCenter = worldFromPointer(e);
  });
  shell.canvas.addEventListener("pointerup", () => (dragging = false));
  shell.canvas.addEventListener("pointercancel", () => (dragging = false));

  shell.setInfo(() => {
    const q0 = queryCenter - querySize * 0.5;
    const q1 = queryCenter + querySize * 0.5;
    let count = 0;
    for (let i = -20; i <= 20; i++) {
      const c = i * stride;
      const w0 = c - windowSize * 0.5;
      const w1 = c + windowSize * 0.5;
      if (w1 >= q0 && w0 <= q1) count++;
    }
    return `${count} finite windows affect this query`;
  });

  return {
    frame: () => {
      const { ctx, w, h } = canvasMetrics(shell.canvas);
      clear(ctx, w, h);
      const left = w * 0.06;
      const right = w * 0.94;
      const top = h * 0.18;
      const base = h * 0.52;
      const scale = (right - left) / 11;
      const toX = (world: number): number => (world + 5.5) * scale + left;
      const q0 = queryCenter - querySize * 0.5;
      const q1 = queryCenter + querySize * 0.5;

      fillPanel(ctx, left - 18, top - 58, right - left + 36, h * 0.72);
      label(ctx, "infinite domain, finite query", left, top - 34, { size: 14 });
      label(ctx, "Drag horizontally: the requested slice moves, the rule stays the same.", right, top - 34, {
        size: 11,
        color: C.muted,
        align: "right",
      });

      for (let xw = -5; xw <= 5; xw++) {
        const xx = toX(xw);
        line(ctx, xx, top - 6, xx, base + 92, "rgba(255,255,255,0.055)");
        label(ctx, String(xw), xx, base + 112, { color: C.muted, size: 10, align: "center", mono: true });
      }

      const active: number[] = [];
      for (let i = -20; i <= 20; i++) {
        const c = i * stride;
        const w0 = c - windowSize * 0.5;
        const w1 = c + windowSize * 0.5;
        const isActive = w1 >= q0 && w0 <= q1;
        if (isActive) active.push(i);
        const x0 = toX(w0);
        const ww = (w1 - w0) * scale;
        const y = top + (i % 3) * 42;
        ctx.fillStyle = isActive ? "rgba(122,162,255,0.18)" : "rgba(255,255,255,0.035)";
        roundedRect(ctx, x0, y, ww, 28, 5);
        ctx.fill();
        ctx.strokeStyle = isActive ? C.accent : "rgba(255,255,255,0.13)";
        ctx.lineWidth = isActive ? 1.8 : 1;
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(255,184,107,0.18)";
      roundedRect(ctx, toX(q0), base - 16, querySize * scale, 56, 7);
      ctx.fill();
      ctx.strokeStyle = C.warm;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      label(ctx, "requested region", toX(queryCenter), base + 58, { color: C.warm, size: 12, align: "center" });

      const graphY = h * 0.77;
      label(ctx, "blended output over the requested slice", left, graphY - 28, { size: 12 });
      line(ctx, left, graphY, right, graphY, "rgba(255,255,255,0.08)");
      ctx.strokeStyle = C.good;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i <= 260; i++) {
        const u = i / 260;
        const world = q0 + u * querySize;
        let num = 0;
        let den = 0;
        for (const idx of active) {
          const c = idx * stride;
          const d = Math.abs(world - c) / (windowSize * 0.5);
          const weight = d >= 1 ? 0 : smooth01(1 - d);
          const local = Math.sin(world * 2.0 + idx * 0.15) * 0.28 + Math.sin(world * 5.7 + idx) * 0.06;
          num += weight * local;
          den += weight;
        }
        const v = den > 0 ? num / den : 0;
        const px = lerp(left, right, u);
        const py = graphY - v * 85;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      label(ctx, "not computed", left, top + 158, { color: "rgba(255,255,255,0.28)", size: 11 });
      label(ctx, "computed windows", right, top + 158, { color: C.accent, size: 11, align: "right" });
      shell.tick();
    },
  };
}

export function mountTerrainPipeline(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  let px = 0;
  let pz = 0;
  let cacheRadius = 1;
  let auto = true;
  let t = 0;
  const cache = new Set<string>();
  let lastMisses = 0;

  const key = (x: number, z: number): string => `${x},${z}`;
  const touch = (): void => {
    let misses = 0;
    for (let dz = -cacheRadius; dz <= cacheRadius; dz++) {
      for (let dx = -cacheRadius; dx <= cacheRadius; dx++) {
        const k = key(px + dx, pz + dz);
        if (!cache.has(k)) misses++;
        cache.add(k);
      }
    }
    lastMisses = misses;
    if (cache.size > 70) {
      const keep = new Set<string>();
      for (let dz = -cacheRadius - 2; dz <= cacheRadius + 2; dz++) {
        for (let dx = -cacheRadius - 2; dx <= cacheRadius + 2; dx++) keep.add(key(px + dx, pz + dz));
      }
      for (const k of [...cache]) if (!keep.has(k)) cache.delete(k);
    }
  };
  touch();

  shell.slider({
    label: "cache radius",
    min: 0,
    max: 2,
    step: 1,
    value: cacheRadius,
    format: (v) => String(Math.round(v)),
    onInput: (v) => {
      cacheRadius = Math.round(v);
      touch();
    },
  });
  shell.button("step east", () => {
    auto = false;
    px += 1;
    touch();
  });
  shell.button("teleport", () => {
    auto = false;
    px = Math.round((hash2(px + 17, pz - 3, 9) - 0.5) * 12);
    pz = Math.round((hash2(px - 4, pz + 23, 12) - 0.5) * 8);
    touch();
  });
  shell.button("auto walk", () => {
    auto = !auto;
  });

  shell.setInfo(() => {
    const cold = lastMisses > 0;
    const latency = cold ? lerp(0.66, 1.72, clamp(lastMisses / 9, 0, 1)) : 0.66;
    return `${cold ? "cache miss" : "cache hit"} · estimated tile latency ${latency.toFixed(2)}s · ${cache.size} cached tiles`;
  });

  return {
    frame: () => {
      const now = performance.now() / 1000;
      if (auto && now - t > 1.1) {
        t = now;
        px += 1;
        if (px > 5) {
          px = -5;
          pz += 1;
        }
        touch();
      }

      const { ctx, w, h } = canvasMetrics(shell.canvas);
      clear(ctx, w, h);
      const left = w * 0.06;
      const top = h * 0.14;
      const gridSize = Math.min(w * 0.48, h * 0.68);
      const cell = gridSize / 7;
      const flowX = w * 0.61;
      const flowY = h * 0.16;
      const flowW = w * 0.32;

      fillPanel(ctx, left - 16, top - 42, gridSize + 32, gridSize + 86);
      label(ctx, "streaming query around the player", left, top - 24, { size: 13 });

      for (let gz = -3; gz <= 3; gz++) {
        for (let gx = -3; gx <= 3; gx++) {
          const wx = px + gx;
          const wz = pz + gz;
          const x = left + (gx + 3) * cell;
          const y = top + (gz + 3) * cell;
          const inQuery = Math.abs(gx) <= cacheRadius && Math.abs(gz) <= cacheRadius;
          const cached = cache.has(key(wx, wz));
          ctx.fillStyle = cached ? "rgba(125,214,160,0.13)" : "rgba(255,255,255,0.035)";
          if (inQuery) ctx.fillStyle = cached ? "rgba(122,162,255,0.18)" : "rgba(255,184,107,0.16)";
          ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
          ctx.strokeStyle = inQuery ? C.accent : "rgba(255,255,255,0.12)";
          ctx.lineWidth = inQuery ? 1.8 : 1;
          ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
          if (gx === 0 && gz === 0) {
            ctx.fillStyle = C.warm;
            ctx.beginPath();
            ctx.arc(x + cell * 0.5, y + cell * 0.5, Math.max(5, cell * 0.14), 0, TAU);
            ctx.fill();
          }
        }
      }
      label(ctx, `player tile (${px}, ${pz})`, left, top + gridSize + 28, { color: C.warm, size: 12, mono: true });
      label(ctx, "blue = requested now, green = cached context", left, top + gridSize + 52, { color: C.muted, size: 12 });

      fillPanel(ctx, flowX - 16, flowY - 42, flowW + 32, h * 0.7);
      label(ctx, "Terrain Diffusion stack", flowX, flowY - 24, { size: 13 });

      const steps = [
        ["coarse world", "global context", C.purple],
        ["latent tile", "learned structure", C.accent],
        ["decoder", "90 m detail", C.good],
        ["engine chunk", "streamed result", C.warm],
      ] as const;
      for (let i = 0; i < steps.length; i++) {
        const y = flowY + i * 82;
        const [title, sub, color] = steps[i];
        ctx.fillStyle = "rgba(255,255,255,0.035)";
        roundedRect(ctx, flowX, y, flowW, 52, 8);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        label(ctx, title, flowX + 14, y + 19, { color, size: 13 });
        label(ctx, sub, flowX + 14, y + 38, { color: C.muted, size: 11 });
        if (i < steps.length - 1) {
          line(ctx, flowX + flowW * 0.5, y + 52, flowX + flowW * 0.5, y + 78, "rgba(255,255,255,0.22)", 2);
        }
      }

      const missFrac = clamp(lastMisses / Math.max((cacheRadius * 2 + 1) ** 2, 1), 0, 1);
      const meterY = flowY + 356;
      label(ctx, "query cost", flowX, meterY, { size: 12 });
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      roundedRect(ctx, flowX, meterY + 16, flowW, 14, 7);
      ctx.fill();
      ctx.fillStyle = missFrac > 0.5 ? C.warm : C.good;
      roundedRect(ctx, flowX, meterY + 16, Math.max(8, flowW * (0.22 + missFrac * 0.78)), 14, 7);
      ctx.fill();
      label(ctx, lastMisses === 0 ? "warm neighbor query" : `${lastMisses} uncached window(s)`, flowX, meterY + 52, {
        color: C.muted,
        size: 12,
      });

      shell.tick();
    },
  };
}
