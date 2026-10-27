// The master chain every music demo plays through. `masterBus()` in
// src/lib/audio.ts feeds `masterChain().input`; nothing else needs to change
// for a demo to get it.
//
//   input ─► DC-block high-pass (20 Hz)
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
// applies an automatic makeup gain derived from threshold/ratio/knee. These
// settings measured +3.13 dB of it (OfflineAudioContext, −40 dBFS sine), so
// a fixed trim cancels it and quiet material stays at unity.
const GLUE = { threshold: -14, ratio: 2, knee: 12, attack: 0.02, release: 0.25 } as const;
const GLUE_MAKEUP_DB = 3.13;

export interface MasterChain {
  /** Where sources connect (masterBus() feeds this). */
  readonly input: Tone.Gain;
  /** Post-limiter, pre-volume. Analysers tap here. */
  readonly post: Tone.Gain;
  /** Listener volume / mute stage, connected to the speakers. */
  readonly output: Tone.Gain;
  readonly compressor: Tone.Compressor;
  /** Resolves once the worklet limiter is in place (or the native fallback is final). */
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
 */
export function buildMasterChain(
  opts: { toSpeakers?: boolean; reportReduction?: boolean; native?: boolean } = {},
): MasterChain {
  const ctx = Tone.getContext();
  const input = new Tone.Gain(1);
  const hpf = new Tone.Filter({ type: "highpass", frequency: 20, rolloff: -12, Q: 0.5 });
  const compressor = new Tone.Compressor(GLUE);
  const trim = new Tone.Gain(Tone.dbToGain(-GLUE_MAKEUP_DB));
  const glueBypass = new Tone.Gain(0);
  const limIn = new Tone.Gain(1);
  const post = new Tone.Gain(1);
  const output = new Tone.Gain(1);

  input.chain(hpf, compressor, trim, limIn);
  hpf.connect(glueBypass);
  glueBypass.connect(limIn);

  // native stand-in: compressor-as-limiter, then a soft clipper that can
  // never exceed the ceiling (WaveShaper clamps inputs beyond ±1 to its ends)
  const ceil = Tone.dbToGain(CEILING_DB);
  const nativeLim = new Tone.Compressor({ threshold: CEILING_DB - 2, ratio: 20, knee: 0, attack: 0.001, release: 0.08 });
  const nativeTrim = new Tone.Gain(Tone.dbToGain(-0.6));
  const clip = new Tone.WaveShaper((x) => softClip(x, ceil), 4096);
  clip.oversample = "none"; // exact in the linear region; it only bends past 70 % of the ceiling
  const nativeGain = new Tone.Gain(1);
  limIn.chain(nativeLim, nativeTrim, clip, nativeGain, post);
  post.connect(output);
  if (opts.toSpeakers) output.toDestination();

  let kind: "worklet" | "native" = "native";
  let workletNode: AudioWorkletNode | null = null;
  let workletGain: Tone.Gain | null = null;

  const ready = (async () => {
    const raw = ctx.rawContext as unknown as BaseAudioContext;
    if (opts.native || !raw.audioWorklet || typeof AudioWorkletNode === "undefined") return;
    try {
      await loadLimiterModule(raw);
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
          const now = performance.now();
          if (db >= reductionDb || now - reductionAt > 120) {
            reductionDb = db;
            reductionAt = now;
          }
        };
      }
      workletGain = new Tone.Gain(0);
      Tone.connect(limIn, node as unknown as AudioNode);
      Tone.connect(node as unknown as AudioNode, workletGain);
      workletGain.connect(post);
      // short crossfade in case something is already playing
      const t = ctx.currentTime;
      workletGain.gain.setValueAtTime(0, t);
      workletGain.gain.linearRampToValueAtTime(1, t + 0.03);
      nativeGain.gain.setValueAtTime(1, t);
      nativeGain.gain.linearRampToValueAtTime(0, t + 0.03);
      kind = "worklet";
      window.setTimeout(() => {
        limIn.disconnect(nativeLim);
        nativeLim.dispose();
        nativeTrim.dispose();
        clip.dispose();
        nativeGain.dispose();
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
    ready,
    limiterKind: () => kind,
    setGlue(on: boolean) {
      const t = ctx.currentTime;
      trim.gain.setTargetAtTime(on ? Tone.dbToGain(-GLUE_MAKEUP_DB) : 0, t, 0.02);
      glueBypass.gain.setTargetAtTime(on ? 0 : 1, t, 0.02);
    },
    dispose() {
      for (const n of [input, hpf, compressor, trim, glueBypass, limIn, post, output, workletGain]) n?.dispose();
      if (!nativeLim.disposed) {
        nativeLim.dispose();
        nativeTrim.dispose();
        clip.dispose();
        nativeGain.dispose();
      }
      workletNode?.disconnect();
    },
  };
}

// tanh-style knee from 70% of the ceiling, flat at the ceiling
function softClip(x: number, ceil: number): number {
  const k = ceil * 0.7;
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
  const p = chain.output.gain;
  const t = Tone.getContext().currentTime;
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
