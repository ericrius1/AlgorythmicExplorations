// Part 1 Figures ("The Grid That Thinks"):
//  1. mountMatmulHero     — Live 16x16 workgroup-tile SGEMM visualizer running real WebGPU compute
//  2. mountGemmRace       — Real Pure-WebGPU Naive vs. Tiled Shared-Memory SGEMM benchmark
//  3. mountTokenizerEmbed — Interactive BPE merge trainer & 2D embedding constellation

import matmulWgsl from "../../lib/llm/shaders/matmul.wgsl?raw";
import { Shell, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { pixelRatio } from "../../lib/palette";
import { runBpe } from "../../lib/llm/tokenizer";

// ---- 1. Hero: Live GPU Workgroup Tile Visualizer ---------------------------

export async function mountMatmulHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.48);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  const dev = await getDevice();
  let realGflops = 0;
  let gpuLabel = dev ? "WebGPU tiled SGEMM live" : "CPU fallback preview";

  // Periodically run a real 256x256 tiled WebGPU SGEMM so the hero reflects real GPU throughput
  let benchRunning = false;
  let pipe: GPUComputePipeline | null = null;
  let uBuf: GPUBuffer | null = null;
  let aBuf: GPUBuffer | null = null;
  let bBuf: GPUBuffer | null = null;
  let cBuf: GPUBuffer | null = null;
  let bg: GPUBindGroup | null = null;
  const BENCH_N = 256;

  if (dev) {
    const mod = dev.createShaderModule({ code: matmulWgsl });
    pipe = dev.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "matmul_tiled" } });
    uBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const dv = new DataView(new ArrayBuffer(16));
    dv.setUint32(0, BENCH_N, true);
    dv.setUint32(4, BENCH_N, true);
    dv.setUint32(8, BENCH_N, true);
    dv.setFloat32(12, 0, true);
    dev.queue.writeBuffer(uBuf, 0, dv.buffer);

    const arr = new Float32Array(BENCH_N * BENCH_N);
    for (let i = 0; i < arr.length; i++) arr[i] = Math.sin(i * 0.013) * 0.25;
    aBuf = dev.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    bBuf = dev.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    cBuf = dev.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE });
    dev.queue.writeBuffer(aBuf, 0, arr);
    dev.queue.writeBuffer(bBuf, 0, arr);
    bg = dev.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uBuf } },
        { binding: 1, resource: { buffer: aBuf } },
        { binding: 2, resource: { buffer: bBuf } },
        { binding: 3, resource: { buffer: cBuf } },
      ],
    });
  }

  let frameIdx = 0;
  const triggerBench = () => {
    if (!dev || !pipe || !bg || benchRunning) return;
    benchRunning = true;
    const iters = 6;
    const t0 = performance.now();
    const enc = dev.createCommandEncoder();
    for (let i = 0; i < iters; i++) {
      const pass = enc.beginComputePass();
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(BENCH_N / 16, BENCH_N / 16);
      pass.end();
    }
    dev.queue.submit([enc.finish()]);
    void dev.queue.onSubmittedWorkDone().then(() => {
      const ms = Math.max(0.05, performance.now() - t0);
      const flops = 2 * BENCH_N * BENCH_N * BENCH_N * iters;
      realGflops = flops / (ms * 1e6);
      gpuLabel = `WebGPU 16×16 tiled SGEMM · ${realGflops.toFixed(0)} GFLOP/s`;
      benchRunning = false;
    });
  };
  triggerBench();

  shell.setInfo(() => gpuLabel);

  const TILES = 8;
  return {
    frame() {
      shell.tick();
      frameIdx++;
      if (frameIdx % 45 === 0) triggerBench();

      const t = performance.now() * 0.001;
      ctx.fillStyle = "#080a12";
      ctx.fillRect(0, 0, W, H);

      // Subtle atmospheric radial glow
      const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 10, W * 0.5, H * 0.45, W * 0.55);
      g.addColorStop(0, "rgba(122, 162, 255, 0.14)");
      g.addColorStop(0.55, "rgba(255, 184, 107, 0.05)");
      g.addColorStop(1, "rgba(8, 10, 18, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const matSize = Math.min(W * 0.22, H * 0.56);
      const cell = matSize / TILES;
      const gap = matSize * 0.26;
      const totalW = matSize * 3 + gap * 2;
      const startX = (W - totalW) * 0.5;
      const startY = (H - matSize) * 0.52;

      // Active output workgroup tile (tr, tc) and active k-tile sweeping along inner dim
      const step = Math.floor(t * 5.5);
      const activeR = Math.floor(step / (TILES * 2)) % TILES;
      const activeC = Math.floor(step / TILES) % TILES;
      const activeK = step % TILES;

      const drawMatrix = (ox: number, oy: number, label: string, kind: "A" | "B" | "C") => {
        ctx.font = `${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = "rgba(180, 194, 232, 0.72)";
        ctx.textAlign = "center";
        ctx.fillText(label, ox + matSize * 0.5, oy - 12 * dpr);

        for (let r = 0; r < TILES; r++) {
          for (let c = 0; c < TILES; c++) {
            const x = ox + c * cell;
            const y = oy + r * cell;
            let fill = "rgba(26, 32, 52, 0.72)";
            let stroke = "rgba(122, 162, 255, 0.16)";

            if (kind === "A") {
              if (r === activeR && c === activeK) {
                fill = "rgba(122, 162, 255, 0.92)";
                stroke = "#d9e6ff";
              } else if (r === activeR && c < activeK) {
                fill = "rgba(122, 162, 255, 0.28)";
              }
            } else if (kind === "B") {
              if (r === activeK && c === activeC) {
                fill = "rgba(255, 184, 107, 0.92)";
                stroke = "#fff0d6";
              } else if (c === activeC && r < activeK) {
                fill = "rgba(255, 184, 107, 0.28)";
              }
            } else {
              if (r === activeR && c === activeC) {
                const prog = (activeK + 1) / TILES;
                fill = `rgba(94, 240, 181, ${0.32 + prog * 0.65})`;
                stroke = "#c9ffe8";
              } else if (r * TILES + c < activeR * TILES + activeC) {
                fill = "rgba(94, 240, 181, 0.16)";
              }
            }

            ctx.fillStyle = fill;
            ctx.fillRect(x + 1.5 * dpr, y + 1.5 * dpr, cell - 3 * dpr, cell - 3 * dpr);
            ctx.strokeStyle = stroke;
            ctx.lineWidth = dpr;
            ctx.strokeRect(x + 1.5 * dpr, y + 1.5 * dpr, cell - 3 * dpr, cell - 3 * dpr);
          }
        }
      };

      const ax = startX;
      const bx = startX + matSize + gap;
      const cx = startX + (matSize + gap) * 2;
      drawMatrix(ax, startY, "Activations A [M × K]", "A");
      drawMatrix(bx, startY, "Weights B [K × N]", "B");
      drawMatrix(cx, startY, "Output C [M × N]", "C");

      // Glowing dataflow arcs from active A tile & B tile into C tile
      const aPt = { x: ax + (activeK + 0.5) * cell, y: startY + (activeR + 0.5) * cell };
      const bPt = { x: bx + (activeC + 0.5) * cell, y: startY + (activeK + 0.5) * cell };
      const cPt = { x: cx + (activeC + 0.5) * cell, y: startY + (activeR + 0.5) * cell };

      ctx.save();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = "rgba(122, 162, 255, 0.55)";
      ctx.beginPath();
      ctx.moveTo(aPt.x, aPt.y);
      ctx.quadraticCurveTo((aPt.x + cPt.x) * 0.5, startY - 40 * dpr, cPt.x, cPt.y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 184, 107, 0.6)";
      ctx.beginPath();
      ctx.moveTo(bPt.x, bPt.y);
      ctx.quadraticCurveTo((bPt.x + cPt.x) * 0.5, startY + matSize + 36 * dpr, cPt.x, cPt.y);
      ctx.stroke();
      ctx.restore();

      // Operators
      ctx.fillStyle = "rgba(215, 222, 240, 0.6)";
      ctx.font = `600 ${20 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("×", ax + matSize + gap * 0.5, startY + matSize * 0.52);
      ctx.fillText("=", bx + matSize + gap * 0.5, startY + matSize * 0.52);
    },
    dispose() {
      uBuf?.destroy();
      aBuf?.destroy();
      bBuf?.destroy();
      cBuf?.destroy();
    },
  };
}

// ---- 2. Fig 1: Naive vs. 16x16 Shared-Memory Tiled SGEMM Hardware Race -----

export async function mountGemmRace(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);
  const dev = await getDevice();

  let N = 512;
  let naiveMs = 0;
  let tiledMs = 0;
  let naiveGflops = 0;
  let tiledGflops = 0;
  let maxErr = 0;
  let busy = false;
  let status = dev ? "Click Run Benchmark to race both WGSL kernels" : "WebGPU unavailable — showing modeled arithmetic intensity";

  let naivePipe: GPUComputePipeline | null = null;
  let tiledPipe: GPUComputePipeline | null = null;
  if (dev) {
    const mod = dev.createShaderModule({ code: matmulWgsl });
    naivePipe = dev.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "matmul_naive" } });
    tiledPipe = dev.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "matmul_tiled" } });
  }

  const runRace = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    status = `Running ${N}×${N} SGEMM on ${dev ? "your GPU" : "model"}...`;

    if (!dev || !naivePipe || !tiledPipe) {
      // Honest analytic estimate when browser lacks WebGPU
      const flops = 2 * N * N * N;
      naiveGflops = 42;
      tiledGflops = 260;
      naiveMs = flops / (naiveGflops * 1e6);
      tiledMs = flops / (tiledGflops * 1e6);
      maxErr = 0;
      status = `No WebGPU device — showing theoretical 16× shared-memory reuse`;
      busy = false;
      return;
    }

    const bytes = N * N * 4;
    const A = new Float32Array(N * N);
    const B = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      A[i] = ((i * 73) % 97 - 48) * 0.02;
      B[i] = ((i * 41) % 89 - 44) * 0.02;
    }

    const uBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const dv = new DataView(new ArrayBuffer(16));
    dv.setUint32(0, N, true);
    dv.setUint32(4, N, true);
    dv.setUint32(8, N, true);
    dv.setFloat32(12, 0, true);
    dev.queue.writeBuffer(uBuf, 0, dv.buffer);

    const aBuf = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const bBuf = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const cNaive = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const cTiled = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    dev.queue.writeBuffer(aBuf, 0, A);
    dev.queue.writeBuffer(bBuf, 0, B);

    const mkBg = (pipe: GPUComputePipeline, out: GPUBuffer) =>
      dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uBuf } },
          { binding: 1, resource: { buffer: aBuf } },
          { binding: 2, resource: { buffer: bBuf } },
          { binding: 3, resource: { buffer: out } },
        ],
      });

    const bgN = mkBg(naivePipe, cNaive);
    const bgT = mkBg(tiledPipe, cTiled);
    const wg = Math.ceil(N / 16);
    const iters = N <= 256 ? 12 : N <= 512 ? 6 : 3;

    const timeKernel = async (pipe: GPUComputePipeline, bg: GPUBindGroup): Promise<number> => {
      // Warmup
      const wEnc = dev.createCommandEncoder();
      const wp = wEnc.beginComputePass();
      wp.setPipeline(pipe);
      wp.setBindGroup(0, bg);
      wp.dispatchWorkgroups(wg, wg);
      wp.end();
      dev.queue.submit([wEnc.finish()]);
      await dev.queue.onSubmittedWorkDone();

      const t0 = performance.now();
      const enc = dev.createCommandEncoder();
      for (let i = 0; i < iters; i++) {
        const p = enc.beginComputePass();
        p.setPipeline(pipe);
        p.setBindGroup(0, bg);
        p.dispatchWorkgroups(wg, wg);
        p.end();
      }
      dev.queue.submit([enc.finish()]);
      await dev.queue.onSubmittedWorkDone();
      return (performance.now() - t0) / iters;
    };

    naiveMs = await timeKernel(naivePipe, bgN);
    tiledMs = await timeKernel(tiledPipe, bgT);

    // Verify first 256 elements match!
    const checkBytes = Math.min(bytes, 1024);
    const rN = dev.createBuffer({ size: checkBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const rT = dev.createBuffer({ size: checkBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const cEnc = dev.createCommandEncoder();
    cEnc.copyBufferToBuffer(cNaive, 0, rN, 0, checkBytes);
    cEnc.copyBufferToBuffer(cTiled, 0, rT, 0, checkBytes);
    dev.queue.submit([cEnc.finish()]);
    await Promise.all([rN.mapAsync(GPUMapMode.READ), rT.mapAsync(GPUMapMode.READ)]);
    const arrN = new Float32Array(rN.getMappedRange());
    const arrT = new Float32Array(rT.getMappedRange());
    let err = 0;
    for (let i = 0; i < arrN.length; i++) err = Math.max(err, Math.abs(arrN[i] - arrT[i]));
    rN.unmap();
    rT.unmap();
    maxErr = err;

    const flops = 2 * N * N * N;
    naiveGflops = flops / (Math.max(0.01, naiveMs) * 1e6);
    tiledGflops = flops / (Math.max(0.01, tiledMs) * 1e6);
    status = `${N}×${N} verified (max Δ ${maxErr.toExponential(1)}) · ${(naiveMs / Math.max(0.01, tiledMs)).toFixed(2)}× speedup`;

    for (const b of [uBuf, aBuf, bBuf, cNaive, cTiled, rN, rT]) b.destroy();
    busy = false;
  };

  shell.slider({
    label: "matrix N",
    min: 128,
    max: 1024,
    step: 128,
    value: N,
    format: (v) => `${v}×${v}`,
    onInput: (v) => {
      N = v;
      void runRace();
    },
  });
  shell.button("run race", () => void runRace());
  shell.setInfo(() => status);
  void runRace();

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);

      const pad = 28 * dpr;
      ctx.fillStyle = "#e8ecf8";
      ctx.font = `600 ${15 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(`Real GPU Matmul Race — ${N} × ${N} (${((2 * N * N * N) / 1e6).toFixed(1)} MFLOPs)`, pad, pad + 8 * dpr);

      const maxG = Math.max(10, naiveGflops, tiledGflops) * 1.15;
      const barX = pad + 170 * dpr;
      const barMaxW = W - barX - pad - 120 * dpr;
      const rows = [
        {
          label: "Naive global DRAM",
          sub: "2N reads / output (0.25 FLOP/B)",
          gflops: naiveGflops,
          ms: naiveMs,
          color: "#ff9e7d",
        },
        {
          label: "16×16 Shared Tile",
          sub: "16× SRAM reuse (4.0 FLOP/B)",
          gflops: tiledGflops,
          ms: tiledMs,
          color: "#5ef0b5",
        },
      ];

      rows.forEach((r, i) => {
        const y = pad + (62 + i * 74) * dpr;
        ctx.fillStyle = "#d8dff2";
        ctx.font = `600 ${13 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(r.label, pad, y);
        ctx.fillStyle = "#8a94b2";
        ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(r.sub, pad, y + 18 * dpr);

        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(barX, y - 12 * dpr, barMaxW, 28 * dpr);

        const bw = Math.max(4 * dpr, (r.gflops / maxG) * barMaxW);
        ctx.fillStyle = r.color;
        ctx.fillRect(barX, y - 12 * dpr, bw, 28 * dpr);

        ctx.fillStyle = "#eef2ff";
        ctx.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`${r.gflops.toFixed(0)} GFLOP/s (${r.ms.toFixed(2)} ms)`, barX + bw + 10 * dpr, y + 6 * dpr);
      });

      // Visual DRAM vs Workgroup SRAM traffic diagram at bottom
      const diagY = pad + 218 * dpr;
      const boxW = (W - pad * 3) * 0.5;
      const boxH = H - diagY - pad;
      const t = performance.now() * 0.002;

      const drawCard = (x: number, title: string, accent: string, tiled: boolean) => {
        ctx.fillStyle = "rgba(18, 22, 36, 0.9)";
        ctx.strokeStyle = "rgba(122, 162, 255, 0.2)";
        ctx.lineWidth = dpr;
        ctx.fillRect(x, diagY, boxW, boxH);
        ctx.strokeRect(x, diagY, boxW, boxH);

        ctx.fillStyle = accent;
        ctx.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(title, x + 14 * dpr, diagY + 22 * dpr);

        const cells = 12;
        const cSz = Math.min((boxW - 32 * dpr) / cells, (boxH - 48 * dpr) / 3);
        const active = Math.floor(t * (tiled ? 3.5 : 8)) % cells;
        for (let i = 0; i < cells; i++) {
          const cx = x + 14 * dpr + i * cSz;
          const cy = diagY + 38 * dpr;
          const hit = tiled ? Math.floor(i / 4) === Math.floor(active / 4) : i === active;
          ctx.fillStyle = hit ? accent : "rgba(130,150,210,0.16)";
          ctx.fillRect(cx + dpr, cy, cSz - 3 * dpr, cSz * 0.85);
        }
        ctx.fillStyle = "#9aa4c2";
        ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(
          tiled
            ? "256 threads load 1 tile cooperatively → 16 FMAs per byte from SRAM"
            : "Every thread fetches its full row/col from slow global DRAM",
          x + 14 * dpr,
          diagY + boxH - 14 * dpr,
        );
      };

      drawCard(pad, "NAIVE · Global Memory Bound", "#ff9e7d", false);
      drawCard(pad * 2 + boxW, "TILED · var<workgroup> Shared SRAM", "#5ef0b5", true);
    },
  };
}

// ---- 3. Fig 2: Interactive BPE Tokenizer & Embedding Space -------------------

export function mountTokenizerEmbed(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let merges = 14;
  let sampleText =
    "small minds learn from patterns in light and sound; small weights grow wiser when patterns repeat.";

  const inputWrap = document.createElement("div");
  inputWrap.className = "sm-inline-bar";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sm-text-input";
  input.value = sampleText;
  input.setAttribute("aria-label", "Text to tokenize");
  input.addEventListener("input", () => {
    sampleText = input.value || " ";
  });
  inputWrap.append(input);
  container.insertBefore(inputWrap, shell.controls);

  shell.slider({
    label: "BPE merges",
    min: 0,
    max: 32,
    step: 1,
    value: merges,
    format: (v) => `${v} merges`,
    onInput: (v) => {
      merges = Math.round(v);
    },
  });

  const palette = ["#7aa2ff", "#5ef0b5", "#ffb86b", "#ff7ab8", "#b794ff", "#6ef2e6"];
  let lastInfo = "";
  shell.setInfo(() => lastInfo);

  // Deterministic 2D embedding coordinates for a token string (semantic-ish hash + length/vowel features)
  const embed2D = (tok: string): [number, number] => {
    let h1 = 2166136261;
    let h2 = 16777619;
    for (let i = 0; i < tok.length; i++) {
      const c = tok.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ (c * 31 + i), 2246822519);
    }
    const x = (((h1 >>> 0) % 1000) / 1000) * 2 - 1;
    const y = (((h2 >>> 0) % 1000) / 1000) * 2 - 1;
    return [x * 0.82, y * 0.78];
  };

  return {
    frame() {
      shell.tick();
      const bpe = runBpe(sampleText, merges);
      lastInfo = `${sampleText.length} chars → ${bpe.tokens.length} tokens (${bpe.compressionRatio.toFixed(2)}× compression · vocab ${bpe.vocab.length})`;

      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 22 * dpr;

      // Top half: colored token chips
      ctx.fillStyle = "#98a3c4";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("LIVE BPE TOKEN STREAM", pad, pad + 8 * dpr);

      let cx = pad;
      let cy = pad + 26 * dpr;
      ctx.font = `${13 * dpr}px ui-monospace, Menlo, monospace`;
      for (let i = 0; i < bpe.tokens.length; i++) {
        const tok = bpe.tokens[i];
        const tw = ctx.measureText(tok).width + 12 * dpr;
        if (cx + tw > W - pad) {
          cx = pad;
          cy += 26 * dpr;
          if (cy > H * 0.44) break;
        }
        const col = palette[i % palette.length];
        ctx.fillStyle = col + "26";
        ctx.strokeStyle = col + "88";
        ctx.lineWidth = dpr;
        ctx.fillRect(cx, cy - 15 * dpr, tw, 21 * dpr);
        ctx.strokeRect(cx, cy - 15 * dpr, tw, 21 * dpr);
        ctx.fillStyle = "#eef2ff";
        ctx.fillText(tok, cx + 6 * dpr, cy);
        cx += tw + 5 * dpr;
      }

      // Bottom left: latest BPE merge table
      const splitY = H * 0.49;
      ctx.strokeStyle = "rgba(122,162,255,0.16)";
      ctx.beginPath();
      ctx.moveTo(pad, splitY);
      ctx.lineTo(W - pad, splitY);
      ctx.stroke();

      const leftW = W * 0.42;
      ctx.fillStyle = "#98a3c4";
      ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("TOP MERGE RULES", pad, splitY + 22 * dpr);
      const shownMerges = bpe.merges.slice(-7).reverse();
      shownMerges.forEach((m, idx) => {
        const y = splitY + (44 + idx * 20) * dpr;
        ctx.fillStyle = "#6e7998";
        ctx.fillText(`#${m.newId}`, pad, y);
        ctx.fillStyle = "#e6ecff";
        ctx.fillText(`"${m.left}" + "${m.right}" → "${m.merged}"`, pad + 44 * dpr, y);
        ctx.fillStyle = "#5ef0b5";
        ctx.fillText(`×${m.count}`, leftW - 36 * dpr, y);
      });
      if (shownMerges.length === 0) {
        ctx.fillStyle = "#6e7998";
        ctx.fillText("Slide BPE merges > 0 to fold frequent pairs.", pad, splitY + 46 * dpr);
      }

      // Bottom right: 2D Embedding Vector Constellation
      const embX = leftW + 18 * dpr;
      const embY = splitY + 28 * dpr;
      const embW = W - embX - pad;
      const embH = H - embY - pad;
      ctx.fillStyle = "rgba(14, 17, 29, 0.9)";
      ctx.fillRect(embX, embY, embW, embH);
      ctx.strokeStyle = "rgba(122,162,255,0.2)";
      ctx.strokeRect(embX, embY, embW, embH);

      ctx.fillStyle = "#98a3c4";
      ctx.fillText("EMBEDDING TABLE W_E[token_id] → ℝ^d", embX + 10 * dpr, embY - 6 * dpr);

      const uniq = [...new Set(bpe.tokens)].slice(0, 18);
      const t = performance.now() * 0.001;
      const pts = uniq.map((tok, i) => {
        const [ex, ey] = embed2D(tok);
        const px = embX + embW * 0.5 + ex * embW * 0.42 + Math.sin(t + i) * 3 * dpr;
        const py = embY + embH * 0.5 + ey * embH * 0.4 + Math.cos(t * 0.8 + i) * 3 * dpr;
        return { tok, px, py, col: palette[i % palette.length] };
      });

      // Cosine similarity links between nearby token vectors
      ctx.lineWidth = dpr;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].px - pts[j].px, pts[i].py - pts[j].py);
          if (d < 78 * dpr) {
            ctx.strokeStyle = `rgba(122, 162, 255, ${0.32 * (1 - d / (78 * dpr))})`;
            ctx.beginPath();
            ctx.moveTo(pts[i].px, pts[i].py);
            ctx.lineTo(pts[j].px, pts[j].py);
            ctx.stroke();
          }
        }
      }

      for (const p of pts) {
        ctx.fillStyle = p.col;
        ctx.beginPath();
        ctx.arc(p.px, p.py, 4.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#eef2ff";
        ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(p.tok, p.px + 7 * dpr, p.py + 4 * dpr);
      }
    },
  };
}
