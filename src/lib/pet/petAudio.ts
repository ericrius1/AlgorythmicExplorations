// Gentle synthesized Web Audio voice & harmonic chimes for the Keystone pet.
// Lazily initializes only after user interaction, and respects a mute switch.

class PetAudioEngine {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof AudioContext !== "undefined") {
      this.ctx = new AudioContext();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(freq: number, dur: number, gainPeak: number, type: OscillatorType = "sine", delay = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.06, now + dur * 0.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  chirp(basePitch: number): void {
    this.playTone(basePitch, 0.14, 0.06, "triangle", 0);
    this.playTone(basePitch * 1.25, 0.16, 0.05, "sine", 0.07);
  }

  purr(basePitch: number): void {
    this.playTone(basePitch * 0.5, 0.22, 0.05, "sine", 0);
    this.playTone(basePitch * 0.75, 0.24, 0.04, "triangle", 0.05);
  }

  reward(basePitch: number): void {
    // Pentatonic ascending sparkle
    const ratios = [1, 1.125, 1.25, 1.5];
    ratios.forEach((r, i) => this.playTone(basePitch * r, 0.22, 0.055, "sine", i * 0.065));
  }

  sing(basePitch: number): void {
    const melody = [1, 1.25, 1.5, 1.333, 1.5, 2.0];
    melody.forEach((r, i) => this.playTone(basePitch * r, 0.26, 0.055, "triangle", i * 0.13));
  }

  evolve(basePitch: number): void {
    const fanfare = [1, 1.25, 1.5, 2.0, 2.5];
    fanfare.forEach((r, i) => this.playTone(basePitch * r, 0.42, 0.07, "sine", i * 0.09));
  }
}

export const petAudio = new PetAudioEngine();
