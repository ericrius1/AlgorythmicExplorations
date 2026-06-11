// Two sine waves, almost the same pitch. The figure draws both ingredients
// faintly and their sum brightly; the sum's envelope swells and collapses at
// exactly the difference frequency — beats. Slide the detune through zero and
// hear unison → slow throb → angry roughness → two separate notes.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice } from "../lib/gpu";
import { ShaderView } from "../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, cents } from "../lib/audio";

const F1 = 220;

const SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let delta = uf(4u);   // true detune in Hz
  let beatPhase = uf(5u);
  var col = vec3f(0.0);
  col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - 0.5), 0.002);

  // draw at a visual scale: ~6 cycles of tone A across the screen.
  // The spatial interference pattern is exact; the throb pulses at the
  // *true* beat rate via beatPhase.
  let cyc = 6.0;
  let ratio = (f32(${F1}) + delta) / f32(${F1});
  let ph = t * 0.35;
  let wA = sin(6.2831853 * (cyc * uv.x - ph));
  let wB = sin(6.2831853 * (cyc * ratio * uv.x - ph * ratio) + beatPhase);
  let sum = (wA + wB) * 0.5;

  let yA = 0.5 + wA * 0.10;
  let yB = 0.5 + wB * 0.10;
  col += hsv(0.58, 0.7, 0.8) * glow(abs(uv.y - yA), 0.0016) * 0.4;
  col += hsv(0.08, 0.7, 0.8) * glow(abs(uv.y - yB), 0.0016) * 0.4;

  let y = 0.5 + sum * 0.34;
  let pulse = 0.75 + 0.25 * cos(beatPhase);
  col += vec3f(1.0, 0.95, 0.8) * (glow(abs(uv.y - y), 0.003) * 1.2 + halo(abs(uv.y - y), 0.0045) * 0.35) * pulse;

  // envelope: |cos| of half the difference, the skin the sum lives inside
  let env = abs(cos(3.14159265 * (ratio - 1.0) * cyc * uv.x * 0.5 + beatPhase * 0.5)) * 0.34 + 0.001;
  col += hsv(0.13, 0.9, 0.9) * (glow(abs(uv.y - (0.5 + env)), 0.0014) + glow(abs(uv.y - (0.5 - env)), 0.0014)) * 0.5;

  return col * vignette(uv);
}
`;

export async function mountBeats(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.5);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, 4);
  soundHint(container);

  let delta = 3;
  let playing = false;

  const gain = new Tone.Gain(0).connect(masterBus());
  const a = new Tone.Oscillator(F1, "sine").connect(gain);
  const b = new Tone.Oscillator(F1 + delta, "sine").connect(gain);

  const setPlaying = (on: boolean): void => {
    playing = on;
    if (on) {
      if (a.state !== "started") {
        a.start();
        b.start();
      }
      gain.gain.rampTo(0.3, 0.15);
    } else {
      gain.gain.rampTo(0, 0.15);
    }
  };
  const guard = frameGuard(() => {
    setPlaying(false);
    sync();
  });

  let btn: HTMLButtonElement;
  const sync = (): void => {
    btn.textContent = playing ? "■ stop" : "▶ play both";
  };
  shell.button("▶ play both", () => {
    void unlockAudio().then(() => {
      setPlaying(!playing);
      sync();
    });
  });
  btn = shell.controls.lastElementChild as HTMLButtonElement;

  shell.slider({
    label: "detune",
    min: -40,
    max: 40,
    step: 0.1,
    value: delta,
    format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} Hz`,
    onInput: (v) => {
      delta = v;
      b.frequency.rampTo(F1 + delta, 0.03);
    },
  });
  shell.setInfo(() => {
    const d = Math.abs(delta);
    const c = Math.abs(cents((F1 + delta) / F1)).toFixed(0);
    const zone =
      d < 0.2 ? "unison — one steady tone" :
      d < 8 ? `beating ${d.toFixed(1)}× per second` :
      d < 25 ? "too fast to count — roughness" : "splitting into two notes";
    return `220 Hz + ${(F1 + delta).toFixed(1)} Hz (${c}¢ apart) · ${zone}`;
  });

  let beatPhase = 0;
  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      beatPhase += 2 * Math.PI * delta * ((now - last) / 1000);
      last = now;
      view.uniforms[4] = delta;
      view.uniforms[5] = beatPhase % (2 * Math.PI * 1e3);
      view.draw();
    },
    dispose() {
      setPlaying(false);
    },
  };
}
