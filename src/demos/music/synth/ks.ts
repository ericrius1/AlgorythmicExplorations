// Fig. — Karplus–Strong. The whole string is a delay line one period long,
// drawn as a ring: the sample about to be read sits at the top, and every
// sample travels once around per period. A pluck fills the ring with noise;
// each pass averages neighbours, so the jagged high harmonics die first and
// the ring relaxes into a smooth, shrinking loop. The bars are the ring's
// harmonics (a DFT of one period); the strip is the output level in dB,
// where an exponential decay is a straight line.

import type { Demo } from "../../../lib/demoShell";
import { makeFigure, runFigure, choice, syncSlider, C, ramp, TEXT } from "./figure";
import { panel, type Box } from "./plot";
import { midiHz, noteName, fmtHz, clamp, tuneString, stringT60, db, TAU } from "./dsp";

interface Preset {
  name: string;
  blend: number;
  stretch: number;
  decay: number;
  pick: number;
  bright: number;
  note: number;
}
const PRESETS: Preset[] = [
  { name: "guitar", blend: 1, stretch: 1, decay: 7, pick: 0.15, bright: 0.85, note: 45 },
  { name: "harp", blend: 1, stretch: 2.5, decay: 5, pick: 0.45, bright: 0.35, note: 57 },
  { name: "bright steel", blend: 1, stretch: 6, decay: 12, pick: 0.07, bright: 1, note: 52 },
  { name: "drum (b = ½)", blend: 0.5, stretch: 1, decay: 30, pick: 0, bright: 1, note: 43 },
  { name: "bottle (b = 0)", blend: 0, stretch: 1, decay: 6, pick: 0, bright: 1, note: 57 },
];

export async function mountKs(container: HTMLElement): Promise<Demo> {
  const narrow = (container.clientWidth || 700) < 560;
  const st = { ...PRESETS[0], frac: 1 };

  const ksPatch = () => ({ stretch: st.stretch, decay: st.decay, bright: st.bright, pick: st.pick, blend: st.blend, frac: st.frac });
  const fig = await makeFigure(container, {
    aspect: narrow ? 1.5 : 0.56,
    patch: { mode: 2, poly: 8, velAmt: 0.4, gain: 0.85, e1: { a: 0.001, d: 0.1, s: 1, r: 0.25 }, ks: ksPatch() },
    host: { fft: 2048, smoothing: 0, ks: true, reverb: 0.12 },
    base: 36,
    demo: (f) => f.tap(st.note, 1.5),
  });
  const { glow: g, host, shell } = fig;
  const apply = (): void => host.set({ ks: ksPatch() });

  const presetPick = choice(
    shell,
    PRESETS.map((p, i) => [i, p.name] as [number, string]),
    0,
    (i) => {
      Object.assign(st, PRESETS[i]);
      syncSlider(bIn, st.blend, false, fmtB);
      syncSlider(sIn, st.stretch, true, fmtS);
      syncSlider(rIn, st.decay, true, fmtDecay);
      syncSlider(pIn, st.pick, false, fmtPick);
      syncSlider(hIn, st.bright, false, fmtHard);
      apply();
      fig.tap(st.note, 1.2);
    },
  );
  const custom = (): void => presetPick.set(-1);
  const fmtB = (v: number): string => (v > 0.97 ? `${v.toFixed(2)} · string` : Math.abs(v - 0.5) < 0.05 ? `${v.toFixed(2)} · drum` : v < 0.03 ? `${v.toFixed(2)} · bottle` : v.toFixed(2));
  const fmtS = (v: number): string => v.toFixed(1);
  const fmtDecay = (v: number): string => (v >= 30 ? "natural" : `${v.toFixed(v < 10 ? 1 : 0)} s`);
  const fmtPick = (v: number): string => (v <= 0.001 ? "off" : `${Math.round(v * 100)}% along`);
  const fmtHard = (v: number): string => (v > 0.8 ? "hard" : v > 0.4 ? "medium" : "soft");
  const bIn = shell.slider({ label: "blend b", min: 0, max: 1, step: 0.01, value: st.blend, format: fmtB, onInput: (v) => ((st.blend = v), apply(), custom()) });
  const sIn = shell.slider({ label: "decay stretch S", min: 1, max: 20, step: 0.1, value: st.stretch, log: true, format: fmtS, onInput: (v) => ((st.stretch = v), apply(), custom()) });
  const rIn = shell.slider({ label: "decay (fundamental)", min: 0.3, max: 30, step: 0.1, value: st.decay, log: true, format: fmtDecay, onInput: (v) => ((st.decay = v), apply(), custom()) });
  const pIn = shell.slider({ label: "pick position", min: 0, max: 0.5, step: 0.01, value: st.pick, format: fmtPick, onInput: (v) => ((st.pick = v), apply(), custom()) });
  const hIn = shell.slider({ label: "pluck", min: 0.05, max: 1, step: 0.01, value: st.bright, format: fmtHard, onInput: (v) => ((st.bright = v), apply(), custom()) });
  const fracBtn = shell.button("fractional delay: on", () => {
    st.frac = st.frac ? 0 : 1;
    fracBtn.textContent = `fractional delay: ${st.frac ? "on" : "off"}`;
    fracBtn.classList.toggle("is-on", !!st.frac);
    apply();
  });
  fracBtn.classList.add("is-on");

  // ---- a slow-motion string for the silent display ----
  const sim = { buf: new Float32Array(600), N: 0, t: 0, age: 0, rho: 1 };
  const simPluck = (): void => {
    const sr = 48000;
    const f = midiHz(st.note);
    const tune = tuneString(f, sr, st.stretch, !!st.frac, st.decay);
    sim.N = tune.N;
    sim.rho = tune.rho;
    let lp = 0;
    const raw = new Float32Array(sim.N + 1);
    for (let i = 0; i <= sim.N; i++) {
      lp += ((Math.random() < 0.5 ? -1 : 1) - lp) * st.bright;
      raw[i] = lp;
    }
    const M = Math.max(1, Math.round(st.pick * sim.N));
    let mean = 0;
    for (let i = 0; i <= sim.N; i++) {
      sim.buf[i] = raw[i] - (st.pick > 0.001 && i >= M ? raw[i - M] : 0);
      mean += sim.buf[i];
    }
    mean /= sim.N + 1;
    let rms = 0;
    for (let i = 0; i <= sim.N; i++) {
      sim.buf[i] -= mean;
      rms += sim.buf[i] ** 2;
    }
    rms = Math.sqrt(rms / (sim.N + 1)) || 1;
    for (let i = 0; i <= sim.N; i++) sim.buf[i] *= 0.55 / rms;
    sim.age = 0;
  };
  // one trip around the loop: every sample replaced by the filtered pair
  const simPass = (): void => {
    const N = sim.N;
    const w = 1 / (2 * Math.max(1, st.stretch));
    const next = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const a = sim.buf[i];
      const b = sim.buf[(i + N) % (N + 1)];
      let y = ((1 - w) * a + w * b) * sim.rho;
      if (st.blend < 1 && Math.random() >= st.blend) y = -y;
      next[i] = y;
    }
    sim.buf.set(next);
    sim.age++;
  };
  simPluck();

  // ---- output level history ----
  const HIST = 240;
  const hist = new Float32Array(HIST).fill(-120);
  let hHead = 0;
  let acc = 0;
  let lastT = performance.now();
  const tbuf = new Float32Array(2048);

  let readout = "";
  shell.setInfo(() => readout);

  return runFigure(fig, () => {
    const now = performance.now();
    const dt = (now - lastT) / 1000;
    lastT = now;
    const W = g.w;
    const H = g.h;
    const sr = host.live ? host.sampleRate : 48000;

    // which ring to draw
    const tk = host.tele?.ks;
    const liveRing = host.live && tk && now - (host.tele?.at ?? 0) < 400 && (host.tele?.voices.length ?? 0) > 0;
    let data: Float32Array;
    let note: number;
    if (liveRing && tk) {
      data = tk.data;
      note = tk.note;
    } else {
      // idle: the slow-motion string, re-plucked every few seconds
      sim.t += dt;
      if (sim.t > 0.05) {
        sim.t = 0;
        simPass();
      }
      if (sim.age > 90) simPluck();
      data = sim.buf.subarray(0, sim.N + 1);
      note = st.note;
    }
    const f0 = midiHz(note);
    const tune = tuneString(f0, sr, st.stretch, !!st.frac, st.decay);
    const n = data.length;

    // ---- layout ----
    const ringBox: Box = narrow ? { x: 16, y: 26, w: W - 32, h: H * 0.38 } : { x: 18, y: 26, w: W * 0.44, h: H - 26 - 22 };
    const right = narrow ? 16 : ringBox.x + ringBox.w + 36;
    const rw = W - right - 18;
    const barBox: Box = narrow
      ? { x: right, y: ringBox.y + ringBox.h + 40, w: rw, h: H * 0.22 }
      : { x: right, y: 26, w: rw, h: (H - 26 - 22) * 0.55 };
    const lvlBox: Box = narrow
      ? { x: right, y: barBox.y + barBox.h + 40, w: rw, h: H - (barBox.y + barBox.h + 40) - 22 }
      : { x: right, y: barBox.y + barBox.h + 44, w: rw, h: H - (barBox.y + barBox.h + 44) - 22 };

    // ---- the ring ----
    panel(g, ringBox, liveRing ? "the delay line, live" : "the delay line, slowed down", `${n} samples`);
    const cx = ringBox.x + ringBox.w / 2;
    const cy = ringBox.y + ringBox.h / 2 + 4;
    const R0 = Math.min(ringBox.w, ringBox.h) * 0.3;
    const amp = R0 * 0.26;
    const base: number[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * TAU;
      base.push(cx + Math.cos(a) * R0, cy + Math.sin(a) * R0);
    }
    g.line(base, 1, C.grid, 0.8, { closed: true });
    const pts: number[] = [];
    const cols: number[] = [];
    // the oldest sample (read next) at the top; newer ones run clockwise
    // toward it, so the ring turns clockwise as the string plays
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 - (i / n) * TAU;
      const r = R0 + clamp(data[i], -2.5, 2.5) * amp;
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      const m = Math.min(1, Math.abs(data[i]) * 0.8);
      peak = Math.max(peak, Math.abs(data[i]));
      const c = ramp(0.15 + 0.85 * m);
      cols.push(c[0] * (0.6 + m), c[1] * (0.6 + m), c[2] * (0.6 + m), 1);
    }
    g.glowLine(pts, 1.6, [1, 1, 1], 1, 0.4, { closed: true, colors: cols });
    // read/write head
    g.seg(cx, cy - R0 - amp * 2.6, cx, cy - R0 + amp * 2.6, 1.2, [1.2, 0.75, 0.35], 0.8);
    g.dot(cx, cy - R0, 3, [1.6, 1, 0.5], 1);
    g.text("read → filter → write", cx, Math.max(ringBox.y + 14, cy - R0 - amp * 2.6 - 6), { size: 9.5, align: "center", color: TEXT.warm });
    g.text(`${noteName(note)}`, cx, cy + 4, { size: 15, align: "center", color: TEXT.hi, weight: 600 });
    g.text(fmtHz(f0), cx, cy + 20, { size: 10, align: "center", color: TEXT.dim, mono: true });

    // ---- harmonics of one period ----
    panel(g, barBox, "harmonics in the ring", "seconds to fall 60 dB");
    const NHB = 16;
    const slot = barBox.w / NHB;
    const bb = barBox.y + barBox.h;
    const D = n; // one period ≈ the ring
    for (let k = 1; k <= NHB; k++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const ph = (TAU * k * i) / D;
        re += data[i] * Math.cos(ph);
        im -= data[i] * Math.sin(ph);
      }
      const a = (2 * Math.hypot(re, im)) / n;
      const h = clamp((db(a) + 60) / 60, 0, 1);
      const x = barBox.x + (k - 0.5) * slot;
      const c = ramp((k - 1) / (NHB - 1));
      if (h > 0) {
        const y = bb - h * (barBox.h - 30);
        g.rect(x - slot * 0.25, y, slot * 0.5, bb - y, [c[0] * 1.2, c[1] * 1.2, c[2] * 1.2], 0.85, c, 0.15);
      }
      // predicted ring time for this harmonic
      const t60 = st.blend >= 0.999 ? stringT60(f0, k, sr, st.stretch, tune.rho) : NaN;
      if (Number.isFinite(t60) && (narrow ? k % 2 === 1 : k <= 8 || k % 2 === 0)) {
        g.text(t60 >= 10 ? t60.toFixed(0) : t60.toFixed(1), x, barBox.y + 13, { size: 9, align: "center", color: TEXT.dim, mono: true });
      }
      if (k <= 10 || k % 2 === 0) g.text(`${k}`, x, bb + 13, { size: 9.5, align: "center", color: TEXT.dim, mono: true });
    }

    // ---- level in dB ----
    acc += dt;
    const step = 3.5 / HIST;
    if (acc >= step) {
      let pk = 0;
      if (host.live && host.timeData(tbuf)) for (const s of tbuf) pk = Math.max(pk, Math.abs(s));
      else pk = liveRing ? 0 : peak * 0.3;
      while (acc >= step) {
        acc -= step;
        hHead = (hHead + 1) % HIST;
        hist[hHead] = db(pk);
      }
    }
    panel(g, lvlBox, "output level", "dB");
    const lo = -72;
    const hi = 0;
    let top = -200;
    for (const v of hist) top = Math.max(top, v);
    const off = top > -100 ? -top : 0;
    const yOf = (d: number): number => lvlBox.y + lvlBox.h * (1 - clamp((d + off - lo) / (hi - lo), 0, 1));
    for (const d of [0, -24, -48]) {
      g.seg(lvlBox.x, yOf(d - off), lvlBox.x + lvlBox.w, yOf(d - off), 1, C.grid, 0.3);
      g.text(`${d}`, lvlBox.x - 5, yOf(d - off) + 3.5, { size: 9, align: "right", color: TEXT.dim, mono: true });
    }
    const lp: number[] = [];
    for (let i = 0; i < HIST; i++) {
      const v = hist[(hHead + 1 + i) % HIST];
      lp.push(lvlBox.x + (i / (HIST - 1)) * lvlBox.w, yOf(Math.max(v, lo - off - 2)));
    }
    g.line(lp, 1.5, [0.5, 0.8, 1.3], 1);

    // ---- readout ----
    const loop = `${tune.N} + ${tune.P1.toFixed(2)} (filter)${st.frac ? ` + ${tune.frac.toFixed(2)} (all-pass)` : ""}`;
    const total = st.frac ? tune.D : tune.N + tune.P1;
    const err = st.frac ? "in tune" : `${tune.errCents >= 0 ? "+" : ""}${tune.errCents.toFixed(1)} cents off`;
    readout =
      st.blend >= 0.999
        ? `${noteName(note)} · loop ${loop} = ${total.toFixed(2)} samples · ${err} · fundamental rings ${stringT60(f0, 1, sr, st.stretch, tune.rho).toFixed(1)} s`
        : st.blend < 0.03
          ? `b = 0: the sign flips every pass, so the period doubles: ${noteName(note - 12)}, odd harmonics only`
          : `b = ${st.blend.toFixed(2)}: random sign flips break the period up; the loop length now sets the decay, not a pitch`;
  });
}
