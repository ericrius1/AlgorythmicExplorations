// Hero for "The Anatomy of a Note": a single A, breathing. Before the first
// tap it draws an idealized sine; after, it draws whatever the analyser hears
// — same line, now real. The point of the whole post in one image: a note is
// a shape repeating in time.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, audioOn, waveform, frameGuard, soundHint } from "../../lib/audio";

const N = 256;

const SCENE = /* wgsl */ `
fn sample(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${N - 1});
  let i = u32(floor(f));
  return mix(D[i], D[min(i + 1u, ${N - 1}u)], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let level = uf(4u);
  var col = vec3f(0.0);

  // deep background: slow interference shimmer, the "air"
  let a = sin(uv.x * 9.0 + t * 0.31) * sin(uv.y * 7.0 - t * 0.23);
  let b = sin(uv.x * 15.0 - t * 0.17 + uv.y * 4.0);
  col += vec3f(0.016, 0.02, 0.045) * (0.6 + 0.4 * a) + vec3f(0.02, 0.012, 0.04) * (0.5 + 0.5 * b);

  // echo lines: the same wave, displaced and faded, like pressure fronts
  for (var k = 1; k <= 3; k++) {
    let off = f32(k) * 0.13;
    let yk = 0.5 + sample(uv.x) * (0.16 - f32(k) * 0.03);
    let d = abs(uv.y - yk - off) + abs(uv.y - yk + off) - 2.0 * off;
    col += hsv(0.62 + f32(k) * 0.04, 0.75, 1.0) * halo(d, 0.0035) * 0.05 / f32(k);
  }

  // the note itself
  let y = 0.5 + sample(uv.x) * 0.19;
  let d = abs(uv.y - y);
  let hue = 0.58 - level * 0.07 + 0.03 * sin(t * 0.4);
  col += hsv(hue, 0.55, 1.0) * (glow(d, 0.004 + level * 0.003) * 1.1 + halo(d, 0.006) * 0.35);

  return col * vignette(uv);
}
`;

export async function mountNoteHero(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.42);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, N);
  soundHint(container, "tap to hear the note");

  // --- audio: a soft A3 with slow vibrato and a few gentle partials --------
  let playing = false;
  const gain = new Tone.Gain(0).connect(masterBus());
  const osc = new Tone.Oscillator(220, "sine").connect(gain);
  osc.partials = [1, 0.28, 0.14, 0.07, 0.04];
  const vib = new Tone.LFO(4.6, 218.6, 221.4);
  let level = 0;

  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    if (on) {
      if (osc.state !== "started") {
        osc.start();
        vib.connect(osc.frequency).start();
      }
      gain.gain.rampTo(0.5, 0.8);
    } else {
      gain.gain.rampTo(0, 0.6);
    }
  };
  const guard = frameGuard(() => setPlaying(false));

  shell.canvas.addEventListener("pointerdown", () => {
    void unlockAudio().then(() => setPlaying(!playing));
  });
  shell.setInfo(() => (playing ? "live — this line is your speaker output · tap to hush" : "A · 220 Hz · tap to hear it"));

  let phase = 0;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      level += ((playing ? 1 : 0) - level) * 0.04;
      view.uniforms[4] = level;

      if (audioOn() && level > 0.25) {
        // trigger-stabilized slice of the real output
        const w = waveform();
        let start = 0;
        for (let i = 1; i < w.length - N; i++) {
          if (w[i - 1] <= 0 && w[i] > 0) {
            start = i;
            break;
          }
        }
        for (let i = 0; i < N; i++) view.data[i] = w[start + i] * 1.4;
      } else {
        // idealized stand-in, gently breathing
        phase += 0.012;
        const amp = 0.55 + 0.12 * Math.sin(phase * 0.7);
        for (let i = 0; i < N; i++) {
          const x = i / (N - 1);
          view.data[i] =
            amp *
            (Math.sin(2 * Math.PI * (3 * x - phase)) +
              0.22 * Math.sin(2 * Math.PI * (6 * x - 2 * phase)) +
              0.1 * Math.sin(2 * Math.PI * (9 * x - 3 * phase)));
        }
      }
      view.draw();
    },
    dispose() {
      setPlaying(false);
    },
  };
}
