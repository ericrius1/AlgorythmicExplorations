// The scale as a ring: twelve chromatic positions, seven (or five) of them
// lit. The pattern of gaps — whole steps and half steps — IS the scale;
// rotate the same pattern around a fixed drone and you walk the modes,
// brightest to darkest, without changing a single machine part. The half
// steps glow warm: they're where the flavour lives.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, NOTE_NAMES } from "../../lib/audio";

const C3 = 130.81;

interface Pattern {
  name: string;
  steps: number[]; // semitone gaps, summing to 12
  modeNames?: string[];
}
const PATTERNS: Pattern[] = [
  {
    name: "major (diatonic)",
    steps: [2, 2, 1, 2, 2, 2, 1],
    modeNames: ["Ionian — the major scale", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian — natural minor", "Locrian"],
  },
  {
    name: "pentatonic",
    steps: [2, 2, 3, 2, 3],
    modeNames: ["major pentatonic", "Egyptian / suspended", "blues minor", "blues major", "minor pentatonic"],
  },
  { name: "harmonic minor", steps: [2, 1, 2, 2, 1, 3, 1] },
  { name: "whole tone", steps: [2, 2, 2, 2, 2, 2] },
];
// brightness ladder for the major modes, by rotation index
const BRIGHTNESS: Record<number, string> = {
  3: "brightness 1/7 (brightest)",
  0: "brightness 2/7",
  4: "brightness 3/7",
  1: "brightness 4/7",
  5: "brightness 5/7",
  2: "brightness 6/7",
  6: "brightness 7/7 (darkest)",
};

const SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let comet = uf(4u);    // angle of the playhead, <0 when idle
  let droneOn = uf(5u);
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.4;
  let R = 0.78;

  // drone breath in the middle
  col += hsv(0.08, 0.7, 1.0) * glow(length(q), 0.05 + 0.02 * sin(t * 2.0)) * droneOn * 0.5;

  for (var k = 0u; k < 12u; k++) {
    // pitch class k sits at angle: clockwise from 12 o'clock
    let a = 1.5707963 - f32(k) * 6.2831853 / 12.0;
    let p = vec2f(cos(a), sin(a)) * R;
    let lit = D[k];

    // chromatic ghost positions
    col += vec3f(0.07, 0.08, 0.13) * glow(length(q - p), 0.008);

    if (lit > 0.5) {
      let isRoot = f32(lit > 1.5);
      let hue = mix(0.55 + f32(k) * 0.018, 0.085, isRoot);
      let throb = 1.0 + 0.25 * sin(t * 2.2 + f32(k)) + isRoot * 0.5;
      col += hsv(hue, 0.6, 1.0) * (glow(length(q - p), 0.028) * throb + halo(length(q - p), 0.015) * 0.35);
    }

    // arc to the NEXT lit note, tinted by step size (D[12+k] = gap or 0)
    let gap = D[12u + k];
    if (gap > 0.5) {
      let a2 = 1.5707963 - f32(k + u32(gap)) * 6.2831853 / 12.0;
      // approximate the arc with its chord, drawn slightly inside the ring
      let p2 = vec2f(cos(a2), sin(a2)) * R;
      let d = sdSeg(q, p * 0.92, p2 * 0.92);
      let isHalf = f32(abs(gap - 1.0) < 0.1);
      let hue = mix(0.45, 0.06, isHalf); // whole steps cool, half steps hot
      col += hsv(hue, 0.85, 0.9) * glow(d, 0.0045) * (0.5 + isHalf * 0.6);
    }
  }

  // the playhead comet
  if (comet > -5.0) {
    let p = vec2f(cos(comet), sin(comet)) * R;
    col += vec3f(1.0, 0.95, 0.8) * glow(length(q - p), 0.02) * 1.3;
  }

  return col * vignette(uv);
}
`;

export interface ScaleRingOpts {
  mode?: "hero" | "lab";
}

export async function mountScaleRing(container: HTMLElement, opts: ScaleRingOpts = {}): Promise<Demo> {
  const hero = opts.mode === "hero";
  const dev = await getDevice();
  const shell = new Shell(container, hero ? 0.42 : 0.66);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, 24);
  soundHint(container, hero ? "tap for the drone" : "tap for sound");

  let patIdx = 0;
  let rotation = 0; // which scale degree of the pattern sits on the root
  let droneOn = false;

  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.5 },
    volume: -11,
  }).connect(masterBus());
  const droneGain = new Tone.Gain(0).connect(masterBus());
  const drone = new Tone.Oscillator(C3 / 2, "sine").connect(droneGain);
  drone.partials = [1, 0.5, 0.25, 0.18, 0.1];

  const setDrone = (on: boolean): void => {
    droneOn = on;
    if (on && drone.state !== "started") drone.start();
    droneGain.gain.rampTo(on ? 0.22 : 0, 0.4);
  };
  let queue: { at: number; pc: number }[] = [];
  const silence = (): void => {
    setDrone(false);
    synth.releaseAll();
    queue = [];
  };
  const guard = frameGuard(silence);

  // pitch classes of the current scale, ascending from the root (pc 0 = C)
  const scalePCs = (): number[] => {
    const steps = PATTERNS[patIdx].steps;
    const n = steps.length;
    const out = [0];
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      acc += steps[(rotation + i) % n];
      out.push(acc);
    }
    return out;
  };

  let lastFrame = 0;
  const playSeq = (pcs: number[], stepSec: number): void => {
    if (performance.now() - lastFrame > 400) return;
    const now = Tone.now();
    queue = pcs.map((pc, i) => ({ at: now + i * stepSec, pc: pc % 12 }));
    for (const [i, pc] of pcs.entries()) {
      synth.triggerAttackRelease(C3 * Math.pow(2, pc / 12), stepSec * 0.9, now + i * stepSec);
    }
  };
  const playScale = (): void => playSeq([...scalePCs(), 12], 0.28);
  const playRiff = (): void => {
    const s = scalePCs();
    const deg = [0, 2, 4, 5, 4, 2, 1, 0];
    playSeq(deg.map((d) => (d < s.length ? s[d] : 12)), 0.22);
  };

  const modeName = (): string => {
    const p = PATTERNS[patIdx];
    if (!p.modeNames) return p.name;
    return p.modeNames[rotation % p.steps.length];
  };

  if (hero) {
    shell.canvas.addEventListener("pointerdown", () => {
      void unlockAudio().then(() => setDrone(!droneOn));
    });
    let tick = 0;
    window.setInterval(() => {
      tick++;
      if (tick % 3 === 0) {
        rotation = (rotation + 1) % PATTERNS[0].steps.length;
        if (droneOn) playScale();
      }
    }, 2600);
  } else {
    shell.button("▶ play the scale", () => {
      void unlockAudio().then(playScale);
    });
    shell.button("♪ play a riff", () => {
      void unlockAudio().then(playRiff);
    });
    shell.button("rotate the pattern →", () => {
      rotation = (rotation + 1) % PATTERNS[patIdx].steps.length;
      void unlockAudio().then(playScale);
    });
    shell.button("drone C", () => {
      void unlockAudio().then(() => setDrone(!droneOn));
    });
    shell.button("pattern: major", () => {
      patIdx = (patIdx + 1) % PATTERNS.length;
      rotation = 0;
      const btns = shell.controls.querySelectorAll("button");
      btns[4].textContent = `pattern: ${PATTERNS[patIdx].name.split(" ")[0]}`;
    });
  }

  shell.setInfo(() => {
    const pcs = scalePCs();
    const names = pcs.map((pc) => NOTE_NAMES[pc % 12]).join(" ");
    const bright = patIdx === 0 ? ` · ${BRIGHTNESS[rotation]}` : "";
    return `${modeName()} on C · ${names}${bright}`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      lastFrame = performance.now();

      const pcs = scalePCs();
      view.data.fill(0);
      for (const pc of pcs) view.data[pc % 12] = 1;
      view.data[0] = 2; // root
      // gaps: from each lit pc, the distance to the next lit one
      const sorted = [...pcs].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i] % 12;
        const next = i + 1 < sorted.length ? sorted[i + 1] : 12;
        view.data[12 + cur] = next - sorted[i];
      }

      // comet follows whatever is scheduled
      const now = Tone.now();
      let comet = -10;
      for (const q of queue) {
        if (Math.abs(now - q.at) < 0.14) comet = Math.PI / 2 - (q.pc * 2 * Math.PI) / 12;
      }
      view.uniforms[4] = comet;
      view.uniforms[5] = droneOn ? 1 : 0;
      view.draw();
    },
    dispose() {
      silence();
    },
  };
}
