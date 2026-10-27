// Strange Matter part two: part one's renderer (splat field → marching
// squares → shaded fluid) driven by a sim where the fluid magnetizes itself.
// Under a uniform field, the pool grows a crown of spikes. New teaching
// view: the particles' magnetic moments as arrows.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { Ferro2Sim, FERRO2_KNOBS, type Ferro2Knobs } from "../../lib/ferroSim2";
import { SPACING, poolDepth, type Tray } from "../../lib/ferroSim";
import { Ferro2DRenderer, VIEW_FINAL, VIEW_MOMENTS } from "./ferro2dRenderer";

const VIEW_NAMES = ["final", "mesh", "field", "particles", "moments"];
const POLE_TO_DIPOLE = 0.05; // the cursor magnet's dipole sits inside its bar

export interface CrownOptions {
  hero?: boolean;
  wide?: boolean; // hero framing: the whole dish instead of a close-up
  full?: boolean; // sliders + view cycling
  view?: number; // starting view
  duel?: boolean; // force-model toggle only
}

export async function mountCrown(container: HTMLElement, opts: CrownOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const tray: Tray = opts.hero ? { floorY: -0.5, wallX: 0.97, topY: 0.95 } : { floorY: -0.5, wallX: 0.8, topY: 0.95 };
  const knobs: Ferro2Knobs = { ...FERRO2_KNOBS };
  const count = opts.hero ? 24000 : 20000;
  const surfaceY = tray.floorY + poolDepth(count, tray);
  let view = opts.view ?? VIEW_FINAL;
  let time = 0;

  const sim = new Ferro2Sim(dev, count, tray);
  const close = opts.hero && !opts.wide;
  const rnd = new Ferro2DRenderer(dev, ctx, shell.canvas, {
    tray,
    spacing: SPACING,
    center: [0, surfaceY + (close ? 0.035 : opts.hero ? 0.13 : 0.2)],
    halfWidth: close ? 0.42 : opts.hero ? 0.99 : 0.86,
    minHalfHeight: close ? 0.16 : 0.36,
    rimY: surfaceY + 0.1,
  });
  rnd.bindParticles(sim.buffers);

  // ---- the cursor magnet -------------------------------------------------------------
  // A small one: it adds to the uniform field near the cursor, so the spikes
  // under it stand taller, without tearing the crown apart.
  const minPole = surfaceY + 0.08;
  const clampMag = (p: [number, number]): [number, number] => [
    Math.max(-tray.wallX + 0.03, Math.min(tray.wallX - 0.03, p[0])),
    Math.max(minPole, Math.min(rnd.visibleTop - 0.14, p[1])),
  ];
  let pointer: [number, number] | null = null;
  shell.canvas.addEventListener("pointermove", (e) => (pointer = clampMag(rnd.toWorld(e.clientX, e.clientY))));
  shell.canvas.addEventListener("pointerleave", () => (pointer = null));
  const magMoment = view === VIEW_MOMENTS ? 8 : 4;

  // ---- controls ------------------------------------------------------------------------
  const modelName = (): string => (knobs.kelvin ? "Kelvin" : "current loop");
  if (opts.full) {
    shell.slider({
      label: "susceptibility χ",
      min: 0, max: 5, step: 0.1, value: knobs.chi,
      onInput: (v) => (knobs.chi = v),
    });
    shell.slider({
      label: "field strength",
      min: 0, max: 8, step: 0.1, value: knobs.hExt,
      onInput: (v) => (knobs.hExt = v),
    });
    shell.slider({
      label: "surface tension",
      min: 0, max: 10, step: 0.1, value: knobs.tension,
      onInput: (v) => (knobs.tension = v),
    });
  }
  if (opts.full || opts.duel) {
    const modelBtn = shell.button(`force model: ${modelName()}`, () => {
      knobs.kelvin = !knobs.kelvin;
      modelBtn.textContent = `force model: ${modelName()}`;
    });
  }
  if (opts.full) {
    const viewBtn = shell.button(`view: ${VIEW_NAMES[view]}`, () => {
      view = (view + 1) % VIEW_NAMES.length;
      viewBtn.textContent = `view: ${VIEW_NAMES[view]}`;
    });
    shell.button("re-pour", () => {
      sim.rebuild(count);
      rnd.bindParticles(sim.buffers);
      time = 0;
    });
  }
  shell.setInfo(() => {
    if (opts.hero) return `${count.toLocaleString()} particles, each one a magnet · uniform field · cursor adds a magnet`;
    if (opts.duel) return `${modelName()} model · ${count.toLocaleString()} particles`;
    if (view === VIEW_MOMENTS) return `${count.toLocaleString()} moments, one relaxation sweep per frame · every 6th drawn`;
    return `${modelName()} · ${rnd.segsDrawn.toLocaleString()} segments · ${count.toLocaleString()} particles`;
  });

  // The field comes up over the first second and a half; before that the
  // pool settles with it off, so the crown grows out of a flat surface.
  const RAMP = 1.5;
  const frameKnobs = (): Ferro2Knobs => ({
    ...knobs,
    hExt: knobs.hExt * Math.min(1, time / RAMP),
    magMoment: pointer ? magMoment : 0,
  });
  const magPos = (): [number, number] => (pointer ? [pointer[0], pointer[1] + POLE_TO_DIPOLE] : [0, 5]);
  {
    sim.writeParams({ ...knobs, hExt: 0, magMoment: 0 }, 0.0016, [0, 5], false);
    for (let chunk = 0; chunk < 3; chunk++) {
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 200, false);
      dev.queue.submit([enc.finish()]);
    }
    // heroes start with the crown already sprouting
    if (opts.hero) {
      for (let chunk = 0; chunk < 16; chunk++) {
        const enc = dev.createCommandEncoder();
        for (let f = 0; f < 15; f++) {
          time += 1 / 60;
          sim.writeParams(frameKnobs(), 0.0016, magPos(), false);
          sim.encodeSteps(enc, 5);
        }
        dev.queue.submit([enc.finish()]);
      }
    }
  }

  return {
    frame() {
      shell.tick();
      time += 1 / 60;
      sim.writeParams(frameKnobs(), 0.0016, magPos(), pointer !== null);

      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 5);
      rnd.encode(enc, {
        buffer: sim.currentIndex,
        count: sim.count,
        view,
        mag: pointer ?? [0, 5],
        magOn: pointer !== null,
        time,
        momentScale: 0.06,
      });
      dev.queue.submit([enc.finish()]);
      rnd.afterSubmit();
    },
    dispose() {
      sim.dispose();
      rnd.dispose();
    },
  };
}
