// Brickwall look-ahead limiter for the master bus.
//
// The output is the input delayed by the look-ahead window and multiplied by a
// gain that has already ramped down by the time a peak arrives, so nothing
// above the ceiling ever leaves. Steps per sample (stereo-linked):
//   1. peak = max |x| over channels
//   2. hold: running max of peak over the last L samples (monotonic deque)
//   3. target gain = min(1, ceiling / hold)
//   4. release: falls instantly, recovers exponentially (release time)
//   5. box filter of length L: turns the instant drop into a smooth L-sample
//      ramp that bottoms out exactly when the held peak leaves the delay line
//   6. out = x[n - (L-1)] * gain, then a hard clamp at the ceiling as a
//      last-resort guard against float rounding.
// The smallest gain of each ~30 ms is posted to the main thread for meters.

class MusicLimiter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.ceiling = typeof o.ceiling === "number" ? o.ceiling : Math.pow(10, -1 / 20);
    const lookMs = typeof o.lookaheadMs === "number" ? o.lookaheadMs : 5;
    const relMs = typeof o.releaseMs === "number" ? o.releaseMs : 120;
    this.L = Math.max(8, Math.round((lookMs / 1000) * sampleRate));
    this.rel = 1 - Math.exp(-1 / ((relMs / 1000) * sampleRate));

    const L = this.L;
    // delay lines (2 channels), L-1 samples: the box filter reaches its
    // minimum L-1 samples after a peak enters the hold window
    this.D = L - 1;
    this.dl = [new Float32Array(this.D), new Float32Array(this.D)];
    this.dpos = 0;
    // monotonic deque for the running max: values + the sample index they expire at
    this.qv = new Float64Array(L + 1);
    this.qi = new Float64Array(L + 1);
    this.qh = 0; // head
    this.qn = 0; // count
    this.n = 0; // sample counter
    // box filter
    this.box = new Float64Array(L).fill(1);
    this.bpos = 0;
    this.bsum = L;
    this.g = 1; // release-smoothed target
    this.minGain = 1;
    this.reportEvery = Math.round(sampleRate * 0.03);
    this.sinceReport = 0;
    this.blocks = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const frames = output[0].length;
    const inL = input && input.length > 0 ? input[0] : null;
    const inR = input && input.length > 1 ? input[1] : inL;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;

    const L = this.L;
    const D = this.D;
    const ceil = this.ceiling;
    const dlL = this.dl[0];
    const dlR = this.dl[1];
    const qv = this.qv;
    const qi = this.qi;
    const qcap = qv.length;
    const box = this.box;

    for (let s = 0; s < frames; s++) {
      const xl = inL ? inL[s] : 0;
      const xr = inR ? inR[s] : 0;
      const p = Math.max(Math.abs(xl), Math.abs(xr));
      const n = this.n++;

      // running max over the last L samples
      while (this.qn > 0 && qv[(this.qh + this.qn - 1) % qcap] <= p) this.qn--;
      qv[(this.qh + this.qn) % qcap] = p;
      qi[(this.qh + this.qn) % qcap] = n + L;
      this.qn++;
      while (qi[this.qh] <= n) {
        this.qh = (this.qh + 1) % qcap;
        this.qn--;
      }
      const hold = qv[this.qh];

      const target = hold > ceil ? ceil / hold : 1;
      if (target < this.g) this.g = target;
      else this.g += (target - this.g) * this.rel;

      this.bsum += this.g - box[this.bpos];
      box[this.bpos] = this.g;
      this.bpos = this.bpos + 1 === L ? 0 : this.bpos + 1;
      let gain = this.bsum / L;
      if (gain > 1) gain = 1;

      // delay line: read the oldest sample (L-1 behind), then write the new one
      const rp = this.dpos;
      const yl0 = dlL[rp];
      const yr0 = dlR[rp];
      dlL[rp] = xl;
      dlR[rp] = xr;
      this.dpos = rp + 1 === D ? 0 : rp + 1;

      let yl = yl0 * gain;
      let yr = yr0 * gain;
      if (yl > ceil) yl = ceil;
      else if (yl < -ceil) yl = -ceil;
      if (yr > ceil) yr = ceil;
      else if (yr < -ceil) yr = -ceil;
      outL[s] = yl;
      if (outR) outR[s] = yr;
      if (gain < this.minGain) this.minGain = gain;
    }

    // keep the running box sum from drifting
    if (++this.blocks % 2048 === 0) {
      let sum = 0;
      for (let i = 0; i < L; i++) sum += box[i];
      this.bsum = sum;
    }

    this.sinceReport += frames;
    if (this.sinceReport >= this.reportEvery) {
      this.port.postMessage(this.minGain);
      this.minGain = 1;
      this.sinceReport = 0;
    }
    return true;
  }
}

registerProcessor("music-limiter", MusicLimiter);
