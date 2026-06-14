// Chemical synapse: presynaptic spike → vesicle release → transmitter in the
// cleft → postsynaptic conductance → EPSP on the receiving cell.

import { Shell, type Demo } from "../../lib/demoShell";
import { DEFAULT_SYNAPSE, restingSynapse, stepSynapse, synapticCurrent, triggerRelease } from "../../lib/neuron/synapse";
import { REST, stepLIF, type LIFNeuron } from "../../lib/neuron/membrane";

export function mountSynapse(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.55);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const px = (n: number): number => (n * W) / 900;

  const synParams = { ...DEFAULT_SYNAPSE };
  let syn = restingSynapse();
  let post: LIFNeuron = { v: REST, refractory: 0 };
  const postHistory: number[] = [];
  const cols = Math.floor(W / px(3));
  let preSpike = 0;

  shell.button("presynaptic spike", () => {
    syn = triggerRelease(syn, synParams);
    preSpike = 1;
  });
  shell.slider({
    label: "synaptic weight",
    min: 0.2, max: 2, step: 0.1, value: synParams.weight,
    onInput: (v) => (synParams.weight = v),
  });
  shell.setInfo(() => `postsynaptic ${post.v.toFixed(1)} mV`);

  let last = performance.now();

  const vToY = (v: number): number => H * 0.78 * (1 - (v + 90) / 140);

  return {
    frame: () => {
      const now = performance.now();
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;

      syn = stepSynapse(syn, dt, synParams);
      const iSyn = synapticCurrent(syn.conductance, synParams);
      post = stepLIF(post, dt, iSyn, 14).state;
      preSpike *= 0.88;

      postHistory.push(post.v);
      if (postHistory.length > cols) postHistory.shift();

      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, W, H);

      const preX = W * 0.18;
      const postX = W * 0.78;
      const termX = W * 0.48;
      const cy = H * 0.32;

      // presynaptic terminal
      ctx.beginPath();
      ctx.arc(preX, cy, px(32), 0, Math.PI * 2);
      ctx.fillStyle = preSpike > 0.2 ? "#4a3058" : "#1e2838";
      ctx.fill();
      ctx.strokeStyle = preSpike > 0.2 ? "#ffb86b" : "#5a6a88";
      ctx.lineWidth = px(2);
      ctx.stroke();

      // vesicles
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const vr = px(5) * syn.vesicles;
        ctx.beginPath();
        ctx.arc(preX + Math.cos(a) * px(14), cy + Math.sin(a) * px(14), vr, 0, Math.PI * 2);
        ctx.fillStyle = "#c9a0ff";
        ctx.fill();
      }

      // cleft + transmitter cloud
      const cleftW = postX - preX - px(60);
      ctx.fillStyle = `rgba(120, 200, 255, ${syn.transmitter * 0.35})`;
      ctx.fillRect(preX + px(35), cy - px(20), cleftW, px(40));
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.strokeRect(preX + px(35), cy - px(20), cleftW, px(40));
      ctx.fillStyle = "rgba(180,200,220,0.5)";
      ctx.font = `${px(11)}px ui-sans-serif`;
      ctx.fillText("synaptic cleft", termX - px(40), cy - px(28));

      // postsynaptic dendrite
      ctx.beginPath();
      ctx.arc(postX, cy, px(36), 0, Math.PI * 2);
      const dep = (post.v - REST) / 50;
      ctx.fillStyle = `rgb(${30 + dep * 80}, ${35 + dep * 30}, ${55 + dep * 40})`;
      ctx.fill();
      ctx.strokeStyle = syn.conductance > 0.1 ? "#7ad4ff" : "#5a6a88";
      ctx.lineWidth = px(2 + syn.conductance * 3);
      ctx.stroke();

      // receptor glow
      if (syn.conductance > 0.05) {
        ctx.beginPath();
        ctx.arc(postX - px(30), cy, px(10 + syn.conductance * 12), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(122, 212, 255, ${syn.conductance * 0.5})`;
        ctx.fill();
      }

      // labels
      ctx.fillStyle = "#a5b0c8";
      ctx.font = `600 ${px(13)}px ui-sans-serif`;
      ctx.fillText("presynaptic", preX - px(38), cy + px(52));
      ctx.fillText("postsynaptic", postX - px(42), cy + px(52));

      // EPSP trace
      const traceY0 = H * 0.58;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, traceY0, W, H - traceY0);
      const colW = W / cols;
      ctx.beginPath();
      for (let i = 0; i < postHistory.length; i++) {
        const x = W - (postHistory.length - i) * colW;
        const y = traceY0 + vToY(postHistory[i]) * 0.35;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#9a7fd4";
      ctx.lineWidth = px(2.5);
      ctx.stroke();
      ctx.fillStyle = "rgba(180,190,210,0.6)";
      ctx.font = `${px(12)}px ui-sans-serif`;
      ctx.fillText("postsynaptic potential (EPSP)", px(10), traceY0 + px(18));

      shell.tick();
    },
  };
}
