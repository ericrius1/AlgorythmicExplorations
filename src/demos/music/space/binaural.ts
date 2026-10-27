// A spherical head: the time difference between the ears (Woodworth's
// formula) and the head's acoustic shadow (Brown & Duda's one-pole, one-zero
// model). Together they're the two cues Lord Rayleigh's "duplex theory"
// named in 1907: timing for low frequencies, level for high ones.

import { C_SOUND } from "./room";

export const HEAD_RADIUS = 0.0875; // metres

// Interaural time difference for a source whose direction has lateral
// component s = sin(lateral angle), +1 = straight right. Positive: the left
// ear hears it later.
export function itdSeconds(s: number): number {
  const phi = Math.asin(Math.max(-1, Math.min(1, s)));
  return (HEAD_RADIUS / C_SOUND) * (phi + Math.sin(phi));
}

// Brown & Duda (1998): H(ω) = (1 + jαω/2ω₀) / (1 + jω/2ω₀), ω₀ = c/a, with α
// running from 2 (facing the source: a 6 dB high-frequency boost) to 0.1 (in
// the shadow: −20 dB) as the angle between the ear and the source grows.
const ALPHA_MIN = 0.1;
const THETA_MIN = (150 * Math.PI) / 180;

export function shadowAlpha(incidence: number): number {
  return 1 + ALPHA_MIN / 2 + (1 - ALPHA_MIN / 2) * Math.cos((incidence / THETA_MIN) * Math.PI);
}

export function headShadowMag(f: number, incidence: number): number {
  const w = 2 * Math.PI * f;
  const w0 = C_SOUND / HEAD_RADIUS;
  const a = shadowAlpha(incidence);
  const x = w / (2 * w0);
  return Math.sqrt((1 + a * a * x * x) / (1 + x * x));
}

// The same two cues as live audio nodes, so a moving source can be heard as
// it moves: a delay per ear for the time difference, and a high-shelf filter
// per ear standing in for the head-shadow filter. Brown and Duda's filter has
// unit gain at low frequencies, gain α at high ones, and its transition
// between ω = 2c/a and 2c/(aα), so the shelf sits at the geometric middle of
// those and has gain 20·log10 α.
export class BinauralPanner {
  readonly input: GainNode;
  readonly output: GainNode;
  private delays: DelayNode[];
  private shelves: BiquadFilterNode[];
  private pan: StereoPannerNode;
  private binGain: GainNode;
  private panGain: GainNode;
  private ctx: BaseAudioContext;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    const merger = ctx.createChannelMerger(2);
    this.binGain = ctx.createGain();
    this.panGain = ctx.createGain();
    this.panGain.gain.value = 0;
    this.delays = [0, 1].map(() => ctx.createDelay(0.01));
    this.shelves = [0, 1].map(() => {
      const f = ctx.createBiquadFilter();
      f.type = "highshelf";
      return f;
    });
    for (let e = 0; e < 2; e++) {
      this.input.connect(this.delays[e]);
      this.delays[e].connect(this.shelves[e]);
      this.shelves[e].connect(merger, 0, e);
    }
    merger.connect(this.binGain);
    this.binGain.connect(this.output);
    this.pan = ctx.createStereoPanner();
    this.input.connect(this.pan);
    this.pan.connect(this.panGain);
    this.panGain.connect(this.output);
  }

  // azimuth: radians, 0 = ahead, +π/2 = right. mode "pan" is a plain
  // equal-power stereo pan, for comparison.
  set(azimuth: number, mode: "both" | "itd" | "ild" | "pan", tau = 0.03): void {
    const t = this.ctx.currentTime;
    const s = Math.sin(azimuth);
    const itd = itdSeconds(s);
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? -1 : 1;
      const delay = mode === "both" || mode === "itd" ? (e === 0 ? Math.max(0, itd) : Math.max(0, -itd)) : 0;
      this.delays[e].delayTime.setTargetAtTime(delay, t, tau);
      const inc = Math.acos(Math.max(-1, Math.min(1, side * s)));
      const a = mode === "both" || mode === "ild" ? shadowAlpha(inc) : 1;
      const w0 = C_SOUND / HEAD_RADIUS;
      const fc = (2 * w0) / Math.sqrt(Math.max(a, 0.05)) / (2 * Math.PI);
      this.shelves[e].frequency.setTargetAtTime(Math.min(16000, fc), t, tau);
      this.shelves[e].gain.setTargetAtTime(20 * Math.log10(a), t, tau);
    }
    this.pan.pan.setTargetAtTime(s, t, tau);
    this.binGain.gain.setTargetAtTime(mode === "pan" ? 0 : 1, t, 0.02);
    this.panGain.gain.setTargetAtTime(mode === "pan" ? 1 : 0, t, 0.02);
  }
}
