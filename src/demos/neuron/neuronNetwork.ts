// Small integrate-and-fire network. Click a neuron to stimulate it; watch spikes
// propagate across weighted excitatory and inhibitory connections.

import { Shell, type Demo } from "../../lib/demoShell";
import { REST, stepLIF, type LIFNeuron } from "../../lib/neuron/membrane";

interface Node {
  x: number;
  y: number;
  n: LIFNeuron;
  flash: number;
}

interface Edge {
  from: number;
  to: number;
  w: number;
}

const LAYOUT: { x: number; y: number }[] = [
  { x: 0.15, y: 0.35 },
  { x: 0.35, y: 0.18 },
  { x: 0.35, y: 0.52 },
  { x: 0.55, y: 0.35 },
  { x: 0.75, y: 0.22 },
  { x: 0.75, y: 0.48 },
  { x: 0.9, y: 0.35 },
];

const EDGES: Edge[] = [
  { from: 0, to: 1, w: 1.2 },
  { from: 0, to: 2, w: 1.0 },
  { from: 1, to: 3, w: 0.9 },
  { from: 2, to: 3, w: 0.9 },
  { from: 3, to: 4, w: 1.1 },
  { from: 3, to: 5, w: 1.1 },
  { from: 4, to: 6, w: 0.8 },
  { from: 5, to: 6, w: 0.8 },
  { from: 5, to: 3, w: -0.6 }, // inhibitory feedback
];

export function mountNeuronNetwork(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const px = (n: number): number => (n * W) / 900;

  const nodes: Node[] = LAYOUT.map((p) => ({
    x: p.x * W,
    y: p.y * H,
    n: { v: REST, refractory: 0 },
    flash: 0,
  }));

  const pending: { to: number; w: number; t: number }[] = [];
  let noise = 0.3;

  shell.slider({
    label: "background noise",
    min: 0, max: 1.5, step: 0.05, value: noise,
    onInput: (v) => (noise = v),
  });
  shell.setInfo(() => "click a neuron to stimulate");

  shell.canvas.addEventListener("pointerdown", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const dpr = shell.canvas.width / r.width;
    const cx = mx * dpr;
    const cy = my * dpr;
    let best = -1;
    let bestD = px(40) ** 2;
    nodes.forEach((nd, i) => {
      const d = (nd.x - cx) ** 2 + (nd.y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      const { state, fired } = stepLIF(nodes[best].n, 0.001, 25);
      nodes[best].n = state;
      if (!fired) {
        nodes[best].n = { v: -50, refractory: 0 };
        nodes[best].flash = 1;
        for (const e of EDGES)
          if (e.from === best) pending.push({ to: e.to, w: e.w, t: 0.08 });
      }
    }
  });

  let last = performance.now();

  return {
    frame: () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // deliver delayed synaptic inputs
      for (let i = pending.length - 1; i >= 0; i--) {
        pending[i].t -= dt;
        if (pending[i].t <= 0) {
          const p = pending[i];
          pending.splice(i, 1);
          const input = p.w * 12;
          const { state, fired } = stepLIF(nodes[p.to].n, dt, input + (Math.random() - 0.5) * noise);
          nodes[p.to].n = state;
          if (fired) {
            nodes[p.to].flash = 1;
            for (const e of EDGES)
              if (e.from === p.to) pending.push({ to: e.to, w: e.w, t: 0.06 + Math.random() * 0.04 });
          }
        }
      }

      // background noise integration
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].flash <= 0) {
          const { state, fired } = stepLIF(nodes[i].n, dt, (Math.random() - 0.5) * noise);
          nodes[i].n = state;
          if (fired) {
            nodes[i].flash = 1;
            for (const e of EDGES)
              if (e.from === i) pending.push({ to: e.to, w: e.w, t: 0.06 });
          }
        }
        nodes[i].flash *= 0.9;
      }

      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, W, H);

      // edges
      for (const e of EDGES) {
        const a = nodes[e.from];
        const b = nodes[e.to];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = e.w < 0 ? "rgba(255, 120, 140, 0.35)" : "rgba(122, 162, 255, 0.35)";
        ctx.lineWidth = px(Math.abs(e.w) * 2);
        ctx.stroke();
      }

      // nodes
      for (const nd of nodes) {
        const r = px(18 + nd.flash * 8);
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
        const dep = (nd.n.v - REST) / 30;
        ctx.fillStyle = nd.flash > 0.2 ? "#ffb86b" : `rgb(${26 + dep * 60}, ${32 + dep * 20}, ${52})`;
        ctx.fill();
        ctx.strokeStyle = nd.flash > 0.2 ? "#ffd89a" : "#5a7098";
        ctx.lineWidth = px(2);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(180,190,210,0.55)";
      ctx.font = `${px(12)}px ui-sans-serif`;
      ctx.fillText("blue = excitatory · red = inhibitory", px(10), H - px(12));

      shell.tick();
    },
  };
}
