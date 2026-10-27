// Fig. — FM. Two sine operators: a modulator pushing the phase of a carrier.
// Left: the line spectrum, worked out exactly from Bessel functions
// (sidebands at fc ± n·fm, each J_n(I) tall, negative frequencies folded
// back), and the waveform. Right: J₀…J₅ against the index, with the current
// index as a cursor you can drag. While a note sounds the cursor follows the
// modulator's envelope, so a bell's spectrum collapses as it rings.

import type { Demo } from "../../../lib/demoShell";
import { makeFigure, runFigure, drag, choice, syncSlider, C, TEXT } from "./figure";
import { panel, type Box } from "./plot";
import { besselJ, fmLines, midiHz, noteName, fmtHz, clamp, TAU } from "./dsp";
import type { OpSpec } from "./engine";

const I_MAX = 15; // the Bessel plot's range
const I_SLIDER = 25;
const NJ = 6;
const JCOL: [number, number, number][] = [
  [1.3, 1.05, 0.55],
  [0.45, 0.8, 1.35],
  [0.75, 0.55, 1.35],
  [1.25, 0.45, 0.75],
  [0.4, 1.2, 0.8],
  [1.2, 0.7, 0.35],
];

interface Preset {
  name: string;
  c: number;
  m: number;
  I: number;
  amp: Omit<OpSpec, "ratio" | "det" | "lvl">;
  idx: Omit<OpSpec, "ratio" | "det" | "lvl">;
  note: number;
}
// Chowning (1973), §"Simulations of instrument tones", in ratio form
const PRESETS: Preset[] = [
  { name: "bell", c: 1, m: 1.4, I: 10, amp: { a: 0.001, d: 9, s: 0, r: 2 }, idx: { a: 0.001, d: 9, s: 0, r: 2 }, note: 55 },
  { name: "brass", c: 1, m: 1, I: 5, amp: { a: 0.07, d: 0.3, s: 0.72, r: 0.15 }, idx: { a: 0.07, d: 0.3, s: 0.72, r: 0.15 }, note: 57 },
  { name: "clarinet", c: 3, m: 2, I: 4, amp: { a: 0.08, d: 0.1, s: 0.9, r: 0.12 }, idx: { a: 0.0005, d: 0.12, s: 0.5, r: 0.12 }, note: 50 },
  { name: "bassoon", c: 5, m: 1, I: 1.5, amp: { a: 0.08, d: 0.1, s: 0.9, r: 0.12 }, idx: { a: 0.08, d: 0.1, s: 0.9, r: 0.12 }, note: 43 },
  { name: "wood drum", c: 1, m: 0.6875, I: 25, amp: { a: 0.0005, d: 0.25, s: 0, r: 0.08 }, idx: { a: 0.0005, d: 0.06, s: 0, r: 0.05 }, note: 40 },
];

export async function mountFm(container: HTMLElement): Promise<Demo> {
  const narrow = (container.clientWidth || 700) < 560;
  const p0 = PRESETS[0];
  let cR = p0.c;
  let mR = p0.m;
  let I = p0.I;
  let amp = { ...p0.amp };
  let idx = { ...p0.idx };

  const opsFor = (): Partial<OpSpec>[] => [
    { ratio: cR, det: 0, lvl: 0.9, ...amp },
    { ratio: mR, det: 0, lvl: I, ...idx },
  ];
  const fig = await makeFigure(container, {
    aspect: narrow ? 1.35 : 0.6,
    patch: {
      mode: 1,
      poly: 8,
      velAmt: 0.3,
      gain: 0.75,
      fm: { alg: 0, fb: 0, velIdx: 0, ops: opsFor() },
    },
    host: { fft: 8192, reverb: 0.15 },
    base: 48,
    grabby: true,
    demo: (f) => f.tap(p0.note, 1.5),
  });
  const { glow: g, host, shell } = fig;
  const apply = (): void => host.set({ fm: { ops: opsFor() } });

  const presetPick = choice(
    shell,
    PRESETS.map((p, i) => [i, p.name] as [number, string]),
    0,
    (i) => {
      const p = PRESETS[i];
      cR = p.c;
      mR = p.m;
      I = p.I;
      amp = { ...p.amp };
      idx = { ...p.idx };
      syncSlider(cIn, cR, false, fmtR);
      syncSlider(mIn, mR, false, fmtR);
      syncSlider(iIn, I, false, fmtI);
      apply();
      fig.tap(p.note, i === 0 ? 2.5 : 0.9);
    },
  );
  const custom = (): void => presetPick.set(-1);
  const fmtR = (v: number): string => `${v.toFixed(v % 1 === 0 ? 0 : 2)}×`;
  const fmtI = (v: number): string => v.toFixed(2);
  const cIn = shell.slider({ label: "carrier ratio", min: 0.5, max: 8, step: 0.5, value: cR, format: fmtR, onInput: (v) => ((cR = v), apply(), custom()) });
  const mIn = shell.slider({ label: "modulator ratio", min: 0.25, max: 12, step: 0.01, value: mR, format: fmtR, onInput: (v) => ((mR = v), apply(), custom()) });
  const iIn = shell.slider({ label: "index I", min: 0, max: I_SLIDER, step: 0.01, value: I, format: fmtI, onInput: (v) => ((I = v), apply(), custom()) });

  // drag on the Bessel plot sets the index
  let bBox: Box = { x: 0, y: 0, w: 1, h: 1 };
  drag(fig, {
    down(x, y) {
      if (x < bBox.x - 10 || x > bBox.x + bBox.w + 10 || y < bBox.y - 10 || y > bBox.y + bBox.h + 10) return false;
      setI(x);
    },
    move(x, _y, _e, dragging) {
      if (dragging) setI(x);
    },
  });
  function setI(x: number): void {
    I = clamp(((x - bBox.x) / bBox.w) * I_MAX, 0, I_MAX);
    syncSlider(iIn, I, false, fmtI);
    custom();
    apply();
  }

  let nowI = I;
  shell.setInfo(() => {
    const ratio = `c:m = ${fmtR(cR).replace("×", "")}:${fmtR(mR).replace("×", "")}`;
    const d = commonStep(cR, mR);
    const where = d === null ? "no common spacing: inharmonic" : d >= 1 ? `partials on multiples of ${d === 1 ? "f" : `${d}f`}` : `partials on multiples of f/${Math.round(1 / d)}`;
    return `${ratio} · index now ${nowI.toFixed(2)} · ${where}`;
  });

  return runFigure(fig, () => {
    const W = g.w;
    const H = g.h;
    const voices = host.live ? host.voices() : [];
    const v = voices[0];
    const note = v ? v.note : 57;
    const f0 = midiHz(note);
    // the index the modulator is producing right now
    nowI = v ? I * (v.ops[1] ?? 0) : I;
    const fc = f0 * cR;
    const fmod = f0 * mR;

    // ---- layout ----
    const spec: Box = narrow ? { x: 16, y: 26, w: W - 32, h: H * 0.3 } : { x: 18, y: 26, w: W * 0.55, h: H * 0.5 };
    const wave: Box = narrow
      ? { x: 16, y: spec.y + spec.h + 44, w: W - 32, h: H * 0.16 }
      : { x: 18, y: spec.y + spec.h + 46, w: spec.w, h: H - (spec.y + spec.h + 46) - 22 };
    bBox = narrow
      ? { x: 34, y: wave.y + wave.h + 40, w: W - 50, h: H - (wave.y + wave.h + 40) - 30 }
      : { x: spec.x + spec.w + 48, y: 26, w: W - (spec.x + spec.w + 48) - 18, h: H - 26 - 40 };

    // ---- line spectrum ----
    const maxH = 20; // axis in multiples of the note's frequency
    panel(g, spec, `spectrum · ${noteName(note)} ${fmtHz(f0)}`, "× note frequency");
    const base = spec.y + spec.h;
    for (let k = 1; k <= maxH; k++) {
      const x = spec.x + (k / maxH) * spec.w;
      g.seg(x, spec.y, x, base, 1, C.grid, k % 5 === 0 ? 0.5 : 0.2);
      if (k % (narrow ? 4 : 2) === 0 || k === 1) g.text(`${k}`, x, base + 13, { size: 9.5, align: "center", color: TEXT.dim, mono: true });
    }
    const lines = fmLines(fc, fmod, nowI, 40);
    for (const ln of lines) {
      const h = ln.f / f0;
      if (h > maxH) continue;
      const a = Math.abs(ln.amp);
      if (a < 0.004) continue;
      const x = spec.x + (h / maxH) * spec.w;
      const y = base - a * (spec.h - 12);
      const col: [number, number, number] = ln.reflected
        ? [1.3, 0.4, 0.7]
        : ln.n === 0
          ? [1.4, 1.1, 0.55]
          : ln.n > 0
            ? [0.45, 0.85, 1.4]
            : [0.75, 0.55, 1.4];
      g.seg(x, base, x, y, 2.4, col, 1);
      g.dot(x, y, 2.6, col, 1);
    }
    // legend
    const lx = spec.x + 8;
    const legend: [string, string][] = [
      ["carrier", "#ffd58f"],
      ["upper sidebands", "#8fc4ff"],
      ["lower", "#b49cff"],
      ["folded below 0 Hz", "#ff7fb6"],
    ];
    let lxx = lx;
    for (const [t, c] of legend) {
      g.text(t, lxx, spec.y + 14, { size: 9.5, color: c });
      lxx += g.textWidth(t, 9.5) + 12;
    }

    // ---- waveform ----
    panel(g, wave, "waveform", "");
    const wm = wave.y + wave.h / 2;
    g.seg(wave.x, wm, wave.x + wave.w, wm, 1, C.grid, 0.5);
    const span = 3 / f0;
    const pts: number[] = [];
    const mpts: number[] = [];
    const NW = 500;
    for (let i = 0; i <= NW; i++) {
      const t = (i / NW) * span;
      const m = nowI * Math.sin(TAU * fmod * t);
      pts.push(wave.x + (i / NW) * wave.w, wm - Math.sin(TAU * fc * t + m) * wave.h * 0.4);
      mpts.push(wave.x + (i / NW) * wave.w, wm - (m / Math.max(I_MAX, 1)) * wave.h * 0.4);
    }
    g.line(mpts, 1, [0.4, 1.0, 0.7], 0.5);
    g.glowLine(pts, 1.5, [0.55, 0.75, 1.3], 1, 0.3);
    g.text("modulator (scaled)", wave.x + wave.w - 4, wave.y + 13, { size: 9.5, align: "right", color: "rgba(120,230,170,0.7)" });

    // ---- Bessel functions ----
    panel(g, bBox, "Bessel functions Jₙ(I)", "");
    const jy = (j: number): number => bBox.y + bBox.h * (1 - (j + 0.45) / 1.5);
    const ix = (i: number): number => bBox.x + (i / I_MAX) * bBox.w;
    g.seg(bBox.x, jy(0), bBox.x + bBox.w, jy(0), 1, C.grid, 0.8);
    for (const j of [-0.4, 0.5, 1]) {
      g.seg(bBox.x, jy(j), bBox.x + bBox.w, jy(j), 1, C.grid, 0.25);
      g.text(`${j}`, bBox.x - 6, jy(j) + 3.5, { size: 9.5, align: "right", color: TEXT.dim, mono: true });
    }
    for (let i = 0; i <= I_MAX; i += narrow ? 5 : 3) {
      g.text(`${i}`, ix(i), bBox.y + bBox.h + 13, { size: 9.5, align: "center", color: TEXT.dim, mono: true });
    }
    g.text("index I →", bBox.x + bBox.w - 2, bBox.y + bBox.h + 27, { size: 9.5, align: "right", color: TEXT.dim });
    for (let n = 0; n < NJ; n++) {
      const cp: number[] = [];
      for (let i = 0; i <= 150; i++) {
        const xI = (i / 150) * I_MAX;
        cp.push(ix(xI), jy(besselJ(n, xI)));
      }
      g.line(cp, n === 0 ? 2 : 1.4, JCOL[n], n === 0 ? 1 : 0.85);
      // label near each curve's first peak
      const peakI = n === 0 ? 0.25 : n + 0.8;
      g.text(`J${n}`, ix(peakI) + 4, jy(besselJ(n, peakI)) - 6, { size: 10, color: rgbCss(JCOL[n]), weight: 600 });
    }
    // where the carrier vanishes
    const z = 2.4048;
    g.dot(ix(z), jy(0), 3, [1.3, 1.05, 0.55], 0.9);
    if (!narrow) g.text("J₀ = 0: no carrier", ix(z) + 6, jy(0) + 14, { size: 9.5, color: "#ffd58f" });
    // cursor: set index (faint) and the live one
    g.seg(ix(Math.min(I, I_MAX)), bBox.y, ix(Math.min(I, I_MAX)), bBox.y + bBox.h, 1, [0.6, 0.6, 0.8], 0.5);
    const cx = ix(Math.min(nowI, I_MAX));
    g.seg(cx, bBox.y, cx, bBox.y + bBox.h, 1.6, [1.2, 1.2, 1.3], 0.9);
    for (let n = 0; n < NJ; n++) {
      const yy = jy(besselJ(n, nowI));
      g.dot(cx, yy, 7, JCOL[n], 0.35, true);
      g.dot(cx, yy, 3, JCOL[n], 1);
    }
    g.text(`I = ${nowI.toFixed(2)}${nowI > I_MAX ? " →" : ""}`, Math.min(cx + 6, bBox.x + bBox.w - 64), bBox.y + 14, { size: 10.5, color: TEXT.hi, mono: true });
  });
}

function rgbCss(c: readonly [number, number, number]): string {
  const f = (v: number): number => Math.round(Math.min(1, v / 1.4) * 255);
  return `rgb(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
}

/**
 * Every partial sits at f·(c + n·m), so they all fall on multiples of
 * f·gcd(c, m) when c and m are rational. Returns that gcd (in units of f),
 * or null if there's no small common denominator.
 */
function commonStep(c: number, m: number): number | null {
  for (let den = 1; den <= 64; den++) {
    const a = c * den;
    const b = m * den;
    if (Math.abs(a - Math.round(a)) < 1e-6 && Math.abs(b - Math.round(b)) < 1e-6) {
      let x = Math.round(a);
      let y = Math.round(b);
      while (y) [x, y] = [y, x % y];
      return x / den;
    }
  }
  return null;
}
