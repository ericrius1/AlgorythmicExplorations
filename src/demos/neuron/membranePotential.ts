// Resting membrane potential: ion gradients, leak channels, and a current pulse
// that can trigger a full action potential. Voltage trace scrolls like an oscilloscope.

import { Shell, type Demo } from "../../lib/demoShell";
import {
  DEFAULT_PARAMS,
  THRESH,
  restingState,
  stepMembrane,
  type MembraneParams,
} from "../../lib/neuron/membrane";

export function mountMembranePotential(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.52);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const px = (n: number): number => (n * W) / 900;

  let params: MembraneParams = { ...DEFAULT_PARAMS };
  let state = restingState();
  const history: number[] = [];
  const cols = Math.floor(W / px(3));
  let stim = 0;
  let stimT = 0;

  shell.slider({
    label: "Na⁺ conductance",
    min: 40, max: 200, step: 5, value: params.gNa,
    onInput: (v) => (params = { ...params, gNa: v }),
  });
  shell.slider({
    label: "K⁺ conductance",
    min: 10, max: 80, step: 2, value: params.gK,
    onInput: (v) => (params = { ...params, gK: v }),
  });
  shell.button("inject current", () => {
    stim = 18;
    stimT = 0.12;
  });
  shell.setInfo(() => `${state.v.toFixed(1)} mV`);

  let last = performance.now();

  const vToY = (v: number): number => {
    const lo = -90, hi = 50;
    return H * (1 - (v - lo) / (hi - lo));
  };

  return {
    frame: () => {
      const now = performance.now();
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;

      const iIn = stimT > 0 ? stim : 0;
      if (stimT > 0) stimT -= dt;
      state = stepMembrane(state, dt, params, iIn);

      history.push(state.v);
      if (history.length > cols) history.shift();

      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, W, H);

      // grid
      for (const mv of [-70, -55, 0, 40]) {
        const y = vToY(mv);
        ctx.strokeStyle = mv === -70 ? "rgba(122, 162, 255, 0.25)" : "rgba(255,255,255,0.06)";
        ctx.lineWidth = px(mv === -70 ? 1.5 : 1);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.fillStyle = "rgba(180, 190, 210, 0.5)";
        ctx.font = `${px(12)}px ui-sans-serif`;
        ctx.fillText(`${mv} mV`, px(8), y - px(4));
      }

      // trace
      const colW = W / cols;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = W - (history.length - i) * colW;
        const y = vToY(history[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#7aa2ff";
      ctx.lineWidth = px(2.5);
      ctx.stroke();

      // cell diagram (right side)
      const cx = W * 0.82;
      const cy = H * 0.5;
      const r = px(55);
      const fill = state.v > -60 ? "#3d2a4a" : "#1a2238";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = state.v > THRESH ? "#ffb86b" : "#5a6a8a";
      ctx.lineWidth = px(2);
      ctx.stroke();

      // Na/K dots
      const na = params.gNa / DEFAULT_PARAMS.gNa;
      const k = params.gK / DEFAULT_PARAMS.gK;
      ctx.fillStyle = "#ff7b9c";
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, px(4) * na, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#7ad4ff";
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, px(3.5) * k, 0, Math.PI * 2);
        ctx.fill();
      }

      shell.tick();
    },
  };
}
