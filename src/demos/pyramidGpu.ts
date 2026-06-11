// Demo 6: the final form. The whole Barnes-Hut loop — tree build included —
// lives on the GPU, rebuilt from scratch every substep.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { ParticleRenderer } from "../lib/particleRenderer";
import { PyramidSolver } from "../lib/pyramidSolver";
import { seedDisk } from "../lib/seed";

export interface PyramidDemoOptions {
  count?: number;
  steps?: number;
  hero?: boolean; // no controls, fixed settings
}

export async function mountPyramidGpu(container: HTMLElement, opts: PyramidDemoOptions = {}): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.56 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new ParticleRenderer(dev, ctx);

  let count = opts.count ?? 20000;
  let steps = opts.steps ?? 2;
  let theta = 0.75;
  let solver = new PyramidSolver(dev, seedDisk(count));
  renderer.bind(solver.bodies);

  const rebuild = (): void => {
    solver.dispose();
    solver = new PyramidSolver(dev, seedDisk(count));
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
      solver.theta = theta;
      solver.writeParams();
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      for (let s = 0; s < steps; s++) solver.encode(pass);
      pass.end();
      renderer.encode(enc, count, { scale: 0.9, size: count > 400000 ? 0.0012 : count > 100000 ? 0.002 : 0.003 });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      solver.dispose();
    },
  };
}
