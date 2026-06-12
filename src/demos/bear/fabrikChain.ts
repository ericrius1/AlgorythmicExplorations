// FABRIK in the flat: a chain of rigid segments chasing a draggable target.
// One iteration runs per frame — deliberately, so the algorithm's two passes
// read as motion: the tip snaps to the target and drags the chain with it,
// then the root snaps home and drags it back. Move the target and watch the
// disagreement settle.

import { Shell, type Demo } from "../../lib/demoShell";
import { makeFabrik, fabrikStep, type Fabrik2D } from "../../lib/bear/ik";

export function mountFabrikChain(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.52);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;

  const rootX = W * 0.5;
  const rootY = H * 0.82;
  let segments = 4;
  let chain: Fabrik2D = rebuild();
  let err = 0;

  function rebuild(): Fabrik2D {
    const reach = Math.min(W, H * 1.6) * 0.42;
    return makeFabrik(rootX, rootY, new Array(segments).fill(reach / segments));
  }

  const target = { x: W * 0.68, y: H * 0.3 };
  const toCanvas = (e: PointerEvent): void => {
    const r = shell.canvas.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width) * W;
    target.y = ((e.clientY - r.top) / r.height) * H;
  };
  let dragging = false;
  shell.canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    shell.canvas.setPointerCapture(e.pointerId);
    toCanvas(e);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (dragging || e.pointerType === "mouse") toCanvas(e);
  });
  shell.canvas.addEventListener("pointerup", () => (dragging = false));

  shell.slider({
    label: "segments",
    min: 2, max: 8, step: 1, value: segments,
    onInput: (v) => {
      segments = Math.round(v);
      chain = rebuild();
    },
  });
  shell.setInfo(() => `1 iteration/frame · tip error ${(err / W * 100).toFixed(2)}% of width`);

  const px = (n: number): number => (n * W) / 900; // stroke widths in design units

  return {
    frame: () => {
      err = fabrikStep(chain, target.x, target.y);

      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, W, H);

      // reach circle: everything the chain can touch
      const reach = chain.lengths.reduce((a, b) => a + b, 0);
      ctx.beginPath();
      ctx.arc(rootX, rootY, reach, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(122, 162, 255, 0.14)";
      ctx.lineWidth = px(2);
      ctx.setLineDash([px(6), px(8)]);
      ctx.stroke();
      ctx.setLineDash([]);

      // the chain
      ctx.beginPath();
      ctx.moveTo(chain.pts[0].x, chain.pts[0].y);
      for (let i = 1; i < chain.pts.length; i++) ctx.lineTo(chain.pts[i].x, chain.pts[i].y);
      ctx.strokeStyle = "#7aa2ff";
      ctx.lineWidth = px(5);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      // joints
      for (let i = 0; i < chain.pts.length; i++) {
        ctx.beginPath();
        ctx.arc(chain.pts[i].x, chain.pts[i].y, i === 0 ? px(9) : px(6), 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#d7dbe6" : "#eef1f8";
        ctx.fill();
      }

      // the target
      ctx.beginPath();
      ctx.arc(target.x, target.y, px(10), 0, Math.PI * 2);
      ctx.fillStyle = "#ffb86b";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(target.x, target.y, px(17), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 184, 107, 0.4)";
      ctx.lineWidth = px(2);
      ctx.stroke();

      shell.tick();
    },
  };
}
