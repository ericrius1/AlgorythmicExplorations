// The money figure of the series: two *realistic* tones (eight partials
// each) on a log-frequency axis, with the Plomp–Levelt dissonance curve
// underneath. Slide the interval: partials that land together fuse and flare
// white; partials that land a critical-band apart fight and flag red — and
// the roughness valley floor below traces out, by pure physics, the exact
// intervals music theory considers consonant.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, cents, toneRoughness, pairRoughness } from "../../lib/audio";
import { JUST } from "./lissajous";

const F1 = 165; // E3 — low enough that thirds genuinely beat
const P = 8; // partials per tone
const CURVE = 256;
const RMAX = 2.05;
const XSPAN = 4.4; // octaves of log-frequency axis

const SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let marker = uf(4u);
  let rough = uf(5u);
  var col = vec3f(0.0);

  // ---- bottom: the dissonance landscape (y in 0 .. 0.42) ----
  if (uv.y < 0.46) {
    let yy = uv.y / 0.42;
    let f = clamp(uv.x, 0.0, 1.0) * f32(${CURVE - 1});
    let i = u32(floor(f));
    let curve = mix(D[i], D[min(i + 1u, ${CURVE - 1}u)], fract(f));
    // filled mountain
    if (yy < curve) {
      col += mix(vec3f(0.05, 0.04, 0.10), vec3f(0.45, 0.08, 0.12), yy / max(curve, 0.01)) * 0.8;
    }
    col += hsv(0.02, 0.85, 1.0) * glow(abs(yy - curve) * 0.42, 0.004) * 0.9;
    // just-interval guides: the valleys have names
    for (var k = 0u; k < 8u; k++) {
      let gx = D[${CURVE + 2 * P}u + k];
      col += vec3f(0.25, 0.5, 0.9) * glow(abs(uv.x - gx), 0.0012) * smoothstep(0.46, 0.0, uv.y) * 0.5;
    }
    // current position
    col += vec3f(1.0, 0.8, 0.4) * glow(abs(uv.x - marker), 0.002) * smoothstep(0.46, 0.0, uv.y);
  }

  // ---- top: the two harmonic combs (y in 0.5 .. 1.0) ----
  if (uv.y > 0.48) {
    let mid = 0.74;
    col += vec3f(0.06, 0.07, 0.12) * glow(abs(uv.y - mid), 0.0018);
    // tone A teeth point up, tone B teeth point down
    for (var k = 0u; k < ${P}u; k++) {
      let amp = 1.0 / f32(k + 1u);
      let ax = D[${CURVE}u + k];
      let bx = D[${CURVE + P}u + k];
      let alen = 0.05 + amp * 0.16;
      let blen = 0.05 + amp * 0.16;
      if (uv.y > mid && uv.y < mid + alen) {
        col += hsv(0.58, 0.75, 1.0) * glow(abs(uv.x - ax), 0.0018) * (0.4 + amp);
      }
      if (uv.y < mid && uv.y > mid - blen) {
        col += hsv(0.09, 0.8, 1.0) * glow(abs(uv.x - bx), 0.0018) * (0.4 + amp);
      }
    }
    // pairwise verdicts on the centre line: fusion flares, fights pulse
    for (var i = 0u; i < ${P}u; i++) {
      for (var j = 0u; j < ${P}u; j++) {
        let ax = D[${CURVE}u + i];
        let bx = D[${CURVE + P}u + j];
        let sep = abs(ax - bx);
        if (sep < 0.022) {
          let amp = 1.0 / f32(i + 1u) * 1.0 / f32(j + 1u);
          let x = (ax + bx) * 0.5;
          let d = length(vec2f((uv.x - x) * uf(1u), (uv.y - mid)));
          let fuse = smoothstep(0.004, 0.0, sep);   // dead-on: white star
          let fight = smoothstep(0.0, 0.004, sep) * smoothstep(0.022, 0.008, sep); // near miss: red throb
          col += vec3f(1.0, 0.97, 0.9) * glow(d, 0.012) * fuse * amp * 2.2;
          col += vec3f(1.0, 0.15, 0.1) * glow(d, 0.014) * fight * amp * (1.6 + 1.2 * sin(t * 9.0)) * 1.4;
        }
      }
    }
  }

  // roughness meter tint: the whole frame blushes when it hurts
  col += vec3f(0.10, 0.0, 0.02) * rough * (0.5 + 0.5 * sin(t * 7.0));
  return col * vignette(uv);
}
`;

export async function mountComb(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.6);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, CURVE + 2 * P + 8);
  soundHint(container);

  // precompute the dissonance landscape for two 8-partial tones at F1
  let peak = 1e-9;
  const curve = new Float32Array(CURVE);
  for (let i = 0; i < CURVE; i++) {
    const r = 1 + (i / (CURVE - 1)) * (RMAX - 1);
    curve[i] = toneRoughness(F1, F1 * r, P);
    peak = Math.max(peak, curve[i]);
  }
  for (let i = 0; i < CURVE; i++) view.data[i] = (curve[i] / peak) * 0.92 + 0.04;
  for (let k = 0; k < 8; k++) view.data[CURVE + 2 * P + k] = (JUST[k].r - 1) / (RMAX - 1);

  let ratio = 3 / 2;
  let playing = false;
  const gain = new Tone.Gain(0).connect(masterBus());
  const mkTone = (f: number): Tone.Oscillator => {
    const o = new Tone.Oscillator(f, "sine").connect(gain);
    o.partials = Array.from({ length: P }, (_, k) => 1 / (k + 1));
    return o;
  };
  const a = mkTone(F1);
  const b = mkTone(F1 * ratio);

  const setPlaying = (on: boolean): void => {
    playing = on;
    if (on) {
      if (a.state !== "started") {
        a.start();
        b.start();
      }
      gain.gain.rampTo(0.22, 0.15);
    } else {
      gain.gain.rampTo(0, 0.15);
    }
  };
  const guard = frameGuard(() => setPlaying(false));

  shell.button("▶ play", () => {
    void unlockAudio().then(() => setPlaying(!playing));
  });
  const playBtn = shell.controls.lastElementChild as HTMLButtonElement;
  window.setInterval(() => (playBtn.textContent = playing ? "■ stop" : "▶ play"), 300);

  const slider = shell.slider({
    label: "interval (ratio)",
    min: 1,
    max: RMAX,
    step: 0.0005,
    value: ratio,
    format: (v) => v.toFixed(4),
    onInput: (v) => {
      ratio = v;
      b.frequency.rampTo(F1 * ratio, 0.04);
    },
  });
  for (const j of [JUST[0], JUST[2], JUST[3], JUST[4], JUST[5], JUST[7]]) {
    shell.button(j.label, () => {
      slider.value = String(j.r);
      slider.dispatchEvent(new Event("input"));
    });
  }
  // the famous troublemaker
  shell.button("tritone-ish", () => {
    slider.value = String(Math.SQRT2);
    slider.dispatchEvent(new Event("input"));
  });

  shell.setInfo(() => {
    const r = toneRoughness(F1, F1 * ratio, P) / peak;
    const near = JUST.find((j) => Math.abs(cents(ratio / j.r)) < 5);
    return `${near ? `${near.label} ${near.name}` : `ratio ${ratio.toFixed(3)}`} · roughness ${(r * 100).toFixed(0)}%`;
  });

  const xOf = (f: number): number => Math.log2(f / F1) / XSPAN + 0.02;

  return {
    frame() {
      shell.tick();
      guard.pulse();
      for (let k = 0; k < P; k++) {
        view.data[CURVE + k] = xOf(F1 * (k + 1));
        view.data[CURVE + P + k] = xOf(F1 * ratio * (k + 1));
      }
      view.uniforms[4] = (ratio - 1) / (RMAX - 1);
      // live roughness of the *sounding* pair, for the blush
      let rough = 0;
      for (let i = 1; i <= P; i++) {
        for (let j = 1; j <= P; j++) {
          rough += pairRoughness(F1 * i, 1 / i, F1 * ratio * j, 1 / j);
        }
      }
      view.uniforms[5] = playing ? Math.min((rough / peak) * 0.9, 1) : 0;
      view.draw();
    },
    dispose() {
      setPlaying(false);
    },
  };
}
