// Shared pieces for the Acoustic Spaces figures: a floor-plan view that maps
// metres to pixels, draggable handles, a convolver that crossfades when the
// room changes, and drawing for heads, sources and walls.

import { Tone } from "../../../lib/audio";
import { type IR } from "./ir";
import { material, type Room } from "./room";
import { rawCtx, spaceOut } from "./sound";
import { font, rgba } from "../accomp/draw";

export { C, font, rgba, roundRect, ui } from "../accomp/draw";
export { playGate, segmented, smallButton, stage } from "../accomp/ui";

export const SC = {
  bg: "#07080d",
  floor: "#0d0f17",
  grid: "rgba(140,150,190,0.07)",
  text: "#e7ebf6",
  muted: "rgba(160,170,200,0.72)",
  src: [255, 184, 107] as const, // sound source: amber
  lis: [122, 162, 255] as const, // listener: blue
  ray: [255, 214, 150] as const,
  bands: ["#a08cff", "#7aa2ff", "#5ad1e6", "#7de0b0", "#ffd36b", "#ff8f6b"],
};

export interface P2 {
  x: number;
  y: number;
}

// Maps a room's floor plan (x along the length, y along the width, metres)
// into a box on the canvas, keeping the aspect ratio. y grows downward on
// screen, so the plan reads like a map.
export class Plan {
  ox = 0;
  oy = 0;
  s = 1; // pixels per metre
  constructor(
    public L: number,
    public W: number,
  ) {}

  fit(x: number, y: number, w: number, h: number, viewL = this.L, viewW = this.W): void {
    this.s = Math.min(w / viewL, h / viewW);
    this.ox = x + (w - viewL * this.s) / 2 + ((viewL - this.L) / 2) * this.s;
    this.oy = y + (h - viewW * this.s) / 2 + ((viewW - this.W) / 2) * this.s;
  }

  px(p: P2): P2 {
    return { x: this.ox + p.x * this.s, y: this.oy + p.y * this.s };
  }

  m(px: number, py: number): P2 {
    return { x: (px - this.ox) / this.s, y: (py - this.oy) / this.s };
  }

  clampIn(p: P2, margin = 0.25): P2 {
    return {
      x: Math.max(margin, Math.min(this.L - margin, p.x)),
      y: Math.max(margin, Math.min(this.W - margin, p.y)),
    };
  }
}

// Floor, 1 m grid, and the four walls coloured by material (x = 0, x = L,
// y = 0, y = W, as in Room.surf).
export function drawRoom(g: CanvasRenderingContext2D, plan: Plan, room: Room, d: number, wallGlow = 1): void {
  const a = plan.px({ x: 0, y: 0 });
  const w = plan.L * plan.s;
  const h = plan.W * plan.s;
  g.fillStyle = SC.floor;
  g.fillRect(a.x, a.y, w, h);
  g.strokeStyle = SC.grid;
  g.lineWidth = 1 * d;
  g.beginPath();
  for (let x = 1; x < plan.L; x++) {
    g.moveTo(a.x + x * plan.s, a.y);
    g.lineTo(a.x + x * plan.s, a.y + h);
  }
  for (let y = 1; y < plan.W; y++) {
    g.moveTo(a.x, a.y + y * plan.s);
    g.lineTo(a.x + w, a.y + y * plan.s);
  }
  g.stroke();
  const walls: [number, number, number, number][] = [
    [a.x, a.y, a.x, a.y + h],
    [a.x + w, a.y, a.x + w, a.y + h],
    [a.x, a.y, a.x + w, a.y],
    [a.x, a.y + h, a.x + w, a.y + h],
  ];
  g.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    const [x0, y0, x1, y1] = walls[i];
    const col = material(room.surf[i]).color;
    g.save();
    g.shadowColor = col;
    g.shadowBlur = 10 * d * wallGlow;
    g.strokeStyle = col;
    g.lineWidth = 4 * d;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.restore();
  }
}

// A listener seen from above: a head with a nose and two ears.
export function drawHead(g: CanvasRenderingContext2D, p: P2, yaw: number, r: number, d: number, glow = 0.6): void {
  // yaw: 0 faces +y in the plan (down the screen), positive turns toward +x
  const fx = Math.sin(yaw);
  const fy = Math.cos(yaw);
  g.save();
  g.shadowColor = rgba(SC.lis, 0.9);
  g.shadowBlur = 14 * d * glow;
  g.fillStyle = "#1a2236";
  g.strokeStyle = rgba(SC.lis, 0.95);
  g.lineWidth = 2 * d;
  g.beginPath();
  g.moveTo(p.x + fx * r * 1.45, p.y + fy * r * 1.45);
  g.lineTo(p.x + fy * r * 0.45 + fx * r * 0.8, p.y - fx * r * 0.45 + fy * r * 0.8);
  g.lineTo(p.x - fy * r * 0.45 + fx * r * 0.8, p.y + fx * r * 0.45 + fy * r * 0.8);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(p.x, p.y, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
  // ears: left is to the listener's left
  const rx = Math.cos(yaw);
  const ry = -Math.sin(yaw);
  for (const side of [-1, 1]) {
    g.fillStyle = side < 0 ? "#9fd0ff" : "#ffb3c8";
    g.beginPath();
    g.ellipse(p.x + rx * side * r, p.y + ry * side * r, r * 0.22, r * 0.36, -yaw, 0, Math.PI * 2);
    g.fill();
  }
}

export function drawSource(g: CanvasRenderingContext2D, p: P2, r: number, d: number, pulse = 0, col: readonly number[] = SC.src): void {
  g.save();
  g.shadowColor = rgba(col, 0.9);
  g.shadowBlur = (12 + 18 * pulse) * d;
  g.fillStyle = rgba(col, 1);
  g.beginPath();
  g.arc(p.x, p.y, r * (1 + 0.25 * pulse), 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.strokeStyle = rgba(col, 0.35 + 0.4 * pulse);
  g.lineWidth = 1.5 * d;
  g.beginPath();
  g.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2);
  g.stroke();
}

export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color = SC.muted, align: CanvasTextAlign = "left", weight = 600, mono = false): void {
  g.font = font(px, weight, mono);
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillText(text, x, y);
}

// ---- dragging ---------------------------------------------------------------

export interface Handle {
  pos(): P2; // in canvas (device) pixels
  move(p: P2): void; // canvas pixels
  r?: number; // grab radius, CSS px
  end?(): void;
}

// Pointer dragging for a canvas. Positions are in canvas pixels (the same
// space the figures draw in); a tap that misses every handle goes to onTap.
export function dragger(
  canvas: HTMLCanvasElement,
  handles: () => Handle[],
  onTap?: (p: P2) => void,
  onStart?: () => void,
): void {
  let active: Handle | null = null;
  let id = -1;
  let moved = false;
  let down: P2 = { x: 0, y: 0 };
  let k = 1;
  const at = (e: PointerEvent): P2 => {
    const r = canvas.getBoundingClientRect();
    k = canvas.width / Math.max(1, r.width);
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    const p = at(e);
    down = p;
    moved = false;
    onStart?.();
    let best = Infinity;
    active = null;
    for (const h of handles()) {
      const q = h.pos();
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < (h.r ?? 22) * k && dd < best) {
        best = dd;
        active = h;
      }
    }
    id = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    if (active) canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = at(e);
    if (e.pointerId === id && active) {
      if (Math.hypot(p.x - down.x, p.y - down.y) > 3 * k) moved = true;
      active.move(p);
      return;
    }
    if (id < 0) {
      const over = handles().some((h) => {
        const q = h.pos();
        return Math.hypot(q.x - p.x, q.y - p.y) < (h.r ?? 22) * k;
      });
      canvas.style.cursor = over ? "grab" : onTap ? "pointer" : "default";
    }
  });
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    const p = at(e);
    if (active) active.end?.();
    else if (!moved && onTap) onTap(p);
    active = null;
    id = -1;
    canvas.style.cursor = "default";
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
}

// ---- audio --------------------------------------------------------------------

// Turn an impulse response into an AudioBuffer at a sensible level. Rooms
// with long tails carry far more energy than dead ones; this keeps some of
// that difference (a cathedral should sound bigger) without letting it blow
// up the mix.
export function irBuffer(ir: IR, fs: number, level = 1): AudioBuffer {
  let e = 0;
  for (const c of ir.ch) for (let i = 0; i < c.length; i += 2) e += c[i] * c[i] * 2;
  e /= ir.ch.length;
  const g = (level * 0.32) / Math.pow(Math.max(e, 0.02), 0.36);
  const b = rawCtx().createBuffer(ir.ch.length, ir.ch[0].length, fs);
  // fade the last 150 ms, in case maxLength cut the tail short
  const fade = Math.min(ir.ch[0].length, Math.floor(fs * 0.15));
  ir.ch.forEach((c, i) => {
    const o = new Float32Array(c.length);
    for (let k = 0; k < c.length; k++) o[k] = c[k] * g;
    for (let k = 0; k < fade; k++) o[c.length - 1 - k] *= k / fade;
    b.copyToChannel(o, i);
  });
  return b;
}

// A convolution reverb whose impulse response can change while sound is
// passing through it: the new response fades in on a second convolver while
// the old one fades out, so moving a source never clicks.
export class RoomVoice {
  readonly input: GainNode;
  readonly fader: GainNode;
  private convs: [ConvolverNode | null, ConvolverNode | null] = [null, null];
  private gains: [GainNode, GainNode];
  private cur = 0;
  private dry: GainNode;

  constructor(dest: Tone.Gain = spaceOut()) {
    const ctx = rawCtx();
    this.input = ctx.createGain();
    this.fader = ctx.createGain();
    this.fader.gain.value = 0;
    this.gains = [ctx.createGain(), ctx.createGain()];
    this.dry = ctx.createGain();
    this.dry.gain.value = 0;
    for (const gn of this.gains) {
      gn.gain.value = 0;
      gn.connect(this.fader);
    }
    this.input.connect(this.dry);
    this.dry.connect(this.fader);
    Tone.connect(this.fader, dest);
  }

  // Bypass the room entirely (level 0..1 of dry signal).
  setDry(level: number): void {
    this.dry.gain.setTargetAtTime(level, rawCtx().currentTime, 0.02);
  }

  setIR(buf: AudioBuffer | null, xfade = 0.06): void {
    const ctx = rawCtx();
    const t = ctx.currentTime;
    const old = this.cur;
    const next = 1 - old;
    this.gains[old].gain.cancelScheduledValues(t);
    this.gains[old].gain.setTargetAtTime(0, t, xfade / 3);
    const stale = this.convs[next];
    if (stale) {
      stale.disconnect();
      this.convs[next] = null;
    }
    if (buf) {
      const c = ctx.createConvolver();
      c.normalize = false;
      c.buffer = buf;
      this.input.connect(c);
      c.connect(this.gains[next]);
      this.convs[next] = c;
      this.gains[next].gain.cancelScheduledValues(t);
      this.gains[next].gain.setValueAtTime(0, t);
      this.gains[next].gain.setTargetAtTime(1, t, xfade / 3);
    }
    this.cur = next;
  }

  // Play a buffer into the room.
  fire(buf: AudioBuffer, gain = 1, when = 0): AudioBufferSourceNode {
    const ctx = rawCtx();
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g);
    g.connect(this.input);
    s.start(Math.max(ctx.currentTime + 0.005, when));
    s.onended = () => {
      s.disconnect();
      g.disconnect();
    };
    return s;
  }

  fadeTo(v: number, tau = 0.05): void {
    const t = rawCtx().currentTime;
    this.fader.gain.cancelScheduledValues(t);
    this.fader.gain.setTargetAtTime(v, t, tau);
  }

  dispose(): void {
    this.input.disconnect();
    this.fader.disconnect();
    for (const c of this.convs) c?.disconnect();
  }
}

// Mono samples → AudioBuffer.
export function monoBuffer(x: Float32Array, fs: number): AudioBuffer {
  const b = rawCtx().createBuffer(1, x.length, fs);
  b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
  return b;
}

// Phones get taller figures, so stacked panels have room.
export const narrowScreen = (): boolean => (window.innerWidth || 1024) < 560;

// Format seconds the way the figures label them.
export const secs = (t: number): string => (t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(2)} s`);
