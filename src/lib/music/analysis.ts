// Analysis taps for the music views. A probe hangs analysers off one node and
// pulls their data at most once per animation frame, so a scope, a spectrum
// and a meter reading the same probe share one set of reads.
//
// Analysers are built lazily, only once audio is running: building them
// earlier would create the AudioContext before a user gesture (and Chrome
// warns about every such context). Until then a probe returns silence.

import * as Tone from "tone";
import { audioOn } from "../audio";
import { masterChain } from "./master";

export interface Levels {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
}

export interface Pitch {
  hz: number;
  clarity: number;
}

type Source = Tone.ToneAudioNode | AudioNode;

const FFT = 8192;
const TIME = 4096;
const LR = 1024;

export class AudioProbe {
  readonly fftSize = FFT;
  private getSource: () => Source;
  private lazySource: boolean;
  private built = false;
  private sr = 48000;
  private mono: AnalyserNode | null = null;
  private left: AnalyserNode | null = null;
  private right: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;

  private timeFull = new Float32Array(FFT);
  private timeView = this.timeFull.subarray(FFT - TIME);
  private freq = new Float32Array(FFT / 2).fill(-200);
  private lrBufL = new Float32Array(LR);
  private lrBufR = new Float32Array(LR);
  private lv: Levels = { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
  private pitchVal: Pitch | null = null;
  private pitchFrame = -1;

  private frameKey = -1;
  private frameAt = 0;
  private frameNo = 0;
  private gotTime = false;
  private gotFreq = false;
  private gotLevels = false;

  /** Tap a Tone node or a native AudioNode (any AudioContext). */
  constructor(source: Source | (() => Source)) {
    this.lazySource = typeof source === "function";
    this.getSource = this.lazySource ? (source as () => Source) : () => source as Source;
  }

  /** True once analysers exist and audio is running. */
  get active(): boolean {
    this.ensure();
    return this.built;
  }

  get sampleRate(): number {
    this.ensure();
    return this.sr;
  }

  /** Hz per FFT bin. */
  get binHz(): number {
    return this.sampleRate / FFT;
  }

  /** Latest 4096 mono samples (−1..1). */
  time(): Float32Array {
    this.pull();
    if (this.built && !this.gotTime) {
      this.mono!.getFloatTimeDomainData(this.timeFull);
      this.gotTime = true;
    }
    return this.timeView;
  }

  /** Latest spectrum, dB per bin (4096 bins of binHz each). No smoothing. */
  freqDb(): Float32Array {
    this.pull();
    if (this.built && !this.gotFreq) {
      this.mono!.getFloatFrequencyData(this.freq);
      this.gotFreq = true;
    }
    return this.freq;
  }

  /** Sample peak and RMS per channel over the last ~21 ms (linear). */
  levels(): Levels {
    this.pull();
    if (this.built && !this.gotLevels) {
      this.left!.getFloatTimeDomainData(this.lrBufL);
      this.right!.getFloatTimeDomainData(this.lrBufR);
      const a = stats(this.lrBufL);
      const b = stats(this.lrBufR);
      this.lv = { peakL: a[0], peakR: b[0], rmsL: a[1], rmsR: b[1] };
      this.gotLevels = true;
    }
    return this.lv;
  }

  /** Fundamental estimate (YIN), refreshed every other frame; null when unclear or silent. */
  pitch(): Pitch | null {
    this.pull();
    if (!this.built) return null;
    if (this.frameNo - this.pitchFrame >= 2 || this.pitchFrame < 0) {
      this.pitchFrame = this.frameNo;
      this.pitchVal = yin(this.time(), this.sr);
    }
    return this.pitchVal;
  }

  dispose(): void {
    if (!this.built) return;
    try {
      const src = this.getSource();
      if (src instanceof Tone.ToneAudioNode) {
        Tone.disconnect(src, this.mono as unknown as AudioNode);
        Tone.disconnect(src, this.splitter as unknown as AudioNode);
      } else {
        src.disconnect(this.mono!);
        src.disconnect(this.splitter!);
      }
    } catch {
      /* already gone */
    }
    this.built = false;
  }

  private pull(): void {
    this.ensure();
    const tl = typeof document !== "undefined" ? document.timeline?.currentTime : null;
    const key = typeof tl === "number" ? tl : -1;
    const now = performance.now();
    if (key !== this.frameKey || key < 0 || now - this.frameAt > 30) {
      this.frameKey = key;
      this.frameAt = now;
      this.frameNo++;
      this.gotTime = this.gotFreq = this.gotLevels = false;
    }
  }

  private ensure(): void {
    if (this.built) return;
    // a lazy source (the master chain) would create the AudioContext; wait for the unlock
    if (this.lazySource && !audioOn()) return;
    const src = this.getSource();
    const raw = (src instanceof Tone.ToneAudioNode ? src.context.rawContext : src.context) as unknown as BaseAudioContext;
    if (raw.state !== "running" && !audioOn()) return;
    this.sr = raw.sampleRate;
    const mono = raw.createAnalyser();
    mono.fftSize = FFT;
    mono.smoothingTimeConstant = 0;
    const splitter = raw.createChannelSplitter(2);
    const left = raw.createAnalyser();
    const right = raw.createAnalyser();
    left.fftSize = right.fftSize = LR;
    left.smoothingTimeConstant = right.smoothingTimeConstant = 0;
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    if (src instanceof Tone.ToneAudioNode) {
      Tone.connect(src, mono);
      Tone.connect(src, splitter);
    } else {
      src.connect(mono);
      src.connect(splitter);
    }
    this.mono = mono;
    this.left = left;
    this.right = right;
    this.splitter = splitter;
    this.built = true;
  }
}

let master: AudioProbe | null = null;

/** The master output, post-limiter and pre-volume (what the speakers get, before the listener's volume knob). */
export function masterProbe(): AudioProbe {
  master ??= new AudioProbe(() => masterChain().post);
  return master;
}

function stats(buf: Float32Array): [number, number] {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sum += v * v;
  }
  return [peak, Math.sqrt(sum / buf.length)];
}

// YIN (de Cheveigné & Kawahara 2002), cut down: difference function over a
// 1024-sample window, cumulative-mean normalisation, absolute threshold,
// parabolic refinement. Range ~55 Hz – 2 kHz.
const W = 1024;
const dBuf = new Float32Array(1200);
function yin(x: Float32Array, sr: number): Pitch | null {
  const n = x.length;
  const minTau = Math.max(2, Math.floor(sr / 2000));
  const maxTau = Math.min(dBuf.length - 2, Math.floor(sr / 55));
  const start = n - W - maxTau - 1;
  if (start < 0) return null;
  let energy = 0;
  for (let j = 0; j < W; j++) energy += x[start + j] * x[start + j];
  if (energy / W < 1e-6) return null; // ~ −60 dBFS RMS: call it silence

  dBuf[0] = 1;
  let running = 0;
  let best = -1;
  let bestVal = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    let d = 0;
    for (let j = 0; j < W; j++) {
      const v = x[start + j] - x[start + j + tau];
      d += v * v;
    }
    running += d;
    const nd = running > 0 ? (d * tau) / running : 1;
    dBuf[tau] = nd;
  }
  // first dip under the threshold, walked down to its local minimum
  for (let tau = minTau; tau < maxTau; tau++) {
    if (dBuf[tau] < 0.12) {
      while (tau + 1 < maxTau && dBuf[tau + 1] < dBuf[tau]) tau++;
      best = tau;
      bestVal = dBuf[tau];
      break;
    }
  }
  if (best < 0) {
    for (let tau = minTau; tau < maxTau; tau++) {
      if (dBuf[tau] < bestVal) {
        bestVal = dBuf[tau];
        best = tau;
      }
    }
    if (bestVal > 0.3) return null;
  }
  const a = dBuf[best - 1];
  const b = dBuf[best];
  const c = dBuf[best + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const tau = best + Math.max(-0.5, Math.min(0.5, shift));
  return { hz: sr / tau, clarity: Math.max(0, Math.min(1, 1 - bestVal)) };
}
