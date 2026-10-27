// Small raw-Web-Audio voice kit for the tuning figures. Every note is an
// oscillator with a hand-built harmonic recipe, so pitches can be any
// frequency at all (pure ratios, 31-equal, gamelan tunings) and the
// harmonics that make beats audible are under control.
//
// Nothing here touches the AudioContext until a figure calls a method from
// inside a user gesture (after unlockAudio()), so pages load silently and
// without autoplay warnings. Each figure owns one Sound; silence() stops
// everything that figure started, and figures call it when they scroll away.

import { Tone, masterBus, audioOn } from "../../../lib/audio";
import { reverbSend } from "../../../lib/music/master";

export type Timbre = "keys" | "organ" | "reed" | "clarinet" | "metal" | "soft" | "tanpura" | "bell";

interface Live {
  gain: GainNode;
  stops: AudioScheduledSourceNode[];
  end: number;
}

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

function harmonics(t: Timbre): number[] {
  const out: number[] = [0];
  switch (t) {
    case "keys": // soft electric-piano-ish: strong fundamental, quick rolloff
      for (let k = 1; k <= 14; k++) out.push((k === 1 ? 1 : 0.55) / Math.pow(k, 1.55));
      break;
    case "organ": // full harmonic series, 1/k: the partials that collide and beat
      for (let k = 1; k <= 10; k++) out.push(1 / k);
      break;
    case "reed": // brighter sustained tone for drones
      for (let k = 1; k <= 16; k++) out.push(1 / Math.pow(k, 0.9));
      break;
    case "clarinet": // odd harmonics only (a closed tube), for Bohlen–Pierce
      for (let k = 1; k <= 15; k++) out.push(k % 2 ? 1 / k : 0.015 / k);
      break;
    case "soft":
      out.push(1, 0.28, 0.09, 0.035, 0.012);
      break;
    case "tanpura": // rich, buzzy: the jawari bridge keeps high partials alive
      for (let k = 1; k <= 28; k++) out.push(Math.pow(k, -0.75) * (k % 3 === 0 ? 0.8 : 1));
      break;
    default:
      out.push(1);
  }
  return out;
}

function waveFor(ctx: BaseAudioContext, t: Timbre): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) {
    m = new Map();
    waveCache.set(ctx, m);
  }
  let w = m.get(t);
  if (!w) {
    const h = harmonics(t);
    const real = new Float32Array(h.length);
    const imag = new Float32Array(h);
    w = ctx.createPeriodicWave(real, imag);
    m.set(t, w);
  }
  return w;
}

export interface NoteOpts {
  dur?: number; // seconds until the note has faded out
  vel?: number; // 0..1
  timbre?: Timbre;
  bright?: number; // 0..1, opens the filter
  vibrato?: { rate: number; depthCents: number; delay?: number };
}

export interface Held {
  set(freqs: number[], glide?: number): void;
  setLevel(level: number, time?: number): void;
  release(time?: number): void;
  readonly freqs: number[];
}

export class Sound {
  private bus: GainNode | null = null;
  private send: GainNode | null = null;
  private live = new Set<Live>();
  private held = new Set<Held>();
  private level: number;
  private reverb: number;

  constructor(opts: { level?: number; reverb?: number } = {}) {
    this.level = opts.level ?? 1;
    this.reverb = opts.reverb ?? 0;
  }

  // True once audio has been unlocked by a gesture somewhere on the page.
  get ready(): boolean {
    return audioOn();
  }

  get ctx(): BaseAudioContext {
    return Tone.getContext().rawContext as unknown as BaseAudioContext;
  }

  now(): number {
    return this.ctx.currentTime;
  }

  private out(): GainNode {
    if (!this.bus) {
      const ctx = this.ctx;
      this.bus = ctx.createGain();
      this.bus.gain.value = this.level;
      Tone.connect(this.bus, masterBus());
      if (this.reverb > 0) {
        this.send = ctx.createGain();
        this.send.gain.value = this.reverb;
        this.bus.connect(this.send);
        try {
          Tone.connect(this.send, reverbSend());
        } catch {
          // no shared reverb available: stay dry
        }
      }
    }
    return this.bus;
  }

  setReverb(amount: number): void {
    if (this.send) this.send.gain.setTargetAtTime(amount, this.now(), 0.05);
    this.reverb = amount;
  }

  // A struck or plucked note that decays on its own.
  note(freq: number, when = 0, o: NoteOpts = {}): void {
    if (!this.ready || !(freq > 10 && freq < 20000)) return;
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime + 0.005);
    const dur = o.dur ?? 1.4;
    const vel = o.vel ?? 0.7;
    const timbre = o.timbre ?? "keys";
    if (timbre === "metal" || timbre === "bell") {
      this.metal(freq, t, dur, vel, timbre === "bell");
      return;
    }
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(waveFor(ctx, timbre));
    osc.frequency.value = freq;
    const stops: AudioScheduledSourceNode[] = [osc];
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.vibrato.rate;
      const depth = ctx.createGain();
      depth.gain.value = 0;
      const d = o.vibrato.delay ?? 0.15;
      depth.gain.setValueAtTime(0, t + d);
      depth.gain.linearRampToValueAtTime(o.vibrato.depthCents, t + d + 0.35);
      lfo.connect(depth).connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
      stops.push(lfo);
    }
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 0.6;
    const bright = o.bright ?? 0.6;
    const top = Math.min(16000, freq * (3 + 12 * bright));
    filt.frequency.setValueAtTime(top, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.5, 200), t + dur * 0.7);
    const g = ctx.createGain();
    const peak = 0.17 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.setTargetAtTime(peak * 0.45, t + 0.006, 0.12);
    g.gain.setTargetAtTime(0, t + 0.2, dur / 4.5);
    osc.connect(filt).connect(g).connect(this.out());
    osc.start(t);
    osc.stop(t + dur + 0.1);
    this.track({ gain: g, stops, end: t + dur + 0.1 });
  }

  // Free-bar metallophone (saron-like) or bell: inharmonic partials, each
  // decaying at its own rate.
  private metal(freq: number, t: number, dur: number, vel: number, bell: boolean): void {
    const ctx = this.ctx;
    const ratios = bell ? [1, 2.0, 2.76, 4.07, 5.4] : [1, 2.756, 5.404, 8.933];
    const amps = bell ? [1, 0.5, 0.45, 0.25, 0.12] : [1, 0.38, 0.14, 0.05];
    const decays = bell ? [1, 0.7, 0.45, 0.3, 0.2] : [1, 0.32, 0.16, 0.08];
    const g = ctx.createGain();
    g.gain.value = 0.15 * vel;
    g.connect(this.out());
    const stops: AudioScheduledSourceNode[] = [];
    ratios.forEach((r, i) => {
      const f = freq * r;
      if (f > 16000) return;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0, t);
      pg.gain.linearRampToValueAtTime(amps[i], t + 0.003);
      pg.gain.setTargetAtTime(0, t + 0.003, (dur * decays[i]) / 4);
      o.connect(pg).connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
      stops.push(o);
    });
    this.track({ gain: g, stops, end: t + dur + 0.1 });
  }

  // A sustained tone (or chord) that holds until released. Frequencies can
  // glide, which is how the beats figure slides between tunings.
  hold(freqs: number[], o: { timbre?: Timbre; level?: number; attack?: number; cutoff?: number } = {}): Held {
    if (!this.ready) {
      return { freqs: [...freqs], set() {}, setLevel() {}, release() {} };
    }
    const ctx = this.ctx;
    const timbre = o.timbre ?? "organ";
    const voiceLevel = o.level ?? 0.06;
    const master = ctx.createGain();
    master.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = o.cutoff ?? 5000;
    filt.Q.value = 0.5;
    master.connect(filt).connect(this.out());
    const oscs: OscillatorNode[] = [];
    const cur: number[] = [];
    const ensure = (n: number): void => {
      while (oscs.length < n) {
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(waveFor(ctx, timbre));
        const vg = ctx.createGain();
        vg.gain.value = voiceLevel;
        osc.connect(vg).connect(master);
        osc.start();
        (osc as OscillatorNode & { _vg?: GainNode })._vg = vg;
        oscs.push(osc);
      }
    };
    let released = false;
    const self: Held = {
      freqs: cur,
      set: (fs: number[], glide = 0) => {
        if (released) return;
        ensure(fs.length);
        const t = ctx.currentTime;
        oscs.forEach((osc, i) => {
          const vg = (osc as OscillatorNode & { _vg?: GainNode })._vg!;
          if (i < fs.length) {
            osc.frequency.cancelScheduledValues(t);
            if (glide > 0) {
              osc.frequency.setValueAtTime(osc.frequency.value, t);
              osc.frequency.exponentialRampToValueAtTime(fs[i], t + glide);
            } else osc.frequency.setValueAtTime(fs[i], t);
            vg.gain.setTargetAtTime(voiceLevel, t, 0.02);
          } else vg.gain.setTargetAtTime(0, t, 0.02);
        });
        cur.length = 0;
        cur.push(...fs);
      },
      setLevel: (lv: number, time = 0.05) => {
        master.gain.setTargetAtTime(lv, ctx.currentTime, time / 3);
      },
      release: (time = 0.25) => {
        if (released) return;
        released = true;
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.setTargetAtTime(0, t, time / 4);
        for (const osc of oscs) osc.stop(t + time + 0.1);
        this.held.delete(self);
      },
    };
    self.set(freqs);
    const t = ctx.currentTime;
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(1, t + (o.attack ?? 0.08));
    this.held.add(self);
    return self;
  }

  // Stop everything this figure is playing or has scheduled.
  silence(fade = 0.08): void {
    if (!this.bus) return;
    const t = this.ctx.currentTime;
    for (const v of this.live) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.setTargetAtTime(0, t, fade / 4);
      for (const s of v.stops) {
        try {
          s.stop(t + fade + 0.05);
        } catch {
          // already stopped
        }
      }
    }
    this.live.clear();
    for (const h of [...this.held]) h.release(fade);
  }

  get busy(): boolean {
    this.prune();
    return this.live.size > 0 || this.held.size > 0;
  }

  private track(v: Live): void {
    this.prune();
    this.live.add(v);
  }

  private prune(): void {
    if (!this.bus) return;
    const t = this.ctx.currentTime;
    for (const v of this.live) if (v.end < t) this.live.delete(v);
  }
}

export const hz = (centsAboveC4: number, base = 261.6256): number => base * Math.pow(2, centsAboveC4 / 1200);
