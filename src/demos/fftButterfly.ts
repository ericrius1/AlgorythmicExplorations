// Demo 4 of part five: the FFT's wiring diagram and its price tag.
// Top: the butterfly network for 16 points — log₂(16) = 4 layers, every
// layer touching all 16 values in pairs, the same shape as part three's
// scan. Bottom: a live race, direct O(n²) DFT vs the O(n log n) FFT, on
// this machine, right now.

import { Shell, type Demo } from "../lib/demoShell";

const NV = 16; // butterfly size
const STAGES = 4;

// timing race
function dft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const or_ = new Float64Array(n);
  const oi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let i = 0; i < n; i++) {
      const ang = (-2 * Math.PI * k * i) / n;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      sr += re[i] * c - im[i] * s;
      si += re[i] * s + im[i] * c;
    }
    or_[k] = sr;
    oi[k] = si;
  }
  re.set(or_);
  im.set(oi);
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const DFT_CAP = 2048; // beyond this the direct transform is extrapolated

interface Race {
  n: number;
  dftMs: number;
  fftMs: number;
  extrapolated: boolean;
}

function runRace(n: number): Race {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.random() - 0.5;

  const fftReps = n <= 4096 ? 20 : 5;
  let t0 = performance.now();
  for (let r = 0; r < fftReps; r++) {
    const cr = re.slice();
    const ci = im.slice();
    fft(cr, ci);
  }
  const fftMs = (performance.now() - t0) / fftReps;

  const extrapolated = n > DFT_CAP;
  const nd = Math.min(n, DFT_CAP);
  const dr = re.slice(0, nd);
  const di = im.slice(0, nd);
  t0 = performance.now();
  dft(dr, di);
  let dftMs = performance.now() - t0;
  if (extrapolated) dftMs *= (n / nd) ** 2;
  return { n, dftMs, fftMs, extrapolated };
}

export function mountFftButterfly(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.72);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let stage = 0; // highlighted butterfly layer, cycles
  let clock = 0;
  let logN = 12;
  let race = runRace(1 << logN);

  shell.slider({
    label: "points",
    min: 8,
    max: 20,
    step: 1,
    value: logN,
    format: (v) => (1 << v).toLocaleString(),
    onInput: (v) => {
      logN = v;
      race = runRace(1 << logN);
    },
  });
  shell.setInfo(() => {
    const speedup = race.dftMs / Math.max(race.fftMs, 1e-6);
    return `n = ${race.n.toLocaleString()} · direct ${fmtMs(race.dftMs)}${race.extrapolated ? " (extrapolated)" : ""} · FFT ${fmtMs(race.fftMs)} · ${speedup > 100 ? Math.round(speedup).toLocaleString() : speedup.toFixed(1)}× faster`;
  });

  const fmtMs = (ms: number): string => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
    if (ms < 1000) return `${ms.toFixed(1)} ms`;
    if (ms < 120000) return `${(ms / 1000).toFixed(1)} s`;
    return `${(ms / 60000).toFixed(1)} min`;
  };

  // x position of value v in the diagram
  return {
    frame() {
      shell.tick();
      clock++;
      if (clock > 70) {
        clock = 0;
        stage = (stage + 1) % (STAGES + 1);
      }
      const { width: w, height: h } = ctx.canvas;
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      // ---- butterfly network --------------------------------------------------
      const margin = 0.06 * w;
      const colX = (i: number): number => margin + (i / (NV - 1)) * (w - 2 * margin);
      const layerTop = 0.08 * h;
      const layerGap = 0.13 * h;
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "center";

      for (let s = 0; s < STAGES; s++) {
        const span = NV >> (s + 1); // partner distance halves each layer
        const y0 = layerTop + s * layerGap;
        const y1 = y0 + layerGap;
        const active = stage === s + 1;
        for (let i = 0; i < NV; i++) {
          const partner = i ^ span;
          ctx.strokeStyle = active
            ? i & span
              ? "rgba(255, 184, 107, 0.85)"
              : "rgba(122, 162, 255, 0.85)"
            : "rgba(80, 90, 120, 0.3)";
          ctx.lineWidth = active ? 1.6 * dpr : 1;
          ctx.beginPath();
          ctx.moveTo(colX(i), y0);
          ctx.lineTo(colX(i), y1); // straight-through
          ctx.moveTo(colX(i), y0);
          ctx.lineTo(colX(partner), y1); // crossed pair
          ctx.stroke();
        }
        if (active) {
          ctx.fillStyle = "rgba(255, 205, 80, 0.9)";
          ctx.textAlign = "left";
          ctx.fillText(`layer ${s + 1}: pairs ${span} apart — all 8 butterflies at once`, margin, y0 - 4 * dpr);
          ctx.textAlign = "center";
        }
      }
      // nodes
      for (let s = 0; s <= STAGES; s++) {
        const y = layerTop + s * layerGap;
        for (let i = 0; i < NV; i++) {
          ctx.fillStyle = s === 0 ? "#ffb86b" : "#7aa2ff";
          ctx.beginPath();
          ctx.arc(colX(i), y, 2.4 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = "rgba(138, 145, 165, 0.9)";
      ctx.textAlign = "left";
      ctx.fillText("16 numbers in", margin, layerTop - 16 * dpr);
      ctx.fillText("16 frequencies out — 4 layers, every value touched once per layer", margin, layerTop + STAGES * layerGap + 16 * dpr);

      // ---- the race -----------------------------------------------------------
      const raceTop = 0.74 * h;
      const barH = 0.07 * h;
      const maxMs = Math.max(race.dftMs, race.fftMs);
      const barW = (ms: number): number => Math.max(2 * dpr, (Math.log10(1 + ms) / Math.log10(1 + maxMs)) * (w - 2 * margin) * 0.72);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(215, 219, 230, 0.85)";
      ctx.fillText(`direct DFT — n² ${race.extrapolated ? "(measured at 2,048, scaled)" : ""}`, margin, raceTop - 4 * dpr);
      ctx.fillStyle = "rgba(255, 107, 107, 0.8)";
      ctx.fillRect(margin, raceTop, barW(race.dftMs), barH);
      ctx.fillStyle = "rgba(215, 219, 230, 0.95)";
      ctx.fillText(fmtMs(race.dftMs), margin + barW(race.dftMs) + 6 * dpr, raceTop + barH * 0.7);

      const r2 = raceTop + barH + 22 * dpr;
      ctx.fillStyle = "rgba(215, 219, 230, 0.85)";
      ctx.fillText("FFT — n log n", margin, r2 - 4 * dpr);
      ctx.fillStyle = "rgba(122, 162, 255, 0.9)";
      ctx.fillRect(margin, r2, barW(race.fftMs), barH);
      ctx.fillStyle = "rgba(215, 219, 230, 0.95)";
      ctx.fillText(fmtMs(race.fftMs), margin + barW(race.fftMs) + 6 * dpr, r2 + barH * 0.7);
    },
  };
}
