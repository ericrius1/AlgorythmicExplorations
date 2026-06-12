// The chord under the microscope. Pick a root on the piano, pick a quality,
// and the figure shows every note's harmonic ladder on a log-frequency axis —
// the same comb view that explained intervals, now three and four notes deep.
// A major triad locks into the 4:5:6 lattice (it lives inside one harmonic
// series); minor rearranges the same intervals into a weaker 10:12:15
// anchoring; diminished can't find a foothold at all. The sadness is
// structural.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, midiToFreq, NOTE_NAMES } from "../../lib/audio";
import { Piano } from "../../lib/piano";

const P = 6; // partials drawn per voice
const C3 = 130.81;

interface Quality {
  name: string;
  iv: number[];
  story: string;
}
const QUALITIES: Quality[] = [
  { name: "major", iv: [0, 4, 7], story: "4:5:6 — a slice of one harmonic series" },
  { name: "minor", iv: [0, 3, 7], story: "10:12:15 — same intervals, weaker anchor" },
  { name: "diminished", iv: [0, 3, 6], story: "no simple lattice — pure instability" },
  { name: "augmented", iv: [0, 4, 8], story: "perfectly symmetric — no home, no root" },
  { name: "sus4", iv: [0, 5, 7], story: "6:8:9 — the third withheld, neither happy nor sad" },
  { name: "dom7", iv: [0, 4, 7, 10], story: "major plus a tritone inside — the engine of part five" },
  { name: "maj7", iv: [0, 4, 7, 11], story: "8:10:12:15 — soft dissonance worn as perfume" },
  { name: "min7", iv: [0, 3, 7, 10], story: "10:12:15:18 — minor with the edges sanded" },
];

const SCENE = /* wgsl */ `
fn xOf(f: f32) -> f32 {
  return log2(f / ${C3}) / 4.6 + 0.04;
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let count = u32(uf(8u));
  let strike = uf(9u);
  var col = vec3f(0.0);

  let mid = 0.36;
  col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - mid), 0.0018);

  // each voice: its ladder of partials rising from the axis
  for (var v = 0u; v < 4u; v++) {
    if (v >= count) { break; }
    let f = uf(4u + v);
    let hue = 0.56 + f32(v) * 0.09;
    for (var k = 0u; k < ${P}u; k++) {
      let amp = 1.0 / f32(k + 1u);
      let x = xOf(f * f32(k + 1u));
      let len = 0.06 + amp * 0.30;
      if (uv.y > mid && uv.y < mid + len && abs(uv.x - x) < 0.01) {
        col += hsv(hue, 0.7, 1.0) * glow(abs(uv.x - x), 0.0019) * (0.35 + amp) * (0.7 + strike * 0.6);
      }
    }
    // the fundamental, marked below the axis
    col += hsv(hue, 0.6, 1.0) * glow(length(vec2f((uv.x - xOf(f)) * uf(1u), (uv.y - mid + 0.07) )), 0.014) * 0.9;
  }

  // handshakes and collisions between every pair of voices
  for (var a = 0u; a < 4u; a++) {
    for (var b = a + 1u; b < 4u; b++) {
      if (b >= count) { continue; }
      let fa = uf(4u + a);
      let fb = uf(4u + b);
      for (var i = 1u; i <= ${P}u; i++) {
        for (var j = 1u; j <= ${P}u; j++) {
          let xa = xOf(fa * f32(i));
          let xb = xOf(fb * f32(j));
          let sep = abs(xa - xb);
          if (sep < 0.016) {
            let amp = 1.0 / (f32(i) * f32(j));
            let x = (xa + xb) * 0.5;
            let d = length(vec2f((uv.x - x) * uf(1u), (uv.y - 0.84) * 2.0));
            let fuse = smoothstep(0.0035, 0.0, sep);
            let fight = smoothstep(0.0, 0.0035, sep) * smoothstep(0.016, 0.007, sep);
            col += vec3f(1.0, 0.97, 0.88) * glow(d, 0.014) * fuse * amp * 2.6;
            col += vec3f(1.0, 0.2, 0.12) * glow(d, 0.016) * fight * amp * (1.3 + sin(t * 8.0)) * 1.5;
          }
        }
      }
    }
  }

  return col * vignette(uv);
}
`;

export async function mountTriadLab(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.5);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, 4);
  soundHint(container, "click a key below");

  let root = 48; // C3
  let quality = QUALITIES[0];
  let strike = 0;

  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.02, decay: 0.6, sustain: 0.35, release: 1.2 },
    volume: -12,
  }).connect(masterBus());
  const guard = frameGuard(() => synth.releaseAll());

  const midis = (): number[] => quality.iv.map((s) => root + s);

  const piano = new Piano({
    low: 48,
    high: 72,
    onPress: (m) => {
      root = m;
      void unlockAudio().then(strum);
    },
  });
  shell.controls.before(piano.el);

  let lastFrame = 0;
  const strum = (): void => {
    if (performance.now() - lastFrame > 400) return;
    strike = 1;
    synth.releaseAll();
    const now = Tone.now();
    midis().forEach((m, i) => {
      synth.triggerAttackRelease(midiToFreq(m), 2.2, now + i * 0.02);
    });
    piano.setHeld(midis(), root);
  };

  const qBtns: HTMLButtonElement[] = [];
  QUALITIES.forEach((q, i) => {
    shell.button(q.name, () => {
      quality = QUALITIES[i];
      qBtns.forEach((b, j) => (b.style.borderColor = j === i ? "var(--accent)" : "var(--border)"));
      void unlockAudio().then(strum);
    });
    qBtns.push(shell.controls.lastElementChild as HTMLButtonElement);
  });
  qBtns[0].style.borderColor = "var(--accent)";

  shell.setInfo(() => `${NOTE_NAMES[root % 12]} ${quality.name} · ${quality.story}`);

  piano.setHeld(midis(), root);

  return {
    frame() {
      shell.tick();
      guard.pulse();
      lastFrame = performance.now();
      strike *= 0.96;
      const ms = midis();
      for (let v = 0; v < 4; v++) view.uniforms[4 + v] = v < ms.length ? midiToFreq(ms[v]) : 0;
      view.uniforms[8] = ms.length;
      view.uniforms[9] = strike;
      view.draw();
    },
    dispose() {
      synth.releaseAll();
    },
  };
}
