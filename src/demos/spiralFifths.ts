// The spiral of fifths. Each step multiplies by 3:2 and octave-reduces:
// angle = pitch class, radius = how many fifths deep you are. Twelve steps
// almost close the loop — the miss is the Pythagorean comma, drawn as an
// angry little arc. The temper slider shaves each fifth toward 700¢ and the
// spiral relaxes into a circle: equal temperament, performed live.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice } from "../lib/gpu";
import { ShaderView } from "../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, NOTE_NAMES } from "../lib/audio";

const PURE = 1200 * Math.log2(3 / 2); // 701.955¢
const MAXN = 13;
const C3 = 130.81;

const SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let count = u32(uf(4u));
  let flash = uf(5u);
  let gap = uf(6u);      // comma gap in radians, 0 when tempered shut
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.3;
  let r = length(q);
  let ang = atan2(q.y, q.x);

  // reference clock: 12 equal pitch-class spokes
  for (var k = 0u; k < 12u; k++) {
    let a = f32(k) * 6.2831853 / 12.0;
    let dir = vec2f(cos(a), sin(a));
    let d = sdSeg(q, dir * 0.22, dir * 1.04);
    col += vec3f(0.05, 0.06, 0.10) * glow(d, 0.0035);
  }
  col += vec3f(0.05, 0.06, 0.11) * glow(abs(r - 1.04), 0.004);

  // the chain of fifths
  for (var k = 0u; k < ${MAXN}u; k++) {
    if (k >= count) { break; }
    let p = vec2f(D[k * 2u], D[k * 2u + 1u]);
    if (k + 1u < count) {
      let p2 = vec2f(D[k * 2u + 2u], D[k * 2u + 3u]);
      col += hsv(0.58 + f32(k) * 0.025, 0.6, 0.9) * glow(sdSeg(q, p, p2), 0.004) * 0.55;
    }
    let isNew = select(0.0, flash, k + 1u == count);
    let d = length(q - p);
    let hue = fract(atan2(p.y, p.x) / 6.2831853);
    col += hsv(hue, 0.55, 1.0) * (glow(d, 0.016 + isNew * 0.012) * (0.9 + isNew * 1.6) + halo(d, 0.01) * 0.3);
  }

  // the comma: a bright arc between where you landed and where you began
  if (count == ${MAXN}u && gap > 0.0005) {
    let a0 = atan2(D[1], D[0]);
    let rr = length(vec2f(D[${(MAXN - 1) * 2}], D[${(MAXN - 1) * 2 + 1}]));
    let rel = (ang - a0 + 6.2831853 * 3.0) % 6.2831853;
    if (rel < gap && abs(r - rr) < 0.05) {
      col += vec3f(1.0, 0.25, 0.15) * (0.8 + 0.5 * sin(t * 6.0)) * glow(abs(r - rr), 0.012);
    }
  }

  return col * vignette(uv);
}
`;

export interface SpiralOpts {
  mode?: "hero" | "lab";
}

export async function mountSpiralFifths(container: HTMLElement, opts: SpiralOpts = {}): Promise<Demo> {
  const hero = opts.mode === "hero";
  const dev = await getDevice();
  const shell = new Shell(container, hero ? 0.42 : 0.66);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, MAXN * 2);
  soundHint(container, hero ? "tap to hear the stack" : "tap for sound");

  let count = 1;
  let temper = 0; // 0 = pure 3:2 fifths, 1 = equal-tempered 700¢
  let flash = 0;
  let heroSound = false;

  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.005, decay: 0.35, sustain: 0.12, release: 0.6 },
    volume: -10,
  }).connect(masterBus());
  const guard = frameGuard(() => synth.releaseAll());

  const fifthCents = (): number => PURE + (700 - PURE) * temper;
  const reducedCents = (k: number): number => ((k * fifthCents()) % 1200 + 1200) % 1200;
  const noteName = (k: number): string => NOTE_NAMES[(k * 7) % 12];

  let lastFrame = 0;
  const playStep = (k: number): void => {
    if (hero && !heroSound) return;
    if (performance.now() - lastFrame > 400) return; // scrolled away — stay quiet
    synth.triggerAttackRelease(C3 * Math.pow(2, reducedCents(k) / 1200), 0.5);
  };

  const stack = (): void => {
    if (count >= MAXN) return;
    count++;
    flash = 1;
    playStep(count - 1);
  };
  const reset = (): void => {
    count = 1;
    flash = 1;
    playStep(0);
  };

  if (hero) {
    shell.canvas.addEventListener("pointerdown", () => {
      void unlockAudio().then(() => (heroSound = !heroSound));
    });
    let phase = 0; // hero loop: stack 12 · show the comma · temper shut · reopen
    window.setInterval(() => {
      phase++;
      const beat = phase % 26;
      if (beat < 12) stack();
      else if (beat === 15) temper = 1;
      else if (beat === 21) {
        temper = 0;
        count = 1;
      }
    }, 1100);
  } else {
    shell.button("stack a fifth", () => {
      void unlockAudio().then(stack);
    });
    shell.button("restart", () => {
      void unlockAudio().then(reset);
    });
    let auto = 0;
    shell.button("stack all twelve", () => {
      void unlockAudio().then(() => {
        count = 1;
        clearInterval(auto);
        auto = window.setInterval(() => {
          stack();
          if (count >= MAXN) clearInterval(auto);
        }, 450);
      });
    });
    shell.slider({
      label: "temper each fifth",
      min: 0,
      max: 1,
      step: 0.01,
      value: 0,
      format: (v) => `${(PURE + (700 - PURE) * v).toFixed(2)}¢`,
      onInput: (v) => (temper = v),
    });
  }

  shell.setInfo(() => {
    const names = Array.from({ length: count }, (_, k) => noteName(k));
    if (count === MAXN) {
      const missBy = Math.abs(reducedCents(12)).toFixed(1);
      return temper > 0.98
        ? "twelve tempered fifths · the circle closes — every key equally in tune, none perfectly"
        : `back to ${noteName(0)}… but ${missBy}¢ sharp — the Pythagorean comma`;
    }
    return `${names.join(" → ")} · ${count - 1} fifth${count === 2 ? "" : "s"} stacked`;
  });

  let shownTemper = 0;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      lastFrame = performance.now();
      flash *= 0.93;
      shownTemper += (temper - shownTemper) * 0.07;

      const fc = PURE + (700 - PURE) * shownTemper;
      for (let k = 0; k < MAXN; k++) {
        const cents = (((k * fc) % 1200) + 1200) % 1200;
        const a = (cents / 1200) * 2 * Math.PI;
        const r = 0.24 + k * 0.062;
        view.data[k * 2] = Math.cos(a) * r;
        view.data[k * 2 + 1] = Math.sin(a) * r;
      }
      view.uniforms[4] = count;
      view.uniforms[5] = flash;
      const gapCents = ((((12 * fc) % 1200) + 1200) % 1200);
      view.uniforms[6] = (Math.min(gapCents, 1200 - gapCents) / 1200) * 2 * Math.PI;
      view.draw();
    },
    dispose() {
      synth.releaseAll();
    },
  };
}
