// Demo 2: direct summation in JavaScript. Drag the slider right and watch
// the quadratic wall arrive.

import { Shell, type Demo } from "../../lib/demoShell";
import { seedDisk, type Bodies } from "../../lib/seed";
import { stepNaive, drawBodies } from "../../lib/cpuSim";

export function mountNaiveCpu(container: HTMLElement): Demo {
  const shell = new Shell(container);
  const ctx = shell.canvas.getContext("2d")!;
  let count = 1500;
  let bodies: Bodies = seedDisk(count);
  let stepMs = 0;
  let pairs = 0;

  shell.slider({
    label: "bodies",
    min: 100,
    max: 8000,
    step: 100,
    value: count,
    log: true,
    format: (v) => String(Math.round(v)),
    onInput: (v) => {
      count = Math.round(v);
      bodies = seedDisk(count);
    },
  });
  shell.button("re-seed", () => {
    bodies = seedDisk(count);
  });
  shell.setInfo(
    () => `${pairs.toLocaleString()} pair forces/step · ${stepMs.toFixed(1)} ms/step on the CPU`,
  );

  return {
    frame() {
      shell.tick();
      const t0 = performance.now();
      pairs = stepNaive(bodies, { dt: 0.016, softening: 0.05 });
      stepMs = performance.now() - t0;
      drawBodies(ctx, bodies, { scale: 0.8 });
    },
  };
}
