// Figures for the Dome Projection series. Every image here is made the way a
// dome renderer makes one: for each output pixel, work out the direction it
// shows, then look up what's there. Vector overlays (handles, labels, grids)
// are drawn on top in CSS pixels.

import { Shell, type Demo } from "../../lib/demoShell";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SANS = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const C = {
  bg: "#06070b",
  panel: "#10131c",
  grid: "rgba(150, 170, 230, 0.16)",
  gridStrong: "rgba(150, 170, 230, 0.32)",
  text: "#e3e7f2",
  muted: "#8a91a5",
  dim: "#5d6479",
  accent: "#7aa2ff",
  warm: "#ffb86b",
  good: "#7dd6a0",
  red: "#ff8585",
  violet: "#c59bff",
};

type Vec3 = { x: number; y: number; z: number };
type RGB = [number, number, number];

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function normAngle(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function domeDirection(azimuth: number, zenith: number): Vec3 {
  return { x: Math.sin(zenith) * Math.cos(azimuth), y: Math.sin(zenith) * Math.sin(azimuth), z: Math.cos(zenith) };
}

// ---- drawing helpers ---------------------------------------------------------

function withCanvas(canvas: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => void): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  const dpr = canvas.width / Math.max(w, 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#080a12");
  g.addColorStop(1, "#0b0d16");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  draw(ctx, w, h, dpr);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width = 1): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
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
  ctx.font = `${opts.weight ?? (opts.mono ? 400 : 600)} ${opts.size ?? 13}px ${opts.mono ? MONO : SANS}`;
  ctx.fillText(text, x, y);
}

// A draggable handle: a bright dot with a soft halo.
function handle(ctx: CanvasRenderingContext2D, x: number, y: number, color = C.accent, r = 6): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
  g.addColorStop(0, "rgba(160, 190, 255, 0.45)");
  g.addColorStop(1, "rgba(160, 190, 255, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function pointerPoint(canvas: HTMLCanvasElement, e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / Math.max(rect.width, 1)) * (canvas.clientWidth || rect.width),
    y: ((e.clientY - rect.top) / Math.max(rect.height, 1)) * (canvas.clientHeight || rect.height),
  };
}

function syncSlider(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event("input"));
}

// Wires press-drag-release on a canvas to a hit test and a drag handler.
function dragging<T extends string>(
  canvas: HTMLCanvasElement,
  hit: (x: number, y: number) => T | null,
  drag: (which: T, x: number, y: number) => void,
  onStart?: () => void,
): void {
  let active: T | null = null;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    const p = pointerPoint(canvas, e);
    const which = hit(p.x, p.y);
    if (!which) return;
    e.preventDefault();
    active = which;
    onStart?.();
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
    drag(which, p.x, p.y);
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointerPoint(canvas, e);
    if (active) {
      drag(active, p.x, p.y);
      return;
    }
    canvas.style.cursor = hit(p.x, p.y) ? "grab" : "default";
  });
  const stop = (e: PointerEvent): void => {
    if (!active) return;
    active = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone after a cancel
    }
    canvas.style.cursor = "default";
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
}

// An offscreen image at device resolution, redrawn only when `key` changes.
// `shade` gives the colour of pixel (i, j) of a W×H image, or null for clear.
class Raster {
  private canvas = document.createElement("canvas");
  private key = "";

  constructor(private shade: (i: number, j: number, W: number, H: number) => RGB | null) {}

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dpr: number, key: string): void {
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    const fullKey = `${key}|${W}x${H}`;
    if (fullKey !== this.key) {
      this.key = fullKey;
      this.canvas.width = W;
      this.canvas.height = H;
      const c = this.canvas.getContext("2d")!;
      const img = c.createImageData(W, H);
      const d = img.data;
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const col = this.shade(i, j, W, H);
          const o = (j * W + i) * 4;
          if (!col) continue;
          d[o] = col[0];
          d[o + 1] = col[1];
          d[o + 2] = col[2];
          d[o + 3] = 255;
        }
      }
      c.putImageData(img, 0, 0);
    }
    ctx.drawImage(this.canvas, x, y, w, h);
  }
}

// ---- a test pattern painted on the dome, by direction ----------------------

// Twelve hues around the azimuth, rings every 15 degrees of zenith angle, and
// meridians every 30 degrees: the kind of grid used to check a dome mapping.
function domePattern(d: Vec3, lineDeg = 0.7): RGB {
  const zen = Math.acos(clamp(d.z, -1, 1));
  if (zen > Math.PI / 2 + 0.001) return [14, 15, 22];
  const az = normAngle(Math.atan2(d.y, d.x));
  const t = az / TAU;
  // a smooth periodic palette, so there's no seam in the content itself
  const r = 0.5 + 0.5 * Math.cos(TAU * (t + 0.0));
  const g = 0.5 + 0.5 * Math.cos(TAU * (t + 0.33));
  const b = 0.5 + 0.5 * Math.cos(TAU * (t + 0.67));
  const band = Math.floor(zen / (15 * DEG)) % 2 === 0 ? 1 : 0.78;
  const shade = (0.22 + 0.2 * (1 - zen / (Math.PI / 2))) * band;
  let cr = 30 + 160 * r * shade + 40 * shade;
  let cg = 34 + 150 * g * shade + 40 * shade;
  let cb = 52 + 170 * b * shade + 50 * shade;
  const ringD = Math.abs(((zen / DEG + 7.5) % 15) - 7.5);
  const merD = Math.abs((((az / DEG + 15) % 30) - 15) * Math.sin(zen));
  const ln = Math.max(1 - smooth01(ringD / lineDeg), (1 - smooth01(merD / lineDeg)) * smooth01(zen / (6 * DEG)));
  cr += (235 - cr) * ln * 0.75;
  cg += (240 - cg) * ln * 0.75;
  cb += (255 - cb) * ln * 0.75;
  // the zenith gets a small bright spot so it's easy to find
  const z = 1 - smooth01(zen / (2.2 * DEG));
  return [cr + (255 - cr) * z, cg + (230 - cg) * z, cb + (180 - cb) * z];
}

// =============================================================================
// Part 1 · polar coordinates and a texture lookup
// =============================================================================

const TEX_W = 12;
const TEX_H = 5;

// A tiny texture: twelve columns that go once round a colour wheel (so the
// content itself is seamless) and five rows of alternating brightness.
function texel(i: number, j: number): RGB {
  const t = i / TEX_W;
  const k = j % 2 === 0 ? 1 : 0.72;
  return [
    (60 + 150 * (0.5 + 0.5 * Math.cos(TAU * t))) * k,
    (70 + 140 * (0.5 + 0.5 * Math.cos(TAU * (t + 0.33)))) * k,
    (90 + 150 * (0.5 + 0.5 * Math.cos(TAU * (t + 0.67)))) * k,
  ];
}

// Bilinear lookup, wrapping in u the way a repeat sampler does.
function sampleTex(u: number, v: number): RGB {
  const x = u * TEX_W - 0.5;
  const y = clamp(v, 0, 1) * TEX_H - 0.5;
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const fx = x - i0;
  const fy = y - j0;
  const wrap = (i: number): number => ((i % TEX_W) + TEX_W) % TEX_W;
  const cl = (j: number): number => clamp(j, 0, TEX_H - 1);
  const a = texel(wrap(i0), cl(j0));
  const b = texel(wrap(i0 + 1), cl(j0));
  const c = texel(wrap(i0), cl(j0 + 1));
  const d = texel(wrap(i0 + 1), cl(j0 + 1));
  const out: RGB = [0, 0, 0];
  for (let k = 0; k < 3; k++) out[k] = (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy;
  return out;
}

function polarLayout(w: number, h: number, narrow: boolean) {
  if (narrow) {
    const s = Math.min(w * 0.36, h * 0.22);
    return { s, cx: w * 0.5, cy: h * 0.07 + s + 14, rx: w * 0.1, ry: h * 0.6, rw: w * 0.8, rh: h * 0.22 };
  }
  const s = Math.min(w * 0.2, h * 0.36);
  return { s, cx: w * 0.25, cy: h * 0.47, rx: w * 0.52, ry: h * 0.15, rw: w * 0.33, rh: h * 0.64 };
}

export function mountPolarCircle(container: HTMLElement): Demo {
  const narrow = (container.clientWidth || 700) < 560;
  const shell = new Shell(container, narrow ? 1.18 : 0.62);
  let theta = 1.05;
  let radius = 0.72;
  let orbiting = false;
  const disc = new Raster((i, j, W, H) => {
    const x = ((i + 0.5) / W) * 2 - 1;
    const y = 1 - ((j + 0.5) / H) * 2;
    const r = Math.hypot(x, y);
    if (r > 1) return null;
    // the inverse map: this pixel's (r, θ), then the texel at (u, v)
    const th = normAngle(Math.atan2(y, x));
    return sampleTex(th / TAU, r);
  });
  const tex = new Raster((i, j, W, H) => sampleTex((i + 0.5) / W, 1 - (j + 0.5) / H));

  const angleSlider = shell.slider({
    label: "angle θ",
    min: 0,
    max: TAU,
    step: 0.001,
    value: theta,
    format: (v) => `${(v / DEG).toFixed(0)}°`,
    onInput: (v) => (theta = v),
  });
  const radiusSlider = shell.slider({
    label: "radius r",
    min: 0,
    max: 1,
    step: 0.01,
    value: radius,
    format: (v) => v.toFixed(2),
    onInput: (v) => (radius = v),
  });
  const orbitButton = shell.button("orbit", () => {
    orbiting = !orbiting;
    orbitButton.textContent = orbiting ? "stop" : "orbit";
  });
  shell.button("go to the seam", () => syncSlider(angleSlider, 0.02));

  const metrics = () => {
    const w = shell.canvas.clientWidth;
    const h = shell.canvas.clientHeight;
    const L = polarLayout(w, h, narrow);
    return {
      ...L,
      px: L.cx + Math.cos(theta) * radius * L.s,
      py: L.cy - Math.sin(theta) * radius * L.s,
      ux: L.rx + (theta / TAU) * L.rw,
      uy: L.ry + (1 - radius) * L.rh,
    };
  };
  dragging<"circle" | "uv">(
    shell.canvas,
    (x, y) => {
      const m = metrics();
      if (Math.hypot(x - m.cx, y - m.cy) <= m.s + 16) return "circle";
      if (x >= m.rx - 12 && x <= m.rx + m.rw + 12 && y >= m.ry - 12 && y <= m.ry + m.rh + 12) return "uv";
      return null;
    },
    (which, x, y) => {
      const m = metrics();
      if (which === "circle") {
        theta = normAngle(Math.atan2(m.cy - y, x - m.cx));
        radius = clamp(Math.hypot(x - m.cx, y - m.cy) / m.s, 0, 1);
      } else {
        theta = clamp((x - m.rx) / m.rw, 0, 0.9999) * TAU;
        radius = clamp(1 - (y - m.ry) / m.rh, 0, 1);
      }
      syncSlider(angleSlider, theta);
      syncSlider(radiusSlider, radius);
    },
    () => {
      orbiting = false;
      orbitButton.textContent = "orbit";
    },
  );

  shell.setInfo(() => {
    const x = Math.cos(theta) * radius;
    const y = Math.sin(theta) * radius;
    return `(x, y) = (${x.toFixed(2)}, ${y.toFixed(2)}) · (r, θ) = (${radius.toFixed(2)}, ${(theta / DEG).toFixed(0)}°) · (u, v) = (${(theta / TAU).toFixed(3)}, ${radius.toFixed(2)})`;
  });

  return {
    frame() {
      if (orbiting) {
        theta = normAngle(theta + 0.006);
        syncSlider(angleSlider, theta);
      }
      withCanvas(shell.canvas, (ctx, _w, _h, dpr) => {
        const m = metrics();
        const fs = narrow ? 11 : 13;

        // the circle, filled by looking every pixel up in the texture
        disc.draw(ctx, m.cx - m.s, m.cy - m.s, m.s * 2, m.s * 2, dpr, "disc");
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#06070b";
        ctx.beginPath();
        ctx.arc(m.cx, m.cy, m.s, 0, TAU);
        ctx.fill();
        ctx.restore();
        for (let k = 1; k <= TEX_H; k++) {
          ctx.strokeStyle = k === TEX_H ? C.accent : C.grid;
          ctx.lineWidth = k === TEX_H ? 1.6 : 1;
          ctx.beginPath();
          ctx.arc(m.cx, m.cy, (m.s * k) / TEX_H, 0, TAU);
          ctx.stroke();
        }
        for (let k = 0; k < TEX_W; k++) {
          const a = (k / TEX_W) * TAU;
          line(ctx, m.cx, m.cy, m.cx + Math.cos(a) * m.s, m.cy - Math.sin(a) * m.s, C.grid);
        }
        // the seam: θ = 0, where the texture's two edges meet
        line(ctx, m.cx, m.cy, m.cx + m.s, m.cy, C.warm, 1.6);
        label(ctx, "seam", m.cx + m.s + 6, m.cy, { color: C.warm, size: fs - 1, mono: true });
        // θ arc and r
        ctx.strokeStyle = C.good;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.cx, m.cy, m.s * 0.24, 0, -theta, true);
        ctx.stroke();
        line(ctx, m.cx, m.cy, m.px, m.py, "#ffffff", 2);
        dot(ctx, m.cx, m.cy, 3, C.text);
        handle(ctx, m.px, m.py);
        const mid = theta / 2;
        label(ctx, "θ", m.cx + Math.cos(mid) * m.s * 0.33, m.cy - Math.sin(mid) * m.s * 0.33, { color: C.good, size: fs + 2 });
        label(ctx, "r", (m.cx + m.px) / 2 + 8 * Math.sin(theta), (m.cy + m.py) / 2 + 8 * Math.cos(theta), { size: fs + 2 });
        label(ctx, "the circle: (x, y) or (r, θ)", m.cx, m.cy - m.s - (narrow ? 12 : 22), { size: fs, align: "center" });

        // the same texture, unwrapped
        tex.draw(ctx, m.rx, m.ry, m.rw, m.rh, dpr, "tex");
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#06070b";
        ctx.fillRect(m.rx, m.ry, m.rw, m.rh);
        ctx.restore();
        for (let k = 0; k <= TEX_W; k++) {
          const x = m.rx + (k / TEX_W) * m.rw;
          line(ctx, x, m.ry, x, m.ry + m.rh, k === 0 || k === TEX_W ? C.warm : C.grid, k === 0 || k === TEX_W ? 1.6 : 1);
        }
        for (let k = 0; k <= TEX_H; k++) {
          const y = m.ry + (k / TEX_H) * m.rh;
          line(ctx, m.rx, y, m.rx + m.rw, y, k === 0 ? C.accent : C.grid, k === 0 ? 1.6 : 1);
        }
        line(ctx, m.ux, m.ry, m.ux, m.ry + m.rh, "rgba(125, 214, 160, 0.7)", 1.2);
        line(ctx, m.rx, m.uy, m.rx + m.rw, m.uy, "rgba(255, 255, 255, 0.55)", 1.2);
        handle(ctx, m.ux, m.uy);
        label(ctx, "the texture: (u, v)", m.rx, m.ry - (narrow ? 12 : 22), { size: fs });
        const by = m.ry + m.rh + (narrow ? 12 : 16);
        label(ctx, "u = θ / 2π", m.rx + m.rw / 2, by, { size: fs - 2, color: C.good, align: "center", mono: true });
        label(ctx, "0", m.rx, by, { size: fs - 2, color: C.warm, mono: true, align: "center" });
        label(ctx, "1", m.rx + m.rw, by, { size: fs - 2, color: C.warm, mono: true, align: "center" });
        if (!narrow) {
          label(ctx, "v = 1, edge", m.rx + m.rw + 8, m.ry + 6, { size: fs - 2, mono: true, color: C.muted, weight: 400 });
          label(ctx, "v = 0, centre", m.rx + m.rw + 8, m.ry + m.rh - 6, { size: fs - 2, mono: true, color: C.muted, weight: 400 });
        }
      });
      shell.tick();
    },
  };
}

// =============================================================================
// Part 2 · fisheye projection laws
// =============================================================================

type FisheyeLaw = {
  name: string;
  formula: string;
  color: string;
  project(theta: number, maxTheta: number): number;
  unproject(rho: number, maxTheta: number): number;
};

const FISHEYE_LAWS: FisheyeLaw[] = [
  {
    name: "equidistant",
    formula: "ρ = θ / θmax",
    color: C.accent,
    project: (t, m) => t / m,
    unproject: (r, m) => r * m,
  },
  {
    name: "equisolid",
    formula: "ρ = sin(θ/2) / sin(θmax/2)",
    color: C.good,
    project: (t, m) => Math.sin(t / 2) / Math.sin(m / 2),
    unproject: (r, m) => 2 * Math.asin(clamp(r * Math.sin(m / 2), -1, 1)),
  },
  {
    name: "orthographic",
    formula: "ρ = sin θ / sin θmax",
    color: C.violet,
    project: (t, m) => Math.sin(t) / Math.sin(m),
    unproject: (r, m) => Math.asin(clamp(r * Math.sin(m), -1, 1)),
  },
  {
    name: "stereographic",
    formula: "ρ = tan(θ/2) / tan(θmax/2)",
    color: C.warm,
    project: (t, m) => Math.tan(t / 2) / Math.tan(m / 2),
    unproject: (r, m) => 2 * Math.atan(r * Math.tan(m / 2)),
  },
];

function fisheyeLayout(w: number, h: number, narrow: boolean) {
  if (narrow) {
    const fr = Math.min(w * 0.4, h * 0.22);
    return {
      fr,
      fc: { x: w * 0.5, y: 22 + fr },
      dr: Math.min(w * 0.2, h * 0.13),
      dc: { x: w * 0.26, y: h * 0.78 },
      chart: { x: w * 0.56, y: h * 0.58, w: w * 0.4, h: h * 0.2 },
      textY: h * 0.94,
    };
  }
  const fr = Math.min(w * 0.22, h * 0.36);
  return {
    fr,
    fc: { x: w * 0.27, y: h * 0.46 },
    dr: Math.min(w * 0.17, h * 0.3),
    dc: { x: w * 0.73, y: h * 0.44 },
    chart: { x: w * 0.6, y: h * 0.58, w: w * 0.3, h: h * 0.24 },
    textY: h * 0.92,
  };
}

export function mountFisheyeMap(container: HTMLElement): Demo {
  const narrow = (container.clientWidth || 700) < 560;
  const shell = new Shell(container, narrow ? 1.3 : 0.7);
  let zenithDeg = 54;
  let phi = 0.65;
  let fovDeg = 180;
  let lawIndex = 0;
  let spinning = false;
  const disc = new Raster((i, j, W, H) => {
    const x = ((i + 0.5) / W) * 2 - 1;
    const y = 1 - ((j + 0.5) / H) * 2;
    const rho = Math.hypot(x, y);
    if (rho > 1) return null;
    const maxT = (fovDeg * DEG) / 2;
    const th = FISHEYE_LAWS[lawIndex].unproject(rho, maxT);
    return domePattern(domeDirection(Math.atan2(y, x), th), 0.9);
  });

  const phiSlider = shell.slider({
    label: "azimuth φ",
    min: 0,
    max: TAU,
    step: 0.001,
    value: phi,
    format: (v) => `${(v / DEG).toFixed(0)}°`,
    onInput: (v) => (phi = v),
  });
  const thetaSlider = shell.slider({
    label: "zenith angle θ",
    min: 0,
    max: 90,
    step: 0.1,
    value: zenithDeg,
    format: (v) => `${v.toFixed(0)}°`,
    onInput: (v) => (zenithDeg = v),
  });
  shell.slider({
    label: "lens field of view",
    min: 120,
    max: 180,
    step: 1,
    value: fovDeg,
    format: (v) => `${v.toFixed(0)}°`,
    onInput: (v) => (fovDeg = v),
  });
  const lawButton = shell.button(`law: ${FISHEYE_LAWS[0].name}`, () => {
    lawIndex = (lawIndex + 1) % FISHEYE_LAWS.length;
    lawButton.textContent = `law: ${FISHEYE_LAWS[lawIndex].name}`;
  });
  const spinButton = shell.button("spin φ", () => {
    spinning = !spinning;
    spinButton.textContent = spinning ? "stop" : "spin φ";
  });

  const metrics = () => {
    const w = shell.canvas.clientWidth;
    const h = shell.canvas.clientHeight;
    const L = fisheyeLayout(w, h, narrow);
    const maxT = (fovDeg * DEG) / 2;
    const th = Math.min(zenithDeg * DEG, maxT);
    const rho = clamp(FISHEYE_LAWS[lawIndex].project(th, maxT), 0, 1);
    return {
      ...L,
      maxT,
      th,
      rho,
      sx: L.fc.x + Math.cos(phi) * rho * L.fr,
      sy: L.fc.y - Math.sin(phi) * rho * L.fr,
      hx: L.dc.x + Math.sin(th) * L.dr,
      hy: L.dc.y - Math.cos(th) * L.dr,
    };
  };

  dragging<"fisheye" | "dome">(
    shell.canvas,
    (x, y) => {
      const m = metrics();
      if (Math.hypot(x - m.fc.x, y - m.fc.y) <= m.fr + 14) return "fisheye";
      if (Math.hypot(x - m.dc.x, y - m.dc.y) <= m.dr + 18 && y <= m.dc.y + 10) return "dome";
      return null;
    },
    (which, x, y) => {
      const m = metrics();
      if (which === "fisheye") {
        phi = normAngle(Math.atan2(m.fc.y - y, x - m.fc.x));
        const rho = clamp(Math.hypot(x - m.fc.x, y - m.fc.y) / m.fr, 0, 1);
        zenithDeg = FISHEYE_LAWS[lawIndex].unproject(rho, m.maxT) / DEG;
      } else {
        zenithDeg = clamp(Math.atan2(x - m.dc.x, m.dc.y - y), 0, m.maxT) / DEG;
      }
      syncSlider(phiSlider, phi);
      syncSlider(thetaSlider, zenithDeg);
    },
    () => {
      spinning = false;
      spinButton.textContent = "spin φ";
    },
  );

  shell.setInfo(() => {
    const m = metrics();
    const law = FISHEYE_LAWS[lawIndex];
    const base = `${law.name}: θ = ${(m.th / DEG).toFixed(0)}° lands at ρ = ${m.rho.toFixed(3)}`;
    return law.name === "equidistant" ? `${base}, the same share of the radius as of θmax` : `${base} (equidistant would be ${(m.th / m.maxT).toFixed(3)})`;
  });

  return {
    frame() {
      if (spinning) {
        phi = normAngle(phi + 0.005);
        syncSlider(phiSlider, phi);
      }
      withCanvas(shell.canvas, (ctx, w, _h, dpr) => {
        const m = metrics();
        const law = FISHEYE_LAWS[lawIndex];
        const fs = narrow ? 11 : 13;

        // the fisheye master, filled pixel by pixel through the chosen law
        disc.draw(ctx, m.fc.x - m.fr, m.fc.y - m.fr, m.fr * 2, m.fr * 2, dpr, `${lawIndex}|${fovDeg}`);
        ctx.strokeStyle = law.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(m.fc.x, m.fc.y, m.fr, 0, TAU);
        ctx.stroke();
        line(ctx, m.fc.x, m.fc.y, m.sx, m.sy, "#ffffff", 2);
        handle(ctx, m.sx, m.sy);
        label(ctx, "fisheye master", m.fc.x - m.fr, m.fc.y - m.fr - (narrow ? 10 : 18), { size: fs });
        if (!narrow) {
          label(ctx, `${fovDeg.toFixed(0)}° lens, rings every 15°`, m.fc.x + m.fr, m.fc.y - m.fr - 18, {
            size: fs - 2,
            color: C.muted,
            align: "right",
            mono: true,
          });
        }

        // the dome, side on, with equal 15-degree steps of θ
        ctx.strokeStyle = C.gridStrong;
        ctx.lineWidth = 1;
        for (let d = 15; d < 90; d += 15) {
          const a = d * DEG;
          line(ctx, m.dc.x, m.dc.y, m.dc.x + Math.sin(a) * m.dr, m.dc.y - Math.cos(a) * m.dr, C.grid);
          line(ctx, m.dc.x, m.dc.y, m.dc.x - Math.sin(a) * m.dr, m.dc.y - Math.cos(a) * m.dr, C.grid);
        }
        line(ctx, m.dc.x - m.dr * 1.15, m.dc.y, m.dc.x + m.dr * 1.15, m.dc.y, C.gridStrong, 1.2);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.dc.x, m.dc.y, m.dr, Math.PI, 0);
        ctx.stroke();
        // the part of the dome this lens can't see
        if (m.maxT < Math.PI / 2 - 0.001) {
          ctx.strokeStyle = "rgba(255,133,133,0.6)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(m.dc.x, m.dc.y, m.dr, -Math.PI / 2 + m.maxT, 0);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(m.dc.x, m.dc.y, m.dr, Math.PI, Math.PI + (Math.PI / 2 - m.maxT));
          ctx.stroke();
        }
        ctx.strokeStyle = C.good;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.dc.x, m.dc.y, m.dr * 0.28, -Math.PI / 2, -Math.PI / 2 + m.th);
        ctx.stroke();
        line(ctx, m.dc.x, m.dc.y, m.hx, m.hy, "#ffffff", 2);
        dot(ctx, m.dc.x, m.dc.y, 3, C.text);
        handle(ctx, m.hx, m.hy);
        label(ctx, "θ", m.dc.x + Math.sin(m.th / 2) * m.dr * 0.4, m.dc.y - Math.cos(m.th / 2) * m.dr * 0.4, { color: C.good, size: fs + 2 });
        label(ctx, "the dome, side on", m.dc.x - m.dr, m.dc.y - m.dr - (narrow ? 10 : 18), { size: fs });
        if (!narrow) label(ctx, "horizon", m.dc.x + m.dr * 1.15, m.dc.y + 14, { size: fs - 2, color: C.muted, align: "right" });

        // ρ(θ) for every law
        const ch = m.chart;
        line(ctx, ch.x, ch.y + ch.h, ch.x + ch.w, ch.y + ch.h, C.gridStrong);
        line(ctx, ch.x, ch.y, ch.x, ch.y + ch.h, C.gridStrong);
        FISHEYE_LAWS.forEach((L, k) => {
          ctx.strokeStyle = L.color;
          ctx.globalAlpha = k === lawIndex ? 1 : 0.32;
          ctx.lineWidth = k === lawIndex ? 2.2 : 1.2;
          ctx.beginPath();
          for (let s = 0; s <= 48; s++) {
            const t = (s / 48) * m.maxT;
            const x = ch.x + (t / m.maxT) * ch.w;
            const y = ch.y + ch.h - clamp(L.project(t, m.maxT), 0, 1.05) * ch.h;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
        ctx.globalAlpha = 1;
        const mx = ch.x + (m.th / m.maxT) * ch.w;
        const my = ch.y + ch.h - m.rho * ch.h;
        line(ctx, mx, ch.y + ch.h, mx, my, "rgba(255,255,255,0.35)");
        line(ctx, ch.x, my, mx, my, "rgba(255,255,255,0.35)");
        dot(ctx, mx, my, 4, law.color);
        label(ctx, "ρ", ch.x - 10, ch.y + 4, { size: fs, color: C.muted, align: "center" });
        label(ctx, "θ →", ch.x + ch.w, ch.y + ch.h + 12, { size: fs - 1, color: C.muted, align: "right" });
        label(ctx, law.formula, ch.x + 6, ch.y - 10, { size: fs - 1, mono: true, color: law.color });

        const dir = domeDirection(phi, m.th);
        const uvX = 0.5 + 0.5 * Math.cos(phi) * m.rho;
        const uvY = 0.5 - 0.5 * Math.sin(phi) * m.rho;
        const tx = narrow ? 12 : w * 0.06;
        label(ctx, `dir = (${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)})   uv = (${uvX.toFixed(3)}, ${uvY.toFixed(3)})`, tx, m.textY, {
          size: narrow ? 10 : 12,
          mono: true,
          color: C.muted,
          weight: 400,
        });
      });
      shell.tick();
    },
  };
}

// =============================================================================
// Part 3 · the same sky as a fisheye and as cube faces
// =============================================================================

type CubeFace = "+X" | "-X" | "+Y" | "-Y" | "+Z";

// The five faces a dome needs, unfolded like a cross: the top face in the
// middle and each side face folded out from the edge it shares with it, so
// the cross reads the same way as the fisheye beside it. Only the inner half
// of each side face is above the horizon.
const CROSS: Record<CubeFace, { col: number; row: number }> = {
  "+Z": { col: 1, row: 1 },
  "+Y": { col: 1, row: 0 },
  "-Y": { col: 1, row: 2 },
  "+X": { col: 2, row: 1 },
  "-X": { col: 0, row: 1 },
};
const FACES: CubeFace[] = ["+Z", "+Y", "-Y", "+X", "-X"];

function majorFace(d: Vec3): CubeFace | null {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  if (az >= ax && az >= ay) return d.z >= 0 ? "+Z" : null;
  if (ax >= ay) return d.x >= 0 ? "+X" : "-X";
  return d.y >= 0 ? "+Y" : "-Y";
}

// Position inside a face's square in the cross, 0..1 with y down.
function crossUv(face: CubeFace, d: Vec3): { u: number; v: number } {
  switch (face) {
    case "+Z":
      return { u: 0.5 + (0.5 * d.x) / d.z, v: 0.5 - (0.5 * d.y) / d.z };
    case "+Y":
      return { u: 0.5 + (0.5 * d.x) / d.y, v: 0.5 + (0.5 * d.z) / d.y };
    case "-Y":
      return { u: 0.5 + (0.5 * d.x) / -d.y, v: 0.5 - (0.5 * d.z) / -d.y };
    case "+X":
      return { u: 0.5 - (0.5 * d.z) / d.x, v: 0.5 - (0.5 * d.y) / d.x };
    case "-X":
      return { u: 0.5 + (0.5 * d.z) / -d.x, v: 0.5 - (0.5 * d.y) / -d.x };
  }
}

function crossDir(face: CubeFace, u: number, v: number): Vec3 {
  const s = u * 2 - 1;
  const t = v * 2 - 1;
  switch (face) {
    case "+Z":
      return normalize3({ x: s, y: -t, z: 1 });
    case "+Y":
      return normalize3({ x: s, y: 1, z: t });
    case "-Y":
      return normalize3({ x: s, y: -1, z: -t });
    case "+X":
      return normalize3({ x: 1, y: -t, z: -s });
    case "-X":
      return normalize3({ x: -1, y: -t, z: s });
  }
}

// The face-local coordinates a cubemap lookup uses: the other two components
// divided by the biggest one.
function faceCoords(face: CubeFace, d: Vec3): string {
  switch (face) {
    case "+Z":
      return `x/z = ${(d.x / d.z).toFixed(2)}, y/z = ${(d.y / d.z).toFixed(2)}`;
    case "+Y":
    case "-Y":
      return `x/|y| = ${(d.x / Math.abs(d.y)).toFixed(2)}, z/|y| = ${(d.z / Math.abs(d.y)).toFixed(2)}`;
    default:
      return `y/|x| = ${(d.y / Math.abs(d.x)).toFixed(2)}, z/|x| = ${(d.z / Math.abs(d.x)).toFixed(2)}`;
  }
}

function formatsLayout(w: number, h: number, narrow: boolean) {
  if (narrow) {
    const fr = Math.min(w * 0.36, h * 0.19);
    const cell = Math.min((w - 24) / 3, h * 0.15);
    return { fr, fc: { x: w * 0.5, y: 24 + fr }, cell, nx: (w - cell * 3) / 2, ny: 24 + fr * 2 + 46, textY: h * 0.95 };
  }
  const fr = Math.min(w * 0.2, h * 0.34);
  const cell = Math.min(w * 0.14, h * 0.24);
  return { fr, fc: { x: w * 0.25, y: h * 0.45 }, cell, nx: w * 0.53, ny: h * 0.45 - cell * 1.5, textY: h * 0.92 };
}

export function mountMasterFormats(container: HTMLElement): Demo {
  const narrow = (container.clientWidth || 700) < 560;
  const shell = new Shell(container, narrow ? 1.45 : 0.62);
  let azimuth = 0.8;
  let zenith = 0.62;
  let orbiting = false;
  const fish = new Raster((i, j, W, H) => {
    const x = ((i + 0.5) / W) * 2 - 1;
    const y = 1 - ((j + 0.5) / H) * 2;
    const rho = Math.hypot(x, y);
    if (rho > 1) return null;
    return domePattern(domeDirection(Math.atan2(y, x), rho * (Math.PI / 2)), 0.9);
  });
  const faces = Object.fromEntries(
    FACES.map((f) => {
      const r = new Raster((i, j, W, H) => {
        const d = crossDir(f, (i + 0.5) / W, (j + 0.5) / H);
        const c = domePattern(d, 0.9);
        // below the horizon: not part of a dome master
        return d.z < 0 ? [c[0] * 0.25, c[1] * 0.25, c[2] * 0.3] : c;
      });
      return [f, r];
    }),
  ) as Record<CubeFace, Raster>;

  const azSlider = shell.slider({
    label: "azimuth",
    min: 0,
    max: TAU,
    step: 0.001,
    value: azimuth,
    format: (v) => `${(v / DEG).toFixed(0)}°`,
    onInput: (v) => (azimuth = v),
  });
  const zenSlider = shell.slider({
    label: "zenith angle",
    min: 0,
    max: Math.PI / 2,
    step: 0.001,
    value: zenith,
    format: (v) => `${(v / DEG).toFixed(0)}°`,
    onInput: (v) => (zenith = v),
  });
  const orbitButton = shell.button("orbit", () => {
    orbiting = !orbiting;
    orbitButton.textContent = orbiting ? "stop" : "orbit";
  });
  shell.button("zenith", () => {
    syncSlider(zenSlider, 0.001);
  });
  shell.button("horizon", () => syncSlider(zenSlider, Math.PI / 2 - 0.001));

  const metrics = () => {
    const w = shell.canvas.clientWidth;
    const h = shell.canvas.clientHeight;
    const L = formatsLayout(w, h, narrow);
    const dir = domeDirection(azimuth, zenith);
    const rho = zenith / (Math.PI / 2);
    const face = majorFace(dir) ?? "+Z";
    const uv = crossUv(face, dir);
    const cell = CROSS[face];
    return {
      ...L,
      dir,
      face,
      fx: L.fc.x + Math.cos(azimuth) * rho * L.fr,
      fy: L.fc.y - Math.sin(azimuth) * rho * L.fr,
      cx: L.nx + (cell.col + uv.u) * L.cell,
      cy: L.ny + (cell.row + uv.v) * L.cell,
    };
  };

  dragging<"fisheye" | CubeFace>(
    shell.canvas,
    (x, y) => {
      const m = metrics();
      if (Math.hypot(x - m.fc.x, y - m.fc.y) <= m.fr + 14) return "fisheye";
      for (const f of FACES) {
        const c = CROSS[f];
        const x0 = m.nx + c.col * m.cell;
        const y0 = m.ny + c.row * m.cell;
        if (x >= x0 && x <= x0 + m.cell && y >= y0 && y <= y0 + m.cell) return f;
      }
      return null;
    },
    (which, x, y) => {
      const m = metrics();
      if (which === "fisheye") {
        azimuth = normAngle(Math.atan2(m.fc.y - y, x - m.fc.x));
        zenith = clamp(Math.hypot(x - m.fc.x, y - m.fc.y) / m.fr, 0, 1) * (Math.PI / 2);
      } else {
        const c = CROSS[which];
        const u = clamp((x - (m.nx + c.col * m.cell)) / m.cell, 0, 1);
        const v = clamp((y - (m.ny + c.row * m.cell)) / m.cell, 0, 1);
        const d = crossDir(which, u, v);
        azimuth = normAngle(Math.atan2(d.y, d.x));
        zenith = Math.acos(clamp(d.z, 0, 1));
      }
      syncSlider(azSlider, azimuth);
      syncSlider(zenSlider, zenith);
    },
    () => {
      orbiting = false;
      orbitButton.textContent = "orbit";
    },
  );

  shell.setInfo(() => {
    const m = metrics();
    const d = m.dir;
    return `dir (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)}) · fisheye uv (${(0.5 + 0.5 * Math.cos(azimuth) * (zenith / (Math.PI / 2))).toFixed(3)}, ${(0.5 - 0.5 * Math.sin(azimuth) * (zenith / (Math.PI / 2))).toFixed(3)}) · cube face ${m.face}: ${faceCoords(m.face, d)}`;
  });

  return {
    frame() {
      if (orbiting) {
        azimuth = normAngle(azimuth + 0.005);
        syncSlider(azSlider, azimuth);
      }
      withCanvas(shell.canvas, (ctx, w, _h, dpr) => {
        const m = metrics();
        const fs = narrow ? 11 : 13;
        fish.draw(ctx, m.fc.x - m.fr, m.fc.y - m.fr, m.fr * 2, m.fr * 2, dpr, "fish");
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(m.fc.x, m.fc.y, m.fr, 0, TAU);
        ctx.stroke();
        line(ctx, m.fc.x, m.fc.y, m.fx, m.fy, "#ffffff", 2);
        handle(ctx, m.fx, m.fy);
        label(ctx, "fisheye master: one circle", m.fc.x, m.fc.y - m.fr - (narrow ? 12 : 18), { size: fs, align: "center" });

        for (const f of FACES) {
          const c = CROSS[f];
          const x0 = m.nx + c.col * m.cell;
          const y0 = m.ny + c.row * m.cell;
          faces[f].draw(ctx, x0, y0, m.cell, m.cell, dpr, f);
          ctx.strokeStyle = f === m.face ? C.accent : "rgba(220, 225, 240, 0.35)";
          ctx.lineWidth = f === m.face ? 2.2 : 1;
          ctx.strokeRect(x0 + 0.5, y0 + 0.5, m.cell - 1, m.cell - 1);
          // face name, placed in the half that's below the horizon
          const lx = x0 + m.cell / 2 + (f === "+X" ? m.cell * 0.25 : f === "-X" ? -m.cell * 0.25 : 0);
          const ly = y0 + m.cell / 2 + (f === "+Y" ? -m.cell * 0.25 : f === "-Y" ? m.cell * 0.25 : 0);
          label(ctx, f, lx, f === "+Z" ? y0 + 12 : ly, {
            size: fs,
            mono: true,
            align: "center",
            color: f === m.face ? "#ffffff" : C.muted,
          });
        }
        handle(ctx, m.cx, m.cy);
        label(ctx, "cubemap: five 90° faces", m.nx + m.cell * 1.5, m.ny - (narrow ? 12 : 18), { size: fs, align: "center" });
        if (!narrow) {
          label(ctx, "dimmed: below the horizon", m.nx + m.cell * 1.5, m.ny + m.cell * 3 + 16, {
            size: fs - 2,
            color: C.muted,
            align: "center",
          });
        }
        if (!narrow) {
          label(ctx, `face ${m.face}   ${faceCoords(m.face, m.dir)}`, w * 0.06, m.textY, {
            size: 12,
            mono: true,
            color: C.muted,
            weight: 400,
          });
        }
      });
      shell.tick();
    },
  };
}

// =============================================================================
// Part 4 · two projectors and the overlap between them
// =============================================================================

type BlendMode = "none" | "linear" | "gamma";
const GAMMA = 2.2;

export function mountWarpBlendShow(container: HTMLElement): Demo {
  const narrow = (container.clientWidth || 700) < 560;
  const shell = new Shell(container, narrow ? 1.05 : 0.62);
  const state = { blend: "gamma" as BlendMode, misalign: 0, black: 0.02, overlap: 0.3 };
  const strip = new Raster((i, j, W, H) => stripShade(i, j, W, H));

  // Where projector A and B cover the strip (x from 0 to 1), and the blend
  // ramp across the overlap: 1 at A's side, 0 at B's.
  const zones = () => {
    const a1 = 0.5 + state.overlap / 2;
    const b0 = 0.5 - state.overlap / 2;
    return { a1, b0 };
  };
  const ramp = (x: number): number => {
    const { a1, b0 } = zones();
    if (x <= b0) return 1;
    if (x >= a1) return 0;
    return 1 - smooth01((x - b0) / (a1 - b0));
  };
  // The signal each projector is sent, as a multiplier on encoded pixels.
  const masks = (x: number): [number, number] => {
    const { a1, b0 } = zones();
    const inA = x <= a1 ? 1 : 0;
    const inB = x >= b0 ? 1 : 0;
    if (state.blend === "none") return [inA, inB];
    const r = ramp(x);
    if (state.blend === "linear") return [r * inA, (1 - r) * inB];
    return [Math.pow(r, 1 / GAMMA) * inA, Math.pow(1 - r, 1 / GAMMA) * inB];
  };
  // Light on the dome = what each projector's pixel value turns into, plus
  // each projector's black level wherever it covers.
  const light = (content: number, x: number): number => {
    const [ma, mb] = masks(x);
    const { a1, b0 } = zones();
    const enc = Math.pow(content, 1 / GAMMA);
    let L = Math.pow(enc * ma, GAMMA) + Math.pow(enc * mb, GAMMA);
    if (x <= a1) L += state.black;
    if (x >= b0) L += state.black;
    return L;
  };
  // the test content: a bright-to-dark ramp with grid lines on it, over a
  // band of pure black at the bottom, where only the black level shows
  const content = (x: number, y: number, shift: number): number => {
    if (y > 0.76) return 0;
    const yy = y / 0.76;
    const base = 0.8 * Math.pow(1 - yy, 1.6);
    const gx = Math.abs(((x * 16 + shift) % 1 + 1) % 1 - 0.5);
    const gy = Math.abs(((yy * 5) % 1) - 0.5);
    const lineV = gx > 0.46 ? 1 : 0;
    const lineH = gy > 0.45 ? 1 : 0;
    return Math.max(base, Math.max(lineV, lineH) * 0.85 * (1 - yy * 0.5));
  };
  const stripShade = (i: number, j: number, W: number, H: number): RGB => {
    const x = (i + 0.5) / W;
    const y = (j + 0.5) / H;
    const [ma, mb] = masks(x);
    const { a1, b0 } = zones();
    // B's image is shifted by `misalign` grid cells: a calibration error
    const ca = content(x, y, 0);
    const cb = content(x, y, -state.misalign);
    let L = Math.pow(Math.pow(ca, 1 / GAMMA) * ma, GAMMA) + Math.pow(Math.pow(cb, 1 / GAMMA) * mb, GAMMA);
    if (x <= a1) L += state.black;
    if (x >= b0) L += state.black;
    const s = Math.pow(clamp(L, 0, 1), 1 / GAMMA) * 255;
    return [s * 0.96, s * 0.98, s];
  };

  const blendButtons: HTMLButtonElement[] = [];
  const setBlend = (b: BlendMode): void => {
    state.blend = b;
    blendButtons.forEach((btn) => btn.classList.toggle("is-on", btn.dataset.mode === b));
  };
  for (const [mode, name] of [
    ["none", "no blend"],
    ["linear", "ramp the pixel values"],
    ["gamma", "ramp the light"],
  ] as Array<[BlendMode, string]>) {
    const b = shell.button(name, () => setBlend(mode));
    b.dataset.mode = mode;
    blendButtons.push(b);
  }
  setBlend("gamma");
  shell.slider({
    label: "misalignment",
    min: 0,
    max: 0.5,
    step: 0.01,
    value: state.misalign,
    format: (v) => `${(v * 100).toFixed(0)}% of a cell`,
    onInput: (v) => (state.misalign = v),
  });
  shell.slider({
    label: "projector black level",
    min: 0,
    max: 0.06,
    step: 0.001,
    value: state.black,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    onInput: (v) => (state.black = v),
  });
  shell.slider({
    label: "overlap",
    min: 0.1,
    max: 0.6,
    step: 0.01,
    value: state.overlap,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    onInput: (v) => (state.overlap = v),
  });

  shell.setInfo(() => {
    const mid = light(1, 0.5) - 2 * state.black;
    return `white in the middle of the overlap: ${(mid * 100).toFixed(0)}% of one projector · black there: ${(state.black * 2 * 100).toFixed(1)}% vs ${(state.black * 100).toFixed(1)}%`;
  });

  return {
    frame() {
      withCanvas(shell.canvas, (ctx, w, h, dpr) => {
        const fs = narrow ? 10 : 12;
        const x0 = narrow ? 12 : w * 0.06;
        const x1 = w - x0;
        const sw = x1 - x0;
        const { a1, b0 } = zones();
        const X = (x: number): number => x0 + x * sw;

        // coverage brackets
        const by = narrow ? 18 : 26;
        const bracket = (from: number, to: number, y: number, color: string, name: string): void => {
          line(ctx, X(from), y, X(to), y, color, 3);
          line(ctx, X(from), y - 5, X(from), y + 5, color, 2);
          line(ctx, X(to), y - 5, X(to), y + 5, color, 2);
          label(ctx, name, (X(from) + X(to)) / 2, y - (narrow ? 9 : 11), { color, size: fs, align: "center" });
        };
        bracket(0, a1, by + 4, C.accent, "projector A");
        bracket(b0, 1, by + (narrow ? 26 : 30), C.warm, "projector B");

        // what the audience sees
        const sy = by + (narrow ? 44 : 52);
        const sh = h * (narrow ? 0.34 : 0.4);
        const key = `${state.blend}|${state.misalign}|${state.black}|${state.overlap}`;
        strip.draw(ctx, x0, sy, sw, sh, dpr, key);
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.strokeRect(x0 + 0.5, sy + 0.5, sw - 1, sh - 1);
        ctx.setLineDash([4, 4]);
        line(ctx, X(b0), sy, X(b0), sy + sh, "rgba(255,184,107,0.5)");
        line(ctx, X(a1), sy, X(a1), sy + sh, "rgba(122,162,255,0.5)");
        ctx.setLineDash([]);

        // light across the strip, for white content: target is 1
        const py = sy + sh + (narrow ? 20 : 28);
        const ph = h - py - (narrow ? 22 : 26);
        const maxL = 2.2;
        const Y = (v: number): number => py + ph - (v / maxL) * ph;
        line(ctx, x0, Y(0), x1, Y(0), C.gridStrong);
        ctx.setLineDash([3, 4]);
        line(ctx, x0, Y(1), x1, Y(1), "rgba(255,255,255,0.35)");
        ctx.setLineDash([]);
        label(ctx, "one projector", x1, Y(1) - 9, { size: fs - 1, color: C.muted, align: "right", weight: 500 });
        const curve = (f: (x: number) => number, color: string, width: number): void => {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (let s = 0; s <= 200; s++) {
            const x = s / 200;
            const v = f(x);
            if (s === 0) ctx.moveTo(X(x), Y(v));
            else ctx.lineTo(X(x), Y(v));
          }
          ctx.stroke();
        };
        curve((x) => Math.pow(masks(x)[0], GAMMA), "rgba(122,162,255,0.8)", 1.4);
        curve((x) => Math.pow(masks(x)[1], GAMMA), "rgba(255,184,107,0.8)", 1.4);
        curve((x) => light(1, x) - (x <= a1 ? state.black : 0) - (x >= b0 ? state.black : 0), "#ffffff", 2.4);
        label(ctx, "light from A", x0 + 4, py - 2, { size: fs - 1, color: C.accent, weight: 500 });
        label(ctx, "from B", x0 + (narrow ? 78 : 92), py - 2, { size: fs - 1, color: C.warm, weight: 500 });
        label(ctx, "total", x0 + (narrow ? 130 : 150), py - 2, { size: fs - 1, color: "#ffffff", weight: 500 });
        const dip = light(1, 0.5) - 2 * state.black;
        label(ctx, `${(dip * 100).toFixed(0)}%`, X(0.5), Y(dip) + (dip > 1.05 ? -12 : 14), {
          size: fs,
          mono: true,
          align: "center",
          color: Math.abs(dip - 1) < 0.03 ? C.good : C.red,
        });
      });
      shell.tick();
    },
  };
}

// =============================================================================
// Part 5 · direct projector renders vs a shared master
// =============================================================================

const PROJ_COLORS = ["#7aa2ff", "#ffb86b", "#7dd6a0", "#c59bff"];

export function mountRealtimeProjectors(container: HTMLElement): Demo {
  const narrow = (container.clientWidth || 700) < 560;
  const shell = new Shell(container, narrow ? 1.6 : 0.6);
  const state = { projectors: 3, projW: 1920, master: 4096 };
  let time = 0;
  let last = performance.now();

  shell.slider({
    label: "projectors",
    min: 1,
    max: 4,
    step: 1,
    value: state.projectors,
    format: (v) => v.toFixed(0),
    onInput: (v) => (state.projectors = Math.round(v)),
  });
  shell.slider({
    label: "projector width",
    min: 1280,
    max: 3840,
    step: 640,
    value: state.projW,
    format: (v) => `${v.toFixed(0)} × ${Math.round((v * 10) / 16)}`,
    onInput: (v) => (state.projW = v),
  });
  shell.slider({
    label: "fisheye master",
    min: 2048,
    max: 8192,
    step: 1024,
    value: state.master,
    format: (v) => `${(v / 1024).toFixed(0)}K`,
    onInput: (v) => (state.master = v),
  });

  // Pixels each path shades with the full scene, per frame.
  const costs = () => {
    const n = state.projectors;
    const proj = state.projW * Math.round((state.projW * 10) / 16);
    // a cube face that matches the fisheye's sharpness at the face centre:
    // the fisheye has master/π pixels per radian, a face has face/2
    const face = Math.round((2 * state.master) / Math.PI);
    return {
      n,
      proj,
      face,
      direct: { renders: n, px: n * proj },
      fisheye: { renders: 1, px: (Math.PI / 4) * state.master * state.master },
      cube: { renders: 5, px: 3 * face * face },
      warp: n * proj,
    };
  };

  shell.setInfo(() => {
    const c = costs();
    return `cube faces ${c.face} px to match the ${(state.master / 1024).toFixed(0)}K fisheye at the centre of each face`;
  });

  return {
    frame() {
      const now = performance.now();
      time += Math.min(0.05, (now - last) / 1000);
      last = now;
      withCanvas(shell.canvas, (ctx, w, h) => {
        const fs = narrow ? 10 : 12;
        const c = costs();

        // ---- the room, from above: projectors on the rim, each throwing
        // across the dome to the far side
        const r = narrow ? Math.min(w * 0.3, h * 0.17) : Math.min(w * 0.17, h * 0.3);
        const cx = narrow ? w * 0.5 : w * 0.24;
        const cy = narrow ? 30 + r * 1.35 : h * 0.5;
        const n = c.n;
        const slice = TAU / n;
        ctx.fillStyle = "rgba(122, 162, 255, 0.04)";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.fill();
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + i * slice; // where projector i sits
          const aim = a + Math.PI; // the far side, which it covers
          const half = n === 1 ? Math.PI : slice / 2 + 0.22;
          const color = PROJ_COLORS[i];
          const px = cx + Math.cos(a) * r * 1.22;
          const py = cy + Math.sin(a) * r * 1.22;
          // its patch of dome
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `${color}26`;
          ctx.beginPath();
          if (n === 1) ctx.arc(cx, cy, r, 0, TAU);
          else {
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, aim - half, aim + half);
            ctx.closePath();
          }
          ctx.fill();
          ctx.restore();
          // the beam: from the lens to the edges of its patch
          const e0 = n === 1 ? a + Math.PI - 1.1 : aim - half;
          const e1 = n === 1 ? a + Math.PI + 1.1 : aim + half;
          ctx.strokeStyle = `${color}66`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(cx + Math.cos(e0) * r, cy + Math.sin(e0) * r);
          ctx.moveTo(px, py);
          ctx.lineTo(cx + Math.cos(e1) * r, cy + Math.sin(e1) * r);
          ctx.stroke();
          dot(ctx, px, py, 5, color);
          label(ctx, `P${i + 1}`, px + Math.cos(a) * 14, py + Math.sin(a) * 14, { color, size: fs, align: "center", mono: true });
        }
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();
        // a few moving lights standing in for the live scene
        for (let i = 0; i < 18; i++) {
          const a = i * 2.39996 + time * (0.18 + (i % 4) * 0.04);
          const rr = r * (0.12 + 0.8 * ((i * 0.618) % 1));
          dot(ctx, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.6 + (i % 3) * 0.6, "rgba(255,255,255,0.75)");
        }
        label(ctx, "dome from above", cx, cy + r * 1.22 + (narrow ? 26 : 34), { size: fs, color: C.muted, align: "center" });

        // ---- the cost of each path, in pixels shaded with the full scene
        const bx = narrow ? 14 : w * 0.48;
        const bw = narrow ? w - 28 : w * 0.46;
        const top = narrow ? cy + r * 1.22 + 74 : h * 0.18;
        const rowH = narrow ? 52 : h * 0.19;
        const rows = [
          { name: `direct: ${n} projector camera${n === 1 ? "" : "s"}`, renders: c.direct.renders, px: c.direct.px, color: C.accent },
          { name: `fisheye master, ${(state.master / 1024).toFixed(0)}K`, renders: c.fisheye.renders, px: c.fisheye.px, color: C.warm },
          { name: `cubemap, five ${c.face}² faces (half of four used)`, renders: c.cube.renders, px: c.cube.px, color: C.good },
        ];
        const maxPx = Math.max(...rows.map((x) => x.px), 1);
        label(ctx, "pixels shaded with the full scene, per frame", bx, top - (narrow ? 14 : 22), { size: fs + 1 });
        rows.forEach((row, k) => {
          const y = top + k * rowH;
          label(ctx, row.name, bx, y + 8, { size: fs, color: C.muted, weight: 500 });
          label(ctx, `${row.renders} render${row.renders === 1 ? "" : "s"}`, bx + bw, y + 8, { size: fs, mono: true, align: "right", color: C.dim });
          const bh = narrow ? 14 : 16;
          const len = (row.px / maxPx) * bw;
          ctx.fillStyle = "rgba(255,255,255,0.05)";
          ctx.fillRect(bx, y + 18, bw, bh);
          ctx.save();
          ctx.shadowColor = row.color;
          ctx.shadowBlur = 10;
          ctx.fillStyle = row.color;
          ctx.fillRect(bx, y + 18, Math.max(2, len), bh);
          ctx.restore();
          const inside = len > bw - 70;
          label(ctx, `${(row.px / 1e6).toFixed(1)} MP`, inside ? bx + len - 6 : bx + len + 6, y + 18 + bh / 2, {
            size: fs,
            mono: true,
            color: inside ? "#0b0d14" : C.text,
            align: inside ? "right" : "left",
            weight: 600,
          });
        });
        const wy = top + rows.length * rowH + (narrow ? 2 : 6);
        const warpText = narrow
          ? `+ warp and blend: ${(c.warp / 1e6).toFixed(1)} MP of cheap lookups`
          : `plus the warp and blend: ${(c.warp / 1e6).toFixed(1)} MP of cheap texture lookups on every path`;
        label(ctx, warpText, bx, wy, {
          size: fs - 1,
          color: C.dim,
          weight: 500,
        });
      });
      shell.tick();
    },
  };
}
