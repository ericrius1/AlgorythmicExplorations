// The wren's song. A bird's voice box is not our larynx — it is the syrinx,
// at the fork where the windpipe splits into the two lungs, and it has *two*
// sound sources, one per branch, that can sing independently. That is why a
// wren can run two melodies at once and trill faster than your ear can
// resolve. We model it honestly: two oscillators with their own pitch and
// volume envelopes, fed by a tiny grammar that strings together the gestures
// real wren song is built from — whistles, sweeps, and machine-gun trills.
//
// The sound math is borrowed wholesale from the Living Music series; this
// file only adds the grammar and the two-voice wiring.

import { Tone, masterBus, unlockAudio } from "../audio";

export type Gesture = "whistle" | "sweep" | "trill" | "buzz" | "rest";

export interface Syllable {
  gesture: Gesture;
  dur: number; // seconds
  f0: number; // start frequency (Hz)
  f1: number; // end frequency (Hz) — for sweeps
  trillRate?: number; // Hz, for trills/buzzes
  voice: 0 | 1; // which half of the syrinx
}

// Wren song lives high — 2 to 8 kHz — and sprints. These ranges keep the
// generated phrases in that brilliant, slightly frantic register.
const HI = 7200, LO = 2200;
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// A phrase is a burst of syllables: wrens sing in discrete, repeatable songs
// a couple of seconds long. The grammar picks a sequence of gestures with
// wren-ish proportions — lots of trills, quick whistled transitions, the
// occasional buzz — and hands the two voices alternating or stacked work.
export function generatePhrase(seed: number): Syllable[] {
  const out: Syllable[] = [];
  const n = 5 + Math.floor(hash(seed) * 7); // 5–11 syllables
  let k = seed * 13.37;
  const rnd = (): number => hash(k++);
  const pick = (): Gesture => {
    const r = rnd();
    if (r < 0.42) return "trill";
    if (r < 0.66) return "whistle";
    if (r < 0.82) return "sweep";
    if (r < 0.92) return "buzz";
    return "rest";
  };
  let lastF = LO + rnd() * (HI - LO);
  for (let i = 0; i < n; i++) {
    const g = pick();
    const voice: 0 | 1 = rnd() < 0.5 ? 0 : 1;
    const f0 = lastF;
    let f1 = LO + rnd() * (HI - LO);
    let dur = 0.08 + rnd() * 0.16;
    let trillRate: number | undefined;
    if (g === "trill") { dur = 0.18 + rnd() * 0.4; trillRate = 22 + rnd() * 30; f1 = f0 + (rnd() - 0.5) * 900; }
    else if (g === "buzz") { dur = 0.1 + rnd() * 0.18; trillRate = 70 + rnd() * 90; f1 = f0; }
    else if (g === "sweep") { dur = 0.07 + rnd() * 0.12; }
    else if (g === "whistle") { dur = 0.06 + rnd() * 0.12; f1 = f0; }
    else { dur = 0.04 + rnd() * 0.08; } // rest
    out.push({ gesture: g, dur, f0, f1, trillRate, voice });
    lastF = f1;
  }
  return out;
}

// Two voices, each an oscillator → gain, summed into the shared master bus so
// the music series' analysers see it too. Tone schedules everything ahead of
// the clock, so a whole phrase is queued in one call and plays itself.
export class Syrinx {
  private voices: { osc: Tone.Oscillator; amp: Tone.Gain }[] = [];
  private ready = false;

  async ensure(): Promise<void> {
    if (this.ready) return;
    await unlockAudio();
    const bus = masterBus();
    for (let v = 0; v < 2; v++) {
      const amp = new Tone.Gain(0).connect(bus);
      const osc = new Tone.Oscillator(LO, v === 0 ? "sine" : "triangle").connect(amp);
      // a hair of detune between the halves gives the voice its living shimmer
      osc.detune.value = v === 0 ? -6 : 6;
      osc.start();
      this.voices.push({ osc, amp });
    }
    this.ready = true;
  }

  // Schedule a phrase starting `at` seconds from now (Tone time). Returns its
  // total duration so the caller can time the beak and the next phrase.
  async sing(phrase: Syllable[], gap = 0.012): Promise<number> {
    await this.ensure();
    const t0 = Tone.now() + 0.05;
    let t = t0;
    for (const syl of phrase) {
      const { osc, amp } = this.voices[syl.voice];
      if (syl.gesture === "rest") { t += syl.dur; continue; }

      if (syl.trillRate) {
        // trill/buzz: amplitude-modulate the voice on and off fast
        const cycles = Math.max(1, Math.round(syl.dur * syl.trillRate));
        const cyc = syl.dur / cycles;
        osc.frequency.setValueAtTime(syl.f0, t);
        osc.frequency.linearRampToValueAtTime(syl.f1, t + syl.dur);
        for (let c = 0; c < cycles; c++) {
          const ct = t + c * cyc;
          amp.gain.setValueAtTime(0.0001, ct);
          amp.gain.linearRampToValueAtTime(0.22, ct + cyc * 0.3);
          amp.gain.linearRampToValueAtTime(0.0001, ct + cyc * 0.9);
        }
      } else {
        // whistle / sweep: a single grain with a soft envelope and a pitch glide
        osc.frequency.setValueAtTime(syl.f0, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(50, syl.f1), t + syl.dur);
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.linearRampToValueAtTime(0.26, t + Math.min(0.012, syl.dur * 0.3));
        amp.gain.linearRampToValueAtTime(0.0001, t + syl.dur);
      }
      t += syl.dur + gap;
    }
    return t - t0;
  }

  dispose(): void {
    for (const { osc, amp } of this.voices) { osc.dispose(); amp.dispose(); }
    this.voices = [];
    this.ready = false;
  }
}
