// Strange Matter part one: SPH with surface tension and a dipole magnet,
// splatted to a field and surfaced by marching squares on the GPU every
// frame. The cursor is the magnet. With nobody at the controls, the magnet
// drifts slowly back and forth over the pool on its own.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { FerroSim, FERRO_KNOBS, SPACING, poolDepth, type FerroKnobs, type Tray } from "../../lib/ferroSim";
import { Ferro2DRenderer, VIEW_FINAL, VIEW_MESH } from "./ferro2dRenderer";
import { devKnobs } from "./devKnobs";

const VIEW_NAMES = ["final", "mesh", "field", "particles"];

export interface FerroOptions {
  full?: boolean; // sliders + view cycling
  view?: number; // starting view
}

export async function mountFerro(container: HTMLElement, opts: FerroOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const tray: Tray = { floorY: -0.5, wallX: 0.8, topY: 0.95 };
  const count = 20000;
  const surfaceY = tray.floorY + poolDepth(count, tray);
  const knobs: FerroKnobs = devKnobs({ ...FERRO_KNOBS });
  let view = opts.view ?? VIEW_FINAL;
  let time = 0;

  const sim = new FerroSim(dev, count, tray);
  const rnd = new Ferro2DRenderer(dev, ctx, shell.canvas, {
    tray,
    spacing: SPACING,
    // the mesh view zooms in so its cells and segments are big enough to see
    center: [0, surfaceY + (view === VIEW_MESH ? 0.09 : 0.2)],
    halfWidth: view === VIEW_MESH ? 0.42 : 0.86,
    minHalfHeight: 0.2,
    rimY: surfaceY + 0.1,
  });
  rnd.bindParticles(sim.buffers);

  // ---- the magnet ------------------------------------------------------------------
  // Its pole stays a little above the resting surface and inside the frame.
  const minPole = surfaceY + 0.05;
  const clampMag = (p: [number, number]): [number, number] => [
    Math.max(-tray.wallX + 0.03, Math.min(tray.wallX - 0.03, p[0])),
    Math.max(minPole, Math.min(rnd.visibleTop - 0.12, p[1])),
  ];
  let pointer: [number, number] | null = null;
  shell.canvas.addEventListener("pointermove", (e) => (pointer = clampMag(rnd.toWorld(e.clientX, e.clientY))));
  shell.canvas.addEventListener("pointerleave", () => (pointer = null));

  // idle: a slow drift across the pool at a height where the bump is tall
  const drift = view === VIEW_MESH ? 0.2 : 0.45;
  const idleMagnet = (): [number, number] => [drift * Math.sin(time * 0.21), surfaceY + 0.19];

  // ---- controls ----------------------------------------------------------------------
  if (opts.full) {
    shell.slider({
      label: "surface tension",
      min: 0, max: 8, step: 0.1, value: knobs.tension,
      onInput: (v) => (knobs.tension = v),
    });
    shell.slider({
      label: "magnet strength",
      min: 0, max: 80, step: 1, value: knobs.magStrength,
      onInput: (v) => (knobs.magStrength = v),
    });
    const viewBtn = shell.button(`view: ${VIEW_NAMES[view]}`, () => {
      view = (view + 1) % VIEW_NAMES.length;
      viewBtn.textContent = `view: ${VIEW_NAMES[view]}`;
    });
    shell.button("re-pour", () => {
      sim.rebuild(count);
      rnd.bindParticles(sim.buffers);
    });
  }
  shell.setInfo(() => {
    const segs = `${rnd.segsDrawn.toLocaleString()} segments`;
    if (!opts.full) return `${segs} from marching squares, rebuilt every frame · cursor = magnet`;
    return `${VIEW_NAMES[view]} view · ${segs} · ${count.toLocaleString()} particles · cursor = magnet`;
  });

  // settle the pool before the first frame is shown
  {
    sim.writeParams(knobs, 0.0016, [0, 5], false);
    for (let chunk = 0; chunk < 3; chunk++) {
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 200);
      dev.queue.submit([enc.finish()]);
    }
  }

  return {
    frame() {
      shell.tick();
      time += 1 / 60;
      const mag = pointer ?? idleMagnet();
      sim.writeParams(knobs, 0.0016, mag, true);

      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 5);
      rnd.encode(enc, { buffer: sim.currentIndex, count: sim.count, view, mag, magOn: true, time });
      dev.queue.submit([enc.finish()]);
      rnd.afterSubmit();
    },
    dispose() {
      sim.dispose();
      rnd.dispose();
    },
  };
}
