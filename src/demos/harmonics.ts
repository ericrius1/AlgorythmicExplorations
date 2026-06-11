// Additive synthesis drawbars: eight sine partials, eight sliders. The
// figure draws each partial faintly and their sum brightly — drag a slider
// and watch the shape morph while the tone changes character. The inverse of
// the oscilloscope demo: there you picked shapes and got recipes, here you
// mix recipes and get shapes.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice } from "../lib/gpu";
import { ShaderView } from "../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint } from "../lib/audio";

const H = 8;
const F0 = 130.81; // C3

const SCENE = /* wgsl */ `
fn partial(n: f32, x: f32, t: f32) -> f32 {
  return sin(6.2831853 * n * (x * 2.0 - t * 0.22));
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  var col = vec3f(0.0);
  col += vec3f(0.05, 0.06, 0.10) * glow(abs(uv.y - 0.5), 0.002);

  // the eight partials, faint, hue-coded by harmonic number
  var sum = 0.0;
  var norm = 0.05;
  for (var n = 0u; n < ${H}u; n++) {
    let a = D[n];
    norm += a;
  }
  for (var n = 0u; n < ${H}u; n++) {
    let a = D[n];
    let w = partial(f32(n + 1u), uv.x, t);
    sum += a * w;
    if (a > 0.01) {
      let yn = 0.5 + (a / norm) * w * 0.42;
      col += hsv(0.58 + f32(n) * 0.06, 0.8, 0.9) * glow(abs(uv.y - yn), 0.0016) * 0.45;
    }
  }

  // their sum: the waveform you hear
  let y = 0.5 + (sum / norm) * 0.42;
  let d = abs(uv.y - y);
  col += vec3f(1.0, 0.92, 0.75) * (glow(d, 0.0032) * 1.3 + halo(d, 0.0045) * 0.4);

  return col * vignette(uv);
}
`;

export async function mountHarmonics(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.5);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, H);
  soundHint(container);

  const amps = new Float32Array(H);
  amps[0] = 1;

  const gains: Tone.Gain[] = [];
  const oscs: Tone.Oscillator[] = [];
  for (let n = 1; n <= H; n++) {
    const g = new Tone.Gain(0).connect(masterBus());
    oscs.push(new Tone.Oscillator(F0 * n, "sine").connect(g));
    gains.push(g);
  }
  let playing = false;

  const applyGains = (): void => {
    if (!playing) return;
    let norm = 0.05;
    for (let i = 0; i < H; i++) norm += amps[i];
    for (let i = 0; i < H; i++) gains[i].gain.rampTo((amps[i] / norm) * 0.5, 0.06);
  };
  const setPlaying = (on: boolean): void => {
    playing = on;
    if (on) {
      for (const o of oscs) if (o.state !== "started") o.start();
      applyGains();
    } else {
      for (const g of gains) g.gain.rampTo(0, 0.12);
    }
  };
  const guard = frameGuard(() => {
    setPlaying(false);
    syncPlay();
  });

  let playBtn: HTMLButtonElement;
  const syncPlay = (): void => {
    playBtn.textContent = playing ? "■ stop" : "▶ play C3";
  };
  shell.button("▶ play C3", () => {
    void unlockAudio().then(() => {
      setPlaying(!playing);
      syncPlay();
    });
  });
  playBtn = shell.controls.lastElementChild as HTMLButtonElement;

  const sliders: HTMLInputElement[] = [];
  for (let n = 1; n <= H; n++) {
    const input = shell.slider({
      label: `h${n}${n === 1 ? " (fundamental)" : ""}`,
      min: 0,
      max: 1,
      step: 0.01,
      value: amps[n - 1],
      onInput: (v) => {
        amps[n - 1] = v;
        applyGains();
      },
    });
    input.closest("label")!.classList.add("demo-slider-narrow");
    sliders.push(input);
  }

  const preset = (label: string, fn: (n: number) => number): void => {
    shell.button(label, () => {
      for (let n = 1; n <= H; n++) {
        amps[n - 1] = fn(n);
        sliders[n - 1].value = String(amps[n - 1]);
        sliders[n - 1].dispatchEvent(new Event("input"));
      }
    });
  };
  preset("pure", (n) => (n === 1 ? 1 : 0));
  preset("clarinet-ish (odd 1/n)", (n) => (n % 2 === 1 ? 1 / n : 0));
  preset("sawtooth (1/n)", (n) => 1 / n);
  preset("mellow (1/n²)", (n) => 1 / (n * n));

  shell.setInfo(() => {
    const active = amps.reduce((c, a) => c + (a > 0.01 ? 1 : 0), 0);
    return `${active} partial${active === 1 ? "" : "s"} of C3 · same pitch, ${active === 1 ? "no" : "different"} flavour`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      view.data.set(amps);
      view.draw();
    },
    dispose() {
      setPlaying(false);
    },
  };
}
