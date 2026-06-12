// The interval as geometry: tone A drives x, tone B drives y, the dot's path
// is the Lissajous figure of their frequency ratio. Whole-number ratios close
// into knots after a few cycles — the picture of a short combined period.
// Nudge the ratio off a knot and the figure starts precessing and filling the
// square: the geometric face of "never quite repeats".

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, cents } from "../../lib/audio";

const N = 480; // polyline points
const F1 = 220;
const CYCLES = 8;

export const JUST: { r: number; label: string; name: string }[] = [
  { r: 1, label: "1:1", name: "unison" },
  { r: 9 / 8, label: "9:8", name: "major second" },
  { r: 6 / 5, label: "6:5", name: "minor third" },
  { r: 5 / 4, label: "5:4", name: "major third" },
  { r: 4 / 3, label: "4:3", name: "perfect fourth" },
  { r: 3 / 2, label: "3:2", name: "perfect fifth" },
  { r: 5 / 3, label: "5:3", name: "major sixth" },
  { r: 2, label: "2:1", name: "octave" },
];

const SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.5;

  // frame: the unit square the figure lives in
  let fr = max(abs(q.x), abs(q.y));
  col += vec3f(0.05, 0.06, 0.11) * glow(abs(fr - 1.04), 0.006);

  var d = 1e9;
  var hueAt = 0.0;
  for (var i = 0u; i < ${N - 1}u; i++) {
    let a = vec2f(D[i * 2u], D[i * 2u + 1u]);
    let b = vec2f(D[i * 2u + 2u], D[i * 2u + 3u]);
    let di = sdSeg(q, a, b);
    if (di < d) {
      d = di;
      hueAt = f32(i) / f32(${N});
    }
  }
  let hue = 0.52 + hueAt * 0.35;
  col += hsv(hue, 0.65, 1.0) * (glow(d, 0.006) * 1.15 + halo(d, 0.008) * 0.45);

  // the moving dot — "now"
  let headI = u32(fract(t * 0.21) * f32(${N - 1})) * 2u;
  let head = vec2f(D[headI], D[headI + 1u]);
  col += vec3f(1.0, 0.95, 0.85) * glow(length(q - head), 0.018) * 1.4;

  return col * vignette(uv);
}
`;

export interface LissajousOpts {
  mode?: "hero" | "lab";
}

export async function mountLissajous(container: HTMLElement, opts: LissajousOpts = {}): Promise<Demo> {
  const hero = opts.mode === "hero";
  const dev = await getDevice();
  const shell = new Shell(container, hero ? 0.42 : 0.62);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, N * 2);
  soundHint(container, hero ? "tap to hear the interval" : "tap for sound");

  let ratio = 3 / 2;
  let shownRatio = ratio;
  let playing = false;

  const gain = new Tone.Gain(0).connect(masterBus());
  const a = new Tone.Oscillator(F1, "sine").connect(gain);
  const b = new Tone.Oscillator(F1 * ratio, "sine").connect(gain);

  const setPlaying = (on: boolean): void => {
    playing = on;
    if (on) {
      if (a.state !== "started") {
        a.start();
        b.start();
      }
      gain.gain.rampTo(0.28, 0.2);
    } else {
      gain.gain.rampTo(0, 0.2);
    }
  };
  const guard = frameGuard(() => setPlaying(false));

  const setRatio = (r: number): void => {
    ratio = r;
    b.frequency.rampTo(F1 * r, 0.05);
  };

  if (hero) {
    shell.canvas.addEventListener("pointerdown", () => {
      void unlockAudio().then(() => setPlaying(!playing));
    });
    // drift through the consonances forever
    let idx = 5;
    window.setInterval(() => {
      idx = (idx + 1) % JUST.length;
      setRatio(JUST[idx].r);
    }, 7000);
  } else {
    shell.button("▶ play interval", () => {
      void unlockAudio().then(() => setPlaying(!playing));
    });
    const playBtn = shell.controls.lastElementChild as HTMLButtonElement;
    window.setInterval(() => (playBtn.textContent = playing ? "■ stop" : "▶ play interval"), 300);

    let sliderEl: HTMLInputElement;
    sliderEl = shell.slider({
      label: "frequency ratio",
      min: 1,
      max: 2.05,
      step: 0.0005,
      value: ratio,
      format: (v) => v.toFixed(4),
      onInput: (v) => setRatio(v),
    });
    for (const j of JUST) {
      shell.button(j.label, () => {
        setRatio(j.r);
        sliderEl.value = String(j.r);
        sliderEl.dispatchEvent(new Event("input"));
      });
    }
  }

  shell.setInfo(() => {
    const near = JUST.find((j) => Math.abs(cents(ratio / j.r)) < 4);
    const what = near ? `${near.label} — ${near.name}, the figure closes` : `${ratio.toFixed(4)} — irrational territory, the figure precesses`;
    return `${F1} Hz × ${(F1 * ratio).toFixed(1)} Hz · ${what}`;
  });

  let phi = 0;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      phi += 0.0035; // slow phase drift = the figure slowly "rotates"
      shownRatio += (ratio - shownRatio) * 0.08;
      for (let i = 0; i < N; i++) {
        const s = (i / (N - 1)) * CYCLES;
        view.data[i * 2] = Math.sin(2 * Math.PI * s + phi) * 0.96;
        view.data[i * 2 + 1] = Math.sin(2 * Math.PI * shownRatio * s) * 0.96;
      }
      view.draw();
    },
    dispose() {
      setPlaying(false);
    },
  };
}
