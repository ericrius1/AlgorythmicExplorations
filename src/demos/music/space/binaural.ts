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

// The same filter as AudioWorklet code, plus a fractional delay per ear, so a
// moving source can be rendered live. Parameters: azimuth (radians, 0 =
// ahead, +π/2 = right).
export const BINAURAL_WORKLET = /* js */ `
const A = ${HEAD_RADIUS}, C = ${C_SOUND};
const AMIN = ${ALPHA_MIN}, TMIN = ${THETA_MIN};
function alphaOf(inc) { return 1 + AMIN / 2 + (1 - AMIN / 2) * Math.cos((inc / TMIN) * Math.PI); }
class MpBinaural extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "azimuth", defaultValue: 0, automationRate: "k-rate" },
      { name: "mode", defaultValue: 1, automationRate: "k-rate" },
    ];
  }
  constructor() {
    super();
    this.size = 2048;
    this.buf = new Float32Array(this.size);
    this.w = 0;
    this.state = [0, 0];
    this.az = 0;
    this.dl = [0, 0];
  }
  process(inputs, outputs, params) {
    const inp = inputs[0][0];
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const target = params.azimuth[0];
    const mode = params.mode[0];
    const n = out[0].length;
    // ease the angle so a dragged source doesn't click
    this.az += (target - this.az) * 0.2;
    const s = Math.sin(this.az);
    const phi = Math.asin(Math.max(-1, Math.min(1, s)));
    const itd = (A / C) * (phi + Math.sin(phi));
    const delays = [Math.max(0, itd) * sampleRate, Math.max(0, -itd) * sampleRate];
    const w0 = C / A;
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? -1 : 1;
      const inc = Math.acos(Math.max(-1, Math.min(1, side * s)));
      const a = mode > 0.5 ? alphaOf(inc) : 1;
      // bilinear transform of (1 + s·a/2w0) / (1 + s/2w0)
      const K = 2 * sampleRate;
      const tz = a / (2 * w0);
      const tp = 1 / (2 * w0);
      const b0 = (1 + K * tz) / (1 + K * tp);
      const b1 = (1 - K * tz) / (1 + K * tp);
      const a1 = (1 - K * tp) / (1 + K * tp);
      const ch = out[e];
      let z = this.state[e];
      for (let i = 0; i < n; i++) {
        const x = inp ? inp[i] : 0;
        if (e === 0) this.buf[(this.w + i) % this.size] = x;
        this.dl[e] += ((mode > 0.5 ? delays[e] : 0) - this.dl[e]) * 0.002;
        const pos = this.w + i - this.dl[e];
        const p0 = Math.floor(pos);
        const fr = pos - p0;
        const s0 = this.buf[(p0 + this.size * 4) % this.size];
        const s1 = this.buf[(p0 + 1 + this.size * 4) % this.size];
        const xd = s0 + (s1 - s0) * fr;
        // direct form II transposed, first order
        const y = b0 * xd + z;
        z = b1 * xd - a1 * y;
        ch[i] = y;
      }
      this.state[e] = z;
    }
    this.w = (this.w + n) % this.size;
    return true;
  }
}
registerProcessor("mp-binaural", MpBinaural);
`;
