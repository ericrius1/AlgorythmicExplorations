// Part 2, demos 2 and 3: the octree pyramid, free or domed. The "dome"
// slider is the article's point made physical — drag it from zero and watch
// a free 3D galaxy get caught by a curved 2D world.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { Renderer3D } from "../lib/renderer3d";
import { Pyramid3DSolver } from "../lib/pyramid3dSolver";
import { seedDisk3D, seedDome, type Bodies3D } from "../lib/seed3d";

export interface Pyramid3DOptions {
  count?: number;
  steps?: number;
  dome?: boolean; // start constrained to the dome shell
  domeSlider?: boolean;
  hero?: boolean;
}

export async function mountPyramid3D(container: HTMLElement, opts: Pyramid3DOptions = {}): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.56 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new Renderer3D(dev, ctx);
  renderer.camera.attach(shell.canvas);
  if (opts.dome) {
    renderer.camera.elevation = 0.55;
    renderer.camera.distance = 2.4;
  }

  let count = opts.count ?? 20000;
  let steps = opts.steps ?? 2;
  let shellK = opts.dome ? 6 : 0;
  // The hero runs forever in the page header: no damping (cooling collapses
  // everything into one clump) and gentler gravity so it keeps flowing.
  let damping = opts.dome && !opts.hero ? 0.999 : 1.0;

  const seed = (): Bodies3D => (opts.dome ? seedDome(count) : seedDisk3D(count));
  let solver = new Pyramid3DSolver(dev, seed());
  if (opts.hero) solver.gScale = 0.5;
  renderer.bind(solver.pos, solver.vel);

  const rebuild = (): void => {
    solver.dispose();
    solver = new Pyramid3DSolver(dev, seed());
    renderer.bind(solver.pos, solver.vel);
  };

  if (!opts.hero) {
    shell.slider({
      label: "bodies",
      min: 10000,
      max: 200000,
      step: 10000,
      value: count,
      log: true,
      format: (v) => Math.round(v).toLocaleString(),
      onInput: (v) => {
        count = Math.round(v);
        rebuild();
      },
    });
    if (opts.domeSlider) {
      shell.slider({
        label: "dome strength",
        min: 0,
        max: 20,
        step: 0.5,
        value: shellK,
        onInput: (v) => {
          shellK = v;
          damping = v > 0 ? 0.999 : 1.0;
        },
      });
    } else {
      shell.slider({
        label: "θ",
        min: 0.4,
        max: 1.4,
        step: 0.05,
        value: 0.8,
        onInput: (v) => (solver.theta = v),
      });
    }
    shell.slider({
      label: "steps / frame",
      min: 1,
      max: 8,
      step: 1,
      value: steps,
      onInput: (v) => (steps = Math.round(v)),
    });
    shell.button("re-seed", rebuild);
  }
  shell.setInfo(() =>
    opts.hero
      ? `${count.toLocaleString()} bodies on a dome · drag to orbit, ctrl+scroll to zoom`
      : opts.domeSlider
        ? `${count.toLocaleString()} bodies · octree ${solver.gridDim}³ · drag the dome slider`
        : `${count.toLocaleString()} bodies · octree pyramid, ${solver.gridDim}³ finest grid · drag to orbit`,
  );

  return {
    frame() {
      shell.tick();
      solver.shellK = shellK;
      solver.damping = damping;
      solver.writeParams();
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      for (let s = 0; s < steps; s++) solver.encode(pass);
      pass.end();
      renderer.encode(enc, count, { size: count > 150000 ? 0.0035 : 0.005 });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      solver.dispose();
    },
  };
}
