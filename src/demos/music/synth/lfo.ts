// Fig. — the LFO. One slow wave on the left, patched into four destinations
// on the right: pitch, cutoff, volume and pulse width. Each lane draws the
// value its destination is actually getting. Push the rate past ~20 Hz with
// a deep pitch setting and the wobble turns into new partials: the small
// spectrum at the bottom shows them appear. That's FM, the next section.

import type { Demo } from "../../../lib/demoShell";
import { makeFigure, runFigure, choice, syncSlider, C, TEXT } from "./figure";
import { panel, type Box, freqGrid, fx } from "./plot";
import { midiHz, fmtHz, clamp, logF, binDb } from "./dsp";

const SHAPES: [number, string][] = [
  [0, "sine"],
  [1, "triangle"],
  [2, "saw"],
  [3, "square"],
  [4, "random"],
];

function lfoShape(w: number, ph: number): number {
  const p = ph - Math.floor(ph);
  switch (w) {
    case 0:
      return Math.sin(2 * Math.PI * p);
    case 1: {
      let q = p + 0.25;
      if (q >= 1) q -= 1;
      return 1 - 4 * Math.abs(q - 0.5);
    }
    case 2:
      return 2 * p - 1;
    case 3:
      return p < 0.5 ? 1 : -1;
    default:
      return 0;
  }
}

interface Preset {
  name: string;
  wave: number;
  rate: number;
  pitch: number;
  cut: number;
  amp: number;
  pw: number;
}
const PRESETS: Preset[] = [
  { name: "vibrato", wave: 0, rate: 5.5, pitch: 25, cut: 0, amp: 0, pw: 0 },
  { name: "wah", wave: 1, rate: 1.6, pitch: 0, cut: 2.2, amp: 0, pw: 0 },
  { name: "tremolo", wave: 0, rate: 6, pitch: 0, cut: 0, amp: 0.8, pw: 0 },
  { name: "PWM", wave: 1, rate: 0.7, pitch: 0, cut: 0, amp: 0, pw: 0.4 },
  { name: "random", wave: 4, rate: 7, pitch: 0, cut: 2.5, amp: 0, pw: 0 },
  { name: "audio rate", wave: 0, rate: 110, pitch: 900, cut: 0, amp: 0, pw: 0 },
];

export async function mountLfo(container: HTMLElement): Promise<Demo> {
  const narrow = (container.clientWidth || 700) < 560;
  const st = { ...PRESETS[0] };
  const baseCut = 1600;

  const fig = await makeFigure(container, {
    aspect: narrow ? 1.25 : 0.6,
    patch: {
      mode: 0,
      poly: 6,
      o1: { wave: 3, pw: 0.5, lvl: 1 },
      o2: { lvl: 0 },
      flt: { on: 1, cut: baseCut, res: 1.0, poles: 4, env: 0, key: 0.3 },
      e1: { a: 0.01, d: 0.3, s: 0.9, r: 0.4 },
      lfo: { wave: st.wave, rate: st.rate, pitch: st.pitch, cut: st.cut, amp: st.amp, pw: st.pw },
      velAmt: 0.3,
      gain: 0.75,
    },
    host: { fft: 8192, smoothing: 0.5 },
    base: 48,
    demo: (f) => f.tap(57, 2.2),
  });
  const { glow: g, host, shell } = fig;
  const apply = (): void => host.set({ lfo: { wave: st.wave, rate: st.rate, pitch: st.pitch, cut: st.cut, amp: st.amp, pw: st.pw } });

  const presetPick = choice(
    shell,
    PRESETS.map((p, i) => [i, p.name] as [number, string]),
    0,
    (i) => {
      Object.assign(st, PRESETS[i]);
      shapePick.set(st.wave);
      syncSlider(rateIn, st.rate, true, fmtRate);
      syncSlider(pitchIn, Math.max(st.pitch, 1), true, fmtCents);
      syncSlider(cutIn, st.cut, false, fmtOct);
      syncSlider(ampIn, st.amp, false, fmtPct);
      syncSlider(pwIn, st.pw, false, fmtPct);
      apply();
    },
  );
  const custom = (): void => presetPick.set(-1);
  const shapePick = choice(shell, SHAPES, st.wave, (w) => ((st.wave = w), apply(), custom()));
  const fmtRate = (v: number): string => (v < 10 ? `${v.toFixed(2)} Hz` : `${Math.round(v)} Hz`);
  const fmtCents = (v: number): string => (v <= 1 ? "off" : `±${Math.round(v)}¢`);
  const fmtOct = (v: number): string => (v <= 0 ? "off" : `±${v.toFixed(1)} oct`);
  const fmtPct = (v: number): string => (v <= 0 ? "off" : `${Math.round(v * 100)}%`);
  const rateIn = shell.slider({ label: "rate", min: 0.1, max: 400, step: 0.01, value: st.rate, log: true, format: fmtRate, onInput: (v) => ((st.rate = v), apply(), custom()) });
  const pitchIn = shell.slider({ label: "→ pitch", min: 1, max: 1200, step: 1, value: st.pitch, log: true, format: fmtCents, onInput: (v) => ((st.pitch = v <= 1 ? 0 : v), apply(), custom()) });
  const cutIn = shell.slider({ label: "→ cutoff", min: 0, max: 4, step: 0.1, value: st.cut, format: fmtOct, onInput: (v) => ((st.cut = v), apply(), custom()) });
  const ampIn = shell.slider({ label: "→ volume", min: 0, max: 1, step: 0.01, value: st.amp, format: fmtPct, onInput: (v) => ((st.amp = v), apply(), custom()) });
  const pwIn = shell.slider({ label: "→ pulse width", min: 0, max: 0.45, step: 0.01, value: st.pw, format: fmtPct, onInput: (v) => ((st.pw = v), apply(), custom()) });

  // LFO phase: anchored to the engine's telemetry when it's running
  let localPh = 0;
  let lastT = performance.now();
  const shHist: { t: number; v: number }[] = [];
  let shVal = 0;
  let shLastCycle = -1;
  const phaseNow = (now: number): number => {
    const t = host.tele;
    if (host.live && t && now - t.at < 500) return t.lfoPh + (st.rate * (now - t.at)) / 1000;
    return localPh;
  };

  const fbuf = new Float32Array(4096);
  shell.setInfo(() => {
    const kind = st.rate < 15 ? "a slow wobble" : st.rate < 30 ? "on the edge of audio rate" : "audio rate: new partials, not a wobble";
    return `${SHAPES[st.wave][1]} LFO at ${fmtRate(st.rate)} · ${kind}`;
  });

  return runFigure(fig, () => {
    const now = performance.now();
    localPh += (st.rate * (now - lastT)) / 1000;
    lastT = now;
    const W = g.w;
    const H = g.h;
    const ph = phaseNow(now);
    // random (sample & hold): a new value each cycle, kept as a history
    const cyc = Math.floor(ph);
    if (st.wave === 4 && cyc !== shLastCycle) {
      shLastCycle = cyc;
      shVal = host.live && host.tele ? host.tele.lfo : Math.random() * 2 - 1;
      shHist.push({ t: now, v: shVal });
      while (shHist.length > 200) shHist.shift();
    }
    const windowSec = clamp(4 / st.rate, 0.03, 2.5);
    const valueAt = (tAgo: number): number => {
      if (st.wave !== 4) return lfoShape(st.wave, ph - tAgo * st.rate);
      const t = now - tAgo * 1000;
      for (let i = shHist.length - 1; i >= 0; i--) if (shHist[i].t <= t) return shHist[i].v;
      return 0;
    };

    // ---- layout ----
    const specH = H * (narrow ? 0.16 : 0.2);
    const lfoBox: Box = narrow ? { x: 16, y: 26, w: W - 32, h: H * 0.16 } : { x: 18, y: 26, w: W * 0.27, h: H - 26 - specH - 44 };
    const lanesX = narrow ? 16 : lfoBox.x + lfoBox.w + W * 0.09;
    const lanesTop = narrow ? lfoBox.y + lfoBox.h + 34 : 26;
    const lanesBottom = H - specH - 44;
    const laneGap = 26;
    const laneH = (lanesBottom - lanesTop - laneGap * 3) / 4;
    const laneW = W - lanesX - 18;

    // ---- the LFO itself ----
    panel(g, lfoBox, "LFO", windowSec >= 1 ? `last ${windowSec.toFixed(1)} s` : `last ${Math.round(windowSec * 1000)} ms`);
    const lmid = lfoBox.y + lfoBox.h / 2;
    g.seg(lfoBox.x, lmid, lfoBox.x + lfoBox.w, lmid, 1, C.grid, 0.6);
    const N = 220;
    const lp: number[] = [];
    for (let i = 0; i <= N; i++) {
      const tAgo = (1 - i / N) * windowSec;
      lp.push(lfoBox.x + (i / N) * lfoBox.w, lmid - valueAt(tAgo) * lfoBox.h * 0.38);
    }
    g.glowLine(lp, 2, [0.4, 1.1, 0.8], 1, 0.45);
    const nowV = valueAt(0);
    const ex = lfoBox.x + lfoBox.w;
    const ey = lmid - nowV * lfoBox.h * 0.38;
    g.dot(ex, ey, 12, [0.4, 1.2, 0.8], 0.4, true);
    g.dot(ex, ey, 4, [0.7, 1.6, 1.1], 1);

    // ---- lanes ----
    const lanes: { name: string; depth: number; on: boolean; val: (v: number) => number; label: (v: number) => string; lo: number; hi: number }[] = [
      { name: "pitch", depth: st.pitch, on: st.pitch > 0, val: (v) => v * st.pitch, label: (v) => `${v >= 0 ? "+" : ""}${Math.round(v)}¢`, lo: -Math.max(st.pitch, 50), hi: Math.max(st.pitch, 50) },
      {
        name: "cutoff",
        depth: st.cut,
        on: st.cut > 0,
        val: (v) => Math.log2((baseCut * Math.pow(2, v * st.cut)) / baseCut),
        label: (v) => fmtHz(baseCut * Math.pow(2, v)),
        lo: -Math.max(st.cut, 1),
        hi: Math.max(st.cut, 1),
      },
      { name: "volume", depth: st.amp, on: st.amp > 0, val: (v) => 1 - st.amp * (0.5 - 0.5 * v), label: (v) => `${Math.round(v * 100)}%`, lo: 0, hi: 1 },
      { name: "pulse width", depth: st.pw, on: st.pw > 0, val: (v) => clamp(0.5 + st.pw * v, 0.02, 0.98), label: (v) => `${Math.round(v * 100)}%`, lo: 0, hi: 1 },
    ];
    lanes.forEach((ln, li) => {
      const b: Box = { x: lanesX, y: lanesTop + li * (laneH + laneGap), w: laneW, h: laneH };
      panel(g, b, ln.name, "");
      const yOf = (v: number): number => b.y + b.h - 4 - ((v - ln.lo) / (ln.hi - ln.lo || 1)) * (b.h - 8);
      const pts: number[] = [];
      for (let i = 0; i <= N; i++) {
        const tAgo = (1 - i / N) * windowSec;
        pts.push(b.x + (i / N) * b.w, yOf(ln.val(valueAt(tAgo))));
      }
      const col = ln.on ? ([1.25, 0.72, 0.3] as const) : ([0.3, 0.33, 0.45] as const);
      if (ln.on) g.glowLine(pts, 1.6, col, 1, 0.35);
      else g.line(pts, 1, col, 0.8);
      const cur = ln.val(nowV);
      g.text(ln.label(cur), b.x + b.w - 4, b.y - 8, { size: 10, align: "right", color: ln.on ? TEXT.warm : TEXT.dim, mono: true });

      // the patch cable from the LFO
      if (!narrow) {
        const x0 = ex + 6;
        const y0 = lmid;
        const x1 = b.x - 4;
        const y1 = b.y + b.h / 2;
        const cable: number[] = [];
        for (let i = 0; i <= 30; i++) {
          const t = i / 30;
          const mx = x0 + (x1 - x0) * 0.5;
          const xb = (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * mx + 3 * (1 - t) * t * t * mx + t ** 3 * x1;
          const yb = (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * y0 + 3 * (1 - t) * t * t * y1 + t ** 3 * y1;
          cable.push(xb, yb);
        }
        if (ln.on) {
          g.glowLine(cable, 1.4, [0.4, 1.1, 0.8], 0.8, 0.3);
          // a pulse riding the cable at the LFO's rate (slowed for the eye)
          const k = Math.floor(((ph * Math.min(1, 2 / st.rate)) % 1) * 30);
          g.dot(cable[k * 2], cable[k * 2 + 1], 3, [0.7, 1.6, 1.1], 0.9);
        } else g.line(cable, 1, [0.2, 0.24, 0.32], 0.6);
        g.dot(x1, y1, 3, ln.on ? [0.7, 1.6, 1.1] : [0.25, 0.28, 0.36], 1);
      }
    });

    // ---- spectrum ----
    const sb: Box = { x: narrow ? 16 : 18, y: H - specH - 18, w: W - (narrow ? 32 : 36), h: specH };
    panel(g, sb, "spectrum", "");
    freqGrid(g, sb, 50, 8000, !narrow || true);
    const v = host.live ? host.voices()[0] : undefined;
    if (v && host.freqData(fbuf)) {
      const binHz = host.sampleRate / 8192;
      let ref = -200;
      for (let i = 0; i < fbuf.length; i++) ref = Math.max(ref, fbuf[i]);
      const pts: number[] = [];
      for (let i = 0; i <= 300; i++) {
        const f = logF(i / 300, 50, 8000);
        const d = binDb(fbuf, f, binHz, 1) - ref;
        pts.push(sb.x + (i / 300) * sb.w, sb.y + sb.h - clamp((d + 70) / 70, 0, 1) * (sb.h - 4));
      }
      g.area(pts, sb.y + sb.h, [0.4, 0.55, 1.1], 0.3, [0.4, 0.55, 1.1], 0.0);
      g.line(pts, 1.2, [0.6, 0.75, 1.3], 0.9);
      const x0 = fx(sb, midiHz(v.note), 50, 8000);
      g.seg(x0, sb.y, x0, sb.y + sb.h, 1, [1.2, 0.7, 0.3], 0.6);
    } else g.text("play a note to see its spectrum", sb.x + sb.w / 2, sb.y + sb.h / 2 + 4, { size: 10.5, align: "center", color: TEXT.dim });
  });
}
