// Fig. 1 — the oscillator. Pick a shape and see two cycles of it next to its
// harmonic recipe. The bars are the Fourier series of the ideal shape; while
// a note sounds, white dots measure the same harmonics from the speaker
// signal, and the live waveform is traced over the ideal one.

import type { Demo } from "../../../lib/demoShell";
import { makeFigure, runFigure, choice, C, ramp, TEXT } from "./figure";
import { panel, hline, dbY, dashed, type Box } from "./plot";
import { harmonicAmp, oscNaive, midiHz, noteName, fmtHz, alignPeriods, shapePhase, binDb, db } from "./dsp";

const SHAPES: [number, string][] = [
  [0, "sine"],
  [1, "triangle"],
  [3, "square"],
  [2, "saw"],
  [4, "pulse"],
];
const DESCR: Record<number, string> = {
  0: "sine: one harmonic, nothing else",
  1: "triangle: odd harmonics at 1/n², −12 dB per octave",
  3: "square: odd harmonics at 1/n, −6 dB per octave",
  2: "saw: every harmonic at 1/n, −6 dB per octave",
  4: "pulse: harmonics at |sin(πnd)|/n, so every 1/d-th one is missing",
};
const NH = 24;

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}
const LO_DB = -48;

export async function mountOsc(container: HTMLElement): Promise<Demo> {
  const narrow = (container.clientWidth || 700) < 560;
  let shape = 2; // UI shape id (4 = pulse)
  let pw = 0.25;
  const engineWave = (): number => (shape === 4 ? 3 : shape);
  const enginePw = (): number => (shape === 4 ? pw : 0.5);

  const fig = await makeFigure(container, {
    aspect: narrow ? 1.0 : 0.5,
    patch: {
      mode: 0,
      poly: 6,
      o1: { wave: 2, pw: 0.5, lvl: 1 },
      o2: { lvl: 0 },
      flt: { on: 0 },
      e1: { a: 0.006, d: 0.2, s: 1, r: 0.25 },
      velAmt: 0.3,
      gain: 0.8,
    },
    host: { fft: 8192, smoothing: 0.3 },
    base: 48,
    demo: (f) => f.tap(57, 0.9),
  });
  const { glow: g, host, shell } = fig;

  const apply = (): void => host.set({ o1: { wave: engineWave(), pw: enginePw() } });
  choice(shell, SHAPES, shape, (v) => {
    shape = v;
    apply();
    pwInput.parentElement!.style.opacity = shape === 4 ? "1" : "0.4";
  });
  const pwInput = shell.slider({
    label: "pulse width",
    min: 0.05,
    max: 0.5,
    step: 0.01,
    value: pw,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      pw = v;
      apply();
    },
  });
  pwInput.parentElement!.style.opacity = "0.4";

  // where the window starts in the cycle, chosen so no jump sits on an edge
  const offset = (): number => (shape === 2 ? -0.5 : shape === 1 ? -0.25 : shape === 3 || shape === 4 ? -enginePw() / 2 - 0.25 : 0);
  const ideal = (u: number): number => {
    const t = u + offset();
    return oscNaive(engineWave(), t - Math.floor(t), enginePw());
  };
  const live = new Float32Array(400);
  const timeBuf = new Float32Array(4096);
  const freqBuf = new Float32Array(4096);

  shell.setInfo(() => {
    const v = host.voices()[0];
    const f = v ? midiHz(v.note) : 220;
    return `${DESCR[shape]} · ${v ? noteName(v.note) : "A3"} ${fmtHz(f)}`;
  });

  return runFigure(fig, () => {
    const W = g.w;
    const H = g.h;
    const pad = 22;
    const waveBox: Box = narrow
      ? { x: pad, y: 30, w: W - pad * 2, h: H * 0.38 }
      : { x: pad, y: 34, w: W * 0.4, h: H - 34 - 40 };
    const barBox: Box = narrow
      ? { x: pad + 18, y: H * 0.38 + 72, w: W - pad * 2 - 18, h: H - (H * 0.38 + 72) - 30 }
      : { x: W * 0.4 + pad * 3, y: 34, w: W - (W * 0.4 + pad * 3) - pad, h: H - 34 - 40 };

    const voices = host.voices();
    const v = voices[0];
    const f0 = v ? midiHz(v.note) : 220;
    const sounding = !!v && host.live;

    // ---- waveform panel ----
    panel(g, waveBox, "waveform · 2 cycles", sounding ? "live trace" : "");
    const mid = waveBox.y + waveBox.h / 2;
    hline(g, waveBox, mid, 0.7);
    for (let c = 1; c < 2; c++) {
      const x = waveBox.x + (c / 2) * waveBox.w;
      g.seg(x, waveBox.y + 6, x, waveBox.y + waveBox.h - 6, 1, C.grid, 0.4);
    }
    const amp = waveBox.h * 0.36;
    const N = 360;
    const pts: number[] = [];
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * 2;
      pts.push(waveBox.x + (i / N) * waveBox.w, mid - ideal(u) * amp);
    }
    g.area(pts, mid, C.blue, 0.16, C.blue, 0.0);
    g.glowLine(pts, 2, [0.55, 0.7, 1.25], 1, 0.4);

    if (sounding && host.timeData(timeBuf)) {
      const ref = shapePhase(ideal);
      if (alignPeriods(timeBuf, host.sampleRate, f0, 2, ref, live)) {
        // scale the live trace to the ideal one's height (the engine's level
        // depends on velocity and the envelope)
        let peak = 1e-6;
        for (const s of live) peak = Math.max(peak, Math.abs(s));
        let ip = 0;
        for (let i = 0; i <= 64; i++) ip = Math.max(ip, Math.abs(ideal(i / 64)));
        const k = peak > 0.003 ? ip / peak : 0;
        const lp: number[] = [];
        for (let i = 0; i < live.length; i++) lp.push(waveBox.x + (i / (live.length - 1)) * waveBox.w, mid - live[i] * k * amp);
        if (k > 0) g.glowLine(lp, 1.3, [1.3, 0.75, 0.3], 0.95, 0.3);
      }
    }

    // ---- harmonic bars ----
    panel(g, barBox, "harmonics", "dB re fundamental");
    for (const d of [0, -12, -24, -36, -48]) {
      const y = dbY(barBox, d, LO_DB, 0);
      hline(g, barBox, y, d === 0 ? 0.6 : 0.35);
      g.text(`${d}`, barBox.x - 6, y + 3.5, { size: 9.5, align: "right", color: TEXT.dim, mono: true });
    }
    const a1 = harmonicAmp(engineWave(), 1, enginePw()) || 1;
    const slot = barBox.w / NH;
    const base = barBox.y + barBox.h;
    for (let n = 1; n <= NH; n++) {
      const a = harmonicAmp(engineWave(), n, enginePw()) / a1;
      const x = barBox.x + (n - 0.5) * slot;
      const col = ramp((n - 1) / (NH - 1));
      if (a > 1e-4) {
        const y = dbY(barBox, db(a), LO_DB, 0);
        const bright: [number, number, number] = [col[0] * 1.25, col[1] * 1.25, col[2] * 1.25];
        g.rect(x - slot * 0.22, y, slot * 0.44, base - y, bright, 0.55, col, 0.08);
        g.glowLine([x - slot * 0.22, y, x + slot * 0.22, y], 2, bright, 1, 0.5);
      } else {
        // a harmonic the shape doesn't have
        g.dot(x, base - 3, 2.2, C.grid, 0.9);
      }
      if (n <= 10 || n % 2 === 0 || slot > 26) g.text(`${n}`, x, base + 13, { size: 9.5, align: "center", color: TEXT.dim, mono: true });
    }
    // rolloff guide
    if (shape !== 0) {
      const guide: number[] = [];
      for (let i = 0; i <= 60; i++) {
        const n = 1 + (i / 60) * (NH - 1);
        // the pulse's harmonics follow 1/(n·sin πd) relative to the fundamental
        const d =
          shape === 1 ? -40 * Math.log10(n) : -20 * Math.log10(n) - (shape === 4 ? 20 * Math.log10(Math.sin(Math.PI * pw)) : 0);
        if (d < LO_DB) break;
        if (d > 0) continue;
        guide.push(barBox.x + (n - 0.5) * slot, dbY(barBox, d, LO_DB, 0));
      }
      if (guide.length >= 4) {
        dashed(g, guide, 1.2, C.gold, 0.55);
        const label = shape === 1 ? "1/n²" : "1/n";
        const gx = guide[guide.length - 2];
        const gy = guide[guide.length - 1];
        g.text(label, Math.min(gx + 6, barBox.x + barBox.w - 20), gy - 6, { size: 10.5, color: TEXT.warm, mono: true });
      }
    }

    // measured harmonics from the speaker signal
    if (sounding && voices.length === 1 && host.freqData(freqBuf)) {
      const binHz = host.sampleRate / 8192;
      const ref = binDb(freqBuf, f0, binHz);
      if (ref > -90) {
        for (let n = 1; n <= NH; n++) {
          const f = n * f0;
          if (f > host.sampleRate / 2 - 200) break;
          const d = binDb(freqBuf, f, binHz) - ref;
          if (d < LO_DB) continue;
          const x = barBox.x + (n - 0.5) * slot;
          g.dot(x, dbY(barBox, d, LO_DB, 0), 3, C.white, 0.95);
        }
        g.text("● measured", barBox.x + barBox.w - 4, barBox.y + 14, { size: 10, align: "right", color: TEXT.mid });
      }
    }
    if (shape === 4) {
      const every = 1 / pw;
      const near = Math.abs(every - Math.round(every)) < 0.02;
      g.text(
        near ? `d = ${Math.round(pw * 100)}%: every ${ordinal(Math.round(every))} harmonic is missing` : `d = ${Math.round(pw * 100)}%`,
        barBox.x + barBox.w * 0.22,
        barBox.y + 14,
        { size: 10.5, color: TEXT.warm },
      );
    }
  });
}
