// The band's instruments, all synthesized with Tone.js, and a safe output
// chain: every figure on the page feeds one compressor and a brickwall limiter
// before the shared master bus, so a dense chord can't clip the speakers.

import { Tone, masterBus, midiToFreq } from "../../../lib/audio";

let chain: { input: Tone.Gain; send: Tone.Gain } | null = null;

// Shared output: dry input plus a reverb send.
export function accompOut(): { input: Tone.Gain; send: Tone.Gain } {
  if (!chain) {
    const limiter = new Tone.Limiter(-2).connect(masterBus());
    const comp = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.01, release: 0.2 }).connect(limiter);
    const input = new Tone.Gain(0.9).connect(comp);
    const verb = new Tone.Reverb({ decay: 2.4, preDelay: 0.02, wet: 1 }).connect(comp);
    const send = new Tone.Gain(0.22).connect(verb);
    chain = { input, send };
  }
  return chain;
}

export type VoiceName = "keys" | "pad" | "bass" | "vibes" | "lead" | "kick" | "brush" | "ride";

interface Playable {
  triggerAttackRelease(note: number, dur: number, time?: number, vel?: number): unknown;
}

// One figure's set of instruments, with its own fader so the figure can fade
// itself out when it scrolls away.
export class BandVoices {
  readonly fader: Tone.Gain;
  private send: Tone.Gain;
  readonly keys: Tone.PolySynth<Tone.FMSynth>;
  readonly pad: Tone.PolySynth<Tone.Synth>;
  readonly bass: Tone.MonoSynth;
  readonly vibes: Tone.PolySynth<Tone.Synth>;
  readonly lead: Tone.PolySynth<Tone.FMSynth>;
  readonly kick: Tone.MembraneSynth;
  readonly brush: Tone.NoiseSynth;
  readonly ride: Tone.MetalSynth;
  private extras: Tone.ToneAudioNode[] = [];

  constructor() {
    const out = accompOut();
    this.fader = new Tone.Gain(1).connect(out.input);
    this.send = new Tone.Gain(1).connect(out.send);
    const wet = (node: Tone.ToneAudioNode, amount: number): void => {
      const g = new Tone.Gain(amount).connect(this.send);
      node.connect(g);
      this.extras.push(g);
    };

    // Electric piano: a 1:1 FM pair whose brightness decays faster than its body.
    this.keys = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 1,
      modulationIndex: 3.2,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.004, decay: 1.6, sustain: 0.18, release: 0.7 },
      modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.12, release: 0.5 },
      volume: -17,
    });
    this.keys.maxPolyphony = 16;
    this.keys.connect(this.fader);
    wet(this.keys, 0.7);

    // Pad: soft detuned triangles through a gentle low-pass.
    const padFilter = new Tone.Filter(1400, "lowpass");
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fattriangle", count: 3, spread: 18 } as unknown as Tone.OmniOscillatorOptions,
      envelope: { attack: 0.35, decay: 0.6, sustain: 0.7, release: 1.4 },
      volume: -24,
    });
    this.pad.maxPolyphony = 12;
    this.pad.connect(padFilter);
    padFilter.connect(this.fader);
    wet(padFilter, 1);
    this.extras.push(padFilter);

    // Bass: a round, plucky mono synth with a filter that closes after the attack.
    this.bass = new Tone.MonoSynth({
      oscillator: { type: "triangle" },
      filter: { Q: 1, type: "lowpass", rolloff: -24 },
      envelope: { attack: 0.005, decay: 0.5, sustain: 0.45, release: 0.25 },
      filterEnvelope: { attack: 0.004, decay: 0.25, sustain: 0.3, release: 0.3, baseFrequency: 180, octaves: 2.6 },
      volume: -10,
    });
    this.bass.connect(this.fader);

    // Vibraphone: a bar whose first overtone is tuned two octaves up, plus tremolo.
    const trem = new Tone.Tremolo(5.2, 0.35).start();
    this.vibes = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "custom", partials: [1, 0, 0, 0.28] },
      envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 1.2 },
      volume: -13,
    });
    this.vibes.maxPolyphony = 10;
    this.vibes.connect(trem);
    trem.connect(this.fader);
    wet(trem, 0.9);
    this.extras.push(trem);

    // The player's own instrument: a brighter FM piano.
    this.lead = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2,
      modulationIndex: 1.6,
      oscillator: { type: "sine" },
      modulation: { type: "triangle" },
      envelope: { attack: 0.003, decay: 1.1, sustain: 0.25, release: 0.5 },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0.2, release: 0.4 },
      volume: -12,
    });
    this.lead.maxPolyphony = 16;
    this.lead.connect(this.fader);
    wet(this.lead, 0.5);

    // Brushes and a ride: quiet, so the drums sit under everything.
    this.kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 4, volume: -22 });
    this.kick.connect(this.fader);
    const brushFilter = new Tone.Filter(2600, "bandpass");
    brushFilter.Q.value = 0.7;
    this.brush = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.02, decay: 0.22, sustain: 0 },
      volume: -24,
    });
    this.brush.connect(brushFilter);
    brushFilter.connect(this.fader);
    this.extras.push(brushFilter);
    this.ride = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.7, release: 0.2 },
      harmonicity: 5.1,
      modulationIndex: 24,
      resonance: 5200,
      octaves: 1.2,
      volume: -36,
    });
    this.ride.frequency.value = 330;
    this.ride.connect(this.fader);
    wet(this.ride, 0.4);
  }

  play(v: VoiceName, midi: number, dur: number, time: number, vel = 0.8): void {
    switch (v) {
      case "kick":
        this.kick.triggerAttackRelease(50, 0.12, time, vel);
        return;
      case "brush":
        this.brush.triggerAttackRelease(dur, time, vel);
        return;
      case "ride":
        this.ride.triggerAttackRelease(dur, time, vel);
        return;
      default: {
        const syn = this[v] as unknown as Playable;
        syn.triggerAttackRelease(midiToFreq(midi), dur, time, vel);
      }
    }
  }

  // Player notes are held as long as the key is down.
  leadOn(midi: number, vel: number): void {
    this.lead.triggerAttack(midiToFreq(midi), Tone.now(), vel);
  }
  leadOff(midi: number): void {
    this.lead.triggerRelease(midiToFreq(midi), Tone.now());
  }

  fadeTo(level: number, secs = 0.15): void {
    this.fader.gain.rampTo(level, secs);
  }

  hush(): void {
    this.keys.releaseAll();
    this.pad.releaseAll();
    this.vibes.releaseAll();
    this.lead.releaseAll();
    this.bass.triggerRelease();
  }

  dispose(): void {
    this.hush();
    for (const n of [this.keys, this.pad, this.bass, this.vibes, this.lead, this.kick, this.brush, this.ride]) n.dispose();
    for (const n of this.extras) n.dispose();
    this.fader.dispose();
    this.send.dispose();
  }
}

// ---- Shepard tones ------------------------------------------------------------

// A Shepard tone: one pitch class spread over six octaves under a bell-shaped
// loudness curve, so it has a clear note name but no clear octave. Krumhansl
// and Kessler built their probe tones this way.
export class ShepardVoice {
  readonly fader: Tone.Gain;
  private synth: Tone.PolySynth<Tone.Synth>;

  constructor() {
    this.fader = new Tone.Gain(1).connect(accompOut().input);
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.03, decay: 0.2, sustain: 0.8, release: 0.25 },
      volume: -14,
    });
    this.synth.maxPolyphony = 64;
    this.synth.connect(this.fader);
  }

  // Play pitch classes `pcs` together as one Shepard chord.
  play(pcs: number[], dur: number, time: number, vel = 0.7): void {
    const center = Math.log2(330); // loudness peak near E4
    for (const pc of pcs) {
      for (let oct = 0; oct < 6; oct++) {
        const f = 32.703 * Math.pow(2, oct + pc / 12); // C1 upward
        const x = (Math.log2(f) - center) / 1.15;
        const amp = Math.exp(-0.5 * x * x);
        if (amp < 0.03) continue;
        this.synth.triggerAttackRelease(f, dur, time, (vel * amp) / Math.sqrt(pcs.length));
      }
    }
  }

  hush(): void {
    this.synth.releaseAll();
  }

  dispose(): void {
    this.synth.dispose();
    this.fader.dispose();
  }
}

// ---- a single piano-ish voice, for figures that don't need the whole band ----

export class LeadVoice {
  readonly fader: Tone.Gain;
  readonly synth: Tone.PolySynth<Tone.FMSynth>;
  readonly pad: Tone.PolySynth<Tone.Synth>;
  private padFilter: Tone.Filter;
  private send: Tone.Gain;

  constructor() {
    const out = accompOut();
    this.fader = new Tone.Gain(1).connect(out.input);
    this.send = new Tone.Gain(0.5).connect(out.send);
    this.synth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2,
      modulationIndex: 1.6,
      oscillator: { type: "sine" },
      modulation: { type: "triangle" },
      envelope: { attack: 0.003, decay: 1.1, sustain: 0.25, release: 0.5 },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0.2, release: 0.4 },
      volume: -12,
    });
    this.synth.maxPolyphony = 16;
    this.synth.connect(this.fader);
    this.synth.connect(this.send);
    this.padFilter = new Tone.Filter(1200, "lowpass");
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fattriangle", count: 3, spread: 18 } as unknown as Tone.OmniOscillatorOptions,
      envelope: { attack: 0.25, decay: 0.5, sustain: 0.7, release: 1.0 },
      volume: -22,
    });
    this.pad.maxPolyphony = 12;
    this.pad.connect(this.padFilter);
    this.padFilter.connect(this.fader);
    this.padFilter.connect(this.send);
  }

  on(m: number, vel = 0.75, time?: number): void {
    this.synth.triggerAttack(midiToFreq(m), time ?? Tone.now(), vel);
  }
  off(m: number, time?: number): void {
    this.synth.triggerRelease(midiToFreq(m), time ?? Tone.now());
  }
  note(m: number, dur: number, time: number, vel = 0.75): void {
    this.synth.triggerAttackRelease(midiToFreq(m), dur, time, vel);
  }
  chord(ms: number[], dur: number, time: number, vel = 0.5): void {
    for (const m of ms) this.pad.triggerAttackRelease(midiToFreq(m), dur, time, vel);
  }
  fadeTo(level: number, secs = 0.15): void {
    this.fader.gain.rampTo(level, secs);
  }
  hush(): void {
    this.synth.releaseAll();
    this.pad.releaseAll();
  }
  dispose(): void {
    this.hush();
    this.synth.dispose();
    this.pad.dispose();
    this.padFilter.dispose();
    this.fader.dispose();
    this.send.dispose();
  }
}
