import { Tone, masterBus, unlockAudio } from "../../lib/audio";

export type PulseGrade = "perfect" | "aligned" | "miss";

export class SolarPunkAudio {
  private output: Tone.Gain | null = null;
  private ambience: Tone.Gain | null = null;
  private oscillators: Tone.Oscillator[] = [];
  private pulseSynth: Tone.PolySynth<Tone.Synth> | null = null;
  private impact: Tone.MembraneSynth | null = null;
  private started = false;
  private muted = false;

  async enable(): Promise<void> {
    if (this.started) return;
    await unlockAudio();
    this.started = true;

    this.output = new Tone.Gain(0.82).connect(masterBus());
    this.ambience = new Tone.Gain(0).connect(this.output);
    const filter = new Tone.Filter(520, "lowpass").connect(this.ambience);

    const fundamentals = [
      { frequency: 55, type: "sine" as const, gain: 0.08 },
      { frequency: 82.5, type: "triangle" as const, gain: 0.027 },
      { frequency: 110, type: "sine" as const, gain: 0.018 },
    ];
    for (const voice of fundamentals) {
      const gain = new Tone.Gain(voice.gain).connect(filter);
      const oscillator = new Tone.Oscillator(voice.frequency, voice.type).connect(gain).start();
      this.oscillators.push(oscillator);
    }
    this.ambience.gain.rampTo(0.24, 2.5);

    this.pulseSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.008, decay: 0.35, sustain: 0.08, release: 1.8 },
      volume: -12,
    }).connect(this.output);
    this.impact = new Tone.MembraneSynth({
      pitchDecay: 0.08,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.8 },
      volume: -18,
    }).connect(this.output);
  }

  pulse(grade: PulseGrade): void {
    if (!this.started || !this.pulseSynth || !this.impact) return;
    const now = Tone.now();
    const notes =
      grade === "perfect" ? ["C5", "G5", "E6"] :
      grade === "aligned" ? ["C4", "G4"] :
      ["C3", "D3"];
    this.pulseSynth.triggerAttackRelease(notes, grade === "miss" ? "16n" : "4n", now);
    this.impact.triggerAttackRelease(grade === "perfect" ? "C2" : grade === "aligned" ? "G1" : "C1", "16n", now);
  }

  win(): void {
    if (!this.started || !this.pulseSynth) return;
    const now = Tone.now();
    ["C4", "E4", "G4", "B4", "D5"].forEach((note, i) => {
      this.pulseSynth!.triggerAttackRelease(note, "2n", now + i * 0.11);
    });
  }

  fail(): void {
    if (!this.started || !this.pulseSynth || !this.impact) return;
    const now = Tone.now();
    this.pulseSynth.triggerAttackRelease(["C3", "B2"], "2n", now);
    this.impact.triggerAttackRelease("C1", "8n", now);
  }

  setPaused(paused: boolean): void {
    if (!this.ambience) return;
    this.ambience.gain.rampTo(paused ? 0.045 : 0.24, 0.25);
  }

  async toggleMuted(): Promise<boolean> {
    await this.enable();
    this.muted = !this.muted;
    this.output?.gain.rampTo(this.muted ? 0 : 0.82, 0.18);
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    for (const oscillator of this.oscillators) oscillator.stop().dispose();
    this.oscillators = [];
    this.pulseSynth?.dispose();
    this.impact?.dispose();
    this.ambience?.dispose();
    this.output?.dispose();
  }
}
