// Fig. — subtractive synthesis. A saw (or square, or noise) through the
// engine's 4-pole ladder. The curve is the filter's exact small-signal
// response, the faint bars are the oscillator's harmonics going in, the bright
// bars are what comes out (input × response), and the thin white line is the
// live spectrum of what you're hearing. Drag the glowing handle: sideways
// moves the cutoff, up raises the resonance until the filter rings on its own.

import type { Demo } from "../../../lib/demoShell";
import { makeFigure, runFigure, drag, choice, syncSlider, C, ramp, TEXT } from "./figure";
import { panel, freqGrid, dbY, fx, type Box } from "./plot";
import { harmonicAmp, ladderMag, midiHz, noteName, fmtHz, db, logF, clamp, binDb } from "./dsp";

const FLO = 30;
const FHI = 20000;
const DB_LO = -60;
const DB_HI = 30;
const K_MAX = 4.4;

export async function mountFilter(container: HTMLElement): Promise<Demo> {
  const narrow = (container.clientWidth || 700) < 560;
  let src: "saw" | "square" | "noise" = "saw";
  let cut = 900;
  let res = 1.2;
  let poles = 4;

  const fig = await makeFigure(container, {
    aspect: narrow ? 0.95 : 0.54,
    patch: {
      mode: 0,
      poly: 6,
      o1: { wave: 2, lvl: 1 },
      o2: { lvl: 0 },
      noise: 0,
      flt: { on: 1, cut, res, poles, env: 0, key: 0 },
      e1: { a: 0.005, d: 0.2, s: 1, r: 0.3 },
      velAmt: 0.3,
      gain: 0.75,
    },
    host: { fft: 8192, smoothing: 0.6 },
    base: 36,
    grabby: true,
    demo: (f) => f.tap(45, 1.2),
  });
  const { glow: g, host, shell } = fig;
  const sr = (): number => (host.live ? host.sampleRate : 48000);

  const apply = (): void => {
    host.set({
      o1: { wave: src === "square" ? 3 : 2, pw: 0.5, lvl: src === "noise" ? 0 : 1 },
      noise: src === "noise" ? 0.7 : 0,
      flt: { cut, res, poles },
    });
  };
  choice(
    shell,
    [
      ["saw", "saw"],
      ["square", "square"],
      ["noise", "noise"],
    ],
    src,
    (v) => {
      src = v as typeof src;
      apply();
    },
  );
  choice(
    shell,
    [
      [1, "6 dB/oct"],
      [2, "12"],
      [3, "18"],
      [4, "24"],
    ],
    poles,
    (v) => {
      poles = v;
      apply();
    },
  );
  const fmtCut = (v: number): string => fmtHz(v);
  const cutIn = shell.slider({ label: "cutoff", min: 40, max: 16000, step: 1, value: cut, log: true, format: fmtCut, onInput: (v) => ((cut = v), apply()) });
  const fmtRes = (v: number): string => (v > 4 ? `${v.toFixed(2)} · rings` : v.toFixed(2));
  const resIn = shell.slider({ label: "resonance", min: 0, max: K_MAX, step: 0.01, value: res, format: fmtRes, onInput: (v) => ((res = v), apply()) });

  let box: Box = { x: 0, y: 0, w: 1, h: 1 };
  const respDb = (f: number): number => db(ladderMag(f, cut, res, poles, sr()));

  // dragging the handle
  let grabbing = false;
  drag(fig, {
    down(x, y) {
      const hx = fx(box, cut, FLO, FHI);
      const hy = dbY(box, clamp(respDb(cut), DB_LO, DB_HI), DB_LO, DB_HI);
      // grab the handle if close, otherwise jump it to the pointer
      grabbing = Math.hypot(x - hx, y - hy) < 60 || (x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h);
      if (!grabbing) return false;
      setFrom(x, y);
    },
    move(x, y, _e, dragging) {
      if (dragging && grabbing) setFrom(x, y);
    },
    up() {
      grabbing = false;
    },
  });
  function setFrom(x: number, y: number): void {
    cut = clamp(logF((x - box.x) / box.w, FLO, FHI), 40, 16000);
    // resonance: the k whose response at the cutoff reaches the pointer
    const want = DB_HI - ((y - box.y) / box.h) * (DB_HI - DB_LO);
    let lo = 0;
    let hi = K_MAX;
    if (db(ladderMag(cut, cut, K_MAX, poles, sr())) < want || want > DB_HI - 3) lo = hi = K_MAX;
    else
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (db(ladderMag(cut, cut, m, poles, sr())) < want) lo = m;
        else hi = m;
      }
    res = clamp((lo + hi) / 2, 0, K_MAX);
    syncSlider(cutIn, cut, true, fmtCut);
    syncSlider(resIn, res, false, fmtRes);
    apply();
  }

  const fbuf = new Float32Array(4096);
  let peakF = 0;
  let peakDb = 0;
  shell.setInfo(() => {
    const ring = res > 4 ? " · self-oscillating" : "";
    return `cutoff ${fmtHz(cut)} · resonance ${res.toFixed(2)} · peak ${peakDb >= 0 ? "+" : ""}${peakDb.toFixed(1)} dB at ${fmtHz(peakF)} · −${poles * 6} dB/oct${ring}`;
  });

  return runFigure(fig, () => {
    const W = g.w;
    const H = g.h;
    box = { x: 44, y: 26, w: W - 44 - 16, h: H - 26 - 34 };
    panel(g, box);
    freqGrid(g, box, FLO, FHI);
    for (let d = DB_LO; d <= DB_HI; d += 15) {
      const y = dbY(box, d, DB_LO, DB_HI);
      g.seg(box.x, y, box.x + box.w, y, 1, C.grid, d === 0 ? 0.8 : 0.3);
      g.text(`${d > 0 ? "+" : ""}${d}`, box.x - 6, y + 3.5, { size: 9.5, align: "right", color: TEXT.dim, mono: true });
    }
    g.text("dB", box.x - 6, box.y - 8, { size: 9.5, align: "right", color: TEXT.dim });

    const voices = host.voices();
    const v = voices[0];
    const note = v ? v.note : 45;
    const f0 = midiHz(note);
    const wave = src === "square" ? 3 : 2;
    const S = sr();

    // the response curve
    const N = 260;
    const curve: number[] = [];
    peakDb = -Infinity;
    for (let i = 0; i <= N; i++) {
      const f = logF(i / N, FLO, FHI);
      const d = respDb(f);
      if (d > peakDb) {
        peakDb = d;
        peakF = f;
      }
      curve.push(box.x + (i / N) * box.w, dbY(box, clamp(d, DB_LO - 5, DB_HI + 5), DB_LO, DB_HI));
    }
    g.area(curve, box.y + box.h, [0.9, 0.55, 0.2], 0.22, [0.9, 0.55, 0.2], 0.0);

    // harmonics in, harmonics out
    const base = box.y + box.h;
    if (src !== "noise") {
      const a1 = harmonicAmp(wave, 1);
      for (let n = 1; n * f0 < Math.min(FHI, S / 2); n++) {
        const f = n * f0;
        const a = harmonicAmp(wave, n) / a1;
        if (a < 1e-6) continue;
        const x = fx(box, f, FLO, FHI);
        const dIn = db(a);
        const dOut = dIn + respDb(f);
        const yIn = dbY(box, dIn, DB_LO, DB_HI);
        const yOut = dbY(box, dOut, DB_LO, DB_HI);
        const fade = clamp(1 - (n - 1) / 120, 0.25, 1);
        g.seg(x, base, x, yIn, 1, [0.3, 0.34, 0.5], 0.45 * fade);
        if (dOut > DB_LO) {
          const c = ramp(clamp(Math.log2(f / 30) / 9.4, 0, 1));
          g.seg(x, base, x, yOut, 2.2, [c[0] * 1.3, c[1] * 1.3, c[2] * 1.3], 0.9 * fade);
          g.dot(x, yOut, 2.2, [c[0] * 1.6, c[1] * 1.6, c[2] * 1.6], fade);
        }
      }
    } else {
      // white noise in: equal energy everywhere
      const y0 = dbY(box, 0, DB_LO, DB_HI);
      g.seg(box.x, y0, box.x + box.w, y0, 1.2, [0.4, 0.45, 0.65], 0.5);
      g.text("noise in (flat)", box.x + box.w - 6, y0 - 6, { size: 10, align: "right", color: TEXT.dim });
    }

    // the live spectrum, lined up with the drawing
    if (host.live && v && host.freqData(fbuf)) {
      const binHz = S / 8192;
      let off: number;
      if (src === "noise") {
        // line the measured noise up with the curve at the passband
        const ref = Math.min(cut * 0.25, 2000);
        off = respDb(ref) - binDb(fbuf, ref, binHz, 6);
      } else {
        off = respDb(f0) - binDb(fbuf, f0, binHz);
      }
      const lp: number[] = [];
      for (let i = 0; i <= 320; i++) {
        const f = logF(i / 320, FLO, FHI);
        const d = binDb(fbuf, f, binHz, 1) + off;
        lp.push(box.x + (i / 320) * box.w, dbY(box, clamp(d, DB_LO - 2, DB_HI + 2), DB_LO, DB_HI));
      }
      g.line(lp, 1, [0.85, 0.9, 1.1], 0.55);
    }

    g.glowLine(curve, 2.2, [1.35, 0.8, 0.3], 1, 0.45);

    // the handle
    const hx = fx(box, cut, FLO, FHI);
    const hy = dbY(box, clamp(respDb(cut), DB_LO, DB_HI), DB_LO, DB_HI);
    g.dot(hx, hy, 16, [1.2, 0.7, 0.3], 0.35, true);
    g.dot(hx, hy, 6.5, [1.6, 1.0, 0.5], 1);
    g.dot(hx, hy, 3, [0.08, 0.05, 0.02], 1);
    g.text(fmtHz(cut), hx, Math.max(box.y + 12, hy - 16), { size: 10.5, align: "center", color: TEXT.warm, mono: true, weight: 600 });
    if (res > 4) g.text("self-oscillating", hx + 14, Math.max(box.y + 26, hy - 2), { size: 10.5, color: "#ffb86b" });

    // what's playing
    const label = src === "noise" ? "white noise" : `${noteName(note)} ${src} · ${fmtHz(f0)}`;
    g.text(label, box.x + 8, box.y + 15, { size: 10.5, color: TEXT.mid });
    if (host.live && v) g.text("— live spectrum", box.x + 8, box.y + 29, { size: 10, color: "rgba(220,228,255,0.6)" });
  });
}
