// Main-thread side of the synth engine: one AudioWorkletNode per figure,
// a patch object the figure can read while drawing, and the latest telemetry
// the worklet posts back (envelope levels, cutoff, the string's delay line,
// stage scopes). Audio is only touched after a user gesture.

import { Tone, masterBus, unlockAudio } from "../../../lib/audio";
import { reverbSend } from "../../../lib/music/master";

export interface OscSpec {
  wave: number; // 0 sine, 1 triangle, 2 saw, 3 pulse
  pw: number;
  oct: number;
  semi: number;
  det: number; // cents
  lvl: number;
}
export interface EnvSpec {
  a: number;
  d: number;
  s: number;
  r: number;
}
export interface OpSpec extends EnvSpec {
  ratio: number;
  det: number; // Hz
  lvl: number; // carriers: output level; modulators: peak index (radians)
}
export interface Patch {
  mode: number; // 0 subtractive, 1 FM, 2 string
  poly: number;
  glide: number;
  gain: number;
  velAmt: number;
  bendRange: number;
  keyScale: number;
  aa: number; // 0 naive, 1 polyBLEP, 2 additive
  o1: OscSpec;
  o2: OscSpec;
  noise: number;
  flt: { on: number; cut: number; res: number; poles: number; env: number; key: number };
  e1: EnvSpec;
  e2: EnvSpec;
  lfo: { wave: number; rate: number; pitch: number; cut: number; amp: number; pw: number; idx: number; mw: number };
  fm: { alg: number; fb: number; velIdx: number; ops: OpSpec[] };
  ks: { stretch: number; decay: number; bright: number; pick: number; blend: number; frac: number };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function defaultPatch(): Patch {
  const op = (ratio: number, lvl: number, a: number, d: number, s: number, r: number): OpSpec => ({ ratio, det: 0, lvl, a, d, s, r });
  return {
    mode: 0,
    poly: 8,
    glide: 0,
    gain: 1,
    velAmt: 0.5,
    bendRange: 2,
    keyScale: 0,
    aa: 1,
    o1: { wave: 2, pw: 0.5, oct: 0, semi: 0, det: 0, lvl: 1 },
    o2: { wave: 2, pw: 0.5, oct: 0, semi: 0, det: 7, lvl: 0 },
    noise: 0,
    flt: { on: 1, cut: 2400, res: 0, poles: 4, env: 0, key: 0.5 },
    e1: { a: 0.005, d: 0.3, s: 0.8, r: 0.35 },
    e2: { a: 0.005, d: 0.5, s: 0.3, r: 0.4 },
    lfo: { wave: 0, rate: 5, pitch: 0, cut: 0, amp: 0, pw: 0, idx: 0, mw: 30 },
    fm: {
      alg: 0,
      fb: 0,
      velIdx: 0.5,
      ops: [op(1, 1, 0.005, 1.5, 0.6, 0.4), op(1, 2, 0.005, 1.0, 0.4, 0.4), op(1, 0, 0.005, 1, 0, 0.3), op(1, 0, 0.005, 1, 0, 0.3)],
    },
    ks: { stretch: 1, decay: 6, bright: 0.85, pick: 0.13, blend: 1, frac: 1 },
  };
}

export function mergePatch<T>(dst: T, src: DeepPartial<T>): T {
  const d = dst as Record<string, unknown>;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      const arr = (Array.isArray(d[k]) ? d[k] : (d[k] = [])) as unknown[];
      v.forEach((item, i) => {
        if (item && typeof item === "object") {
          if (!arr[i] || typeof arr[i] !== "object") arr[i] = {};
          mergePatch(arr[i] as object, item as object);
        } else if (item !== undefined) arr[i] = item;
      });
    } else if (v && typeof v === "object") {
      if (!d[k] || typeof d[k] !== "object") d[k] = {};
      mergePatch(d[k] as object, v as object);
    } else d[k] = v;
  }
  return dst;
}

export function clonePatch(p: Patch): Patch {
  return JSON.parse(JSON.stringify(p)) as Patch;
}

// ---------------------------------------------------------------- telemetry

export const STAGE = { idle: 0, attack: 1, decay: 2, sustain: 3, release: 4 } as const;

export interface VoiceTele {
  id: number;
  note: number;
  vel: number;
  held: boolean;
  age: number;
  e1: number;
  s1: number;
  t1: number;
  e2: number;
  s2: number;
  t2: number;
  ops: number[];
  opSt: number[];
  cut: number;
}
export interface Tele {
  time: number;
  voices: VoiceTele[];
  lfo: number;
  lfoPh: number;
  peak: number;
  limit: number;
  scope?: Float32Array[];
  ks?: { data: Float32Array; N: number; C: number; w: number; D: number; err: number; rho: number; note: number; age: number };
  at: number; // performance.now() when received
}

// ---------------------------------------------------------------- module

const WORKLET_URL = new URL("./synth.worklet.js", import.meta.url).href;

// The engine runs as an AudioWorklet. Where that's missing, or addModule()
// never settles (it hangs in some headless browsers), the same file runs on
// the main thread instead and its output is streamed as short buffers. That
// adds ~100 ms of latency, so it's only a fallback.
let kindPromise: Promise<"worklet" | "stream"> | null = null;
function engineKind(): Promise<"worklet" | "stream"> {
  kindPromise ??= (async () => {
    const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
    if (!raw.audioWorklet) return "stream";
    const ok = await Promise.race([
      raw.audioWorklet.addModule(WORKLET_URL).then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((r) => window.setTimeout(() => r(false), 3000)),
    ]);
    return ok ? "worklet" : "stream";
  })();
  return kindPromise;
}

interface Port {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
}

interface ProcLike {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void };
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
}

let procClass: Promise<new () => ProcLike> | null = null;
function loadProcClass(sr: number): Promise<new () => ProcLike> {
  procClass ??= (async () => {
    const src = await (await fetch(WORKLET_URL)).text();
    let Proc: (new () => ProcLike) | null = null;
    class AudioWorkletProcessor {
      port = { onmessage: null, postMessage: (_m: unknown) => {} };
    }
    const shim = {
      sampleRate: sr,
      currentTime: 0,
      AudioWorkletProcessor,
      registerProcessor: (_n: string, c: new () => ProcLike) => (Proc = c),
    };
    new Function(...Object.keys(shim), src)(...Object.values(shim));
    if (!Proc) throw new Error("synth engine failed to load");
    return Proc;
  })();
  return procClass;
}

/** Main-thread stand-in for the AudioWorkletNode. */
class StreamNode {
  readonly port: Port;
  readonly output: Tone.Gain;
  private proc: ProcLike;
  private next = 0;
  private block = new Float32Array(128);

  constructor(Proc: new () => ProcLike) {
    const proc = new Proc();
    this.proc = proc;
    const port: Port = {
      onmessage: null,
      postMessage: (m) => proc.port.onmessage?.({ data: m }),
    };
    proc.port.postMessage = (m) => port.onmessage?.({ data: m } as MessageEvent);
    this.port = port;
    this.output = new Tone.Gain(1);
    window.setInterval(() => this.pump(), 20);
  }

  private pump(): void {
    const ctx = Tone.getContext();
    const raw = ctx.rawContext as unknown as BaseAudioContext;
    const now = raw.currentTime;
    if (this.next < now) this.next = now + 0.03;
    const len = 1024;
    while (this.next < now + 0.12) {
      const buf = raw.createBuffer(1, len, raw.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i += 128) {
        this.block.fill(0);
        this.proc.process([], [[this.block]]);
        ch.set(this.block, i);
      }
      const src = raw.createBufferSource();
      src.buffer = buf;
      Tone.connect(src as unknown as AudioNode, this.output);
      src.start(this.next);
      this.next += len / raw.sampleRate;
    }
  }
}

export interface HostOpts {
  fft?: number; // analyser size (0 = no analyser)
  smoothing?: number;
  reverb?: number; // send into the page's shared reverb
  fx?: boolean; // chorus + delay (the full instrument)
  scope?: boolean;
  ks?: boolean;
  level?: number; // output gain
}

type Msg = Record<string, unknown> & { type: string };

/** One synth engine for one figure. */
export class SynthHost {
  readonly patch: Patch;
  tele: Tele | null = null;
  analyser: AnalyserNode | null = null;
  sampleRate = 48000;
  onTele: ((t: Tele) => void) | null = null;
  /** Fired once audio is running. */
  onStart: (() => void) | null = null;

  private node: { port: Port } | null = null;
  /** "worklet" normally; "stream" when the fallback is running */
  kind: "worklet" | "stream" | null = null;
  private out: Tone.Gain | null = null;
  private send: Tone.Gain | null = null;
  private chorus: Tone.Chorus | null = null;
  private delay: Tone.PingPongDelay | null = null;
  private starting: Promise<void> | null = null;
  private queue: Msg[] = [];
  private opts: HostOpts;
  private level: number;
  private muted = false;
  private fxMix = { chorus: 0, delay: 0, reverb: 0 };

  constructor(initial: DeepPartial<Patch> = {}, opts: HostOpts = {}) {
    this.patch = mergePatch(defaultPatch(), initial);
    this.opts = opts;
    this.level = opts.level ?? 1;
    this.fxMix.reverb = opts.reverb ?? 0;
  }

  get live(): boolean {
    return !!this.node;
  }

  /** Call from a user gesture. Idempotent; resolves when the node is running. */
  start(): Promise<void> {
    this.starting ??= (async () => {
      await unlockAudio();
      const ctx = Tone.getContext();
      this.sampleRate = ctx.sampleRate;
      this.kind = await engineKind();
      let node: { port: Port };
      let src: Tone.InputNode;
      if (this.kind === "worklet") {
        const wn = ctx.createAudioWorkletNode("synth-engine", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        }) as unknown as AudioWorkletNode;
        node = wn as unknown as { port: Port };
        src = wn as unknown as Tone.InputNode;
      } else {
        const sn = new StreamNode(await loadProcClass(ctx.sampleRate));
        node = sn;
        src = sn.output;
      }
      node.port.onmessage = (e: MessageEvent) => {
        const t = e.data as Tele & { type?: string };
        if (t.type !== "tele") return;
        t.at = performance.now();
        this.tele = t;
        this.onTele?.(t);
      };
      this.out = new Tone.Gain(this.muted ? 0 : this.level);
      Tone.connect(src as unknown as AudioNode, this.out);
      let tail: Tone.ToneAudioNode = this.out;
      if (this.opts.fx) {
        this.chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.6, spread: 160, wet: this.fxMix.chorus }).start();
        this.delay = new Tone.PingPongDelay({ delayTime: 0.33, feedback: 0.32, wet: this.fxMix.delay });
        this.out.chain(this.chorus, this.delay);
        tail = this.delay;
      }
      tail.connect(masterBus());
      this.send = new Tone.Gain(this.fxMix.reverb);
      tail.connect(this.send);
      this.send.connect(reverbSend());
      if (this.opts.fft) {
        const an = ctx.createAnalyser();
        an.fftSize = this.opts.fft;
        an.smoothingTimeConstant = this.opts.smoothing ?? 0.5;
        an.minDecibels = -120;
        an.maxDecibels = 0;
        Tone.connect(this.out, an as unknown as AudioNode);
        this.analyser = an as unknown as AnalyserNode;
      }
      this.node = node;
      this.post({ type: "patch", patch: this.patch });
      this.post({ type: "tele", every: 5, scope: !!this.opts.scope, ks: !!this.opts.ks });
      for (const m of this.queue) this.post(m);
      this.queue.length = 0;
      this.onStart?.();
    })();
    return this.starting;
  }

  private post(m: Msg): void {
    if (this.node) this.node.port.postMessage(m);
    else if (m.type !== "patch") this.queue.push(m);
  }

  set(partial: DeepPartial<Patch>): void {
    mergePatch(this.patch, partial);
    if (this.node) this.node.port.postMessage({ type: "patch", patch: partial });
  }

  noteOn(id: number, note: number, vel = 0.8): void {
    if (this.muted) this.wake();
    if (!this.node) {
      this.queue.push({ type: "on", id, note, vel });
      void this.start();
      return;
    }
    this.post({ type: "on", id, note, vel });
  }
  noteOff(id: number): void {
    this.post({ type: "off", id });
  }
  pitch(id: number, note: number): void {
    this.post({ type: "pitch", id, note });
  }
  allOff(): void {
    this.post({ type: "allOff" });
  }
  bend(semis: number): void {
    this.post({ type: "bend", value: semis });
  }
  mod(v: number): void {
    this.post({ type: "mod", value: v });
  }

  setFx(mix: { chorus?: number; delay?: number; reverb?: number }): void {
    Object.assign(this.fxMix, mix);
    if (this.chorus && mix.chorus !== undefined) this.chorus.wet.rampTo(mix.chorus, 0.1);
    if (this.delay && mix.delay !== undefined) this.delay.wet.rampTo(mix.delay, 0.1);
    if (this.send && mix.reverb !== undefined) this.send.gain.rampTo(mix.reverb, 0.1);
  }
  get fx(): { chorus: number; delay: number; reverb: number } {
    return this.fxMix;
  }

  /** Fade out and stop every voice (the figure went off screen). */
  sleep(): void {
    if (this.muted) return;
    this.muted = true;
    this.out?.gain.rampTo(0, 0.12);
    window.setTimeout(() => {
      if (this.muted) this.node?.port.postMessage({ type: "kill" });
    }, 160);
  }
  /** Undo sleep(). */
  wake(): void {
    if (!this.muted) return;
    this.muted = false;
    this.out?.gain.cancelScheduledValues(Tone.now());
    this.out?.gain.rampTo(this.level, 0.03);
  }
  get asleep(): boolean {
    return this.muted;
  }

  /** dB per bin (fills `into`). */
  freqData(into: Float32Array): boolean {
    if (!this.analyser) return false;
    this.analyser.getFloatFrequencyData(into as Float32Array<ArrayBuffer>);
    return true;
  }
  timeData(into: Float32Array): boolean {
    if (!this.analyser) return false;
    this.analyser.getFloatTimeDomainData(into as Float32Array<ArrayBuffer>);
    return true;
  }

  /** Voices sounding right now, newest first. */
  voices(): VoiceTele[] {
    const t = this.tele;
    if (!t) return [];
    return [...t.voices].sort((a, b) => b.age - a.age);
  }
}
