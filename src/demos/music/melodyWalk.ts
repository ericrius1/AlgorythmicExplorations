// Melody as a controlled random walk. Every eighth note the walker chooses:
// repeat, step, or leap — weighted by the smoothness slider — and on strong
// beats a gravity slider pulls it toward the current chord's tones. Crank
// gravity to hear an arpeggio-bot; kill it and the line goes free-jazz;
// the sweet spot in the middle is where melodies live.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, midiToFreq, StepClock } from "../../lib/audio";

const TRAIL = 64; // eighth-notes shown
const DEGREES = 15; // two octaves of scale rows
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const CHORDS = [
  { label: "I", degs: [0, 2, 4] },
  { label: "IV", degs: [3, 5, 0] },
  { label: "V", degs: [4, 6, 1] },
  { label: "I", degs: [0, 2, 4] },
];

const SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let head = uf(4u);   // index of the newest trail slot
  let chord = u32(uf(5u));
  let pulse = uf(6u);
  var col = vec3f(0.0);

  // scale-degree lattice; chord-tone rows glow faintly
  for (var d = 0u; d < ${DEGREES}u; d++) {
    let y = 0.08 + f32(d) / f32(${DEGREES - 1}) * 0.84;
    let isChord = D[${TRAIL}u + chord * ${DEGREES}u + d];
    col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - y), 0.0012);
    col += hsv(0.1, 0.7, 0.8) * glow(abs(uv.y - y), 0.0035) * isChord * (0.22 + pulse * 0.25);
  }

  // the walk: newest at the right edge, history scrolling left
  for (var i = 0u; i < ${TRAIL}u; i++) {
    let age = f32(i) / f32(${TRAIL}); // 0 = newest
    let slot = (u32(head) + ${TRAIL}u - i) % ${TRAIL}u;
    let deg = D[slot];
    if (deg < -0.5) { continue; } // rest
    let x = 0.96 - age * 0.92;
    let y = 0.08 + deg / f32(${DEGREES - 1}) * 0.84;
    let bright = exp(-age * 2.6);
    let d = length(vec2f((uv.x - x) * uf(1u), uv.y - y));
    col += hsv(0.52 + deg * 0.014, 0.6, 1.0) * (glow(d, 0.012 + 0.01 * (1.0 - age)) * bright + halo(d, 0.008) * 0.25 * bright);
    // connecting thread to the previous note
    let slot2 = (slot + ${TRAIL}u - 1u) % ${TRAIL}u;
    let deg2 = D[slot2];
    if (deg2 > -0.5 && i + 1u < ${TRAIL}u) {
      let x2 = 0.96 - (age + 1.0 / f32(${TRAIL})) * 0.92;
      let y2 = 0.08 + deg2 / f32(${DEGREES - 1}) * 0.84;
      let p = vec2f((uv.x) * uf(1u), uv.y);
      let dseg = sdSeg(p, vec2f(x * uf(1u), y), vec2f(x2 * uf(1u), y2));
      col += hsv(0.55, 0.5, 0.9) * glow(dseg, 0.0022) * bright * 0.5;
    }
  }
  return col * vignette(uv);
}
`;

export async function mountMelodyWalk(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.52);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, TRAIL + 4 * DEGREES);
  soundHint(container);

  // chord-tone lookup rows for the shader
  for (let c = 0; c < 4; c++) {
    for (let d = 0; d < DEGREES; d++) {
      view.data[TRAIL + c * DEGREES + d] = CHORDS[c].degs.includes(d % 7) ? 1 : 0;
    }
  }
  view.data.fill(-1, 0, TRAIL);

  let smooth = 0.75; // probability mass on small moves
  let gravity = 0.6; // chord-tone pull on strong beats
  let density = 0.8; // probability a slot sounds at all

  const reverb = new Tone.Reverb({ decay: 2.2, wet: 0.25 }).connect(masterBus());
  const lead = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.18, sustain: 0.3, release: 0.2 },
    volume: -9,
  }).connect(reverb);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.1, decay: 0.5, sustain: 0.4, release: 1.2 },
    volume: -19,
  }).connect(reverb);

  let deg = 7; // start on the upper tonic
  let head = 0;
  let pulse = 0;

  const degToMidi = (d: number): number => 60 + MAJOR[d % 7] + 12 * Math.floor(d / 7);

  const clock = new StepClock(96, 2, (step, time) => {
    const eighth = step % 32; // 4 bars of 8
    const chordIdx = Math.floor(eighth / 8) % 4;
    const chord = CHORDS[chordIdx];

    if (eighth % 8 === 0) {
      // strong-beat pad
      for (const d of chord.degs) pad.triggerAttackRelease(midiToFreq(degToMidi(d)), 2.2, time);
      pulse = 1;
    }

    head = (head + 1) % TRAIL;
    if (Math.random() > density) {
      view.data[head] = -1; // a rest
      return;
    }

    // choose the move
    const r = Math.random();
    let next: number;
    if (r < smooth * 0.35) next = deg; // repeat
    else if (r < smooth) next = deg + (Math.random() < 0.5 ? -1 : 1); // step
    else next = deg + (Math.random() < 0.5 ? -1 : 1) * (2 + Math.floor(Math.random() * 3)); // leap

    // gravity: on strong beats, snap toward the nearest chord tone
    if (eighth % 2 === 0 && Math.random() < gravity) {
      let best = next;
      let bestD = 99;
      for (let cand = next - 3; cand <= next + 3; cand++) {
        if (cand < 0 || cand >= DEGREES) continue;
        if (!chord.degs.includes(((cand % 7) + 7) % 7)) continue;
        const dd = Math.abs(cand - next);
        if (dd < bestD) {
          bestD = dd;
          best = cand;
        }
      }
      next = best;
    }
    deg = Math.max(0, Math.min(DEGREES - 1, next));
    view.data[head] = deg;
    lead.triggerAttackRelease(midiToFreq(degToMidi(deg)), 0.22, time);
  });
  const stop = (): void => {
    clock.stop();
    pad.releaseAll();
  };
  const guard = frameGuard(stop);

  shell.button("▶ play / stop", () => {
    void unlockAudio().then(() => {
      if (clock.isRunning) stop();
      else clock.start();
    });
  });
  shell.slider({
    label: "smoothness (steps vs leaps)",
    min: 0,
    max: 1,
    step: 0.01,
    value: smooth,
    onInput: (v) => (smooth = v),
  });
  shell.slider({
    label: "chord gravity",
    min: 0,
    max: 1,
    step: 0.01,
    value: gravity,
    onInput: (v) => (gravity = v),
  });
  shell.slider({
    label: "note density",
    min: 0.2,
    max: 1,
    step: 0.01,
    value: density,
    onInput: (v) => (density = v),
  });

  shell.setInfo(() => {
    const style = gravity > 0.8 ? "arpeggio-bot" : gravity < 0.2 ? "free-roaming" : smooth > 0.8 ? "singer" : smooth < 0.4 ? "bebop dice" : "melody zone";
    return `I–IV–V–I under a random walk · current persona: ${style}`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      pulse *= 0.95;
      view.uniforms[4] = head;
      view.uniforms[5] = clock.isRunning ? Math.floor((clock.phase(32) * 32) / 8) % 4 : 0;
      view.uniforms[6] = pulse;
      view.draw();
    },
    dispose() {
      stop();
    },
  };
}
