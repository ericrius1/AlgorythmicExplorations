// Small plotting helpers shared by the figures: panels, grids, axes.

import type { Glow } from "./glow";
import { C, TEXT } from "./figure";
import { logX } from "./dsp";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function panel(g: Glow, b: Box, title?: string, right?: string): void {
  g.rect(b.x, b.y, b.w, b.h, [0.05, 0.06, 0.1], 0.55, [0.02, 0.025, 0.04], 0.55);
  if (title) g.text(title.toUpperCase(), b.x + 2, b.y - 8, { size: 9.5, weight: 650, color: TEXT.dim });
  if (right) g.text(right, b.x + b.w - 2, b.y - 8, { size: 10, align: "right", color: TEXT.dim, mono: true });
}

export function hline(g: Glow, b: Box, y: number, alpha = 0.6, color = C.grid): void {
  g.seg(b.x, y, b.x + b.w, y, 1, color, alpha);
}
export function vline(g: Glow, b: Box, x: number, alpha = 0.6, color = C.grid): void {
  g.seg(x, b.y, x, b.y + b.h, 1, color, alpha);
}

/** dB → y inside a box (top = hi). */
export function dbY(b: Box, d: number, lo: number, hi: number): number {
  const t = (d - lo) / (hi - lo);
  return b.y + b.h * (1 - Math.min(1, Math.max(0, t)));
}

/** Log-frequency grid with labels at 100, 1k, 10k and faint decade lines. */
export function freqGrid(g: Glow, b: Box, lo: number, hi: number, labels = true): void {
  const decades = [10, 100, 1000, 10000];
  for (const d of decades) {
    for (let m = 1; m < 10; m++) {
      const f = d * m;
      if (f < lo || f > hi) continue;
      const x = b.x + logX(f, lo, hi) * b.w;
      const major = m === 1;
      g.seg(x, b.y, x, b.y + b.h, 1, C.grid, major ? 0.55 : 0.22);
      if (labels && (major || ((m === 2 || m === 5) && b.w > 420))) {
        const txt = f >= 1000 ? `${f / 1000}k` : `${f}`;
        g.text(txt, x, b.y + b.h + 13, { size: 10, align: "center", color: TEXT.dim, mono: true });
      }
    }
  }
}

export function fx(b: Box, f: number, lo: number, hi: number): number {
  return b.x + logX(f, lo, hi) * b.w;
}

/** Dashed polyline drawn as short segments. */
export function dashed(g: Glow, pts: number[], width: number, color: readonly [number, number, number], alpha: number, dash = 5, gap = 4): void {
  let carry = 0;
  let on = true;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    let x0 = pts[i];
    let y0 = pts[i + 1];
    const x1 = pts[i + 2];
    const y1 = pts[i + 3];
    let len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / (len || 1);
    const uy = (y1 - y0) / (len || 1);
    while (len > 0) {
      const want = (on ? dash : gap) - carry;
      const step = Math.min(want, len);
      const nx = x0 + ux * step;
      const ny = y0 + uy * step;
      if (on) g.seg(x0, y0, nx, ny, width, color, alpha);
      x0 = nx;
      y0 = ny;
      len -= step;
      carry += step;
      if (carry >= (on ? dash : gap) - 1e-6) {
        carry = 0;
        on = !on;
      }
    }
  }
}
