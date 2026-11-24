// Pure WebGPU Micro-Transformer Engine (forward, backward, FlashAttention,
// RMSNorm, RoPE, SwiGLU/GELU, AdamW/Muon, KV-cached decode) built from first
// principles with raw WGSL compute shaders — zero ML libraries.
// Includes an automatic pure-TypeScript Float32Array fallback when WebGPU is absent.

import matmulWgsl from "./shaders/matmul.wgsl?raw";
import opsWgsl from "./shaders/ops.wgsl?raw";
import attentionWgsl from "./shaders/attention.wgsl?raw";
import { getDevice } from "../gpu";
import { VOCAB_SIZE } from "./tokenizer";

export type ActivationKind = "swiglu" | "gelu";
export type OptimizerKind = "adamw" | "muon";

export interface ModelConfig {
  vocabSize: number;
  seqLen: number;
  dModel: number;
  nLayers: number;
  nHeads: number;
  ffnDim: number;
  activation: ActivationKind;
  optimizer: OptimizerKind;
  lr: number;
  weightDecay: number;
  ropeTheta: number;
  batchSize: number;
  seed?: number;
}

export const DEFAULT_CONFIG: ModelConfig = {
  vocabSize: VOCAB_SIZE,
  seqLen: 48,
  dModel: 64,
  nLayers: 2,
  nHeads: 4,
  ffnDim: 128,
  activation: "swiglu",
  optimizer: "adamw",
  lr: 0.008,
  weightDecay: 0.01,
  ropeTheta: 10000,
  batchSize: 4,
  seed: 1337,
};

export interface StepMetrics {
  step: number;
  loss: number;
  bpb: number;
  stepMs: number;
  tokPerSec: number;
}

export interface GenerateOptions {
  maxNewTokens: number;
  temperature?: number;
  topP?: number;
  stopTokenIds?: number[];
  onToken?: (tokenId: number, stepMs: number) => void;
}

export interface GenerateResult {
  tokens: number[];
  tokPerSec: number;
  avgMsPerToken: number;
  lastAttention: Float32Array | null; // T x T from layer 0 head 0
}

export interface MicroLLM {
  readonly backend: "webgpu" | "cpu-fallback";
  readonly config: ModelConfig;
  readonly paramCount: number;
  readonly gpuBytes: number;
  stepCount: number;
  trainStep(inputIds: Uint32Array, targetIds: Uint32Array, lrOverride?: number): Promise<StepMetrics>;
  evalLoss(inputIds: Uint32Array, targetIds: Uint32Array): Promise<{ loss: number; bpb: number }>;
  forwardLogits(inputIds: Uint32Array): Promise<{ logits: Float32Array; attention: Float32Array | null }>;
  generate(promptIds: Uint32Array, opts: GenerateOptions): Promise<GenerateResult>;
  exportWeights(): Promise<Float32Array>;
  importWeights(weights: Float32Array): void;
  dispose(): void;
}

// Deterministic PRNG (Mulberry32) so comparisons & AutoResearch are reproducible
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initNormal(len: number, std: number, rng: () => number): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 2) {
    const u1 = Math.max(1e-7, rng());
    const u2 = rng();
    const mag = Math.sqrt(-2 * Math.log(u1)) * std;
    const z0 = mag * Math.cos(2 * Math.PI * u2);
    const z1 = mag * Math.sin(2 * Math.PI * u2);
    out[i] = z0;
    if (i + 1 < len) out[i + 1] = z1;
  }
  return out;
}

function initOnes(len: number): Float32Array {
  const out = new Float32Array(len);
  out.fill(1);
  return out;
}

export function sampleFromLogits(
  logits: Float32Array,
  offset: number,
  vocabSize: number,
  temperature = 0.8,
  topP = 0.9,
): number {
  const t = Math.max(0.05, temperature);
  let maxV = -Infinity;
  for (let i = 0; i < vocabSize; i++) {
    const v = logits[offset + i] / t;
    if (v > maxV) maxV = v;
  }
  const probs = new Float32Array(vocabSize);
  let sum = 0;
  for (let i = 0; i < vocabSize; i++) {
    const e = Math.exp(logits[offset + i] / t - maxV);
    probs[i] = e;
    sum += e;
  }
  const inv = 1 / Math.max(sum, 1e-12);
  const idx = Array.from({ length: vocabSize }, (_, i) => i);
  for (let i = 0; i < vocabSize; i++) probs[i] *= inv;
  idx.sort((a, b) => probs[b] - probs[a]);

  let cum = 0;
  let cut = vocabSize;
  for (let i = 0; i < vocabSize; i++) {
    cum += probs[idx[i]];
    if (cum >= topP) {
      cut = i + 1;
      break;
    }
  }
  let r = Math.random() * cum;
  for (let i = 0; i < cut; i++) {
    r -= probs[idx[i]];
    if (r <= 0) return idx[i];
  }
  return idx[0];
}

// ============================================================================
// Pure WebGPU Pipeline Cache (compiled once per GPUDevice)
// ============================================================================

interface Pipelines {
  matmulNaive: GPUComputePipeline;
  matmulTiled: GPUComputePipeline;
  matmulNT: GPUComputePipeline;
  matmulTN: GPUComputePipeline;
  embedFwd: GPUComputePipeline;
  embedBwd: GPUComputePipeline;
  rmsFwd: GPUComputePipeline;
  rmsBwdX: GPUComputePipeline;
  rmsBwdW: GPUComputePipeline;
  ropeApply: GPUComputePipeline;
  gatedActFwd: GPUComputePipeline;
  gatedActBwd: GPUComputePipeline;
  vecAdd: GPUComputePipeline;
  vecAddInplace: GPUComputePipeline;
  vecZero: GPUComputePipeline;
  ceFwdBwd: GPUComputePipeline;
  optStep: GPUComputePipeline;
  flashFwd: GPUComputePipeline;
  flashBwdQ: GPUComputePipeline;
  flashBwdKV: GPUComputePipeline;
}

const pipelineCache = new WeakMap<GPUDevice, Pipelines>();

function getPipelines(dev: GPUDevice): Pipelines {
  let cached = pipelineCache.get(dev);
  if (cached) return cached;

  const mMod = dev.createShaderModule({ code: matmulWgsl, label: "llm-matmul" });
  const oMod = dev.createShaderModule({ code: opsWgsl, label: "llm-ops" });
  const aMod = dev.createShaderModule({ code: attentionWgsl, label: "llm-attention" });

  const mk = (module: GPUShaderModule, entryPoint: string) =>
    dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint } });

  cached = {
    matmulNaive: mk(mMod, "matmul_naive"),
    matmulTiled: mk(mMod, "matmul_tiled"),
    matmulNT: mk(mMod, "matmul_nt"),
    matmulTN: mk(mMod, "matmul_tn"),
    embedFwd: mk(oMod, "embed_fwd"),
    embedBwd: mk(oMod, "embed_bwd"),
    rmsFwd: mk(oMod, "rmsnorm_fwd"),
    rmsBwdX: mk(oMod, "rmsnorm_bwd_x"),
    rmsBwdW: mk(oMod, "rmsnorm_bwd_w"),
    ropeApply: mk(oMod, "rope_apply"),
    gatedActFwd: mk(oMod, "gated_act_fwd"),
    gatedActBwd: mk(oMod, "gated_act_bwd"),
    vecAdd: mk(oMod, "vec_add"),
    vecAddInplace: mk(oMod, "vec_add_inplace"),
    vecZero: mk(oMod, "vec_zero"),
    ceFwdBwd: mk(oMod, "cross_entropy_fwd_bwd"),
    optStep: mk(oMod, "optimizer_step"),
    flashFwd: mk(aMod, "flash_attn_fwd"),
    flashBwdQ: mk(aMod, "flash_attn_bwd_dq"),
    flashBwdKV: mk(aMod, "flash_attn_bwd_dkv"),
  };
  pipelineCache.set(dev, cached);
  return cached;
}

// ============================================================================
// Pure WebGPU Micro-Transformer Implementation
// ============================================================================

interface ParamSlot {
  name: string;
  size: number;
  w: GPUBuffer;
  g: GPUBuffer;
  m: GPUBuffer;
  v: GPUBuffer;
}

interface LayerBuffers {
  rms1W: ParamSlot;
  wq: ParamSlot;
  wk: ParamSlot;
  wv: ParamSlot;
  wo: ParamSlot;
  rms2W: ParamSlot;
  w1: ParamSlot; // gate [ffnDim, dModel]
  w3: ParamSlot; // up   [ffnDim, dModel]
  w2: ParamSlot; // down [dModel, ffnDim]

  // Saved forward activations for backprop
  xIn: GPUBuffer;
  xNorm1: GPUBuffer;
  rms1Inv: GPUBuffer;
  q: GPUBuffer;
  k: GPUBuffer;
  v: GPUBuffer;
  attnOut: GPUBuffer;
  lse: GPUBuffer;
  attnProj: GPUBuffer;
  xMid: GPUBuffer;
  xNorm2: GPUBuffer;
  rms2Inv: GPUBuffer;
  gate: GPUBuffer;
  up: GPUBuffer;
  ffnAct: GPUBuffer;
  ffnOut: GPUBuffer;
}

class WebGpuMicroLLM implements MicroLLM {
  readonly backend = "webgpu" as const;
  readonly config: ModelConfig;
  readonly paramCount: number;
  readonly gpuBytes: number;
  stepCount = 0;

  private dev: GPUDevice;
  private p: Pipelines;
  private params: ParamSlot[] = [];
  private allBuffers: GPUBuffer[] = [];
  private uniformPool: GPUBuffer[] = [];
  private uniformCursor = 0;

  private wEmbed: ParamSlot;
  private rmsFinalW: ParamSlot;
  private wHead: ParamSlot;
  private layers: LayerBuffers[] = [];

  // Shared token & scratch buffers
  private inIdsBuf: GPUBuffer;
  private tgtIdsBuf: GPUBuffer;
  private xFinal: GPUBuffer;
  private xFinalNorm: GPUBuffer;
  private rmsFinalInv: GPUBuffer;
  private logitsBuf: GPUBuffer;
  private dLogitsBuf: GPUBuffer;
  private lossesBuf: GPUBuffer;
  private lossReadBuf: GPUBuffer;
  private logitsReadBuf: GPUBuffer;
  private attnProbsBuf: GPUBuffer;
  private attnProbsReadBuf: GPUBuffer;

  // Backward scratch
  private dStream: GPUBuffer;
  private dNorm: GPUBuffer;
  private dTmp: GPUBuffer;
  private dQ: GPUBuffer;
  private dK: GPUBuffer;
  private dV: GPUBuffer;
  private dAttnOut: GPUBuffer;
  private dGate: GPUBuffer;
  private dUp: GPUBuffer;
  private dFfnAct: GPUBuffer;

  private bytesAllocated = 0;

  constructor(dev: GPUDevice, cfg: ModelConfig) {
    this.dev = dev;
    this.config = { ...cfg };
    this.p = getPipelines(dev);

    const { vocabSize: V, seqLen: T, dModel: D, nLayers, nHeads, ffnDim: F, batchSize: B } = cfg;
    const N = B * T;
    const rng = mulberry32(cfg.seed ?? 1337);
    const std = 1 / Math.sqrt(D);
    const resStd = std / Math.sqrt(2 * nLayers);

    // Pre-allocate uniform ring (enough for an entire fwd+bwd+opt command encoder!)
    const maxUniforms = 64 + nLayers * 64;
    for (let i = 0; i < maxUniforms; i++) {
      this.uniformPool.push(this.mkBuf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST));
    }

    this.wEmbed = this.mkParam("wEmbed", initNormal(V * D, 0.04, rng));
    for (let l = 0; l < nLayers; l++) {
      this.layers.push({
        rms1W: this.mkParam(`l${l}.rms1`, initOnes(D)),
        wq: this.mkParam(`l${l}.wq`, initNormal(D * D, std, rng)),
        wk: this.mkParam(`l${l}.wk`, initNormal(D * D, std, rng)),
        wv: this.mkParam(`l${l}.wv`, initNormal(D * D, std, rng)),
        wo: this.mkParam(`l${l}.wo`, initNormal(D * D, resStd, rng)),
        rms2W: this.mkParam(`l${l}.rms2`, initOnes(D)),
        w1: this.mkParam(`l${l}.w1`, initNormal(F * D, std, rng)),
        w3: this.mkParam(`l${l}.w3`, initNormal(F * D, std, rng)),
        w2: this.mkParam(`l${l}.w2`, initNormal(D * F, resStd, rng)),

        xIn: this.mkStorage(N * D),
        xNorm1: this.mkStorage(N * D),
        rms1Inv: this.mkStorage(N),
        q: this.mkStorage(N * D),
        k: this.mkStorage(N * D),
        v: this.mkStorage(N * D),
        attnOut: this.mkStorage(N * D),
        lse: this.mkStorage(B * nHeads * T),
        attnProj: this.mkStorage(N * D),
        xMid: this.mkStorage(N * D),
        xNorm2: this.mkStorage(N * D),
        rms2Inv: this.mkStorage(N),
        gate: this.mkStorage(N * F),
        up: this.mkStorage(N * F),
        ffnAct: this.mkStorage(N * F),
        ffnOut: this.mkStorage(N * D),
      });
    }
    this.rmsFinalW = this.mkParam("rmsFinal", initOnes(D));
    this.wHead = this.mkParam("wHead", initNormal(V * D, std * 0.5, rng));

    this.inIdsBuf = this.mkBuf(N * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.tgtIdsBuf = this.mkBuf(N * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.xFinal = this.mkStorage(N * D);
    this.xFinalNorm = this.mkStorage(N * D);
    this.rmsFinalInv = this.mkStorage(N);
    this.logitsBuf = this.mkBuf(N * V * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.dLogitsBuf = this.mkStorage(N * V);
    this.lossesBuf = this.mkBuf(N * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.lossReadBuf = this.mkBuf(N * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.logitsReadBuf = this.mkBuf(T * V * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.attnProbsBuf = this.mkBuf(T * T * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.attnProbsReadBuf = this.mkBuf(T * T * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    this.dStream = this.mkStorage(N * D);
    this.dNorm = this.mkStorage(N * D);
    this.dTmp = this.mkStorage(N * D);
    this.dQ = this.mkStorage(N * D);
    this.dK = this.mkStorage(N * D);
    this.dV = this.mkStorage(N * D);
    this.dAttnOut = this.mkStorage(N * D);
    this.dGate = this.mkStorage(N * F);
    this.dUp = this.mkStorage(N * F);
    this.dFfnAct = this.mkStorage(N * F);

    this.paramCount = this.params.reduce((s, p) => s + p.size, 0);
    this.gpuBytes = this.bytesAllocated;
  }

  private mkBuf(size: number, usage: GPUBufferUsageFlags): GPUBuffer {
    const aligned = Math.max(16, Math.ceil(size / 4) * 4);
    const b = this.dev.createBuffer({ size: aligned, usage });
    this.allBuffers.push(b);
    this.bytesAllocated += aligned;
    return b;
  }

  private mkStorage(floats: number): GPUBuffer {
    return this.mkBuf(floats * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  }

  private mkParam(name: string, init: Float32Array): ParamSlot {
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const w = this.mkBuf(init.byteLength, usage);
    this.dev.queue.writeBuffer(w, 0, init as BufferSource);
    const g = this.mkBuf(init.byteLength, usage);
    const m = this.mkBuf(init.byteLength, usage);
    const v = this.mkBuf(init.byteLength, usage);
    const slot: ParamSlot = { name, size: init.length, w, g, m, v };
    this.params.push(slot);
    return slot;
  }

  private nextU32(u0: number, u1: number, u2: number, u3: number, f0 = 0, f1 = 0, f2 = 0, f3 = 0): GPUBuffer {
    if (this.uniformCursor >= this.uniformPool.length) {
      this.uniformPool.push(this.mkBuf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST));
    }
    const buf = this.uniformPool[this.uniformCursor++];
    const ab = new ArrayBuffer(32);
    const dv = new DataView(ab);
    dv.setUint32(0, u0 >>> 0, true);
    dv.setUint32(4, u1 >>> 0, true);
    dv.setUint32(8, u2 >>> 0, true);
    dv.setUint32(12, u3 >>> 0, true);
    dv.setFloat32(16, f0, true);
    dv.setFloat32(20, f1, true);
    dv.setFloat32(24, f2, true);
    dv.setFloat32(28, f3, true);
    this.dev.queue.writeBuffer(buf, 0, ab);
    return buf;
  }

  private nextMatmulU(M: number, N: number, K: number, accumulate = false): GPUBuffer {
    if (this.uniformCursor >= this.uniformPool.length) {
      this.uniformPool.push(this.mkBuf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST));
    }
    const buf = this.uniformPool[this.uniformCursor++];
    const ab = new ArrayBuffer(16);
    const dv = new DataView(ab);
    dv.setUint32(0, M >>> 0, true);
    dv.setUint32(4, N >>> 0, true);
    dv.setUint32(8, K >>> 0, true);
    dv.setFloat32(12, accumulate ? 1 : 0, true);
    this.dev.queue.writeBuffer(buf, 0, ab);
    return buf;
  }

  private nextAttnU(
    B: number,
    T: number,
    nHeads: number,
    headDim: number,
    kvLen: number,
    qOffset: number,
    saveProbs: boolean,
  ): GPUBuffer {
    if (this.uniformCursor >= this.uniformPool.length) {
      this.uniformPool.push(this.mkBuf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST));
    }
    const buf = this.uniformPool[this.uniformCursor++];
    const ab = new ArrayBuffer(32);
    const dv = new DataView(ab);
    dv.setUint32(0, B, true);
    dv.setUint32(4, T, true);
    dv.setUint32(8, nHeads, true);
    dv.setUint32(12, headDim, true);
    dv.setUint32(16, kvLen, true);
    dv.setUint32(20, qOffset, true);
    dv.setFloat32(24, 1 / Math.sqrt(headDim), true);
    dv.setUint32(28, saveProbs ? 1 : 0, true);
    this.dev.queue.writeBuffer(buf, 0, ab);
    return buf;
  }

  private dispatch1D(
    enc: GPUCommandEncoder,
    pipe: GPUComputePipeline,
    buffers: GPUBuffer[],
    threads: number,
    wgSize: number,
  ): void {
    const bg = this.dev.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(threads / wgSize));
    pass.end();
  }

  private dispatchMatmul(
    enc: GPUCommandEncoder,
    pipe: GPUComputePipeline,
    A: GPUBuffer,
    B: GPUBuffer,
    C: GPUBuffer,
    M: number,
    N: number,
    K: number,
    accumulate = false,
  ): void {
    const u = this.nextMatmulU(M, N, K, accumulate);
    const bg = this.dev.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: u } },
        { binding: 1, resource: { buffer: A } },
        { binding: 2, resource: { buffer: B } },
        { binding: 3, resource: { buffer: C } },
      ],
    });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(N / 16), Math.ceil(M / 16));
    pass.end();
  }

  private encodeForward(
    enc: GPUCommandEncoder,
    B: number,
    T: number,
    saveProbs: boolean,
  ): void {
    const { dModel: D, nHeads, ffnDim: F, vocabSize: V, ropeTheta, activation } = this.config;
    const N = B * T;
    const hd = D / nHeads;
    const actMode = activation === "swiglu" ? 0 : 1;

    // 1. Token embedding -> layer[0].xIn
    this.dispatch1D(
      enc,
      this.p.embedFwd,
      [this.nextU32(N, D, 0, 0), this.inIdsBuf, this.wEmbed.w, this.layers[0].xIn],
      N * D,
      256,
    );

    // 2. Transformer layers
    for (let l = 0; l < this.layers.length; l++) {
      const L = this.layers[l];
      const nextX = l + 1 < this.layers.length ? this.layers[l + 1].xIn : this.xFinal;

      // RMSNorm 1
      this.dispatch1D(
        enc,
        this.p.rmsFwd,
        [this.nextU32(N, D, 0, 0, 1e-5), L.xIn, L.rms1W.w, L.xNorm1, L.rms1Inv],
        N,
        64,
      );

      // Q, K, V projections: [N, D] @ [D, D]^T -> [N, D]
      this.dispatchMatmul(enc, this.p.matmulNT, L.xNorm1, L.wq.w, L.q, N, D, D);
      this.dispatchMatmul(enc, this.p.matmulNT, L.xNorm1, L.wk.w, L.k, N, D, D);
      this.dispatchMatmul(enc, this.p.matmulNT, L.xNorm1, L.wv.w, L.v, N, D, D);

      // RoPE on Q and K
      const ropePairs = N * nHeads * (hd / 2);
      this.dispatch1D(
        enc,
        this.p.ropeApply,
        [this.nextU32(N, T, 0, hd, ropeTheta, 1.0, nHeads), L.q],
        ropePairs,
        256,
      );
      this.dispatch1D(
        enc,
        this.p.ropeApply,
        [this.nextU32(N, T, 0, hd, ropeTheta, 1.0, nHeads), L.k],
        ropePairs,
        256,
      );

      // FlashAttention forward
      this.dispatch1D(
        enc,
        this.p.flashFwd,
        [
          this.nextAttnU(B, T, nHeads, hd, T, 0, saveProbs && l === 0),
          L.q,
          L.k,
          L.v,
          L.attnOut,
          L.lse,
          this.attnProbsBuf,
        ],
        B * nHeads * T,
        64,
      );

      // Output projection + residual add -> xMid
      this.dispatchMatmul(enc, this.p.matmulNT, L.attnOut, L.wo.w, L.attnProj, N, D, D);
      this.dispatch1D(enc, this.p.vecAdd, [this.nextU32(N * D, 0, 0, 0), L.xIn, L.attnProj, L.xMid], N * D, 256);

      // RMSNorm 2
      this.dispatch1D(
        enc,
        this.p.rmsFwd,
        [this.nextU32(N, D, 0, 0, 1e-5), L.xMid, L.rms2W.w, L.xNorm2, L.rms2Inv],
        N,
        64,
      );

      // Gated FFN: gate = xNorm2 @ W1^T, up = xNorm2 @ W3^T, act = SwiGLU/GeGLU(gate, up), out = act @ W2^T
      this.dispatchMatmul(enc, this.p.matmulNT, L.xNorm2, L.w1.w, L.gate, N, F, D);
      this.dispatchMatmul(enc, this.p.matmulNT, L.xNorm2, L.w3.w, L.up, N, F, D);
      this.dispatch1D(
        enc,
        this.p.gatedActFwd,
        [this.nextU32(N * F, actMode, 0, 0), L.gate, L.up, L.ffnAct],
        N * F,
        256,
      );
      this.dispatchMatmul(enc, this.p.matmulNT, L.ffnAct, L.w2.w, L.ffnOut, N, D, F);

      // Residual add -> nextX
      this.dispatch1D(enc, this.p.vecAdd, [this.nextU32(N * D, 0, 0, 0), L.xMid, L.ffnOut, nextX], N * D, 256);
    }

    // 3. Final RMSNorm & LM head logits [N, V]
    this.dispatch1D(
      enc,
      this.p.rmsFwd,
      [this.nextU32(N, D, 0, 0, 1e-5), this.xFinal, this.rmsFinalW.w, this.xFinalNorm, this.rmsFinalInv],
      N,
      64,
    );
    this.dispatchMatmul(enc, this.p.matmulNT, this.xFinalNorm, this.wHead.w, this.logitsBuf, N, V, D);
  }

  private encodeBackwardAndStep(enc: GPUCommandEncoder, lr: number): void {
    const { dModel: D, nHeads, ffnDim: F, vocabSize: V, batchSize: B, seqLen: T, ropeTheta, activation, optimizer, weightDecay } =
      this.config;
    const N = B * T;
    const hd = D / nHeads;
    const actMode = activation === "swiglu" ? 0 : 1;
    const ropePairs = N * nHeads * (hd / 2);

    // 1. Fused softmax + cross-entropy loss & dLogits
    this.dispatch1D(
      enc,
      this.p.ceFwdBwd,
      [this.nextU32(N, V, 1, 0), this.logitsBuf, this.tgtIdsBuf, this.dLogitsBuf, this.lossesBuf],
      N,
      64,
    );

    // 2. LM head backward:
    // dW_head[V, D] += dLogits[N, V]^T @ xFinalNorm[N, D]
    // dXFinalNorm[N, D] = dLogits[N, V] @ W_head[V, D]
    this.dispatchMatmul(enc, this.p.matmulTN, this.dLogitsBuf, this.xFinalNorm, this.wHead.g, V, D, N, true);
    this.dispatchMatmul(enc, this.p.matmulTiled, this.dLogitsBuf, this.wHead.w, this.dNorm, N, D, V, false);

    // 3. Final RMSNorm backward -> dStream
    this.dispatch1D(
      enc,
      this.p.rmsBwdW,
      [this.nextU32(N, D, 0, 0), this.xFinal, this.rmsFinalInv, this.dNorm, this.rmsFinalW.g],
      D,
      64,
    );
    this.dispatch1D(
      enc,
      this.p.rmsBwdX,
      [this.nextU32(N, D, 0, 0), this.xFinal, this.rmsFinalW.w, this.rmsFinalInv, this.dNorm, this.dStream],
      N,
      64,
    );

    // 4. Reverse through Transformer layers
    for (let l = this.layers.length - 1; l >= 0; l--) {
      const L = this.layers[l];

      // FFN down projection backward: ffnOut = ffnAct @ W2^T
      this.dispatchMatmul(enc, this.p.matmulTN, this.dStream, L.ffnAct, L.w2.g, D, F, N, true);
      this.dispatchMatmul(enc, this.p.matmulTiled, this.dStream, L.w2.w, this.dFfnAct, N, F, D, false);

      // Gated activation backward -> dGate, dUp
      this.dispatch1D(
        enc,
        this.p.gatedActBwd,
        [this.nextU32(N * F, actMode, 0, 0), L.gate, L.up, this.dFfnAct, this.dGate, this.dUp],
        N * F,
        256,
      );

      // W1 and W3 backward -> dNorm (accumulate gate + up paths)
      this.dispatchMatmul(enc, this.p.matmulTN, this.dGate, L.xNorm2, L.w1.g, F, D, N, true);
      this.dispatchMatmul(enc, this.p.matmulTN, this.dUp, L.xNorm2, L.w3.g, F, D, N, true);
      this.dispatchMatmul(enc, this.p.matmulTiled, this.dGate, L.w1.w, this.dNorm, N, D, F, false);
      this.dispatchMatmul(enc, this.p.matmulTiled, this.dUp, L.w3.w, this.dNorm, N, D, F, true);

      // RMSNorm 2 backward -> dTmp, add residual dStream -> dStream (now dXMid)
      this.dispatch1D(
        enc,
        this.p.rmsBwdW,
        [this.nextU32(N, D, 0, 0), L.xMid, L.rms2Inv, this.dNorm, L.rms2W.g],
        D,
        64,
      );
      this.dispatch1D(
        enc,
        this.p.rmsBwdX,
        [this.nextU32(N, D, 0, 0), L.xMid, L.rms2W.w, L.rms2Inv, this.dNorm, this.dTmp],
        N,
        64,
      );
      this.dispatch1D(
        enc,
        this.p.vecAddInplace,
        [this.nextU32(N * D, 0, 0, 0), this.dStream, this.dTmp],
        N * D,
        256,
      );

      // Attention output projection backward: attnProj = attnOut @ Wo^T
      this.dispatchMatmul(enc, this.p.matmulTN, this.dStream, L.attnOut, L.wo.g, D, D, N, true);
      this.dispatchMatmul(enc, this.p.matmulTiled, this.dStream, L.wo.w, this.dAttnOut, N, D, D, false);

      // FlashAttention backward -> dQ, dK, dV
      this.dispatch1D(
        enc,
        this.p.flashBwdQ,
        [
          this.nextAttnU(B, T, nHeads, hd, T, 0, false),
          L.q,
          L.k,
          L.v,
          L.attnOut,
          this.dAttnOut,
          L.lse,
          this.dQ,
        ],
        B * nHeads * T,
        64,
      );
      this.dispatch1D(
        enc,
        this.p.flashBwdKV,
        [
          this.nextAttnU(B, T, nHeads, hd, T, 0, false),
          L.q,
          L.k,
          L.v,
          L.attnOut,
          this.dAttnOut,
          L.lse,
          this.dK,
          this.dV,
        ],
        B * nHeads * T,
        64,
      );

      // Inverse RoPE on dQ and dK (sign = -1.0)
      this.dispatch1D(
        enc,
        this.p.ropeApply,
        [this.nextU32(N, T, 0, hd, ropeTheta, -1.0, nHeads), this.dQ],
        ropePairs,
        256,
      );
      this.dispatch1D(
        enc,
        this.p.ropeApply,
        [this.nextU32(N, T, 0, hd, ropeTheta, -1.0, nHeads), this.dK],
        ropePairs,
        256,
      );

      // Wq, Wk, Wv backward -> dNorm (accumulate all 3)
      this.dispatchMatmul(enc, this.p.matmulTN, this.dQ, L.xNorm1, L.wq.g, D, D, N, true);
      this.dispatchMatmul(enc, this.p.matmulTN, this.dK, L.xNorm1, L.wk.g, D, D, N, true);
      this.dispatchMatmul(enc, this.p.matmulTN, this.dV, L.xNorm1, L.wv.g, D, D, N, true);
      this.dispatchMatmul(enc, this.p.matmulTiled, this.dQ, L.wq.w, this.dNorm, N, D, D, false);
      this.dispatchMatmul(enc, this.p.matmulTiled, this.dK, L.wk.w, this.dNorm, N, D, D, true);
      this.dispatchMatmul(enc, this.p.matmulTiled, this.dV, L.wv.w, this.dNorm, N, D, D, true);

      // RMSNorm 1 backward -> dTmp, add residual dStream -> dStream (now dXIn)
      this.dispatch1D(
        enc,
        this.p.rmsBwdW,
        [this.nextU32(N, D, 0, 0), L.xIn, L.rms1Inv, this.dNorm, L.rms1W.g],
        D,
        64,
      );
      this.dispatch1D(
        enc,
        this.p.rmsBwdX,
        [this.nextU32(N, D, 0, 0), L.xIn, L.rms1W.w, L.rms1Inv, this.dNorm, this.dTmp],
        N,
        64,
      );
      this.dispatch1D(
        enc,
        this.p.vecAddInplace,
        [this.nextU32(N * D, 0, 0, 0), this.dStream, this.dTmp],
        N * D,
        256,
      );
    }

    // 5. Embedding backward
    this.dispatch1D(
      enc,
      this.p.embedBwd,
      [this.nextU32(N, D, V, 0), this.inIdsBuf, this.dStream, this.wEmbed.g],
      V * D,
      256,
    );

    // 6. Optimizer update (zeros gradients in-place after updating!)
    this.stepCount++;
    const optMode = optimizer === "muon" ? 1 : 0;
    for (const slot of this.params) {
      const is1D = slot.name.includes("rms");
      const modeForSlot = is1D ? 0 : optMode;
      const wd = is1D ? 0 : weightDecay;
      this.dispatch1D(
        enc,
        this.p.optStep,
        [this.nextU32(slot.size, modeForSlot, this.stepCount, 0, lr, wd, 0.9, 0.99), slot.w, slot.g, slot.m, slot.v],
        slot.size,
        256,
      );
    }
  }

  async trainStep(inputIds: Uint32Array, targetIds: Uint32Array, lrOverride?: number): Promise<StepMetrics> {
    const t0 = performance.now();
    const { batchSize: B, seqLen: T } = this.config;
    const N = B * T;
    this.uniformCursor = 0;

    this.dev.queue.writeBuffer(this.inIdsBuf, 0, inputIds as BufferSource);
    this.dev.queue.writeBuffer(this.tgtIdsBuf, 0, targetIds as BufferSource);

    const enc = this.dev.createCommandEncoder();
    this.encodeForward(enc, B, T, false);
    this.encodeBackwardAndStep(enc, lrOverride ?? this.config.lr);
    enc.copyBufferToBuffer(this.lossesBuf, 0, this.lossReadBuf, 0, N * 4);
    this.dev.queue.submit([enc.finish()]);

    await this.lossReadBuf.mapAsync(GPUMapMode.READ);
    const lossArr = new Float32Array(this.lossReadBuf.getMappedRange());
    let sum = 0;
    for (let i = 0; i < N; i++) sum += lossArr[i];
    this.lossReadBuf.unmap();

    const loss = sum / N;
    const stepMs = Math.max(0.1, performance.now() - t0);
    return {
      step: this.stepCount,
      loss,
      bpb: loss / Math.LN2,
      stepMs,
      tokPerSec: (N / stepMs) * 1000,
    };
  }

  async evalLoss(inputIds: Uint32Array, targetIds: Uint32Array): Promise<{ loss: number; bpb: number }> {
    const { batchSize: B, seqLen: T, vocabSize: V } = this.config;
    const N = B * T;
    this.uniformCursor = 0;

    this.dev.queue.writeBuffer(this.inIdsBuf, 0, inputIds as BufferSource);
    this.dev.queue.writeBuffer(this.tgtIdsBuf, 0, targetIds as BufferSource);

    const enc = this.dev.createCommandEncoder();
    this.encodeForward(enc, B, T, false);
    this.dispatch1D(
      enc,
      this.p.ceFwdBwd,
      [this.nextU32(N, V, 0, 0), this.logitsBuf, this.tgtIdsBuf, this.dLogitsBuf, this.lossesBuf],
      N,
      64,
    );
    enc.copyBufferToBuffer(this.lossesBuf, 0, this.lossReadBuf, 0, N * 4);
    this.dev.queue.submit([enc.finish()]);

    await this.lossReadBuf.mapAsync(GPUMapMode.READ);
    const lossArr = new Float32Array(this.lossReadBuf.getMappedRange());
    let sum = 0;
    for (let i = 0; i < N; i++) sum += lossArr[i];
    this.lossReadBuf.unmap();
    const loss = sum / N;
    return { loss, bpb: loss / Math.LN2 };
  }

  async forwardLogits(inputIds: Uint32Array): Promise<{ logits: Float32Array; attention: Float32Array | null }> {
    const { seqLen: T, vocabSize: V } = this.config;
    const len = Math.min(T, inputIds.length);
    const padded = new Uint32Array(T);
    padded.set(inputIds.subarray(inputIds.length - len));
    this.uniformCursor = 0;

    this.dev.queue.writeBuffer(this.inIdsBuf, 0, padded as BufferSource);
    const enc = this.dev.createCommandEncoder();
    this.encodeForward(enc, 1, T, true);
    enc.copyBufferToBuffer(this.logitsBuf, 0, this.logitsReadBuf, 0, T * V * 4);
    enc.copyBufferToBuffer(this.attnProbsBuf, 0, this.attnProbsReadBuf, 0, T * T * 4);
    this.dev.queue.submit([enc.finish()]);

    await Promise.all([
      this.logitsReadBuf.mapAsync(GPUMapMode.READ),
      this.attnProbsReadBuf.mapAsync(GPUMapMode.READ),
    ]);
    const logits = new Float32Array(this.logitsReadBuf.getMappedRange()).slice();
    const attention = new Float32Array(this.attnProbsReadBuf.getMappedRange()).slice();
    this.logitsReadBuf.unmap();
    this.attnProbsReadBuf.unmap();
    return { logits, attention };
  }

  async generate(promptIds: Uint32Array, opts: GenerateOptions): Promise<GenerateResult> {
    const { seqLen: T, vocabSize: V } = this.config;
    const ctx = Array.from(promptIds);
    if (ctx.length === 0) ctx.push(0);
    const generated: number[] = [];
    let lastAttn: Float32Array | null = null;
    const tStart = performance.now();

    for (let step = 0; step < opts.maxNewTokens; step++) {
      const t0 = performance.now();
      const windowStart = Math.max(0, ctx.length - T);
      const slice = ctx.slice(windowStart);
      const pos = slice.length - 1;
      const input = new Uint32Array(T);
      for (let i = 0; i < slice.length; i++) input[i] = slice[i];

      const { logits, attention } = await this.forwardLogits(input);
      lastAttn = attention;
      const nextId = sampleFromLogits(logits, pos * V, V, opts.temperature ?? 0.8, opts.topP ?? 0.9);
      if (opts.stopTokenIds?.includes(nextId)) break;
      ctx.push(nextId);
      generated.push(nextId);
      opts.onToken?.(nextId, performance.now() - t0);
    }

    const totalMs = Math.max(0.1, performance.now() - tStart);
    return {
      tokens: generated,
      tokPerSec: (generated.length / totalMs) * 1000,
      avgMsPerToken: totalMs / Math.max(1, generated.length),
      lastAttention: lastAttn,
    };
  }

  async exportWeights(): Promise<Float32Array> {
    const out = new Float32Array(this.paramCount);
    let offset = 0;
    const stagingBuffers: { buf: GPUBuffer; size: number; off: number }[] = [];
    const enc = this.dev.createCommandEncoder();
    for (const slot of this.params) {
      const bytes = slot.size * 4;
      const stg = this.dev.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      enc.copyBufferToBuffer(slot.w, 0, stg, 0, bytes);
      stagingBuffers.push({ buf: stg, size: slot.size, off: offset });
      offset += slot.size;
    }
    this.dev.queue.submit([enc.finish()]);
    for (const s of stagingBuffers) {
      await s.buf.mapAsync(GPUMapMode.READ);
      out.set(new Float32Array(s.buf.getMappedRange()), s.off);
      s.buf.unmap();
      s.buf.destroy();
    }
    return out;
  }

  importWeights(weights: Float32Array): void {
    if (weights.length !== this.paramCount) return;
    let offset = 0;
    for (const slot of this.params) {
      const slice = weights.subarray(offset, offset + slot.size);
      this.dev.queue.writeBuffer(slot.w, 0, slice as BufferSource);
      // Reset optimizer moments when loading a new checkpoint
      const zeros = new Float32Array(slot.size);
      this.dev.queue.writeBuffer(slot.m, 0, zeros as BufferSource);
      this.dev.queue.writeBuffer(slot.v, 0, zeros as BufferSource);
      offset += slot.size;
    }
  }

  dispose(): void {
    for (const b of this.allBuffers) b.destroy();
    this.allBuffers = [];
  }
}

// ============================================================================
// Pure-TypeScript Float32Array Fallback (when navigator.gpu is unavailable)
// ============================================================================

interface CpuParam {
  name: string;
  w: Float32Array;
  g: Float32Array;
  m: Float32Array;
  v: Float32Array;
}

class CpuMicroLLM implements MicroLLM {
  readonly backend = "cpu-fallback" as const;
  readonly config: ModelConfig;
  readonly paramCount: number;
  readonly gpuBytes = 0;
  stepCount = 0;

  private params: CpuParam[] = [];
  private wEmbed: CpuParam;
  private rmsFinalW: CpuParam;
  private wHead: CpuParam;
  private layers: {
    rms1W: CpuParam;
    wq: CpuParam;
    wk: CpuParam;
    wv: CpuParam;
    wo: CpuParam;
    rms2W: CpuParam;
    w1: CpuParam;
    w3: CpuParam;
    w2: CpuParam;
  }[] = [];

  constructor(cfg: ModelConfig) {
    this.config = { ...cfg };
    const { vocabSize: V, dModel: D, nLayers, ffnDim: F } = cfg;
    const rng = mulberry32(cfg.seed ?? 1337);
    const std = 1 / Math.sqrt(D);
    const resStd = std / Math.sqrt(2 * nLayers);

    const mk = (name: string, w: Float32Array): CpuParam => {
      const p = { name, w, g: new Float32Array(w.length), m: new Float32Array(w.length), v: new Float32Array(w.length) };
      this.params.push(p);
      return p;
    };

    this.wEmbed = mk("wEmbed", initNormal(V * D, 0.04, rng));
    for (let l = 0; l < nLayers; l++) {
      this.layers.push({
        rms1W: mk(`l${l}.rms1`, initOnes(D)),
        wq: mk(`l${l}.wq`, initNormal(D * D, std, rng)),
        wk: mk(`l${l}.wk`, initNormal(D * D, std, rng)),
        wv: mk(`l${l}.wv`, initNormal(D * D, std, rng)),
        wo: mk(`l${l}.wo`, initNormal(D * D, resStd, rng)),
        rms2W: mk(`l${l}.rms2`, initOnes(D)),
        w1: mk(`l${l}.w1`, initNormal(F * D, std, rng)),
        w3: mk(`l${l}.w3`, initNormal(F * D, std, rng)),
        w2: mk(`l${l}.w2`, initNormal(D * F, resStd, rng)),
      });
    }
    this.rmsFinalW = mk("rmsFinal", initOnes(D));
    this.wHead = mk("wHead", initNormal(V * D, std * 0.5, rng));
    this.paramCount = this.params.reduce((s, p) => s + p.w.length, 0);
  }

  private matmulNT(A: Float32Array, B: Float32Array, M: number, N: number, K: number): Float32Array {
    const C = new Float32Array(M * N);
    for (let m = 0; m < M; m++) {
      const aOff = m * K;
      const cOff = m * N;
      for (let n = 0; n < N; n++) {
        const bOff = n * K;
        let s = 0;
        for (let k = 0; k < K; k++) s += A[aOff + k] * B[bOff + k];
        C[cOff + n] = s;
      }
    }
    return C;
  }

  private forwardInternal(inputIds: Uint32Array, B: number, T: number) {
    const { dModel: D, nHeads, ffnDim: F, vocabSize: V, ropeTheta, activation } = this.config;
    const N = B * T;
    const hd = D / nHeads;
    const scale = 1 / Math.sqrt(hd);

    let x = new Float32Array(N * D);
    for (let n = 0; n < N; n++) {
      const tok = inputIds[n];
      x.set(this.wEmbed.w.subarray(tok * D, tok * D + D), n * D);
    }

    let firstAttn: Float32Array | null = null;
    const cache: {
      xIn: Float32Array;
      xNorm1: Float32Array;
      inv1: Float32Array;
      q: Float32Array;
      k: Float32Array;
      v: Float32Array;
      attnOut: Float32Array;
      xMid: Float32Array;
      xNorm2: Float32Array;
      inv2: Float32Array;
      gate: Float32Array;
      up: Float32Array;
      ffnAct: Float32Array;
    }[] = [];

    const rmsFwd = (inp: Float32Array, w: Float32Array) => {
      const out = new Float32Array(N * D);
      const inv = new Float32Array(N);
      for (let r = 0; r < N; r++) {
        let ss = 0;
        const base = r * D;
        for (let d = 0; d < D; d++) ss += inp[base + d] * inp[base + d];
        const ir = 1 / Math.sqrt(ss / D + 1e-5);
        inv[r] = ir;
        for (let d = 0; d < D; d++) out[base + d] = inp[base + d] * ir * w[d];
      }
      return { out, inv };
    };

    const rope = (buf: Float32Array, sign: number) => {
      for (let bt = 0; bt < N; bt++) {
        const t = bt % T;
        for (let h = 0; h < nHeads; h++) {
          for (let p = 0; p < hd / 2; p++) {
            const ang = t * Math.pow(ropeTheta, -(2 * p) / hd) * sign;
            const cs = Math.cos(ang);
            const sn = Math.sin(ang);
            const i = bt * D + h * hd + p * 2;
            const x0 = buf[i];
            const x1 = buf[i + 1];
            buf[i] = x0 * cs - x1 * sn;
            buf[i + 1] = x0 * sn + x1 * cs;
          }
        }
      }
    };

    for (let l = 0; l < this.layers.length; l++) {
      const L = this.layers[l];
      const xIn = x;
      const r1 = rmsFwd(xIn, L.rms1W.w);
      const q = this.matmulNT(r1.out, L.wq.w, N, D, D);
      const k = this.matmulNT(r1.out, L.wk.w, N, D, D);
      const v = this.matmulNT(r1.out, L.wv.w, N, D, D);
      rope(q, 1);
      rope(k, 1);

      const attnOut = new Float32Array(N * D);
      if (l === 0) firstAttn = new Float32Array(T * T);
      for (let b = 0; b < B; b++) {
        for (let h = 0; h < nHeads; h++) {
          for (let qt = 0; qt < T; qt++) {
            const qBase = (b * T + qt) * D + h * hd;
            let m = -Infinity;
            const scores = new Float32Array(qt + 1);
            for (let kt = 0; kt <= qt; kt++) {
              const kBase = (b * T + kt) * D + h * hd;
              let s = 0;
              for (let d = 0; d < hd; d++) s += q[qBase + d] * k[kBase + d];
              s *= scale;
              scores[kt] = s;
              if (s > m) m = s;
            }
            let sum = 0;
            for (let kt = 0; kt <= qt; kt++) {
              scores[kt] = Math.exp(scores[kt] - m);
              sum += scores[kt];
            }
            const invS = 1 / Math.max(sum, 1e-20);
            for (let kt = 0; kt <= qt; kt++) {
              const p = scores[kt] * invS;
              if (l === 0 && b === 0 && h === 0 && firstAttn) firstAttn[qt * T + kt] = p;
              const vBase = (b * T + kt) * D + h * hd;
              for (let d = 0; d < hd; d++) attnOut[qBase + d] += p * v[vBase + d];
            }
          }
        }
      }

      const proj = this.matmulNT(attnOut, L.wo.w, N, D, D);
      const xMid = new Float32Array(N * D);
      for (let i = 0; i < N * D; i++) xMid[i] = xIn[i] + proj[i];

      const r2 = rmsFwd(xMid, L.rms2W.w);
      const gate = this.matmulNT(r2.out, L.w1.w, N, F, D);
      const up = this.matmulNT(r2.out, L.w3.w, N, F, D);
      const ffnAct = new Float32Array(N * F);
      for (let i = 0; i < N * F; i++) {
        const g = gate[i];
        const act =
          activation === "swiglu"
            ? g / (1 + Math.exp(-Math.max(-20, Math.min(20, g))))
            : 0.5 * g * (1 + Math.tanh(Math.max(-10, Math.min(10, 0.7978845608 * (g + 0.044715 * g * g * g)))));
        ffnAct[i] = act * up[i];
      }
      const ffnOut = this.matmulNT(ffnAct, L.w2.w, N, D, F);
      const xNext = new Float32Array(N * D);
      for (let i = 0; i < N * D; i++) xNext[i] = xMid[i] + ffnOut[i];

      cache.push({
        xIn,
        xNorm1: r1.out,
        inv1: r1.inv,
        q,
        k,
        v,
        attnOut,
        xMid,
        xNorm2: r2.out,
        inv2: r2.inv,
        gate,
        up,
        ffnAct,
      });
      x = xNext;
    }

    const rF = rmsFwd(x, this.rmsFinalW.w);
    const logits = this.matmulNT(rF.out, this.wHead.w, N, V, D);
    return { logits, xFinal: x, xFinalNorm: rF.out, invF: rF.inv, cache, firstAttn };
  }

  async trainStep(inputIds: Uint32Array, targetIds: Uint32Array, lrOverride?: number): Promise<StepMetrics> {
    const t0 = performance.now();
    const { batchSize: B, seqLen: T, vocabSize: V, dModel: D, weightDecay } = this.config;
    const N = B * T;
    const { logits, xFinalNorm } = this.forwardInternal(inputIds, B, T);
    const lr = lrOverride ?? this.config.lr;

    // Lightweight LM-head + embedding online gradient fallback when WebGPU is absent
    let lossSum = 0;
    const dLogits = new Float32Array(N * V);
    for (let n = 0; n < N; n++) {
      const base = n * V;
      const tgt = targetIds[n];
      let mx = -Infinity;
      for (let v = 0; v < V; v++) if (logits[base + v] > mx) mx = logits[base + v];
      let sm = 0;
      for (let v = 0; v < V; v++) sm += Math.exp(logits[base + v] - mx);
      const lse = mx + Math.log(Math.max(sm, 1e-20));
      lossSum += lse - logits[base + tgt];
      for (let v = 0; v < V; v++) {
        const p = Math.exp(logits[base + v] - lse);
        dLogits[base + v] = (p - (v === tgt ? 1 : 0)) / N;
      }
    }

    // Update wHead and wEmbed
    const gHead = this.wHead.g;
    gHead.fill(0);
    const dX = new Float32Array(N * D);
    for (let n = 0; n < N; n++) {
      const lOff = n * V;
      const xOff = n * D;
      for (let v = 0; v < V; v++) {
        const dl = dLogits[lOff + v];
        if (Math.abs(dl) < 1e-9) continue;
        const wOff = v * D;
        for (let d = 0; d < D; d++) {
          gHead[wOff + d] += dl * xFinalNorm[xOff + d];
          dX[xOff + d] += dl * this.wHead.w[wOff + d];
        }
      }
    }
    this.wEmbed.g.fill(0);
    for (let n = 0; n < N; n++) {
      const tok = inputIds[n];
      for (let d = 0; d < D; d++) this.wEmbed.g[tok * D + d] += dX[n * D + d];
    }

    this.stepCount++;
    for (const p of [this.wHead, this.wEmbed]) {
      const b1 = 0.9;
      const b2 = 0.99;
      for (let i = 0; i < p.w.length; i++) {
        const g = Math.max(-2.5, Math.min(2.5, p.g[i]));
        p.m[i] = b1 * p.m[i] + (1 - b1) * g;
        p.v[i] = b2 * p.v[i] + (1 - b2) * g * g;
        const mh = p.m[i] / (1 - Math.pow(b1, this.stepCount));
        const vh = p.v[i] / (1 - Math.pow(b2, this.stepCount));
        p.w[i] = p.w[i] * (1 - lr * weightDecay) - (lr * mh) / (Math.sqrt(vh) + 1e-8);
      }
    }

    const loss = lossSum / N;
    const stepMs = Math.max(0.1, performance.now() - t0);
    return { step: this.stepCount, loss, bpb: loss / Math.LN2, stepMs, tokPerSec: (N / stepMs) * 1000 };
  }

  async evalLoss(inputIds: Uint32Array, targetIds: Uint32Array): Promise<{ loss: number; bpb: number }> {
    const { batchSize: B, seqLen: T, vocabSize: V } = this.config;
    const N = B * T;
    const { logits } = this.forwardInternal(inputIds, B, T);
    let lossSum = 0;
    for (let n = 0; n < N; n++) {
      const base = n * V;
      const tgt = targetIds[n];
      let mx = -Infinity;
      for (let v = 0; v < V; v++) if (logits[base + v] > mx) mx = logits[base + v];
      let sm = 0;
      for (let v = 0; v < V; v++) sm += Math.exp(logits[base + v] - mx);
      lossSum += mx + Math.log(Math.max(sm, 1e-20)) - logits[base + tgt];
    }
    const loss = lossSum / N;
    return { loss, bpb: loss / Math.LN2 };
  }

  async forwardLogits(inputIds: Uint32Array): Promise<{ logits: Float32Array; attention: Float32Array | null }> {
    const { seqLen: T } = this.config;
    const padded = new Uint32Array(T);
    const len = Math.min(T, inputIds.length);
    padded.set(inputIds.subarray(inputIds.length - len));
    const { logits, firstAttn } = this.forwardInternal(padded, 1, T);
    return { logits, attention: firstAttn };
  }

  async generate(promptIds: Uint32Array, opts: GenerateOptions): Promise<GenerateResult> {
    const { seqLen: T, vocabSize: V } = this.config;
    const ctx = Array.from(promptIds);
    if (ctx.length === 0) ctx.push(0);
    const generated: number[] = [];
    let lastAttn: Float32Array | null = null;
    const tStart = performance.now();
    for (let s = 0; s < opts.maxNewTokens; s++) {
      const t0 = performance.now();
      const slice = ctx.slice(Math.max(0, ctx.length - T));
      const input = new Uint32Array(T);
      for (let i = 0; i < slice.length; i++) input[i] = slice[i];
      const { logits, attention } = await this.forwardLogits(input);
      lastAttn = attention;
      const nextId = sampleFromLogits(logits, (slice.length - 1) * V, V, opts.temperature ?? 0.8, opts.topP ?? 0.9);
      if (opts.stopTokenIds?.includes(nextId)) break;
      ctx.push(nextId);
      generated.push(nextId);
      opts.onToken?.(nextId, performance.now() - t0);
    }
    const totalMs = Math.max(0.1, performance.now() - tStart);
    return {
      tokens: generated,
      tokPerSec: (generated.length / totalMs) * 1000,
      avgMsPerToken: totalMs / Math.max(1, generated.length),
      lastAttention: lastAttn,
    };
  }

  async exportWeights(): Promise<Float32Array> {
    const out = new Float32Array(this.paramCount);
    let off = 0;
    for (const p of this.params) {
      out.set(p.w, off);
      off += p.w.length;
    }
    return out;
  }

  importWeights(weights: Float32Array): void {
    if (weights.length !== this.paramCount) return;
    let off = 0;
    for (const p of this.params) {
      p.w.set(weights.subarray(off, off + p.w.length));
      p.m.fill(0);
      p.v.fill(0);
      off += p.w.length;
    }
  }

  dispose(): void {}
}

// ============================================================================
// Public Factory & Batch Sampler
// ============================================================================

export async function createMicroLLM(partial: Partial<ModelConfig> = {}): Promise<MicroLLM> {
  const cfg: ModelConfig = { ...DEFAULT_CONFIG, ...partial };
  // Ensure headDim is even and <= 32 for register FlashAttention
  if (cfg.dModel % cfg.nHeads !== 0) cfg.nHeads = 4;
  while (cfg.dModel / cfg.nHeads > 32 && cfg.dModel % (cfg.nHeads * 2) === 0) {
    cfg.nHeads *= 2;
  }
  const dev = await getDevice();
  if (dev) {
    return new WebGpuMicroLLM(dev, cfg);
  }
  return new CpuMicroLLM(cfg);
}

export function sampleBatch(
  tokens: Uint32Array,
  batchSize: number,
  seqLen: number,
  rng: () => number = Math.random,
): { inputs: Uint32Array; targets: Uint32Array } {
  const inputs = new Uint32Array(batchSize * seqLen);
  const targets = new Uint32Array(batchSize * seqLen);
  const maxStart = Math.max(1, tokens.length - seqLen - 1);
  for (let b = 0; b < batchSize; b++) {
    const start = Math.floor(rng() * maxStart);
    for (let t = 0; t < seqLen; t++) {
      const idx = (start + t) % Math.max(1, tokens.length - 1);
      inputs[b * seqLen + t] = tokens[idx];
      targets[b * seqLen + t] = tokens[idx + 1] ?? tokens[0];
    }
  }
  return { inputs, targets };
}
