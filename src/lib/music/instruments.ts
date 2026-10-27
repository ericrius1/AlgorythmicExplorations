// Instrument presets for the music series.
//
// Voices are built per note from native Web Audio nodes on Tone's context, with
// analytic envelopes (true exponential decays, per-note FM index and key
// tracking, click-free releases); Tone supplies the effects and the buses.
// Every instrument feeds masterBus() (so it goes through the master chain)
// plus a send into the shared reverb.
//
//   const ep = createInstrument("epiano");
//   ep.noteOn(60, 0.8);  ep.noteOff(60);
//   ep.play([60, 64, 67], 1.5, time);       // `time` = AudioContext seconds

import * as Tone from "tone";
import { masterBus, midiToFreq } from "../audio";
import { connectOut } from "./master";
import { registerVoice } from "./lifecycle";

export type PresetName = "epiano" | "pluck" | "pad" | "bass" | "bell" | "organ" | "marimba" | "sine";

export const PRESETS: Record<PresetName, { label: string; description: string }> = {
  epiano: { label: "Electric piano", description: "FM tine piano: bright when struck hard, mellow when soft, gentle stereo tremolo." },
  pluck: { label: "Plucked string", description: "Karplus–Strong string: a noise burst circulating in a tuned delay line." },
  pad: { label: "Warm pad", description: "Three detuned saws per note through a slowly opening low-pass, with chorus." },
  bass: { label: "Bass", description: "Saw + square + sub-octave sine, filter envelope, mono with glide between held notes." },
  bell: { label: "Bell", description: "Two-operator FM at a 1 : 3.5 ratio: inharmonic strike that decays to a pure tone." },
  organ: { label: "Organ", description: "Drawbar-style additive organ (16′ 8′ 4′ 2⅔′ 2′ …) with rotary vibrato." },
  marimba: { label: "Marimba", description: "Sine bar with its tuned 4th-harmonic overtone and a short mallet click." },
  sine: { label: "Sine", description: "A clean sine with a soft envelope: one partial, for tuning and spectrum lessons." },
};

export interface Instrument {
  readonly preset: PresetName;
  /** Volume stage (dB via .volume). Already connected to masterBus() + reverb send. */
  readonly output: Tone.Gain;
  /** Notes currently held or sounding from play(). */
  readonly sounding: ReadonlySet<number>;
  /** Output level in dB (default per preset, adjusted by opts.volume). */
  volume: number;
  /** Start a note. midi may be fractional. velocity 0..1 (default 0.8). time: AudioContext s (default now). */
  noteOn(midi: number, velocity?: number, time?: number): void;
  noteOff(midi: number, time?: number): void;
  /** Play note(s) for `duration` seconds. */
  play(midi: number | number[], duration: number, time?: number, velocity?: number): void;
  releaseAll(time?: number): void;
  /** Builds the audio nodes now and resolves once worklet-backed voices (pluck) are ready. */
  ready(): Promise<void>;
  /** Reverb send level 0..1. */
  setReverb(amount: number): void;
  /** Re-route the output (disconnects from the master bus and reverb). */
  connect(dest: Tone.InputNode): this;
  dispose(): void;
}

export interface InstrumentOptions {
  /** dB added to the preset's level. */
  volume?: number;
  /** Reverb send 0..1 (default per preset). */
  reverb?: number;
  /** Connect here instead of masterBus() (no reverb send then). */
  destination?: Tone.InputNode;
  /** Max simultaneous voices (default per preset). */
  polyphony?: number;
}

// ---- small helpers -------------------------------------------------------------

type Ctx = AudioContext;
const ctxOf = (): Ctx => Tone.getContext().rawContext as unknown as Ctx;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** velocity → linear gain over a `range` dB span (vel 1 = 0 dB). */
const velGain = (v: number, range = 24): number => Math.pow(10, (-(1 - clamp(v, 0, 1)) * range) / 20);
/** halves per `per` semitones above `center`, clamped. */
const keyTrack = (midi: number, base: number, center: number, per: number, lo: number, hi: number): number =>
  clamp(base * Math.pow(2, -(midi - center) / per), lo, hi);

/**
 * Attack → exponential decay → sustain envelope on an AudioParam, with an
 * analytic value so a release can start from exactly where the curve is.
 * Works the same in every browser (no cancelAndHoldAtTime needed).
 */
class Env {
  private relAt = Infinity;
  private relFrom = 0;
  private relTau = 1;
  end = Infinity;
  constructor(
    private p: AudioParam,
    private t0: number,
    private peak: number,
    private a: number,
    private tau: number,
    private sus: number,
    private from = 0,
  ) {
    p.cancelScheduledValues(t0);
    p.setValueAtTime(from, t0);
    p.linearRampToValueAtTime(peak, t0 + a);
    if (tau > 0) p.setTargetAtTime(sus, t0 + a, tau);
    if (sus <= 0 && tau > 0) this.end = t0 + a + tau * 9;
  }

  /** The curve's value at time x (follows the release once one is scheduled). */
  valueAt(x: number): number {
    if (x >= this.relAt) return this.relFrom * Math.exp(-(x - this.relAt) / this.relTau);
    if (x <= this.t0) return this.from;
    if (x < this.t0 + this.a) return this.from + ((this.peak - this.from) * (x - this.t0)) / this.a;
    if (this.tau <= 0) return this.peak;
    return this.sus + (this.peak - this.sus) * Math.exp(-(x - this.t0 - this.a) / this.tau);
  }

  /** Release from wherever the curve is at `tr`; returns when it's ~silent. */
  release(tr: number, relTau: number): number {
    if (this.relAt < Infinity) return this.end;
    const t = Math.max(tr, this.t0);
    const v = this.valueAt(t);
    this.p.cancelScheduledValues(t);
    if (t < this.t0 + this.a) this.p.linearRampToValueAtTime(v, t);
    else this.p.setValueAtTime(v, t);
    this.p.setTargetAtTime(0, t, relTau);
    this.relAt = t;
    this.relFrom = v;
    this.relTau = relTau;
    this.end = Math.min(this.end, t + relTau * 8);
    return this.end;
  }
}

/** The nodes of one sounding note; stops its sources and disconnects when done. */
class NoteNodes {
  readonly sources: AudioScheduledSourceNode[] = [];
  readonly nodes: AudioNode[] = [];
  readonly envs: Env[] = [];
  private stopAt = Infinity;

  constructor(readonly t0: number) {}

  osc(ctx: Ctx, type: OscillatorType | PeriodicWave, freq: number, detuneCents = 0): OscillatorNode {
    const o = ctx.createOscillator();
    if (typeof type === "string") o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.value = freq;
    if (detuneCents) o.detune.value = detuneCents;
    o.start(this.t0);
    this.sources.push(o);
    return o;
  }

  gain(ctx: Ctx, value = 0): GainNode {
    const g = ctx.createGain();
    g.gain.value = value;
    this.nodes.push(g);
    return g;
  }

  env(p: AudioParam, peak: number, a: number, tau: number, sus: number): Env {
    const e = new Env(p, this.t0, peak, a, tau, sus);
    this.envs.push(e);
    return e;
  }

  /** Schedule all sources to stop at `t` (later calls replace earlier ones). */
  stop(t: number): void {
    if (t >= this.stopAt) return;
    this.stopAt = t;
    for (const s of this.sources) {
      try {
        s.stop(t);
      } catch {
        /* already stopped */
      }
    }
    const last = this.sources[0];
    if (last) {
      last.onended = () => {
        for (const n of [...this.sources, ...this.nodes]) n.disconnect();
      };
    }
  }
}

/** One playing note as the instrument sees it. */
interface Note {
  midi: number;
  start: number;
  /** Begin the release at `t`; returns when the note is silent. */
  release(t: number): number;
  /** Fast fade (voice stealing). */
  kill(t: number): void;
  end: number;
}

/** A voice engine: builds a note on `out`. */
interface Engine {
  maxVoices: number;
  start(midi: number, vel: number, t: number, out: AudioNode): Note;
  dispose?(): void;
}

// ---- per-note engines ------------------------------------------------------------

function noteFromNodes(midi: number, n: NoteNodes, amp: Env, relTau: number, extra: Env[] = []): Note {
  const note: Note = {
    midi,
    start: n.t0,
    end: amp.end,
    release(t) {
      const end = amp.release(t, relTau);
      for (const e of extra) e.release(t, relTau);
      n.stop(end);
      note.end = end;
      return end;
    },
    kill(t) {
      const end = amp.release(t, 0.004);
      n.stop(end);
      note.end = end;
    },
  };
  if (amp.end < Infinity) n.stop(amp.end);
  return note;
}

const epiano: Engine = {
  maxVoices: 16,
  start(midi, vel, t, out) {
    const ctx = ctxOf();
    const f = midiToFreq(midi);
    const n = new NoteNodes(t);
    const amp = n.gain(ctx);
    amp.connect(out);
    const level = 0.32 * velGain(vel, 26);
    const decay = keyTrack(midi, 1.5, 60, 18, 0.35, 4);
    const ampEnv = n.env(amp.gain, level, 0.0025, decay, 0);

    // body: carrier f, modulator f (ratio 1); index decays → bark, then mellow
    const hi = clamp((midi - 72) / 30, 0, 1);
    const index = (0.5 + 3.4 * Math.pow(vel, 1.6)) * (1 - 0.6 * hi);
    const car = n.osc(ctx, "sine", f);
    const mod = n.osc(ctx, "sine", f);
    const modGain = n.gain(ctx);
    mod.connect(modGain).connect(car.frequency);
    n.env(modGain.gain, index * f, 0.002, 0.28 + 0.25 * (1 - vel), index * f * 0.18);
    car.connect(amp);

    // tine: carrier f, modulator 14 f, fast decay — the metallic "ping"
    const tine = n.gain(ctx);
    tine.connect(amp);
    const car2 = n.osc(ctx, "sine", f);
    const mod2 = n.osc(ctx, "sine", f * 14);
    const mod2Gain = n.gain(ctx);
    mod2.connect(mod2Gain).connect(car2.frequency);
    const tineIndex = (0.4 + 1.6 * vel) * (1 - 0.85 * hi);
    n.env(mod2Gain.gain, tineIndex * f * 14, 0.001, 0.035, 0);
    n.env(tine.gain, 0.35 * vel, 0.001, 0.22, 0);
    car2.connect(tine);
    return noteFromNodes(midi, n, ampEnv, 0.07);
  },
};

const pad: Engine = {
  maxVoices: 10,
  start(midi, vel, t, out) {
    const ctx = ctxOf();
    const f = midiToFreq(midi);
    const n = new NoteNodes(t);
    const amp = n.gain(ctx);
    amp.connect(out);
    const level = 0.1 * velGain(vel, 14);
    const ampEnv = n.env(amp.gain, level, 0.55, 1.2, level * 0.8);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.6;
    n.nodes.push(lp);
    const lp2 = ctx.createBiquadFilter();
    lp2.type = "lowpass";
    lp2.Q.value = 0.5;
    n.nodes.push(lp2);
    lp.connect(lp2).connect(amp);
    // cutoff opens slowly from just above the note to a velocity-set ceiling
    const lo = Math.min(f * 1.5 + 180, 6000);
    const top = Math.min(lo + 900 + 2200 * vel, 9000);
    for (const fl of [lp, lp2]) {
      fl.frequency.setValueAtTime(lo, t);
      fl.frequency.setTargetAtTime(top, t, 0.9);
      fl.frequency.setTargetAtTime((lo + top) * 0.5, t + 2.2, 2.5);
    }
    // three detuned saws spread across the stereo field, plus a quiet sub
    const pans = [-0.7, 0, 0.7];
    const det = [-11, 1, 12];
    for (let i = 0; i < 3; i++) {
      const o = n.osc(ctx, "sawtooth", f, det[i]);
      const p = ctx.createStereoPanner();
      p.pan.value = pans[i];
      n.nodes.push(p);
      o.connect(p).connect(lp);
    }
    const sub = n.osc(ctx, "sine", f / 2);
    const subG = n.gain(ctx, 0.5);
    sub.connect(subG).connect(lp);
    return noteFromNodes(midi, n, ampEnv, 0.9);
  },
};

const bell: Engine = {
  maxVoices: 12,
  start(midi, vel, t, out) {
    const ctx = ctxOf();
    const f = midiToFreq(midi);
    const n = new NoteNodes(t);
    const amp = n.gain(ctx);
    amp.connect(out);
    const level = 0.26 * velGain(vel, 24);
    const decay = keyTrack(midi, 1.6, 72, 24, 0.45, 4);
    const ampEnv = n.env(amp.gain, level, 0.0015, decay, 0);
    const car = n.osc(ctx, "sine", f);
    const mod = n.osc(ctx, "sine", f * 3.5);
    const mg = n.gain(ctx);
    mod.connect(mg).connect(car.frequency);
    const hi = clamp((midi - 84) / 24, 0, 1);
    const index = (1.2 + 2.6 * vel) * (1 - 0.7 * hi);
    n.env(mg.gain, index * f * 3.5, 0.001, decay * 0.45, 0);
    car.connect(amp);
    // a faint detuned partner for a slow beat in the tail
    const car2 = n.osc(ctx, "sine", f * 1.0015);
    const g2 = n.gain(ctx, 0.18);
    car2.connect(g2).connect(amp);
    return noteFromNodes(midi, n, ampEnv, 0.45);
  },
};

const organWaves = new WeakMap<Ctx, PeriodicWave>();
function organWave(ctx: Ctx): PeriodicWave {
  let w = organWaves.get(ctx);
  if (!w) {
    // harmonics relative to 8′: 8′ 4′ 2⅔′ 2′ 1⅗′ 1⅓′ 1′  →  1 2 3 4 5 6 8
    const amps = [0, 1, 0.7, 0.5, 0.42, 0, 0.18, 0, 0.12];
    const real = new Float32Array(amps.length);
    const imag = new Float32Array(amps);
    w = ctx.createPeriodicWave(real, imag);
    organWaves.set(ctx, w);
  }
  return w;
}

const organ: Engine = {
  maxVoices: 12,
  start(midi, vel, t, out) {
    const ctx = ctxOf();
    const f = midiToFreq(midi);
    const n = new NoteNodes(t);
    const amp = n.gain(ctx);
    amp.connect(out);
    // organs aren't velocity sensitive; a little response keeps it playable
    const level = 0.17 * velGain(vel, 6);
    const ampEnv = n.env(amp.gain, level, 0.006, 0, level);
    n.osc(ctx, organWave(ctx), f).connect(amp);
    const sub = n.osc(ctx, "sine", f / 2); // 16′
    const sg = n.gain(ctx, 0.45);
    sub.connect(sg).connect(amp);
    // key click: a few ms of the 8th harmonic
    const click = n.osc(ctx, "sine", Math.min(f * 8, 9000));
    const cg = n.gain(ctx);
    click.connect(cg).connect(amp);
    n.env(cg.gain, 0.25, 0.0005, 0.004, 0);
    return noteFromNodes(midi, n, ampEnv, 0.025);
  },
};

const marimba: Engine = {
  maxVoices: 12,
  start(midi, vel, t, out) {
    const ctx = ctxOf();
    const f = midiToFreq(midi);
    const n = new NoteNodes(t);
    const amp = n.gain(ctx, 1);
    amp.connect(out);
    const level = 0.42 * velGain(vel, 22);
    const decay = keyTrack(midi, 0.42, 60, 22, 0.1, 1.0);
    const body = n.gain(ctx);
    const bodyEnv = n.env(body.gain, level, 0.0012, decay, 0);
    n.osc(ctx, "sine", f).connect(body).connect(amp);
    const extra: Env[] = [];
    if (f * 4 < 14000) {
      const ov = n.gain(ctx);
      extra.push(n.env(ov.gain, level * (0.15 + 0.35 * vel), 0.0008, Math.min(0.09, decay * 0.3), 0));
      n.osc(ctx, "sine", f * 4).connect(ov).connect(amp);
    }
    if (f * 9.9 < 16000) {
      const ck = n.gain(ctx);
      extra.push(n.env(ck.gain, level * 0.12 * vel, 0.0005, 0.012, 0));
      n.osc(ctx, "sine", f * 9.9).connect(ck).connect(amp);
    }
    return noteFromNodes(midi, n, bodyEnv, 0.12, extra);
  },
};

const sine: Engine = {
  maxVoices: 16,
  start(midi, vel, t, out) {
    const ctx = ctxOf();
    const n = new NoteNodes(t);
    const amp = n.gain(ctx);
    amp.connect(out);
    const level = 0.3 * velGain(vel, 20);
    const ampEnv = n.env(amp.gain, level, 0.012, 0.25, level * 0.85);
    n.osc(ctx, "sine", midiToFreq(midi)).connect(amp);
    return noteFromNodes(midi, n, ampEnv, 0.06);
  },
};

/** Subtractive pluck: used by "pluck" until the string worklet has loaded. */
const synthPluck: Engine = {
  maxVoices: 10,
  start(midi, vel, t, out) {
    const ctx = ctxOf();
    const f = midiToFreq(midi);
    const n = new NoteNodes(t);
    const amp = n.gain(ctx);
    amp.connect(out);
    const level = 0.3 * velGain(vel, 24);
    const ampEnv = n.env(amp.gain, level, 0.002, keyTrack(midi, 0.7, 48, 24, 0.2, 1.6), 0);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1.2;
    n.nodes.push(lp);
    lp.frequency.setValueAtTime(Math.min(f * (3 + 9 * vel), 12000), t);
    lp.frequency.setTargetAtTime(Math.min(f * 1.6, 8000), t + 0.002, 0.08);
    n.osc(ctx, "sawtooth", f).connect(lp).connect(amp);
    return noteFromNodes(midi, n, ampEnv, 0.09);
  },
};

// ---- the instrument wrapper --------------------------------------------------------

interface Spec {
  engine: () => Engine;
  volume: number; // dB
  reverb: number;
  fx?: (input: Tone.Gain, output: Tone.Gain) => Tone.ToneAudioNode[];
}

const SPECS: Record<Exclude<PresetName, "pluck" | "bass">, Spec> = {
  epiano: {
    engine: () => epiano,
    volume: 0,
    reverb: 0.16,
    fx: (input, output) => {
      const trem = new Tone.Tremolo({ frequency: 4.2, depth: 0.28, spread: 180 }).start();
      const tone = new Tone.Filter({ type: "lowpass", frequency: 7500, rolloff: -12, Q: 0.5 });
      input.chain(tone, trem, output);
      return [trem, tone];
    },
  },
  pad: {
    engine: () => pad,
    volume: 0,
    reverb: 0.34,
    fx: (input, output) => {
      const chorus = new Tone.Chorus({ frequency: 0.45, delayTime: 4.5, depth: 0.55, spread: 160, wet: 0.5 }).start();
      input.chain(chorus, output);
      return [chorus];
    },
  },
  bell: { engine: () => bell, volume: 0, reverb: 0.3 },
  organ: {
    engine: () => organ,
    volume: 0,
    reverb: 0.14,
    fx: (input, output) => {
      const vib = new Tone.Vibrato({ frequency: 5.6, depth: 0.05 });
      const trem = new Tone.Tremolo({ frequency: 5.6, depth: 0.16, spread: 140 }).start();
      const tone = new Tone.Filter({ type: "lowpass", frequency: 6500, rolloff: -12 });
      input.chain(vib, trem, tone, output);
      return [vib, trem, tone];
    },
  },
  marimba: { engine: () => marimba, volume: -2.5, reverb: 0.2 }, // sharp mallet peaks: a 5-note chord hit +1 dBFS raw
  sine: { engine: () => sine, volume: -3, reverb: 0.08 }, // sustained, so it read ~6 dB hotter than the decaying presets
};

class BaseInstrument implements Instrument {
  readonly preset: PresetName;
  private _output: Tone.Gain | null = null;
  private bus: Tone.Gain | null = null;
  private fxNodes: Tone.ToneAudioNode[] = [];
  private send: Tone.Gain | null = null;
  private dry: Tone.Gain | null = null;
  private vol: number;
  private reverbAmt: number;
  protected held = new Map<number, Note>();
  private notes: Note[] = [];
  private counts = new Map<number, number>();
  private _sounding = new Set<number>();
  private timers = new Set<number>();
  private unregister: () => void;
  private disposed = false;

  constructor(
    preset: PresetName,
    protected spec: Spec,
    protected opts: InstrumentOptions,
  ) {
    this.preset = preset;
    this.vol = spec.volume + (opts.volume ?? 0);
    this.reverbAmt = opts.reverb ?? spec.reverb;
    this.unregister = registerVoice(() => this.releaseAll());
  }

  get sounding(): ReadonlySet<number> {
    return this._sounding;
  }

  ready(): Promise<void> {
    this.build();
    return Promise.resolve();
  }

  get output(): Tone.Gain {
    this.build();
    return this._output!;
  }

  get volume(): number {
    return this.vol;
  }
  set volume(db: number) {
    this.vol = db;
    this._output?.gain.rampTo(Tone.dbToGain(db), 0.05);
  }

  setReverb(amount: number): void {
    this.reverbAmt = clamp(amount, 0, 1);
    this.send?.gain.rampTo(this.reverbAmt, 0.05);
  }

  connect(dest: Tone.InputNode): this {
    this.build();
    this._output!.disconnect();
    this._output!.connect(dest);
    return this;
  }

  /** Build the Tone side lazily, so pages don't touch audio before it's needed. */
  protected build(): void {
    if (this._output) return;
    this._output = new Tone.Gain(Tone.dbToGain(this.vol));
    this.bus = new Tone.Gain(1);
    if (this.spec.fx) this.fxNodes = this.spec.fx(this.bus, this._output);
    else this.bus.connect(this._output);
    if (this.opts.destination) {
      this._output.connect(this.opts.destination);
    } else {
      const { dry, send } = connectOut(this._output, { reverb: this.reverbAmt, destination: masterBus() });
      this.dry = dry;
      this.send = send;
    }
    this.onBuild();
  }

  protected onBuild(): void {}

  protected engine(): Engine {
    return this.spec.engine();
  }

  protected busNode(): AudioNode {
    return this.bus!.input as unknown as AudioNode;
  }

  private startNote(midi: number, vel: number, t: number): Note {
    const eng = this.engine();
    const max = this.opts.polyphony ?? eng.maxVoices;
    this.notes = this.notes.filter((n) => n.end > t);
    if (this.notes.length >= max) {
      // steal: oldest released note first, else the oldest held one
      const released = this.notes.filter((n) => this.held.get(n.midi) !== n);
      const victim = (released.length ? released : this.notes).reduce((a, b) => (a.start <= b.start ? a : b));
      victim.kill(t);
      if (this.held.get(victim.midi) === victim) this.held.delete(victim.midi);
      this.notes = this.notes.filter((n) => n !== victim);
    }
    const note = eng.start(midi, clamp(vel, 0, 1), t, this.busNode());
    this.notes.push(note);
    return note;
  }

  noteOn(midi: number, velocity = 0.8, time?: number): void {
    if (this.disposed) return;
    this.build();
    const t = time ?? Tone.immediate();
    const prev = this.held.get(midi);
    if (prev) {
      prev.release(t);
      this.held.delete(midi);
      this.unmark(midi);
    }
    this.held.set(midi, this.startNote(midi, velocity, t));
    this.mark(midi, t);
  }

  noteOff(midi: number, time?: number): void {
    const note = this.held.get(midi);
    if (!note) return;
    const t = time ?? Tone.immediate();
    note.release(t);
    this.held.delete(midi);
    this.unmark(midi, t);
  }

  play(midi: number | number[], duration: number, time?: number, velocity = 0.8): void {
    if (this.disposed) return;
    this.build();
    const t = time ?? Tone.immediate();
    for (const m of Array.isArray(midi) ? midi : [midi]) {
      const note = this.startNote(m, velocity, t);
      note.release(t + Math.max(duration, 0.01));
      this.mark(m, t);
      this.unmark(m, t + duration);
    }
  }

  releaseAll(time?: number): void {
    const t = time ?? Tone.immediate();
    for (const [m, note] of this.held) {
      note.release(t);
      this.unmark(m, t);
    }
    this.held.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseAll();
    this.unregister();
    for (const id of this.timers) clearTimeout(id);
    const out = this._output;
    const nodes = [this.bus, ...this.fxNodes, this.dry, this.send];
    // let release tails finish before tearing down
    window.setTimeout(() => {
      out?.dispose();
      for (const n of nodes) n?.dispose();
      this.engine().dispose?.();
    }, 1500);
  }

  // `sounding` bookkeeping in wall-clock time (for keyboards/visuals)
  protected mark(midi: number, t: number): void {
    this.at(t, () => {
      this.counts.set(midi, (this.counts.get(midi) ?? 0) + 1);
      this._sounding.add(midi);
    });
  }

  protected unmark(midi: number, t?: number): void {
    const run = (): void => {
      const c = (this.counts.get(midi) ?? 1) - 1;
      if (c <= 0) {
        this.counts.delete(midi);
        this._sounding.delete(midi);
      } else this.counts.set(midi, c);
    };
    if (t === undefined) run();
    else this.at(t, run);
  }

  private at(t: number, fn: () => void): void {
    const ms = (t - Tone.getContext().currentTime) * 1000;
    if (ms <= 4) {
      fn();
      return;
    }
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }
}

// ---- pluck: Karplus–Strong worklet --------------------------------------------------

const stringModules = new WeakMap<BaseAudioContext, Promise<void>>();
const stringReady = new WeakSet<BaseAudioContext>();

function loadStrings(): Promise<void> | null {
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  if (!raw.audioWorklet || typeof AudioWorkletNode === "undefined") return null;
  let p = stringModules.get(raw);
  if (!p) {
    p = raw.audioWorklet.addModule(new URL("./strings.worklet.js", import.meta.url).href).then(() => {
      stringReady.add(raw);
    });
    p.catch((err) => console.info("music: string worklet unavailable, using synth pluck", err));
    stringModules.set(raw, p);
  }
  return p;
}

class PluckInstrument extends BaseInstrument {
  private node: AudioWorkletNode | null = null;
  private body: Tone.ToneAudioNode[] = [];
  private built = false;

  constructor(opts: InstrumentOptions) {
    super("pluck", { engine: () => synthPluck, volume: 0, reverb: 0.2 }, opts);
    // fetch the module now so the first note can already use it
    void loadStrings()?.catch(() => {});
  }

  ready(): Promise<void> {
    this.build();
    const p = loadStrings();
    if (!p) return Promise.resolve();
    // never hang a caller on a worklet that doesn't load (headless Chromium):
    // after 3 s the synth pluck stays in charge until the module turns up
    const timeout = new Promise<void>((res) => window.setTimeout(res, 3000));
    return Promise.race([p.then(() => this.makeNode()), timeout]).catch(() => {});
  }

  protected onBuild(): void {
    this.built = true;
    const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
    if (stringReady.has(raw)) this.makeNode();
    else void loadStrings()?.then(() => this.makeNode()).catch(() => {});
  }

  private makeNode(): void {
    if (this.node || !this.built) return;
    const node = Tone.getContext().createAudioWorkletNode("music-strings", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { voices: this.opts.polyphony ?? 12 },
    }) as unknown as AudioWorkletNode;
    // a little body: warmth around 200 Hz, soften the top
    const warm = new Tone.Filter({ type: "peaking", frequency: 210, Q: 0.9, gain: 3 });
    const top = new Tone.Filter({ type: "lowpass", frequency: 9000, rolloff: -12 });
    const level = new Tone.Gain(0.55);
    Tone.connect(node as unknown as AudioNode, warm);
    warm.chain(top, level, this.output);
    this.body = [warm, top, level];
    this.node = node;
  }

  protected engine(): Engine {
    if (!this.node) return synthPluck;
    const node = this.node;
    return {
      maxVoices: 64, // the worklet steals its own voices
      start(midi, vel, t) {
        const f = midiToFreq(midi);
        const t60 = keyTrack(midi, 4.2, 48, 24, 0.7, 8);
        node.port.postMessage({
          t: "pluck",
          id: midi,
          freq: f,
          vel,
          time: t,
          t60,
          bright: 0.35 + 0.5 * vel,
          pick: 0.12 + 0.06 * Math.random(),
          pan: clamp((midi - 60) / 40, -0.5, 0.5),
        });
        const note: Note = {
          midi,
          start: t,
          end: t + t60,
          release(tr) {
            node.port.postMessage({ t: "damp", id: midi, time: tr, t60: 0.35 });
            note.end = tr + 0.4;
            return note.end;
          },
          kill(tr) {
            node.port.postMessage({ t: "damp", id: midi, time: tr, t60: 0.03 });
            note.end = tr + 0.05;
          },
        };
        return note;
      },
    };
  }

  dispose(): void {
    super.dispose();
    const node = this.node;
    const body = this.body;
    window.setTimeout(() => {
      node?.port.postMessage({ t: "stop" });
      node?.disconnect();
      for (const b of body) b.dispose();
    }, 1400);
  }
}

// ---- bass: mono with glide ------------------------------------------------------------

class BassInstrument extends BaseInstrument {
  private stack: number[] = [];
  private voice: { oscs: OscillatorNode[]; amp: GainNode; lp: BiquadFilterNode[] } | null = null;
  private env: Env | null = null;

  constructor(opts: InstrumentOptions) {
    super("bass", { engine: () => sine, volume: 0, reverb: 0.04 }, opts);
  }

  // one persistent voice: saw + detuned square through a 24 dB low-pass, sub sine beside it
  private ensureVoice(): NonNullable<BassInstrument["voice"]> {
    if (this.voice) return this.voice;
    const ctx = ctxOf();
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const lp1 = ctx.createBiquadFilter();
    const lp2 = ctx.createBiquadFilter();
    for (const l of [lp1, lp2]) {
      l.type = "lowpass";
      l.frequency.value = 400;
    }
    lp1.Q.value = 2.2;
    lp2.Q.value = 0.7;
    lp1.connect(lp2).connect(amp);
    Tone.connect(amp, this.output);
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    const sq = ctx.createOscillator();
    sq.type = "square";
    sq.detune.value = 7;
    const sub = ctx.createOscillator();
    sub.type = "sine";
    const gs = ctx.createGain();
    gs.gain.value = 0.5;
    const gq = ctx.createGain();
    gq.gain.value = 0.28;
    const gsub = ctx.createGain();
    gsub.gain.value = 0.9;
    saw.connect(gs).connect(lp1);
    sq.connect(gq).connect(lp1);
    sub.connect(gsub).connect(amp);
    for (const o of [saw, sq, sub]) o.start();
    this.voice = { oscs: [saw, sq, sub], amp, lp: [lp1, lp2] };
    return this.voice;
  }

  private setPitch(midi: number, t: number, glide: boolean): void {
    const v = this.ensureVoice();
    const f = midiToFreq(midi);
    const targets = [f, f, f / 2];
    v.oscs.forEach((o, i) => {
      o.frequency.cancelScheduledValues(t);
      if (glide) {
        o.frequency.setValueAtTime(o.frequency.value, t);
        o.frequency.setTargetAtTime(targets[i], t, 0.018);
      } else o.frequency.setValueAtTime(targets[i], t);
    });
  }

  private attack(midi: number, vel: number, t: number): void {
    const v = this.ensureVoice();
    this.setPitch(midi, t, false);
    const f = midiToFreq(midi);
    const level = 0.5 * velGain(vel, 18);
    const from = this.env ? this.env.valueAt(t) : 0;
    this.env = new Env(v.amp.gain, t, level, 0.004, 0.45, level * 0.72, from);
    const lo = Math.min(f * 2 + 120, 2000);
    const hi = Math.min(lo + 400 + 2600 * vel * vel, 8000);
    for (const l of v.lp) {
      l.frequency.cancelScheduledValues(t);
      l.frequency.setValueAtTime(hi, t);
      l.frequency.setTargetAtTime(lo, t + 0.003, 0.11);
    }
  }

  noteOn(midi: number, velocity = 0.8, time?: number): void {
    this.build();
    const t = time ?? Tone.immediate();
    const legato = this.stack.length > 0;
    this.stack = this.stack.filter((m) => m !== midi);
    this.stack.push(midi);
    if (legato) this.setPitch(midi, t, true);
    else this.attack(midi, velocity, t);
    this.held.set(midi, { midi, start: t, end: Infinity, release: () => t, kill: () => {} });
    this.mark(midi, t);
  }

  noteOff(midi: number, time?: number): void {
    if (!this.held.has(midi)) return;
    const t = time ?? Tone.immediate();
    this.held.delete(midi);
    this.unmark(midi, t);
    const wasTop = this.stack[this.stack.length - 1] === midi;
    this.stack = this.stack.filter((m) => m !== midi);
    if (!wasTop) return;
    if (this.stack.length) this.setPitch(this.stack[this.stack.length - 1], t, true);
    else this.env?.release(t, 0.05);
  }

  /** Sequencer mode: each call retriggers the mono voice on the audio clock. */
  play(midi: number | number[], duration: number, time?: number, velocity = 0.8): void {
    this.build();
    const m = Array.isArray(midi) ? midi[0] : midi;
    const t = time ?? Tone.immediate();
    this.attack(m, velocity, t);
    this.env!.release(t + Math.max(duration, 0.01), 0.05);
    this.mark(m, t);
    this.unmark(m, t + duration);
  }

  releaseAll(time?: number): void {
    const t = time ?? Tone.immediate();
    for (const m of this.held.keys()) this.unmark(m, t);
    this.held.clear();
    this.stack = [];
    this.env?.release(t, 0.05);
  }

  dispose(): void {
    const v = this.voice;
    super.dispose();
    window.setTimeout(() => {
      if (v) for (const o of v.oscs) o.stop();
    }, 400);
  }
}

// ---- factory ---------------------------------------------------------------------------

/** Create an instrument from a preset. Audio nodes are built on first use. */
export function createInstrument(preset: PresetName, opts: InstrumentOptions = {}): Instrument {
  if (preset === "pluck") return new PluckInstrument(opts);
  if (preset === "bass") return new BassInstrument(opts);
  return new BaseInstrument(preset, SPECS[preset], opts);
}
