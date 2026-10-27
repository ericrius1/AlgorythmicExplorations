// Polyphonic plucked strings (extended Karplus–Strong, after Jaffe & Smith 1983).
//
// Each voice is a delay line closed by a loop filter:
//   one-zero low-pass  (1-S)·x[n] + S·x[n-1]   high partials lose more per trip
//   first-order allpass                        fractional delay, so it's in tune
//   loop gain g                                sets the decay time (T60)
// The delay line starts filled with a noise burst that's been low-passed
// (softer pluck = darker) and comb-filtered at the pick position.
//
// Messages (port):
//   { t: "pluck", id, freq, vel, time, t60, bright, pick, pan }
//   { t: "damp", id, time, t60 }       key up: shorter decay
//   { t: "stop" }                      silence everything
// `time` is AudioContext time; events land on the exact sample.

const MAX_LEN = 4096;

class Voice {
  constructor() {
    this.buf = new Float32Array(MAX_LEN);
    this.tmp = new Float32Array(MAX_LEN);
    this.active = false;
    this.id = -1;
    this.age = 0;
  }

  setup(freq, t60, bright) {
    const D = sampleRate / freq;
    this.S = 0.5 - 0.44 * Math.min(1, Math.max(0, bright));
    let N = Math.floor(D - this.S - 0.2);
    if (N > MAX_LEN - 1) N = MAX_LEN - 1;
    if (N < 2) N = 2;
    const delta = D - this.S - N;
    this.N = N;
    this.C = (1 - delta) / (1 + delta);
    this.freq = freq;
    this.setDecay(t60);
  }

  setDecay(t60) {
    // per-period multiplier for the fundamental, divided by the loss filter's gain there
    const m = Math.pow(10, -3 / (Math.max(t60, 0.02) * this.freq));
    const w = (2 * Math.PI * this.freq) / sampleRate;
    const re = 1 - this.S + this.S * Math.cos(w);
    const im = -this.S * Math.sin(w);
    const h = Math.sqrt(re * re + im * im);
    this.g = Math.min(0.99995, m / Math.max(h, 1e-6));
  }

  pluck(vel, pick, add) {
    const N = this.N;
    const buf = this.buf;
    // excitation: noise, low-passed by velocity, comb-filtered at the pick point
    const a = 0.12 + 0.8 * vel * vel; // one-pole coefficient: harder = brighter
    let lp = 0;
    const tmp = this.tmp;
    let mean = 0;
    for (let i = 0; i < N; i++) {
      lp += (Math.random() * 2 - 1 - lp) * a;
      tmp[i] = lp;
    }
    const P = Math.max(1, Math.round(pick * N));
    for (let i = N - 1; i >= P; i--) tmp[i] -= tmp[i - P];
    for (let i = 0; i < N; i++) mean += tmp[i];
    mean /= N;
    let peak = 1e-9;
    for (let i = 0; i < N; i++) {
      tmp[i] -= mean;
      peak = Math.max(peak, Math.abs(tmp[i]));
    }
    const amp = (0.25 + 0.75 * vel) / peak;
    if (add) {
      for (let i = 0; i < N; i++) buf[(this.pos + i) % N] = buf[(this.pos + i) % N] * 0.5 + tmp[i] * amp;
    } else {
      for (let i = 0; i < N; i++) buf[i] = tmp[i] * amp;
      this.pos = 0;
      this.x1 = 0;
      this.ap1in = 0;
      this.ap1out = 0;
    }
    this.active = true;
    this.quiet = 0;
    this.level = 1;
  }

  // render `n` samples, adding into L/R starting at `off`
  render(L, R, off, n) {
    const buf = this.buf;
    const N = this.N;
    const S = this.S;
    const C = this.C;
    const g = this.g;
    let pos = this.pos;
    let x1 = this.x1;
    let apIn = this.ap1in;
    let apOut = this.ap1out;
    const gl = this.gl;
    const gr = this.gr;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const x = buf[pos];
      const lp = (1 - S) * x + S * x1;
      x1 = x;
      const ap = C * lp + apIn - C * apOut;
      apIn = lp;
      apOut = ap;
      buf[pos] = g * ap;
      pos++;
      if (pos === N) pos = 0;
      L[off + i] += x * gl;
      R[off + i] += x * gr;
      const ax = x < 0 ? -x : x;
      if (ax > peak) peak = ax;
    }
    this.pos = pos;
    this.x1 = x1;
    this.ap1in = apIn;
    this.ap1out = apOut;
    this.level = Math.max(peak, this.level * 0.9);
    // free the voice after ~a period of near-silence
    if (peak < 2e-5) {
      this.quiet += n;
      if (this.quiet > N + 256) this.active = false;
    } else this.quiet = 0;
  }
}

class Strings extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const count = o.voices || 12;
    this.voices = [];
    for (let i = 0; i < count; i++) this.voices.push(new Voice());
    this.queue = [];
    this.clock = 0;
    this.dcx = [0, 0];
    this.dcy = [0, 0];
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === "stop") {
        this.queue.length = 0;
        for (const v of this.voices) v.active = false;
        return;
      }
      this.queue.push(m);
      this.queue.sort((a, b) => a.time - b.time);
    };
  }

  handle(m) {
    if (m.t === "pluck") {
      let v = this.voices.find((x) => x.active && x.id === m.id);
      const again = !!v;
      if (!v) v = this.voices.find((x) => !x.active);
      if (!v) {
        // steal the quietest
        v = this.voices[0];
        for (const x of this.voices) if (x.level < v.level) v = x;
      }
      v.id = m.id;
      v.age = this.clock++;
      v.setup(m.freq, m.t60, m.bright);
      const pan = Math.max(-1, Math.min(1, m.pan || 0));
      v.gl = Math.cos(((pan + 1) * Math.PI) / 4);
      v.gr = Math.sin(((pan + 1) * Math.PI) / 4);
      v.pluck(m.vel, m.pick, again);
    } else if (m.t === "damp") {
      for (const v of this.voices) if (v.active && v.id === m.id) v.setDecay(m.t60);
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out.length > 1 ? out[1] : new Float32Array(L.length);
    const frames = L.length;
    L.fill(0);
    R.fill(0);
    let off = 0;
    while (off < frames) {
      // next event inside this block?
      let until = frames;
      if (this.queue.length) {
        const at = Math.round((this.queue[0].time - currentTime) * sampleRate);
        if (at <= off) {
          this.handle(this.queue.shift());
          continue;
        }
        if (at < frames) until = at;
      }
      const n = until - off;
      for (const v of this.voices) if (v.active) v.render(L, R, off, n);
      off = until;
    }
    // DC blocker
    for (let c = 0; c < 2; c++) {
      const ch = c === 0 ? L : R;
      let x1 = this.dcx[c];
      let y1 = this.dcy[c];
      for (let i = 0; i < frames; i++) {
        const y = ch[i] - x1 + 0.9975 * y1;
        x1 = ch[i];
        y1 = y;
        ch[i] = y;
      }
      this.dcx[c] = x1;
      this.dcy[c] = y1;
    }
    return true;
  }
}

registerProcessor("music-strings", Strings);
