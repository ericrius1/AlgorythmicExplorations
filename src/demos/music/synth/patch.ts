// Fig. — the whole instrument. Every engine from the page behind one set of
// presets, drawn as a signal path that's live while you play: each module
// shows what it's doing to the sound right now (the oscillator mix, the
// filter's response at the cutoff the engine is using, envelopes with a dot
// per voice, the string's delay line, the FM operators' live index), cables
// glow with the signal going through them, and a spectrogram of the output
// runs underneath.

import type { Demo } from "../../../lib/demoShell";
import { heatRgb } from "../../../lib/palette";
import { makeFigure, runFigure, choice, syncSlider, C, ramp, TEXT } from "./figure";
import { panel, type Box } from "./plot";
import { GlowImage, type Glow, type RGB } from "./glow";
import { STAGE, defaultPatch, mergePatch, clonePatch, type Patch, type VoiceTele, type Tele } from "./engine";
import { PRESETS } from "./presets";
import { ladderMag, attackLevel, decayLevel, releaseLevel, midiHz, noteName, fmtHz, fmtTime, logF, clamp, db, oscNaive, TAU } from "./dsp";

// ---------------------------------------------------------------- layout

type Id = "lfo" | "env1" | "env2" | "voices" | "osc" | "filter" | "amp" | "out" | "op1" | "op2" | "op3" | "op4" | "exc" | "delay" | "loop";
interface Cell {
  id: Id;
  c: number;
  r: number;
  cs?: number;
  rs?: number;
}
interface Grid {
  cols: number;
  rows: number;
  cells: Cell[];
}
interface EdgeSpec {
  a: Id;
  b: Id;
  mod?: boolean;
  loop?: boolean;
}

function layoutFor(p: Patch, narrow: boolean): Grid {
  if (p.mode === 0) {
    return narrow
      ? {
          cols: 2,
          rows: 4,
          cells: [
            { id: "lfo", c: 0, r: 0 },
            { id: "voices", c: 1, r: 0 },
            { id: "osc", c: 0, r: 1 },
            { id: "env2", c: 1, r: 1 },
            { id: "filter", c: 0, r: 2 },
            { id: "env1", c: 1, r: 2 },
            { id: "amp", c: 0, r: 3 },
            { id: "out", c: 1, r: 3 },
          ],
        }
      : {
          cols: 4,
          rows: 2,
          cells: [
            { id: "lfo", c: 0, r: 0 },
            { id: "env2", c: 1, r: 0 },
            { id: "env1", c: 2, r: 0 },
            { id: "voices", c: 3, r: 0 },
            { id: "osc", c: 0, r: 1 },
            { id: "filter", c: 1, r: 1 },
            { id: "amp", c: 2, r: 1 },
            { id: "out", c: 3, r: 1 },
          ],
        };
  }
  if (p.mode === 1) {
    const alg = p.fm.alg | 0;
    if (alg === 0)
      return narrow
        ? { cols: 2, rows: 2, cells: [{ id: "op2", c: 0, r: 0 }, { id: "voices", c: 1, r: 0 }, { id: "op1", c: 0, r: 1 }, { id: "out", c: 1, r: 1 }] }
        : { cols: 4, rows: 2, cells: [{ id: "op2", c: 0.6, r: 0 }, { id: "voices", c: 3, r: 0 }, { id: "op1", c: 0.6, r: 1 }, { id: "out", c: 3, r: 1 }] };
    if (alg === 1)
      return narrow
        ? {
            cols: 2,
            rows: 3,
            cells: [
              { id: "op2", c: 0, r: 0 },
              { id: "op4", c: 1, r: 0 },
              { id: "op1", c: 0, r: 1 },
              { id: "op3", c: 1, r: 1 },
              { id: "out", c: 0, r: 2 },
              { id: "voices", c: 1, r: 2 },
            ],
          }
        : {
            cols: 4,
            rows: 2,
            cells: [
              { id: "op2", c: 0.25, r: 0 },
              { id: "op4", c: 1.5, r: 0 },
              { id: "voices", c: 3, r: 0 },
              { id: "op1", c: 0.25, r: 1 },
              { id: "op3", c: 1.5, r: 1 },
              { id: "out", c: 3, r: 1 },
            ],
          };
    return narrow
      ? {
          cols: 2,
          rows: 3,
          cells: [
            { id: "op3", c: 0, r: 0 },
            { id: "op2", c: 1, r: 0 },
            { id: "voices", c: 0, r: 1 },
            { id: "op1", c: 1, r: 1 },
            { id: "out", c: 1, r: 2 },
          ],
        }
      : {
          cols: 4,
          rows: 2,
          cells: [
            { id: "op3", c: 0.25, r: 0 },
            { id: "op2", c: 1.5, r: 0 },
            { id: "voices", c: 3, r: 0 },
            { id: "op1", c: 1.5, r: 1 },
            { id: "out", c: 3, r: 1 },
          ],
        };
  }
  return narrow
    ? {
        cols: 2,
        rows: 3,
        cells: [
          { id: "exc", c: 0, r: 0 },
          { id: "delay", c: 1, r: 0, rs: 2 },
          { id: "loop", c: 0, r: 1 },
          { id: "out", c: 0, r: 2 },
          { id: "voices", c: 1, r: 2 },
        ],
      }
    : {
        cols: 4,
        rows: 2,
        cells: [
          { id: "exc", c: 0, r: 1 },
          { id: "delay", c: 1, r: 0, rs: 2 },
          { id: "loop", c: 2, r: 1 },
          { id: "voices", c: 3, r: 0 },
          { id: "out", c: 3, r: 1 },
        ],
      };
}

function edgesFor(p: Patch): EdgeSpec[] {
  if (p.mode === 0) {
    const e: EdgeSpec[] = [
      { a: "osc", b: "filter" },
      { a: "filter", b: "amp" },
      { a: "amp", b: "out" },
      { a: "env2", b: "filter", mod: true },
      { a: "env1", b: "amp", mod: true },
    ];
    if (p.lfo.pitch > 0 || p.lfo.pw > 0) e.push({ a: "lfo", b: "osc", mod: true });
    if (p.lfo.cut > 0) e.push({ a: "lfo", b: "filter", mod: true });
    if (p.lfo.amp > 0) e.push({ a: "lfo", b: "amp", mod: true });
    return e;
  }
  if (p.mode === 1) {
    const alg = p.fm.alg | 0;
    if (alg === 0) return [{ a: "op2", b: "op1" }, { a: "op1", b: "out" }];
    if (alg === 1)
      return [
        { a: "op2", b: "op1" },
        { a: "op4", b: "op3" },
        { a: "op1", b: "out" },
        { a: "op3", b: "out" },
      ];
    return [
      { a: "op3", b: "op2" },
      { a: "op2", b: "op1" },
      { a: "op1", b: "out" },
    ];
  }
  return [
    { a: "exc", b: "delay" },
    { a: "delay", b: "loop" },
    { a: "loop", b: "delay", loop: true },
    { a: "loop", b: "out" },
  ];
}

// ---------------------------------------------------------------- drawing helpers

function frame(g: Glow, b: Box, col: RGB, a: number): void {
  g.seg(b.x, b.y, b.x + b.w, b.y, 1, col, a);
  g.seg(b.x, b.y + b.h, b.x + b.w, b.y + b.h, 1, col, a);
  g.seg(b.x, b.y, b.x, b.y + b.h, 1, col, a);
  g.seg(b.x + b.w, b.y, b.x + b.w, b.y + b.h, 1, col, a);
}

function bez(x0: number, y0: number, c0x: number, c0y: number, c1x: number, c1y: number, x1: number, y1: number, n = 28): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(
      u * u * u * x0 + 3 * u * u * t * c0x + 3 * u * t * t * c1x + t * t * t * x1,
      u * u * u * y0 + 3 * u * u * t * c0y + 3 * u * t * t * c1y + t * t * t * y1,
    );
  }
  return out;
}

/** A point `t` (0…1) of the way along a polyline, by length. */
function along(pts: number[], t: number): [number, number] {
  let total = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) total += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  let want = t * total;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const l = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    if (want <= l) {
      const k = l > 0 ? want / l : 0;
      return [pts[i] + (pts[i + 2] - pts[i]) * k, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * k];
    }
    want -= l;
  }
  return [pts[pts.length - 2], pts[pts.length - 1]];
}

/** Start of a rising zero crossing near the middle, so the trace holds still. */
function trigger(x: Float32Array, span: number): number {
  const lim = x.length - span - 1;
  for (let i = Math.min(lim, Math.floor(x.length * 0.25)); i > 1; i--) if (x[i - 1] < 0 && x[i] >= 0) return i;
  return Math.max(0, lim);
}

function rms(x: Float32Array | undefined): number {
  if (!x) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

const WAVE_LABEL = ["sine", "triangle", "saw", "pulse"];
const LFO_LABEL = ["sine", "triangle", "saw", "square", "random"];
const COL = {
  audio: [0.5, 0.68, 1.3] as RGB,
  mod: [0.4, 1.15, 0.78] as RGB,
  warm: [1.3, 0.75, 0.32] as RGB,
  frame: [0.22, 0.26, 0.4] as RGB,
};

// ---------------------------------------------------------------- figure

export async function mountPatch(container: HTMLElement): Promise<Demo> {
  const narrow = (container.clientWidth || 700) < 560;
  let preset = 0;
  const mac = { bright: 0, attack: 1, release: 1, vibrato: 0 };
  let full: Patch = clonePatch(defaultPatch());

  const build = (): Patch => {
    const pr = PRESETS[preset];
    const p = mergePatch(clonePatch(defaultPatch()), pr.patch);
    const b = mac.bright;
    if (p.mode === 0) {
      p.flt.cut = clamp(p.flt.cut * Math.pow(2, 3 * b), 30, 16000);
      p.e1.a *= mac.attack;
      p.e2.a *= mac.attack;
      p.e1.r *= mac.release;
      p.e2.r *= mac.release;
      p.lfo.pitch = mac.vibrato;
    } else if (p.mode === 1) {
      const mods = p.fm.alg === 0 ? [1] : p.fm.alg === 1 ? [1, 3] : [1, 2];
      for (const i of mods) p.fm.ops[i].lvl *= Math.pow(2, 1.5 * b);
      for (const o of p.fm.ops) {
        o.a *= mac.attack;
        o.r *= mac.release;
      }
      p.lfo.pitch = mac.vibrato;
    } else {
      p.ks.bright = clamp(p.ks.bright * Math.pow(2, 1.5 * b), 0.05, 1);
      p.e1.r *= mac.release;
    }
    return p;
  };
  full = build();
  // when the newest note started (lights up the string's excitation)
  let lastPluck = -1e9;

  const fig = await makeFigure(container, {
    aspect: narrow ? 1.7 : 0.8,
    patch: full,
    host: { fft: 8192, smoothing: 0, scope: true, ks: true, fx: true, reverb: PRESETS[0].fx.reverb },
    glow: { bloom: 0.22 },
    base: 48,
    strip: { whites: 21 },
    playLabel: "Tap to hear this preset",
    demo: () => playRiff(),
    onNote: (_n, on) => {
      if (on) lastPluck = performance.now();
    },
  });
  const { glow: g, host, shell } = fig;
  host.setFx(PRESETS[0].fx);

  const riffTimers: number[] = [];
  function playRiff(): void {
    for (const t of riffTimers) window.clearTimeout(t);
    riffTimers.length = 0;
    void host.start().then(() => {
      for (const [n, at, len] of PRESETS[preset].riff) riffTimers.push(window.setTimeout(() => fig.tap(n, len, 0.8), at * 1000));
    });
  }

  const send = (): void => {
    full = build();
    host.set(full);
  };

  // ---- controls ----
  const fmtBright = (v: number): string => {
    const p = PRESETS[preset].patch;
    if (p.mode === 0) {
      const f = clamp((p.flt?.cut ?? 2400) * Math.pow(2, 3 * v), 30, 16000);
      return `cutoff ${f >= 1000 ? `${(f / 1000).toFixed(1)}k` : Math.round(f)}`;
    }
    if (p.mode === 1) return `index ×${Math.pow(2, 1.5 * v).toFixed(2)}`;
    return `pluck ${clamp((p.ks?.bright ?? 0.85) * Math.pow(2, 1.5 * v), 0.05, 1).toFixed(2)}`;
  };
  const fmtMul = (v: number): string => `×${v < 1 ? v.toFixed(2) : v.toFixed(1)}`;
  const fmtVib = (v: number): string => (v < 0.5 ? "off" : `±${Math.round(v)}¢`);
  const fmtWet = (v: number): string => (v < 0.005 ? "off" : `${Math.round(v * 100)}%`);

  let brightIn: HTMLInputElement;
  let attIn: HTMLInputElement;
  let relIn: HTMLInputElement;
  let vibIn: HTMLInputElement;
  let chIn: HTMLInputElement;
  let dlIn: HTMLInputElement;
  let rvIn: HTMLInputElement;
  const enable = (el: HTMLInputElement, on: boolean): void => {
    el.disabled = !on;
    el.parentElement!.style.opacity = on ? "1" : "0.4";
  };

  choice(
    shell,
    PRESETS.map((p, i) => [i, p.name] as [number, string]),
    0,
    (i) => {
      preset = i;
      const p = PRESETS[i];
      mac.bright = 0;
      mac.attack = 1;
      mac.release = 1;
      mac.vibrato = p.patch.lfo?.pitch ?? 0;
      host.flush();
      send();
      host.setFx(p.fx);
      syncSlider(brightIn, 0, false, fmtBright);
      syncSlider(attIn, 1, true, fmtMul);
      syncSlider(relIn, 1, true, fmtMul);
      syncSlider(vibIn, mac.vibrato, false, fmtVib);
      syncSlider(chIn, p.fx.chorus, false, fmtWet);
      syncSlider(dlIn, p.fx.delay, false, fmtWet);
      syncSlider(rvIn, p.fx.reverb, false, fmtWet);
      enable(attIn, p.patch.mode !== 2);
      enable(vibIn, p.patch.mode !== 2);
      if (host.live) playRiff();
    },
    "synth-choice synth-presets",
  );
  brightIn = shell.slider({ label: "brightness", min: -1, max: 1, step: 0.01, value: 0, format: fmtBright, onInput: (v) => ((mac.bright = v), send()) });
  attIn = shell.slider({ label: "attack", min: 0.125, max: 8, step: 0.01, value: 1, log: true, format: fmtMul, onInput: (v) => ((mac.attack = v), send()) });
  relIn = shell.slider({ label: "release", min: 0.125, max: 8, step: 0.01, value: 1, log: true, format: fmtMul, onInput: (v) => ((mac.release = v), send()) });
  vibIn = shell.slider({ label: "vibrato", min: 0, max: 50, step: 1, value: 0, format: fmtVib, onInput: (v) => ((mac.vibrato = v), send()) });
  chIn = shell.slider({ label: "chorus", min: 0, max: 1, step: 0.01, value: PRESETS[0].fx.chorus, format: fmtWet, onInput: (v) => host.setFx({ chorus: v }) });
  dlIn = shell.slider({ label: "delay", min: 0, max: 0.6, step: 0.01, value: PRESETS[0].fx.delay, format: fmtWet, onInput: (v) => host.setFx({ delay: v }) });
  rvIn = shell.slider({ label: "reverb", min: 0, max: 0.8, step: 0.01, value: PRESETS[0].fx.reverb, format: fmtWet, onInput: (v) => host.setFx({ reverb: v }) });
  // the brightness label depends on the preset's base cutoff
  syncSlider(brightIn, 0, false, fmtBright);

  shell.setInfo(() => {
    const p = PRESETS[preset];
    const n = full.poly <= 1 ? "mono" : `${full.poly} voices`;
    return `${p.name}: ${p.info} · ${n}`;
  });

  // ---- spectrogram ----
  const SG_COLS = 300;
  const SG_ROWS = 150;
  const SG_LO = 40;
  const SG_HI = 12000;
  const img = new GlowImage(SG_COLS, SG_ROWS);
  const colBuf = new Uint8ClampedArray(SG_ROWS * 4);
  const fbuf = new Float32Array(4096);
  const rowBins: [number, number][] = [];
  const colour = (t: number, o: number): void => {
    const [r, gg, b] = heatRgb(t);
    const k = Math.min(1, t * 2.2);
    colBuf[o] = r * k;
    colBuf[o + 1] = gg * k;
    colBuf[o + 2] = b * k;
    colBuf[o + 3] = 255;
  };
  let sgAcc = 0;

  // ---- signal levels, smoothed for the cables ----
  const lv = { osc: 0, flt: 0, out: 0 };
  let flow = 0;
  let lastT = performance.now();
  // the last fresh scopes
  let scopes: Float32Array[] | null = null;

  return runFigure(fig, () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    flow += dt;
    const W = g.w;
    const H = g.h;
    const p = full;
    const tele: Tele | null = host.live && host.tele && now - host.tele.at < 300 ? host.tele : null;
    const voices: VoiceTele[] = tele ? [...tele.voices].sort((a, b) => b.age - a.age) : [];
    const v0 = voices[0];
    if (tele?.scope) scopes = tele.scope;
    if (!tele) scopes = null;
    const k = 1 - Math.exp(-dt / 0.06);
    lv.osc += ((voices.length ? clamp(rms(scopes?.[0]) * 1.6, 0.25, 1) : 0) - lv.osc) * k;
    lv.flt += ((voices.length ? clamp(rms(scopes?.[1]) * 3, 0.15, 1) : 0) - lv.flt) * k;
    lv.out += (clamp(rms(scopes?.[2]) * 6, 0, 1) - lv.out) * k;

    // ---- layout ----
    const sgH = narrow ? H * 0.17 : H * 0.24;
    const D: Box = { x: 10, y: 10, w: W - 20, h: H - sgH - 52 };
    const grid = layoutFor(p, narrow);
    const cw = D.w / grid.cols;
    const ch = D.h / grid.rows;
    const gx = Math.min(30, cw * 0.14);
    const gy = Math.min(34, ch * 0.2);
    const boxes = new Map<Id, Box>();
    for (const c of grid.cells) {
      boxes.set(c.id, {
        x: D.x + c.c * cw + gx / 2,
        y: D.y + c.r * ch + gy / 2 + 12,
        w: (c.cs ?? 1) * cw - gx,
        h: (c.rs ?? 1) * ch - gy - 12,
      });
    }

    // ---- cables (under the modules) ----
    const levelOf = (e: EdgeSpec): number => {
      if (e.mod) {
        if (!voices.length) return 0.15;
        if (e.a === "lfo") return 0.35 + 0.65 * Math.abs(tele?.lfo ?? 0);
        return 0.2 + 0.8 * clamp(e.a === "env1" ? v0.e1 : v0.e2, 0, 1);
      }
      if (p.mode === 0) return e.a === "osc" ? lv.osc : e.a === "filter" ? lv.flt : lv.out;
      if (!voices.length) return 0;
      if (p.mode === 1) {
        const opIdx = Number(e.a.slice(2)) - 1;
        if (e.b === "out") return clamp(lv.out * 1.4, 0.1, 1);
        return clamp(0.15 + v0.ops[opIdx] * 0.85, 0, 1);
      }
      return e.a === "exc" ? clamp(1 - (now - lastPluck) / 300, 0, 1) : clamp(lv.out * 1.5, 0.15, 1);
    };
    const edges = edgesFor(p);
    // spread several cables arriving at one side of a module
    const arrivals = new Map<string, number>();
    const arrivalIdx = (key: string): number => {
      const n = arrivals.get(key) ?? 0;
      arrivals.set(key, n + 1);
      return n;
    };
    for (const e of edges) {
      const A = boxes.get(e.a);
      const B = boxes.get(e.b);
      if (!A || !B) continue;
      let pts: number[];
      if (e.loop) {
        // the string's feedback: out of the loop filter's top, back into the delay line
        const x0 = A.x + A.w * 0.5;
        const y0 = A.y;
        const x1 = B.x + B.w;
        const y1 = B.y + B.h * 0.3;
        pts = bez(x0, y0, x0, y1, x1 + 40, y1, x1, y1);
      } else {
        const ax = A.x + A.w / 2;
        const ay = A.y + A.h / 2;
        const bx = B.x + B.w / 2;
        const by = B.y + B.h / 2;
        const horiz = Math.abs(bx - ax) > Math.abs(by - ay) * 1.2;
        if (horiz) {
          const dir = bx > ax ? 1 : -1;
          const side = `${e.b}:h${dir}`;
          const i = arrivalIdx(side);
          const x0 = dir > 0 ? A.x + A.w : A.x;
          const x1 = dir > 0 ? B.x : B.x + B.w;
          const y0 = clamp(by, A.y + 10, A.y + A.h - 10);
          const y1 = clamp(ay, B.y + 10, B.y + B.h - 10) + i * 8;
          const m = Math.abs(x1 - x0) * 0.5;
          pts = bez(x0, y0, x0 + dir * m, y0, x1 - dir * m, y1, x1, y1);
        } else {
          const dir = by > ay ? 1 : -1;
          const i = arrivalIdx(`${e.b}:v${dir}`);
          const y0 = dir > 0 ? A.y + A.h : A.y;
          const y1 = dir > 0 ? B.y : B.y + B.h;
          const x0 = clamp(bx, A.x + 14, A.x + A.w - 14);
          const x1 = clamp(ax, B.x + 14, B.x + B.w - 14) + (i - 0.5) * 18 * (i > 0 ? 1 : 0);
          const m = Math.abs(y1 - y0) * 0.55;
          pts = bez(x0, y0, x0, y0 + dir * m, x1, y1 - dir * m, x1, y1);
        }
      }
      const L = levelOf(e);
      const col = e.mod ? COL.mod : COL.audio;
      g.line(pts, 1, [col[0] * 0.3, col[1] * 0.3, col[2] * 0.3], 0.9);
      if (L > 0.02) {
        g.glowLine(pts, 1.4 + 1.2 * L, col, 0.25 + 0.75 * L, 0.35);
        // signal moving along the cable
        const nDots = e.mod ? 3 : 5;
        const speed = e.mod ? 0.35 : 0.8;
        for (let d = 0; d < nDots; d++) {
          const t = (flow * speed + d / nDots) % 1;
          const [x, y] = along(pts, t);
          g.dot(x, y, 2.2 + 1.2 * L, [col[0] * 1.5, col[1] * 1.5, col[2] * 1.5], L);
        }
      }
      // arrowhead dot at the input
      g.dot(pts[pts.length - 2], pts[pts.length - 1], 3, L > 0.02 ? col : COL.frame, 1);
    }

    // ---- modules ----
    for (const c of grid.cells) {
      const b = boxes.get(c.id)!;
      drawModule(c.id, b);
    }

    // ---- spectrogram ----
    const sg: Box = { x: 44, y: H - sgH - 20, w: W - 60, h: sgH };
    if (host.live) {
      sgAcc += dt;
      if (sgAcc > 1 / 50) {
        sgAcc = 0;
        const have = host.freqData(fbuf);
        if (!rowBins.length || rowBins.length !== SG_ROWS) {
          rowBins.length = 0;
          const binHz = host.sampleRate / 8192;
          for (let r = 0; r < SG_ROWS; r++) {
            const f0 = logF((r - 0.5) / (SG_ROWS - 1), SG_LO, SG_HI);
            const f1 = logF((r + 0.5) / (SG_ROWS - 1), SG_LO, SG_HI);
            const lo = Math.max(1, Math.floor(f0 / binHz));
            rowBins.push([lo, Math.max(lo, Math.ceil(f1 / binHz))]);
          }
        }
        for (let r = 0; r < SG_ROWS; r++) {
          let m = -200;
          if (have) {
            const [lo, hi] = rowBins[r];
            for (let i = lo; i <= hi && i < fbuf.length; i++) m = Math.max(m, fbuf[i]);
          }
          colour(clamp((m + 100) / 80, 0, 1), (SG_ROWS - 1 - r) * 4);
        }
        img.push(colBuf);
      }
    }
    panel(g, sg, "output spectrogram", host.live ? "last 6 s" : "play to fill it");
    g.image(img, sg.x, sg.y, sg.w, sg.h, 1.2);
    for (const f of [100, 1000, 10000]) {
      const y = sg.y + sg.h * (1 - Math.log(f / SG_LO) / Math.log(SG_HI / SG_LO));
      g.seg(sg.x - 4, y, sg.x, y, 1, C.grid, 1);
      g.text(f >= 1000 ? `${f / 1000}k` : `${f}`, sg.x - 7, y + 3.5, { size: 9.5, align: "right", color: TEXT.dim, mono: true });
    }
    if (v0) {
      const y = sg.y + sg.h * (1 - Math.log(midiHz(v0.note) / SG_LO) / Math.log(SG_HI / SG_LO));
      if (y > sg.y && y < sg.y + sg.h) {
        g.seg(sg.x + sg.w, y, sg.x + sg.w + 6, y, 2, COL.warm, 1);
      }
    }

    // ================================================================ modules

    function head(b: Box, title: string, right: string, on: number): void {
      g.rect(b.x, b.y, b.w, b.h, [0.05, 0.06, 0.11], 0.85, [0.025, 0.03, 0.05], 0.85);
      frame(g, b, on > 0.05 ? [0.3 + 0.5 * on, 0.36 + 0.4 * on, 0.62 + 0.5 * on] : COL.frame, 0.5 + 0.5 * on);
      g.text(title, b.x + 1, b.y - 6, { size: 9.5, weight: 650, color: on > 0.05 ? TEXT.mid : TEXT.dim });
      // the right-hand note only where it fits beside the title
      if (right && g.textWidth(title, 9.5, 650) + right.length * 5.8 + 12 < b.w)
        g.text(right, b.x + b.w - 1, b.y - 6, { size: 9.5, align: "right", color: TEXT.dim, mono: true });
    }

    function trace(b: Box, x: Float32Array | undefined, col: RGB, gain: number, periods = 2): void {
      const mid = b.y + b.h / 2;
      g.seg(b.x + 4, mid, b.x + b.w - 4, mid, 1, C.grid, 0.5);
      if (!x || !v0) return;
      const per = host.sampleRate / midiHz(v0.note + (p.mode === 0 ? p.o1.oct * 12 : 0));
      const span = Math.min(x.length - 2, Math.max(32, Math.round(per * periods)));
      const s0 = trigger(x, span);
      const pts: number[] = [];
      const N = Math.min(span, 220);
      for (let i = 0; i <= N; i++) {
        const v = x[s0 + Math.floor((i / N) * span)];
        pts.push(b.x + 4 + (i / N) * (b.w - 8), mid - clamp(v * gain, -1, 1) * (b.h / 2 - 4));
      }
      g.glowLine(pts, 1.4, col, 1, 0.3);
    }

    function envGlyph(b: Box, e: { a: number; d: number; s: number; r: number }, lvl: (v: VoiceTele) => [number, number, number], col: RGB): void {
      const x0 = b.x + 6;
      const Z = (b.w - 12) * 0.27;
      const xa = x0 + Z * Math.sqrt(Math.min(e.a, 4) / 4);
      const xd = xa + Z * Math.sqrt(Math.min(e.d, 4) / 4);
      const xs = xd + (b.w - 12) * 0.16;
      const xr = xs + Z * Math.sqrt(Math.min(e.r, 6) / 6);
      const y = (l: number): number => b.y + b.h - 5 - l * (b.h - 12);
      const pts: number[] = [x0, y(0)];
      for (let i = 1; i <= 16; i++) pts.push(x0 + (xa - x0) * (i / 16), y(attackLevel((i / 16) * e.a, e.a)));
      for (let i = 1; i <= 16; i++) pts.push(xa + (xd - xa) * (i / 16), y(decayLevel((i / 16) * e.d, e.d, e.s)));
      pts.push(xs, y(e.s));
      for (let i = 1; i <= 16; i++) pts.push(xs + (xr - xs) * (i / 16), y(releaseLevel((i / 16) * e.r, e.r, e.s)));
      g.area(pts, y(0), [col[0] * 0.4, col[1] * 0.4, col[2] * 0.4], 0.3, col, 0.02);
      g.line(pts, 1.5, col, 0.95);
      for (const v of voices) {
        const [st, t, l] = lvl(v);
        let x: number;
        if (st === STAGE.attack) x = x0 + (xa - x0) * clamp(t / e.a, 0, 1);
        else if (st === STAGE.decay) x = xa + (xd - xa) * clamp(t / e.d, 0, 1);
        else if (st === STAGE.sustain) x = xd + (xs - xd) * (1 - Math.exp(-t / 0.8)) * 0.92;
        else if (st === STAGE.release) x = xs + (xr - xs) * clamp(t / e.r, 0, 1);
        else continue;
        g.dot(x, y(l), 8, [1.4, 1.4, 1.5], 0.3, true);
        g.dot(x, y(l), 2.8, [1.8, 1.8, 1.9], 1);
      }
    }

    function opNode(b: Box, i: number): void {
      const o = p.fm.ops[i];
      const isCarrier = p.fm.alg === 0 ? i === 0 : p.fm.alg === 1 ? i === 0 || i === 2 : i === 0;
      const v = v0;
      const e = v ? v.ops[i] : 0;
      const on = v ? clamp(e * 1.2, 0, 1) : 0;
      head(b, `OP ${i + 1} · ${isCarrier ? "carrier" : "modulator"}`, `${o.ratio}×${o.det ? ` +${o.det} Hz` : ""}`, on);
      const inner: Box = { x: b.x + 4, y: b.y + 4, w: b.w - 8, h: b.h - 22 };
      // waveform of this operator's output: a carrier shows its modulated wave
      const mid = inner.y + inner.h / 2;
      g.seg(inner.x, mid, inner.x + inner.w, mid, 1, C.grid, 0.4);
      const amp = v ? e : 0.6;
      const modIdx = (j: number): number => p.fm.ops[j].lvl * (v ? v.ops[j] : 0.6);
      const pts: number[] = [];
      const N = 160;
      for (let s = 0; s <= N; s++) {
        const t = (s / N) * 2;
        let ph = TAU * o.ratio * t;
        if (isCarrier) {
          const mi = p.fm.alg === 1 && i === 2 ? 3 : 1;
          ph += modIdx(mi) * Math.sin(TAU * p.fm.ops[mi].ratio * t);
        } else if (p.fm.alg === 2 && i === 1) {
          ph += modIdx(2) * Math.sin(TAU * p.fm.ops[2].ratio * t);
        }
        pts.push(inner.x + (s / N) * inner.w, mid - Math.sin(ph) * amp * (inner.h / 2 - 3));
      }
      const col: RGB = isCarrier ? [1.3, 1.0, 0.5] : [0.5, 0.8, 1.35];
      g.glowLine(pts, 1.3, col, v ? 1 : 0.5, 0.3);
      const label = isCarrier ? `level ${(o.lvl * e).toFixed(2)}` : `index ${(o.lvl * e).toFixed(2)} of ${o.lvl.toFixed(1)}`;
      g.text(v ? label : isCarrier ? `level ${o.lvl.toFixed(2)}` : `peak index ${o.lvl.toFixed(1)}`, b.x + 6, b.y + b.h - 6, { size: 9.5, color: TEXT.dim, mono: true });
      // level bar along the right edge
      g.rect(b.x + b.w - 5, b.y + 4 + (1 - e) * (b.h - 8), 2, e * (b.h - 8), col, 0.9, col, 0.9);
      if (i === (p.fm.alg === 0 ? 1 : p.fm.alg === 1 ? 3 : 2) && p.fm.fb > 0) {
        // feedback loop on the top operator
        // feedback: the operator's output back into its own phase
        const lp = bez(b.x, b.y + b.h * 0.65, b.x - 22, b.y + b.h * 0.65, b.x - 22, b.y + b.h * 0.2, b.x, b.y + b.h * 0.2);
        g.line(lp, 1.2, COL.audio, 0.4 + 0.6 * on);
        g.dot(b.x, b.y + b.h * 0.2, 2.5, COL.audio, 1);
        g.text(`fb ${p.fm.fb.toFixed(1)}`, b.x - 4, b.y + b.h * 0.65 + 14, { size: 9, align: "right", color: TEXT.dim, mono: true });
      }
    }

    function drawModule(id: Id, b: Box): void {
      switch (id) {
        case "osc": {
          const on = lv.osc;
          head(b, "OSCILLATORS", p.aa === 1 ? "band-limited" : "", on);
          const rows: { label: string; lvl: number; wave: number; pw: number }[] = [
            { label: `1 ${WAVE_LABEL[p.o1.wave]}${p.o1.oct ? ` ${p.o1.oct > 0 ? "+" : ""}${p.o1.oct} oct` : ""}`, lvl: p.o1.lvl, wave: p.o1.wave, pw: p.o1.pw },
            { label: `2 ${WAVE_LABEL[p.o2.wave]}${p.o2.oct ? ` ${p.o2.oct > 0 ? "+" : ""}${p.o2.oct} oct` : ""}${p.o2.det ? ` ${p.o2.det > 0 ? "+" : ""}${p.o2.det}¢` : ""}`, lvl: p.o2.lvl, wave: p.o2.wave, pw: p.o2.pw },
            { label: "noise", lvl: p.noise, wave: -1, pw: 0 },
          ];
          const rh = (b.h - 8) / 3;
          const lfoPw = (tele?.lfo ?? 0) * p.lfo.pw;
          rows.forEach((r, i) => {
            const y = b.y + 4 + i * rh;
            const mid = y + rh / 2;
            const gw = Math.min(b.w * 0.34, 56);
            const gx0 = b.x + 6;
            const pts: number[] = [];
            const a = r.lvl > 0.01 ? 0.35 + 0.65 * Math.min(1, r.lvl) : 0;
            for (let s = 0; s <= 48; s++) {
              const t = (s / 48) * 2;
              const y0 = r.wave < 0 ? Math.sin(s * 12.9898 + Math.floor(flow * 20)) * 0.8 : oscNaive(r.wave, t - Math.floor(t), clamp(r.pw + lfoPw, 0.02, 0.98));
              pts.push(gx0 + (s / 48) * gw, mid - y0 * (rh * 0.32));
            }
            if (a > 0) g.line(pts, 1.3, [COL.audio[0] * (0.6 + on), COL.audio[1] * (0.6 + on), COL.audio[2] * (0.6 + on)], a);
            else g.line(pts, 1, COL.frame, 0.6);
            g.text(r.label, gx0 + gw + 8, mid + 3.5, { size: 9.5, color: a > 0 ? TEXT.mid : TEXT.dim, mono: true });
          });
          break;
        }
        case "filter": {
          const cut = v0 ? v0.cut : p.flt.cut;
          head(b, "FILTER", `${p.flt.poles * 6} dB/oct`, lv.flt);
          const inner: Box = { x: b.x + 4, y: b.y + 6, w: b.w - 8, h: b.h - 22 };
          const pts: number[] = [];
          const lo = 30;
          const hi = 16000;
          for (let i = 0; i <= 80; i++) {
            const f = logF(i / 80, lo, hi);
            const d = db(ladderMag(f, cut, p.flt.res, p.flt.poles, host.sampleRate || 48000));
            pts.push(inner.x + (i / 80) * inner.w, inner.y + inner.h * (1 - clamp((d + 42) / 60, 0, 1)));
          }
          g.area(pts, inner.y + inner.h, [0.9, 0.55, 0.2], 0.2, [0.9, 0.55, 0.2], 0);
          g.glowLine(pts, 1.6, COL.warm, 0.6 + 0.4 * Math.max(lv.flt, 0.3), 0.35);
          const xc = inner.x + (Math.log(clamp(cut, lo, hi) / lo) / Math.log(hi / lo)) * inner.w;
          g.dot(xc, inner.y + inner.h * (1 - clamp((db(ladderMag(cut, cut, p.flt.res, p.flt.poles, 48000)) + 42) / 60, 0, 1)), 3, [1.6, 1, 0.5], 1);
          g.text(`${fmtHz(cut)} · res ${p.flt.res.toFixed(1)}`, b.x + 6, b.y + b.h - 6, { size: 9.5, color: v0 ? TEXT.warm : TEXT.dim, mono: true });
          break;
        }
        case "amp": {
          head(b, "AMP", "", lv.out);
          trace({ x: b.x, y: b.y + 2, w: b.w, h: b.h - 4 }, scopes?.[2], COL.audio, 3, 2);
          if (!v0) g.text(b.w > 150 ? "the envelope sets the level" : "envelope × signal", b.x + b.w / 2, b.y + b.h / 2 + 16, { size: 9.5, align: "center", color: TEXT.dim });
          break;
        }
        case "env1":
        case "env2": {
          const e = id === "env1" ? p.e1 : p.e2;
          const on = v0 ? clamp(id === "env1" ? v0.e1 : v0.e2, 0, 1) : 0;
          head(b, id === "env1" ? "ENV 1 → AMP" : "ENV 2 → CUTOFF", id === "env2" ? `+${p.flt.env.toFixed(1)} oct` : "", on);
          envGlyph(b, e, (v) => (id === "env1" ? [v.s1, v.t1, v.e1] : [v.s2, v.t2, v.e2]), id === "env1" ? [0.45, 0.65, 1.3] : COL.warm);
          g.text(`A ${fmtTime(e.a)} · R ${fmtTime(e.r)}`, b.x + b.w - 5, b.y + 12, { size: 9, align: "right", color: TEXT.dim, mono: true });
          break;
        }
        case "lfo": {
          const l = p.lfo;
          const used = l.pitch > 0 || l.cut > 0 || l.amp > 0 || l.pw > 0;
          head(b, "LFO", `${LFO_LABEL[l.wave]} ${l.rate < 10 ? l.rate.toFixed(1) : Math.round(l.rate)} Hz`, used && v0 ? 0.6 : 0);
          const inner: Box = { x: b.x + 6, y: b.y + 6, w: b.w - 12, h: b.h - 24 };
          const mid = inner.y + inner.h / 2;
          const ph = tele ? tele.lfoPh : (flow * l.rate) % 1;
          const pts: number[] = [];
          for (let s = 0; s <= 80; s++) {
            const q = (s / 80) * 2;
            let y: number;
            if (l.wave === 4) y = Math.sin(Math.floor(q * 4) * 78.233) * 0.9;
            else if (l.wave === 0) y = Math.sin(TAU * q);
            else if (l.wave === 1) {
              let u = q + 0.25;
              u -= Math.floor(u);
              y = 1 - 4 * Math.abs(u - 0.5);
            } else if (l.wave === 2) y = 2 * (q - Math.floor(q)) - 1;
            else y = q - Math.floor(q) < 0.5 ? 1 : -1;
            pts.push(inner.x + (s / 80) * inner.w, mid - y * inner.h * 0.38);
          }
          g.line(pts, 1.4, used ? COL.mod : COL.frame, used ? 0.9 : 0.6);
          if (used) {
            const [x, y] = along(pts, ph * 0.5);
            g.dot(x, y, 8, COL.mod, 0.35, true);
            g.dot(x, y, 3, [0.7, 1.6, 1.1], 1);
          }
          const dests: string[] = [];
          if (l.pitch > 0) dests.push(`pitch ±${Math.round(l.pitch)}¢`);
          if (l.pw > 0) dests.push(`width ±${Math.round(l.pw * 100)}%`);
          if (l.cut > 0) dests.push(`cutoff ±${l.cut.toFixed(2)} oct`);
          if (l.amp > 0) dests.push(`volume ${Math.round(l.amp * 100)}%`);
          g.text(dests.length ? `→ ${dests.join(", ")}` : "not patched", b.x + 6, b.y + b.h - 6, { size: 9.5, color: used ? "rgba(140,235,180,0.85)" : TEXT.dim, mono: true });
          break;
        }
        case "voices": {
          const poly = Math.max(1, p.poly);
          head(b, "VOICES", poly <= 1 ? "mono" : `${voices.length} of ${poly}`, voices.length ? 0.5 : 0);
          const slots = Math.min(poly, narrow ? 6 : 10);
          const cols = b.w > 200 ? 2 : 1;
          const perCol = Math.ceil(slots / cols);
          const rh = (b.h - 8) / perCol;
          const list = [...voices].sort((a, b2) => a.age - b2.age);
          for (let s = 0; s < slots; s++) {
            const cx = b.x + 6 + Math.floor(s / perCol) * (b.w / cols);
            const cy = b.y + 4 + (s % perCol) * rh + rh / 2;
            const bw = b.w / cols - 54;
            const v = list[s];
            g.rect(cx + 34, cy - 2, bw, 4, C.dim, 1, C.dim, 1);
            if (v) {
              const l = clamp(p.mode === 1 ? Math.max(v.ops[0], v.ops[2] ?? 0) : v.e1, 0, 1);
              const col: RGB = v.held ? COL.warm : COL.audio;
              g.rect(cx + 34, cy - 2, bw * l, 4, col, 1, col, 1);
              g.text(noteName(v.note), cx, cy + 3.5, { size: 9.5, color: v.held ? TEXT.warm : TEXT.accent, mono: true });
            } else g.text("·", cx + 8, cy + 3.5, { size: 9.5, color: TEXT.dim, mono: true });
          }
          break;
        }
        case "out": {
          const on = lv.out;
          head(b, "EFFECTS → OUT", "", on);
          const fx = host.fx;
          const items: [string, number][] = [
            ["chorus", fx.chorus],
            ["delay", fx.delay],
            ["reverb", fx.reverb],
          ];
          const rh = (b.h - 30) / 3;
          items.forEach(([name, w], i) => {
            const y = b.y + 6 + i * rh + rh / 2;
            g.text(name, b.x + 6, y + 3.5, { size: 9.5, color: w > 0.005 ? TEXT.mid : TEXT.dim, mono: true });
            const bx = b.x + 56;
            const bw = b.w - 66;
            g.rect(bx, y - 2, bw, 4, C.dim, 1, C.dim, 1);
            if (w > 0.005) g.rect(bx, y - 2, bw * w, 4, COL.mod, 0.9, COL.mod, 0.9);
          });
          // level meter, in dB
          const pk = tele ? absPeak(scopes?.[2]) : 0;
          const d = pk > 0 ? db(pk) : -90;
          const mt = clamp((d + 48) / 48, 0, 1);
          const my = b.y + b.h - 14;
          g.rect(b.x + 6, my, b.w - 12, 5, C.dim, 1, C.dim, 1);
          if (mt > 0) {
            const mc = heatRgb(0.35 + 0.6 * mt);
            g.rect(b.x + 6, my, (b.w - 12) * mt, 5, [mc[0] / 200, mc[1] / 200, mc[2] / 200], 1, [mc[0] / 200, mc[1] / 200, mc[2] / 200], 1);
          }
          const lim = tele && tele.limit < 0.999 ? ` · limiting ${db(tele.limit).toFixed(1)} dB` : "";
          g.text(pk > 0 ? `peak ${d.toFixed(0)} dBFS${lim}` : "level", b.x + b.w - 6, my - 4, { size: 9, align: "right", color: TEXT.dim, mono: true });
          break;
        }
        case "op1":
        case "op2":
        case "op3":
        case "op4":
          opNode(b, Number(id.slice(2)) - 1);
          break;
        case "exc": {
          const on = clamp(1 - (now - lastPluck) / 400, 0, 1);
          head(b, "EXCITATION", "noise burst", on);
          const inner: Box = { x: b.x + 6, y: b.y + 6, w: b.w - 12, h: b.h - 24 };
          const mid = inner.y + inner.h / 2;
          const pts: number[] = [];
          let lp = 0;
          let s = 1234567;
          for (let i = 0; i <= 70; i++) {
            s = (s * 16807) % 2147483647;
            const x = (s / 2147483647) < 0.5 ? -1 : 1;
            lp += (x - lp) * p.ks.bright;
            pts.push(inner.x + (i / 70) * inner.w, mid - lp * inner.h * 0.36);
          }
          g.line(pts, 1.2, on > 0.05 ? COL.warm : COL.audio, 0.5 + 0.5 * on);
          g.text(`pluck ${p.ks.bright.toFixed(2)} · pick ${Math.round(p.ks.pick * 100)}%`, b.x + 6, b.y + b.h - 6, { size: 9.5, color: TEXT.dim, mono: true });
          break;
        }
        case "delay": {
          const tk = tele?.ks;
          const on = tk && voices.length ? clamp(lv.out * 1.5, 0.2, 1) : 0;
          const n = tk ? tk.data.length : 0;
          head(b, "DELAY LINE", tk && voices.length ? `${tk.N} samples` : "", on);
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const R0 = Math.min(b.w, b.h) * 0.34;
          const ring: number[] = [];
          const cols: number[] = [];
          const M = tk && voices.length ? n : 96;
          let pk = 0;
          if (tk && voices.length) for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(tk.data[i]));
          const sc = pk > 0 ? 0.9 / Math.max(pk, 0.3) : 0;
          for (let i = 0; i < M; i++) {
            const a = -Math.PI / 2 - (i / M) * TAU;
            const val = tk && voices.length ? tk.data[i] * sc : 0;
            const r = R0 + clamp(val, -1.4, 1.4) * R0 * 0.32;
            ring.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            const m = Math.min(1, Math.abs(val));
            const c = ramp(0.15 + 0.85 * m);
            cols.push(c[0] * (0.5 + m), c[1] * (0.5 + m), c[2] * (0.5 + m), 1);
          }
          if (on > 0) g.glowLine(ring, 1.5, [1, 1, 1], 1, 0.4, { closed: true, colors: cols });
          else g.line(ring, 1.2, COL.frame, 0.9, { closed: true });
          g.dot(cx, cy - R0, 3, [1.6, 1, 0.5], 1);
          if (tk && voices.length) {
            g.text(noteName(tk.note), cx, cy + 3, { size: 13, align: "center", color: TEXT.hi, weight: 600 });
            g.text(fmtHz(midiHz(tk.note)), cx, cy + 17, { size: 9.5, align: "center", color: TEXT.dim, mono: true });
          } else g.text("one period long", cx, cy + 4, { size: 9.5, align: "center", color: TEXT.dim });
          break;
        }
        case "loop": {
          head(b, "LOOP FILTER", "average", lv.out);
          const inner: Box = { x: b.x + 6, y: b.y + 6, w: b.w - 12, h: b.h - 24 };
          const w = 1 / (2 * Math.max(1, p.ks.stretch));
          // |(1−w) + w·e^{−jω}| across the band, the loss per trip
          const pts: number[] = [];
          for (let i = 0; i <= 60; i++) {
            const om = (i / 60) * Math.PI;
            const m = Math.hypot(1 - w + w * Math.cos(om), w * Math.sin(om));
            pts.push(inner.x + (i / 60) * inner.w, inner.y + inner.h * (1 - m) * 0.9 + 2);
          }
          g.glowLine(pts, 1.5, COL.warm, 0.8, 0.3);
          g.text(`S ${p.ks.stretch.toFixed(1)} · decay ${p.ks.decay >= 30 ? "natural" : `${p.ks.decay} s`}`, b.x + 6, b.y + b.h - 6, { size: 9.5, color: TEXT.dim, mono: true });
          break;
        }
      }
    }
  });
}

function absPeak(x: Float32Array | undefined): number {
  if (!x) return 0;
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}
