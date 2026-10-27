// Fig. — envelopes. Two ADSR curves you can drag: one shapes the volume, one
// pushes the filter's cutoff up and back down. While a key is held, a dot per
// voice rides each curve at the level the engine reports, and the strip at
// the bottom draws the output's loudness over the last few seconds, tinted by
// how open the filter is.

import type { Demo } from "../../../lib/demoShell";
import { makeFigure, runFigure, drag, choice, syncSlider, C, TEXT } from "./figure";
import { panel, type Box } from "./plot";
import { attackLevel, decayLevel, releaseLevel, fmtTime, fmtHz, clamp, type Adsr } from "./dsp";
import { STAGE, type EnvSpec } from "./engine";

const TMAX = { a: 4, d: 4, r: 6 };

interface Preset {
  name: string;
  e1: EnvSpec;
  e2: EnvSpec;
  amt: number;
  cut: number;
}
const PRESETS: Preset[] = [
  { name: "pluck", e1: { a: 0.002, d: 0.6, s: 0, r: 0.3 }, e2: { a: 0.001, d: 0.3, s: 0, r: 0.2 }, amt: 4, cut: 180 },
  { name: "brass", e1: { a: 0.06, d: 0.4, s: 0.75, r: 0.2 }, e2: { a: 0.09, d: 0.6, s: 0.45, r: 0.2 }, amt: 3, cut: 320 },
  { name: "pad", e1: { a: 1.2, d: 1.0, s: 0.8, r: 2.5 }, e2: { a: 1.6, d: 2.0, s: 0.5, r: 2.0 }, amt: 2, cut: 300 },
  { name: "organ", e1: { a: 0.005, d: 0.05, s: 1, r: 0.03 }, e2: { a: 0.005, d: 0.05, s: 1, r: 0.03 }, amt: 0, cut: 3000 },
  { name: "swell", e1: { a: 2.0, d: 0.5, s: 1, r: 1.5 }, e2: { a: 2.5, d: 1.0, s: 1, r: 1.5 }, amt: 3.5, cut: 160 },
];

type Key = "e1" | "e2";
type HandleId = "a" | "d" | "r";

export async function mountEnv(container: HTMLElement): Promise<Demo> {
  const narrow = (container.clientWidth || 700) < 560;
  const p0 = PRESETS[1];
  const env: Record<Key, Adsr> = { e1: { ...p0.e1 }, e2: { ...p0.e2 } };
  let amt = p0.amt;
  let cut = p0.cut;

  const fig = await makeFigure(container, {
    aspect: narrow ? 1.15 : 0.62,
    patch: {
      mode: 0,
      poly: 6,
      o1: { wave: 2, lvl: 0.8 },
      o2: { wave: 2, lvl: 0.6, det: 9 },
      flt: { on: 1, cut, res: 1.4, poles: 4, env: amt, key: 0.3 },
      e1: env.e1,
      e2: env.e2,
      velAmt: 0.3,
      gain: 0.8,
    },
    host: { fft: 2048, smoothing: 0 },
    base: 48,
    grabby: true,
    demo: (f) => f.tap(52, 1.4),
  });
  const { glow: g, host, shell } = fig;
  const apply = (): void => host.set({ e1: env.e1, e2: env.e2, flt: { env: amt, cut } });

  const presetPick = choice(
    shell,
    PRESETS.map((p, i) => [i, p.name] as [number, string]),
    1,
    (i) => {
      const p = PRESETS[i];
      env.e1 = { ...p.e1 };
      env.e2 = { ...p.e2 };
      amt = p.amt;
      cut = p.cut;
      syncSlider(amtIn, amt, false, fmtAmt);
      syncSlider(cutIn, cut, true, fmtHz);
      apply();
    },
  );
  const fmtAmt = (v: number): string => `+${v.toFixed(1)} oct`;
  const cutIn = shell.slider({ label: "filter cutoff", min: 60, max: 8000, step: 1, value: cut, log: true, format: fmtHz, onInput: (v) => ((cut = v), apply(), presetPick.set(-1)) });
  const amtIn = shell.slider({ label: "envelope → cutoff", min: 0, max: 6, step: 0.1, value: amt, format: fmtAmt, onInput: (v) => ((amt = v), apply(), presetPick.set(-1)) });

  // ---- layout ----
  interface Geo {
    box: Box;
    x0: number;
    Z: number;
    Zs: number;
  }
  const geo = (k: Key): Geo => {
    const W = g.w;
    const H = g.h;
    const top = 24;
    const strip = H * (narrow ? 0.16 : 0.18);
    const gap = 30;
    const eh = (H - top - strip - gap * 2 - 8) / 2;
    const y = k === "e1" ? top : top + eh + gap;
    const box = { x: 40, y, w: W - 40 - 16, h: eh };
    const Zs = box.w * 0.14;
    const Z = (box.w - Zs - 8) / 3;
    return { box, x0: box.x + 4, Z, Zs };
  };
  const stripBox = (): Box => {
    const W = g.w;
    const H = g.h;
    const strip = H * (narrow ? 0.16 : 0.18);
    return { x: 40, y: H - strip - 8, w: W - 40 - 16, h: strip };
  };
  const xs = (k: Key): { xa: number; xd: number; xs: number; xr: number } => {
    const G = geo(k);
    const e = env[k];
    const xa = G.x0 + G.Z * Math.sqrt(e.a / TMAX.a);
    const xd = xa + G.Z * Math.sqrt(e.d / TMAX.d);
    const xS = xd + G.Zs;
    const xr = xS + G.Z * Math.sqrt(e.r / TMAX.r);
    return { xa, xd, xs: xS, xr };
  };
  const ly = (G: Geo, level: number): number => G.box.y + G.box.h - 6 - level * (G.box.h - 14);

  // ---- dragging ----
  let grab: { k: Key; h: HandleId } | null = null;
  drag(fig, {
    down(x, y) {
      let best: { k: Key; h: HandleId } | null = null;
      let bd = 30;
      for (const k of ["e1", "e2"] as Key[]) {
        const G = geo(k);
        const X = xs(k);
        const e = env[k];
        const hs: [HandleId, number, number][] = [
          ["a", X.xa, ly(G, 1)],
          ["d", X.xd, ly(G, e.s)],
          ["r", X.xr, ly(G, 0)],
        ];
        for (const [h, hx, hy] of hs) {
          const d = Math.hypot(x - hx, y - hy);
          if (d < bd) {
            bd = d;
            best = { k, h };
          }
        }
      }
      grab = best;
      if (!grab) return false;
    },
    move(x, y, _e, dragging) {
      if (!dragging || !grab) return;
      const G = geo(grab.k);
      const X = xs(grab.k);
      const e = env[grab.k];
      const frac = (from: number): number => clamp((x - from) / G.Z, 0, 1);
      if (grab.h === "a") e.a = Math.max(0.001, TMAX.a * frac(G.x0) ** 2);
      if (grab.h === "d") {
        e.d = Math.max(0.01, TMAX.d * frac(X.xa) ** 2);
        e.s = clamp((G.box.y + G.box.h - 6 - y) / (G.box.h - 14), 0, 1);
      }
      if (grab.h === "r") e.r = Math.max(0.01, TMAX.r * frac(X.xs) ** 2);
      presetPick.set(-1);
      apply();
    },
    up() {
      grab = null;
    },
  });

  // ---- output history ----
  const HIST = 300;
  const peaks = new Float32Array(HIST);
  const cuts = new Float32Array(HIST);
  let hHead = 0;
  let acc = 0;
  let lastT = performance.now();
  const tbuf = new Float32Array(2048);

  shell.setInfo(() => {
    const a = env.e1;
    return `volume: A ${fmtTime(a.a)} · D ${fmtTime(a.d)} · S ${Math.round(a.s * 100)}% · R ${fmtTime(a.r)}`;
  });

  return runFigure(fig, () => {
    const now = performance.now();
    const voices = host.live ? host.voices() : [];

    for (const k of ["e1", "e2"] as Key[]) {
      const G = geo(k);
      const X = xs(k);
      const e = env[k];
      const isAmp = k === "e1";
      const col = isAmp ? ([0.45, 0.65, 1.3] as const) : ([1.3, 0.75, 0.3] as const);
      panel(g, G.box, isAmp ? "volume envelope" : "filter envelope", isAmp ? "" : `cutoff ${fmtHz(cut)} → ${fmtHz(cut * 2 ** amt)}`);
      // level grid
      for (const lv of [0, 0.5, 1]) g.seg(G.box.x, ly(G, lv), G.box.x + G.box.w, ly(G, lv), 1, C.grid, lv === 0 ? 0.7 : 0.3);
      // the curve, each segment in its own linear time
      const pts: number[] = [];
      const seg = (xa: number, xb: number, f: (t: number) => number, T: number, n = 40): void => {
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * T;
          pts.push(xa + (xb - xa) * (i / n), ly(G, f(t)));
        }
      };
      pts.push(G.x0, ly(G, 0));
      seg(G.x0, X.xa, (t) => attackLevel(t, e.a), e.a);
      seg(X.xa, X.xd, (t) => decayLevel(t, e.d, e.s), e.d);
      pts.push(X.xs, ly(G, e.s));
      seg(X.xs, X.xr, (t) => releaseLevel(t, e.r, e.s), e.r);
      g.area(pts, ly(G, 0), [col[0] * 0.5, col[1] * 0.5, col[2] * 0.5], 0.28, col, 0.02);
      g.glowLine(pts, 2, col, 1, 0.4);
      // segment labels
      const lab = (txt: string, x: number): void => g.text(txt, x, G.box.y + G.box.h + 13, { size: 9.5, align: "center", color: TEXT.dim, mono: true });
      lab(`A ${fmtTime(e.a)}`, Math.max((G.x0 + X.xa) / 2, G.x0 + 24));
      lab(`D ${fmtTime(e.d)}`, Math.max((X.xa + X.xd) / 2, X.xa + 30));
      lab(`S ${Math.round(e.s * 100)}%`, (X.xd + X.xs) / 2);
      lab(`R ${fmtTime(e.r)}`, Math.max((X.xs + X.xr) / 2, X.xs + 28));
      g.text("key down", G.x0, G.box.y + 12, { size: 9.5, color: TEXT.dim });
      g.text("key up", X.xs + 3, G.box.y + 12, { size: 9.5, color: TEXT.dim });
      g.seg(X.xs, G.box.y + 4, X.xs, G.box.y + G.box.h, 1, C.grid, 0.6);
      // handles
      for (const [hx, hy] of [
        [X.xa, ly(G, 1)],
        [X.xd, ly(G, e.s)],
        [X.xr, ly(G, 0)],
      ]) {
        const active = grab && grab.k === k;
        g.dot(hx, hy, 9, col, active ? 0.5 : 0.25, true);
        g.dot(hx, hy, 4.5, [col[0] * 1.2, col[1] * 1.2, col[2] * 1.2], 1);
        g.dot(hx, hy, 2, [0.05, 0.05, 0.08], 1);
      }
      // voices riding the curve
      for (const v of voices) {
        const st = isAmp ? v.s1 : v.s2;
        const t = isAmp ? v.t1 : v.t2;
        const lvl = isAmp ? v.e1 : v.e2;
        let x: number;
        if (st === STAGE.attack) x = G.x0 + (X.xa - G.x0) * clamp(t / e.a, 0, 1);
        else if (st === STAGE.decay) x = X.xa + (X.xd - X.xa) * clamp(t / e.d, 0, 1);
        else if (st === STAGE.sustain) x = X.xd + (X.xs - X.xd) * (1 - Math.exp(-t / 0.8)) * 0.92;
        else if (st === STAGE.release) x = X.xs + (X.xr - X.xs) * clamp(t / e.r, 0, 1);
        else continue;
        const y = ly(G, lvl);
        g.dot(x, y, 14, [1.4, 1.4, 1.5], 0.3, true);
        g.dot(x, y, 4, [1.8, 1.8, 1.9], 1);
      }
    }

    // ---- output strip ----
    const sb = stripBox();
    const dt = (now - lastT) / 1000;
    lastT = now;
    acc += dt;
    const stepSec = 3.2 / HIST;
    if (acc >= stepSec) {
      let pk = 0;
      if (host.live && host.timeData(tbuf)) {
        const n = Math.min(tbuf.length, Math.ceil(host.sampleRate * Math.max(acc, stepSec)));
        for (let i = tbuf.length - n; i < tbuf.length; i++) pk = Math.max(pk, Math.abs(tbuf[i]));
      }
      const c = voices[0]?.cut ?? 0;
      while (acc >= stepSec) {
        acc -= stepSec;
        hHead = (hHead + 1) % HIST;
        peaks[hHead] = pk;
        cuts[hHead] = c;
      }
    }
    panel(g, sb, "output · last 3 s");
    const mid = sb.y + sb.h / 2;
    g.seg(sb.x, mid, sb.x + sb.w, mid, 1, C.grid, 0.5);
    const bw = sb.w / HIST;
    let maxPk = 0.05;
    for (let i = 0; i < HIST; i++) maxPk = Math.max(maxPk, peaks[i]);
    for (let i = 0; i < HIST; i++) {
      const idx = (hHead + 1 + i) % HIST;
      const p = peaks[idx] / maxPk;
      if (p < 0.004) continue;
      const bright = clamp(Math.log2(Math.max(cuts[idx], 50) / 50) / 7.5, 0, 1);
      const c = [0.35 + 1.0 * bright, 0.45 + 0.45 * bright, 1.1 - 0.7 * bright] as const;
      const hh = p * (sb.h / 2 - 3);
      g.rect(sb.x + i * bw, mid - hh, Math.max(bw, 1), hh * 2, c, 0.9, c, 0.9);
    }
    g.text("tint = how open the filter is", sb.x + sb.w - 4, sb.y - 8, { size: 9.5, align: "right", color: TEXT.dim });
  });
}
