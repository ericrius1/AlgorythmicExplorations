// A playable piano keyboard drawn on a high-DPI canvas: multitouch,
// glissando, velocity from where you strike the key (front = loud), held
// notes vs notes sounding from elsewhere, labels and scale highlighting.
//
//   const kb = new PianoKeyboard(el, { low: 48, high: 72, onNoteOn, onNoteOff });
//   const p = mountPlayable(container, { instrument: "epiano" });

import "../../styles/music.css";
import { createInstrument, type Instrument, type PresetName } from "./instruments";
import { NoteInput, midiButton } from "./input";
import { noteName, pc } from "./theory";

const BLACK = new Set([1, 3, 6, 8, 10]);
// black-key centre offsets from the boundary between the white keys either
// side, in white-key widths (real keyboards don't centre them)
const BLACK_SHIFT: Record<number, number> = { 1: -0.08, 3: 0.08, 6: -0.1, 8: 0, 10: 0.1 };

export type KeyLabels = "none" | "c" | "white" | "all" | Map<number, string>;

export interface PianoKeyboardOptions {
  /** Lowest / highest MIDI note (inclusive); widened to white keys. */
  low: number;
  high: number;
  /** CSS px. Default: 16 % of the width, clamped to 72..120. */
  height?: number;
  labels?: KeyLabels;
  scale?: { root: number; intervals: readonly number[] } | null;
  onNoteOn?(midi: number, velocity: number): void;
  onNoteOff?(midi: number): void;
}

interface KeyRect {
  midi: number;
  black: boolean;
  x: number;
  w: number;
  h: number;
}

export class PianoKeyboard {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: PianoKeyboardOptions;
  private low = 0;
  private high = 0;
  private keys: KeyRect[] = [];
  private whites: KeyRect[] = [];
  private blacks: KeyRect[] = [];
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private held = new Set<number>();
  private sounding = new Set<number>();
  private fades = new Map<number, number>(); // midi → release time (ms), for a short afterglow
  private pointers = new Map<number, { midi: number; vel: number }>();
  private labels: KeyLabels;
  private scale: { root: number; intervals: readonly number[] } | null;
  private raf = 0;
  private ro: ResizeObserver | null = null;

  constructor(parent: HTMLElement, opts: PianoKeyboardOptions) {
    this.opts = opts;
    this.labels = opts.labels ?? "c";
    this.scale = opts.scale ?? null;
    this.el = document.createElement("div");
    this.el.className = "pkb";
    this.el.setAttribute("role", "group");
    this.el.setAttribute("aria-label", "Piano keyboard");
    this.canvas = document.createElement("canvas");
    this.el.appendChild(this.canvas);
    parent.appendChild(this.el);
    this.ctx = this.canvas.getContext("2d")!;
    this.setRange(opts.low, opts.high);
    this.wire();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(this.el);
    }
    this.layout();
  }

  /** Show a key as held (e.g. from QWERTY or MIDI). */
  press(midi: number, on: boolean): void {
    if (on === this.held.has(midi)) return;
    if (on) this.held.add(midi);
    else {
      this.held.delete(midi);
      this.fades.set(midi, performance.now());
    }
    this.request();
  }

  /** Notes sounding from elsewhere (a sequencer, a chord demo). Drawn in the cool accent. */
  setSounding(midis: Iterable<number>): void {
    const next = new Set<number>();
    for (const m of midis) next.add(Math.round(m));
    let same = next.size === this.sounding.size;
    if (same) for (const m of next) if (!this.sounding.has(m)) same = false;
    if (same) return;
    for (const m of this.sounding) if (!next.has(m)) this.fades.set(m, performance.now());
    this.sounding = next;
    this.request();
  }

  setScale(root: number | null, intervals?: readonly number[]): void {
    this.scale = root === null || !intervals ? null : { root, intervals };
    this.request();
  }

  setLabels(labels: KeyLabels): void {
    this.labels = labels;
    this.request();
  }

  setRange(low: number, high: number): void {
    this.low = BLACK.has(pc(low)) ? low - 1 : low;
    this.high = BLACK.has(pc(high)) ? high + 1 : high;
    this.layout();
  }

  /** Release every key held by the pointer (and fire onNoteOff for them). */
  releaseAll(): void {
    for (const { midi } of this.pointers.values()) this.opts.onNoteOff?.(midi);
    this.pointers.clear();
    for (const m of this.held) this.fades.set(m, performance.now());
    this.held.clear();
    this.request();
  }

  dispose(): void {
    this.releaseAll();
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }

  // ---- layout + drawing

  private layout(): void {
    const w = this.el.clientWidth || this.el.parentElement?.clientWidth || 600;
    const h = this.opts.height ?? Math.round(Math.min(120, Math.max(72, w * 0.16)));
    this.el.style.height = `${h}px`;
    this.cssW = w;
    this.cssH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    const whiteMidis: number[] = [];
    for (let m = this.low; m <= this.high; m++) if (!BLACK.has(pc(m))) whiteMidis.push(m);
    const ww = w / Math.max(1, whiteMidis.length);
    this.whites = whiteMidis.map((m, i) => ({ midi: m, black: false, x: i * ww, w: ww, h }));
    this.blacks = [];
    whiteMidis.forEach((m, i) => {
      const b = m + 1;
      if (b > this.high || !BLACK.has(pc(b))) return;
      const bw = ww * 0.58;
      const cx = (i + 1) * ww + BLACK_SHIFT[pc(b)] * ww;
      this.blacks.push({ midi: b, black: true, x: cx - bw / 2, w: bw, h: h * 0.62 });
    });
    this.keys = [...this.whites, ...this.blacks];
    this.draw();
  }

  private request(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private labelFor(k: KeyRect): string {
    const l = this.labels;
    if (l instanceof Map) return l.get(k.midi) ?? "";
    if (l === "none") return "";
    if (l === "c") return pc(k.midi) === 0 ? noteName(k.midi) : "";
    if (l === "white") return k.black ? "" : pc(k.midi) === 0 ? noteName(k.midi) : noteName(k.midi, { octave: false });
    return pc(k.midi) === 0 ? noteName(k.midi) : noteName(k.midi, { octave: false });
  }

  private draw(): void {
    const c = this.ctx;
    const d = this.dpr;
    const now = performance.now();
    let fading = false;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, this.cssW, this.cssH);
    const root = this.scale ? pc(this.scale.root) : -1;
    const inScale = (m: number): boolean =>
      !!this.scale && this.scale.intervals.some((i) => (root + i) % 12 === pc(m));
    const glow = (m: number): number => {
      const t0 = this.fades.get(m);
      if (t0 === undefined) return 0;
      const f = 1 - (now - t0) / 260;
      if (f <= 0) {
        this.fades.delete(m);
        return 0;
      }
      fading = true;
      return f;
    };
    const r = 4;

    // white keys
    for (const k of this.whites) {
      const held = this.held.has(k.midi);
      const snd = this.sounding.has(k.midi);
      const after = held || snd ? 0 : glow(k.midi);
      const x = k.x + 0.5;
      const w = k.w - 1;
      const g = c.createLinearGradient(0, 0, 0, k.h);
      if (held) {
        g.addColorStop(0, "#ffd9ad");
        g.addColorStop(1, "#ffb86b");
      } else if (snd) {
        g.addColorStop(0, "#c9d8ff");
        g.addColorStop(1, "#8fb0ff");
      } else {
        const dim = this.scale && !inScale(k.midi) ? 0.9 : 1;
        g.addColorStop(0, shade("#f2f4f9", dim));
        g.addColorStop(0.85, shade("#dfe2eb", dim));
        g.addColorStop(1, shade("#c9cdd9", dim));
      }
      c.fillStyle = g;
      roundBottom(c, x, 0, w, k.h - (held ? 0 : 2), r);
      c.fill();
      if (after > 0) {
        c.fillStyle = `rgba(255, 184, 107, ${0.45 * after})`;
        roundBottom(c, x, 0, w, k.h - 2, r);
        c.fill();
      }
      // front lip shadow (keys at rest sit 2px higher)
      if (!held) {
        c.fillStyle = "rgba(10, 11, 16, 0.35)";
        c.fillRect(x + 1, k.h - 2, w - 2, 2);
      }
    }
    // felt strip
    const felt = c.createLinearGradient(0, 0, 0, 6);
    felt.addColorStop(0, "rgba(10, 11, 16, 0.75)");
    felt.addColorStop(1, "rgba(10, 11, 16, 0)");
    c.fillStyle = felt;
    c.fillRect(0, 0, this.cssW, 6);

    // black keys
    for (const k of this.blacks) {
      const held = this.held.has(k.midi);
      const snd = this.sounding.has(k.midi);
      const after = held || snd ? 0 : glow(k.midi);
      c.fillStyle = "rgba(0, 0, 0, 0.35)";
      roundBottom(c, k.x + 1.5, 0, k.w, k.h + 2, r - 1);
      c.fill();
      const g = c.createLinearGradient(0, 0, 0, k.h);
      if (held) {
        g.addColorStop(0, "#c9813d");
        g.addColorStop(1, "#ffb86b");
      } else if (snd) {
        g.addColorStop(0, "#4a64b8");
        g.addColorStop(1, "#7aa2ff");
      } else {
        g.addColorStop(0, "#1b1e2a");
        g.addColorStop(0.82, "#2c3142");
        g.addColorStop(0.83, "#3a4056");
        g.addColorStop(1, "#262a39");
      }
      c.fillStyle = g;
      roundBottom(c, k.x, 0, k.w, k.h - (held ? 0 : 1), r - 1);
      c.fill();
      if (after > 0) {
        c.fillStyle = `rgba(255, 184, 107, ${0.5 * after})`;
        roundBottom(c, k.x, 0, k.w, k.h - 1, r - 1);
        c.fill();
      }
    }

    // scale dots
    if (this.scale) {
      for (const k of this.keys) {
        if (!inScale(k.midi)) continue;
        const isRoot = pc(k.midi) === root;
        const cx = k.x + k.w / 2;
        const cy = k.black ? k.h - Math.min(10, k.w * 0.45) : k.h - Math.min(30, this.cssH * 0.3);
        const rad = Math.max(2.5, Math.min(4.5, k.w * 0.16));
        c.beginPath();
        c.arc(cx, cy, rad, 0, Math.PI * 2);
        if (isRoot) {
          c.fillStyle = "#ffb86b";
          c.fill();
        } else {
          c.fillStyle = k.black ? "rgba(170, 195, 255, 0.85)" : "rgba(76, 112, 214, 0.75)";
          c.fill();
        }
      }
    }

    // labels
    const fs = Math.max(8, Math.min(11, this.whites[0]?.w * 0.38 || 10));
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    for (const k of this.keys) {
      const text = this.labelFor(k);
      if (!text) continue;
      const held = this.held.has(k.midi) || this.sounding.has(k.midi);
      c.font = `600 ${k.black ? fs - 1 : fs}px ui-sans-serif, system-ui, sans-serif`;
      const maxW = k.w - 2;
      if (c.measureText(text).width > maxW && text.length > 2) continue;
      c.fillStyle = k.black ? (held ? "#11131c" : "rgba(200, 208, 230, 0.8)") : held ? "#11131c" : "#5d647c";
      c.fillText(text, k.x + k.w / 2, k.h - (k.black ? 5 : 7));
    }

    if (fading) this.request();
  }

  // ---- pointer input

  private hit(x: number, y: number): { midi: number; vel: number } | null {
    for (const k of this.blacks) {
      if (x >= k.x && x <= k.x + k.w && y <= k.h) return { midi: k.midi, vel: velFrom(y / k.h) };
    }
    for (const k of this.whites) {
      if (x >= k.x && x < k.x + k.w) return { midi: k.midi, vel: velFrom(y / k.h) };
    }
    return null;
  }

  private wire(): void {
    const cv = this.canvas;
    const pos = (e: PointerEvent): [number, number] => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const on = (id: number, k: { midi: number; vel: number }): void => {
      this.pointers.set(id, k);
      this.press(k.midi, true);
      this.opts.onNoteOn?.(k.midi, k.vel);
    };
    const off = (id: number): void => {
      const k = this.pointers.get(id);
      if (!k) return;
      this.pointers.delete(id);
      // another pointer may still hold the same key
      if (![...this.pointers.values()].some((p) => p.midi === k.midi)) {
        this.press(k.midi, false);
        this.opts.onNoteOff?.(k.midi);
      }
    };
    cv.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const k = this.hit(...pos(e));
      if (k) on(e.pointerId, k);
    });
    cv.addEventListener("pointermove", (e) => {
      const cur = this.pointers.get(e.pointerId);
      if (!cur) return;
      const [x, y] = pos(e);
      const k = y < 0 || y > this.cssH ? null : this.hit(x, y);
      if (k && k.midi !== cur.midi) {
        off(e.pointerId);
        on(e.pointerId, { midi: k.midi, vel: cur.vel });
      }
    });
    const end = (e: PointerEvent): void => off(e.pointerId);
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("lostpointercapture", end);
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

function velFrom(depth: number): number {
  return Math.min(1, Math.max(0.3, 0.3 + 0.75 * depth));
}

function shade(hex: string, k: number): string {
  if (k === 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

function roundBottom(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + w, y);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.closePath();
}

// ---- one-liner: instrument + keyboard + QWERTY/MIDI ------------------------------------

export interface PlayableOptions {
  instrument?: PresetName | Instrument;
  low?: number;
  high?: number;
  height?: number;
  /** "qwerty" shows the computer-keyboard keycaps (and follows Z/X octave changes). */
  labels?: KeyLabels | "qwerty";
  scale?: { root: number; intervals: readonly number[] } | null;
  /** Octave of the A key (default: the octave of `low` + 1, so the keycaps land mid-keyboard). */
  octave?: number;
  qwerty?: boolean;
  midi?: boolean;
  /** Show the hint line + MIDI button under the keyboard (default true). */
  hint?: boolean;
  onNoteOn?(midi: number, velocity: number): void;
  onNoteOff?(midi: number): void;
}

export interface Playable {
  readonly el: HTMLDivElement;
  readonly instrument: Instrument;
  readonly keyboard: PianoKeyboard;
  readonly input: NoteInput;
  dispose(): void;
}

/** A playable keyboard wired to an instrument, the computer keyboard and MIDI. */
export function mountPlayable(container: HTMLElement, opts: PlayableOptions = {}): Playable {
  const low = opts.low ?? 48;
  const high = opts.high ?? 76;
  const inst = typeof opts.instrument === "object" ? opts.instrument : createInstrument(opts.instrument ?? "epiano");
  const el = document.createElement("div");
  el.className = "playable";
  container.appendChild(el);

  let input: NoteInput;
  const keyboard = new PianoKeyboard(el, {
    low,
    high,
    height: opts.height,
    labels: opts.labels === "qwerty" ? "none" : opts.labels,
    scale: opts.scale,
    onNoteOn: (m, v) => input.emitOn(m, v, "pointer"),
    onNoteOff: (m) => input.emitOff(m, "pointer"),
  });

  input = new NoteInput(
    container,
    {
      onNoteOn: (m, v, src) => {
        inst.noteOn(m, v);
        if (src !== "pointer") keyboard.press(m, true);
        opts.onNoteOn?.(m, v);
      },
      onNoteOff: (m, src) => {
        inst.noteOff(m);
        if (src !== "pointer") keyboard.press(m, false);
        opts.onNoteOff?.(m);
      },
    },
    { qwerty: opts.qwerty, midi: opts.midi, octave: opts.octave ?? Math.floor(low / 12) },
  );

  let hint: HTMLDivElement | null = null;
  let hintText: HTMLSpanElement | null = null;
  const syncHint = (): void => {
    if (!hintText) return;
    const o = input.octave;
    hintText.innerHTML = `Play with <kbd>A</kbd>–<kbd>'</kbd> (black keys on <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd> <kbd>Y</kbd> <kbd>U</kbd>) · <kbd>Z</kbd>/<kbd>X</kbd> octave: A = C${o}`;
  };
  if (opts.labels === "qwerty") keyboard.setLabels(input.qwertyLabels());
  input.onOctaveChange = () => {
    if (opts.labels === "qwerty") keyboard.setLabels(input.qwertyLabels());
    syncHint();
  };
  if (opts.hint ?? true) {
    hint = document.createElement("div");
    hint.className = "kbd-hint";
    hintText = document.createElement("span");
    hintText.className = "kbd-hint-keys";
    hint.appendChild(hintText);
    if (opts.midi ?? true) hint.appendChild(midiButton());
    el.appendChild(hint);
    syncHint();
  }

  // mirror notes the instrument plays from elsewhere (play(), sequencers)
  let raf = 0;
  let visible = true;
  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((es) => {
          visible = es.some((e) => e.isIntersecting);
          if (visible && !raf) raf = requestAnimationFrame(tick);
        })
      : null;
  io?.observe(el);
  const tick = (): void => {
    raf = 0;
    keyboard.setSounding(inst.sounding);
    if (visible) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    el,
    instrument: inst,
    keyboard,
    input,
    dispose() {
      cancelAnimationFrame(raf);
      io?.disconnect();
      input.dispose();
      keyboard.dispose();
      inst.releaseAll();
      el.remove();
    },
  };
}
