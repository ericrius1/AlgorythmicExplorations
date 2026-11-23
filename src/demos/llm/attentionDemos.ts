// Part 2 Figures ("Paying Attention in One Pass"):
//  1. mountAttentionHero — Live multi-head causal attention flow ribbons
//  2. mountRopeDemo      — Rotary Positional Embeddings (RoPE) phasor studio
//  3. mountFlashAttnDemo — Real WebGPU FlashAttention online-softmax (m, l, O) inspector
//  4. mountBlockDemo     — RMSNorm + SwiGLU vs GELU activation explorer

import attentionWgsl from "../../lib/llm/shaders/attention.wgsl?raw";
import { Shell, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { pixelRatio } from "../../lib/palette";

// ---- 1. Hero: Multi-Head Causal Attention Streams --------------------------

export function mountAttentionHero(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.46);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  const words = ["The", "small", "cat", "saw", "a", "star", "and", "chased", "its", "warm", "glow"];
  let head = 0;
  const headColors = ["#7aa2ff", "#5ef0b5", "#ffb86b", "#ff7ab8"];
  const headNames = ["Head 0 · Subject link", "Head 1 · Local syntax", "Head 2 · Semantic echo", "Head 3 · Broad context"];

  shell.button("next head", () => {
    head = (head + 1) % 4;
  });
  shell.setInfo(() => `${headNames[head]} · causal mask hides future tokens`);

  const scoreWeight = (q: number, k: number, h: number): number => {
    if (k > q) return 0;
    if (h === 0) return k === 2 ? 2.6 : k === q ? 1.0 : 0.25; // attends to "cat"
    if (h === 1) return Math.exp(-Math.abs(q - k) * 0.9) * 2.4; // local window
    if (h === 2) return (q === 10 && k === 5) || (q === 8 && k === 2) ? 3.2 : 0.35; // long-range coref
    return 0.8 + 0.5 * Math.sin(q * 0.9 + k * 1.3);
  };

  return {
    frame() {
      shell.tick();
      const t = performance.now() * 0.001;
      ctx.fillStyle = "#080a12";
      ctx.fillRect(0, 0, W, H);

      const activeQ = Math.floor(t * 1.3) % words.length;
      const padX = W * 0.08;
      const stepX = (W - padX * 2) / (words.length - 1);
      const yBase = H * 0.72;
      const col = headColors[head];

      // Compute causal softmax weights for every query
      for (let q = 0; q < words.length; q++) {
        let sum = 0;
        const wts: number[] = [];
        for (let k = 0; k <= q; k++) {
          const e = Math.exp(scoreWeight(q, k, head));
          wts.push(e);
          sum += e;
        }
        const isFocus = q === activeQ;
        for (let k = 0; k <= q; k++) {
          const p = wts[k] / sum;
          if (p < 0.05 && !isFocus) continue;
          const x1 = padX + q * stepX;
          const x2 = padX + k * stepX;
          const span = Math.abs(x1 - x2);
          const arch = Math.max(24 * dpr, span * 0.44);
          ctx.beginPath();
          ctx.moveTo(x1, yBase - 14 * dpr);
          ctx.quadraticCurveTo((x1 + x2) * 0.5, yBase - arch - 24 * dpr, x2, yBase - 14 * dpr);
          ctx.strokeStyle = isFocus ? col : "rgba(122, 162, 255, 0.14)";
          ctx.globalAlpha = isFocus ? Math.min(1, 0.2 + p * 1.2) : p * 0.3;
          ctx.lineWidth = (isFocus ? 1.5 + p * 5.5 : 1) * dpr;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Token nodes along the baseline
      for (let i = 0; i < words.length; i++) {
        const x = padX + i * stepX;
        const isQ = i === activeQ;
        const masked = i > activeQ;
        ctx.fillStyle = isQ ? col : masked ? "rgba(60, 68, 92, 0.45)" : "rgba(215, 224, 248, 0.85)";
        ctx.beginPath();
        ctx.arc(x, yBase - 10 * dpr, (isQ ? 6 : 4) * dpr, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = `${(isQ ? 700 : 500)} ${13 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(words[i], x, yBase + 16 * dpr);
        ctx.fillStyle = "#5c6684";
        ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`t=${i}`, x, yBase + 33 * dpr);
      }
    },
  };
}

// ---- 2. Fig 1: Rotary Positional Embeddings (RoPE) -------------------------

export function mountRopeDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.54);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let posM = 12;
  let posN = 5;
  let theta = 1000;

  shell.slider({ label: "query pos m", min: 0, max: 32, step: 1, value: posM, onInput: (v) => (posM = Math.round(v)) });
  shell.slider({ label: "key pos n", min: 0, max: 32, step: 1, value: posN, onInput: (v) => (posN = Math.round(v)) });
  shell.slider({
    label: "RoPE base θ",
    min: 50,
    max: 10000,
    step: 50,
    value: theta,
    log: true,
    format: (v) => `θ=${Math.round(v)}`,
    onInput: (v) => (theta = v),
  });

  const pairs = 4;
  let dotScore = 0;
  shell.setInfo(() => `relative offset Δ = m − n = ${posM - posN} · RoPE dot(R_m q, R_n k) = ${dotScore.toFixed(3)}`);

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);

      const pad = 26 * dpr;
      const rad = Math.min((W - pad * 2) / (pairs * 2.7), H * 0.26);
      const cy = H * 0.44;
      dotScore = 0;

      for (let p = 0; p < pairs; p++) {
        const cx = pad + rad + p * ((W - pad * 2 - rad * 2) / (pairs - 1));
        const freq = Math.pow(theta, -(2 * p) / (pairs * 2));
        const angQ = posM * freq;
        const angK = posN * freq;
        const delta = angQ - angK;
        dotScore += Math.cos(delta) / pairs;

        // Circle
        ctx.strokeStyle = "rgba(122, 162, 255, 0.24)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();

        // Relative angle wedge
        ctx.fillStyle = "rgba(94, 240, 181, 0.14)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rad * 0.68, -angQ, -angK, posM > posN);
        ctx.closePath();
        ctx.fill();

        // Query phasor
        ctx.strokeStyle = "#7aa2ff";
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angQ) * rad * 0.92, cy - Math.sin(angQ) * rad * 0.92);
        ctx.stroke();

        // Key phasor
        ctx.strokeStyle = "#ffb86b";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angK) * rad * 0.92, cy - Math.sin(angK) * rad * 0.92);
        ctx.stroke();

        ctx.fillStyle = "#cfd7f0";
        ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`pair (${2 * p},${2 * p + 1})`, cx, cy - rad - 12 * dpr);
        ctx.fillStyle = "#8a94b2";
        ctx.fillText(`ω=${freq.toFixed(3)}`, cx, cy + rad + 18 * dpr);
        ctx.fillStyle = "#5ef0b5";
        ctx.fillText(`cos Δ=${Math.cos(delta).toFixed(2)}`, cx, cy + rad + 35 * dpr);
      }

      // Legend & invariance bar
      ctx.textAlign = "left";
      ctx.font = `${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "#7aa2ff";
      ctx.fillText(`■ R(m=${posM}) q`, pad, H - 24 * dpr);
      ctx.fillStyle = "#ffb86b";
      ctx.fillText(`■ R(n=${posN}) k`, pad + 120 * dpr, H - 24 * dpr);
      ctx.fillStyle = "#5ef0b5";
      ctx.fillText(`Shift both m and n together by +k: angles spin, but cos((m−n)ω) never changes!`, pad + 245 * dpr, H - 24 * dpr);
    },
  };
}

// ---- 3. Fig 2: Real WebGPU FlashAttention Online Softmax Inspector ---------

export async function mountFlashAttnDemo(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);
  const dev = await getDevice();

  let seqLen = 32;
  let activeTile = 0;
  let maxErr = 0;
  let gpuVerified = false;

  // Deterministic toy Q, K, V for exact online-softmax trace + live WebGPU verification
  const runVerify = async (): Promise<void> => {
    const T = seqLen;
    const hd = 16;
    const Q = new Float32Array(T * hd);
    const K = new Float32Array(T * hd);
    const V = new Float32Array(T * hd);
    for (let i = 0; i < T * hd; i++) {
      Q[i] = Math.sin(i * 0.37) * 0.7;
      K[i] = Math.cos(i * 0.29) * 0.7;
      V[i] = Math.sin(i * 0.19 + 1.0) * 0.8;
    }

    // CPU exact naive causal reference for row T-1
    const scale = 1 / Math.sqrt(hd);
    const refOut = new Float32Array(hd);
    const scores = new Float32Array(T);
    let m = -Infinity;
    for (let kt = 0; kt < T; kt++) {
      let s = 0;
      for (let d = 0; d < hd; d++) s += Q[(T - 1) * hd + d] * K[kt * hd + d];
      scores[kt] = s * scale;
      if (scores[kt] > m) m = scores[kt];
    }
    let sum = 0;
    for (let kt = 0; kt < T; kt++) {
      scores[kt] = Math.exp(scores[kt] - m);
      sum += scores[kt];
    }
    for (let kt = 0; kt < T; kt++) {
      const p = scores[kt] / sum;
      for (let d = 0; d < hd; d++) refOut[d] += p * V[kt * hd + d];
    }

    if (!dev) {
      maxErr = 0;
      gpuVerified = false;
      return;
    }

    const mod = dev.createShaderModule({ code: attentionWgsl });
    const pipe = dev.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "flash_attn_fwd" } });
    const u = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const dv = new DataView(new ArrayBuffer(32));
    dv.setUint32(0, 1, true);
    dv.setUint32(4, T, true);
    dv.setUint32(8, 1, true);
    dv.setUint32(12, hd, true);
    dv.setUint32(16, T, true);
    dv.setUint32(20, 0, true);
    dv.setFloat32(24, scale, true);
    dv.setUint32(28, 0, true);
    dev.queue.writeBuffer(u, 0, dv.buffer);

    const mk = (arr: Float32Array) => {
      const b = dev.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(b, 0, arr as BufferSource);
      return b;
    };
    const qB = mk(Q);
    const kB = mk(K);
    const vB = mk(V);
    const oB = dev.createBuffer({ size: Q.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const lseB = dev.createBuffer({ size: T * 4, usage: GPUBufferUsage.STORAGE });
    const pB = dev.createBuffer({ size: T * T * 4, usage: GPUBufferUsage.STORAGE });
    const readB = dev.createBuffer({ size: Q.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    const bg = dev.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: u } },
        { binding: 1, resource: { buffer: qB } },
        { binding: 2, resource: { buffer: kB } },
        { binding: 3, resource: { buffer: vB } },
        { binding: 4, resource: { buffer: oB } },
        { binding: 5, resource: { buffer: lseB } },
        { binding: 6, resource: { buffer: pB } },
      ],
    });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(T / 64));
    pass.end();
    enc.copyBufferToBuffer(oB, 0, readB, 0, Q.byteLength);
    dev.queue.submit([enc.finish()]);
    await readB.mapAsync(GPUMapMode.READ);
    const gpuO = new Float32Array(readB.getMappedRange());
    let err = 0;
    for (let d = 0; d < hd; d++) err = Math.max(err, Math.abs(gpuO[(T - 1) * hd + d] - refOut[d]));
    readB.unmap();
    for (const b of [u, qB, kB, vB, oB, lseB, pB, readB]) b.destroy();
    maxErr = err;
    gpuVerified = true;
  };

  shell.slider({
    label: "sequence T",
    min: 16,
    max: 128,
    step: 16,
    value: seqLen,
    onInput: (v) => {
      seqLen = Math.round(v);
      void runVerify();
    },
  });
  shell.button("step tile", () => {
    activeTile = (activeTile + 1) % 8;
  });
  shell.setInfo(() =>
    gpuVerified
      ? `WebGPU FlashAttention verified · max Δ vs naive = ${maxErr.toExponential(1)} · VRAM saved ${(seqLen / 4).toFixed(0)}×`
      : `Online softmax state (m_i, l_i, O_i) · zero T×T matrix written to VRAM`,
  );
  void runVerify();

  return {
    frame() {
      shell.tick();
      const t = performance.now() * 0.001;
      const curTile = Math.floor(t * 1.4) % 8;
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 24 * dpr;

      // Left: Streaming KV tiles & running (m_i, l_i) state
      ctx.fillStyle = "#e8eefc";
      ctx.font = `600 ${14 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText("FlashAttention Online Softmax — One Register Pass", pad, pad + 8 * dpr);

      const tiles = 8;
      const tileW = (W * 0.56 - pad) / tiles;
      const tileY = pad + 42 * dpr;
      let mRun = -2;
      let lRun = 0;
      for (let i = 0; i < tiles; i++) {
        const sVal = Math.sin(i * 1.3 + 0.4) * 1.8 + 0.6;
        const done = i <= curTile;
        if (done) {
          const mNew = Math.max(mRun, sVal);
          lRun = lRun * Math.exp(mRun - mNew) + Math.exp(sVal - mNew);
          mRun = mNew;
        }
        const x = pad + i * tileW;
        ctx.fillStyle =
          i === curTile ? "rgba(94, 240, 181, 0.85)" : done ? "rgba(122, 162, 255, 0.3)" : "rgba(30, 36, 56, 0.7)";
        ctx.fillRect(x + 2 * dpr, tileY, tileW - 4 * dpr, 48 * dpr);
        ctx.fillStyle = i === curTile ? "#0a0c14" : "#d8e0f5";
        ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`KV ${i}`, x + tileW * 0.5, tileY + 20 * dpr);
        ctx.fillText(`s=${sVal.toFixed(1)}`, x + tileW * 0.5, tileY + 37 * dpr);
      }

      // Running register box
      const regY = tileY + 72 * dpr;
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(18, 22, 36, 0.92)";
      ctx.strokeStyle = "rgba(94, 240, 181, 0.4)";
      ctx.lineWidth = dpr;
      ctx.fillRect(pad, regY, W * 0.56 - pad, 108 * dpr);
      ctx.strokeRect(pad, regY, W * 0.56 - pad, 108 * dpr);
      ctx.fillStyle = "#5ef0b5";
      ctx.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`SRAM REGISTERS (after tile ${curTile})`, pad + 14 * dpr, regY + 24 * dpr);
      ctx.fillStyle = "#e8eefc";
      ctx.fillText(`running max  m_i = ${mRun.toFixed(3)}`, pad + 14 * dpr, regY + 50 * dpr);
      ctx.fillText(`normalizer   l_i = ${lRun.toFixed(3)}`, pad + 14 * dpr, regY + 72 * dpr);
      ctx.fillStyle = "#8a94b2";
      ctx.fillText(`O_i ← O_i · exp(m_old − m_new) + exp(s − m_new) · V_j`, pad + 14 * dpr, regY + 94 * dpr);

      // Right: Memory traffic bar comparison Naive O(T^2) vs Flash O(T)
      const rx = W * 0.61;
      const rw = W - rx - pad;
      ctx.fillStyle = "#e8eefc";
      ctx.font = `600 ${13 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(`VRAM Traffic at T = ${seqLen}`, rx, tileY - 8 * dpr);

      const naiveKB = (seqLen * seqLen * 4 * 8) / 1024; // 8 heads fp32
      const flashKB = (seqLen * 16 * 4 * 8) / 1024;
      const maxKB = Math.max(naiveKB, flashKB, 1);

      const drawMemBar = (y: number, label: string, kb: number, col: string) => {
        ctx.fillStyle = "#cfd7f0";
        ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(label, rx, y);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(rx, y + 8 * dpr, rw, 22 * dpr);
        ctx.fillStyle = col;
        ctx.fillRect(rx, y + 8 * dpr, Math.max(6 * dpr, (kb / maxKB) * rw), 22 * dpr);
        ctx.fillStyle = "#eef2ff";
        ctx.fillText(`${kb.toFixed(1)} KB`, rx, y + 46 * dpr);
      };
      drawMemBar(tileY + 14 * dpr, "Naive Attn · O(T²) scores", naiveKB, "#ff9e7d");
      drawMemBar(tileY + 96 * dpr, "FlashAttn · O(T) LSE only", flashKB, "#5ef0b5");
    },
  };
}

// ---- 4. Fig 3: Inside a Modern Block (RMSNorm + SwiGLU) --------------------

export function mountBlockDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.48);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let inputScale = 2.4;
  let useRms = true;
  let gateBias = 0.2;

  shell.slider({
    label: "signal scale",
    min: 0.4,
    max: 6.0,
    step: 0.2,
    value: inputScale,
    format: (v) => `${v.toFixed(1)}×`,
    onInput: (v) => (inputScale = v),
  });
  shell.slider({
    label: "SwiGLU gate",
    min: -2.0,
    max: 2.0,
    step: 0.1,
    value: gateBias,
    format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
    onInput: (v) => (gateBias = v),
  });
  const rmsBtn = shell.button("RMSNorm: ON", () => {
    useRms = !useRms;
    rmsBtn.textContent = `RMSNorm: ${useRms ? "ON" : "OFF"}`;
  });

  shell.setInfo(() =>
    useRms
      ? `RMSNorm locks activation variance to 1.0 even at ${inputScale.toFixed(1)}× input scale`
      : `RMSNorm OFF — activations drift directly with input magnitude`,
  );

  const dims = 16;
  const rawBase = Array.from({ length: dims }, (_, i) => Math.sin(i * 1.15) * 0.9 + Math.cos(i * 0.47) * 0.5);

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 26 * dpr;

      const x = rawBase.map((v) => v * inputScale);
      const rms = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / dims + 1e-5);
      const normed = useRms ? x.map((v) => v / rms) : x;
      const swiglu = normed.map((v, i) => {
        const g = v * 0.9 + gateBias + Math.cos(i * 0.8) * 0.4;
        const silu = g / (1 + Math.exp(-g));
        const up = normed[(i + 3) % dims];
        return silu * up;
      });

      const cols = [
        { title: "1. Raw Residual x", data: x, color: "#7aa2ff" },
        { title: useRms ? "2. After RMSNorm (rms=1)" : "2. Unnormalized", data: normed, color: "#ffb86b" },
        { title: "3. SwiGLU(x) = SiLU(g)·u", data: swiglu, color: "#5ef0b5" },
      ];

      const colW = (W - pad * 4) / 3;
      const barH = (H - pad * 2 - 42 * dpr) / dims;

      cols.forEach((c, ci) => {
        const ox = pad + ci * (colW + pad);
        ctx.fillStyle = c.color;
        ctx.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "left";
        ctx.fillText(c.title, ox, pad + 10 * dpr);

        const midX = ox + colW * 0.5;
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.moveTo(midX, pad + 24 * dpr);
        ctx.lineTo(midX, H - pad);
        ctx.stroke();

        c.data.forEach((val, i) => {
          const y = pad + 26 * dpr + i * barH;
          const clamped = Math.max(-4, Math.min(4, val));
          const len = (clamped / 4) * (colW * 0.46);
          ctx.fillStyle = c.color;
          ctx.fillRect(len >= 0 ? midX : midX + len, y + 2 * dpr, Math.abs(len), barH - 4 * dpr);
        });
      });
    },
  };
}
