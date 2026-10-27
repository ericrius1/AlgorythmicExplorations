// Fig. — aliasing. A spectrogram with a linear frequency axis up to the
// Nyquist frequency: a rising saw's harmonics climb, and in the naive
// oscillator the ones that should go past the top come back down as
// inharmonic lines. Below it, the spectrum at the current pitch, computed by
// running the engine's own oscillator code offline: harmonics in colour,
// aliases in red.

import type { Demo } from "../../../lib/demoShell";
import { heatRgb } from "../../../lib/palette";
import { makeFigure, runFigure, choice, C, ramp, TEXT } from "./figure";
import { panel, type Box } from "./plot";
import { GlowImage } from "./glow";
import { renderOsc, magSpectrum, midiHz, hzMidi, noteName, fmtHz, db, clamp } from "./dsp";

const COLS = 360;
const ROWS = 256;
const SWEEP_SEC = 8;
const SWEEP_LO = 57; // A3
const SWEEP_HI = 105; // A7
const AA_NAMES = ["naive", "polyBLEP", "additive"];

function sweepNote(t: number): number {
  // up for SWEEP_SEC, back down for SWEEP_SEC, exponential in frequency
  const u = (t % (2 * SWEEP_SEC)) / SWEEP_SEC;
  const k = u < 1 ? u : 2 - u;
  return SWEEP_LO + (SWEEP_HI - SWEEP_LO) * k;
}

export async function mountAlias(container: HTMLElement): Promise<Demo> {
  const narrow = (container.clientWidth || 700) < 560;
  let aa = 0;
  let wave = 2;
  let sweeping = false;
  let sweepT0 = 0;

  const fig = await makeFigure(container, {
    aspect: narrow ? 1.15 : 0.62,
    patch: {
      mode: 0,
      poly: 4,
      glide: 0.03,
      aa,
      o1: { wave, pw: 0.5, lvl: 1 },
      o2: { lvl: 0 },
      flt: { on: 0 },
      e1: { a: 0.005, d: 0.1, s: 1, r: 0.2 },
      velAmt: 0.2,
      gain: 0.55,
    },
    host: { fft: 2048, smoothing: 0 },
    base: 72,
    minBase: 36,
    maxBase: 96,
    demo: () => toggleSweep(true),
    playLabel: "Tap to play the sweep",
  });
  const { glow: g, host, shell } = fig;

  const img = new GlowImage(COLS, ROWS);
  const precomputed = new Map<string, Uint8ClampedArray>();
  const colBuf = new Uint8ClampedArray(ROWS * 4);

  const colour = (t: number, out: Uint8ClampedArray, o: number): void => {
    const [r, gg, b] = heatRgb(t);
    const k = Math.min(1, t * 3);
    out[o] = r * k;
    out[o + 1] = gg * k;
    out[o + 2] = b * k;
    out[o + 3] = 255;
  };

  // the sweep, rendered offline with the engine's oscillator code
  const rate = (): number => (host.live ? host.sampleRate : 48000);
  const precompute = (): void => {
    const sr = rate();
    const key = `${aa}:${wave}:${sr}`;
    let data = precomputed.get(key);
    if (!data) {
      const n = SWEEP_SEC * sr;
      const sig = renderOsc(wave, aa, (i) => midiHz(sweepNote(i / sr)), n, sr);
      data = new Uint8ClampedArray(COLS * ROWS * 4);
      const N = 1024;
      const hop = (n - N) / (COLS - 1);
      const mag = new Float32Array(N / 2);
      for (let c = 0; c < COLS; c++) {
        magSpectrum(sig, Math.floor(c * hop), N, mag);
        for (let r = 0; r < ROWS; r++) {
          const m = Math.max(mag[r * 2], mag[r * 2 + 1]);
          const t = clamp((db(m) + 100) / 95, 0, 1);
          // row 0 is the top of the image = Nyquist
          colour(t, data, ((ROWS - 1 - r) * COLS + c) * 4);
        }
      }
      precomputed.set(key, data);
    }
    img.data.set(data);
    img.head = 0;
    img.markAll();
  };
  precompute();
  let showingLive = false;

  const apply = (): void => {
    host.set({ aa, o1: { wave } });
    if (!showingLive) precompute();
    snapKey = "";
  };
  choice(
    shell,
    [
      [0, "naive"],
      [1, "band-limited (polyBLEP)"],
      [2, "additive"],
    ],
    aa,
    (v) => {
      aa = v;
      apply();
    },
  );
  choice(
    shell,
    [
      [2, "saw"],
      [3, "square"],
    ],
    wave,
    (v) => {
      wave = v;
      apply();
    },
  );
  const sweepBtn = shell.button("▶ sweep", () => toggleSweep(!sweeping));
  function toggleSweep(on: boolean): void {
    sweeping = on;
    sweepBtn.textContent = on ? "■ stop sweep" : "▶ sweep";
    sweepBtn.classList.toggle("is-on", on);
    if (on) {
      void host.start().then(() => {
        sweepT0 = performance.now();
        host.noteOn(999, SWEEP_LO, 0.8);
        fig.hidePlay();
      });
    } else host.noteOff(999);
  }

  // ---- the snapshot spectrum at the current pitch ----
  let snapKey = "";
  let snapF = 0;
  const SN = 8192;
  const snapMag = new Float32Array(SN / 2);
  let worstAlias = -200;
  let lastSnap = 0;
  const snapshot = (f: number, sr: number): void => {
    const key = `${aa}:${wave}:${f.toFixed(1)}:${sr}`;
    const now = performance.now();
    if (key === snapKey || now - lastSnap < 90) return;
    snapKey = key;
    lastSnap = now;
    snapF = f;
    const sig = renderOsc(wave, aa, () => f, SN + 512, sr);
    magSpectrum(sig, 512, SN, snapMag);
    // loudest alias below 5 kHz, relative to the fundamental
    const binHz = sr / SN;
    const fund = Math.max(...Array.from(snapMag.subarray(Math.round(f / binHz) - 3, Math.round(f / binHz) + 4)));
    worstAlias = -200;
    for (let k = 3; k < 5000 / binHz; k++) {
      if (!(snapMag[k] > snapMag[k - 1] && snapMag[k] >= snapMag[k + 1])) continue;
      const fk = k * binHz;
      const h = fk / f;
      if (Math.abs(h - Math.round(h)) * f < 6 * binHz && Math.round(h) >= 1) continue;
      worstAlias = Math.max(worstAlias, db(snapMag[k]) - db(fund));
    }
  };

  const fbuf = new Float32Array(1024);
  let agc = -40;
  let lastSound = 0;

  shell.setInfo(() => {
    const al = worstAlias < -150 ? "none above −150 dB" : `${worstAlias.toFixed(0)} dB`;
    return `${AA_NAMES[aa]} ${wave === 2 ? "saw" : "square"} at ${fmtHz(snapF)} · loudest alias below 5 kHz: ${al} (re fundamental)`;
  });

  return runFigure(fig, () => {
    const W = g.w;
    const H = g.h;
    const sr = host.live ? host.sampleRate : 48000;
    const nyq = sr / 2;

    // sweep driver
    if (sweeping && host.live) {
      const t = (performance.now() - sweepT0) / 1000;
      host.pitch(999, sweepNote(t));
    }
    const voices = host.live ? host.voices() : [];
    const v = voices[0];
    const f = v ? midiHz(v.note) : midiHz(93);
    snapshot(f, sr);

    // live spectrogram columns while something sounds
    if (host.live && voices.length > 0) {
      lastSound = performance.now();
      showingLive = true;
    }
    if (showingLive && host.live && performance.now() - lastSound < 1500 && host.freqData(fbuf)) {
      let mx = -200;
      for (let i = 0; i < fbuf.length; i++) mx = Math.max(mx, fbuf[i]);
      agc = Math.max(mx, agc - 0.15);
      for (let r = 0; r < ROWS; r++) {
        const d = Math.max(fbuf[r * 4], fbuf[r * 4 + 1], fbuf[r * 4 + 2], fbuf[r * 4 + 3]);
        colour(clamp((d - (agc - 95)) / 95, 0, 1), colBuf, (ROWS - 1 - r) * 4);
      }
      img.push(colBuf);
    }

    // ---- spectrogram ----
    const sg: Box = narrow ? { x: 44, y: 24, w: W - 60, h: H * 0.5 } : { x: 50, y: 24, w: W - 66, h: H * 0.54 };
    panel(g, sg, showingLive ? "live spectrogram" : "spectrogram of the sweep, A3 → A7 → A3", "");
    g.image(img, sg.x, sg.y, sg.w, sg.h, 1.25);
    for (const fk of [5000, 10000, 15000, 20000]) {
      if (fk > nyq) continue;
      const y = sg.y + sg.h * (1 - fk / nyq);
      g.seg(sg.x - 4, y, sg.x, y, 1, C.grid, 1);
      g.text(`${fk / 1000}k`, sg.x - 7, y + 3.5, { size: 9.5, align: "right", color: TEXT.dim, mono: true });
    }
    g.seg(sg.x, sg.y, sg.x + sg.w, sg.y, 1.5, C.pink, 0.9);
    g.text(`Nyquist · ${fmtHz(nyq)}`, sg.x + sg.w - 6, sg.y + 14, { size: 10.5, align: "right", color: "#ff9db4", weight: 600 });
    g.text("time →", sg.x + sg.w - 6, sg.y + sg.h + 14, { size: 9.5, align: "right", color: TEXT.dim });
    g.text("0", sg.x - 7, sg.y + sg.h + 3.5, { size: 9.5, align: "right", color: TEXT.dim, mono: true });

    // ---- snapshot ----
    const sp: Box = { x: sg.x, y: sg.y + sg.h + 46, w: sg.w, h: H - (sg.y + sg.h + 46) - 26 };
    panel(g, sp, `spectrum at ${noteName(hzMidi(snapF))} · ${fmtHz(snapF)}`, "");
    const DB_LO = -110;
    const yOf = (d: number): number => sp.y + sp.h * (1 - clamp((d - DB_LO) / -DB_LO, 0, 1));
    for (const d of [0, -40, -80]) {
      g.seg(sp.x, yOf(d), sp.x + sp.w, yOf(d), 1, C.grid, 0.35);
      g.text(`${d}`, sp.x - 7, yOf(d) + 3.5, { size: 9.5, align: "right", color: TEXT.dim, mono: true });
    }
    const binHz = sr / SN;
    const base = sp.y + sp.h;
    let aliasCount = 0;
    for (let k = 2; k < SN / 2 - 1; k++) {
      const m = snapMag[k];
      if (!(m > snapMag[k - 1] && m >= snapMag[k + 1])) continue;
      const d = db(m);
      if (d < DB_LO + 8) continue;
      const fk = k * binHz;
      const h = fk / snapF;
      const isHarm = Math.abs(h - Math.round(h)) * snapF < 6 * binHz && Math.round(h) >= 1;
      const x = sp.x + (fk / nyq) * sp.w;
      if (x > sp.x + sp.w) continue;
      const y = yOf(d);
      if (isHarm) {
        const c = ramp(clamp(Math.round(h) / 14, 0, 1));
        g.seg(x, base, x, y, 2, [c[0] * 1.3, c[1] * 1.3, c[2] * 1.3], 0.95);
      } else {
        aliasCount++;
        g.seg(x, base, x, y, 1.5, [1.4, 0.25, 0.25], 0.85);
      }
    }
    g.seg(sp.x + sp.w, sp.y, sp.x + sp.w, base, 1.5, C.pink, 0.8);
    g.text("harmonics", sp.x + 8, sp.y + 14, { size: 10.5, color: TEXT.accent });
    g.text(`aliases (${aliasCount})`, sp.x + 80, sp.y + 14, { size: 10.5, color: "#ff8a8a" });
    for (const fk of [5000, 10000, 15000, 20000]) {
      if (fk > nyq) continue;
      const x = sp.x + (fk / nyq) * sp.w;
      g.text(`${fk / 1000}k`, x, base + 13, { size: 9.5, align: "center", color: TEXT.dim, mono: true });
    }
    g.text("0", sp.x, base + 13, { size: 9.5, align: "center", color: TEXT.dim, mono: true });
  });
}
