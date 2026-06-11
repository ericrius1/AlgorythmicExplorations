// Demo 4: the Barnes-Hut idea, made touchable. Move your cursor over the
// disk: yellow boxes are the clusters the tree walk accepted as single
// point masses for that location. Drag theta and watch the far field
// coarsen or sharpen.

import { Shell, type Demo } from "../lib/demoShell";
import { seedDisk, type Bodies } from "../lib/seed";
import { stepBarnesHut, bhForce, buildQuadTree, drawBodies, type QuadTree } from "../lib/cpuSim";

const N = 3000;
const VIEW = 0.8;

export function mountBarnesHut(container: HTMLElement): Demo {
  const shell = new Shell(container);
  const ctx = shell.canvas.getContext("2d")!;
  let bodies: Bodies = seedDisk(N);
  let theta = 0.8;
  let showTree = false;
  let accepted = 0;
  let mouse: [number, number] | null = [0.4, 0.25];

  shell.slider({
    label: "θ (accuracy ↔ speed)",
    min: 0.1,
    max: 2.0,
    step: 0.05,
    value: theta,
    onInput: (v) => (theta = v),
  });
  shell.button("toggle full tree", () => (showTree = !showTree));
  shell.button("re-seed", () => (bodies = seedDisk(N)));
  shell.setInfo(
    () =>
      `cursor's force sum: ${accepted} clusters instead of ${N.toLocaleString()} bodies ` +
      `(${((accepted / N) * 100).toFixed(1)}% of the work)`,
  );

  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const s = (Math.min(r.width, r.height) / 2) * VIEW;
    mouse = [(e.clientX - r.left - r.width / 2) / s, -(e.clientY - r.top - r.height / 2) / s];
  });
  shell.canvas.addEventListener("pointerleave", () => (mouse = null));

  const drawCell = (tree: QuadTree, n: number, style: string, scale: number, ox: number, oy: number): void => {
    ctx.strokeStyle = style;
    const h = tree.half[n] * scale;
    ctx.strokeRect(ox + (tree.cx[n] - tree.half[n]) * scale, oy - (tree.cy[n] + tree.half[n]) * scale, h * 2, h * 2);
  };

  return {
    frame() {
      shell.tick();
      const { tree } = stepBarnesHut(bodies, { dt: 0.016, softening: 0.05 }, theta);
      drawBodies(ctx, bodies, { scale: VIEW });

      const { width, height } = ctx.canvas;
      const s = (Math.min(width, height) / 2) * VIEW;
      const ox = width / 2;
      const oy = height / 2;
      ctx.lineWidth = 1;

      if (showTree) {
        const full = buildQuadTree(bodies);
        for (let n = 0; n < full.nodeCount; n++) {
          if (full.mass[n] <= 0) continue;
          drawCell(full, n, "rgba(60, 200, 110, 0.18)", s, ox, oy);
        }
      }

      if (mouse) {
        const f = { ax: 0, ay: 0 };
        const cells: number[] = [];
        accepted = bhForce(tree, mouse[0], mouse[1], theta, 0.05, f, (n) => cells.push(n));
        for (const n of cells) {
          drawCell(tree, n, "rgba(255, 205, 80, 0.5)", s, ox, oy);
          ctx.strokeStyle = "rgba(255, 205, 80, 0.16)";
          ctx.beginPath();
          ctx.moveTo(ox + mouse[0] * s, oy - mouse[1] * s);
          ctx.lineTo(ox + tree.comX[n] * s, oy - tree.comY[n] * s);
          ctx.stroke();
        }
        ctx.fillStyle = "rgb(255, 230, 120)";
        ctx.beginPath();
        ctx.arc(ox + mouse[0] * s, oy - mouse[1] * s, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}
