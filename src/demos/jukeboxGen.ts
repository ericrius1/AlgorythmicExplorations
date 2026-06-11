// The finale: a band made of the whole series. Equal-tempered grid (post 3),
// a mode picked from post 4's ring, diatonic triads voice-led per post 5,
// Euclidean drums from this post, and a gravity-guided random-walk melody on
// top — all scheduled sample-accurately, all from one seed. The nebula is the
// master bus's live spectrum, swirled through value noise: low partials at
// the core, the drum at the rim. Every song is new. None are saved. Enjoy
// them while they exist.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice } from "../lib/gpu";
import { ShaderView } from "../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, midiToFreq, spectrum, StepClock, NOTE_NAMES } from "../lib/audio";
import { euclidPattern } from "./euclid";

const BINS = 64;

interface Mode {
  name: string;
  steps: number[];
  flavor: string;
}
const MODES: Mode[] = [
  { name: "major", steps: [0, 2, 4, 5, 7, 9, 11], flavor: "bright" },
  { name: "mixolydian", steps: [0, 2, 4, 5, 7, 9, 10], flavor: "sunny slouch" },
  { name: "dorian", steps: [0, 2, 3, 5, 7, 9, 10], flavor: "hopeful minor" },
  { name: "aeolian", steps: [0, 2, 3, 5, 7, 8, 10], flavor: "melancholy" },
  { name: "pentatonic", steps: [0, 2, 4, 7, 9], flavor: "no wrong notes" },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCENE = /* wgsl */ `
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x),
    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0)), u.x),
    u.y,
  );
}
fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var k = 0; k < 4; k++) {
    v += a * vnoise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let kick = uf(4u);
  let snare = uf(5u);
  let energy = uf(6u);
  let hueBase = uf(7u);
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.1;
  let r = length(q);
  let ang = atan2(q.y, q.x);

  // swirl: rotate sampling by noise and time
  let sw = fbm(q * 1.6 + vec2f(t * 0.05, -t * 0.04));
  let a2 = ang + sw * 1.8 + t * 0.03;

  // spectrum shell: radius indexes the FFT (log-ish), low bins at the core
  let binF = clamp(pow(r * 0.78, 1.35), 0.0, 0.999) * f32(${BINS - 1});
  let bi = u32(binF);
  let mag = mix(D[bi], D[min(bi + 1u, ${BINS - 1}u)], fract(binF));

  // angular filaments so the shell isn't a flat ring
  let fil = pow(fbm(vec2f(a2 * 1.9, r * 2.6 - t * 0.08)), 2.0);
  let glowAmt = mag * (0.35 + fil * 1.5);
  let hue = fract(hueBase + r * 0.22 + sw * 0.12);
  col += hsv(hue, 0.65, 1.0) * glowAmt * 1.35;

  // core breath
  col += hsv(fract(hueBase + 0.06), 0.5, 1.0) * glow(r, 0.16 + 0.05 * mag) * (0.25 + energy * 0.3);

  // kick: an expanding shock ring
  let ring = abs(r - (1.25 - kick * 1.0));
  col += vec3f(1.0, 0.85, 0.6) * glow(ring, 0.02 + 0.05 * kick) * kick * 0.9;
  // snare: a brief whole-field sparkle
  col += vec3f(0.7, 0.8, 1.0) * fil * snare * 0.5;

  // starfield dust
  let star = pow(hash(floor(q * 60.0 + vec2f(7.0))), 60.0);
  col += vec3f(star) * 0.5 * (0.4 + 0.6 * sin(t * 2.0 + hash(floor(q * 60.0)) * 40.0));

  return col * vignette(uv);
}
`;

export interface JukeboxOpts {
  mode?: "hero" | "lab";
}

export async function mountJukeboxGen(container: HTMLElement, opts: JukeboxOpts = {}): Promise<Demo> {
  const hero = opts.mode === "hero";
  const dev = await getDevice();
  const shell = new Shell(container, hero ? 0.5 : 0.62);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, BINS);
  soundHint(container, "tap to start the song");

  // ---- instruments -----------------------------------------------------------
  const reverb = new Tone.Reverb({ decay: 4, wet: 0.35 }).connect(masterBus());
  const delay = new Tone.PingPongDelay("3/8", 0.3);
  delay.wet.value = 0.18;
  delay.connect(reverb);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.4, decay: 0.6, sustain: 0.5, release: 2.5 },
    volume: -17,
  }).connect(reverb);
  const lead = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.25, release: 0.3 },
    volume: -16,
  }).connect(delay);
  const bassSyn = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.02, decay: 0.25, sustain: 0.5, release: 0.4 },
    volume: -9,
  }).connect(masterBus());
  const kickSyn = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 7, volume: -7 }).connect(masterBus());
  const snareFilter = new Tone.Filter(1900, "bandpass").connect(masterBus());
  const snareSyn = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 }, volume: -11 }).connect(snareFilter);
  const hatFilter = new Tone.Filter(8500, "highpass").connect(masterBus());
  const hatSyn = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 }, volume: -17 }).connect(hatFilter);

  // ---- the songwriter --------------------------------------------------------
  let modeIdx = hero ? 2 : 0;
  let energy = 0.55;
  let seed = Math.floor(Math.random() * 1e9);
  let rng = mulberry32(seed);

  let progression: number[] = [0, 5, 3, 4]; // scale degrees of the chord roots
  let kickPat: boolean[] = [];
  let snarePat: boolean[] = [];
  let hatPat: boolean[] = [];
  let tonicPC = 0;
  let hueBase = 0.6;
  let walker = 7;

  const mode = (): Mode => MODES[modeIdx];
  const degToMidi = (d: number, base: number): number => {
    const s = mode().steps;
    const n = s.length;
    return base + tonicPC + s[((d % n) + n) % n] + 12 * Math.floor(d / n);
  };
  // diatonic triad on a scale degree: stack scale thirds
  const triad = (deg: number): number[] => [deg, deg + 2, deg + 4];

  const writeSong = (): void => {
    rng = mulberry32(seed);
    tonicPC = Math.floor(rng() * 12);
    hueBase = rng();
    const n = mode().steps.length;
    const second = [3, 5, 1][Math.floor(rng() * 3)] % n;
    const third = [4, 3, 5][Math.floor(rng() * 3)] % n;
    const last = rng() < 0.7 ? 4 % n : 0;
    progression = [0, second, third, last];
    const e = energy;
    kickPat = euclidPattern(2 + Math.round(e * 3), 16, 0);
    snarePat = euclidPattern(rng() < 0.5 ? 2 : 3, 16, 4);
    hatPat = euclidPattern(4 + Math.round(e * 9), 16, Math.floor(rng() * 2));
    walker = n + Math.floor(rng() * n);
  };
  writeSong();

  let kickFlash = 0;
  let snareFlash = 0;

  const clock = new StepClock(hero ? 92 : 100, 4, (step, time) => {
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const chordDeg = progression[bar];
    const e = energy;

    // drums
    if (kickPat[s16]) {
      kickSyn.triggerAttackRelease(50, 0.12, time);
      kickFlash = 1;
    }
    if (snarePat[s16] && e > 0.25) {
      snareSyn.triggerAttackRelease(0.15, time);
      snareFlash = 1;
    }
    if (hatPat[s16] && e > 0.12) hatSyn.triggerAttackRelease(0.04, time, 0.5 + 0.5 * Math.random());

    // pad + bass at bar starts
    if (s16 === 0) {
      for (const d of triad(chordDeg)) pad.triggerAttackRelease(midiToFreq(degToMidi(d, 60)), 4.2, time);
      bassSyn.triggerAttackRelease(midiToFreq(degToMidi(chordDeg, 36)), 1.8, time);
    }
    if (s16 === 8 && e > 0.4) bassSyn.triggerAttackRelease(midiToFreq(degToMidi(chordDeg, 36)), 0.8, time);

    // melody on eighths
    if (s16 % 2 === 0 && Math.random() < 0.25 + e * 0.6) {
      const r = Math.random();
      if (r < 0.3) {
        /* hold */
      } else if (r < 0.85) walker += Math.random() < 0.5 ? -1 : 1;
      else walker += (Math.random() < 0.5 ? -1 : 1) * (2 + Math.floor(Math.random() * 2));
      // chord gravity on the beat
      if (s16 % 4 === 0) {
        const want = triad(chordDeg).map((d) => ((d % mode().steps.length) + mode().steps.length) % mode().steps.length);
        for (let probe = 0; probe < 3; probe++) {
          if (want.includes(((walker % mode().steps.length) + mode().steps.length) % mode().steps.length)) break;
          walker += Math.random() < 0.5 ? -1 : 1;
        }
      }
      walker = Math.max(3, Math.min(2.6 * mode().steps.length, walker));
      lead.triggerAttackRelease(midiToFreq(degToMidi(Math.round(walker), 60)), 0.18, time, 0.5 + e * 0.4);
    }
  });

  const stop = (): void => {
    clock.stop();
    pad.releaseAll();
  };
  const guard = frameGuard(stop);
  const toggle = (): void => {
    if (clock.isRunning) stop();
    else clock.start();
  };

  shell.canvas.addEventListener("pointerdown", () => {
    void unlockAudio().then(() => {
      if (!clock.isRunning) clock.start();
    });
  });

  shell.button("▶ play / stop", () => {
    void unlockAudio().then(toggle);
  });
  shell.button("✨ new song", () => {
    seed = Math.floor(Math.random() * 1e9);
    writeSong();
    void unlockAudio().then(() => {
      if (!clock.isRunning) clock.start();
    });
  });
  let modeBtn: HTMLButtonElement;
  shell.button(`mode: ${mode().name}`, () => {
    modeIdx = (modeIdx + 1) % MODES.length;
    writeSong();
    modeBtn.textContent = `mode: ${mode().name}`;
  });
  modeBtn = shell.controls.lastElementChild as HTMLButtonElement;
  if (!hero) {
    shell.slider({
      label: "tempo",
      min: 70,
      max: 132,
      step: 1,
      value: clock.bpm,
      format: (v) => `${Math.round(v)} bpm`,
      onInput: (v) => (clock.bpm = v),
    });
    shell.slider({
      label: "energy",
      min: 0,
      max: 1,
      step: 0.01,
      value: energy,
      onInput: (v) => {
        energy = v;
        writeSong();
      },
    });
  }

  shell.setInfo(() => {
    const degs = progression.map((d) => d + 1).join("–");
    return `${NOTE_NAMES[tonicPC]} ${mode().name} (${mode().flavor}) · chords on degrees ${degs} · seed ${seed.toString(36)}`;
  });

  const smoothBins = new Float32Array(BINS);
  return {
    frame() {
      shell.tick();
      guard.pulse();
      kickFlash *= 0.9;
      snareFlash *= 0.86;

      const fft = spectrum(); // 128 dB bins
      for (let i = 0; i < BINS; i++) {
        const db = fft[Math.floor((i / BINS) * 100)]; // ignore the top edge
        const v = Math.max(0, (Number.isFinite(db) ? db + 95 : 0) / 60);
        smoothBins[i] += (Math.min(v, 1.6) - smoothBins[i]) * 0.25;
        view.data[i] = smoothBins[i];
      }
      view.uniforms[4] = kickFlash;
      view.uniforms[5] = snareFlash;
      view.uniforms[6] = energy;
      view.uniforms[7] = hueBase;
      view.draw();
    },
    dispose() {
      stop();
    },
  };
}
