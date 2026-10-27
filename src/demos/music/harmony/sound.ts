// Sound for the chords and jukebox articles. Nothing here is built until the
// first user gesture: every demo calls `await startAudio()` from a pointer or
// button handler, then asks for its instruments. Everything routes into one
// page bus (→ masterBus(), which carries the series' limiter), with a shared
// reverb and a tempo-synced delay as send effects.

import { Tone, audioOn, masterBus, unlockAudio } from "../../../lib/audio";

export { Tone };

export async function startAudio(): Promise<void> {
  await unlockAudio();
}

// AudioContext time without Tone's 100 ms scheduling look-ahead. Taps use
// soon() so a chord sounds right under the finger; visuals compare event
// times against audioTime() so they light up when the sound does.
// Before the first gesture it returns 0, so drawing code can call it without
// creating an AudioContext the browser would refuse to start.
export const audioTime = (): number => (audioOn() ? Tone.immediate() : 0);
export const soon = (): number => Tone.immediate() + 0.02;

// ---- buses ---------------------------------------------------------------------

let bus: Tone.Gain | null = null;
let verbIn: Tone.Gain | null = null;
let delayIn: Tone.Gain | null = null;
let delayNode: Tone.FeedbackDelay | null = null;

export function pageBus(): Tone.Gain {
  if (!bus) bus = new Tone.Gain(1).connect(masterBus());
  return bus;
}

export function reverbSend(): Tone.Gain {
  if (!verbIn) {
    verbIn = new Tone.Gain(1);
    // a darkish plate: cut the mud going in and the fizz coming out
    const hp = new Tone.Filter({ type: "highpass", frequency: 220, rolloff: -12 });
    const rv = new Tone.Reverb({ decay: 3.4, preDelay: 0.025, wet: 1 });
    const lp = new Tone.Filter({ type: "lowpass", frequency: 6000, rolloff: -12 });
    verbIn.chain(hp, rv, lp, pageBus());
  }
  return verbIn;
}

export function delaySend(): Tone.Gain {
  if (!delayIn) {
    delayIn = new Tone.Gain(1);
    delayNode = new Tone.FeedbackDelay({ delayTime: 0.375, feedback: 0.32, wet: 1 });
    const lp = new Tone.Filter({ type: "lowpass", frequency: 3200, rolloff: -12 });
    const hp = new Tone.Filter({ type: "highpass", frequency: 300, rolloff: -12 });
    delayIn.chain(hp, delayNode, lp, pageBus());
    lp.connect(reverbSend()); // the echoes sit in the room too
  }
  return delayIn;
}

// dotted-eighth echoes at the current tempo
export function setDelayTempo(bpm: number): void {
  delaySend();
  delayNode!.delayTime.rampTo((60 / bpm) * 0.75, 0.1);
}

// A mixer strip: input → volume → pan → page bus, plus reverb / delay sends.
export interface Strip {
  input: Tone.Gain;
  level: Tone.Gain;
  setDb(db: number, ramp?: number): void;
  mute(on: boolean): void;
  dispose(): void;
}

export function strip(opts: { db: number; pan?: number; reverb?: number; delay?: number; dest?: Tone.InputNode }): Strip {
  const input = new Tone.Gain(1);
  const level = new Tone.Gain(Tone.dbToGain(opts.db));
  const muteG = new Tone.Gain(1);
  const pan = new Tone.Panner(opts.pan ?? 0);
  input.chain(level, muteG, pan);
  pan.connect(opts.dest ?? pageBus());
  const sends: Tone.Gain[] = [];
  if (opts.reverb) {
    const g = new Tone.Gain(opts.reverb);
    muteG.connect(g);
    g.connect(reverbSend());
    sends.push(g);
  }
  if (opts.delay) {
    const g = new Tone.Gain(opts.delay);
    muteG.connect(g);
    g.connect(delaySend());
    sends.push(g);
  }
  return {
    input,
    level,
    setDb(db, ramp = 0.05) {
      level.gain.rampTo(Tone.dbToGain(db), ramp);
    },
    mute(on) {
      muteG.gain.rampTo(on ? 0 : 1, 0.04);
    },
    dispose() {
      for (const n of [input, level, muteG, pan, ...sends]) n.dispose();
    },
  };
}

// ---- instruments -------------------------------------------------------------------

const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// Tone's monophonic sources refuse an event earlier than one already queued.
// Humanized timing and quick restarts can ask for that, so every trigger goes
// through a per-synth clamp that keeps its times in order.
function inOrder(): (t: number) => number {
  let last = 0;
  return (t: number) => (last = Math.max(t, last + 0.0005));
}

// Release everything without tripping over notes already queued ahead.
function safely(f: () => void): void {
  try {
    f();
  } catch {
    /* a note was queued past the release time; it will end on its own */
  }
}

export interface Inst {
  // midi may be fractional; vel 0..1
  play(midi: number, dur: number, time: number, vel?: number): void;
  release(): void;
  dispose(): void;
}

// Additive tone with exactly the partials the chord microscope draws:
// harmonic k at amplitude 1/k, eight of them. Takes raw frequencies so just
// intonation can be heard. Monophonic voices in a pool.
export function harmonicTone(dest: Tone.InputNode, partials = 8): {
  playHz(f: number, dur: number, time: number, vel?: number): void;
  release(): void;
  dispose(): void;
} {
  const amps = Array.from({ length: partials }, (_, k) => 1 / (k + 1));
  const poly = new Tone.PolySynth({
    voice: Tone.Synth,
    maxPolyphony: 12,
    options: {
      oscillator: { type: "custom", partials: amps },
      envelope: { attack: 0.03, decay: 0.4, sustain: 0.7, release: 0.9 },
    },
  });
  poly.volume.value = -16;
  poly.connect(dest);
  const ord = inOrder();
  return {
    playHz(f, dur, time, vel = 0.7) {
      poly.triggerAttackRelease(f, dur, ord(time), vel);
    },
    release() {
      safely(() => poly.releaseAll(ord(Tone.immediate())));
    },
    dispose() {
      poly.dispose();
    },
  };
}

// Soft FM electric piano: a bright, quickly fading bark on top of a round body.
export function epiano(dest: Tone.InputNode, volume = -14): Inst {
  const poly = new Tone.PolySynth({
    voice: Tone.FMSynth,
    maxPolyphony: 16,
    options: {
      harmonicity: 1,
      modulationIndex: 4.2,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.004, decay: 2.2, sustain: 0.18, release: 1.1 },
      modulationEnvelope: { attack: 0.002, decay: 0.42, sustain: 0.12, release: 0.8 },
    },
  });
  // a little bell from a second, quieter pair a couple of octaves up
  const tine = new Tone.PolySynth({
    voice: Tone.FMSynth,
    maxPolyphony: 16,
    options: {
      harmonicity: 3.5,
      modulationIndex: 1.4,
      envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.4 },
      modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.3 },
    },
  });
  const trem = new Tone.Tremolo({ frequency: 4.2, depth: 0.18, spread: 90 }).start();
  const tone = new Tone.Filter({ type: "lowpass", frequency: 5200, rolloff: -12 });
  // Tone's FMSynth comes out about 10 dB under a plain Synth and the tremolo
  // costs another 6 or so; this makeup puts a full-velocity note near `volume` dBFS.
  const makeup = new Tone.Gain(Tone.dbToGain(16));
  poly.volume.value = volume;
  tine.volume.value = volume - 17;
  poly.connect(trem);
  tine.connect(trem);
  trem.chain(tone, makeup);
  makeup.connect(dest);
  const ord = inOrder();
  return {
    play(midi, dur, time, vel = 0.7) {
      const t = ord(time);
      poly.triggerAttackRelease(hz(midi), dur, t, vel);
      tine.triggerAttackRelease(hz(midi), Math.min(dur, 0.4), t, vel * vel);
    },
    release() {
      const t = ord(Tone.immediate());
      safely(() => poly.releaseAll(t));
      safely(() => tine.releaseAll(t));
    },
    dispose() {
      for (const n of [poly, tine, trem, tone, makeup]) n.dispose();
    },
  };
}

// Warm pad: detuned saws, slow attack, low-passed, gently chorused.
export function pad(dest: Tone.InputNode, volume = -24, cutoff = 1300): Inst & { filter: Tone.Filter } {
  const poly = new Tone.PolySynth({
    voice: Tone.Synth,
    maxPolyphony: 12,
    options: {
      oscillator: { type: "fatsawtooth", count: 3, spread: 22 },
      envelope: { attack: 0.7, decay: 1.2, sustain: 0.75, release: 2.4 },
    },
  });
  const filter = new Tone.Filter({ type: "lowpass", frequency: cutoff, rolloff: -24, Q: 0.6 });
  const chorus = new Tone.Chorus({ frequency: 0.35, delayTime: 4.5, depth: 0.6, spread: 160, wet: 0.5 }).start();
  poly.volume.value = volume;
  poly.chain(filter, chorus);
  chorus.connect(dest);
  const ord = inOrder();
  return {
    filter,
    play(midi, dur, time, vel = 0.6) {
      poly.triggerAttackRelease(hz(midi), dur, ord(time), vel);
    },
    release() {
      safely(() => poly.releaseAll(ord(Tone.immediate())));
    },
    dispose() {
      for (const n of [poly, filter, chorus]) n.dispose();
    },
  };
}

// Bass: a filtered saw with a sine sub underneath, monophonic.
export function bass(dest: Tone.InputNode, volume = -12): Inst {
  const saw = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    filter: { type: "lowpass", rolloff: -24, Q: 1.2 },
    envelope: { attack: 0.004, decay: 0.35, sustain: 0.55, release: 0.12 },
    filterEnvelope: { attack: 0.003, decay: 0.22, sustain: 0.3, release: 0.2, baseFrequency: 110, octaves: 2.6 },
  });
  const sub = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.006, decay: 0.3, sustain: 0.8, release: 0.12 },
  });
  saw.volume.value = volume - 4;
  sub.volume.value = volume;
  const lp = new Tone.Filter({ type: "lowpass", frequency: 1400, rolloff: -12 });
  saw.connect(lp);
  sub.connect(lp);
  lp.connect(dest);
  const ord = inOrder();
  return {
    play(midi, dur, time, vel = 0.8) {
      const t = ord(time);
      saw.triggerAttackRelease(hz(midi), dur, t, vel);
      sub.triggerAttackRelease(hz(midi), dur, t, Math.min(1, vel * 1.1));
    },
    release() {
      const t = ord(Tone.immediate());
      safely(() => saw.triggerRelease(t));
      safely(() => sub.triggerRelease(t));
    },
    dispose() {
      for (const n of [saw, sub, lp]) n.dispose();
    },
  };
}

export type LeadKind = "flute" | "square" | "pluck" | "marimba" | "bell";

// Melody voices. Each is monophonic-friendly but uses a small pool so tails overlap.
export function lead(kind: LeadKind, dest: Tone.InputNode, volume = -16): Inst {
  if (kind === "pluck") {
    // A subtractive pluck: a saw through a low-pass whose cutoff snaps shut,
    // under an amplitude envelope with no sustain. (Tone's PluckSynth needs an
    // AudioWorklet module that some browsers never finish loading.)
    const poly = new Tone.PolySynth({
      voice: Tone.MonoSynth,
      maxPolyphony: 10,
      options: {
        oscillator: { type: "fatsawtooth", count: 2, spread: 12 },
        filter: { type: "lowpass", rolloff: -24, Q: 1.5 },
        envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.4 },
        filterEnvelope: { attack: 0.001, decay: 0.22, sustain: 0.05, release: 0.3, baseFrequency: 260, octaves: 3.4, exponent: 2 },
      },
    });
    const body = new Tone.Filter({ type: "lowpass", frequency: 4200, rolloff: -12 });
    poly.volume.value = volume + 8;
    poly.connect(body);
    body.connect(dest);
    const ord = inOrder();
    return {
      play(midi, dur, time, vel = 0.7) {
        poly.triggerAttackRelease(hz(midi), Math.max(dur, 0.2), ord(time), vel);
      },
      release() {
        safely(() => poly.releaseAll(ord(Tone.immediate())));
      },
      dispose() {
        for (const n of [poly, body]) n.dispose();
      },
    };
  }
  if (kind === "marimba" || kind === "bell") {
    const marimba = kind === "marimba";
    const poly = new Tone.PolySynth({
      voice: Tone.FMSynth,
      maxPolyphony: 8,
      options: marimba
        ? {
            harmonicity: 4,
            modulationIndex: 1.6,
            envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.6 },
            modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
          }
        : {
            harmonicity: 3.01,
            modulationIndex: 2.2,
            envelope: { attack: 0.002, decay: 2.6, sustain: 0, release: 1.8 },
            modulationEnvelope: { attack: 0.002, decay: 0.9, sustain: 0.05, release: 1.2 },
          },
    });
    // FMSynth runs about 10 dB under a plain Synth; make that up
    const makeup = new Tone.Gain(Tone.dbToGain(10));
    poly.volume.value = volume;
    poly.connect(makeup);
    makeup.connect(dest);
    const ord = inOrder();
    return {
      play(midi, dur, time, vel = 0.7) {
        poly.triggerAttackRelease(hz(midi), Math.max(dur, marimba ? 0.3 : 1.2), ord(time), vel);
      },
      release() {
        safely(() => poly.releaseAll(ord(Tone.immediate())));
      },
      dispose() {
        poly.dispose();
        makeup.dispose();
      },
    };
  }
  // flute / square: a breathy-ish sine or soft pulse with delayed vibrato
  const poly = new Tone.PolySynth({
    voice: Tone.Synth,
    maxPolyphony: 4,
    options:
      kind === "flute"
        ? { oscillator: { type: "fmsine", modulationIndex: 0.6, harmonicity: 2 }, envelope: { attack: 0.05, decay: 0.3, sustain: 0.75, release: 0.35 } }
        : { oscillator: { type: "pulse", width: 0.32 }, envelope: { attack: 0.012, decay: 0.25, sustain: 0.55, release: 0.28 } },
  });
  const vib = new Tone.Vibrato({ frequency: 5.2, depth: kind === "flute" ? 0.06 : 0.04 });
  const lp = new Tone.Filter({ type: "lowpass", frequency: kind === "flute" ? 3000 : 2400, rolloff: -12 });
  poly.volume.value = kind === "flute" ? volume : volume - 5;
  poly.chain(vib, lp);
  lp.connect(dest);
  const ord = inOrder();
  return {
    play(midi, dur, time, vel = 0.7) {
      poly.triggerAttackRelease(hz(midi), dur, ord(time), vel);
    },
    release() {
      safely(() => poly.releaseAll(ord(Tone.immediate())));
    },
    dispose() {
      for (const n of [poly, vib, lp]) n.dispose();
    },
  };
}

// ---- drums ---------------------------------------------------------------------------

export type DrumName = "kick" | "snare" | "clap" | "hat" | "openhat" | "shaker" | "rim" | "bell" | "conga" | "crash";

export interface Kit {
  hit(name: DrumName, time: number, vel?: number, pitch?: number): void;
  dispose(): void;
}

// A small synthesized kit. Each drum gets its own route into `dests[name]`
// (or the default) so the band can pan and level them.
export function drumKit(dests: Partial<Record<DrumName, Tone.InputNode>>, fallback: Tone.InputNode): Kit {
  const to = (n: DrumName): Tone.InputNode => dests[n] ?? fallback;
  const nodes: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    nodes.push(x);
    return x;
  };

  const kick = keep(
    new Tone.MembraneSynth({
      pitchDecay: 0.042,
      octaves: 5.2,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 },
    }),
  );
  kick.volume.value = -4;
  const kickClick = keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.006, sustain: 0 } }));
  kickClick.volume.value = -26;
  const kickHp = keep(new Tone.Filter({ type: "highpass", frequency: 2500 }));
  kick.connect(to("kick"));
  kickClick.chain(kickHp);
  kickHp.connect(to("kick"));

  const snNoise = keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }));
  const snHp = keep(new Tone.Filter({ type: "highpass", frequency: 1100 }));
  const snPeak = keep(new Tone.Filter({ type: "peaking", frequency: 4200, gain: 3, Q: 0.8 }));
  const snBody = keep(
    new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 } }),
  );
  snNoise.volume.value = -9;
  snBody.volume.value = -10;
  snNoise.chain(snHp, snPeak);
  snPeak.connect(to("snare"));
  snBody.connect(to("snare"));

  const clap = keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }));
  const clapBp = keep(new Tone.Filter({ type: "bandpass", frequency: 1300, Q: 1.1 }));
  clap.volume.value = -6;
  clap.chain(clapBp);
  clapBp.connect(to("clap"));

  const hat = keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0008, decay: 0.032, sustain: 0 } }));
  const ohat = keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.26, sustain: 0 } }));
  const hatHp = keep(new Tone.Filter({ type: "highpass", frequency: 7600, rolloff: -24 }));
  const hatPk = keep(new Tone.Filter({ type: "peaking", frequency: 10500, gain: 4, Q: 1.2 }));
  hat.volume.value = -12;
  ohat.volume.value = -17;
  hat.connect(hatHp);
  ohat.connect(hatHp);
  hatHp.chain(hatPk);
  hatPk.connect(to("hat"));

  const shaker = keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.006, decay: 0.05, sustain: 0 } }));
  const shBp = keep(new Tone.Filter({ type: "bandpass", frequency: 6500, Q: 1.4 }));
  shaker.volume.value = -14;
  shaker.chain(shBp);
  shBp.connect(to("shaker"));

  const rim = keep(new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.02 } }));
  const rimHp = keep(new Tone.Filter({ type: "highpass", frequency: 500 }));
  rim.volume.value = -9;
  rim.chain(rimHp);
  rimHp.connect(to("rim"));

  // an 808-style cowbell: two square waves at an inharmonic ratio, band-passed
  const bellA = keep(new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.0005, decay: 0.16, sustain: 0, release: 0.05 } }));
  const bellB = keep(new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.0005, decay: 0.12, sustain: 0, release: 0.05 } }));
  const bellBp = keep(new Tone.Filter({ type: "bandpass", frequency: 2600, Q: 1.6 }));
  bellA.volume.value = -22;
  bellB.volume.value = -22;
  bellA.connect(bellBp);
  bellB.connect(bellBp);
  bellBp.connect(to("bell"));

  const conga = keep(
    new Tone.MembraneSynth({
      pitchDecay: 0.018,
      octaves: 1.4,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.05 },
    }),
  );
  conga.volume.value = -9;
  conga.connect(to("conga"));

  const crash = keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.003, decay: 1.8, sustain: 0 } }));
  const crHp = keep(new Tone.Filter({ type: "highpass", frequency: 5200, rolloff: -12 }));
  crash.volume.value = -24;
  crash.chain(crHp);
  crHp.connect(to("crash"));

  const ords = new Map<DrumName, (t: number) => number>();
  return {
    hit(name, when, vel = 0.8, pitch) {
      const v = Math.max(0.05, Math.min(1, vel));
      let ord = ords.get(name);
      if (!ord) ords.set(name, (ord = inOrder()));
      // the clap's three bursts are 22 ms long; keep the next clap after them
      const time = ord(when);
      if (name === "clap") ord(when + 0.03);
      switch (name) {
        case "kick":
          kick.triggerAttackRelease(pitch ?? 34, 0.3, time, v);
          kickClick.triggerAttackRelease(0.005, time, v);
          break;
        case "snare":
          snNoise.triggerAttackRelease(0.16, time, v);
          snBody.triggerAttackRelease(pitch ?? 190, 0.08, time, v);
          break;
        case "clap":
          // three quick bursts, then the tail
          for (let k = 0; k < 3; k++) clap.triggerAttackRelease(k < 2 ? 0.012 : 0.12, time + k * 0.011, v * (k < 2 ? 0.7 : 1));
          break;
        case "hat":
          hat.triggerAttackRelease(0.03, time, v);
          break;
        case "openhat":
          ohat.triggerAttackRelease(0.25, time, v);
          break;
        case "shaker":
          shaker.triggerAttackRelease(0.05, time, v);
          break;
        case "rim":
          rim.triggerAttackRelease(pitch ?? 1650, 0.03, time, v);
          break;
        case "bell":
          bellA.triggerAttackRelease(pitch ?? 587, 0.12, time, v);
          bellB.triggerAttackRelease((pitch ?? 587) * 1.48, 0.1, time, v);
          break;
        case "conga":
          conga.triggerAttackRelease(pitch ?? 196, 0.2, time, v);
          break;
        case "crash":
          crash.triggerAttackRelease(1.6, time, v);
          break;
      }
    },
    dispose() {
      for (const n of nodes) n.dispose();
    },
  };
}

// A click for metronomes and polyrhythm rings: a short pitched tick.
export function ticker(dest: Tone.InputNode, volume = -10): { tick(freq: number, time: number, vel?: number): void; dispose(): void } {
  const s = new Tone.PolySynth({
    voice: Tone.Synth,
    maxPolyphony: 8,
    options: { oscillator: { type: "sine" }, envelope: { attack: 0.0008, decay: 0.05, sustain: 0, release: 0.02 } },
  });
  s.volume.value = volume;
  s.connect(dest);
  const ord = inOrder();
  return {
    tick(freq, time, vel = 0.8) {
      s.triggerAttackRelease(freq, 0.04, ord(time), vel);
    },
    dispose() {
      s.dispose();
    },
  };
}

// ---- a lookahead clock with fractional steps ----------------------------------------
// Like StepClock in audio.ts, but tempo changes keep the phase continuous
// and the callback learns the step duration (for swing and note lengths).

export class Clock {
  bpm: number;
  stepsPerBeat: number;
  private cb: (step: number, time: number, dur: number) => void;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private running = false;

  constructor(bpm: number, stepsPerBeat: number, cb: (step: number, time: number, dur: number) => void) {
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.cb = cb;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get stepDur(): number {
    return 60 / (this.bpm * this.stepsPerBeat);
  }

  // continuous position in steps (for drawing playheads)
  position(): number {
    if (!this.running) return 0;
    return Math.max(this.step + (Tone.immediate() - this.nextTime) / this.stepDur, 0);
  }

  start(fromStep = 0): void {
    if (this.running) return;
    this.running = true;
    this.step = fromStep;
    this.nextTime = Tone.immediate() + 0.06;
    this.timer = window.setInterval(() => this.pump(), 25);
    this.pump();
  }

  stop(): void {
    this.running = false;
    clearInterval(this.timer);
  }

  private pump(): void {
    if (!this.running) return;
    const horizon = Tone.immediate() + 0.14;
    while (this.nextTime < horizon) {
      const dur = this.stepDur;
      this.cb(this.step, this.nextTime, dur);
      this.step++;
      this.nextTime += dur;
    }
  }
}
