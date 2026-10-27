// Small canvas-2D helpers for the Solar Stack figures. Everything is drawn in
// CSS pixels on a Retina-sized canvas, so text and strokes keep their size on
// any screen, and layouts can switch on the figure's CSS width.

import { Shell } from "../../lib/demoShell";

export const INK = "#f2f4fa";
export const TEXT = "#d7dbe6";
export const MUTED = "#8a91a5";
export const FAINT = "rgba(255,255,255,0.10)";
export const BG = "#06070b";

export const C_TOP = "#5fe0a8"; // perovskite
export const C_SI = "#7aa2ff"; // silicon
export const C_HEAT = "#ffaa5c"; // thermalisation
export const C_PASS = "#5b6a9a"; // passes through
export const C_KEPT = "#ffe08a"; // electrical work
export const C_VOLT = "#c48cff"; // voltage / emission loss
export const C_HOLE = "#ff7bb8";
export const C_ELEC = "#4fd8ff";
export const C_BAD = "#ff6a5a";

export const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
export const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";

export interface Canvas2D {
  shell: Shell;
  ctx: CanvasRenderingContext2D;
  /** CSS-pixel size of the drawing */
  W: number;
  H: number;
  narrow: boolean;
  /** reset the transform and clear to the figure background */
  begin(): void;
}

/**
 * A figure canvas whose aspect can differ on phones, where the same layout
 * would leave text unreadably small.
 */
export function figureCanvas(container: HTMLElement, aspect: number, narrowAspect = aspect * 1.6): Canvas2D {
  const narrow = (container.clientWidth || 720) < 560;
  const shell = new Shell(container, narrow ? narrowAspect : aspect);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // same cap as Shell
  const W = shell.canvas.width / dpr;
  const H = shell.canvas.height / dpr;
  const c: Canvas2D = {
    shell,
    ctx,
    W,
    H,
    narrow,
    begin() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
    },
  };
  return c;
}

/** pointer position in the figure's CSS-pixel space */
export function pointerPos(canvas: HTMLCanvasElement, e: PointerEvent, W: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const s = W / (r.width || W);
  return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s };
}

export function font(ctx: CanvasRenderingContext2D, size: number, weight = 400, mono = false): void {
  ctx.font = `${weight} ${size}px ${mono ? MONO : SANS}`;
}

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color = TEXT,
  align: CanvasTextAlign = "left",
): void {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
  ctx.textAlign = "left";
}

/** word-wrapped text; returns the y below the last line */
export function wrap(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  color = MUTED,
): number {
  ctx.fillStyle = color;
  let line = "";
  for (const word of s.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
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

export function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** a labelled colour chip for legends; returns the x after it */
export function chip(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, size = 12): number {
  ctx.fillStyle = color;
  roundRect(ctx, x, y - size * 0.75, size * 0.8, size * 0.8, 2);
  ctx.fill();
  font(ctx, size);
  text(ctx, label, x + size * 1.15, y, TEXT);
  return x + size * 1.15 + ctx.measureText(label).width + size * 1.1;
}

/**
 * Approximate display colour of light at a wavelength (nm). Infrared and
 * ultraviolet get a dim deep red / violet so they still show up.
 */
export function wavelengthRgb(nm: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm < 380) {
    return [90, 40, 140];
  } else if (nm < 440) {
    r = -(nm - 440) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / 65;
  } else if (nm <= 780) {
    r = 1;
  } else {
    // infrared: fade from red to a dull maroon
    const t = Math.min(1, (nm - 780) / 600);
    return [Math.round(200 - 90 * t), Math.round(40 - 20 * t), Math.round(50 - 10 * t)];
  }
  // intensity falls off at the edges of vision
  let f = 1;
  if (nm < 420) f = 0.35 + (0.65 * (nm - 380)) / 40;
  else if (nm > 700) f = 0.35 + (0.65 * (780 - nm)) / 80;
  const gam = (v: number): number => Math.round(255 * Math.pow(v * f, 0.8));
  return [gam(r), gam(g), gam(b)];
}

export function wavelengthCss(nm: number, a = 1): string {
  const [r, g, b] = wavelengthRgb(nm);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** a horizontal bar with a label on the left and a value on the right */
export function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string,
  label: string,
  value: string,
): void {
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.fillStyle = rgba(color, 0.5);
  roundRect(ctx, x, y, Math.max(0, w * clamp(frac, 0, 1)), h, 4);
  ctx.fill();
  font(ctx, Math.min(12, h * 0.6));
  text(ctx, label, x + 8, y + h * 0.68, INK);
  font(ctx, Math.min(12, h * 0.6), 600, true);
  text(ctx, value, x + w - 8, y + h * 0.68, INK, "right");
}
