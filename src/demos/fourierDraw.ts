// Demo 2 of part five: any curve is a sum of waves. Pick a signal, slide
// the wave budget, watch the reconstruction sharpen — and watch the square
// wave's corners ring (Gibbs), because corners are expensive in waves.

import { Shell, type Demo } from "../lib/demoShell";

const N = 256;

type PresetName = "square" | "bump" | "two tones" | "noise";

function makeSignal(name: PresetName): Float64Array {
  const s = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / N;
    if (name === "square") s[i] = t > 0.25 && t < 0.65 ? 0.8 : -0.5;
    else if (name === "bump") s[i] = Math.exp(-((t - 0.45) ** 2) / 0.004) - 0.25;
    else if (name === "two tones") s[i] = 0.5 * Math.sin(2 * Math.PI * 3 * t) + 0.3 * Math.sin(2 * Math.PI * 17 * t);
    else s[i] = 0; // noise filled by caller
  }
  return s;
}

export function mountFourierDraw(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let signal = makeSignal("square");
  let presetName: PresetName = "square";
  let waves = 4;
  // DFT coefficients, computed once per preset (n² at 256 points: nothing)
  let coefRe = new Float64Array(N);
  let coefIm = new Float64Array(N);

  const analyze = (): void => {
    coefRe = new Float64Array(N);
    coefIm = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      for (let i = 0; i < N; i++) {
        const ang = (-2 * Math.PI * k * i) / N;
        coefRe[k] += signal[i] * Math.cos(ang);
        coefIm[k] += signal[i] * Math.sin(ang);
      }
      coefRe[k] /= N;
      coefIm[k] /= N;
    }
  };

  const setPreset = (name: PresetName): void => {
    presetName = name;
    signal = makeSignal(name);
    if (name === "noise") {
      let v = 0;
      for (let i = 0; i < N; i++) {
        v = v * 0.92 + (Math.random() - 0.5) * 0.35;
        signal[i] = v * 2;
      }
    }
    analyze();
  };
  setPreset("square");

  // partial reconstruction from the `waves` lowest frequencies
  const reconstruct = (m: number): Float64Array => {
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = coefRe[0];
    for (let k = 1; k <= m && k < N / 2; k++) {
      const amp = 2;
      for (let i = 0; i < N; i++) {
        const ang = (2 * Math.PI * k * i) / N;
        out[i] += amp * (coefRe[k] * Math.cos(ang) - coefIm[k] * Math.sin(ang));
      }
    }
    return out;
  };

  for (const p of ["square", "bump", "two tones", "noise"] as PresetName[]) {
    shell.button(p, () => setPreset(p));
  }
  shell.slider({
    label: "waves used",
    min: 1,
    max: 128,
    step: 1,
    value: waves,
    log: true,
    format: (v) => String(Math.round(v)),
    onInput: (v) => (waves = Math.round(v)),
  });
  shell.setInfo(() => {
    const note =
      presetName === "square" && waves < 60
        ? " · the overshoot at the corners is Gibbs ringing — sharp edges cost waves"
        : "";
    return `${waves} of ${N / 2} waves${note}`;
  });

  return {
    frame() {
      shell.tick();
      const { width: w, height: h } = ctx.canvas;
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const partial = reconstruct(waves);
      const plotTop = 0.06 * h;
      const plotH = 0.56 * h;
      const mid = plotTop + plotH / 2;
      const yOf = (v: number): number => mid - v * plotH * 0.42;
      const xOf = (i: number): number => (i / (N - 1)) * w;

      // axis
      ctx.strokeStyle = "rgba(80, 90, 120, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();

      // the target, faint
      ctx.strokeStyle = "rgba(215, 219, 230, 0.35)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (i === 0) ctx.moveTo(xOf(i), yOf(signal[i]));
        else ctx.lineTo(xOf(i), yOf(signal[i]));
      }
      ctx.stroke();

      // the reconstruction, bright
      ctx.strokeStyle = "rgba(122, 162, 255, 0.95)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (i === 0) ctx.moveTo(xOf(i), yOf(partial[i]));
        else ctx.lineTo(xOf(i), yOf(partial[i]));
      }
      ctx.stroke();

      // spectrum strip: |coef| per frequency, used ones lit
      const specTop = 0.74 * h;
      const specH = 0.2 * h;
      const bins = N / 2;
      const bw = w / bins;
      let maxC = 1e-9;
      const mags: number[] = [];
      for (let k = 1; k < bins; k++) {
        const m = Math.hypot(coefRe[k], coefIm[k]);
        mags.push(m);
        if (m > maxC) maxC = m;
      }
      for (let k = 1; k < bins; k++) {
        const m = mags[k - 1] / maxC;
        const bh = Math.max(1, m * specH);
        ctx.fillStyle = k <= waves ? "rgba(255, 184, 107, 0.9)" : "rgba(122, 162, 255, 0.28)";
        ctx.fillRect((k - 1) * bw, specTop + specH - bh, Math.max(1, bw - 1), bh);
      }
      ctx.fillStyle = "rgba(138, 145, 165, 0.9)";
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("spectrum — every bar is one wave; lit bars are in use, low frequencies left", 6 * dpr, specTop - 5 * dpr);
    },
  };
}
