// Monophonic pitch detection from the microphone: the McLeod pitch method
// (MPM), run on the main thread against an AnalyserNode's latest window.
// No worklet, no ring buffers — the analyser always holds the freshest 2048
// samples, and one NSDF pass per animation frame is ~1.5 ms, which is cheap
// for the only demo running.
//
// MPM in one breath: slide the window against itself (autocorrelation),
// normalize so a perfect repeat scores exactly 1 (the NSDF), then take the
// first strong peak — not the tallest, the *first* that comes close to the
// tallest — so the octave below the true pitch doesn't win. The peak's lag
// is the period; its height is "clarity", a built-in confidence score.

import { Tone } from "./audio";

export interface PitchFrame {
  freq: number; // Hz, 0 when nothing periodic is heard
  clarity: number; // 0..1, NSDF peak height
  rms: number; // input level
}

const N = 2048;
const MIN_TAU = 20; // ~2.4 kHz ceiling at 48 kHz
const MAX_TAU = 700; // ~68 Hz floor at 48 kHz

export class PitchTracker {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(N);
  private nsdf = new Float32Array(MAX_TAU);

  get live(): boolean {
    return this.analyser !== null;
  }

  async start(): Promise<void> {
    if (this.analyser) return;
    this.ctx = Tone.getContext().rawContext as AudioContext;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // echo cancellation keeps the harmony voices (playing from the
        // speakers) from being heard as the melody; suppression would eat
        // sustained notes, so it stays off
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = N;
    this.source.connect(this.analyser);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.stream = null;
    this.source = null;
    this.analyser = null;
  }

  // One detection pass over the analyser's current window.
  analyze(): PitchFrame {
    if (!this.analyser || !this.ctx) return { freq: 0, clarity: 0, rms: 0 };
    this.analyser.getFloatTimeDomainData(this.buf);
    const buf = this.buf;

    let e = 0;
    for (let i = 0; i < N; i++) e += buf[i] * buf[i];
    const rms = Math.sqrt(e / N);
    if (rms < 0.006) return { freq: 0, clarity: 0, rms };

    // NSDF: 2·Σ x[i]x[i+τ] / Σ (x[i]² + x[i+τ]²) — autocorrelation that
    // scores 1 for a perfect repeat regardless of amplitude
    const nsdf = this.nsdf;
    for (let t = MIN_TAU; t < MAX_TAU; t++) {
      let acf = 0;
      let m = 0;
      for (let i = 0, n = N - t; i < n; i++) {
        const a = buf[i];
        const b = buf[i + t];
        acf += a * b;
        m += a * a + b * b;
      }
      nsdf[t] = (2 * acf) / m;
    }

    // peak picking: local maxima between positive-going zero crossings
    let maxVal = 0;
    const peakT: number[] = [];
    const peakV: number[] = [];
    let t = MIN_TAU;
    while (t < MAX_TAU - 1) {
      while (t < MAX_TAU - 1 && !(nsdf[t] <= 0 && nsdf[t + 1] > 0)) t++;
      let best = -1;
      let bestV = -1;
      t++;
      while (t < MAX_TAU - 1 && nsdf[t] > 0) {
        if (nsdf[t] > bestV && nsdf[t] >= nsdf[t - 1] && nsdf[t] >= nsdf[t + 1]) {
          bestV = nsdf[t];
          best = t;
        }
        t++;
      }
      if (best > 0) {
        peakT.push(best);
        peakV.push(bestV);
        if (bestV > maxVal) maxVal = bestV;
      }
    }
    if (peakT.length === 0 || maxVal < 0.5) return { freq: 0, clarity: maxVal, rms };

    // first peak within 10% of the tallest — the anti-octave-error rule
    const thresh = maxVal * 0.9;
    let pick = 0;
    for (let i = 0; i < peakT.length; i++) {
      if (peakV[i] >= thresh) {
        pick = i;
        break;
      }
    }

    // parabolic interpolation for sub-sample period precision
    const ti = peakT[pick];
    const a = nsdf[ti - 1];
    const b = nsdf[ti];
    const c = nsdf[ti + 1];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const period = ti + shift;
    return { freq: this.ctx.sampleRate / period, clarity: peakV[pick], rms };
  }
}
