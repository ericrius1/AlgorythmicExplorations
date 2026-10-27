// A lookahead step clock (the "tale of two clocks" pattern) that runs on the
// page clock, so a figure can animate its band silently before the reader has
// turned the sound on. Notes are scheduled on the audio clock through
// toAudioTime(), which also corrects for output latency where the browser
// reports it. Steps are sixteenth notes.

import { Tone } from "../../../lib/audio";

export const pageNow = (): number => performance.now() / 1000;

// Map a page-clock time (seconds) to the AudioContext time at which a sound
// should start so that it comes out of the speakers at that moment.
export function toAudioTime(t: number): number {
  const ctx = Tone.getContext().rawContext as AudioContext;
  let at: number;
  const ts = typeof ctx.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : null;
  if (ts && ts.performanceTime && ts.contextTime !== undefined && ts.performanceTime > 0) {
    at = ts.contextTime + (t * 1000 - ts.performanceTime) / 1000;
  } else {
    at = ctx.currentTime + (t - pageNow());
  }
  return Math.max(at, ctx.currentTime + 0.005);
}

export class BandClock {
  bpm: number;
  swing = 0; // 0 = straight, 1 = full triplet swing on the off-beat eighths
  private cb: (step: number, time: number) => void;
  private timer = 0;
  private anchorStep = 0;
  private anchorTime = 0;
  private next = 0;
  private running = false;

  constructor(bpm: number, cb: (step: number, time: number) => void) {
    this.bpm = bpm;
    this.cb = cb;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get stepDur(): number {
    return 60 / this.bpm / 4;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.anchorStep = 0;
    this.next = 0;
    this.anchorTime = pageNow() + 0.25;
    this.timer = window.setInterval(() => this.pump(), 25);
  }

  stop(): void {
    this.running = false;
    clearInterval(this.timer);
  }

  setBpm(bpm: number): void {
    if (this.running) {
      this.anchorTime = this.timeOf(this.next);
      this.anchorStep = this.next;
    }
    this.bpm = bpm;
  }

  timeOf(step: number): number {
    return this.anchorTime + (step - this.anchorStep) * this.stepDur;
  }

  // Swing delay: off-beat eighths (step 2 of each beat) land late.
  swingOf(step: number): number {
    return step % 4 === 2 ? (this.swing * this.stepDur * 4) / 6 : 0;
  }

  stepAt(t: number): number {
    return this.anchorStep + (t - this.anchorTime) / this.stepDur;
  }

  get nextStep(): number {
    return this.next;
  }

  private pump(): void {
    const horizon = pageNow() + 0.2;
    // after a long stall (background tab), skip ahead instead of bursting
    if (this.timeOf(this.next) < pageNow() - 0.5) {
      const now = this.stepAt(pageNow());
      this.next = Math.ceil(now);
    }
    while (this.timeOf(this.next) < horizon) {
      this.cb(this.next, this.timeOf(this.next));
      this.next++;
    }
  }
}
