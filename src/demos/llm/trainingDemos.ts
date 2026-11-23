// Part 3 Figures ("Teaching the Weights"):
//  1. mountTrainingHero   — Live loss landscape & gradient pulse from a running WebGPU micro-LLM
//  2. mountGradFlowDemo   — Interactive gradient-norm waterfall (toggle RMSNorm & Residuals!)
//  3. mountLiveTrainer    — Full interactive Pure-WebGPU Transformer trainer + live sampler

import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";
import { CORPORA } from "../../lib/llm/datasets";
import { decodeTokens, encodeText } from "../../lib/llm/tokenizer";
import { createMicroLLM, sampleBatch, type MicroLLM, type OptimizerKind } from "../../lib/llm/webgpuEngine";

// ---- 1. Hero: Live Gradient Stream & Loss Basin ----------------------------

export async function mountTrainingHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.46);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  const tokens = encodeText(CORPORA[1].text);
  const llm = await createMicroLLM({ seqLen: 32, dModel: 48, nLayers: 2, nHeads: 4, ffnDim: 96, lr: 0.01, batchSize: 4 });
  const losses: number[] = [];
  let running = true;
  let stepping = false;
  let lastInfo = `initializing ${llm.backend}...`;

  shell.setInfo(() => lastInfo);

  const doStep = () => {
    if (!running || stepping) return;
    stepping = true;
    const { inputs, targets } = sampleBatch(tokens, llm.config.batchSize, llm.config.seqLen);
    void llm
      .trainStep(inputs, targets)
      .then((m) => {
        losses.push(m.loss);
        if (losses.length > 140) losses.shift();
        lastInfo = `${llm.backend} · step ${m.step} · loss ${m.loss.toFixed(3)} · ${(m.tokPerSec / 1000).toFixed(1)}k tok/s`;
        stepping = false;
      })
      .catch(() => {
        stepping = false;
      });
  };

  return {
    frame() {
      shell.tick();
      doStep();

      const t = performance.now() * 0.001;
      ctx.fillStyle = "#080a12";
      ctx.fillRect(0, 0, W, H);

      // Subtle glowing weight-matrix shimmer backdrop
      const cols = 32;
      const rows = 12;
      const cw = W / cols;
      const ch = H / rows;
      const curLoss = losses[losses.length - 1] ?? 4.5;
      const calm = Math.max(0.15, Math.min(1, curLoss / 4.5));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = Math.sin(r * 0.7 + c * 0.45 + t * (1.2 + calm * 2.5)) * Math.cos(c * 0.31 - t);
          ctx.fillStyle = v > 0 ? `rgba(122, 162, 255, ${v * 0.09})` : `rgba(255, 184, 107, ${-v * 0.08})`;
          ctx.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4);
        }
      }

      // Live loss descent ribbon
      if (losses.length > 2) {
        const padX = W * 0.1;
        const padY = H * 0.2;
        const gw = W - padX * 2;
        const gh = H - padY * 2;
        const maxL = Math.max(4.6, ...losses);
        const minL = Math.min(0.4, ...losses);

        ctx.beginPath();
        losses.forEach((l, i) => {
          const x = padX + (i / Math.max(1, losses.length - 1)) * gw;
          const y = padY + (1 - (l - minL) / Math.max(0.1, maxL - minL)) * gh;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "#5ef0b5";
        ctx.lineWidth = 3 * dpr;
        ctx.stroke();

        const lastX = padX + gw;
        const lastY = padY + (1 - (curLoss - minL) / Math.max(0.1, maxL - minL)) * gh;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(lastX, lastY, 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    dispose() {
      running = false;
      llm.dispose();
    },
  };
}

// ---- 2. Fig 1: Gradient Norm Flow Waterfall --------------------------------

export function mountGradFlowDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.48);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let depth = 12;
  let residual = true;
  let rmsNorm = true;
  let weightGain = 1.05;

  shell.slider({ label: "layers", min: 4, max: 24, step: 2, value: depth, onInput: (v) => (depth = Math.round(v)) });
  shell.slider({
    label: "weight gain",
    min: 0.6,
    max: 1.45,
    step: 0.05,
    value: weightGain,
    format: (v) => `${v.toFixed(2)}×`,
    onInput: (v) => (weightGain = v),
  });
  const resBtn = shell.button("Residual: ON", () => {
    residual = !residual;
    resBtn.textContent = `Residual: ${residual ? "ON" : "OFF"}`;
  });
  const normBtn = shell.button("RMSNorm: ON", () => {
    rmsNorm = !rmsNorm;
    normBtn.textContent = `RMSNorm: ${rmsNorm ? "ON" : "OFF"}`;
  });

  let infoLine = "";
  shell.setInfo(() => infoLine);

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 28 * dpr;

      // Simulate backward gradient magnitude from layer L -> layer 1
      const norms: number[] = [];
      let g = 1.0;
      for (let l = depth; l >= 1; l--) {
        norms.unshift(g);
        const effGain = rmsNorm ? 0.85 + (weightGain - 1) * 0.25 : weightGain;
        g = residual ? g * (0.94 + 0.06 * effGain) : g * effGain;
        g = Math.max(1e-6, Math.min(1e6, g));
      }

      const ratio = norms[0] / Math.max(1e-9, norms[norms.length - 1]);
      infoLine =
        ratio > 10
          ? `Exploding gradient! Layer-1 grad is ${ratio.toFixed(0)}× larger than output`
          : ratio < 0.08
            ? `Vanishing gradient! Layer-1 grad shrank to ${ratio.toExponential(1)}`
            : `Healthy gradient highway — Layer-1 / Layer-${depth} ratio = ${ratio.toFixed(2)}×`;

      const barW = (W - pad * 2) / depth;
      const baseY = H - pad - 24 * dpr;
      const maxBarH = H - pad * 2 - 58 * dpr;

      // Reference line at log10(1) = 0
      const zeroY = baseY - maxBarH * 0.5;
      ctx.strokeStyle = "rgba(94, 240, 181, 0.35)";
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(pad, zeroY);
      ctx.lineTo(W - pad, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      norms.forEach((n, i) => {
        const logV = Math.max(-3, Math.min(3, Math.log10(n)));
        const frac = (logV + 3) / 6; // 0..1 where 0.5 is 1.0
        const h = frac * maxBarH;
        const x = pad + i * barW;
        const col = Math.abs(logV) < 0.45 ? "#5ef0b5" : logV > 0 ? "#ff6b81" : "#ffb86b";
        ctx.fillStyle = col;
        ctx.fillRect(x + 3 * dpr, baseY - h, barW - 6 * dpr, h);

        if (depth <= 16 || i % 2 === 0) {
          ctx.fillStyle = "#8a94b2";
          ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
          ctx.textAlign = "center";
          ctx.fillText(`L${i + 1}`, x + barW * 0.5, baseY + 15 * dpr);
        }
      });

      ctx.fillStyle = "#cfd7f0";
      ctx.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("← Backward pass gradient norm ‖∂L/∂x_l‖ (log scale, dashed = 1.0)", pad, pad + 10 * dpr);
    },
  };
}

// ---- 3. Fig 2: Full Pure-WebGPU Live Micro-LLM Trainer ---------------------

export async function mountLiveTrainer(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let corpusIdx = 0;
  let customText = CORPORA[0].text;
  let tokens = encodeText(customText);
  let lr = 0.009;
  let optimizer: OptimizerKind = "adamw";
  let nLayers = 2;
  let temperature = 0.75;
  let training = false;
  let stepping = false;
  let sampling = false;
  let sampleOutput = "Press Train to watch random noise turn into structured language on WebGPU...";
  let lastAttn: Float32Array | null = null;
  const lossHistory: number[] = [];

  let llm: MicroLLM = await createMicroLLM({
    seqLen: 48,
    dModel: 64,
    nLayers,
    nHeads: 4,
    ffnDim: 128,
    activation: "swiglu",
    optimizer,
    lr,
    batchSize: 4,
  });

  // Compact studio bar under canvas for dataset picker & live generated text
  const panel = document.createElement("div");
  panel.className = "sm-trainer-panel";
  panel.innerHTML = `
    <div class="sm-row">
      <div class="sm-chip-group" data-corpora></div>
      <span class="sm-badge" data-backend></span>
    </div>
    <div class="sm-output-box">
      <div class="sm-output-head"><span>Live WebGPU Generation</span><span data-gen-meta></span></div>
      <pre class="sm-output-pre" data-sample></pre>
    </div>
  `;
  container.insertBefore(panel, shell.controls);

  const corporaEl = panel.querySelector<HTMLElement>("[data-corpora]")!;
  const backendEl = panel.querySelector<HTMLElement>("[data-backend]")!;
  const sampleEl = panel.querySelector<HTMLElement>("[data-sample]")!;
  const genMetaEl = panel.querySelector<HTMLElement>("[data-gen-meta]")!;
  sampleEl.textContent = sampleOutput;

  const updateBackendBadge = () => {
    backendEl.textContent = `${llm.backend.toUpperCase()} · ${(llm.paramCount / 1000).toFixed(1)}K params`;
  };
  updateBackendBadge();

  const rebuildModel = async () => {
    training = false;
    trainBtn.textContent = "train";
    lossHistory.length = 0;
    llm.dispose();
    llm = await createMicroLLM({
      seqLen: 48,
      dModel: 64,
      nLayers,
      nHeads: 4,
      ffnDim: 128,
      activation: "swiglu",
      optimizer,
      lr,
      batchSize: 4,
      seed: 1337 + corpusIdx * 31,
    });
    updateBackendBadge();
  };

  CORPORA.forEach((c, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sm-chip" + (idx === 0 ? " is-active" : "");
    b.textContent = c.label;
    b.addEventListener("click", () => {
      corpusIdx = idx;
      customText = c.text;
      tokens = encodeText(customText);
      corporaEl.querySelectorAll(".sm-chip").forEach((el, i) => el.classList.toggle("is-active", i === idx));
      void rebuildModel();
    });
    corporaEl.appendChild(b);
  });

  const runSample = async () => {
    if (sampling) return;
    sampling = true;
    const promptStr = CORPORA[corpusIdx].prompt;
    const promptIds = encodeText(promptStr);
    const res = await llm.generate(promptIds, { maxNewTokens: 96, temperature, topP: 0.9 });
    sampleOutput = promptStr + decodeTokens(res.tokens);
    sampleEl.textContent = sampleOutput;
    genMetaEl.textContent = `${res.tokPerSec.toFixed(0)} tok/s · T=${temperature.toFixed(2)}`;
    lastAttn = res.lastAttention;
    sampling = false;
  };

  const trainBtn = shell.button("train", () => {
    training = !training;
    trainBtn.textContent = training ? "pause" : "train";
  });
  shell.button("sample now", () => void runSample());
  const optBtn = shell.button("opt: AdamW", () => {
    optimizer = optimizer === "adamw" ? "muon" : "adamw";
    optBtn.textContent = `opt: ${optimizer === "adamw" ? "AdamW" : "Muon"}`;
    void rebuildModel();
  });
  shell.button("reset", () => void rebuildModel());
  shell.slider({
    label: "lr",
    min: 0.002,
    max: 0.025,
    step: 0.001,
    value: lr,
    format: (v) => v.toFixed(3),
    onInput: (v) => (lr = v),
  });
  shell.slider({
    label: "temp",
    min: 0.25,
    max: 1.4,
    step: 0.05,
    value: temperature,
    format: (v) => v.toFixed(2),
    onInput: (v) => (temperature = v),
  });

  let lastMetrics = "Ready — press Train to run pure-WebGPU backprop";
  shell.setInfo(() => lastMetrics);

  return {
    frame() {
      shell.tick();

      if (training && !stepping && !sampling) {
        stepping = true;
        const { inputs, targets } = sampleBatch(tokens, llm.config.batchSize, llm.config.seqLen);
        void llm
          .trainStep(inputs, targets, lr)
          .then((m) => {
            lossHistory.push(m.loss);
            if (lossHistory.length > 260) lossHistory.shift();
            lastMetrics = `step ${m.step} · loss ${m.loss.toFixed(3)} (${m.bpb.toFixed(2)} bpb) · ${m.stepMs.toFixed(1)} ms · ${(m.tokPerSec / 1000).toFixed(1)}k tok/s`;
            stepping = false;
            if (m.step % 25 === 0) void runSample();
          })
          .catch(() => {
            stepping = false;
          });
      }

      // Draw live loss chart (left) + live Layer-0 Head-0 Attention Heatmap (right)
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 24 * dpr;
      const chartW = W * 0.62 - pad * 1.5;
      const chartH = H - pad * 2 - 22 * dpr;

      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("TRAINING CROSS-ENTROPY LOSS (NATS)", pad, pad + 6 * dpr);

      const cy0 = pad + 18 * dpr;
      ctx.fillStyle = "rgba(15, 19, 32, 0.9)";
      ctx.fillRect(pad, cy0, chartW, chartH);
      ctx.strokeStyle = "rgba(122, 162, 255, 0.2)";
      ctx.lineWidth = dpr;
      ctx.strokeRect(pad, cy0, chartW, chartH);

      // Horizontal grid lines (4.5, 3.0, 1.5, 0.5)
      for (const lvl of [4.5, 3.0, 1.5, 0.5]) {
        const y = cy0 + (1 - lvl / 4.8) * chartH;
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + chartW, y);
        ctx.stroke();
        ctx.fillStyle = "#626d8a";
        ctx.fillText(lvl.toFixed(1), pad + 6 * dpr, y - 4 * dpr);
      }

      if (lossHistory.length > 1) {
        ctx.beginPath();
        lossHistory.forEach((l, i) => {
          const x = pad + (i / Math.max(1, lossHistory.length - 1)) * chartW;
          const y = cy0 + (1 - Math.min(4.8, Math.max(0, l)) / 4.8) * chartH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "#5ef0b5";
        ctx.lineWidth = 2.2 * dpr;
        ctx.stroke();
      } else {
        ctx.fillStyle = "#6e7998";
        ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText("Hit Train below to start WebGPU gradient descent.", pad + 26 * dpr, cy0 + chartH * 0.5);
      }

      // Right: Live causal attention heatmap
      const hmX = pad * 2 + chartW;
      const hmSize = Math.min(W - hmX - pad, chartH);
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("CAUSAL ATTENTION (L0·H0)", hmX, pad + 6 * dpr);
      ctx.fillStyle = "rgba(15, 19, 32, 0.9)";
      ctx.fillRect(hmX, cy0, hmSize, hmSize);
      ctx.strokeStyle = "rgba(122, 162, 255, 0.2)";
      ctx.strokeRect(hmX, cy0, hmSize, hmSize);

      if (lastAttn) {
        const T = llm.config.seqLen;
        const show = Math.min(24, T);
        const cell = hmSize / show;
        for (let r = 0; r < show; r++) {
          for (let c = 0; c <= r; c++) {
            const p = Math.min(1, lastAttn[r * T + c] * 3.2);
            ctx.fillStyle = `rgba(122, 162, 255, ${0.08 + p * 0.92})`;
            ctx.fillRect(hmX + c * cell, cy0 + r * cell, cell, cell);
          }
        }
      } else {
        ctx.fillStyle = "#626d8a";
        ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText("Sample to inspect", hmX + 14 * dpr, cy0 + hmSize * 0.5);
      }
    },
    dispose() {
      training = false;
      llm.dispose();
    },
  };
}
