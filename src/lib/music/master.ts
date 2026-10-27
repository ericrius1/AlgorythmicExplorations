// The master chain every music demo plays through. `masterBus()` in
// src/lib/audio.ts feeds `masterChain().input`; nothing else needs to change
// for a demo to get it.
//
//   input ─► DC-block high-pass (15 Hz Butterworth)
//         ─► glue compressor (−14 dB, 2:1, 12 dB knee; its automatic makeup
//            gain is cancelled so quiet material passes at unity)
//         ─► brickwall look-ahead limiter at −1 dBFS (AudioWorklet; a native
//            compressor + soft clipper stands in until it loads, or for good
//            if worklets are unavailable)
//         ─► post  (analysis taps live here: post-limiter, pre-volume)
//         ─► listener volume / mute ─► speakers
//
// This module only imports Tone, never ../audio, so audio.ts can import it
// without a cycle.

import * as Tone from "tone";

export const CEILING_DB = -1;

// The DynamicsCompressorNode (same kernel in Chrome, Firefox and Safari)
// applies an automatic makeup gain derived from threshold/ratio/knee.
// compressorMakeupDb() reproduces that formula (+2.31 dB for these settings,
// matching an OfflineAudioContext render of a −40 dBFS sine in Chrome 152), so
// a fixed trim cancels it and quiet material stays at unity.
const GLUE = { threshold: -14, ratio: 2, knee: 12, attack: 0.02, release: 0.25 } as const;
const GLUE_MAKEUP_DB = compressorMakeupDb(GLUE.threshold, GLUE.knee, GLUE.ratio);

/** How long `ready` waits for the worklet before settling on the native limiter. */
const WORKLET_TIMEOUT_MS = 3000;

/**
 * The automatic makeup gain (dB) of a DynamicsCompressorNode, from the
 * Blink/WebKit kernel: the knee curve x ↦ t + (1 − e^(−k(x − t)))/k is
 * solved for the k whose dB slope at threshold + knee equals 1/ratio, the
 * full-scale gain follows, and makeup = 0.6 × its inverse in dB.
 */
export function compressorMakeupDb(thresholdDb: number, kneeDb: number, ratio: number): number {
  const lt = Math.pow(10, thresholdDb / 20);
  const kt = Math.pow(10, (thresholdDb + kneeDb) / 20);
  if (kneeDb <= 0) return -0.6 * (thresholdDb - thresholdDb / ratio);
  const curve = (x: number, k: number): number => lt + (1 - Math.exp(-k * (x - lt))) / k;
  // dB slope at the knee's top: (x / y) · dy/dx
  const slope = (k: number): number => (kt * Math.exp(-k * (kt - lt))) / curve(kt, k);
  let lo = 0.1;
  let hi = 10000;
  for (let i = 0; i < 80; i++) {
    const m = Math.sqrt(lo * hi);
    if (slope(m) > 1 / ratio) lo = m;
    else hi = m;
  }
  const yKneeDb = 20 * Math.log10(curve(kt, lo));
  const fullDb = yKneeDb + (0 - (thresholdDb + kneeDb)) / ratio;
  return -0.6 * fullDb;
}

export interface MasterChain {
  /** Where sources connect (masterBus() feeds this). */
  readonly input: Tone.Gain;
  /** Post-limiter, pre-volume. Analysers tap here. */
  readonly post: Tone.Gain;
  /** Listener volume / mute stage, connected to the speakers. */
  readonly output: Tone.Gain;
  /** Listener volume / mute gain (native), driven by setMasterVolume() / setMuted(). */
  readonly volumeParam: AudioParam;
  /** The glue compressor (a native DynamicsCompressorNode). */
  readonly compressor: DynamicsCompressorNode;
  /** Resolves once the worklet limiter is in place, or the native fallback is final (≤ 3 s). Never rejects. */
  readonly ready: Promise<void>;
  limiterKind(): "worklet" | "native";
  /** Bypass the glue compressor (for demos about loudness). The limiter always stays. */
  setGlue(on: boolean): void;
  dispose(): void;
}

let chain: MasterChain | null = null;
let reductionDb = 0;
let reductionAt = 0;

/** The page's shared master chain, built on first use, connected to the speakers. */
export function masterChain(): MasterChain {
  if (!chain) {
    chain = buildMasterChain({ toSpeakers: true, reportReduction: true });
    applyVolume(0);
  }
  return chain;
}

/**
 * Build a fresh chain on the current Tone context. masterChain() uses this for
 * the page; tests call it inside Tone.Offline() to render through the same
 * processing (`native: true` skips the worklet, to test the fallback).
 *
 * The inner stages are plain Web Audio nodes with their values set directly.
 * Tone's Param wrappers (a Signal summed into the native param) set a few of
 * them wrong in headless Chromium 140, and in every browser a biquad's
 * high-pass Q is in dB, which Tone passes through unchanged.
 */
export function buildMasterChain(
  opts: { toSpeakers?: boolean; reportReduction?: boolean; native?: boolean } = {},
): MasterChain {
  const ctx = Tone.getContext();
  const raw = ctx.rawContext as unknown as BaseAudioContext;
  const now = (): number => raw.currentTime;
  const gainNode = (v: number): GainNode => {
    const g = raw.createGain();
    g.gain.value = v;
    return g;
  };
  const input = new Tone.Gain(1);
  const post = new Tone.Gain(1);
  const output = new Tone.Gain(1);

  // DC block: 2nd-order Butterworth high-pass at 15 Hz (Q −3.01 dB = 0.707),
  // −0.1 dB at 40 Hz
  const hpf = raw.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 15;
  hpf.Q.value = 20 * Math.log10(Math.SQRT1_2);
  const compressor = raw.createDynamicsCompressor();
  setCompressor(compressor, GLUE);
  const glueGain = Tone.dbToGain(-GLUE_MAKEUP_DB);
  const trim = gainNode(glueGain);
  const glueBypass = gainNode(0);
  const limIn = gainNode(1);

  Tone.connect(input, hpf);
  hpf.connect(compressor).connect(trim).connect(limIn);
  hpf.connect(glueBypass).connect(limIn);

  // native stand-in: compressor-as-limiter (its makeup gain cancelled, so
  // quiet material passes at unity and it settles ~2.4 dB under the ceiling),
  // then a soft clipper for the overshoots that can never exceed the ceiling
  // (a WaveShaper clamps inputs beyond ±1 to its curve's ends)
  const ceil = Tone.dbToGain(CEILING_DB);
  const NATIVE_LIM = { threshold: CEILING_DB - 2.5, ratio: 20, knee: 0, attack: 0.001, release: 0.08 };
  const nativeLim = raw.createDynamicsCompressor();
  setCompressor(nativeLim, NATIVE_LIM);
  const nativeTrim = gainNode(Tone.dbToGain(-compressorMakeupDb(NATIVE_LIM.threshold, NATIVE_LIM.knee, NATIVE_LIM.ratio)));
  const clip = raw.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) curve[i] = softClip((i / 2048) - 1, ceil);
  clip.curve = curve;
  clip.oversample = "none"; // exact in the linear region; it only bends past 85 % of the ceiling
  const nativeGain = gainNode(1);
  limIn.connect(nativeLim).connect(nativeTrim).connect(clip).connect(nativeGain);
  Tone.connect(nativeGain, post);
  const vol = gainNode(1);
  Tone.connect(post, vol);
  Tone.connect(vol, output);
  if (opts.toSpeakers) output.toDestination();

  let kind: "worklet" | "native" = "native";
  let workletNode: AudioWorkletNode | null = null;
  let workletGain: GainNode | null = null;
  let nativeDisposed = false;
  const disposeNative = (): void => {
    if (nativeDisposed) return;
    nativeDisposed = true;
    for (const n of [nativeLim, nativeTrim, clip, nativeGain]) n.disconnect();
  };

  const ready = (async () => {
    if (opts.native || !raw.audioWorklet || typeof AudioWorkletNode === "undefined") return;
    try {
      // a worklet module that never loads (seen in headless Chromium) must not
      // leave callers awaiting `ready` forever: settle on the native limiter
      const loaded = await Promise.race([
        loadLimiterModule(raw).then(() => true),
        new Promise<false>((res) => window.setTimeout(() => res(false), WORKLET_TIMEOUT_MS)),
      ]);
      if (!loaded) {
        console.info("music: worklet limiter did not load in time, keeping the native limiter");
        return;
      }
      // Tone's raw context is a standardized-audio-context wrapper, so build
      // the node through Tone rather than the native constructor
      const node = ctx.createAudioWorkletNode("music-limiter", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: { ceiling: ceil, lookaheadMs: 5, releaseMs: 120 },
      }) as unknown as AudioWorkletNode;
      workletNode = node;
      if (opts.reportReduction) {
        node.port.onmessage = (e: MessageEvent<number>) => {
          const db = -Tone.gainToDb(Math.max(e.data, 1e-6));
          // hold the deepest reduction briefly so meters can show it
          const t = performance.now();
          if (db >= reductionDb || t - reductionAt > 120) {
            reductionDb = db;
            reductionAt = t;
          }
        };
      }
      const wg = gainNode(0);
      workletGain = wg;
      limIn.connect(node).connect(wg);
      Tone.connect(wg, post);
      // short crossfade in case something is already playing
      const t = now();
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(1, t + 0.03);
      nativeGain.gain.setValueAtTime(1, t);
      nativeGain.gain.linearRampToValueAtTime(0, t + 0.03);
      kind = "worklet";
      window.setTimeout(() => {
        limIn.disconnect(nativeLim);
        disposeNative();
      }, 200);
    } catch (err) {
      console.info("music: worklet limiter unavailable, using native limiter", err);
    }
  })();

  return {
    input,
    post,
    output,
    compressor,
    volumeParam: vol.gain,
    ready,
    limiterKind: () => kind,
    setGlue(on: boolean) {
      const t = now();
      trim.gain.setTargetAtTime(on ? glueGain : 0, t, 0.02);
      glueBypass.gain.setTargetAtTime(on ? 0 : 1, t, 0.02);
    },
    dispose() {
      for (const n of [input, post, output]) n.dispose();
      for (const n of [hpf, compressor, trim, glueBypass, limIn, vol, workletGain, workletNode]) n?.disconnect();
      disposeNative();
    },
  };
}

function setCompressor(
  c: DynamicsCompressorNode,
  p: { threshold: number; ratio: number; knee: number; attack: number; release: number },
): void {
  c.threshold.value = p.threshold;
  c.ratio.value = p.ratio;
  c.knee.value = p.knee;
  c.attack.value = p.attack;
  c.release.value = p.release;
}

// tanh-style knee from 85% of the ceiling, flat at the ceiling
function softClip(x: number, ceil: number): number {
  const k = ceil * 0.85;
  const a = Math.abs(x);
  if (a <= k) return x;
  const room = ceil - k;
  return Math.sign(x) * (k + room * Math.tanh((a - k) / room));
}

const loadedModules = new WeakMap<BaseAudioContext, Promise<void>>();
function loadLimiterModule(raw: BaseAudioContext): Promise<void> {
  let p = loadedModules.get(raw);
  if (!p) {
    p = raw.audioWorklet.addModule(new URL("./limiter.worklet.js", import.meta.url).href);
    loadedModules.set(raw, p);
  }
  return p;
}

/** Current limiter gain reduction in dB (≥ 0). 0 when idle or on the native fallback. */
export function limiterReduction(): number {
  if (performance.now() - reductionAt > 250) reductionDb = Math.max(0, reductionDb - 0.5);
  return reductionDb;
}

// ---- shared reverb ------------------------------------------------------------

let reverbIn: Tone.Gain | null = null;

/**
 * Input of the page's shared reverb (100 % wet). Its return feeds the master
 * chain directly. Build it lazily: the impulse response is generated on first
 * use (a damped, decorrelated stereo noise tail, ~2.6 s).
 */
export function reverbSend(): Tone.Gain {
  if (!reverbIn) {
    const m = masterChain();
    reverbIn = new Tone.Gain(1);
    const pre = new Tone.Filter({ type: "highpass", frequency: 180, rolloff: -12 });
    const conv = new Tone.Convolver();
    conv.normalize = true;
    conv.buffer = new Tone.ToneAudioBuffer(makeImpulse(Tone.getContext().sampleRate, 2.6));
    const ret = new Tone.Gain(0.55);
    reverbIn.chain(pre, conv, ret, m.input);
  }
  return reverbIn;
}

/**
 * Connect a source to masterBus() (dry) plus a send into the shared reverb.
 * Returns both gains so the caller can automate them (send.gain.rampTo(...)).
 */
export function connectOut(
  node: Tone.ToneAudioNode,
  opts: { reverb?: number; destination?: Tone.InputNode } = {},
): { dry: Tone.Gain; send: Tone.Gain } {
  const dry = new Tone.Gain(1);
  const send = new Tone.Gain(opts.reverb ?? 0);
  node.connect(dry);
  node.connect(send);
  dry.connect(opts.destination ?? busInput());
  send.connect(reverbSend());
  return { dry, send };
}

// masterBus() lives in audio.ts (which imports this module). It registers
// itself here so connectOut can reach it without an import cycle.
let busGetter: (() => Tone.Gain) | null = null;
export function _registerBus(get: () => Tone.Gain): void {
  busGetter = get;
}
function busInput(): Tone.InputNode {
  return busGetter ? busGetter() : masterChain().input;
}

function makeImpulse(sr: number, seconds: number): AudioBuffer {
  const len = Math.floor(sr * seconds);
  const buf = Tone.getContext().createBuffer(2, len, sr) as unknown as AudioBuffer;
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    let seed = ch === 0 ? 0x9e3779b9 : 0x7f4a7c15;
    const rand = (): number => {
      // xorshift32, so the two channels are decorrelated but repeatable
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) / 4294967296) * 2 - 1;
    };
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / (seconds * 0.85)); // −60 dB at ~0.85 × length
      const fadeIn = Math.min(1, t / 0.004);
      // high frequencies die first: a one-pole low-pass closing over time
      const cutoff = 9000 * Math.exp(-t * 1.6) + 900;
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
      lp += (rand() - lp) * a;
      d[i] = lp * env * fadeIn;
    }
    // a few early reflections
    const taps = ch === 0 ? [0.019, 0.031, 0.047, 0.067] : [0.023, 0.037, 0.053, 0.071];
    taps.forEach((tt, k) => {
      const i = pre + Math.floor(tt * sr);
      if (i < len) d[i] += (k % 2 ? -1 : 1) * 0.35 * Math.pow(0.7, k);
    });
  }
  return buf;
}

// ---- listener volume / mute ---------------------------------------------------

let volume = 1;
let muted = false;
const listeners = new Set<(s: { muted: boolean; volume: number }) => void>();

function applyVolume(rampSeconds: number): void {
  if (!chain) return;
  const g = muted ? 0 : volume * volume;
  const p = chain.volumeParam;
  const t = (Tone.getContext().rawContext as unknown as BaseAudioContext).currentTime;
  p.cancelScheduledValues(t);
  if (rampSeconds <= 0) p.setValueAtTime(g, t);
  else p.setTargetAtTime(g, t, rampSeconds / 3);
}

function notify(): void {
  for (const cb of listeners) cb({ muted, volume });
}

/** Listener volume 0..1 (squared to gain, so 0.5 ≈ −12 dB). Post-limiter. */
export function setMasterVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  applyVolume(0.08);
  notify();
}

export function masterVolume(): number {
  return volume;
}

export function setMuted(m: boolean): void {
  muted = m;
  applyVolume(0.06);
  notify();
}

export function isMuted(): boolean {
  return muted;
}

export function onSoundChange(cb: (s: { muted: boolean; volume: number }) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
