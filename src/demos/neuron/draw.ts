// Small drawing kit shared by the Spark & Signal figures. Everything draws in
// CSS pixels (the context is pre-scaled by the canvas's device-pixel ratio),
// so text and strokes are the same size on a phone as on a desktop.

import { pixelRatio } from "../../lib/palette";

export const INK = {
  bg: "#06070b",
  grid: "rgba(255,255,255,0.055)",
  axis: "rgba(255,255,255,0.16)",
  text: "#c9cfdf",
  muted: "#7d8499",
  faint: "#4c5266",
  volt: "#a9c4ff",
  na: "#ff8f70",
  k: "#62d0ff",
  spike: "#ffd27a",
  inhib: "#ff6f91",
  accent: "#7aa2ff",
};

export interface Surface {
  ctx: CanvasRenderingContext2D;
  w: number; // CSS px
  h: number;
  s: number; // device px per CSS px
}

export function surface(canvas: HTMLCanvasElement): Surface {
  const ctx = canvas.getContext("2d")!;
  const s = pixelRatio(canvas);
  return { ctx, w: canvas.width / s, h: canvas.height / s, s };
}

// Clear to the page background with the CSS-pixel transform in place.
export function begin(sf: Surface): CanvasRenderingContext2D {
  const { ctx, s } = sf;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  return ctx;
}

export function font(px: number, weight = 400, mono = false): string {
  return mono
    ? `${weight} ${px}px ui-monospace, "SF Mono", Menlo, monospace`
    : `${weight} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// A soft round glow, pre-rendered once per colour and drawn additively.
const sprites = new Map<string, HTMLCanvasElement>();
export function glow(color: [number, number, number], core = 0.35): HTMLCanvasElement {
  const key = `${color.join(",")}:${core}`;
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  const [r, gg, b] = color;
  grad.addColorStop(0, `rgba(255,255,255,${core})`);
  grad.addColorStop(0.12, `rgba(${r},${gg},${b},0.9)`);
  grad.addColorStop(0.4, `rgba(${r},${gg},${b},0.28)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

export function drawGlow(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, radius: number, alpha = 1): void {
  if (alpha <= 0.002 || radius <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

export function rgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Deterministic random numbers, so a figure looks the same on every load.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

// Simulated time keeps going at a fixed rate whatever the frame rate is, and
// a stalled tab doesn't come back with a huge jump.
export class Clock {
  private last = performance.now();
  constructor(public msPerSecond: number) {}
  // Simulated milliseconds to advance this frame.
  advance(): number {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    return dt * this.msPerSecond;
  }
}

// A scrolling record of a few channels sampled at a fixed simulated interval.
export class Trace {
  readonly size: number;
  readonly data: Float32Array[];
  head = 0; // samples written in total
  constructor(
    readonly channels: number,
    readonly windowMs: number,
    readonly sampleMs: number,
  ) {
    this.size = Math.ceil(windowMs / sampleMs) + 1;
    this.data = Array.from({ length: channels }, () => new Float32Array(this.size));
  }
  push(...values: number[]): void {
    const i = this.head % this.size;
    for (let c = 0; c < this.channels; c++) this.data[c][i] = values[c] ?? 0;
    this.head++;
  }
  fill(...values: number[]): void {
    for (let k = 0; k < this.size; k++) this.push(...values);
  }
  // Value of channel c, `ago` samples back from the newest.
  get(c: number, ago: number): number {
    return this.data[c][(this.head - 1 - ago + this.size * 4) % this.size];
  }
  get count(): number {
    return Math.min(this.head, this.size);
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Draw channel `c` of a trace into `box`, newest sample at the right edge.
export function plotTrace(
  ctx: CanvasRenderingContext2D,
  tr: Trace,
  c: number,
  box: Box,
  lo: number,
  hi: number,
  color: string,
  width: number,
  glowWidth = 0,
): void {
  const n = tr.count;
  if (n < 2) return;
  const toY = (v: number): number => box.y + box.h * (1 - (v - lo) / (hi - lo));
  const dx = box.w / (tr.size - 1);
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const x = box.x + box.w - k * dx;
    const y = toY(tr.get(c, k));
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineJoin = "round";
  if (glowWidth > 0) {
    ctx.strokeStyle = rgba(color, 0.16);
    ctx.lineWidth = glowWidth;
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Horizontal mV gridlines with labels on the left.
export function voltAxis(
  ctx: CanvasRenderingContext2D,
  box: Box,
  lo: number,
  hi: number,
  ticks: number[],
  unit = "mV",
): void {
  ctx.font = font(10, 500, true);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of ticks) {
    const y = box.y + box.h * (1 - (t - lo) / (hi - lo));
    ctx.strokeStyle = t === 0 ? INK.axis : INK.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x, Math.round(y) + 0.5);
    ctx.lineTo(box.x + box.w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillStyle = INK.muted;
    ctx.fillText(`${t > 0 ? "+" : ""}${t}`, box.x - 6, y);
  }
  ctx.fillStyle = INK.faint;
  ctx.textAlign = "right";
  ctx.fillText(unit, box.x - 6, box.y - 10);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

// A dashed reference line with a label at the right end.
export function refLine(
  ctx: CanvasRenderingContext2D,
  box: Box,
  y: number,
  color: string,
  label: string,
  above = true,
): void {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(box.x, Math.round(y) + 0.5);
  ctx.lineTo(box.x + box.w, Math.round(y) + 0.5);
  ctx.stroke();
  ctx.restore();
  ctx.font = font(10, 600);
  ctx.fillStyle = rgba(color, 0.9);
  ctx.textAlign = "right";
  ctx.fillText(label, box.x + box.w - 4, above ? y - 4 : y + 12);
  ctx.textAlign = "left";
}

// Time scale bar ("10 ms") under a trace.
export function timeBar(ctx: CanvasRenderingContext2D, box: Box, windowMs: number, ms: number): void {
  const len = (box.w * ms) / windowMs;
  const x1 = box.x + box.w;
  const y = box.y + box.h + 12;
  ctx.strokeStyle = INK.muted;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1 - len, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.font = font(10, 500, true);
  ctx.fillStyle = INK.muted;
  ctx.textAlign = "right";
  ctx.fillText(`${ms} ms`, x1 - len - 6, y + 3.5);
  ctx.textAlign = "left";
}
