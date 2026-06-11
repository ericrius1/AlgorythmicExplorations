// An oscilloscope you can play: one oscillator, one trace. Frequency slider
// moves the pitch and visibly squeezes the repeating shape; waveform buttons
// change the shape without changing the pitch — hearing timbre and seeing it
// as geometry, before the harmonics demo explains where shapes come from.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice } from "../lib/gpu";
import { ShaderView } from "../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, audioOn, waveform, freqLabel, frameGuard, soundHint } from "../lib/audio";

const N = 512;
type Shape = "sine" | "triangle" | "square" | "sawtooth";

const SCENE = /* wgsl */ `
fn sample(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${N - 1});
  let i = u32(floor(f));
  return mix(D[i], D[min(i + 1u, ${N - 1}u)], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let cycle = uf(4u);    // fraction of the view that one period occupies
  let on = uf(5u);
  var col = vec3f(0.0);

  // graph paper
  let gx = abs(fract(uv.x * 8.0) - 0.5);
  let gy = abs(fract(uv.y * 5.0) - 0.5);
  col += vec3f(0.05, 0.06, 0.10) * (glow(gx, 0.012) + glow(gy, 0.02)) * 0.5;
  col += vec3f(0.07, 0.08, 0.13) * glow(abs(uv.y - 0.5), 0.0025);

  // one-period brackets: the literal size of the repeating unit
  if (cycle > 0.015) {
    let m = fract(uv.x / cycle);
    let dm = min(m, 1.0 - m) * cycle;
    col += vec3f(0.45, 0.30, 0.10) * glow(dm, 0.0015) * smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.9, uv.y) * 0.6;
  }

  // the trace
  let y = 0.5 + sample(uv.x) * 0.34;
  let d = abs(uv.y - y);
  let c = mix(hsv(0.55, 0.5, 0.9), hsv(0.36, 0.6, 1.0), on);
  col += c * (glow(d, 0.0035) * 1.2 + halo(d, 0.005) * 0.4);

  return col * vignette(uv);
}
`;

export async function mountOscillo(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.5);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, N);
  soundHint(container);

  let freq = 220;
  let shape: Shape = "sine";
  let playing = false;

  const gain = new Tone.Gain(0).connect(masterBus());
  const osc = new Tone.Oscillator(freq, "sine").connect(gain);

  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    if (on && osc.state !== "started") osc.start();
    gain.gain.rampTo(on ? 0.35 : 0, 0.1);
  };
  const guard = frameGuard(() => {
    setPlaying(false);
    syncButtons();
  });

  let playBtn: HTMLButtonElement;
  const shapeBtns: [Shape, HTMLButtonElement][] = [];
  const syncButtons = (): void => {
    playBtn.textContent = playing ? "■ stop" : "▶ play";
    for (const [s, b] of shapeBtns) b.style.borderColor = s === shape ? "var(--accent)" : "var(--border)";
  };

  shell.button("▶ play", () => {
    void unlockAudio().then(() => {
      setPlaying(!playing);
      syncButtons();
    });
  });
  playBtn = shell.controls.lastElementChild as HTMLButtonElement;

  for (const s of ["sine", "triangle", "square", "sawtooth"] as Shape[]) {
    shell.button(s === "sawtooth" ? "saw" : s, () => {
      shape = s;
      osc.type = s;
      syncButtons();
    });
    shapeBtns.push([s, shell.controls.lastElementChild as HTMLButtonElement]);
  }
  shell.slider({
    label: "frequency",
    min: 55,
    max: 880,
    step: 1,
    value: freq,
    log: true,
    format: (v) => `${Math.round(v)} Hz`,
    onInput: (v) => {
      freq = v;
      osc.frequency.rampTo(v, 0.03);
    },
  });
  syncButtons();
  shell.setInfo(() => `${freqLabel(freq)} · period ${(1000 / freq).toFixed(2)} ms · ${Math.round(freq)} repeats per second`);

  // idealized single-cycle shapes, for the silent preview
  const ideal = (s: Shape, ph: number): number => {
    const p = ph - Math.floor(ph);
    switch (s) {
      case "sine":
        return Math.sin(2 * Math.PI * p);
      case "square":
        return p < 0.5 ? 1 : -1;
      case "sawtooth":
        return 2 * p - 1;
      case "triangle":
        return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    }
  };

  return {
    frame() {
      shell.tick();
      guard.pulse();

      const sr = Tone.getContext().sampleRate;
      const windowSec = N / sr; // the slice of time shown on screen
      view.uniforms[4] = 1 / freq / windowSec; // one period, as a fraction of the view
      view.uniforms[5] = playing ? 1 : 0;

      if (playing && audioOn()) {
        const w = waveform();
        let start = 0;
        for (let i = 1; i < w.length - N; i++) {
          if (w[i - 1] <= 0 && w[i] > 0) {
            start = i;
            break;
          }
        }
        for (let i = 0; i < N; i++) view.data[i] = w[Math.min(start + i, w.length - 1)] * 2.0;
      } else {
        const cycles = freq * windowSec;
        for (let i = 0; i < N; i++) view.data[i] = ideal(shape, (i / N) * cycles) * 0.7;
      }
      view.draw();
    },
    dispose() {
      setPlaying(false);
    },
  };
}
