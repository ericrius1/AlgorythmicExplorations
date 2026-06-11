// Why twelve? Divide the octave into N equal steps for every N from 5 to 31
// and ask: how close does the nearest step land to a pure fifth (and a pure
// major third)? Each column is one candidate tuning system; shorter error
// bars are better. Click a column to hear its "fifth" against the real
// thing. Twelve is the first N that nails the fifth — 19 and 31 are the
// historical runners-up, and they're visibly good at the third.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice } from "../lib/gpu";
import { ShaderView } from "../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint } from "../lib/audio";

const NMIN = 5;
const NMAX = 31;
const COUNT = NMAX - NMIN + 1;
const FIFTH = 1200 * Math.log2(3 / 2); // 701.955¢
const THIRD = 1200 * Math.log2(5 / 4); // 386.31¢
const ROOT = 196; // G3

const SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let sel = uf(4u);
  let flash = uf(5u);
  var col = vec3f(0.0);

  // audibility line: ~2 cents
  let yline = 0.12 + (2.0 / 30.0) * 0.74;
  col += vec3f(0.2, 0.35, 0.2) * glow(abs(uv.y - yline), 0.0012) * 0.6;

  for (var k = 0u; k < ${COUNT}u; k++) {
    let x = 0.05 + (f32(k) + 0.5) * 0.9 / f32(${COUNT});
    let halfw = 0.012;
    let e5 = D[k];                 // fifth error, cents
    let e3 = D[${COUNT}u + k];     // third error, cents
    let isSel = f32(abs(f32(k) + f32(${NMIN}) - sel) < 0.5);

    // baseline tick
    col += vec3f(0.12, 0.13, 0.2) * glow(length(uv - vec2f(x, 0.105)), 0.004);

    // fifth error bar (cool blue, capped at 30¢ of display)
    let h5 = 0.12 + clamp(e5 / 30.0, 0.0, 1.0) * 0.74;
    if (abs(uv.x - x) < halfw && uv.y > 0.12 && uv.y < h5) {
      let good = smoothstep(8.0, 0.5, e5);
      col += mix(hsv(0.62, 0.7, 0.55), hsv(0.5, 0.9, 1.0), good) * (0.55 + isSel * 0.7 + flash * isSel);
    }
    // third error bar (warm, thinner, drawn beside)
    let h3 = 0.12 + clamp(e3 / 30.0, 0.0, 1.0) * 0.74;
    if (abs(uv.x - x - halfw * 1.4) < halfw * 0.45 && uv.y > 0.12 && uv.y < h3) {
      col += hsv(0.08, 0.85, 0.9) * (0.4 + isSel * 0.5);
    }
    // selection beacon
    col += vec3f(1.0, 0.9, 0.7) * glow(length(uv - vec2f(x, 0.05)), 0.006 + 0.004 * sin(t * 4.0)) * isSel;
  }
  return col * vignette(uv);
}
`;

export async function mountWhyTwelve(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.52);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, COUNT * 2);
  soundHint(container, "click a column");

  const err = (n: number, target: number): number => {
    const step = 1200 / n;
    return Math.abs(Math.round(target / step) * step - target);
  };
  for (let k = 0; k < COUNT; k++) {
    view.data[k] = err(NMIN + k, FIFTH);
    view.data[COUNT + k] = err(NMIN + k, THIRD);
  }

  let sel = 12;
  let flash = 0;

  const gain = new Tone.Gain(0).connect(masterBus());
  const root = new Tone.Oscillator(ROOT, "sine").connect(gain);
  const top = new Tone.Oscillator(ROOT * 1.5, "sine").connect(gain);
  for (const o of [root, top]) o.partials = [1, 0.5, 0.33, 0.25, 0.2];
  let seq = 0;
  const silence = (): void => {
    clearTimeout(seq);
    gain.gain.rampTo(0, 0.1);
  };
  const guard = frameGuard(silence);

  // play: pure fifth for a moment, then this system's nearest step
  const audition = (n: number): void => {
    const step = 1200 / n;
    const approx = Math.round(FIFTH / step) * step;
    if (root.state !== "started") {
      root.start();
      top.start();
    }
    clearTimeout(seq);
    top.frequency.value = ROOT * 1.5;
    gain.gain.rampTo(0.2, 0.08);
    seq = window.setTimeout(() => {
      top.frequency.rampTo(ROOT * Math.pow(2, approx / 1200), 0.03);
      seq = window.setTimeout(() => gain.gain.rampTo(0, 0.3), 1400);
    }, 1400);
  };

  shell.canvas.addEventListener("pointerdown", () => {
    const k = Math.floor(((view.pointer.x - 0.05) / 0.9) * COUNT);
    if (k < 0 || k >= COUNT) return;
    sel = NMIN + k;
    flash = 1;
    void unlockAudio().then(() => audition(sel));
  });

  for (const n of [12, 19, 31]) {
    shell.button(`${n}-TET`, () => {
      sel = n;
      flash = 1;
      void unlockAudio().then(() => audition(n));
    });
  }

  shell.setInfo(() => {
    const e5 = err(sel, FIFTH);
    const e3 = err(sel, THIRD);
    return `${sel} equal steps · fifth off by ${e5.toFixed(2)}¢ · major third off by ${e3.toFixed(2)}¢ · click = pure fifth, then ${sel}-TET's`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      flash *= 0.95;
      view.uniforms[4] = sel;
      view.uniforms[5] = flash;
      view.draw();
    },
    dispose() {
      silence();
    },
  };
}
