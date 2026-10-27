// Canvas 2D helpers for the chords and jukebox figures: Retina-aware sizes,
// additive glow sprites, text, and the colour language the two articles
// share (major = warm, minor = cool, tension = red).

import { pixelRatio } from "../../../lib/palette";

export const COL = {
  bg: "#06070b",
  text: "#d7dbe6",
  bright: "#f2f4fa",
  muted: "#8a91a5",
  dim: "#4b5168",
  grid: "rgba(122, 162, 255, 0.09)",
  major: "#ffb86b",
  minor: "#7aa2ff",
  aug: "#e7a6ff",
  dim7: "#ff7a8a",
  tension: "#ff6b5a",
  calm: "#6be0b0",
  white: "#fff6e8",
} as const;

// per-voice / per-track colours that stay readable on the dark ground
export const VOICE = ["#ffb86b", "#7aa2ff", "#6be0b0", "#e7a6ff", "#ff8a7a", "#ffe08a"];

export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface View2D {
  ctx: CanvasRenderingContext2D;
  w: number; // device pixels
  h: number;
  px: number; // device pixels per CSS pixel
}

export function view2d(canvas: HTMLCanvasElement): View2D {
  const ctx = canvas.getContext("2d")!;
  return { ctx, w: canvas.width, h: canvas.height, px: pixelRatio(canvas) || 1 };
}

// call at the top of every frame: pixelRatio can change when the page reflows
export function refresh(v: View2D, canvas: HTMLCanvasElement): void {
  v.w = canvas.width;
  v.h = canvas.height;
  v.px = pixelRatio(canvas) || v.px;
}

export function clear(v: View2D, top = "#0a0c14", bottom = "#05060a"): void {
  const g = v.ctx.createLinearGradient(0, 0, 0, v.h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  v.ctx.globalCompositeOperation = "source-over";
  v.ctx.globalAlpha = 1;
  v.ctx.fillStyle = g;
  v.ctx.fillRect(0, 0, v.w, v.h);
}

const sprites = new Map<string, HTMLCanvasElement>();

// A soft round glow, white core fading through the colour to nothing.
function sprite(color: string): HTMLCanvasElement {
  let s = sprites.get(color);
  if (s) return s;
  s = document.createElement("canvas");
  s.width = s.height = 128;
  const c = s.getContext("2d")!;
  const [r, g, b] = hexRgb(color);
  const grad = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(${Math.min(255, r + 90)}, ${Math.min(255, g + 90)}, ${Math.min(255, b + 90)}, 1)`);
  grad.addColorStop(0.12, `rgba(${r}, ${g}, ${b}, 0.85)`);
  grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, 0.28)`);
  grad.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, 0.07)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  c.fillStyle = grad;
  c.fillRect(0, 0, 128, 128);
  sprites.set(color, s);
  return s;
}

// additive glow of radius r (device px)
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1): void {
  if (alpha <= 0.003 || r <= 0) return;
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

// A bright line with a soft halo: three passes, additive.
export function glowPath(
  ctx: CanvasRenderingContext2D,
  build: (c: CanvasRenderingContext2D) => void,
  color: string,
  width: number,
  alpha = 1,
): void {
  if (alpha <= 0.003) return;
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const passes: [number, number][] = [
    [width * 5, 0.07],
    [width * 2.2, 0.2],
    [width, 0.95],
  ];
  for (const [w, a] of passes) {
    ctx.beginPath();
    build(ctx);
    ctx.strokeStyle = color;
    ctx.globalAlpha = Math.min(1, a * alpha);
    ctx.lineWidth = w;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

export function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function font(px: number, size: number, weight = 600, mono = false): string {
  const fam = mono ? 'ui-monospace, "SF Mono", Menlo, monospace' : 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  return `${weight} ${Math.round(size * px)}px ${fam}`;
}

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  opts: { color?: string; font?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; alpha?: number } = {},
): void {
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.fillStyle = opts.color ?? COL.text;
  if (opts.font) ctx.font = opts.font;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = opts.base ?? "middle";
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
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

// A rounded label chip, e.g. a chord symbol.
export function chip(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  px: number,
  color: string,
  opts: { size?: number; fill?: number; align?: "center" | "left" | "right" } = {},
): number {
  const size = opts.size ?? 12;
  ctx.font = font(px, size, 650);
  const tw = ctx.measureText(s).width;
  const padX = size * 0.6 * px;
  const h = size * 1.7 * px;
  const w = tw + padX * 2;
  const x0 = opts.align === "left" ? x : opts.align === "right" ? x - w : x - w / 2;
  roundRect(ctx, x0, y - h / 2, w, h, h / 2);
  ctx.fillStyle = rgba(color, opts.fill ?? 0.14);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = px;
  ctx.stroke();
  text(ctx, s, x0 + w / 2, y + 0.5 * px, { color, align: "center" });
  return w;
}

// Easing
export const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

// Aspect for a figure: taller on phones so labels stay legible.
export function figureAspect(container: HTMLElement, wide: number, narrow: number): number {
  const w = container.clientWidth || 720;
  return w < 520 ? narrow : wide;
}

// ---- the "tap to play" affordance -----------------------------------------------------

export interface TapOverlay {
  el: HTMLButtonElement;
  show(label?: string): void;
  hide(): void;
}

// A centred pill over the canvas. Audio can only start from a gesture, so
// every playable figure shows one until the reader starts it.
// `at` is the button's height on the canvas as a fraction from the top.
export function tapToPlay(container: HTMLElement, label: string, onTap: () => void, at = 0.5): TapOverlay {
  container.style.position = "relative";
  const el = document.createElement("button");
  el.type = "button";
  el.className = "mh-tap";
  el.innerHTML = `<span class="mh-tap-icon" aria-hidden="true">▶</span><span class="mh-tap-label"></span>`;
  const lab = el.querySelector<HTMLSpanElement>(".mh-tap-label")!;
  lab.textContent = label;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onTap();
  });
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  // sit over the canvas, not over the controls under it
  const canvas = container.querySelector("canvas");
  if (canvas) {
    const place = (): void => {
      const cr = canvas.getBoundingClientRect();
      const kr = container.getBoundingClientRect();
      if (cr.height > 0) el.style.top = `${cr.top - kr.top + cr.height * at}px`;
    };
    place();
    new ResizeObserver(place).observe(canvas);
    requestAnimationFrame(place);
  }
  container.appendChild(el);
  return {
    el,
    show(l) {
      if (l) lab.textContent = l;
      el.classList.remove("is-hidden");
    },
    hide() {
      el.classList.add("is-hidden");
    },
  };
}

// Toggle-style state on a control-strip button.
export function setActive(b: HTMLButtonElement, on: boolean): void {
  b.classList.toggle("mh-on", on);
  b.setAttribute("aria-pressed", on ? "true" : "false");
}
