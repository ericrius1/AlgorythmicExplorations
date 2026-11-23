// Part 4 Figures ("The Browser That Researches Itself"):
//  1. mountAutoResearchHero — Animated commit tree & Pareto frontier of model mutations
//  2. mountKvQuantDemo      — Pure-WebGPU FP32 vs INT8 vs INT4 group-quantized GEMV benchmark
//  3. mountAutoResearchLab  — Real autonomous WebGPU AutoResearch loop (propose -> train -> eval -> keep/discard!)

import quantWgsl from "../../lib/llm/shaders/quant.wgsl?raw";
import { Shell, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { pixelRatio } from "../../lib/palette";
import { CORPORA } from "../../lib/llm/datasets";
import { encodeText } from "../../lib/llm/tokenizer";
import { BrowserAutoResearcher, type SearchStrategy } from "../../lib/llm/autoresearch";

// ---- 1. Hero: Autonomous Research Lineage Tree -----------------------------

export function mountAutoResearchHero(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.46);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  const nodes = [
    { id: 0, parent: -1, bpb: 3.18, kept: true, label: "baseline" },
    { id: 1, parent: 0, bpb: 2.94, kept: true, label: "swiglu" },
    { id: 2, parent: 1, bpb: 3.01, kept: false, label: "wd=0.05" },
    { id: 3, parent: 1, bpb: 2.78, kept: true, label: "muon" },
    { id: 4, parent: 3, bpb: 2.82, kept: false, label: "lr×0.5" },
    { id: 5, parent: 3, bpb: 2.61, kept: true, label: "warmdown" },
    { id: 6, parent: 5, bpb: 2.49, kept: true, label: "θ=1000" },
    { id: 7, parent: 6, bpb: 2.55, kept: false, label: "d=32" },
    { id: 8, parent: 6, bpb: 2.38, kept: true, label: "ffn 3×" },
    { id: 9, parent: 8, bpb: 2.29, kept: true, label: "d=64" },
  ];

  shell.setInfo(() => "Propose → Train on WebGPU → Eval val_bpb → Keep or Revert");

  return {
    frame() {
      shell.tick();
      const t = performance.now() * 0.001;
      ctx.fillStyle = "#080a12";
      ctx.fillRect(0, 0, W, H);

      const padX = W * 0.09;
      const padY = H * 0.2;
      const gw = W - padX * 2;
      const gh = H - padY * 2;
      const pulseIdx = Math.floor(t * 1.4) % nodes.length;

      const ptOf = (idx: number) => {
        const n = nodes[idx];
        const x = padX + (idx / (nodes.length - 1)) * gw;
        const y = padY + (1 - (n.bpb - 2.15) / (3.35 - 2.15)) * gh;
        return { x, y };
      };

      // Edges
      for (const n of nodes) {
        if (n.parent < 0) continue;
        const a = ptOf(n.parent);
        const b = ptOf(n.id);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = n.kept ? "rgba(94, 240, 181, 0.6)" : "rgba(140, 152, 184, 0.24)";
        ctx.lineWidth = (n.kept ? 2.4 : 1.2) * dpr;
        if (!n.kept) ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Nodes
      for (const n of nodes) {
        const p = ptOf(n.id);
        const active = n.id === pulseIdx;
        if (active) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, (13 + Math.sin(t * 8) * 3) * dpr, 0, Math.PI * 2);
          ctx.fillStyle = n.kept ? "rgba(94, 240, 181, 0.18)" : "rgba(255, 158, 125, 0.18)";
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, (n.kept ? 6.5 : 4.5) * dpr, 0, Math.PI * 2);
        ctx.fillStyle = n.kept ? "#5ef0b5" : "#6d7898";
        ctx.fill();

        ctx.fillStyle = n.kept ? "#e8eefc" : "#7782a4";
        ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(n.label, p.x, p.y - 12 * dpr);
        ctx.fillStyle = n.kept ? "#5ef0b5" : "#5e6885";
        ctx.fillText(n.bpb.toFixed(2), p.x, p.y + 20 * dpr);
      }
    },
  };
}

// ---- 2. Fig 1: Pure-WebGPU FP32 / INT8 / INT4 Quantized GEMV Lab -----------

export async function mountKvQuantDemo(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);
  const dev = await getDevice();

  let dim = 1024;
  const groupSize = 32;
  let busy = false;
  let results = {
    fp32Ms: 0,
    q8Ms: 0,
    q4Ms: 0,
    q8Rmse: 0,
    q4Rmse: 0,
    fp32KB: 0,
    q8KB: 0,
    q4KB: 0,
  };
  let status = "Running WebGPU quantized decode benchmark...";

  let pFp32: GPUComputePipeline | null = null;
  let pQ8: GPUComputePipeline | null = null;
  let pQ4: GPUComputePipeline | null = null;
  if (dev) {
    const mod = dev.createShaderModule({ code: quantWgsl });
    pFp32 = dev.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "gemv_fp32" } });
    pQ8 = dev.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "gemv_int8" } });
    pQ4 = dev.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "gemv_int4" } });
  }

  const runBench = async () => {
    if (busy) return;
    busy = true;
    const rows = dim;
    const cols = dim;
    const groupsPerRow = cols / groupSize;

    const wf = new Float32Array(rows * cols);
    const xf = new Float32Array(cols);
    for (let i = 0; i < cols; i++) xf[i] = Math.sin(i * 0.13) * 0.6;
    for (let i = 0; i < wf.length; i++) wf[i] = Math.sin(i * 0.037) * Math.cos(i * 0.011) * 0.5;

    // Pack group-wise INT8 (4 bytes/u32) and INT4 (8 nibbles/u32)
    const q8Words = new Uint32Array((rows * cols) / 4);
    const q8Scales = new Float32Array(rows * groupsPerRow);
    const q4Words = new Uint32Array((rows * cols) / 8);
    const q4Scales = new Float32Array(rows * groupsPerRow);

    for (let r = 0; r < rows; r++) {
      for (let g = 0; g < groupsPerRow; g++) {
        let maxAbs = 1e-6;
        const c0 = r * cols + g * groupSize;
        for (let k = 0; k < groupSize; k++) maxAbs = Math.max(maxAbs, Math.abs(wf[c0 + k]));
        const s8 = maxAbs / 127;
        const s4 = maxAbs / 7;
        q8Scales[r * groupsPerRow + g] = s8;
        q4Scales[r * groupsPerRow + g] = s4;

        for (let k = 0; k < groupSize; k += 4) {
          let word = 0;
          for (let lane = 0; lane < 4; lane++) {
            const q = Math.max(-127, Math.min(127, Math.round(wf[c0 + k + lane] / s8)));
            word |= (q & 0xff) << (lane * 8);
          }
          q8Words[(c0 + k) / 4] = word >>> 0;
        }
        for (let k = 0; k < groupSize; k += 8) {
          let word = 0;
          for (let lane = 0; lane < 8; lane++) {
            const q = Math.max(-8, Math.min(7, Math.round(wf[c0 + k + lane] / s4))) + 8;
            word |= (q & 0xf) << (lane * 4);
          }
          q4Words[(c0 + k) / 8] = word >>> 0;
        }
      }
    }

    results.fp32KB = wf.byteLength / 1024;
    results.q8KB = (q8Words.byteLength + q8Scales.byteLength) / 1024;
    results.q4KB = (q4Words.byteLength + q4Scales.byteLength) / 1024;

    if (!dev || !pFp32 || !pQ8 || !pQ4) {
      results.fp32Ms = 0.85;
      results.q8Ms = 0.28;
      results.q4Ms = 0.16;
      results.q8Rmse = 0.0021;
      results.q4Rmse = 0.034;
      status = `No WebGPU device — showing packed sizes (${(results.fp32KB / results.q4KB).toFixed(1)}× smaller in INT4)`;
      busy = false;
      return;
    }

    const u = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const dv = new DataView(new ArrayBuffer(16));
    dv.setUint32(0, rows, true);
    dv.setUint32(4, cols, true);
    dv.setUint32(8, groupSize, true);
    dev.queue.writeBuffer(u, 0, dv.buffer);

    const mk = (arr: Float32Array | Uint32Array) => {
      const b = dev.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(b, 0, arr as BufferSource);
      return b;
    };
    const bWf = mk(wf);
    const bX = mk(xf);
    const bQ8 = mk(q8Words);
    const bS8 = mk(q8Scales);
    const bQ4 = mk(q4Words);
    const bS4 = mk(q4Scales);
    const yFp32 = dev.createBuffer({ size: rows * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const yQ8 = dev.createBuffer({ size: rows * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const yQ4 = dev.createBuffer({ size: rows * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

    const bgFp = dev.createBindGroup({
      layout: pFp32.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: u } },
        { binding: 1, resource: { buffer: bWf } },
        { binding: 2, resource: { buffer: bX } },
        { binding: 3, resource: { buffer: yFp32 } },
      ],
    });
    const bg8 = dev.createBindGroup({
      layout: pQ8.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: u } },
        { binding: 1, resource: { buffer: bQ8 } },
        { binding: 2, resource: { buffer: bS8 } },
        { binding: 3, resource: { buffer: bX } },
        { binding: 4, resource: { buffer: yQ8 } },
      ],
    });
    const bg4 = dev.createBindGroup({
      layout: pQ4.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: u } },
        { binding: 1, resource: { buffer: bQ4 } },
        { binding: 2, resource: { buffer: bS4 } },
        { binding: 3, resource: { buffer: bX } },
        { binding: 4, resource: { buffer: yQ4 } },
      ],
    });

    const iters = 16;
    const wg = Math.ceil(rows / 64);
    const timeOne = async (pipe: GPUComputePipeline, bg: GPUBindGroup): Promise<number> => {
      const t0 = performance.now();
      const enc = dev.createCommandEncoder();
      for (let i = 0; i < iters; i++) {
        const p = enc.beginComputePass();
        p.setPipeline(pipe);
        p.setBindGroup(0, bg);
        p.dispatchWorkgroups(wg);
        p.end();
      }
      dev.queue.submit([enc.finish()]);
      await dev.queue.onSubmittedWorkDone();
      return (performance.now() - t0) / iters;
    };

    results.fp32Ms = await timeOne(pFp32, bgFp);
    results.q8Ms = await timeOne(pQ8, bg8);
    results.q4Ms = await timeOne(pQ4, bg4);

    // Read back outputs to compute exact quantization RMSE!
    const r0 = dev.createBuffer({ size: rows * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const r8 = dev.createBuffer({ size: rows * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const r4 = dev.createBuffer({ size: rows * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const cEnc = dev.createCommandEncoder();
    cEnc.copyBufferToBuffer(yFp32, 0, r0, 0, rows * 4);
    cEnc.copyBufferToBuffer(yQ8, 0, r8, 0, rows * 4);
    cEnc.copyBufferToBuffer(yQ4, 0, r4, 0, rows * 4);
    dev.queue.submit([cEnc.finish()]);
    await Promise.all([r0.mapAsync(GPUMapMode.READ), r8.mapAsync(GPUMapMode.READ), r4.mapAsync(GPUMapMode.READ)]);
    const a0 = new Float32Array(r0.getMappedRange());
    const a8 = new Float32Array(r8.getMappedRange());
    const a4 = new Float32Array(r4.getMappedRange());
    let s8 = 0;
    let s4 = 0;
    for (let i = 0; i < rows; i++) {
      s8 += (a8[i] - a0[i]) ** 2;
      s4 += (a4[i] - a0[i]) ** 2;
    }
    results.q8Rmse = Math.sqrt(s8 / rows);
    results.q4Rmse = Math.sqrt(s4 / rows);
    r0.unmap();
    r8.unmap();
    r4.unmap();

    for (const b of [u, bWf, bX, bQ8, bS8, bQ4, bS4, yFp32, yQ8, yQ4, r0, r8, r4]) b.destroy();
    status = `WebGPU ${dim}×${dim} decode GEMV · INT4 saves ${(results.fp32KB / results.q4KB).toFixed(1)}× VRAM · RMSE ${results.q4Rmse.toFixed(4)}`;
    busy = false;
  };

  shell.slider({
    label: "weight dim",
    min: 512,
    max: 2048,
    step: 512,
    value: dim,
    format: (v) => `${v}×${v}`,
    onInput: (v) => {
      dim = Math.round(v);
      void runBench();
    },
  });
  shell.button("benchmark", () => void runBench());
  shell.setInfo(() => status);
  void runBench();

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 26 * dpr;

      ctx.fillStyle = "#e8eefc";
      ctx.font = `600 ${14 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(`On-the-Fly WGSL Dequantization — ${dim}×${dim} Decode GEMV (group size 32)`, pad, pad + 8 * dpr);

      const rows = [
        { name: "FP32 (32-bit)", kb: results.fp32KB, ms: results.fp32Ms, rmse: 0, col: "#7aa2ff" },
        { name: "INT8 (packed 4/u32)", kb: results.q8KB, ms: results.q8Ms, rmse: results.q8Rmse, col: "#ffb86b" },
        { name: "INT4 (packed 8/u32)", kb: results.q4KB, ms: results.q4Ms, rmse: results.q4Rmse, col: "#5ef0b5" },
      ];
      const maxKB = Math.max(1, results.fp32KB);
      const barX = pad + 175 * dpr;
      const barW = W - barX - pad - 140 * dpr;

      rows.forEach((r, i) => {
        const y = pad + (58 + i * 58) * dpr;
        ctx.fillStyle = "#d8e0f5";
        ctx.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(r.name, pad, y);
        ctx.fillStyle = "#7e88a8";
        ctx.font = `${10.5 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(i === 0 ? "reference" : `RMSE ${r.rmse.toFixed(4)}`, pad, y + 16 * dpr);

        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(barX, y - 10 * dpr, barW, 24 * dpr);
        const w = Math.max(8 * dpr, (r.kb / maxKB) * barW);
        ctx.fillStyle = r.col;
        ctx.fillRect(barX, y - 10 * dpr, w, 24 * dpr);

        ctx.fillStyle = "#eef2ff";
        ctx.fillText(`${(r.kb / 1024).toFixed(2)} MB · ${r.ms.toFixed(2)} ms`, barX + w + 10 * dpr, y + 6 * dpr);
      });

      // Bit-packing schematic at bottom
      const by = H - 82 * dpr;
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("ONE 32-BIT GPU REGISTER WORD IN INT4 = 8 WEIGHTS UNPACKED IN PARALLEL", pad, by - 10 * dpr);
      const nibW = (W - pad * 2) / 8;
      for (let i = 0; i < 8; i++) {
        const x = pad + i * nibW;
        ctx.fillStyle = i % 2 === 0 ? "rgba(94, 240, 181, 0.2)" : "rgba(122, 162, 255, 0.2)";
        ctx.strokeStyle = "rgba(94, 240, 181, 0.55)";
        ctx.lineWidth = dpr;
        ctx.fillRect(x + 2 * dpr, by, nibW - 4 * dpr, 36 * dpr);
        ctx.strokeRect(x + 2 * dpr, by, nibW - 4 * dpr, 36 * dpr);
        ctx.fillStyle = "#eef2ff";
        ctx.textAlign = "center";
        ctx.fillText(`w${i} (4b)`, x + nibW * 0.5, by + 22 * dpr);
      }
    },
  };
}

// ---- 3. Fig 2: Full Browser AutoResearch Workbench -------------------------

export function mountAutoResearchLab(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.54);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let corpusIdx = 1; // Nature Haiku converges super fast and visibly!
  let strategy: SearchStrategy = "ucb-bandit";
  let autoRun = false;
  let runningTrial = false;
  let progressLine = "Click 'Run 1 Experiment' or 'Auto-Research' to start autonomous WebGPU search";

  const researcher = new BrowserAutoResearcher(encodeText(CORPORA[corpusIdx].text), { stepsPerTrial: 36, seqLen: 40 });

  const logPanel = document.createElement("div");
  logPanel.className = "sm-research-panel";
  logPanel.innerHTML = `
    <div class="sm-row">
      <div class="sm-chip-group" data-strats></div>
      <span class="sm-badge" data-best>Best val_bpb: —</span>
    </div>
    <div class="sm-research-log" data-log></div>
  `;
  container.insertBefore(logPanel, shell.controls);

  const stratsEl = logPanel.querySelector<HTMLElement>("[data-strats]")!;
  const bestEl = logPanel.querySelector<HTMLElement>("[data-best]")!;
  const logEl = logPanel.querySelector<HTMLElement>("[data-log]")!;

  const stratList: { id: SearchStrategy; label: string }[] = [
    { id: "hill-climb", label: "Hill Climb" },
    { id: "ucb-bandit", label: "UCB Bandit" },
    { id: "evolutionary", label: "Evolutionary" },
  ];
  stratList.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sm-chip" + (s.id === strategy ? " is-active" : "");
    b.textContent = s.label;
    b.addEventListener("click", () => {
      strategy = s.id;
      stratsEl.querySelectorAll(".sm-chip").forEach((el) => el.classList.toggle("is-active", el === b));
    });
    stratsEl.appendChild(b);
  });

  const renderLog = () => {
    const best = researcher.bestNode;
    bestEl.textContent = best
      ? `Best: #${best.id} · ${best.valBpb.toFixed(3)} bpb (${best.genome.activation}/${best.genome.optimizer}, d=${best.genome.dModel})`
      : "Best val_bpb: —";

    logEl.replaceChildren();
    for (const n of researcher.history.slice(-6).reverse()) {
      const row = document.createElement("div");
      row.className = `sm-exp-row is-${n.status}`;
      const badge = n.status === "kept" ? "KEEP" : n.status === "baseline" ? "BASE" : "DROP";
      const deltaStr = n.status === "baseline" ? "" : `${n.deltaBpb >= 0 ? "+" : ""}${n.deltaBpb.toFixed(3)} bpb`;
      row.innerHTML = `
        <span class="sm-exp-badge">${badge} #${n.id}</span>
        <span class="sm-exp-diff"></span>
        <span class="sm-exp-score">${n.valBpb.toFixed(3)} bpb <em>${deltaStr}</em></span>
      `;
      row.querySelector(".sm-exp-diff")!.textContent = `${n.diff} — ${n.hypothesis}`;
      logEl.appendChild(row);
    }
  };

  const stepExperiment = async () => {
    if (runningTrial) return;
    runningTrial = true;
    try {
      const node = await researcher.runOneExperiment(strategy, {
        onProgress: (step, total, loss) => {
          progressLine = `Running trial #${researcher.history.length + 1} (${strategy}) · step ${step}/${total} · train loss ${loss.toFixed(3)}`;
        },
      });
      progressLine = `Trial #${node.id} ${node.status.toUpperCase()}: ${node.diff} → val ${node.valBpb.toFixed(3)} bpb (${node.wallMs.toFixed(0)} ms on ${node.backend})`;
      renderLog();
    } finally {
      runningTrial = false;
    }
  };

  const autoBtn = shell.button("auto-research", () => {
    autoRun = !autoRun;
    autoBtn.textContent = autoRun ? "stop auto" : "auto-research";
  });
  shell.button("run 1 experiment", () => void stepExperiment());
  const corpusBtn = shell.button(`corpus: ${CORPORA[corpusIdx].label}`, () => {
    corpusIdx = (corpusIdx + 1) % CORPORA.length;
    corpusBtn.textContent = `corpus: ${CORPORA[corpusIdx].label}`;
    researcher.reset();
    researcher.setCorpus(encodeText(CORPORA[corpusIdx].text));
    renderLog();
  });
  shell.button("reset tree", () => {
    autoRun = false;
    autoBtn.textContent = "auto-research";
    researcher.reset();
    renderLog();
  });

  shell.setInfo(() => progressLine);

  return {
    frame() {
      shell.tick();
      if (autoRun && !runningTrial) {
        void stepExperiment();
      }

      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 28 * dpr;
      const gw = W - pad * 2;
      const gh = H - pad * 2 - 22 * dpr;
      const y0 = pad + 18 * dpr;

      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("AUTONOMOUS EXPERIMENT TREE · VALIDATION BITS PER BYTE (LOWER IS BETTER)", pad, pad + 6 * dpr);

      ctx.fillStyle = "rgba(15, 19, 32, 0.9)";
      ctx.fillRect(pad, y0, gw, gh);
      ctx.strokeStyle = "rgba(122, 162, 255, 0.2)";
      ctx.lineWidth = dpr;
      ctx.strokeRect(pad, y0, gw, gh);

      const hist = researcher.history;
      if (hist.length === 0) {
        ctx.fillStyle = "#7a85a6";
        ctx.font = `${13 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText("Press 'Auto-Research' or 'Run 1 Experiment' to watch your GPU evolve better LLMs.", pad + 26 * dpr, y0 + gh * 0.5);
        return;
      }

      const bpbs = hist.map((h) => h.valBpb);
      const minB = Math.min(...bpbs) - 0.15;
      const maxB = Math.max(...bpbs) + 0.15;
      const span = Math.max(0.2, maxB - minB);

      const coords = hist.map((n, i) => ({
        n,
        x: pad + 32 * dpr + (i / Math.max(1, hist.length - 1)) * (gw - 64 * dpr),
        y: y0 + 24 * dpr + (1 - (n.valBpb - minB) / span) * (gh - 48 * dpr),
      }));

      // Best-so-far staircase frontier
      ctx.beginPath();
      let runBest = Infinity;
      coords.forEach((c, i) => {
        runBest = Math.min(runBest, c.n.valBpb);
        const fy = y0 + 24 * dpr + (1 - (runBest - minB) / span) * (gh - 48 * dpr);
        if (i === 0) ctx.moveTo(c.x, fy);
        else ctx.lineTo(c.x, fy);
      });
      ctx.strokeStyle = "rgba(94, 240, 181, 0.35)";
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();

      // Parent-child edges
      for (const c of coords) {
        if (!c.n.parentId) continue;
        const p = coords.find((o) => o.n.id === c.n.parentId);
        if (!p) continue;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(c.x, c.y);
        ctx.strokeStyle = c.n.status === "kept" ? "#5ef0b5" : "rgba(130, 144, 178, 0.3)";
        ctx.lineWidth = (c.n.status === "kept" ? 2.2 : 1.1) * dpr;
        if (c.n.status === "discarded") ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Nodes
      for (const c of coords) {
        const isBest = researcher.bestNode?.id === c.n.id;
        ctx.beginPath();
        ctx.arc(c.x, c.y, (isBest ? 8 : c.n.status === "discarded" ? 4.5 : 6) * dpr, 0, Math.PI * 2);
        ctx.fillStyle =
          c.n.status === "baseline" ? "#7aa2ff" : c.n.status === "kept" ? "#5ef0b5" : "#6c7696";
        ctx.fill();
        if (isBest) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 * dpr;
          ctx.stroke();
        }
        ctx.fillStyle = c.n.status === "discarded" ? "#6d7898" : "#e8eefc";
        ctx.font = `${10.5 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`#${c.n.id} ${c.n.mutationAxis}`, c.x, c.y - 11 * dpr);
      }
    },
    dispose() {
      autoRun = false;
    },
  };
}
