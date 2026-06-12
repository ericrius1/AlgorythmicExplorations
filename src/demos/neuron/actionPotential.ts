// Action potential propagating along an unmyelinated axon. Each segment is a
// simple excitable cable: depolarization spreads to neighbors, then refracts.

import { Shell, type Demo } from "../../lib/demoShell";
import { PEAK, REST, THRESH } from "../../lib/neuron/membrane";

const N = 48;

export function mountActionPotential(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.45);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const px = (n: number): number => (n * W) / 900;

  const v = new Float32Array(N).fill(REST);
  const refract = new Float32Array(N);
  let speed = 1.2;
  let stimSeg = 4;

  shell.slider({
    label: "conduction speed",
    min: 0.4, max: 2.5, step: 0.1, value: speed,
    onInput: (v) => (speed = v),
  });
  shell.button("stimulate", () => {
    v[stimSeg] = PEAK;
    refract[stimSeg] = 8;
  });
  shell.setInfo(() => "click axon to stimulate at that point");

  shell.canvas.addEventListener("pointerdown", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const segW = W / N;
    const i = Math.floor(x / segW);
    if (i >= 0 && i < N) {
      stimSeg = i;
      v[i] = PEAK;
      refract[i] = 8;
    }
  });

  let last = performance.now();

  return {
    frame: () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const next = new Float32Array(v);
      for (let i = 0; i < N; i++) {
        if (refract[i] > 0) {
          refract[i] -= dt * 60;
          next[i] = REST + (v[i] - REST) * 0.85;
          continue;
        }
        let lap = 0;
        if (i > 0) lap += v[i - 1] - v[i];
        if (i < N - 1) lap += v[i + 1] - v[i];
        let nv = v[i] + lap * 0.18 * speed - (v[i] - REST) * 0.04;
        if (nv >= THRESH && v[i] < THRESH) {
          nv = PEAK;
          refract[i] = 6;
        }
        next[i] = nv;
      }
      v.set(next);

      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, W, H);

      const segW = W / N;
      const midY = H * 0.55;
      const amp = H * 0.32;

      // soma
      ctx.beginPath();
      ctx.arc(segW * 1.5, midY, px(28), 0, Math.PI * 2);
      ctx.fillStyle = "#1a2840";
      ctx.fill();
      ctx.strokeStyle = "#5a7aaa";
      ctx.lineWidth = px(2);
      ctx.stroke();
      ctx.fillStyle = "#a5b8d8";
      ctx.font = `600 ${px(13)}px ui-sans-serif`;
      ctx.fillText("soma", segW * 1.5 - px(16), midY + px(42));

      // axon segments
      for (let i = 0; i < N; i++) {
        const x = i * segW;
        const norm = (v[i] - REST) / (PEAK - REST);
        const hue = 0.58 - norm * 0.35;
        const col = `hsl(${hue * 360}, 70%, ${35 + norm * 35}%)`;
        ctx.fillStyle = col;
        ctx.fillRect(x, midY - px(8), segW + 1, px(16));

        // voltage trace above
        const y = midY - amp * 0.5 - norm * amp * 0.45;
        ctx.fillStyle = norm > 0.3 ? "#ffb86b" : "#4a6088";
        ctx.fillRect(x, y, segW, px(3));
      }

      // labels
      ctx.fillStyle = "rgba(200,210,230,0.6)";
      ctx.font = `${px(12)}px ui-sans-serif`;
      ctx.fillText("axon →", W - px(70), midY + px(36));
      ctx.fillText(`${REST} mV`, px(8), midY - amp * 0.5);
      ctx.fillText(`${PEAK} mV`, px(8), midY - amp);

      shell.tick();
    },
  };
}
