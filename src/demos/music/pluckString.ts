// The plucked string: a 1D wave equation you can grab. The sim runs in slow
// motion so you can watch the wave bounce; the sound is synthesized from the
// string's *modal recipe* — project the release shape onto the first ten
// standing waves and hand each one a sine oscillator with its own decay.
// Pluck near the end and the recipe goes bright; pluck the middle and the
// even harmonics vanish. Same string, same physics, two timbres.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, freqLabel } from "../../lib/audio";

const N = 160; // string points
const MODES = 10;
const SLOWMO = 80; // visual sim runs this many times slower than the audio

const SCENE = /* wgsl */ `
fn sample(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(${N - 1});
  let i = u32(floor(f));
  return mix(D[i], D[min(i + 1u, ${N - 1}u)], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let grab = uf(4u);
  var col = vec3f(0.0);

  // anchor posts
  col += vec3f(0.18, 0.14, 0.10) * (glow(abs(uv.x - 0.04), 0.004) + glow(abs(uv.x - 0.96), 0.004))
       * smoothstep(0.18, 0.3, uv.y) * smoothstep(0.82, 0.7, uv.y);

  // first three mode shapes, ghosted, scaled by their live amplitudes
  let xs = clamp((uv.x - 0.04) / 0.92, 0.0, 1.0);
  for (var n = 1; n <= 3; n++) {
    let amp = D[${N}u + u32(n - 1)];
    let ym = 0.56 + sin(f32(n) * 3.14159265 * xs) * amp * 0.22 * sin(t * (1.0 + f32(n) * 0.3));
    col += hsv(0.6 + f32(n) * 0.07, 0.7, 0.8) * glow(abs(uv.y - ym), 0.002) * 0.25 * step(0.001, amp);
  }

  // the string itself
  if (uv.x > 0.03 && uv.x < 0.97) {
    let y = 0.56 + sample(xs) * 0.22;
    let d = abs(uv.y - y);
    let c = mix(hsv(0.09, 0.55, 1.0), hsv(0.13, 0.85, 1.0), grab);
    col += c * (glow(d, 0.0035) * 1.25 + halo(d, 0.005) * 0.4);
  }

  // modal recipe bars along the bottom
  for (var n = 0u; n < ${MODES}u; n++) {
    let amp = D[${N}u + n];
    let cx = 0.08 + (f32(n) + 0.5) * 0.05;
    let h = 0.02 + amp * 0.13;
    if (abs(uv.x - cx) < 0.016 && uv.y > 0.045 && uv.y < 0.045 + h) {
      col += hsv(0.6 + f32(n) * 0.055, 0.75, 0.9) * 0.8;
    }
    // harmonic number tick
    col += vec3f(0.1) * glow(length(uv - vec2f(cx, 0.035)), 0.0025);
  }

  return col * vignette(uv);
}
`;

export async function mountPluckString(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.52);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, N + MODES);
  soundHint(container, "drag the string, let go");

  let f0 = 110;

  // ---- audio: ten sines, one per mode, with per-mode decay ----------------
  const oscs: Tone.Oscillator[] = [];
  const gains: Tone.Gain[] = [];
  const releaseAt = { t: -1 };
  const recipe = new Float32Array(MODES); // amplitudes at release, for the bars
  for (let n = 1; n <= MODES; n++) {
    const g = new Tone.Gain(0).connect(masterBus());
    const o = new Tone.Oscillator(f0 * n, "sine").connect(g);
    oscs.push(o);
    gains.push(g);
  }
  const decay = (n: number): number => 3.2 / (1 + 0.45 * (n - 1)); // high modes die first

  const silence = (): void => {
    for (const g of gains) g.gain.cancelScheduledValues(Tone.now());
    for (const g of gains) g.gain.rampTo(0, 0.1);
  };
  const guard = frameGuard(silence);

  // ---- the string ----------------------------------------------------------
  const y = new Float32Array(N);
  const v = new Float32Array(N);
  let grabbed = -1;

  const pluckAudio = (): void => {
    // project the string shape onto sin(nπx): the recipe the ear will get
    let peak = 1e-6;
    for (let n = 1; n <= MODES; n++) {
      let b = 0;
      for (let i = 0; i < N; i++) b += y[i] * Math.sin((n * Math.PI * i) / (N - 1));
      b = Math.abs((2 * b) / N);
      recipe[n - 1] = b;
      peak = Math.max(peak, b);
    }
    const now = Tone.now();
    releaseAt.t = performance.now();
    for (let n = 1; n <= MODES; n++) {
      const g = gains[n - 1].gain;
      const a = (recipe[n - 1] / peak) * 0.34 / Math.sqrt(n);
      if (oscs[n - 1].state !== "started") oscs[n - 1].start();
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(a, 1e-4), now);
      g.exponentialRampToValueAtTime(1e-4, now + decay(n));
      g.linearRampToValueAtTime(0, now + decay(n) + 0.05);
    }
    for (let n = 0; n < MODES; n++) recipe[n] /= peak;
  };

  const xToIndex = (ux: number): number => Math.round(((ux - 0.04) / 0.92) * (N - 1));

  shell.canvas.addEventListener("pointerdown", (e) => {
    void unlockAudio();
    e.preventDefault();
    grabbed = Math.max(2, Math.min(N - 3, xToIndex(view.pointer.x)));
  });
  const release = (): void => {
    if (grabbed < 0) return;
    grabbed = -1;
    pluckAudio();
  };
  shell.canvas.addEventListener("pointerup", release);
  shell.canvas.addEventListener("pointerleave", release);

  shell.slider({
    label: "pitch",
    min: 65,
    max: 330,
    step: 1,
    value: f0,
    log: true,
    format: (v) => `${Math.round(v)} Hz`,
    onInput: (val) => {
      f0 = val;
      oscs.forEach((o, i) => o.frequency.rampTo(f0 * (i + 1), 0.05));
    },
  });
  shell.button("pluck the middle", () => {
    void unlockAudio();
    for (let i = 0; i < N; i++) y[i] = 0.9 * Math.min(i / (N / 2), (N - 1 - i) / (N / 2));
    v.fill(0);
    pluckAudio();
  });
  shell.button("pluck near the bridge", () => {
    void unlockAudio();
    const p = Math.floor(N * 0.92);
    for (let i = 0; i < N; i++) y[i] = 0.9 * (i <= p ? i / p : (N - 1 - i) / (N - 1 - p));
    v.fill(0);
    pluckAudio();
  });
  shell.setInfo(
    () => `${freqLabel(f0)} string · shown ${SLOWMO}× slower than it sounds · drag it`,
  );

  return {
    frame() {
      shell.tick();
      guard.pulse();

      // wave equation, slow-motion: fundamental ≈ (110/SLOWMO) Hz on screen
      const c = (2 * f0) / SLOWMO; // wave speed for a unit-length string
      const dx = 1 / (N - 1);
      const dt = (0.8 * dx) / c;
      const steps = Math.max(1, Math.min(40, Math.round(1 / 60 / dt)));
      for (let s = 0; s < steps; s++) {
        if (grabbed >= 0) {
          y[grabbed] = Math.max(-1, Math.min(1, (view.pointer.y - 0.56) / 0.22));
          v[grabbed] = 0;
        }
        const k = ((c * dt) / dx) ** 2;
        for (let i = 1; i < N - 1; i++) {
          v[i] += k * (y[i - 1] - 2 * y[i] + y[i + 1]);
          v[i] *= 0.99995;
        }
        if (grabbed >= 0) v[grabbed] = 0;
        for (let i = 1; i < N - 1; i++) y[i] += v[i];
      }

      view.data.set(y.subarray(0, N), 0);
      // bars decay in step with the audio envelopes
      const dtRel = releaseAt.t < 0 ? -1 : (performance.now() - releaseAt.t) / 1000;
      for (let n = 1; n <= MODES; n++) {
        view.data[N + n - 1] = dtRel < 0 ? 0 : recipe[n - 1] * Math.exp((-3 * dtRel) / decay(n));
      }
      view.uniforms[4] = grabbed >= 0 ? 1 : 0;
      view.draw();
    },
    dispose() {
      silence();
    },
  };
}
