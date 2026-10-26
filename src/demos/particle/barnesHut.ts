// Demo 4: the Barnes-Hut idea, made touchable. Move your cursor over the
// disk: yellow boxes are the clusters the tree walk accepted as single
// point masses for that location. Drag theta and watch the far field
// coarsen or sharpen, and the readout's error against the exact sum move
// with it.

import { Shell, type Demo } from "../../lib/demoShell";
import { seedDisk, G, type Bodies } from "../../lib/seed";
import { stepBarnesHut, bhForce, buildQuadTree, drawBodies, type QuadTree } from "../../lib/cpuSim";
import { pixelRatio } from "../../lib/palette";

const N = 3000;
const VIEW = 0.8;
const SOFTENING = 0.05;

// The exact answer at one point: all N terms. Cheap at N = 3,000, and it's
// what the readout measures the tree walk against.
function directForce(b: Bodies, px: number, py: number): [number, number] {
  const eps2 = SOFTENING * SOFTENING;
  let ax = 0;
  let ay = 0;
  for (let j = 0; j < b.count; j++) {
    const dx = b.state[j * 4] - px;
    const dy = b.state[j * 4 + 1] - py;
    const r2 = dx * dx + dy * dy + eps2;
    const inv = (G * b.mass[j]) / (r2 * Math.sqrt(r2));
    ax += dx * inv;
    ay += dy * inv;
  }
  return [ax, ay];
}

export function mountBarnesHut(container: HTMLElement): Demo {
  const shell = new Shell(container);
  const ctx = shell.canvas.getContext("2d")!;
  let bodies: Bodies = seedDisk(N);
  let theta = 0.8;
  let showTree = false;
  let accepted = 0;
  let error = 0;
  let mouse: [number, number] | null = null;
  // Where the probe sits when nobody is hovering (and on touch screens).
  const rest: [number, number] = [0.45, 0.2];

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
      `${accepted} terms instead of ${N.toLocaleString()} ` +
      `(${((accepted / N) * 100).toFixed(1)}% of the work) · ` +
      `${error < 0.001 ? "<0.1" : (error * 100).toFixed(1)}% off the exact force`,
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
      stepBarnesHut(bodies, { dt: 0.016, softening: SOFTENING }, theta);
      // Rebuild for the bodies' new positions so the boxes, the walk, and the
      // exact sum all describe the same instant.
      const tree = buildQuadTree(bodies);
      drawBodies(ctx, bodies, { scale: VIEW });

      const { width, height } = ctx.canvas;
      const s = (Math.min(width, height) / 2) * VIEW;
      const ox = width / 2;
      const oy = height / 2;
      const dpx = pixelRatio(shell.canvas);
      ctx.lineWidth = dpx;

      if (showTree) {
        for (let n = 0; n < tree.nodeCount; n++) {
          if (tree.mass[n] <= 0) continue;
          drawCell(tree, n, "rgba(60, 200, 110, 0.18)", s, ox, oy);
        }
      }

      const probe = mouse ?? rest;
      const f = { ax: 0, ay: 0 };
      const cells: number[] = [];
      accepted = bhForce(tree, probe[0], probe[1], theta, SOFTENING, f, (n) => cells.push(n));
      const [ex, ey] = directForce(bodies, probe[0], probe[1]);
      error = Math.hypot(f.ax - ex, f.ay - ey) / Math.max(Math.hypot(ex, ey), 1e-12);
      for (const n of cells) {
        drawCell(tree, n, "rgba(255, 205, 80, 0.5)", s, ox, oy);
        ctx.strokeStyle = "rgba(255, 205, 80, 0.16)";
        ctx.beginPath();
        ctx.moveTo(ox + probe[0] * s, oy - probe[1] * s);
        ctx.lineTo(ox + tree.comX[n] * s, oy - tree.comY[n] * s);
        ctx.stroke();
      }
      const glow = ctx.createRadialGradient(ox + probe[0] * s, oy - probe[1] * s, 0, ox + probe[0] * s, oy - probe[1] * s, 14 * dpx);
      glow.addColorStop(0, "rgba(255, 220, 120, 0.6)");
      glow.addColorStop(1, "rgba(255, 220, 120, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(ox + probe[0] * s - 14 * dpx, oy - probe[1] * s - 14 * dpx, 28 * dpx, 28 * dpx);
      ctx.fillStyle = "rgb(255, 236, 160)";
      ctx.beginPath();
      ctx.arc(ox + probe[0] * s, oy - probe[1] * s, 3.5 * dpx, 0, Math.PI * 2);
      ctx.fill();
    },
  };
}
