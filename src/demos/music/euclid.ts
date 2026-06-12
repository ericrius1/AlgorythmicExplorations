// Euclidean rhythm: spread k hits as evenly as possible over 16 steps — the
// same greatest-common-divisor cascade Euclid wrote down, repurposed as a
// drummer. Three rings, three drums; the sliders pick k, and half the
// world's groove vocabulary falls out of one integer each.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, StepClock } from "../../lib/audio";

const STEPS = 16;

export function euclidPattern(k: number, n: number, rot = 0): boolean[] {
  // Bresenham form of Bjorklund's algorithm
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const j = (((i - rot) % n) + n) % n;
    out.push(Math.floor(((j + 1) * k) / n) !== Math.floor((j * k) / n));
  }
  return out;
}

const SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let head = uf(4u); // 0..1 through the bar
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.3;

  // sweep arm
  let ha = 1.5707963 - head * 6.2831853;
  col += vec3f(0.5, 0.55, 0.7) * glow(sdSeg(q, vec2f(0.0), vec2f(cos(ha), sin(ha)) * 0.97), 0.0022) * 0.5;

  for (var ring = 0u; ring < 3u; ring++) {
    let R = 0.92 - f32(ring) * 0.27;
    let flash = uf(5u + ring);
    let hue = select(select(0.08, 0.55, ring == 1u), 0.32, ring == 2u);
    col += hsv(hue, 0.4, 0.5) * glow(abs(length(q) - R), 0.0016) * 0.4;

    for (var s = 0u; s < ${STEPS}u; s++) {
      let on = D[ring * ${STEPS}u + s];
      let a = 1.5707963 - f32(s) * 6.2831853 / f32(${STEPS});
      let p = vec2f(cos(a), sin(a)) * R;
      let d = length(q - p);
      if (on > 0.5) {
        // is the playhead on this step right now?
        let stepHead = fract(head * f32(${STEPS}));
        let isNow = f32(u32(head * f32(${STEPS})) % ${STEPS}u == s) * (1.0 - stepHead * 0.7);
        col += hsv(hue, 0.7, 1.0) * (glow(d, 0.02 + flash * 0.012 * isNow) * (0.8 + isNow * 1.6) + halo(d, 0.012) * 0.3);
      } else {
        col += vec3f(0.07, 0.08, 0.13) * glow(d, 0.006);
      }
    }
    // ring pulse on hit
    col += hsv(hue, 0.6, 1.0) * glow(abs(length(q) - R), 0.012) * flash * 0.7;
  }
  return col * vignette(uv);
}
`;

export async function mountEuclid(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.62);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, 3 * STEPS);
  soundHint(container);

  const ks = [4, 2, 8]; // kick, snare, hat hit-counts
  const rots = [0, 4, 0];
  let patterns = [0, 1, 2].map((r) => euclidPattern(ks[r], STEPS, rots[r]));
  const rebuild = (): void => {
    patterns = [0, 1, 2].map((r) => euclidPattern(ks[r], STEPS, rots[r]));
    for (let r = 0; r < 3; r++) {
      for (let s = 0; s < STEPS; s++) view.data[r * STEPS + s] = patterns[r][s] ? 1 : 0;
    }
  };
  rebuild();

  // ---- a tiny drum kit ------------------------------------------------------
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 7, volume: -6 }).connect(masterBus());
  const snareFilter = new Tone.Filter(1800, "bandpass").connect(masterBus());
  const snare = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
    volume: -8,
  }).connect(snareFilter);
  const hatFilter = new Tone.Filter(8000, "highpass").connect(masterBus());
  const hat = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.045, sustain: 0 },
    volume: -14,
  }).connect(hatFilter);

  const flashes = [0, 0, 0];
  const clock = new StepClock(104, 4, (step, time) => {
    const s = step % STEPS;
    if (patterns[0][s]) {
      kick.triggerAttackRelease(55, 0.12, time);
      flashes[0] = 1;
    }
    if (patterns[1][s]) {
      snare.triggerAttackRelease(0.16, time);
      flashes[1] = 1;
    }
    if (patterns[2][s]) {
      hat.triggerAttackRelease(0.05, time);
      flashes[2] = 1;
    }
  });
  const stop = (): void => clock.stop();
  const guard = frameGuard(stop);

  shell.button("▶ play / stop", () => {
    void unlockAudio().then(() => {
      if (clock.isRunning) stop();
      else clock.start();
    });
  });

  const labels = ["kick hits", "snare hits", "hat hits"];
  const sliders: HTMLInputElement[] = [];
  for (const r of [0, 1, 2]) {
    sliders.push(
      shell.slider({
        label: labels[r],
        min: 0,
        max: 16,
        step: 1,
        value: ks[r],
        format: (v) => `E(${v},16)`,
        onInput: (v) => {
          ks[r] = Math.round(v);
          rebuild();
        },
      }),
    );
  }
  shell.slider({
    label: "snare rotate",
    min: 0,
    max: 15,
    step: 1,
    value: rots[1],
    onInput: (v) => {
      rots[1] = Math.round(v);
      rebuild();
    },
  });
  shell.slider({
    label: "tempo",
    min: 70,
    max: 150,
    step: 1,
    value: clock.bpm,
    format: (v) => `${Math.round(v)} bpm`,
    onInput: (v) => (clock.bpm = v),
  });

  const preset = (name: string, kk: number, sn: number, hh: number, srot: number): void => {
    shell.button(name, () => {
      [ks[0], ks[1], ks[2], rots[1]] = [kk, sn, hh, srot];
      sliders.forEach((el, i) => (el.value = String(ks[i])));
      rebuild();
      void unlockAudio().then(() => {
        if (!clock.isRunning) clock.start();
      });
    });
  };
  preset("four on the floor", 4, 2, 8, 4);
  preset("tresillo", 3, 2, 8, 4);
  preset("son-ish", 5, 2, 11, 4);
  preset("busy", 7, 5, 13, 2);

  shell.setInfo(
    () => `kick E(${ks[0]},16) · snare E(${ks[1]},16)+${rots[1]} · hat E(${ks[2]},16) · evenly spread by Euclid's algorithm`,
  );

  return {
    frame() {
      shell.tick();
      guard.pulse();
      for (let r = 0; r < 3; r++) {
        flashes[r] *= 0.88;
        view.uniforms[5 + r] = flashes[r];
      }
      view.uniforms[4] = clock.isRunning ? clock.phase(STEPS) : 0;
      view.draw();
    },
    dispose() {
      stop();
    },
  };
}
