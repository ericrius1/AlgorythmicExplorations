// Canvas 2D drawing for the sound figures: a Retina-aware stage on top of the
// shared demo Shell, additive "glow" strokes, the harmonic colour code, text
// labels, and the "tap to play" pill. Canvas 2D (not WebGPU) so every figure
// works in every browser, with crisp text labels.

import { Shell } from "../../../lib/demoShell";

export type RGB = readonly [number, number, number];

export const BG = "#06070b";
export const BLUE: RGB = [122, 162, 255];
export const ORANGE: RGB = [255, 184, 107];
export const WHITE: RGB = [242, 244, 250];
export const MUTED: RGB = [138, 145, 165];
export const RED: RGB = [255, 92, 84];
export const GOLD: RGB = [255, 214, 140];

export const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function hsl(h: number, s: number, l: number): RGB {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// The colour code used across these figures: hue is pitch class. Notes an
// octave apart share a colour, so harmonics 1, 2, 4, 8 are all gold, 3 and 6
// share a blue, and so on. `chroma` is the fractional part of log2(f).
export function chromaRgb(chroma: number, light = 0.66): RGB {
  const c = chroma - Math.floor(chroma);
  return hsl((38 + c * 360) % 360, 0.82, light);
}

export function harmonicRgb(n: number, light = 0.66): RGB {
  return chromaRgb(Math.log2(n), light);
}

// ---- stage ----------------------------------------------------------------------

export interface StageOpts {
  aspect: number; // height / width on wide screens
  narrowAspect?: number; // height / width under 560 px
  touch?: "none" | "pan-y";
}

export class Stage {
  readonly shell: Shell;
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly wrap: HTMLDivElement;
  w = 0; // CSS pixels
  h = 0;
  pr = 1; // device pixels per CSS pixel
  readonly pointer = { x: -1, y: -1, down: false, inside: false };

  constructor(container: HTMLElement, opts: StageOpts) {
    const cw = container.clientWidth || 720;
    const narrow = cw < 560;
    this.shell = new Shell(container, narrow ? (opts.narrowAspect ?? opts.aspect) : opts.aspect);
    this.canvas = this.shell.canvas;
    this.canvas.style.touchAction = opts.touch ?? "pan-y";
    this.wrap = document.createElement("div");
    this.wrap.className = "ms-stage";
    this.canvas.replaceWith(this.wrap);
    this.wrap.appendChild(this.canvas);
    this.g = this.canvas.getContext("2d")!;
    // heroes get their aspect from the Shell; on phones give them more height
    if (narrow && opts.narrowAspect) {
      this.canvas.height = Math.round(this.canvas.width * opts.narrowAspect);
    }
    this.measure();

    const at = (e: PointerEvent): void => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer.x = ((e.clientX - r.left) / r.width) * this.w;
      this.pointer.y = ((e.clientY - r.top) / r.height) * this.h;
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      at(e);
      this.pointer.down = true;
      this.pointer.inside = true;
    });
    this.canvas.addEventListener("pointermove", (e) => {
      at(e);
      this.pointer.inside = true;
    });
    const up = (): void => {
      this.pointer.down = false;
    };
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
    this.canvas.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
    });
  }

  get narrow(): boolean {
    return this.w < 560;
  }

  // Height of the fixed site nav (CSS px). Heroes sit at the top of the
  // page, under it, so they keep their content below this line.
  navCover(): number {
    const nav = document.querySelector(".site-nav");
    return nav ? nav.getBoundingClientRect().height : 0;
  }

  // Event position in CSS pixels of the canvas.
  local(e: PointerEvent | MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.w, ((e.clientY - r.top) / r.height) * this.h];
  }

  private measure(): void {
    const cssW = this.canvas.clientWidth || this.canvas.width / Math.min(window.devicePixelRatio || 1, 2);
    this.pr = this.canvas.width / cssW;
    this.w = this.canvas.width / this.pr;
    this.h = this.canvas.height / this.pr;
  }

  // Start a frame: CSS-pixel transform, background, no compositing left over.
  begin(bg = BG): CanvasRenderingContext2D {
    this.measure();
    const g = this.g;
    g.setTransform(this.pr, 0, 0, this.pr, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = bg;
    g.fillRect(0, 0, this.w, this.h);
    return g;
  }
}

// ---- strokes and glows ------------------------------------------------------------

// A glowing line: a wide faint halo, a mid glow and a hot core, added on top
// of whatever is there ("lighter"), so crossings brighten like light does.
export function glowStroke(g: CanvasRenderingContext2D, path: Path2D, c: RGB, width = 1.5, k = 1): void {
  if (k <= 0.003) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = rgba(c, 0.045 * k);
  g.lineWidth = width * 9;
  g.stroke(path);
  g.strokeStyle = rgba(c, 0.11 * k);
  g.lineWidth = width * 4;
  g.stroke(path);
  g.strokeStyle = rgba(c, 0.6 * k);
  g.lineWidth = width * 1.6;
  g.stroke(path);
  g.strokeStyle = rgba(mix(c, WHITE, 0.6), 0.85 * k);
  g.lineWidth = Math.max(0.6, width * 0.6);
  g.stroke(path);
  g.restore();
}

// A cheaper two-pass glow for many short strokes.
export function softStroke(g: CanvasRenderingContext2D, path: Path2D, c: RGB, width = 1.2, k = 1): void {
  if (k <= 0.003) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = rgba(c, 0.13 * k);
  g.lineWidth = width * 4;
  g.stroke(path);
  g.strokeStyle = rgba(mix(c, WHITE, 0.25), 0.8 * k);
  g.lineWidth = width;
  g.stroke(path);
  g.restore();
}

export function glowDot(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, k = 1): void {
  if (k <= 0.003) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  const grad = g.createRadialGradient(x, y, 0, x, y, r * 4);
  grad.addColorStop(0, rgba(mix(c, WHITE, 0.7), 0.95 * k));
  grad.addColorStop(0.18, rgba(c, 0.55 * k));
  grad.addColorStop(0.45, rgba(c, 0.12 * k));
  grad.addColorStop(1, rgba(c, 0));
  g.fillStyle = grad;
  g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  g.restore();
}

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  base?: CanvasTextBaseline;
  weight?: number;
  mono?: boolean;
}

export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}): number {
  g.font = `${o.weight ?? 500} ${o.size ?? 11}px ${o.mono ? MONO : SANS}`;
  g.fillStyle = o.color ?? "rgba(170, 178, 200, 0.85)";
  g.textAlign = o.align ?? "left";
  g.textBaseline = o.base ?? "alphabetic";
  g.fillText(s, x, y);
  return g.measureText(s).width;
}

export function hline(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, color: string, w = 1, dash?: number[]): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = w;
  if (dash) g.setLineDash(dash);
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x1, y);
  g.stroke();
  g.restore();
}

export function vline(g: CanvasRenderingContext2D, x: number, y0: number, y1: number, color: string, w = 1, dash?: number[]): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = w;
  if (dash) g.setLineDash(dash);
  g.beginPath();
  g.moveTo(x, y0);
  g.lineTo(x, y1);
  g.stroke();
  g.restore();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

// ---- tap to play ---------------------------------------------------------------------

// A centred pill over the canvas that says how to start the sound. Hidden
// while sound is playing; comes back when it stops (e.g. scrolled away).
export class PlayPill {
  readonly el: HTMLButtonElement;
  constructor(stage: Stage, label: string, onTap: () => void, where: "center" | "top" | "bottom" | [number, number] = "center") {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = `ms-pill ms-pill-${typeof where === "string" ? where : "at"}`;
    if (typeof where !== "string") {
      // centre of the pill at a fraction of the canvas
      this.el.style.left = `${where[0] * 100}%`;
      this.el.style.top = `${where[1] * 100}%`;
    }
    const icon = document.createElement("span");
    icon.className = "ms-pill-icon";
    icon.setAttribute("aria-hidden", "true");
    const txt = document.createElement("span");
    txt.className = "ms-pill-text";
    txt.textContent = label;
    this.el.append(icon, txt);
    this.el.addEventListener("click", (e) => {
      e.stopPropagation();
      onTap();
    });
    stage.wrap.appendChild(this.el);
  }

  show(on: boolean): void {
    this.el.classList.toggle("is-hidden", !on);
  }

  setText(s: string): void {
    const t = this.el.querySelector(".ms-pill-text");
    if (t) t.textContent = s;
  }
}

// A play/stop button for the control strip that keeps its label in sync.
export function playButton(stage: Stage, labels: [string, string], onClick: () => void): (playing: boolean) => void {
  const b = stage.shell.button(labels[0], onClick);
  b.classList.add("ms-play");
  return (playing: boolean) => {
    b.textContent = playing ? labels[1] : labels[0];
    b.classList.toggle("is-on", playing);
  };
}

// A row of mutually exclusive buttons. Returns a setter for the active one.
export function choice<T extends string>(
  stage: Stage,
  options: { id: T; label: string }[],
  initial: T,
  onPick: (id: T) => void,
): (id: T) => void {
  const row = document.createElement("div");
  row.className = "ms-choice";
  const btns = new Map<T, HTMLButtonElement>();
  for (const o of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "demo-button";
    b.textContent = o.label;
    b.addEventListener("click", () => {
      set(o.id);
      onPick(o.id);
    });
    row.appendChild(b);
    btns.set(o.id, b);
  }
  stage.shell.controls.appendChild(row);
  const set = (id: T): void => {
    for (const [k, b] of btns) b.classList.toggle("is-on", k === id);
  };
  set(initial);
  return set;
}
