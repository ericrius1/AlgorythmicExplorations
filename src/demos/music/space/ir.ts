// Impulse responses for a shoebox room, built the way the article describes:
// image sources for the early part, each one a short filter made from the
// absorption of the surfaces it bounced off (and, for two ears, the shadow of
// the head); then a noise tail that decays at each band's reverberation time,
// joined on at the "mixing time" when reflections get too dense to count.

import { fft } from "./fft";
import { headShadowMag, itdSeconds, HEAD_RADIUS } from "./binaural";
import { AIR_M, BANDS, C_SOUND, type Image, type Room, type V3, eyring, imageSources, volume } from "./room";

export interface Listener {
  pos: V3;
  yaw: number; // facing direction in the floor plan: 0 = +y, positive turns toward +x
}

export interface IROptions {
  fs: number;
  binaural: boolean;
  late?: boolean; // add the reverberant tail (default true)
  maxOrder?: number; // cap on reflection order for the early part
  skip?: number[]; // surfaces that reflect nothing
  taps?: number; // reflection filter length (power of two)
  maxLength?: number; // seconds
  tm?: number; // force the mixing time (seconds)
  maxImages?: number;
}

export interface IR {
  ch: Float32Array[]; // one (mono) or two (left, right) channels
  images: Image[];
  tm: number;
  T: number[]; // reverberation time per band used for the tail
  latency: number; // seconds of filter delay before the direct sound
}

// Gains per band → a magnitude curve over FFT bins (interpolated in log frequency).
function bandCurve(g: number[], n: number, fs: number, out: Float64Array): void {
  const lb = BANDS.map((f) => Math.log2(f));
  for (let k = 0; k <= n / 2; k++) {
    const f = Math.max(1, (k * fs) / n);
    const lf = Math.log2(f);
    let v: number;
    if (lf <= lb[0]) v = g[0];
    else if (lf >= lb[5]) v = g[5];
    else {
      let i = 0;
      while (lf > lb[i + 1]) i++;
      const t = (lf - lb[i]) / (lb[i + 1] - lb[i]);
      v = g[i] + (g[i + 1] - g[i]) * t;
    }
    out[k] = v;
  }
}

// A zero-phase FIR (centred, Hann-windowed) with the given magnitude per bin.
function kernelFrom(mag: Float64Array, n: number): Float32Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) {
    re[k] = mag[k];
    if (k > 0 && k < n / 2) re[n - k] = mag[k];
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const src = (i + n / 2) % n; // centre the kernel
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    out[i] = re[src] * w;
  }
  return out;
}

function rotate(d: V3, yaw: number): { right: number; front: number; up: number } {
  // listener frame: forward = (sin yaw, cos yaw), right = (cos yaw, −sin yaw)
  const right = d.x * Math.cos(yaw) - d.y * Math.sin(yaw);
  const front = d.x * Math.sin(yaw) + d.y * Math.cos(yaw);
  return { right, front, up: d.z };
}

// Second-order band-pass (RBJ cookbook, 0 dB peak), applied in place.
function bandpass(x: Float32Array, f: number, q: number, fs: number): void {
  const w0 = (2 * Math.PI * f) / fs;
  const al = Math.sin(w0) / (2 * q);
  const a0 = 1 + al;
  const b0 = al / a0;
  const b2 = -al / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - al) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
}

// Seeded noise so the same room always sounds the same.
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

export function mixingTime(room: Room): number {
  // when reflections arrive at about 4000 per second (density 4πc³t²/V)
  const t = Math.sqrt((4000 * volume(room)) / (4 * Math.PI * C_SOUND ** 3));
  return Math.min(0.25, Math.max(0.045, t));
}

export function buildIR(room: Room, src: V3, lis: Listener, o: IROptions): IR {
  const fs = o.fs;
  const n = o.taps ?? 512;
  const half = n / 2;
  const late = o.late ?? true;
  const T = eyring(room);
  let tm = o.tm ?? mixingTime(room);
  const directDist = Math.hypot(src.x - lis.pos.x, src.y - lis.pos.y, src.z - lis.pos.z);
  let images = imageSources(room, src, lis.pos, C_SOUND * tm + directDist * 0 + 0.5, o.maxOrder ?? 99, o.skip ?? [], o.maxImages ?? 3000);
  if (images.length >= (o.maxImages ?? 3000)) {
    // too many to count: start the tail earlier
    tm = images[images.length - 1].dist / C_SOUND;
  }
  if (!late) images = imageSources(room, src, lis.pos, C_SOUND * (o.maxLength ?? 0.3), o.maxOrder ?? 99, o.skip ?? [], o.maxImages ?? 3000);

  const Tmax = Math.max(...T);
  const length = Math.min(o.maxLength ?? 6, late ? tm + Tmax * 1.15 + 0.05 : (images[images.length - 1]?.dist ?? 1) / C_SOUND + 0.05);
  const N = Math.ceil(length * fs) + n;
  const nch = o.binaural ? 2 : 1;
  const ch = Array.from({ length: nch }, () => new Float32Array(N));

  // ---- early part: one filtered impulse per image source ----
  const mag = new Float64Array(n / 2 + 1);
  const magE = new Float64Array(n / 2 + 1);
  const cache = new Map<string, Float32Array>();
  const freqs = Array.from({ length: n / 2 + 1 }, (_, k) => (k * fs) / n);
  for (const im of images) {
    const t0 = im.dist / C_SOUND;
    const scale = im.dist; // kernels are built at 1 m; scale back by 1/r
    const g = im.gain.map((v) => v * scale);
    if (!o.binaural) {
      const key = g.map((v) => v.toFixed(3)).join(",");
      let k = cache.get(key);
      if (!k) {
        bandCurve(g, n, fs, mag);
        k = kernelFrom(mag, n);
        cache.set(key, k);
      }
      const at = Math.round(t0 * fs);
      const a = 1 / im.dist;
      const buf = ch[0];
      for (let i = 0; i < n; i++) buf[at + i] += k[i] * a;
      continue;
    }
    const d = { x: (im.pos.x - lis.pos.x) / im.dist, y: (im.pos.y - lis.pos.y) / im.dist, z: (im.pos.z - lis.pos.z) / im.dist };
    const fr = rotate(d, lis.yaw);
    const itd = itdSeconds(fr.right);
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? -1 : 1; // left, right
      const cosInc = Math.max(-1, Math.min(1, side * fr.right));
      const inc = Math.acos(cosInc);
      const key = `${g.map((v) => v.toFixed(3)).join(",")}|${Math.round((inc * 180) / Math.PI / 3)}`;
      let k = cache.get(key);
      if (!k) {
        bandCurve(g, n, fs, mag);
        for (let b = 0; b <= n / 2; b++) magE[b] = mag[b] * headShadowMag(freqs[b], inc);
        k = kernelFrom(magE, n);
        cache.set(key, k);
      }
      // the far ear hears it later
      const delay = e === 0 ? Math.max(0, itd) : Math.max(0, -itd);
      const at = Math.round((t0 + delay) * fs);
      const a = 1 / im.dist;
      const buf = ch[e];
      if (at + n >= buf.length) continue;
      for (let i = 0; i < n; i++) buf[at + i] += k[i] * a;
    }
  }

  // ---- late part: noise whose spectrum decays at each band's T60 ----
  // Built in short overlapping frames: each frame is random-phase noise with
  // a magnitude per frequency set by the band levels at that moment, so every
  // frequency dies away at its own rate and nothing leaks between bands.
  if (late) {
    const win0 = tm * 0.6;
    const winLen = tm - win0;
    const psd = BANDS.map((_, b) => {
      let e = 0;
      for (const im of images) {
        const t = im.dist / C_SOUND;
        if (t >= win0 && t <= tm) e += im.gain[b] ** 2;
      }
      // energy per sample, carried forward from the window's middle to tm
      let p = e / (winLen * fs);
      p *= Math.exp((-2 * 6.908 * (tm - (win0 + tm) / 2)) / T[b]);
      return p > 0 ? p : 1e-9;
    });
    const F = 1024;
    const hop = F / 2;
    const sig = new Float64Array(F / 2 + 1);
    const rate = new Float64Array(F / 2 + 1);
    bandCurve(psd.map((p) => Math.log(p)), F, fs, sig);
    bandCurve(T.map((t) => 6.908 / t), F, fs, rate);
    for (let k = 0; k <= F / 2; k++) sig[k] = Math.sqrt(Math.exp(sig[k]) * F); // |X_k| for unit-variance scaling
    const win = new Float64Array(F);
    for (let i = 0; i < F; i++) win[i] = Math.sin((Math.PI * (i + 0.5)) / F); // sine window: w² overlaps to 1
    const start = Math.floor(tm * 0.85 * fs);
    const fadeEnd = Math.floor(tm * fs);
    const re = new Float64Array(F);
    const imv = new Float64Array(F);
    for (let c = 0; c < nch; c++) {
      const rnd = noise(1234 + c * 7919);
      const out = ch[c];
      for (let f0 = start - hop; f0 < N - half; f0 += hop) {
        const tc = (f0 + F / 2) / fs - tm;
        re[0] = imv[0] = re[F / 2] = imv[F / 2] = 0;
        for (let k = 1; k < F / 2; k++) {
          const a = sig[k] * Math.exp(-rate[k] * tc);
          const ph = Math.PI * rnd();
          re[k] = a * Math.cos(ph);
          imv[k] = a * Math.sin(ph);
          re[F - k] = re[k];
          imv[F - k] = -imv[k];
        }
        fft(re, imv, true);
        for (let i = 0; i < F; i++) {
          const n0 = f0 + i;
          if (n0 < start || n0 + half >= N) continue;
          let v = re[i] * win[i];
          if (n0 < fadeEnd) v *= 0.5 - 0.5 * Math.cos((Math.PI * (n0 - start)) / (fadeEnd - start));
          out[n0 + half] += v;
        }
      }
    }
  }
  return { ch, images, tm, T, latency: half / fs };
}

// Energy decay curve (Schroeder backward integration) of one band of an IR,
// in dB, sampled every `step` seconds.
export function decayCurve(x: Float32Array, fs: number, band: number, step = 0.005): Float32Array {
  const y = Float32Array.from(x);
  for (let k = 0; k < 3; k++) bandpass(y, BANDS[band], 2, fs);
  const cum = new Float64Array(y.length + 1);
  for (let i = y.length - 1; i >= 0; i--) cum[i] = cum[i + 1] + y[i] * y[i];
  const total = cum[0] || 1;
  const m = Math.floor(y.length / (step * fs));
  const out = new Float32Array(m);
  for (let j = 0; j < m; j++) out[j] = 10 * Math.log10(cum[Math.floor(j * step * fs)] / total + 1e-12);
  return out;
}

export { HEAD_RADIUS, AIR_M };
