// Hearing the lie. Two tunings of the same C-major chord, side by side:
// pure ratios (4:5:6) on the left, equal temperament on the right. Between
// each pair of notes hangs a "beat light" that pulses at the true beating
// rate of their nearest harmonic collision — steady on the just side,
// shimmering on the tempered side. The third is the casualty: 13.7¢ off,
// beating ten times a second on every piano you've ever heard.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint } from "../../lib/audio";

const C4 = 261.63;
const P = 6; // partials per voice

interface Tuning {
  name: string;
  freqs: [number, number, number]; // C, E, G
}
const JUSTT: Tuning = { name: "pure ratios 4:5:6", freqs: [C4, C4 * 1.25, C4 * 1.5] };
const ET: Tuning = {
  name: "equal temperament",
  freqs: [C4, C4 * Math.pow(2, 4 / 12), C4 * Math.pow(2, 7 / 12)],
};
// nearest harmonic collisions inside a major triad: C–E meet at 5:4,
// C–G at 3:2, E–G at 6:5
const PAIRS: [number, number, number, number][] = [
  [0, 1, 5, 4],
  [0, 2, 3, 2],
  [1, 2, 6, 5],
];

const SCENE = /* wgsl */ `
fn panel(q: vec2f, side: f32, t: f32, active: f32) -> vec3f {
  var col = vec3f(0.0);
  // three voices: vertical strings at x = -0.5, 0, 0.5 within the panel
  for (var v = 0u; v < 3u; v++) {
    let x = (f32(v) - 1.0) * 0.5;
    let shimmer = D[u32(side) * 8u + 6u + 0u]; // overall shimmer of this side
    let wob = sin(t * 5.0 + f32(v) * 2.1) * 0.006 * shimmer * active;
    let d = sdSeg(q, vec2f(x + wob, -0.62), vec2f(x - wob, 0.45));
    let hue = 0.56 + f32(v) * 0.07 + f32(side) * 0.04;
    col += hsv(hue, 0.6, 1.0) * (glow(d, 0.006) * (0.5 + active * 0.6) + halo(d, 0.006) * 0.25);
  }
  // beat lights between the pairs
  for (var k = 0u; k < 3u; k++) {
    let bright = D[u32(side) * 8u + k];           // 0..1 pulse
    let rate = D[u32(side) * 8u + 3u + k];        // beats/sec, for tinting
    let cx = select(select(0.25, -0.25, k == 0u), 0.0, k == 1u);
    let cy = select(0.62, 0.78, k == 1u);
    let p = vec2f(cx, cy);
    let d = length(q - p);
    let steady = smoothstep(2.0, 0.2, rate);     // calm pairs glow white-green
    let tint = mix(vec3f(1.0, 0.3, 0.2), vec3f(0.55, 1.0, 0.7), steady);
    col += tint * glow(d, 0.035 + 0.025 * bright) * (0.25 + bright) * active;
    col += tint * halo(d, 0.02) * 0.15 * active;
  }
  return col;
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let activeL = uf(4u);
  let activeR = uf(5u);
  var col = vec3f(0.0);

  // divider
  col += vec3f(0.06, 0.07, 0.12) * glow(abs(uv.x - 0.5), 0.0015);

  let scale = 1.25;
  if (uv.x < 0.5) {
    let q = vec2f((uv.x - 0.25) * aspect, uv.y - 0.45) * scale * 2.0;
    col += panel(q, 0.0, t, 0.35 + 0.65 * activeL);
  } else {
    let q = vec2f((uv.x - 0.75) * aspect, uv.y - 0.45) * scale * 2.0;
    col += panel(q, 1.0, t, 0.35 + 0.65 * activeR);
  }
  return col * vignette(uv);
}
`;

export async function mountCommaLab(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.52);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, 16);
  soundHint(container);

  // one oscillator bank per side, three voices of P gentle partials each
  const mkBank = (tuning: Tuning): { gain: Tone.Gain; oscs: Tone.Oscillator[] } => {
    const gain = new Tone.Gain(0).connect(masterBus());
    const oscs = tuning.freqs.map((f) => {
      const o = new Tone.Oscillator(f, "sine").connect(gain);
      o.partials = Array.from({ length: P }, (_, k) => 1 / (k + 1) ** 1.4);
      return o;
    });
    return { gain, oscs };
  };
  const left = mkBank(JUSTT);
  const right = mkBank(ET);

  let activeL = 0;
  let activeR = 0;
  let alternating = 0;

  const setSide = (side: "just" | "et" | "off"): void => {
    activeL = side === "just" ? 1 : 0;
    activeR = side === "et" ? 1 : 0;
    for (const bank of [left, right]) {
      for (const o of bank.oscs) if (o.state !== "started") o.start();
    }
    left.gain.gain.rampTo(activeL * 0.16, 0.12);
    right.gain.gain.rampTo(activeR * 0.16, 0.12);
  };
  const guard = frameGuard(() => {
    clearInterval(alternating);
    setSide("off");
  });

  shell.button("▶ pure 4:5:6", () => {
    void unlockAudio().then(() => {
      clearInterval(alternating);
      setSide(activeL ? "off" : "just");
    });
  });
  shell.button("▶ equal-tempered", () => {
    void unlockAudio().then(() => {
      clearInterval(alternating);
      setSide(activeR ? "off" : "et");
    });
  });
  shell.button("alternate A/B", () => {
    void unlockAudio().then(() => {
      clearInterval(alternating);
      let onJust = true;
      setSide("just");
      alternating = window.setInterval(() => {
        onJust = !onJust;
        setSide(onJust ? "just" : "et");
      }, 1600);
    });
  });
  shell.button("silence", () => {
    clearInterval(alternating);
    setSide("off");
  });

  // beat rates per pair per side (fixed — the physics doesn't change)
  const beatRate = (tu: Tuning, pi: number): number => {
    const [i, j, hi, hj] = PAIRS[pi];
    return Math.abs(tu.freqs[i] * hi - tu.freqs[j] * hj);
  };

  shell.setInfo(() => {
    const thirdsBeat = beatRate(ET, 0).toFixed(1);
    const fifthBeat = beatRate(ET, 1).toFixed(1);
    return `tempered third beats ${thirdsBeat}×/s · tempered fifth only ${fifthBeat}×/s · pure side: 0`;
  });

  const phases = new Float32Array(6);
  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;

      for (let side = 0; side < 2; side++) {
        const tu = side === 0 ? JUSTT : ET;
        let shimmer = 0;
        for (let k = 0; k < 3; k++) {
          const rate = beatRate(tu, k);
          phases[side * 3 + k] += 2 * Math.PI * rate * dt;
          const pulse = rate < 0.05 ? 1 : 0.5 + 0.5 * Math.cos(phases[side * 3 + k]);
          view.data[side * 8 + k] = pulse;
          view.data[side * 8 + 3 + k] = rate;
          shimmer += Math.min(rate / 12, 1);
        }
        view.data[side * 8 + 6] = shimmer / 3;
      }
      view.uniforms[4] = activeL;
      view.uniforms[5] = activeR;
      view.draw();
    },
    dispose() {
      clearInterval(alternating);
      setSide("off");
    },
  };
}
