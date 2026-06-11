// Shared audio plumbing for the music series. One master bus for every demo
// on the page, with waveform and spectrum analysers permanently tapped in so
// the visuals can draw what the speakers are actually doing.
//
// Browsers refuse to start audio without a user gesture, so every demo calls
// unlockAudio() from a pointer/button handler before making sound.

import * as Tone from "tone";

export { Tone };

let unlocked = false;
let master: Tone.Gain | null = null;
let waveTap: Tone.Analyser | null = null;
let fftTap: Tone.Analyser | null = null;

export function masterBus(): Tone.Gain {
  if (!master) {
    master = new Tone.Gain(0.8);
    waveTap = new Tone.Analyser("waveform", 1024);
    fftTap = new Tone.Analyser("fft", 128);
    fftTap.smoothing = 0.85;
    master.connect(waveTap);
    master.connect(fftTap);
    master.toDestination();
  }
  return master;
}

export async function unlockAudio(): Promise<void> {
  if (!unlocked) {
    await Tone.start();
    unlocked = true;
  }
}

export function audioOn(): boolean {
  return unlocked;
}

// Most recent output waveform (1024 samples, -1..1).
export function waveform(): Float32Array {
  masterBus();
  return waveTap!.getValue() as Float32Array;
}

// Most recent output spectrum (128 bins, dB).
export function spectrum(): Float32Array {
  masterBus();
  return fftTap!.getValue() as Float32Array;
}

// ---- music math -------------------------------------------------------------

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function midiName(m: number): string {
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function cents(ratio: number): number {
  return 1200 * Math.log2(ratio);
}

// Nearest note name + cent offset, for readouts like "A4 +12¢".
export function freqLabel(f: number): string {
  const m = 69 + 12 * Math.log2(f / 440);
  const near = Math.round(m);
  const off = Math.round((m - near) * 100);
  const sign = off > 0 ? `+${off}` : `${off}`;
  return off === 0 ? midiName(near) : `${midiName(near)} ${sign}¢`;
}

// Plomp–Levelt pair roughness (Sethares' parameterization): how much two
// partials beat unpleasantly. Peaks around a quarter of a critical band.
export function pairRoughness(f1: number, a1: number, f2: number, a2: number): number {
  const fmin = Math.min(f1, f2);
  const s = 0.24 / (0.021 * fmin + 19);
  const x = s * Math.abs(f2 - f1);
  return a1 * a2 * (Math.exp(-3.5 * x) - Math.exp(-5.75 * x));
}

// Total roughness of two harmonic tones (n partials each, 1/k amplitudes).
export function toneRoughness(f1: number, f2: number, partials = 8): number {
  let r = 0;
  for (let i = 1; i <= partials; i++) {
    for (let j = 1; j <= partials; j++) {
      r += pairRoughness(f1 * i, 1 / i, f2 * j, 1 / j);
    }
  }
  return r;
}

// ---- lifecycle --------------------------------------------------------------

// Demos only get frame() calls while scrolled into view. A guard turns the
// sound off shortly after the frames stop, so a droning oscillator can't
// follow the reader down the page. Call pulse() every frame.
export function frameGuard(silence: () => void): { pulse(): void } {
  let last = 0;
  let live = false;
  window.setInterval(() => {
    if (live && performance.now() - last > 400) {
      live = false;
      silence();
    }
  }, 200);
  return {
    pulse() {
      last = performance.now();
      live = true;
    },
  };
}

// "tap for sound" overlay badge; hides itself on the first pointer-down.
export function soundHint(container: HTMLElement, text = "tap for sound"): HTMLElement {
  container.style.position = "relative";
  const el = document.createElement("span");
  el.className = "sound-hint";
  el.textContent = `🔊 ${text}`;
  container.appendChild(el);
  container.addEventListener("pointerdown", () => el.classList.add("is-hidden"), { once: true });
  return el;
}

// ---- step clock -------------------------------------------------------------

// A small lookahead scheduler (the classic "tale of two clocks" pattern).
// Each demo gets its own clock, so two sequenced demos on one page can't
// fight over a shared transport. The callback receives the AudioContext
// timestamp so triggers land sample-accurately between visual frames.
export class StepClock {
  bpm: number;
  private stepsPerBeat: number;
  private cb: (step: number, time: number) => void;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private running = false;

  constructor(bpm: number, stepsPerBeat: number, cb: (step: number, time: number) => void) {
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.cb = cb;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // Fraction [0,1) through the cycle, for drawing playheads. Continuous:
  // `nextTime` is the next *unscheduled* step, so the current position on the
  // step timeline is step + (now - nextTime)/dur — negative fraction inside
  // the lookahead window. Anchoring on the previous step and clamping (the
  // old way) made the playhead snap forward at each pump and freeze through
  // the lookahead: a visible jump-stutter every step.
  phase(stepsPerCycle: number): number {
    if (!this.running) return 0;
    const dur = 60 / (this.bpm * this.stepsPerBeat);
    const cont = Math.max(this.step + (Tone.now() - this.nextTime) / dur, 0);
    return (cont % stepsPerCycle) / stepsPerCycle;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.nextTime = Tone.now() + 0.08;
    this.timer = window.setInterval(() => this.pump(), 25);
  }

  stop(): void {
    this.running = false;
    clearInterval(this.timer);
  }

  private pump(): void {
    const dur = 60 / (this.bpm * this.stepsPerBeat);
    while (this.nextTime < Tone.now() + 0.12) {
      this.cb(this.step, this.nextTime);
      this.step++;
      this.nextTime += dur;
    }
  }
}
