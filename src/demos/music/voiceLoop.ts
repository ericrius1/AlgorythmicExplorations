// Harmony as motion: a four-chord loop with the voices drawn as threads
// through pitch-space. The bass walks the roots; the three upper voices each
// slide to the *nearest* tone of the next chord — voice leading, computed
// live by trying all assignments and keeping the laziest. The amber lane
// underneath is tension: watch it cock on the V chord and release on I, then
// switch to the deceptive cadence and feel the V point somewhere else.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, midiToFreq, StepClock, NOTE_NAMES } from "../../lib/audio";

const SAMPLES = 96; // x-resolution of the thread paths
const BEATS = 16; // 4 chords × 4 beats

interface Chord {
  label: string;
  root: number; // pitch class
  iv: number[];
  tension: number;
}
const ch = (label: string, root: number, iv: number[], tension: number): Chord => ({ label, root, iv, tension });
const MAJ = [0, 4, 7];
const MIN = [0, 3, 7];
const DOM = [0, 4, 7, 10];

interface Progression {
  name: string;
  chords: Chord[];
  blurb: string;
}
const PROGS: Progression[] = [
  {
    name: "I–IV–V–I",
    chords: [ch("I", 0, MAJ, 0.08), ch("IV", 5, MAJ, 0.4), ch("V", 7, DOM, 0.9), ch("I", 0, MAJ, 0.08)],
    blurb: "the three-chord trick: home, away, bowstring, home",
  },
  {
    name: "I–V–vi–IV",
    chords: [ch("I", 0, MAJ, 0.08), ch("V", 7, MAJ, 0.75), ch("vi", 9, MIN, 0.45), ch("IV", 5, MAJ, 0.4)],
    blurb: "the pop loop — tension never fully spent, so it cycles forever",
  },
  {
    name: "ii–V–I",
    chords: [ch("ii", 2, MIN, 0.45), ch("V7", 7, DOM, 0.92), ch("I", 0, MAJ, 0.08), ch("I", 0, MAJ, 0.08)],
    blurb: "jazz's handshake: approach the bowstring by a fifth, then release",
  },
  {
    name: "i–VI–III–VII",
    chords: [ch("i", 0, MIN, 0.25), ch("VI", 8, MAJ, 0.4), ch("III", 3, MAJ, 0.5), ch("VII", 10, MAJ, 0.65)],
    blurb: "the minor anthem loop — sadness with momentum",
  },
  {
    name: "deceptive: I–IV–V–vi",
    chords: [ch("I", 0, MAJ, 0.08), ch("IV", 5, MAJ, 0.4), ch("V7", 7, DOM, 0.92), ch("vi", 9, MIN, 0.55)],
    blurb: "the V promises home and hands you the relative minor instead",
  },
];

const SCENE = /* wgsl */ `
fn voiceY(v: u32, x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${SAMPLES - 1});
  let i = u32(floor(f));
  return mix(D[v * ${SAMPLES}u + i], D[v * ${SAMPLES}u + min(i + 1u, ${SAMPLES - 1}u)], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let head = uf(4u);
  let pulse = uf(5u);
  var col = vec3f(0.0);

  // chord boundaries
  for (var k = 0u; k < 5u; k++) {
    let x = f32(k) * 0.25;
    col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.x - x), 0.0012) * step(0.2, uv.y);
  }

  // tension lane
  if (uv.y < 0.16) {
    let seg = min(u32(uv.x * 4.0), 3u);
    let tn = D[${4 * SAMPLES}u + seg];
    let h = tn * 0.13;
    if (uv.y < h + 0.015) {
      col += mix(vec3f(0.1, 0.3, 0.25), vec3f(1.0, 0.45, 0.1), tn) * (0.3 + 0.4 * smoothstep(h + 0.015, h - 0.04, uv.y));
    }
  }

  // the four threads: bass low and warm, three voices cool
  for (var v = 0u; v < 4u; v++) {
    let y = voiceY(v, uv.x);
    let d = abs(uv.y - y);
    let isBass = f32(v == 0u);
    let hue = mix(0.52 + f32(v) * 0.06, 0.08, isBass);
    let near = exp(-pow((uv.x - head) * 9.0, 2.0)) * pulse;
    col += hsv(hue, 0.6, 1.0) * (glow(d, 0.003 + isBass * 0.0015) * (0.7 + near * 1.2) + halo(d, 0.004) * 0.25);
  }

  // playhead
  col += vec3f(1.0, 0.95, 0.85) * glow(abs(uv.x - head), 0.0022) * (0.5 + pulse * 0.6);

  return col * vignette(uv);
}
`;

export interface VoiceLoopOpts {
  mode?: "hero" | "lab";
}

export async function mountVoiceLoop(container: HTMLElement, opts: VoiceLoopOpts = {}): Promise<Demo> {
  const hero = opts.mode === "hero";
  const dev = await getDevice();
  const shell = new Shell(container, hero ? 0.42 : 0.56);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, 4 * SAMPLES + 4);
  soundHint(container, hero ? "tap to start the band" : "tap for sound");

  let prog = PROGS[hero ? 1 : 0];

  const reverb = new Tone.Reverb({ decay: 2.8, wet: 0.3 }).connect(masterBus());
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.06, decay: 0.4, sustain: 0.5, release: 1.4 },
    volume: -14,
  }).connect(reverb);
  const bass = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 0.5 },
    volume: -10,
  }).connect(masterBus());

  // ---- voice leading: lazy voices ------------------------------------------
  // returns per-chord midi notes: [bass, v1, v2, v3]
  const leadVoices = (chords: Chord[]): number[][] => {
    const out: number[][] = [];
    let prev = [60, 64, 67]; // start from C major around middle C
    for (const c of chords) {
      const pcs = c.iv.map((s) => (c.root + s) % 12);
      const triad = pcs.slice(0, 3);
      // try all assignments of voices to the triad's pitch classes
      let best: number[] | null = null;
      let bestCost = 1e9;
      const perms = [
        [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
      ];
      for (const perm of perms) {
        const cand = prev.map((p, vi) => {
          const pc = triad[perm[vi]];
          // nearest octave placement of pc to p, clamped to a singable band
          let m = pc + 12 * Math.round((p - pc) / 12);
          while (m < 55) m += 12;
          while (m > 79) m -= 12;
          return m;
        });
        // discourage unisons between voices
        const distinct = new Set(cand.map((m) => m % 12)).size;
        const cost = cand.reduce((s, m, vi) => s + Math.abs(m - prev[vi]), 0) + (3 - distinct) * 9;
        if (cost < bestCost) {
          bestCost = cost;
          best = cand;
        }
      }
      prev = best!;
      out.push([36 + c.root + (c.root > 7 ? 0 : 12), ...prev]);
    }
    return out;
  };

  let voicing = leadVoices(prog.chords);

  const yOf = (midi: number): number => 0.2 + ((midi - 36) / 48) * 0.74;
  const buildPaths = (): void => {
    for (let v = 0; v < 4; v++) {
      for (let i = 0; i < SAMPLES; i++) {
        const x = i / (SAMPLES - 1);
        const seg = Math.min(Math.floor(x * 4), 3);
        const into = x * 4 - seg;
        const cur = voicing[seg][v];
        const nxt = voicing[(seg + 1) % 4][v];
        // hold, then glide in the last 15% of the bar
        const k = into < 0.85 ? 0 : (into - 0.85) / 0.15;
        const e = k * k * (3 - 2 * k);
        view.data[v * SAMPLES + i] = yOf(cur + (nxt - cur) * e);
      }
    }
    for (let s = 0; s < 4; s++) view.data[4 * SAMPLES + s] = prog.chords[s].tension;
  };
  buildPaths();

  // ---- the band -------------------------------------------------------------
  let pulse = 0;
  const clock = new StepClock(hero ? 72 : 84, 1, (step, time) => {
    const beat = step % BEATS;
    const seg = Math.floor(beat / 4);
    if (beat % 4 === 0) {
      const [b, ...vs] = voicing[seg];
      for (const m of vs) pad.triggerAttackRelease(midiToFreq(m), 3.3, time);
      bass.triggerAttackRelease(midiToFreq(b), 1.6, time);
      pulse = 1;
    } else if (beat % 4 === 2) {
      bass.triggerAttackRelease(midiToFreq(voicing[seg][0]), 0.8, time);
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

  if (hero) {
    shell.canvas.addEventListener("pointerdown", () => {
      void unlockAudio().then(toggle);
    });
  } else {
    shell.button("▶ play / stop", () => {
      void unlockAudio().then(toggle);
    });
    for (const p of PROGS) {
      shell.button(p.name, () => {
        prog = p;
        voicing = leadVoices(prog.chords);
        buildPaths();
        void unlockAudio().then(() => {
          if (!clock.isRunning) clock.start();
        });
      });
    }
    shell.slider({
      label: "tempo",
      min: 56,
      max: 132,
      step: 1,
      value: clock.bpm,
      format: (v) => `${Math.round(v)} bpm`,
      onInput: (v) => (clock.bpm = v),
    });
  }

  shell.setInfo(() => {
    const names = prog.chords.map((c) => `${c.label}(${NOTE_NAMES[c.root]})`).join(" → ");
    return `${names} · ${prog.blurb}`;
  });

  let idlePhase = 0;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      pulse *= 0.94;
      if (clock.isRunning) {
        view.uniforms[4] = clock.phase(BEATS);
      } else {
        idlePhase = (idlePhase + 0.0006) % 1; // silent drift so the figure breathes
        view.uniforms[4] = idlePhase;
      }
      view.uniforms[5] = Math.max(pulse, clock.isRunning ? 0.25 : 0.1);
      view.draw();
    },
    dispose() {
      stop();
    },
  };
}
