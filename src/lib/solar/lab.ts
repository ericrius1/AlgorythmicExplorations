// Shared pieces for the Solar Stack's GPU figures. They run on the same
// chassis as Spark & Signal (lib/neuron/stage.ts: WebGPU, an orbit camera,
// HDR bloom, a 2D overlay), and like those figures they count instead of
// computing: photons are drawn from the sun's spectrum one at a time, stop at
// a depth drawn from the material's absorption coefficient, and every current
// and loss in the readouts is a tally of what the particles did. The
// detailed-balance model in demos/solar/physics.ts is the reference the
// tallies are drawn against.

import {
  E_MAX,
  E_MIN,
  nmFromEv,
  perovskiteAlpha,
  samplePhotonEnergy,
  siliconAlpha,
} from "../../demos/solar/physics";
import { HUD_FONT, type NeuronStage } from "../neuron/stage";

export const ENERGY_TABLE = 2048;
export const ALPHA_BINS = 512;

/** photon energies at evenly spaced quantiles of the sun's photon flux: index it with a uniform random number */
export function energyTable(): Float32Array {
  const t = new Float32Array(ENERGY_TABLE);
  for (let i = 0; i < ENERGY_TABLE; i++) t[i] = samplePhotonEnergy((i + 0.5) / ENERGY_TABLE);
  return t;
}

export type Material = "pvk" | "si" | "step";

/** absorption coefficient (1/cm) over the photon-energy grid the shaders index: perovskite, silicon, or an ideal
 *  step absorber (everything above the gap: a few microns of it take all of it, spread through its depth) */
export function alphaTable(material: Material, gap: number): Float32Array {
  const t = new Float32Array(ALPHA_BINS);
  for (let i = 0; i < ALPHA_BINS; i++) {
    const e = E_MIN + ((E_MAX - E_MIN) * i) / (ALPHA_BINS - 1);
    t[i] =
      material === "pvk"
        ? perovskiteAlpha(e, gap)
        : material === "si"
          ? e < gap
            ? 0
            : siliconAlpha(nmFromEv(e))
          : e >= gap
            ? 2.5e4
            : 0;
  }
  return t;
}

// ---- shared WGSL -------------------------------------------------------------

export const SOLAR_WGSL = /* wgsl */ `
const E_MIN: f32 = ${E_MIN.toFixed(3)};
const E_MAX: f32 = ${E_MAX.toFixed(3)};

// a photon's colour from its energy: the visible rainbow, a violet tint above it, a dull ember below it
fn photonColor(e: f32) -> vec3f {
  let nm = 1239.84 / e;
  var c = vec3f(0.0);
  if (nm < 380.0) { c = vec3f(0.42, 0.22, 0.95); }
  else if (nm < 440.0) { c = vec3f((440.0 - nm) / 60.0, 0.0, 1.0); }
  else if (nm < 490.0) { c = vec3f(0.0, (nm - 440.0) / 50.0, 1.0); }
  else if (nm < 510.0) { c = vec3f(0.0, 1.0, (510.0 - nm) / 20.0); }
  else if (nm < 580.0) { c = vec3f((nm - 510.0) / 70.0, 1.0, 0.0); }
  else if (nm < 645.0) { c = vec3f(1.0, (645.0 - nm) / 65.0, 0.0); }
  else if (nm <= 780.0) { c = vec3f(1.0, 0.0, 0.0); }
  else {
    let t = clamp((nm - 780.0) / 900.0, 0.0, 1.0);
    c = mix(vec3f(0.85, 0.08, 0.06), vec3f(0.32, 0.05, 0.08), t);
  }
  // the eye's falloff at the ends of the visible range
  var k = 1.0;
  if (nm > 700.0 && nm <= 780.0) { k = 0.35 + 0.65 * (780.0 - nm) / 80.0; }
  if (nm > 780.0) { k = 0.32; }
  if (nm < 420.0 && nm >= 380.0) { k = 0.35 + 0.65 * (nm - 380.0) / 40.0; }
  return c * k;
}

fn pcg(n: u32) -> u32 {
  let s = n * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(a: u32, b: u32, c: u32) -> f32 {
  return f32(pcg(a ^ pcg(b ^ pcg(c)))) / 4294967295.0;
}
fn gauss(a: u32, b: u32, c: u32) -> f32 {
  let u1 = max(rnd(a, b, c), 1e-7);
  let u2 = rnd(a, b, c ^ 0x5bd1e995u);
  return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
}
`;

// ---- HUD widgets -------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** a dark rounded panel for a readout */
export function panel(stage: NeuronStage, b: Box): void {
  const g = stage.g;
  const s = stage.px;
  g.fillStyle = "rgba(8, 9, 15, 0.66)";
  g.strokeStyle = "rgba(122, 162, 255, 0.16)";
  g.lineWidth = 1 * s;
  g.beginPath();
  g.roundRect(b.x, b.y, b.w, b.h, 8 * s);
  g.fill();
  g.stroke();
}

/** HUD type scale: smaller on a phone */
export function hudScale(stage: NeuronStage): number {
  return (stage.compact ? 0.72 : 1) * stage.px;
}

export function text(
  stage: NeuronStage,
  str: string,
  x: number,
  y: number,
  size: number,
  color = "rgba(200, 210, 235, 0.8)",
  weight = 600,
  align: CanvasTextAlign = "left",
): void {
  const g = stage.g;
  g.font = `${weight} ${size * hudScale(stage)}px ${HUD_FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(str, x, y);
  g.textAlign = "left";
}

export interface Segment {
  value: number;
  color: string;
  label: string;
}

/** a horizontal stacked bar of shares (each value 0..1), labelled; `marks` are reference values drawn as ticks
 *  (the model's answer, to compare the tally against) */
export function stackBar(stage: NeuronStage, b: Box, segs: Segment[], marks: number[] = []): void {
  const g = stage.g;
  const s = stage.px;
  const u = hudScale(stage);
  let x = b.x;
  const total = Math.max(1e-9, segs.reduce((a, q) => a + q.value, 0));
  for (const q of segs) {
    const w = (q.value / total) * b.w;
    g.fillStyle = q.color;
    g.fillRect(x, b.y, Math.max(0, w - 1 * s), b.h);
    x += w;
  }
  let acc = 0;
  for (const m of marks) {
    acc += m;
    const mx = b.x + Math.min(1, acc) * b.w;
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 1.2 * s;
    g.beginPath();
    g.moveTo(mx, b.y - 3 * s);
    g.lineTo(mx, b.y + b.h + 3 * s);
    g.stroke();
  }
  // legend under the bar
  g.font = `600 ${9.5 * u}px ${HUD_FONT}`;
  g.textBaseline = "alphabetic";
  let lx = b.x;
  const ly = b.y + b.h + 14 * u;
  for (const q of segs) {
    const t = `${q.label} ${((q.value / total) * 100).toFixed(1)}%`;
    const tw = g.measureText(t).width;
    if (lx + tw + 12 * u > b.x + b.w + 40 * s) break;
    g.fillStyle = q.color;
    g.fillRect(lx, ly - 7 * u, 7 * u, 7 * u);
    g.fillStyle = "rgba(205, 212, 232, 0.85)";
    g.fillText(t, lx + 10 * u, ly);
    lx += tw + 22 * u;
  }
}

/** a small x–y plot: the model's curve, a marker where the figure is now, optional tallied points */
export function miniCurve(
  stage: NeuronStage,
  b: Box,
  curve: [number, number][],
  xRange: [number, number],
  yRange: [number, number],
  opts: {
    title?: string;
    marker?: [number, number];
    points?: [number, number][];
    color?: string;
    /** reference curves, drawn dashed */
    dashed?: [number, number][][];
    xLabel?: string;
    xTicks?: number[];
  } = {},
): void {
  const g = stage.g;
  const s = stage.px;
  const u = hudScale(stage);
  panel(stage, b);
  const pad = 10 * s;
  const top = opts.title ? 22 * u : pad;
  const bot = opts.xTicks ? 16 * u : pad;
  const X = (x: number): number => b.x + pad + ((x - xRange[0]) / (xRange[1] - xRange[0])) * (b.w - pad * 2);
  const Y = (y: number): number => b.y + top + (1 - (y - yRange[0]) / (yRange[1] - yRange[0])) * (b.h - top - bot);
  if (opts.title) text(stage, opts.title, b.x + pad, b.y + 15 * u, 9.5, "rgba(200, 210, 235, 0.75)");
  const line = (pts: [number, number][], color: string, w: number, dash: number[] = []): void => {
    g.strokeStyle = color;
    g.lineWidth = w * s;
    g.setLineDash(dash.map((d) => d * s));
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke();
    g.setLineDash([]);
  };
  // (the curves stay inside the plot)
  g.save();
  g.beginPath();
  g.rect(b.x + pad * 0.5, b.y + top - 4 * s, b.w - pad, b.h - top - bot + 8 * s);
  g.clip();
  for (const d of opts.dashed ?? []) line(d, "rgba(200, 210, 235, 0.45)", 1.2, [3, 3]);
  line(curve, opts.color ?? "#ffe08a", 1.6);
  g.restore();
  if (opts.xTicks) {
    g.font = `${8.5 * u}px ${HUD_FONT}`;
    g.fillStyle = "rgba(160, 170, 195, 0.7)";
    g.textAlign = "center";
    for (const t of opts.xTicks) g.fillText(String(t), X(t), b.y + b.h - 4 * u);
    g.textAlign = "left";
  }
  for (const [x, y] of opts.points ?? []) {
    g.fillStyle = "rgba(255, 255, 255, 0.9)";
    g.beginPath();
    g.arc(X(x), Y(y), 2 * s, 0, Math.PI * 2);
    g.fill();
  }
  if (opts.marker) {
    const [mx, my] = opts.marker;
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.lineWidth = 1 * s;
    g.beginPath();
    g.moveTo(X(mx), b.y + top);
    g.lineTo(X(mx), b.y + b.h - bot);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(X(mx), Y(my), 3.2 * s, 0, Math.PI * 2);
    g.fill();
  }
}

/** a column histogram (bins of stacked shares) over an x range, with a reference curve on top */
export function histogram(
  stage: NeuronStage,
  b: Box,
  bins: number[][],
  colors: string[],
  xRange: [number, number],
  opts: { title?: string; curve?: [number, number][]; line?: { x: number; label: string; color: string }; xTicks?: number[] } = {},
): void {
  const g = stage.g;
  const s = stage.px;
  const u = hudScale(stage);
  panel(stage, b);
  const pad = 10 * s;
  const top = opts.title ? 22 * u : pad;
  const bot = opts.xTicks ? 16 * u : pad;
  const n = bins.length;
  let peak = 1e-9;
  for (const col of bins) peak = Math.max(peak, col.reduce((a, v) => a + v, 0));
  if (opts.curve) for (const [, y] of opts.curve) peak = Math.max(peak, y);
  const iw = b.w - pad * 2;
  const ih = b.h - top - bot;
  const bw = iw / n;
  for (let i = 0; i < n; i++) {
    let y = b.y + top + ih;
    bins[i].forEach((v, k) => {
      const h = (v / peak) * ih;
      g.fillStyle = colors[k];
      g.fillRect(b.x + pad + i * bw, y - h, Math.max(1 * s, bw - 0.6 * s), h);
      y -= h;
    });
  }
  const X = (x: number): number => b.x + pad + ((x - xRange[0]) / (xRange[1] - xRange[0])) * iw;
  if (opts.curve) {
    g.strokeStyle = "rgba(255, 255, 255, 0.7)";
    g.lineWidth = 1.2 * s;
    g.setLineDash([3 * s, 3 * s]);
    g.beginPath();
    opts.curve.forEach(([x, y], i) => {
      const px = X(x);
      const py = b.y + top + ih - (y / peak) * ih;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.stroke();
    g.setLineDash([]);
  }
  if (opts.line) {
    const lx = X(opts.line.x);
    g.strokeStyle = opts.line.color;
    g.lineWidth = 1.4 * s;
    g.beginPath();
    g.moveTo(lx, b.y + top - 4 * s);
    g.lineTo(lx, b.y + top + ih);
    g.stroke();
    text(stage, opts.line.label, lx + 4 * s, b.y + top + 6 * u, 9, opts.line.color);
  }
  if (opts.title) text(stage, opts.title, b.x + pad, b.y + 15 * u, 9.5, "rgba(200, 210, 235, 0.75)");
  if (opts.xTicks) {
    g.font = `${8.5 * u}px ${HUD_FONT}`;
    g.fillStyle = "rgba(160, 170, 195, 0.7)";
    g.textAlign = "center";
    for (const t of opts.xTicks) g.fillText(String(t), X(t), b.y + b.h - 4 * u);
    g.textAlign = "left";
  }
}

/** a value with its counting error: "21.4 ± 0.3" from a share of n trials */
export function tally(share: number, n: number, scale: number, digits = 1): string {
  if (n < 1) return "—";
  const err = Math.sqrt(Math.max(share * (1 - share), 1e-12) / n) * scale;
  return `${(share * scale).toFixed(digits)} ± ${err.toFixed(digits)}`;
}
