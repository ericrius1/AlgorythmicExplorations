// Scaffolding shared by every figure in "The Synthesizer": a Shell, a Glow
// renderer, one synth engine, an on-screen keyboard, the computer-keyboard /
// MIDI routing, a "tap to play" affordance, and silence when the figure
// scrolls away.

import { Shell, type Demo } from "../../../lib/demoShell";
import { getDevice } from "../../../lib/gpu";
import { frameGuard } from "../../../lib/audio";
import { Glow, type GlowOpts } from "./glow";
import { SynthHost, type DeepPartial, type Patch, type HostOpts } from "./engine";
import { KeyStrip, router, type NoteTarget, type StripOpts } from "./keys";

export interface FigureOpts {
  aspect: number;
  patch: DeepPartial<Patch>;
  host?: HostOpts;
  glow?: GlowOpts;
  /** midi note of the A key; false = no keyboard strip */
  base?: number | false;
  minBase?: number;
  maxBase?: number;
  strip?: StripOpts | false;
  /** what the "tap to play" button plays */
  demo?: (f: Figure) => void;
  playLabel?: string;
  /** drag on the canvas shouldn't scroll the page */
  grabby?: boolean;
  onNote?: (note: number, on: boolean) => void;
}

export interface Figure {
  container: HTMLElement;
  shell: Shell;
  glow: Glow;
  host: SynthHost;
  target: NoteTarget;
  strip: KeyStrip | null;
  /** notes currently held from any input */
  held: Set<number>;
  /** play a note for `dur` seconds */
  tap(note: number, dur?: number, vel?: number): void;
  hidePlay(): void;
}

export async function makeFigure(container: HTMLElement, opts: FigureOpts): Promise<Figure> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.aspect);
  const glow = new Glow(shell.canvas, dev, opts.glow);
  const host = new SynthHost(opts.patch, opts.host);
  container.classList.add("synth-fig");
  if (opts.grabby) glow.stage.classList.add("is-grabby");
  const held = new Set<number>();

  const target: NoteTarget = {
    el: container,
    base: opts.base === false ? 60 : (opts.base ?? 60),
    minBase: opts.minBase,
    maxBase: opts.maxBase,
    on(note, vel) {
      held.add(note);
      host.noteOn(note, note, vel);
      hidePlay();
      opts.onNote?.(note, true);
    },
    off(note) {
      held.delete(note);
      host.noteOff(note);
      opts.onNote?.(note, false);
    },
    bend: (s) => host.bend(s),
    mod: (v) => host.mod(v),
  };
  router.add(target);

  let strip: KeyStrip | null = null;
  if (opts.base !== false && opts.strip !== false) {
    strip = new KeyStrip(target, opts.strip);
    shell.controls.before(strip.el);
  }

  // tap to play
  const play = document.createElement("button");
  play.className = "synth-play";
  play.innerHTML = `<span class="synth-play-icon" aria-hidden="true"></span><span>${opts.playLabel ?? "Tap to play"}</span>`;
  glow.stage.appendChild(play);
  let playHidden = false;
  function hidePlay(): void {
    if (playHidden) return;
    playHidden = true;
    play.classList.add("is-hidden");
  }

  const fig: Figure = {
    container,
    shell,
    glow,
    host,
    target,
    strip,
    held,
    tap(note, dur = 0.6, vel = 0.8) {
      target.on(note, vel);
      window.setTimeout(() => target.off(note), dur * 1000);
    },
    hidePlay,
  };

  play.addEventListener("click", (e) => {
    e.stopPropagation();
    router.touch(target);
    hidePlay();
    void host.start().then(() => opts.demo?.(fig));
  });
  host.onStart = hidePlay;
  // handle for headless checks (tools/ scripts read engine state through it)
  const w = window as unknown as { __synthFigs?: Figure[] };
  (w.__synthFigs ??= []).push(fig);

  return fig;
}

/** Wrap a figure's draw function into a Demo with the shared lifecycle. */
export function runFigure(fig: Figure, draw: () => void): Demo {
  const guard = frameGuard(() => {
    fig.strip?.releaseAll();
    for (const n of [...fig.held]) fig.target.off(n);
    fig.host.sleep();
  });
  return {
    frame() {
      fig.shell.tick();
      guard.pulse();
      fig.glow.begin();
      draw();
      fig.glow.end();
      if (fig.strip) {
        const t = fig.host.tele;
        fig.strip.setLit(t && performance.now() - t.at < 300 ? t.voices.filter((v) => v.held).map((v) => v.note) : []);
      }
    },
  };
}

/** Pointer drags on the stage, in CSS px relative to the canvas. */
export function drag(
  fig: Figure,
  h: {
    down?: (x: number, y: number, e: PointerEvent) => boolean | void;
    move?: (x: number, y: number, e: PointerEvent, dragging: boolean) => void;
    up?: (e: PointerEvent) => void;
  },
): void {
  const el = fig.glow.stage;
  const canvas = fig.glow.canvas;
  const active = new Set<number>();
  const pos = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * fig.glow.w, ((e.clientY - r.top) / r.height) * fig.glow.h];
  };
  el.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".synth-play")) return;
    const [x, y] = pos(e);
    const take = h.down?.(x, y, e);
    if (take === false) return;
    active.add(e.pointerId);
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    const [x, y] = pos(e);
    h.move?.(x, y, e, active.has(e.pointerId));
  });
  const end = (e: PointerEvent): void => {
    if (!active.delete(e.pointerId)) return;
    h.up?.(e);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/** A row of mutually exclusive buttons. */
export function choice<T>(
  shell: Shell,
  items: [T, string][],
  value: T,
  onPick: (v: T) => void,
  cls = "synth-choice",
): { set(v: T): void; el: HTMLDivElement } {
  const el = document.createElement("div");
  el.className = cls;
  const btns: [T, HTMLButtonElement][] = [];
  const set = (v: T): void => {
    for (const [k, b] of btns) b.classList.toggle("is-on", k === v);
  };
  for (const [v, label] of items) {
    const b = document.createElement("button");
    b.className = "demo-button";
    b.textContent = label;
    b.addEventListener("click", () => {
      set(v);
      onPick(v);
    });
    el.appendChild(b);
    btns.push([v, b]);
  }
  set(value);
  shell.controls.appendChild(el);
  return { set, el };
}

/** Keep a slider's thumb and label in sync when something else changes its value. */
export function syncSlider(input: HTMLInputElement, v: number, log = false, fmt?: (v: number) => string): void {
  input.value = String(log ? Math.log10(v) : v);
  const lo = Number(input.min);
  const hi = Number(input.max);
  input.style.setProperty("--fill", `${((Number(input.value) - lo) / (hi - lo || 1)) * 100}%`);
  const label = input.parentElement?.querySelector(".demo-slider-value");
  if (label && fmt) label.textContent = fmt(v);
}

// ---------------------------------------------------------------- colours
// Linear-light RGB for the HDR renderer (values above 1 bloom).

export const C = {
  blue: [0.32, 0.5, 1.0] as const,
  cyan: [0.3, 0.85, 1.0] as const,
  violet: [0.62, 0.5, 1.0] as const,
  warm: [1.0, 0.58, 0.22] as const,
  gold: [1.0, 0.78, 0.35] as const,
  pink: [1.0, 0.38, 0.55] as const,
  red: [1.0, 0.22, 0.2] as const,
  green: [0.35, 0.95, 0.6] as const,
  white: [1.0, 1.0, 1.0] as const,
  grid: [0.16, 0.19, 0.3] as const,
  dim: [0.09, 0.11, 0.18] as const,
};

/** Hue ramp across harmonics: deep blue → violet → warm. */
export function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const stops: [number, number, number][] = [
    [0.25, 0.45, 1.0],
    [0.6, 0.45, 1.0],
    [1.0, 0.45, 0.6],
    [1.0, 0.65, 0.25],
  ];
  const f = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const k = f - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export const TEXT = {
  dim: "rgba(138, 145, 165, 0.75)",
  mid: "rgba(190, 198, 220, 0.9)",
  hi: "#eef1f8",
  warm: "#f0c08a",
  accent: "#9ab6ff",
};
