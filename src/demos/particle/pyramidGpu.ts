// Demo 6: the final form. The whole Barnes-Hut loop — tree build included —
// lives on the GPU, rebuilt from scratch every substep.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { ParticleRenderer } from "../../lib/particleRenderer";
import { PyramidSolver } from "../../lib/pyramidSolver";
import { seedDisk, DEFAULT_HALO, HALO_DISPERSION } from "../../lib/seed";

export interface PyramidDemoOptions {
  count?: number;
  steps?: number;
  hero?: boolean; // no controls, fixed settings
}

// Simulated time per real second for the heroes: about a third of the
// demo's default pace, slow enough to read as a galaxy turning.
const HERO_PACE = 0.28;

export async function mountPyramidGpu(container: HTMLElement, opts: PyramidDemoOptions = {}): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.56 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new ParticleRenderer(dev, ctx);

  let count = opts.count ?? 100000;
  let steps = opts.steps ?? 1;
  let theta = 0.75;
  let halo = true;
  const make = (): PyramidSolver => {
    const s = new PyramidSolver(
      dev,
      seedDisk(count, {
        profile: "exponential",
        halo: halo ? DEFAULT_HALO : undefined,
        dispersion: halo ? HALO_DISPERSION : undefined,
      }),
    );
    s.halo = halo ? DEFAULT_HALO : null;
    return s;
  };
  let solver = make();
  renderer.bind(solver.bodies);
  // A fresh disk is smooth; the arms take a few rotations to grow. The hero
  // fast-forwards through that while its canvas is still invisible, then
  // fades in, so the first thing you see is a galaxy already turning.
  let warmup = opts.hero ? 360 : 0;
  if (opts.hero) {
    shell.canvas.style.opacity = "0";
    shell.canvas.style.transition = "opacity 1.8s ease";
  }
  let last = performance.now();

  const rebuild = (): void => {
    solver.dispose();
    solver = make();
    renderer.bind(solver.bodies);
  };

  if (!opts.hero) {
    shell.slider({
      label: "bodies",
      min: 10000,
      max: 300000,
      step: 10000,
      value: count,
      log: true,
      format: (v) => Math.round(v).toLocaleString(),
      onInput: (v) => {
        count = Math.round(v);
        rebuild();
      },
    });
    shell.slider({
      label: "steps / frame",
      min: 1,
      max: 16,
      step: 1,
      value: steps,
      onInput: (v) => (steps = Math.round(v)),
    });
    shell.slider({
      label: "θ",
      min: 0.3,
      max: 1.5,
      step: 0.05,
      value: theta,
      onInput: (v) => (theta = v),
    });
    const haloButton = shell.button("dark halo: on", () => {
      halo = !halo;
      haloButton.textContent = halo ? "dark halo: on" : "dark halo: off";
      rebuild();
    });
    shell.button("re-seed", rebuild);
  }
  shell.setInfo(() =>
    opts.hero
      ? `${count.toLocaleString()} bodies, live in your browser`
      : `${count.toLocaleString()} bodies × ${steps} steps/frame · tree rebuilt every step, on the GPU`,
  );

  return {
    frame() {
      shell.tick();
      const now = performance.now();
      const real = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      solver.theta = theta;
      let n = steps;
      if (warmup > 0) {
        n = Math.min(warmup, 40);
        warmup -= n;
        solver.dt = 0.016;
        if (warmup <= 0) shell.canvas.style.opacity = "1";
      } else if (opts.hero) {
        // Slow motion, paced by the clock rather than the frame count: one
        // step per frame sized to elapsed time, so it turns at the same
        // speed on a 60 Hz or 120 Hz display.
        n = 1;
        solver.dt = Math.min(0.016, HERO_PACE * real);
      }
      solver.writeParams();
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      for (let s = 0; s < n; s++) solver.encode(pass);
      pass.end();
      renderer.encode(enc, count, {
        scale: 0.9,
        size: count > 400000 ? 0.0012 : count > 100000 ? 0.002 : 0.003,
        palette: "galaxy",
        colorScale: 1.9,
        // more bodies means more light; keep the exposure roughly steady
        intensity: Math.sqrt(20000 / count),
      });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      solver.dispose();
    },
  };
}
