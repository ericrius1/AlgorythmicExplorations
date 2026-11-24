// Compact self-describing binary checkpoint format ("SMW1" — Small Minds Weights)
// Shared bit-for-bit between the browser pure-WebGPU engine and Google Colab A100
// PyTorch training notebooks. Supports lossless FP32 and group-wise INT8 (Q8, ~3.6x smaller).

import { DEFAULT_CONFIG, type ActivationKind, type ModelConfig, type OptimizerKind } from "./webgpuEngine";

const MAGIC = [0x53, 0x4d, 0x57, 0x31] as const; // "SMW1"

export type QuantFormat = "fp32" | "q8";

export interface CheckpointMeta {
  speciesId?: string;
  label?: string;
  trainedOn?: string;
  trainedSteps?: number;
  trainTokens?: number;
  valBpb?: number;
  valLoss?: number;
  corpus?: string;
  createdAt?: string;
}

export interface CheckpointHeader {
  version: 1;
  quant: QuantFormat;
  groupSize: number;
  paramCount: number;
  config: {
    vocabSize: number;
    seqLen: number;
    dModel: number;
    nLayers: number;
    nHeads: number;
    ffnDim: number;
    activation: ActivationKind;
    optimizer?: OptimizerKind;
    lr?: number;
    weightDecay?: number;
    ropeTheta: number;
    batchSize?: number;
  };
  meta?: CheckpointMeta;
}

export interface DecodedCheckpoint {
  config: ModelConfig;
  weights: Float32Array;
  quant: QuantFormat;
  groupSize: number;
  paramCount: number;
  byteLength: number;
  meta: CheckpointMeta;
}

export function expectedParamCount(cfg: Pick<ModelConfig, "vocabSize" | "dModel" | "nLayers" | "ffnDim">): number {
  const { vocabSize: V, dModel: D, nLayers: L, ffnDim: F } = cfg;
  const perLayer = D + 4 * D * D + D + 2 * F * D + D * F;
  return V * D + L * perLayer + D + V * D;
}

export function encodeCheckpoint(
  weights: Float32Array,
  config: ModelConfig,
  meta: CheckpointMeta = {},
  quant: QuantFormat = "q8",
  groupSize = 32,
): Uint8Array {
  const paramCount = weights.length;
  const expected = expectedParamCount(config);
  if (paramCount !== expected) {
    throw new Error(`SMW1 encode mismatch: got ${paramCount} weights, expected ${expected}`);
  }

  const header: CheckpointHeader = {
    version: 1,
    quant,
    groupSize,
    paramCount,
    config: {
      vocabSize: config.vocabSize,
      seqLen: config.seqLen,
      dModel: config.dModel,
      nLayers: config.nLayers,
      nHeads: config.nHeads,
      ffnDim: config.ffnDim,
      activation: config.activation,
      optimizer: config.optimizer,
      lr: config.lr,
      weightDecay: config.weightDecay,
      ropeTheta: config.ropeTheta,
      batchSize: config.batchSize,
    },
    meta,
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const dataOffset = (8 + headerBytes.length + 3) & ~3;

  if (quant === "fp32") {
    const out = new Uint8Array(dataOffset + paramCount * 4);
    out.set(MAGIC, 0);
    new DataView(out.buffer).setUint32(4, headerBytes.length, true);
    out.set(headerBytes, 8);
    new Float32Array(out.buffer, dataOffset, paramCount).set(weights);
    return out;
  }

  const numGroups = Math.ceil(paramCount / groupSize);
  const scalesBytes = numGroups * 4;
  const out = new Uint8Array(dataOffset + scalesBytes + paramCount);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);

  const scales = new Float32Array(out.buffer, dataOffset, numGroups);
  const qweights = new Int8Array(out.buffer, dataOffset + scalesBytes, paramCount);

  for (let g = 0; g < numGroups; g++) {
    const start = g * groupSize;
    const end = Math.min(paramCount, start + groupSize);
    let maxAbs = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(weights[i]);
      if (a > maxAbs) maxAbs = a;
    }
    const scale = Math.max(maxAbs / 127, 1e-8);
    scales[g] = scale;
    const inv = 1 / scale;
    for (let i = start; i < end; i++) {
      qweights[i] = Math.max(-127, Math.min(127, Math.round(weights[i] * inv)));
    }
  }

  return out;
}

export function decodeCheckpoint(input: ArrayBuffer | Uint8Array): DecodedCheckpoint {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 12) {
    throw new Error("Invalid SMW1 file: too short");
  }
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) {
    throw new Error("Invalid SMW1 file: bad magic header");
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = dv.getUint32(4, true);
  if (8 + headerLen > bytes.byteLength) {
    throw new Error("Invalid SMW1 file: truncated header");
  }

  const headerText = new TextDecoder().decode(bytes.subarray(8, 8 + headerLen));
  const header = JSON.parse(headerText) as CheckpointHeader;
  if (header.version !== 1) {
    throw new Error(`Unsupported SMW1 version: ${String(header.version)}`);
  }

  const c = header.config;
  const headDim = c.dModel / c.nHeads;
  if (!Number.isInteger(headDim) || headDim <= 0 || headDim > 32 || headDim % 2 !== 0) {
    throw new Error(`Unsupported headDim=${headDim} for WebGPU FlashAttention (must be even and <= 32)`);
  }

  const config: ModelConfig = {
    ...DEFAULT_CONFIG,
    vocabSize: c.vocabSize,
    seqLen: c.seqLen,
    dModel: c.dModel,
    nLayers: c.nLayers,
    nHeads: c.nHeads,
    ffnDim: c.ffnDim,
    activation: c.activation ?? "swiglu",
    optimizer: c.optimizer ?? "adamw",
    lr: c.lr ?? 0.0008,
    weightDecay: c.weightDecay ?? 0.01,
    ropeTheta: c.ropeTheta ?? 10000,
    batchSize: c.batchSize ?? 4,
  };

  const expected = expectedParamCount(config);
  if (header.paramCount !== expected) {
    throw new Error(`SMW1 paramCount mismatch: header says ${header.paramCount}, config requires ${expected}`);
  }

  const dataOffset = (8 + headerLen + 3) & ~3;
  const paramCount = header.paramCount;
  const weights = new Float32Array(paramCount);

  if (header.quant === "fp32") {
    const needed = dataOffset + paramCount * 4;
    if (bytes.byteLength < needed) throw new Error("Invalid SMW1 file: truncated FP32 payload");
    for (let i = 0; i < paramCount; i++) {
      weights[i] = dv.getFloat32(dataOffset + i * 4, true);
    }
  } else if (header.quant === "q8") {
    const gs = header.groupSize || 32;
    const numGroups = Math.ceil(paramCount / gs);
    const scalesOffset = dataOffset;
    const qOffset = dataOffset + numGroups * 4;
    if (bytes.byteLength < qOffset + paramCount) {
      throw new Error("Invalid SMW1 file: truncated Q8 payload");
    }
    const qweights = new Int8Array(bytes.buffer, bytes.byteOffset + qOffset, paramCount);
    for (let g = 0; g < numGroups; g++) {
      const scale = dv.getFloat32(scalesOffset + g * 4, true);
      const start = g * gs;
      const end = Math.min(paramCount, start + gs);
      for (let i = start; i < end; i++) {
        weights[i] = qweights[i] * scale;
      }
    }
  } else {
    throw new Error(`Unsupported SMW1 quant mode: ${String(header.quant)}`);
  }

  return {
    config,
    weights,
    quant: header.quant,
    groupSize: header.groupSize || 32,
    paramCount,
    byteLength: bytes.byteLength,
    meta: header.meta ?? {},
  };
}

export async function loadCheckpointUrl(url: string): Promise<DecodedCheckpoint | null> {
  try {
    const res = await fetch(url, { cache: "default" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 12) return null;
    const head = new Uint8Array(buf, 0, 4);
    if (head[0] !== MAGIC[0] || head[1] !== MAGIC[1] || head[2] !== MAGIC[2] || head[3] !== MAGIC[3]) {
      return null; // e.g. Vite dev server returned HTML fallback 200 for missing asset
    }
    return decodeCheckpoint(buf);
  } catch {
    return null;
  }
}

export function downloadCheckpointFile(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".smw") ? filename : `${filename}.smw`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
