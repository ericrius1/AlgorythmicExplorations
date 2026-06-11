// Demo 5: the mass pyramid. The same disk, binned into a uniform grid and
// then halved, level by level — a mipmap of gravity. Slide through the
// levels the GPU builds every frame.

import { Shell, type Demo } from "../lib/demoShell";
import { seedDisk, type Bodies } from "../lib/seed";
import { stepBarnesHut, drawBodies } from "../lib/cpuSim";

const N = 4000;
const FINEST = 7; // 128 x 128 for the visualization
const VIEW = 0.8;

export function mountPyramidLevels(container: HTMLElement): Demo {
  const shell = new Shell(container);
  const ctx = shell.canvas.getContext("2d")!;
  let bodies: Bodies = seedDisk(N);
  let level = 4;

  shell.slider({
    label: "pyramid level",
    min: 0,
    max: FINEST,
    step: 1,
    value: level,
    format: (v) => `${v} (${1 << v}×${1 << v} cells)`,
    onInput: (v) => (level = Math.round(v)),
  });
  shell.button("re-seed", () => (bodies = seedDisk(N)));
  shell.setInfo(() => {
    const dim = 1 << level;
    return `level ${level}: ${(dim * dim).toLocaleString()} cells · each cell = mass + centre of mass`;
  });

  return {
    frame() {
      shell.tick();
      stepBarnesHut(bodies, { dt: 0.016, softening: 0.05 }, 0.8);
      drawBodies(ctx, bodies, { scale: VIEW }, "rgba(120, 150, 235, 0.35)");

      // Bin to the finest level, then reduce down to the displayed level.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < bodies.count; i++) {
        const x = bodies.state[i * 4];
        const y = bodies.state[i * 4 + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const half = Math.max(maxX - minX, maxY - minY, 1e-6) * 0.5 * 1.0001;
      const orX = (minX + maxX) * 0.5 - half;
      const orY = (minY + maxY) * 0.5 - half;
      const size = half * 2;

      let dim = 1 << FINEST;
      let cells = new Float32Array(dim * dim * 3);
      for (let i = 0; i < bodies.count; i++) {
        const gx = Math.min(dim - 1, Math.max(0, Math.floor(((bodies.state[i * 4] - orX) / size) * dim)));
        const gy = Math.min(dim - 1, Math.max(0, Math.floor(((bodies.state[i * 4 + 1] - orY) / size) * dim)));
        const m = bodies.mass[i];
        const c = (gy * dim + gx) * 3;
        cells[c] += m;
        cells[c + 1] += m * bodies.state[i * 4];
        cells[c + 2] += m * bodies.state[i * 4 + 1];
      }
      for (let l = FINEST - 1; l >= level; l--) {
        const d = 1 << l;
        const coarse = new Float32Array(d * d * 3);
        for (let iy = 0; iy < d; iy++) {
          for (let ix = 0; ix < d; ix++) {
            const o = (iy * d + ix) * 3;
            for (let q = 0; q < 4; q++) {
              const f = ((iy * 2 + (q >> 1)) * d * 2 + ix * 2 + (q & 1)) * 3;
              coarse[o] += cells[f];
              coarse[o + 1] += cells[f + 1];
              coarse[o + 2] += cells[f + 2];
            }
          }
        }
        cells = coarse;
        dim = d;
      }

      // Draw occupied cells as a heat map + centre-of-mass dots.
      const { width, height } = ctx.canvas;
      const s = (Math.min(width, height) / 2) * VIEW;
      const ox = width / 2;
      const oy = height / 2;
      const cellW = (size / dim) * s;
      let maxMass = 0;
      for (let c = 0; c < cells.length; c += 3) if (cells[c] > maxMass) maxMass = cells[c];
      for (let iy = 0; iy < dim; iy++) {
        for (let ix = 0; ix < dim; ix++) {
          const m = cells[(iy * dim + ix) * 3];
          if (m <= 0) continue;
          const t = Math.pow(m / maxMass, 0.4);
          const px = ox + (orX + (ix / dim) * size) * s;
          const py = oy - (orY + ((iy + 1) / dim) * size) * s;
          ctx.fillStyle = `rgba(${90 + t * 165}, ${200 - t * 60}, ${120 - t * 60}, ${0.10 + t * 0.35})`;
          ctx.fillRect(px, py, cellW, cellW);
          ctx.strokeStyle = "rgba(80, 220, 130, 0.25)";
          ctx.strokeRect(px, py, cellW, cellW);
        }
      }
      ctx.fillStyle = "rgba(255, 90, 220, 0.9)";
      for (let iy = 0; iy < dim; iy++) {
        for (let ix = 0; ix < dim; ix++) {
          const c = (iy * dim + ix) * 3;
          if (cells[c] <= 0) continue;
          const comX = cells[c + 1] / cells[c];
          const comY = cells[c + 2] / cells[c];
          ctx.fillRect(ox + comX * s - 1.5, oy - comY * s - 1.5, 3, 3);
        }
      }
    },
  };
}
