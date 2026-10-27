// The synthesizer engine for "The Synthesizer" (Living Music, part 2).
//
// One AudioWorkletProcessor runs every figure on the page: each figure makes
// its own node and sends it a patch. A voice is one of three sources
//   mode 0  subtractive: two oscillators + noise → 4-pole ladder → amp envelope
//   mode 1  FM: four sine operators in one of a few DX-style algorithms
//   mode 2  Karplus–Strong: a noise burst circulating in a delay line
// plus a global LFO, a soft safety limiter, and telemetry (envelope levels,
// the newest string's delay line, stage scopes) posted back so the figures
// draw what the engine is doing rather than a guess at it.
//
// Plain JS on purpose: the file is loaded with new URL(..., import.meta.url)
// and copied verbatim by Vite, so it can't import anything.

const TAU = Math.PI * 2;
const MAX_VOICES = 12;
const KS_LEN = 4096;
const SCOPE_LEN = 1024;

// ---------------------------------------------------------------- helpers

let seed = 22222;
function rand() {
  // xorshift32, uniform in [0, 1)
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}

function midiHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// 2-point polynomial band-limited step residual, for a jump of +2 (−1 → +1).
// t is the phase in [0,1), dt the phase increment per sample.
function polyblep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

// Its integral: the residual for a unit change of slope (per sample).
function polyblamp(t, dt) {
  if (t < dt) {
    const x = 1 - t / dt;
    return (x * x * x) / 6;
  }
  if (t > 1 - dt) {
    const x = 1 + (t - 1) / dt;
    return (x * x * x) / 6;
  }
  return 0;
}

// waves: 0 sine, 1 triangle, 2 saw, 3 pulse (pw 0.5 = square)
function oscNaive(wave, t, pw) {
  switch (wave) {
    case 0:
      return Math.sin(TAU * t);
    case 1:
      return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
    case 2:
      return 2 * t - 1;
    default:
      return t < pw ? 1 : -1;
  }
}

function oscBlep(wave, t, dt, pw) {
  switch (wave) {
    case 0:
      return Math.sin(TAU * t);
    case 1: {
      let v = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
      let t2 = t + 0.5;
      if (t2 >= 1) t2 -= 1;
      v += 8 * dt * (polyblamp(t, dt) - polyblamp(t2, dt));
      return v;
    }
    case 2:
      return 2 * t - 1 - polyblep(t, dt);
    default: {
      let v = t < pw ? 1 : -1;
      let t2 = t - pw;
      if (t2 < 0) t2 += 1;
      v += polyblep(t, dt) - polyblep(t2, dt);
      return v;
    }
  }
}

// Exact band-limited shapes: the Fourier series summed up to Nyquist with a
// Chebyshev recurrence (one multiply-add per harmonic). Pulses use pw 0.5.
function oscAdditive(wave, t, f, sr) {
  const K = Math.floor((0.5 * sr) / Math.max(f, 1));
  if (wave === 0 || K < 2) return Math.sin(TAU * t);
  const th = TAU * t;
  const c2 = 2 * Math.cos(th);
  if (wave === 1) {
    // −(8/π²) Σ_odd cos(kθ)/k²
    let cPrev = 1;
    let c = Math.cos(th);
    let sum = 0;
    for (let k = 1; k <= K; k++) {
      if (k & 1) sum += c / (k * k);
      const n = c2 * c - cPrev;
      cPrev = c;
      c = n;
    }
    return (-8 / (Math.PI * Math.PI)) * sum;
  }
  let sPrev = 0;
  let s = Math.sin(th);
  let sum = 0;
  if (wave === 2) {
    // 2t − 1 = −(2/π) Σ sin(kθ)/k
    for (let k = 1; k <= K; k++) {
      sum += s / k;
      const n = c2 * s - sPrev;
      sPrev = s;
      s = n;
    }
    return (-2 / Math.PI) * sum;
  }
  // square: (4/π) Σ_odd sin(kθ)/k
  for (let k = 1; k <= K; k++) {
    if (k & 1) sum += s / k;
    const n = c2 * s - sPrev;
    sPrev = s;
    s = n;
  }
  return (4 / Math.PI) * sum;
}

// ---------------------------------------------------------------- envelope
//
// Analog-style curves. Attack heads for 1.5 and stops at 1, so it reaches
// full level in exactly `a` seconds from silence. Decay and release are
// exponentials whose times are the time to close 99.9% of the gap (−60 dB).

const IDLE = 0;
const ATTACK = 1;
const DECAY = 2;
const SUSTAIN = 3;
const RELEASE = 4;
const LN3 = Math.log(3);
const LN1000 = Math.log(1000);

class Env {
  constructor() {
    this.stage = IDLE;
    this.level = 0;
    this.t = 0; // seconds in the current stage
    this.aC = 0;
    this.dC = 0;
    this.rC = 0;
    this.s = 1;
    this.dT = 0.3; // decay time in seconds; the stage ends there
  }
  set(spec, sr, timeScale) {
    const a = Math.max(spec.a * timeScale, 0.0005);
    const d = Math.max(spec.d * timeScale, 0.001);
    const r = Math.max(spec.r * timeScale, 0.002);
    this.aC = 1 - Math.exp(-LN3 / (a * sr));
    this.dC = Math.exp(-LN1000 / (d * sr));
    this.rC = Math.exp(-LN1000 / (r * sr));
    this.s = Math.min(Math.max(spec.s, 0), 1);
    this.dT = d;
  }
  gate() {
    this.stage = ATTACK;
    this.t = 0;
  }
  release() {
    if (this.stage !== IDLE && this.stage !== RELEASE) {
      this.stage = RELEASE;
      this.t = 0;
    }
  }
  next(dtSec) {
    this.t += dtSec;
    switch (this.stage) {
      case ATTACK:
        this.level += (1.5 - this.level) * this.aC;
        if (this.level >= 1) {
          this.level = 1;
          this.stage = DECAY;
          this.t = 0;
        }
        break;
      case DECAY:
        this.level = this.s + (this.level - this.s) * this.dC;
        if (this.t >= this.dT) {
          this.stage = SUSTAIN;
          this.t = 0;
        }
        break;
      case SUSTAIN:
        this.level += (this.s - this.level) * 0.002;
        break;
      case RELEASE:
        this.level *= this.rC;
        if (this.level < 2e-5) {
          this.level = 0;
          this.stage = IDLE;
        }
        break;
    }
    return this.level;
  }
}

// ---------------------------------------------------------------- voice

class Voice {
  constructor() {
    this.id = -1;
    this.active = false;
    this.held = false;
    this.age = 0;
    this.note = 60; // current (gliding) note, fractional midi
    this.target = 60;
    this.vel = 0.8;
    this.e1 = new Env();
    this.e2 = new Env();
    this.ops = [new Env(), new Env(), new Env(), new Env()];
    this.p1 = 0;
    this.p2 = 0;
    this.op = new Float64Array(4); // operator phases
    this.fb1 = 0;
    this.fb2 = 0;
    // ladder state
    this.s1 = 0;
    this.s2 = 0;
    this.s3 = 0;
    this.s4 = 0;
    this.cut = 1000; // last computed cutoff (Hz), for telemetry
    this.g = 0.1;
    this.G = 0.09;
    // Karplus–Strong
    this.buf = new Float32Array(KS_LEN);
    this.tmp = new Float32Array(KS_LEN); // excitation scratch, so a pluck allocates nothing
    this.ex = new Float32Array(KS_LEN);
    this.w = 0;
    this.N = 100;
    this.C = 0;
    this.wgt = 0.5;
    this.apx = 0;
    this.apy = 0;
    this.ksPeak = 0;
    this.ksQuiet = 0;
    this.ksD = 100; // ideal loop length in samples
    this.rho = 1; // loop gain, set per note from the decay time
    this.ksErr = 0; // tuning error in cents (integer-delay mode)
    // last sample from each stage, summed into the scopes
    this.oscOut = 0;
    this.fltOut = 0;
    this.out = 0;
  }
}

// ---------------------------------------------------------------- patch

function defaultPatch() {
  const op = (ratio, lvl, a, d, s, r) => ({ ratio, det: 0, lvl, a, d, s, r });
  return {
    mode: 0,
    poly: 8,
    glide: 0,
    gain: 1,
    velAmt: 0.5,
    bendRange: 2,
    keyScale: 0,
    aa: 1,
    o1: { wave: 2, pw: 0.5, oct: 0, semi: 0, det: 0, lvl: 1 },
    o2: { wave: 2, pw: 0.5, oct: 0, semi: 0, det: 7, lvl: 0 },
    noise: 0,
    flt: { on: 1, cut: 2400, res: 0, poles: 4, env: 0, key: 0.5 },
    e1: { a: 0.005, d: 0.3, s: 0.8, r: 0.35 },
    e2: { a: 0.005, d: 0.5, s: 0.3, r: 0.4 },
    lfo: { wave: 0, rate: 5, pitch: 0, cut: 0, amp: 0, pw: 0, idx: 0, mw: 30 },
    fm: {
      alg: 0,
      fb: 0,
      velIdx: 0.5,
      ops: [op(1, 1, 0.005, 1.5, 0.6, 0.4), op(1, 2, 0.005, 1.0, 0.4, 0.4), op(1, 0, 0.005, 1, 0, 0.3), op(1, 0, 0.005, 1, 0, 0.3)],
    },
    ks: { stretch: 1, decay: 6, bright: 0.85, pick: 0.13, blend: 1, frac: 1 },
  };
}

function merge(dst, src) {
  for (const k in src) {
    const v = src[k];
    if (Array.isArray(v)) {
      if (!Array.isArray(dst[k])) dst[k] = [];
      for (let i = 0; i < v.length; i++) {
        if (v[i] && typeof v[i] === "object") {
          if (!dst[k][i] || typeof dst[k][i] !== "object") dst[k][i] = {};
          merge(dst[k][i], v[i]);
        } else dst[k][i] = v[i];
      }
    } else if (v && typeof v === "object") {
      if (!dst[k] || typeof dst[k] !== "object") dst[k] = {};
      merge(dst[k], v);
    } else dst[k] = v;
  }
}

// ---------------------------------------------------------------- engine

class SynthEngine extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.p = defaultPatch();
    this.voices = [];
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice());
    this.clock = 0; // voice age counter
    this.stack = []; // held ids, for mono/legato mode
    this.bend = 0;
    this.modWheel = 0;
    // LFO
    this.lfoPh = 0;
    this.lfoVal = 0;
    this.lfoSH = 0;
    // smoothed controls
    this.cutS = this.p.flt.cut;
    this.resS = this.p.flt.res;
    this.lvlS = [1, 0, 0];
    // limiter
    this.limEnv = 0;
    this.limGain = 1;
    this.limRel = Math.exp(-1 / (0.15 * this.sr));
    // telemetry
    this.teleEvery = 0; // render quanta between posts; 0 = off
    this.teleCount = 0;
    this.wantScope = false;
    this.wantKs = false;
    this.scope = [new Float32Array(SCOPE_LEN), new Float32Array(SCOPE_LEN), new Float32Array(SCOPE_LEN)];
    this.scopeW = 0;
    this.peak = 0;
    this.newest = null;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    switch (m.type) {
      case "patch":
        merge(this.p, m.patch);
        break;
      case "on":
        this.noteOn(m.id, m.note, m.vel ?? 0.8);
        break;
      case "off":
        this.noteOff(m.id);
        break;
      case "pitch":
        for (const v of this.voices) if (v.active && v.id === m.id) v.target = m.note;
        break;
      case "allOff":
        this.stack.length = 0;
        for (const v of this.voices) if (v.active) this.releaseVoice(v);
        break;
      case "kill":
        this.stack.length = 0;
        for (const v of this.voices) this.silence(v);
        break;
      case "bend":
        this.bend = m.value;
        break;
      case "mod":
        this.modWheel = m.value;
        break;
      case "tele":
        this.teleEvery = m.every ?? 6;
        this.wantScope = !!m.scope;
        this.wantKs = !!m.ks;
        break;
    }
  }

  silence(v) {
    v.active = false;
    v.held = false;
    v.e1.stage = IDLE;
    v.e1.level = 0;
    v.e2.stage = IDLE;
    v.e2.level = 0;
    for (const o of v.ops) {
      o.stage = IDLE;
      o.level = 0;
    }
    v.s1 = v.s2 = v.s3 = v.s4 = 0;
    v.buf.fill(0);
  }

  timeScale(note) {
    // higher notes decay faster when keyScale > 0 (halves per octave at 1)
    return Math.pow(2, (-(note - 60) / 12) * this.p.keyScale);
  }

  pickVoice(id) {
    for (const v of this.voices) if (v.active && v.id === id) return v;
    const n = Math.max(1, Math.min(MAX_VOICES, this.p.poly | 0));
    let free = null;
    let activeCount = 0;
    for (let i = 0; i < n; i++) {
      const v = this.voices[i];
      if (!v.active) {
        if (!free) free = v;
      } else activeCount++;
    }
    if (free) return free;
    // steal: the quietest released voice, else the oldest
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      const v = this.voices[i];
      const lvl = this.p.mode === 1 ? v.ops[0].level : v.e1.level;
      const score = (v.held ? 10 : 0) + lvl + v.age * 1e-9;
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best ?? this.voices[0];
  }

  noteOn(id, note, vel) {
    const p = this.p;
    if (p.poly <= 1) {
      // mono: last-note priority, legato glide while a note is held
      const v = this.voices[0];
      const idx = this.stack.findIndex((s) => s.id === id);
      if (idx >= 0) this.stack.splice(idx, 1);
      this.stack.push({ id, note, vel });
      const legato = v.active && v.held && p.glide > 0;
      v.id = id;
      v.target = note;
      v.vel = vel;
      if (legato) return;
      if (!v.active || p.glide <= 0) v.note = note;
      this.trigger(v, note, vel);
      return;
    }
    const v = this.pickVoice(id);
    v.id = id;
    if (!v.active) v.note = note;
    else if (p.glide <= 0) v.note = note;
    v.target = note;
    v.vel = vel;
    this.trigger(v, note, vel);
  }

  trigger(v, note, vel) {
    const p = this.p;
    const sr = this.sr;
    const wasActive = v.active;
    v.active = true;
    v.held = true;
    v.age = ++this.clock;
    const ts = this.timeScale(note);
    // a string has its own decay; its amp envelope only damps it on release
    v.e1.set(p.mode === 2 ? { a: 0.0005, d: 0.1, s: 1, r: p.e1.r } : p.e1, sr, p.mode === 0 ? 1 : ts);
    v.e2.set(p.e2, sr, 1);
    v.e1.gate();
    v.e2.gate();
    if (p.mode === 1) {
      for (let i = 0; i < 4; i++) {
        v.ops[i].set(p.fm.ops[i], sr, ts);
        v.ops[i].gate();
      }
      if (!wasActive) {
        v.op.fill(0);
        v.fb1 = v.fb2 = 0;
      }
    }
    if (!wasActive) {
      v.p1 = 0;
      v.p2 = 0;
      v.s1 = v.s2 = v.s3 = v.s4 = 0;
    }
    if (p.mode === 2) this.pluck(v, note, vel);
    this.newest = v;
  }

  // Load the delay line with a fresh excitation (Karplus & Strong 1983, with
  // the Jaffe & Smith 1983 refinements: tuned fractional delay, decay
  // stretching, pick position, and a softer or harder pluck).
  pluck(v, note, vel) {
    const k = this.p.ks;
    const sr = this.sr;
    const f = midiHz(note);
    this.tuneString(v, f);
    const N = v.N;
    // two-level random burst, as in the paper, then a one-pole lowpass for
    // pluck hardness and a comb for where along the string it was picked
    const len = N + 2;
    const tmp = v.tmp;
    const bright = Math.min(Math.max(k.bright, 0.02), 1);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = rand() < 0.5 ? -1 : 1;
      lp += (x - lp) * bright;
      tmp[i] = lp;
    }
    const M = Math.max(1, Math.round(Math.min(Math.max(k.pick, 0), 0.5) * N));
    const ex = v.ex;
    for (let i = 0; i < len; i++) ex[i] = tmp[i] - (k.pick > 0.001 ? (i >= M ? tmp[i - M] : 0) : 0);
    let mean = 0;
    for (let i = 0; i < len; i++) mean += ex[i];
    mean /= len;
    let rms = 0;
    for (let i = 0; i < len; i++) {
      ex[i] -= mean;
      rms += ex[i] * ex[i];
    }
    rms = Math.sqrt(rms / len) || 1;
    const amp = (0.55 / rms) * (1 - this.p.velAmt + this.p.velAmt * vel);
    // newest sample sits just behind the write head
    for (let i = 0; i < len; i++) {
      const pos = (v.w - len + i + KS_LEN * 4) % KS_LEN;
      v.buf[pos] = ex[i] * amp;
    }
    v.apx = 0;
    v.apy = 0;
    v.ksPeak = 1;
    v.ksQuiet = 0;
  }

  // Integer delay N, the loop filter's phase delay, and a first-order allpass
  // for the fraction left over, so the loop is exactly fs/f samples long at
  // the fundamental. With frac off, the allpass is skipped and N is rounded.
  tuneString(v, f) {
    const k = this.p.ks;
    const sr = this.sr;
    const S = Math.max(1, k.stretch);
    const w = 1 / (2 * S); // loop filter (1−w) + w·z⁻¹; w = ½ is the plain average
    v.wgt = w;
    const D = sr / f;
    const om = (TAU * f) / sr;
    const P1 = Math.atan2(w * Math.sin(om), 1 - w + w * Math.cos(om)) / om;
    v.ksD = D;
    // loop gain for the requested decay: the fundamental loses 60 dB in
    // `decay` seconds (Jaffe & Smith's decay shortening). 30 s or more means
    // leave the loop lossless and let the averaging filter set the decay.
    const g1 = Math.hypot(1 - w + w * Math.cos(om), w * Math.sin(om));
    v.rho = k.decay >= 30 ? 1 : Math.min(1, Math.pow(0.001, 1 / (k.decay * f)) / g1);
    if (k.frac) {
      let N = Math.floor(D - P1 - 0.1);
      N = Math.max(2, Math.min(KS_LEN - 4, N));
      const d = D - P1 - N; // in [0.1, 1.1)
      v.N = N;
      v.C = Math.sin((om * (1 - d)) / 2) / Math.sin((om * (1 + d)) / 2);
      v.ksErr = 0;
    } else {
      let N = Math.round(D - P1);
      N = Math.max(2, Math.min(KS_LEN - 4, N));
      v.N = N;
      v.C = 0; // allpass with C = 0 is a pure one-sample delay; we bypass it below
      v.ksErr = 1200 * Math.log2(D / (N + P1));
    }
  }

  noteOff(id) {
    const p = this.p;
    if (p.poly <= 1) {
      const idx = this.stack.findIndex((s) => s.id === id);
      if (idx >= 0) this.stack.splice(idx, 1);
      const v = this.voices[0];
      if (v.id !== id) return;
      if (this.stack.length > 0) {
        const top = this.stack[this.stack.length - 1];
        v.id = top.id;
        v.target = top.note;
        if (p.glide <= 0) {
          v.note = top.note;
          this.trigger(v, top.note, top.vel);
        }
        return;
      }
      this.releaseVoice(v);
      return;
    }
    for (const v of this.voices) if (v.active && v.id === id && v.held) this.releaseVoice(v);
  }

  releaseVoice(v) {
    v.held = false;
    v.e1.release();
    v.e2.release();
    for (const o of v.ops) o.release();
  }

  lfoStep(inc) {
    const l = this.p.lfo;
    this.lfoPh += inc;
    if (this.lfoPh >= 1) {
      this.lfoPh -= Math.floor(this.lfoPh);
      this.lfoSH = rand() * 2 - 1;
    }
    const ph = this.lfoPh;
    switch (l.wave | 0) {
      case 0:
        return Math.sin(TAU * ph);
      case 1: {
        // starts at 0 heading up, like the sine
        let q = ph + 0.25;
        if (q >= 1) q -= 1;
        return 1 - 4 * Math.abs(q - 0.5);
      }
      case 2:
        return 2 * ph - 1;
      case 3:
        return ph < 0.5 ? 1 : -1;
      default:
        return this.lfoSH;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out.length > 1 ? out[1] : null;
    const n = L.length;
    const p = this.p;
    const sr = this.sr;
    const dtSec = 1 / sr;
    const mode = p.mode | 0;
    const flt = p.flt;
    const lfo = p.lfo;
    const lfoInc = lfo.rate / sr;
    const glideC = p.glide > 0 ? 1 - Math.exp(-1 / (p.glide * 0.35 * sr)) : 1;
    const smooth = 1 - Math.exp(-1 / (0.008 * sr)); // ~8 ms control smoothing
    const voiceGain = 0.22 * p.gain;
    const nyq = 0.5 * sr;
    const scopeOn = this.wantScope;
    const sc0 = this.scope[0];
    const sc1 = this.scope[1];
    const sc2 = this.scope[2];
    const fmAlg = p.fm.alg | 0;
    const fb = p.fm.fb;
    const velIdx = p.fm.velIdx;
    const ks = p.ks;
    const blend = ks.blend;

    for (let i = 0; i < n; i++) {
      const lv = this.lfoStep(lfoInc);
      this.lfoVal = lv;
      // smoothed knobs
      this.cutS += (flt.cut - this.cutS) * smooth;
      this.resS += (flt.res - this.resS) * smooth;
      this.lvlS[0] += (p.o1.lvl - this.lvlS[0]) * smooth;
      this.lvlS[1] += (p.o2.lvl - this.lvlS[1]) * smooth;
      this.lvlS[2] += (p.noise - this.lvlS[2]) * smooth;

      const pitchMod = (lv * lfo.pitch + lv * lfo.mw * this.modWheel) / 100 + this.bend * p.bendRange;
      let mix = 0;
      let mixOsc = 0;
      let mixFlt = 0;

      for (let vi = 0; vi < MAX_VOICES; vi++) {
        const v = this.voices[vi];
        if (!v.active) continue;
        if (v.note !== v.target) {
          v.note += (v.target - v.note) * glideC;
          if (Math.abs(v.target - v.note) < 1e-4) v.note = v.target;
        }
        const noteNow = v.note + pitchMod;
        const f0 = 440 * Math.pow(2, (noteNow - 69) / 12);
        const velGain = 1 - p.velAmt + p.velAmt * v.vel;
        let s = 0;

        if (mode === 2) {
          // ---- Karplus–Strong ----
          const e1 = v.e1.next(dtSec);
          const N = v.N;
          const buf = v.buf;
          const r1 = (v.w - N + KS_LEN) % KS_LEN;
          const r2 = (r1 - 1 + KS_LEN) % KS_LEN;
          let y = (1 - v.wgt) * buf[r1] + v.wgt * buf[r2];
          if (ks.frac) {
            const ap = v.C * y + v.apx - v.C * v.apy;
            v.apx = y;
            v.apy = ap;
            y = ap;
          }
          y *= v.rho;
          if (blend < 1 && rand() >= blend) y = -y;
          buf[v.w] = y;
          v.w = (v.w + 1) % KS_LEN;
          const a = Math.abs(y);
          if (a > v.ksPeak) v.ksPeak = a;
          v.ksQuiet = a < 1e-4 ? v.ksQuiet + 1 : 0;
          s = y * e1;
          v.oscOut = y;
          v.fltOut = y;
          if (v.e1.stage === IDLE || v.ksQuiet > N * 3 + 64) {
            this.silence(v);
            continue;
          }
          v.e2.next(dtSec);
        } else if (mode === 1) {
          // ---- FM (phase modulation, as in Chowning 1973 and the DX7) ----
          const ops = v.ops;
          const po = p.fm.ops;
          const vIdx = 1 - velIdx + velIdx * v.vel;
          const e0 = ops[0].next(dtSec);
          const e1o = ops[1].next(dtSec);
          const e2o = ops[2].next(dtSec);
          const e3o = ops[3].next(dtSec);
          v.e1.next(dtSec);
          v.e2.next(dtSec);
          const idxMod = 1 + lv * lfo.idx;
          for (let k = 0; k < 4; k++) {
            v.op[k] += (f0 * po[k].ratio + po[k].det) / sr;
            if (v.op[k] >= 1) v.op[k] -= Math.floor(v.op[k]);
          }
          const fbIn = fb * 0.5 * (v.fb1 + v.fb2);
          let out = 0;
          if (fmAlg === 0) {
            // 2 → 1
            const m2 = po[1].lvl * e1o * vIdx * idxMod * Math.sin(TAU * v.op[1] + fbIn);
            v.fb2 = v.fb1;
            v.fb1 = m2;
            out = po[0].lvl * e0 * Math.sin(TAU * v.op[0] + m2);
            v.oscOut = m2 / Math.max(po[1].lvl, 1e-3);
          } else if (fmAlg === 1) {
            // 2 → 1  +  4 → 3
            const m2 = po[1].lvl * e1o * vIdx * idxMod * Math.sin(TAU * v.op[1]);
            const m4 = po[3].lvl * e3o * vIdx * idxMod * Math.sin(TAU * v.op[3] + fbIn);
            v.fb2 = v.fb1;
            v.fb1 = m4;
            out = po[0].lvl * e0 * Math.sin(TAU * v.op[0] + m2) + po[2].lvl * e2o * Math.sin(TAU * v.op[2] + m4);
            v.oscOut = m2 / Math.max(po[1].lvl, 1e-3);
          } else {
            // 3 → 2 → 1
            const m3 = po[2].lvl * e2o * vIdx * idxMod * Math.sin(TAU * v.op[2] + fbIn);
            v.fb2 = v.fb1;
            v.fb1 = m3;
            const m2 = po[1].lvl * e1o * vIdx * idxMod * Math.sin(TAU * v.op[1] + m3);
            out = po[0].lvl * e0 * Math.sin(TAU * v.op[0] + m2);
            v.oscOut = m2 / Math.max(po[1].lvl, 1e-3);
          }
          s = out;
          let alive = ops[0].stage !== IDLE;
          if (fmAlg === 1) alive = alive || ops[2].stage !== IDLE;
          if (!alive) {
            this.silence(v);
            continue;
          }
          v.fltOut = s;
        } else {
          // ---- subtractive: two oscillators + noise ----
          const e1 = v.e1.next(dtSec);
          v.e2.next(dtSec);
          const pwm = lv * lfo.pw;
          const f1 = f0 * Math.pow(2, p.o1.oct + p.o1.semi / 12 + p.o1.det / 1200);
          const f2 = f0 * Math.pow(2, p.o2.oct + p.o2.semi / 12 + p.o2.det / 1200);
          const dt1 = Math.min(f1 / sr, 0.49);
          const dt2 = Math.min(f2 / sr, 0.49);
          v.p1 += dt1;
          if (v.p1 >= 1) v.p1 -= 1;
          v.p2 += dt2;
          if (v.p2 >= 1) v.p2 -= 1;
          const pw1 = Math.min(Math.max(p.o1.pw + pwm, 0.02), 0.98);
          const pw2 = Math.min(Math.max(p.o2.pw + pwm, 0.02), 0.98);
          let o = 0;
          if (this.lvlS[0] > 1e-4) {
            const w = p.o1.wave | 0;
            o +=
              this.lvlS[0] *
              (p.aa === 0 ? oscNaive(w, v.p1, pw1) : p.aa === 2 ? oscAdditive(w, v.p1, f1, sr) : oscBlep(w, v.p1, dt1, pw1));
          }
          if (this.lvlS[1] > 1e-4) {
            const w = p.o2.wave | 0;
            o +=
              this.lvlS[1] *
              (p.aa === 0 ? oscNaive(w, v.p2, pw2) : p.aa === 2 ? oscAdditive(w, v.p2, f2, sr) : oscBlep(w, v.p2, dt2, pw2));
          }
          if (this.lvlS[2] > 1e-4) o += this.lvlS[2] * (rand() * 2 - 1);
          v.oscOut = o;

          let y = o;
          if (flt.on) {
            // cutoff: knob × envelope × keyboard tracking × LFO, in octaves
            if ((i & 7) === 0) {
              const oct = flt.env * v.e2.level + flt.key * ((v.note - 60) / 12) + lfo.cut * lv;
              let fc = this.cutS * Math.pow(2, oct);
              fc = Math.min(Math.max(fc, 16), nyq * 0.92);
              v.cut = fc;
              v.g = Math.tan((Math.PI * fc) / sr);
              v.G = v.g / (1 + v.g);
            }
            // 4-pole ladder, zero-delay feedback (Zavalishin's TPT form). The
            // feedback loop is solved exactly for the linear part; tanh on
            // the input keeps self-oscillation bounded.
            const G = v.G;
            const b = 1 / (1 + v.g);
            const k = this.resS;
            const G2 = G * G;
            const G4 = G2 * G2;
            const S = G2 * G * b * v.s1 + G2 * b * v.s2 + G * b * v.s3 + b * v.s4;
            const xin = o * 0.5;
            const y4p = (G4 * xin + S) / (1 + k * G4);
            let u = xin - k * y4p;
            u = Math.tanh(u);
            let t = (u - v.s1) * G;
            const y1 = t + v.s1;
            v.s1 = y1 + t;
            t = (y1 - v.s2) * G;
            const y2 = t + v.s2;
            v.s2 = y2 + t;
            t = (y2 - v.s3) * G;
            const y3 = t + v.s3;
            v.s3 = y3 + t;
            t = (y3 - v.s4) * G;
            const y4 = t + v.s4;
            v.s4 = y4 + t;
            const poles = flt.poles | 0;
            const tap = poles === 1 ? y1 : poles === 2 ? y2 : poles === 3 ? y3 : y4;
            // the ladder loses bass as resonance rises; give some of it back
            y = tap * 2 * (1 + 0.5 * k);
          }
          v.fltOut = y;
          const trem = 1 - lfo.amp * (0.5 - 0.5 * lv);
          s = y * e1 * trem;
          if (v.e1.stage === IDLE) {
            this.silence(v);
            continue;
          }
        }
        s *= velGain;
        v.out = s;
        mix += s;
        if (scopeOn) {
          mixOsc += v.oscOut;
          mixFlt += v.fltOut;
        }
      }

      // safety: an instant-attack peak limiter at −3 dBFS, then a soft clip
      let x = mix * voiceGain;
      const a = Math.abs(x);
      this.limEnv = a > this.limEnv ? a : this.limEnv * this.limRel;
      const thr = 0.7;
      const g = this.limEnv > thr ? thr / this.limEnv : 1;
      x *= g;
      if (x > 0.95) x = 0.95 + 0.05 * Math.tanh((x - 0.95) * 20);
      else if (x < -0.95) x = -0.95 + 0.05 * Math.tanh((x + 0.95) * 20);
      L[i] = x;
      if (R) R[i] = x;
      if (a > this.peak) this.peak = a;
      if (scopeOn) {
        sc0[this.scopeW] = mixOsc;
        sc1[this.scopeW] = mixFlt;
        sc2[this.scopeW] = x;
        this.scopeW = (this.scopeW + 1) % SCOPE_LEN;
      }
    }

    if (this.teleEvery > 0 && ++this.teleCount >= this.teleEvery) {
      this.teleCount = 0;
      this.postTelemetry();
    }
    return true;
  }

  postTelemetry() {
    const voices = [];
    for (const v of this.voices) {
      if (!v.active) continue;
      voices.push({
        id: v.id,
        note: v.note,
        vel: v.vel,
        held: v.held,
        age: v.age,
        e1: v.e1.level,
        s1: v.e1.stage,
        t1: v.e1.t,
        e2: v.e2.level,
        s2: v.e2.stage,
        t2: v.e2.t,
        ops: [v.ops[0].level, v.ops[1].level, v.ops[2].level, v.ops[3].level],
        opSt: [v.ops[0].stage, v.ops[1].stage, v.ops[2].stage, v.ops[3].stage],
        cut: v.cut,
      });
    }
    const msg = {
      type: "tele",
      time: currentTime,
      voices,
      lfo: this.lfoVal,
      lfoPh: this.lfoPh,
      peak: this.peak,
      limit: this.limEnv > 0.7 ? 0.7 / this.limEnv : 1,
    };
    this.peak = 0;
    const transfer = [];
    if (this.wantScope) {
      const len = 512;
      const sc = [];
      for (let s = 0; s < 3; s++) {
        const a = new Float32Array(len);
        for (let i = 0; i < len; i++) a[i] = this.scope[s][(this.scopeW - len + i + SCOPE_LEN) % SCOPE_LEN];
        sc.push(a);
        transfer.push(a.buffer);
      }
      msg.scope = sc;
    }
    if (this.wantKs && this.p.mode === 2) {
      // the newest sounding string, oldest sample first
      let v = null;
      for (const c of this.voices) if (c.active && (!v || c.age > v.age)) v = c;
      if (v) {
        const len = v.N + 1;
        const a = new Float32Array(len);
        for (let i = 0; i < len; i++) a[i] = v.buf[(v.w - len + i + KS_LEN) % KS_LEN];
        msg.ks = { data: a, N: v.N, C: v.C, w: v.wgt, D: v.ksD, err: v.ksErr, rho: v.rho, note: v.note, age: v.age };
        transfer.push(a.buffer);
      }
    }
    this.port.postMessage(msg, transfer);
  }
}

registerProcessor("synth-engine", SynthEngine);
