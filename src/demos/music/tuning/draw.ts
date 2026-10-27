// Canvas 2D helpers for the tuning figures: a Retina-aware surface that
// keeps its backing store matched to its on-screen size, additive glows,
// and the fonts and colours the figures share.

export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export const COL = {
  bg: "#06070b",
  text: "#e8ebf4",
  dim: "#8a91a5",
  faint: "#3a4058",
  grid: "#1c2030",
  accent: "#7aa2ff",
  warm: "#ffb86b",
  good: "#7dd6a0",
  hot: "#ff6b6b",
  pink: "#ff7ab8",
  violet: "#b48cff",
};

export type RGB = [number, number, number];

export function hex(c: string): RGB {
  const h = c.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgba(c: RGB | string, a: number): string {
  const [r, g, b] = typeof c === "string" ? hex(c) : c;
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})`;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// HSL → RGB, h in turns.
export function hsl(h: number, s: number, l: number): RGB {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

// One colour per pitch class, ordered around the circle of fifths so that
// close keys get close colours: C gold, then G, D … through cool blues and
// violets back round to F.
export function pcColor(pc: number, light = 0.66): RGB {
  const q = (((pc * 7) % 12) + 12) % 12; // position on the circle of fifths
  return hsl(0.11 + q / 12, 0.78, light);
}

// Error colour: 0 = calm green, 1 = hot coral, beyond = magenta.
export function heat(t: number): RGB {
  const stops: RGB[] = [hex("#7dd6a0"), hex("#e8d27a"), hex("#ff9a5c"), hex("#ff5d6c"), hex("#e25bd6")];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixRgb(stops[i], stops[i + 1], x - i);
}

export class Surface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  w = 0; // CSS pixels
  h = 0;
  dpr = 1;
  private aspectFn: (cssWidth: number) => number;

  // aspectFn: height/width as a function of the on-screen width, so a figure
  // can be taller on a phone.
  constructor(canvas: HTMLCanvasElement, aspectFn: (cssWidth: number) => number) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.aspectFn = aspectFn;
    this.fit(true);
  }

  // Call at the start of every frame. Resizes the backing store when the
  // canvas changed size on screen, then resets the transform to CSS pixels.
  fit(force = false): boolean {
    const cw = this.canvas.clientWidth || this.canvas.width / (window.devicePixelRatio || 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const want = Math.round(cw * dpr);
    const aspect = this.aspectFn(cw);
    const wantH = Math.round(cw * aspect * dpr);
    let changed = false;
    if (force || Math.abs(want - this.canvas.width) > 1 || Math.abs(wantH - this.canvas.height) > 1) {
      if (want > 0) {
        this.canvas.width = want;
        this.canvas.height = wantH;
        changed = true;
      }
    }
    this.dpr = this.canvas.width / Math.max(1, cw);
    this.w = cw;
    this.h = this.canvas.height / this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return changed;
  }

  clear(bg = COL.bg): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  // Pointer position in CSS pixels relative to the canvas.
  local(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.w, y: ((e.clientY - r.top) / r.height) * this.h };
  }
}

// Soft additive glow: a radial gradient that fades to nothing at radius r.
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a: number): void {
  if (a <= 0.003 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(c, a));
  g.addColorStop(0.25, rgba(c, a * 0.45));
  g.addColorStop(0.6, rgba(c, a * 0.1));
  g.addColorStop(1, rgba(c, 0));
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = prev;
}

// A bright dot with a halo: the standard "note" mark.
export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a = 1, haloScale = 4): void {
  glow(ctx, x, y, r * haloScale, c, 0.35 * a);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = rgba(mixRgb(c, [255, 255, 255], 0.35), a);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = prev;
}

// Stroke the current path three times, wide and faint to thin and bright,
// for a glowing line. Leaves composite mode at "lighter" restored.
export function glowStroke(ctx: CanvasRenderingContext2D, c: RGB, a: number, width: number): void {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(c, a * 0.12);
  ctx.lineWidth = width * 5;
  ctx.stroke();
  ctx.strokeStyle = rgba(c, a * 0.3);
  ctx.lineWidth = width * 2.2;
  ctx.stroke();
  ctx.strokeStyle = rgba(mixRgb(c, [255, 255, 255], 0.25), a);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.globalCompositeOperation = prev;
}

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; weight?: number; mono?: boolean; alpha?: number } = {},
): number {
  const size = opts.size ?? 12;
  ctx.font = `${opts.weight ?? 500} ${size}px ${opts.mono ? MONO : FONT}`;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = opts.base ?? "alphabetic";
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.fillStyle = opts.color ?? COL.text;
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
  return ctx.measureText(s).width;
}

// Text on a dark rounded plate, for labels that sit over busy drawing.
export function label(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; color?: string; align?: "left" | "center" | "right"; bg?: string; mono?: boolean; weight?: number } = {},
): void {
  const size = opts.size ?? 11;
  ctx.font = `${opts.weight ?? 600} ${size}px ${opts.mono ? MONO : FONT}`;
  const w = ctx.measureText(s).width;
  const padX = size * 0.5;
  const h = size * 1.55;
  const align = opts.align ?? "center";
  const left = align === "center" ? x - w / 2 - padX : align === "right" ? x - w - padX * 2 : x;
  ctx.fillStyle = opts.bg ?? "rgba(8, 9, 14, 0.82)";
  roundRect(ctx, left, y - h / 2, w + padX * 2, h, h / 2);
  ctx.fill();
  ctx.fillStyle = opts.color ?? COL.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(s, left + padX, y + 0.5);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Point on a clock face: angle 0 = 12 o'clock, clockwise, in turns.
export function clock(cx: number, cy: number, r: number, turns: number): [number, number] {
  const a = turns * Math.PI * 2;
  return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
}

// Arc along a clock face from t0 to t1 turns (clockwise).
export function clockArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t0: number, t1: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, t0 * Math.PI * 2 - Math.PI / 2, t1 * Math.PI * 2 - Math.PI / 2, t1 < t0);
}

export const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Exponential approach that doesn't depend on frame rate.
export function approach(cur: number, target: number, rate: number, dt: number): number {
  return target + (cur - target) * Math.exp(-rate * dt);
}

// Signed cents with a real minus sign and fixed decimals: "+13.7", "−1.96".
export function signed(x: number, digits = 1): string {
  const v = Number(x.toFixed(digits));
  if (v === 0) return (0).toFixed(digits);
  return (v > 0 ? "+" : "−") + Math.abs(v).toFixed(digits);
}
