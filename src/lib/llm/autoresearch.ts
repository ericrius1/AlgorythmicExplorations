// Karpathy-inspired Browser AutoResearch Engine running live on WebGPU:
// Proposes concrete architectural/optimizer/schedule hypotheses, trains each
// candidate for a fixed budget on our pure-WebGPU micro-LLM, measures held-out
// validation bits-per-byte (val_bpb), keeps improvements, discards regressions,
// and builds an inspectable commit tree!

import {
  createMicroLLM,
  sampleBatch,
  type ActivationKind,
  type ModelConfig,
  type OptimizerKind,
} from "./webgpuEngine";

export type SearchStrategy = "hill-climb" | "ucb-bandit" | "evolutionary";

export interface ResearchGenome {
  dModel: number;
  nLayers: number;
  nHeads: number;
  ffnMult: number;
  activation: ActivationKind;
  optimizer: OptimizerKind;
  lr: number;
  weightDecay: number;
  ropeTheta: number;
  cosineWarmdown: boolean;
}

export interface ExperimentNode {
  id: number;
  parentId: number | null;
  status: "baseline" | "kept" | "discarded";
  mutationAxis: string;
  hypothesis: string;
  diff: string;
  genome: ResearchGenome;
  paramCount: number;
  trainLoss: number;
  valLoss: number;
  valBpb: number;
  deltaBpb: number; // negative is better!
  wallMs: number;
  tokPerSec: number;
  backend: "webgpu" | "cpu-fallback";
  sample: string;
}

export const BASELINE_GENOME: ResearchGenome = {
  dModel: 48,
  nLayers: 2,
  nHeads: 4,
  ffnMult: 2,
  activation: "gelu",
  optimizer: "adamw",
  lr: 0.005,
  weightDecay: 0.01,
  ropeTheta: 10000,
  cosineWarmdown: false,
};

interface MutationProposal {
  axis: string;
  hypothesis: string;
  diff: string;
  apply(g: ResearchGenome): ResearchGenome;
}

const MUTATION_POOL: ((g: ResearchGenome) => MutationProposal | null)[] = [
  (g) =>
    g.activation === "gelu"
      ? {
          axis: "activation",
          hypothesis: "SwiGLU's smooth SiLU gate yields sharper feature routing than GeGLU at small widths.",
          diff: "activation: gelu → swiglu",
          apply: (x) => ({ ...x, activation: "swiglu" }),
        }
      : {
          axis: "activation",
          hypothesis: "Test whether GeGLU converges faster under tight fixed step budgets.",
          diff: "activation: swiglu → gelu",
          apply: (x) => ({ ...x, activation: "gelu" }),
        },
  (g) =>
    g.optimizer === "adamw"
      ? {
          axis: "optimizer",
          hypothesis: "Muon-style RMS-steered Nesterov updates equalize gradient scales across 2D projections.",
          diff: "optimizer: adamw → muon",
          apply: (x) => ({ ...x, optimizer: "muon" }),
        }
      : {
          axis: "optimizer",
          hypothesis: "Return to decoupled AdamW for adaptive per-coordinate curvature.",
          diff: "optimizer: muon → adamw",
          apply: (x) => ({ ...x, optimizer: "adamw" }),
        },
  (g) => {
    const nextLr = Number(Math.min(0.024, g.lr * 1.45).toFixed(4));
    if (nextLr === g.lr) return null;
    return {
      axis: "lr_up",
      hypothesis: "Under short compute budgets, a hotter learning rate descends the steep early loss basin faster.",
      diff: `lr: ${g.lr} → ${nextLr}`,
      apply: (x) => ({ ...x, lr: nextLr }),
    };
  },
  (g) => {
    const nextLr = Number(Math.max(0.0015, g.lr * 0.68).toFixed(4));
    if (nextLr === g.lr) return null;
    return {
      axis: "lr_down",
      hypothesis: "Cool the learning rate to suppress late-step oscillation in cross-entropy.",
      diff: `lr: ${g.lr} → ${nextLr}`,
      apply: (x) => ({ ...x, lr: nextLr }),
    };
  },
  (g) =>
    !g.cosineWarmdown
      ? {
          axis: "schedule",
          hypothesis: "Linear/cosine warmdown over the final 35% of steps settles weights into a flatter minimum.",
          diff: "schedule: constant → cosine_warmdown",
          apply: (x) => ({ ...x, cosineWarmdown: true }),
        }
      : {
          axis: "schedule",
          hypothesis: "Hold peak learning rate through the whole budget to test if early decay undertrains.",
          diff: "schedule: cosine_warmdown → constant",
          apply: (x) => ({ ...x, cosineWarmdown: false }),
        },
  (g) => {
    const next = g.dModel < 64 ? 64 : 48;
    return {
      axis: "width",
      hypothesis:
        next > g.dModel
          ? "Widening dModel from 48→64 expands residual stream capacity and improves GPU tile occupancy."
          : "Narrowing dModel to 48 trades capacity for lower variance on small corpora.",
      diff: `dModel: ${g.dModel} → ${next}`,
      apply: (x) => ({ ...x, dModel: next }),
    };
  },
  (g) => {
    const next = g.ffnMult < 3 ? 3 : 2;
    return {
      axis: "ffn_ratio",
      hypothesis:
        next > g.ffnMult
          ? "Expanding FFN hidden ratio to 3× gives key-value memory slots more room to store n-grams."
          : "Shrinking FFN ratio to 2× focuses parameter budget on attention heads.",
      diff: `ffnMult: ${g.ffnMult}× → ${next}×`,
      apply: (x) => ({ ...x, ffnMult: next }),
    };
  },
  (g) => {
    const next = g.ropeTheta === 10000 ? 1000 : 10000;
    return {
      axis: "rope_theta",
      hypothesis:
        next < g.ropeTheta
          ? "Lower RoPE base θ=1000 increases angular resolution across short 48-token contexts."
          : "Higher RoPE base θ=10000 preserves smoother long-range phase alignment.",
      diff: `ropeTheta: ${g.ropeTheta} → ${next}`,
      apply: (x) => ({ ...x, ropeTheta: next }),
    };
  },
  (g) => {
    const next = g.weightDecay >= 0.01 ? 0.002 : 0.025;
    return {
      axis: "weight_decay",
      hypothesis:
        next < g.weightDecay
          ? "Relaxing weight decay avoids shrinking small-model embeddings prematurely."
          : "Stronger weight decay regularizes validation bits-per-byte on tight datasets.",
      diff: `weightDecay: ${g.weightDecay} → ${next}`,
      apply: (x) => ({ ...x, weightDecay: next }),
    };
  },
  (g) => {
    const next = g.nLayers === 2 ? 3 : 2;
    return {
      axis: "depth",
      hypothesis:
        next > g.nLayers
          ? "Adding a 3rd Transformer block enables deeper induction-head composition."
          : "A shallower 2-layer stack propagates cleaner gradients within a short step budget.",
      diff: `nLayers: ${g.nLayers} → ${next}`,
      apply: (x) => ({ ...x, nLayers: next }),
    };
  },
];

export class BrowserAutoResearcher {
  readonly history: ExperimentNode[] = [];
  bestNode: ExperimentNode | null = null;
  bestWeights: Float32Array | null = null;

  private axisStats = new Map<string, { tries: number; reward: number }>();
  private trainTokens: Uint32Array;
  private valTokens: Uint32Array;
  private stepsPerTrial: number;
  private seqLen: number;

  constructor(tokens: Uint32Array, opts: { stepsPerTrial?: number; seqLen?: number } = {}) {
    const split = Math.max(64, Math.floor(tokens.length * 0.85));
    this.trainTokens = tokens.subarray(0, split);
    this.valTokens = tokens.length - split >= 48 ? tokens.subarray(split) : tokens;
    this.stepsPerTrial = opts.stepsPerTrial ?? 42;
    this.seqLen = opts.seqLen ?? 40;
  }

  setCorpus(tokens: Uint32Array): void {
    const split = Math.max(64, Math.floor(tokens.length * 0.85));
    this.trainTokens = tokens.subarray(0, split);
    this.valTokens = tokens.length - split >= 48 ? tokens.subarray(split) : tokens;
  }

  reset(): void {
    this.history.length = 0;
    this.bestNode = null;
    this.bestWeights = null;
    this.axisStats.clear();
  }

  private pickParent(strategy: SearchStrategy): ExperimentNode {
    if (strategy === "evolutionary" && this.history.length >= 3) {
      const kept = this.history.filter((n) => n.status !== "discarded").sort((a, b) => a.valBpb - b.valBpb);
      const top = kept.slice(0, Math.min(3, kept.length));
      return top[Math.floor(Math.random() * top.length)];
    }
    return this.bestNode!;
  }

  private proposeMutation(parent: ResearchGenome, strategy: SearchStrategy): MutationProposal {
    const candidates: MutationProposal[] = [];
    for (const fn of MUTATION_POOL) {
      const prop = fn(parent);
      if (prop) candidates.push(prop);
    }
    if (strategy === "ucb-bandit") {
      const totalTries = Math.max(1, this.history.length);
      let best = candidates[0];
      let bestScore = -Infinity;
      for (const c of candidates) {
        const st = this.axisStats.get(c.axis) ?? { tries: 0, reward: 0 };
        const mean = st.tries > 0 ? st.reward / st.tries : 0.25;
        const bonus = Math.sqrt((1.4 * Math.log(totalTries + 1)) / (st.tries + 0.5));
        const score = mean + bonus + Math.random() * 0.05;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return best;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  async runOneExperiment(
    strategy: SearchStrategy,
    opts?: {
      customProposal?: { hypothesis: string; diff: string; genome: ResearchGenome };
      onProgress?: (step: number, totalSteps: number, loss: number) => void;
    },
  ): Promise<ExperimentNode> {
    const isBaseline = this.history.length === 0;
    const parent = isBaseline ? null : this.pickParent(strategy);

    let proposal: { axis: string; hypothesis: string; diff: string; genome: ResearchGenome };
    if (opts?.customProposal) {
      proposal = { axis: "custom", ...opts.customProposal };
    } else if (isBaseline) {
      proposal = {
        axis: "baseline",
        hypothesis: "Establish baseline validation bits-per-byte with standard 2-layer GeGLU + AdamW.",
        diff: "init baseline (d=48, L=2, gelu, adamw, lr=0.005)",
        genome: { ...BASELINE_GENOME },
      };
    } else {
      const m = this.proposeMutation(parent!.genome, strategy);
      proposal = { axis: m.axis, hypothesis: m.hypothesis, diff: m.diff, genome: m.apply(parent!.genome) };
    }

    const g = proposal.genome;
    const cfg: Partial<ModelConfig> = {
      seqLen: this.seqLen,
      dModel: g.dModel,
      nLayers: g.nLayers,
      nHeads: g.nHeads,
      ffnDim: g.dModel * g.ffnMult,
      activation: g.activation,
      optimizer: g.optimizer,
      lr: g.lr,
      weightDecay: g.weightDecay,
      ropeTheta: g.ropeTheta,
      batchSize: 4,
      seed: 2026 + this.history.length * 17,
    };

    const llm = await createMicroLLM(cfg);
    const t0 = performance.now();
    let trainLoss = 4.6;
    let tokPerSecSum = 0;

    // Deterministic batch sequence per trial seed so comparisons stay fair
    let s = 918273;
    const batchRng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    for (let step = 0; step < this.stepsPerTrial; step++) {
      const { inputs, targets } = sampleBatch(this.trainTokens, 4, this.seqLen, batchRng);
      let lr = g.lr;
      if (g.cosineWarmdown && step > this.stepsPerTrial * 0.65) {
        const frac = (step - this.stepsPerTrial * 0.65) / (this.stepsPerTrial * 0.35);
        lr = g.lr * (0.15 + 0.85 * 0.5 * (1 + Math.cos(Math.PI * frac)));
      }
      const m = await llm.trainStep(inputs, targets, lr);
      trainLoss = m.loss;
      tokPerSecSum += m.tokPerSec;
      if (step % 4 === 0 || step === this.stepsPerTrial - 1) {
        opts?.onProgress?.(step + 1, this.stepsPerTrial, trainLoss);
      }
    }

    // Evaluate held-out validation loss over 2 fixed batches
    let valSum = 0;
    for (let e = 0; e < 2; e++) {
      const vb = sampleBatch(this.valTokens, 4, this.seqLen, () => ((e * 0.37 + 0.13) % 1));
      const res = await llm.evalLoss(vb.inputs, vb.targets);
      valSum += res.loss;
    }
    const valLoss = valSum / 2;
    const valBpb = valLoss / Math.LN2;
    const wallMs = performance.now() - t0;

    const prevBest = this.bestNode?.valBpb ?? valBpb;
    const deltaBpb = valBpb - prevBest;
    const improved = isBaseline || valBpb < prevBest - 0.002;

    // Update UCB bandit reward
    if (!isBaseline) {
      const st = this.axisStats.get(proposal.axis) ?? { tries: 0, reward: 0 };
      st.tries += 1;
      st.reward += Math.max(0, -deltaBpb * 4);
      this.axisStats.set(proposal.axis, st);
    }

    // Grab a tiny sample snippet
    const prompt = this.valTokens.subarray(0, Math.min(12, this.valTokens.length));
    const gen = await llm.generate(prompt, { maxNewTokens: 28, temperature: 0.75 });
    const { decodeTokens } = await import("./tokenizer");
    const sample = decodeTokens(gen.tokens).replace(/\n/g, " ");

    if (improved) {
      this.bestWeights = await llm.exportWeights();
    }

    const node: ExperimentNode = {
      id: this.history.length + 1,
      parentId: parent?.id ?? null,
      status: isBaseline ? "baseline" : improved ? "kept" : "discarded",
      mutationAxis: proposal.axis,
      hypothesis: proposal.hypothesis,
      diff: proposal.diff,
      genome: g,
      paramCount: llm.paramCount,
      trainLoss,
      valLoss,
      valBpb,
      deltaBpb,
      wallMs,
      tokPerSec: tokPerSecSum / this.stepsPerTrial,
      backend: llm.backend,
      sample,
    };

    llm.dispose();
    this.history.push(node);
    if (improved) this.bestNode = node;
    return node;
  }
}
