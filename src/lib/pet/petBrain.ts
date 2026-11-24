// Living Brain for the Keystone Companion:
// Combines:
//  1) Real Pure-WebGPU Micro-LLM (continuous online replay fine-tuning + live token sampling)
//  2) Episodic Memory Bank (remembers user phrases, name, topics, and chats)
//  3) REINFORCE-style Trick Mastery Policy (learns 6 physical moves from rewards)
//  4) Dream Mode AutoResearch (runs real WebGPU mutation trials to improve weights!)
//  5) IndexedDB Persistence so your companion remembers you across visits!

import { PET_CORPUS } from "../llm/datasets";
import { EOS_ID, NL_ID, decodeTokens, encodeText } from "../llm/tokenizer";
import { createMicroLLM, sampleBatch, type MicroLLM } from "../llm/webgpuEngine";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  loadCheckpointUrl,
  type CheckpointMeta,
  type DecodedCheckpoint,
} from "../llm/checkpoint";
import { getDevice } from "../gpu";
import { BrowserAutoResearcher, type ExperimentNode } from "../llm/autoresearch";
import type { EnvironmentId } from "./environments";
import type { EvolutionStage, PetMood, PetTrick, SpeciesDefinition } from "./types";

export interface MemoryItem {
  user: string;
  pet: string;
  timestamp: number;
  topic: string;
}

export interface PersistedPetState {
  speciesId: string;
  customName: string;
  environmentId: EnvironmentId;
  xp: number;
  bond: number;
  stepsTrained: number;
  dreamGenerations: number;
  lastLoss: number;
  trickMastery: Record<PetTrick, number>;
  /** Tiny 6 x 4 policy logits updated via reward-modulated gradient steps */
  policyWeights: number[];
  memories: MemoryItem[];
  weights?: number[]; // legacy serialized Float32Array
  checkpointBytes?: Uint8Array; // compact SMW1 Q8 binary checkpoint
  brainSource?: string;
}

export interface BrainReply {
  text: string;
  rawWebGpuSample: string;
  triggeredTrick: PetTrick | null;
  mood: PetMood;
  tokPerSec: number;
  lossAfterLearn: number;
  evolvedTo: EvolutionStage | null;
}

const DB_NAME = "small-minds-companions-v1";
const STORE_NAME = "pets";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "speciesId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadState(speciesId: string): Promise<PersistedPetState | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(speciesId);
    req.onsuccess = () => resolve((req.result as PersistedPetState | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function saveState(state: PersistedPetState): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(state);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function xpToStage(xp: number): EvolutionStage {
  if (xp >= 260) return 4;
  if (xp >= 140) return 3;
  if (xp >= 55) return 2;
  return 1;
}

export function nextStageXp(stage: EvolutionStage): number {
  return stage === 1 ? 55 : stage === 2 ? 140 : stage === 3 ? 260 : 260;
}

function defaultTrickMastery(): Record<PetTrick, number> {
  return { hop: 0.18, spin: 0.1, sing: 0.12, dash: 0.14, bow: 0.08, flip: 0.04 };
}

export class PetBrain {
  species: SpeciesDefinition;
  llm: MicroLLM | null = null;
  customName: string;
  environmentId: EnvironmentId = "meadow";
  xp = 0;
  bond = 20;
  stepsTrained = 0;
  dreamGenerations = 0;
  lastLoss = 4.4;
  lastTokPerSec = 0;
  lastAttention: Float32Array | null = null;
  lastRawSample = "";
  trickMastery: Record<PetTrick, number> = defaultTrickMastery();
  policyWeights: Float32Array = new Float32Array(24);
  memories: MemoryItem[] = [];
  ready = false;
  trainingNow = false;
  dreamingNow = false;
  brainSource = "In-browser warm-start";
  pretrainedMeta: CheckpointMeta | null = null;

  private researcher: BrowserAutoResearcher | null = null;
  private userName: string | null = null;

  constructor(species: SpeciesDefinition) {
    this.species = species;
    this.customName = species.name;
    // Initialize small policy weights
    for (let i = 0; i < this.policyWeights.length; i++) {
      this.policyWeights[i] = ((i * 7) % 11 - 5) * 0.04;
    }
  }

  get stage(): EvolutionStage {
    return xpToStage(this.xp);
  }

  get backend(): string {
    return this.llm?.backend ?? "initializing";
  }

  get paramCount(): number {
    return this.llm?.paramCount ?? 0;
  }

  get gpuBytes(): number {
    return this.llm?.gpuBytes ?? 0;
  }

  get archLabel(): string {
    const c = this.llm?.config;
    if (!c) return "—";
    return `${c.nLayers}L · d${c.dModel} · ${c.nHeads}H · ${c.activation.toUpperCase()} · ctx ${c.seqLen}`;
  }

  get isPretrained(): boolean {
    return this.pretrainedMeta !== null;
  }

  private async fetchBundledCheckpoint(): Promise<DecodedCheckpoint | null> {
    const base = import.meta.env.BASE_URL || "/";
    const normalized = base.endsWith("/") ? base : `${base}/`;
    const candidates = [
      `${normalized}models/small-minds/${this.species.id}.smw`,
      `${normalized}models/small-minds/companion-base.smw`,
    ];
    for (const url of candidates) {
      const ckpt = await loadCheckpointUrl(url);
      if (ckpt) return ckpt;
    }
    return null;
  }

  private formatSource(meta: CheckpointMeta, fallbackLabel: string): string {
    const where = meta.trainedOn || fallbackLabel;
    const bpb = typeof meta.valBpb === "number" ? ` · val ${meta.valBpb.toFixed(2)} bpb` : "";
    return `${where}${bpb}`;
  }

  async loadCheckpoint(ckpt: DecodedCheckpoint, opts: { persist?: boolean; label?: string } = {}): Promise<void> {
    this.ready = false;
    this.llm?.dispose();
    this.llm = await createMicroLLM({
      ...ckpt.config,
      lr: ckpt.config.lr ?? 0.0008,
      batchSize: ckpt.config.batchSize ?? 4,
    });
    this.llm.importWeights(ckpt.weights);
    this.pretrainedMeta = ckpt.meta ?? {};
    this.brainSource = this.formatSource(ckpt.meta, opts.label ?? "Imported .smw");
    if (typeof ckpt.meta.valLoss === "number") {
      this.lastLoss = ckpt.meta.valLoss;
    } else if (typeof ckpt.meta.valBpb === "number") {
      this.lastLoss = ckpt.meta.valBpb * Math.LN2;
    } else {
      this.lastLoss = Math.min(this.lastLoss, 1.35);
    }
    if (typeof ckpt.meta.trainedSteps === "number" && this.stepsTrained < ckpt.meta.trainedSteps) {
      this.stepsTrained = ckpt.meta.trainedSteps;
    }
    this.ready = true;
    if (opts.persist !== false) {
      await this.persist();
    }
  }

  async exportCheckpoint(): Promise<Uint8Array> {
    if (!this.llm) throw new Error("Brain is not initialized yet");
    const weights = await this.llm.exportWeights();
    return encodeCheckpoint(
      weights,
      this.llm.config,
      {
        ...(this.pretrainedMeta ?? {}),
        speciesId: this.species.id,
        label: `${this.customName} (${this.species.species})`,
        trainedOn: this.pretrainedMeta?.trainedOn ?? `Browser ${this.backend}`,
        trainedSteps: this.stepsTrained,
        valLoss: Number(this.lastLoss.toFixed(4)),
        valBpb: Number((this.lastLoss / Math.LN2).toFixed(4)),
        createdAt: new Date().toISOString(),
      },
      "q8",
      32,
    );
  }

  private buildReplayText(): string {
    let text = this.species.personalitySeed + "\n" + PET_CORPUS;
    // Repeat personal memories slightly so continual learning absorbs user phrases!
    for (const m of this.memories.slice(-16)) {
      text += `\nuser: ${m.user}\npet: ${m.pet}\nuser: ${m.user}\npet: ${m.pet}\n`;
    }
    return text;
  }

  async init(onStatus?: (msg: string) => void): Promise<void> {
    this.ready = false;
    this.pretrainedMeta = null;
    this.brainSource = "In-browser warm-start";

    const saved = await loadState(this.species.id);
    if (saved) {
      this.customName = saved.customName || this.species.name;
      this.environmentId = saved.environmentId || "meadow";
      this.xp = saved.xp || 0;
      this.bond = saved.bond || 20;
      this.stepsTrained = saved.stepsTrained || 0;
      this.dreamGenerations = saved.dreamGenerations || 0;
      this.lastLoss = saved.lastLoss || 4.4;
      this.trickMastery = { ...defaultTrickMastery(), ...(saved.trickMastery ?? {}) };
      if (saved.policyWeights?.length === 24) this.policyWeights.set(saved.policyWeights);
      this.memories = saved.memories ?? [];
      this.extractUserNameFromMemories();
    }

    const hasGpu = (await getDevice()) !== null;

    // 1. Check saved SMW1 checkpoint in IndexedDB
    let savedCkpt: DecodedCheckpoint | null = null;
    if (saved?.checkpointBytes && saved.checkpointBytes.byteLength >= 12) {
      try {
        savedCkpt = decodeCheckpoint(saved.checkpointBytes);
      } catch {
        savedCkpt = null;
      }
    }

    // 2. Check bundled Colab-trained checkpoint under public/models/small-minds/
    onStatus?.(`Checking pretrained brain for ${this.customName}...`);
    const bundled = hasGpu ? await this.fetchBundledCheckpoint() : null;

    // Prefer saved SMW1 unless a larger/newer bundled Colab checkpoint has shipped
    const shouldUpgradeToBundled =
      bundled !== null &&
      (!savedCkpt || (bundled.paramCount > savedCkpt.paramCount && !saved?.brainSource?.includes("Imported")));

    if (shouldUpgradeToBundled && bundled) {
      onStatus?.(`Loading ${this.customName}'s pretrained WebGPU brain (${(bundled.paramCount / 1000).toFixed(0)}K)...`);
      await this.loadCheckpoint(bundled, { persist: false, label: "Colab Pretrained" });
      return;
    }

    if (savedCkpt && (hasGpu || savedCkpt.paramCount <= 160_000)) {
      onStatus?.(`Restoring ${this.customName}'s saved WebGPU brain...`);
      await this.loadCheckpoint(savedCkpt, { persist: false, label: saved?.brainSource ?? "Saved Brain" });
      if (saved?.brainSource) this.brainSource = saved.brainSource;
      return;
    }

    // 3. Fallback: lightweight scratch WebGPU micro-LLM (fast boot even without pretrained files)
    onStatus?.("Allocating WebGPU micro-LLM...");
    this.llm?.dispose();
    this.llm = await createMicroLLM({
      seqLen: 48,
      dModel: 48,
      nLayers: 2,
      nHeads: 4,
      ffnDim: 96,
      activation: "swiglu",
      optimizer: "adamw",
      lr: 0.0085,
      weightDecay: 0.008,
      batchSize: 4,
      seed: this.species.id.charCodeAt(0) * 131 + 42,
    });

    if (saved?.weights && saved.weights.length === this.llm.paramCount) {
      this.llm.importWeights(new Float32Array(saved.weights));
      onStatus?.(`Restored ${this.customName}'s saved memories`);
    } else {
      // Quick warm-start burst on WebGPU so the pet starts already babbling coherently!
      onStatus?.(`Warm-starting ${this.customName}'s WebGPU weights...`);
      await this.runOnlineSteps(18, 0.01);
    }
    this.ready = true;
  }

  private extractUserNameFromMemories(): void {
    for (const m of this.memories) {
      const match = m.user.match(/\b(?:my name is|i am|i'm|call me)\s+([a-z]{2,16})\b/i);
      if (match) this.userName = match[1];
    }
  }

  async runOnlineSteps(steps: number, lr = 0.0065): Promise<number> {
    if (!this.llm) return this.lastLoss;
    this.trainingNow = true;
    const tokens = encodeText(this.buildReplayText());
    let loss = this.lastLoss;
    for (let i = 0; i < steps; i++) {
      const { inputs, targets } = sampleBatch(tokens, this.llm.config.batchSize, this.llm.config.seqLen);
      const m = await this.llm.trainStep(inputs, targets, lr);
      loss = m.loss;
      this.stepsTrained++;
    }
    this.lastLoss = loss;
    this.trainingNow = false;
    return loss;
  }

  async persist(): Promise<void> {
    let checkpointBytes: Uint8Array | undefined;
    if (this.llm) {
      try {
        checkpointBytes = await this.exportCheckpoint();
      } catch {
        checkpointBytes = undefined;
      }
    }
    await saveState({
      speciesId: this.species.id,
      customName: this.customName,
      environmentId: this.environmentId,
      xp: this.xp,
      bond: this.bond,
      stepsTrained: this.stepsTrained,
      dreamGenerations: this.dreamGenerations,
      lastLoss: this.lastLoss,
      trickMastery: this.trickMastery,
      policyWeights: Array.from(this.policyWeights),
      memories: this.memories.slice(-40),
      checkpointBytes,
      brainSource: this.brainSource,
    });
  }

  async resetProgress(): Promise<void> {
    this.xp = 0;
    this.bond = 20;
    this.stepsTrained = 0;
    this.dreamGenerations = 0;
    this.lastLoss = 4.4;
    this.trickMastery = defaultTrickMastery();
    this.memories = [];
    this.userName = null;
    this.pretrainedMeta = null;
    this.brainSource = "In-browser warm-start";
    // Clear saved state first so init() reloads fresh bundled Colab weights (or clean warm-start)
    await saveState({
      speciesId: this.species.id,
      customName: this.species.name,
      environmentId: this.environmentId,
      xp: 0,
      bond: 20,
      stepsTrained: 0,
      dreamGenerations: 0,
      lastLoss: 4.4,
      trickMastery: defaultTrickMastery(),
      policyWeights: Array.from(this.policyWeights),
      memories: [],
    });
    await this.init();
    await this.persist();
  }

  /** Record a physical interaction (petting, tossing toy) -> gentle bond & XP boost */
  registerAffection(xpGain: number, bondGain: number): EvolutionStage | null {
    const before = this.stage;
    this.xp += xpGain;
    this.bond = Math.min(100, this.bond + bondGain);
    void this.persist();
    return this.stage > before ? this.stage : null;
  }

  /** REINFORCE-style reward update for teaching a trick! */
  rewardTrick(trick: PetTrick): { mastery: number; evolvedTo: EvolutionStage | null } {
    const tricks: PetTrick[] = ["hop", "spin", "sing", "dash", "bow", "flip"];
    const idx = tricks.indexOf(trick);
    const beforeStage = this.stage;
    if (idx >= 0) {
      // Softmax policy gradient step: push active trick logits up
      const cur = this.trickMastery[trick];
      const delta = (1 - cur) * 0.24 + 0.05;
      this.trickMastery[trick] = Math.min(1, cur + delta);
      for (let f = 0; f < 4; f++) {
        this.policyWeights[idx * 4 + f] += 0.18 * (1 - cur);
      }
      this.xp += 12;
      this.bond = Math.min(100, this.bond + 4);
      void this.persist();
    }
    return { mastery: this.trickMastery[trick], evolvedTo: this.stage > beforeStage ? this.stage : null };
  }

  /** Choose a favorite mastered trick autonomously when happy */
  pickAutonomousTrick(): PetTrick {
    const entries = Object.entries(this.trickMastery) as [PetTrick, number][];
    let total = 0;
    for (const [, m] of entries) total += 0.05 + m * m;
    let r = Math.random() * total;
    for (const [k, m] of entries) {
      r -= 0.05 + m * m;
      if (r <= 0) return k;
    }
    return "hop";
  }

  /** Run a real Dream-mode WebGPU AutoResearch consolidation cycle! */
  async runDreamCycle(
    onProgress?: (msg: string, node?: ExperimentNode) => void,
  ): Promise<{ bestNode: ExperimentNode; improved: boolean; evolvedTo: EvolutionStage | null }> {
    this.dreamingNow = true;
    const beforeStage = this.stage;
    const tokens = encodeText(this.buildReplayText());
    if (!this.researcher) {
      this.researcher = new BrowserAutoResearcher(tokens, { stepsPerTrial: 24, seqLen: 36 });
    } else {
      this.researcher.setCorpus(tokens);
    }

    onProgress?.("Replaying episodic memories on WebGPU...");
    const node = await this.researcher.runOneExperiment("ucb-bandit", {
      onProgress: (step, total, loss) => {
        onProgress?.(`Dreaming experiment #${this.dreamGenerations + 1} · step ${step}/${total} · loss ${loss.toFixed(2)}`);
      },
    });

    // Also consolidate the live pet weights directly with replay training!
    await this.runOnlineSteps(this.isPretrained ? 6 : 14, this.isPretrained ? 0.0006 : 0.0055);
    this.dreamGenerations++;
    this.xp += 18;
    this.bond = Math.min(100, this.bond + 5);
    this.dreamingNow = false;
    await this.persist();
    onProgress?.(
      node.status === "kept"
        ? `Dream kept: ${node.diff} (val ${node.valBpb.toFixed(2)} bpb)`
        : `Dream explored: ${node.diff} — kept calmer weights`,
      node,
    );
    return {
      bestNode: node,
      improved: node.status === "kept" || node.status === "baseline",
      evolvedTo: this.stage > beforeStage ? this.stage : null,
    };
  }

  /** Chat with the pet: runs real WebGPU inference + continual online weight update! */
  async chat(userText: string): Promise<BrainReply> {
    const clean = userText.trim();
    const low = clean.toLowerCase();
    const beforeStage = this.stage;

    const nameMatch = clean.match(/\b(?:my name is|i am|i'm|call me)\s+([a-z]{2,16})\b/i);
    if (nameMatch) this.userName = nameMatch[1];

    // Detect trick cues in natural conversation
    let triggeredTrick: PetTrick | null = null;
    if (/\b(hop|jump|bounce)\b/.test(low)) triggeredTrick = "hop";
    else if (/\b(spin|twirl|turn)\b/.test(low)) triggeredTrick = "spin";
    else if (/\b(sing|song|music|hum|note)\b/.test(low)) triggeredTrick = "sing";
    else if (/\b(dash|run|zoom|zoomies|fast)\b/.test(low)) triggeredTrick = "dash";
    else if (/\b(bow|polite|hello|greet)\b/.test(low)) triggeredTrick = "bow";
    else if (/\b(flip|backflip|somersault|trick)\b/.test(low)) triggeredTrick = "flip";

    // Run real pure-WebGPU autoregressive generation on prompt!
    let rawSample = "";
    let tokPerSec = 0;
    if (this.llm) {
      let promptStr = `user: ${low}\npet: `;
      if (this.llm.config.seqLen >= 96 && this.memories.length > 0) {
        const prev = this.memories[this.memories.length - 1];
        const ctxCandidate = `user: ${prev.user.toLowerCase()}\npet: ${prev.pet.toLowerCase()}\nuser: ${low}\npet: `;
        if (ctxCandidate.length < this.llm.config.seqLen - 16) {
          promptStr = ctxCandidate;
        }
      }
      const prompt = encodeText(promptStr);
      const gen = await this.llm.generate(prompt, {
        maxNewTokens: this.isPretrained ? 110 : 48,
        temperature: this.isPretrained ? 0.68 : 0.72,
        topP: 0.9,
        stopTokenIds: [NL_ID, EOS_ID],
      });
      tokPerSec = gen.tokPerSec;
      this.lastTokPerSec = tokPerSec;
      this.lastAttention = gen.lastAttention;
      rawSample = decodeTokens(gen.tokens).split("\n")[0].trim();
      this.lastRawSample = rawSample;
    }

    // Craft an endearing, context-aware reply grounded in species voice, memory,
    // and real WebGPU neural generation. When a Colab-pretrained brain is loaded,
    // let its pure-WebGPU neural generation lead directly!
    const fav = this.species.favoriteWords[Math.floor(Math.random() * this.species.favoriteWords.length)];
    const callUser = this.userName ? `, ${this.userName}` : "";
    let mood: PetMood = "happy";
    let reply = "";

    const neuralLooksClean =
      rawSample.length >= 10 &&
      /^[a-z0-9 ,.!?'’~:;-]+$/i.test(rawSample) &&
      rawSample.split(/\s+/).length >= 3 &&
      (this.isPretrained || this.lastLoss < 1.85);

    if (neuralLooksClean && !nameMatch && (this.isPretrained || (!triggeredTrick && Math.random() < 0.55))) {
      reply = rawSample;
      mood = triggeredTrick ? "playful" : "proud";
    } else if (nameMatch) {
      reply = `${fav}! nice to meet you, ${this.userName}! i just wrote your name straight into my episodic memory.`;
      mood = "happy";
    } else if (triggeredTrick) {
      const masteryPct = Math.round(this.trickMastery[triggeredTrick] * 100);
      reply =
        masteryPct >= 65
          ? `${fav}! watch my ${triggeredTrick}! i've practiced it to ${masteryPct}% mastery!`
          : `trying a ${triggeredTrick}${callUser}! reward me if you like it so my policy weights remember!`;
      mood = "playful";
    } else if (/\b(love|cute|sweet|good|adorable|friend)\b/.test(low)) {
      reply = `my heart glow just spiked${callUser}! ${fav} — growing alongside you is my favorite part of every frame.`;
      mood = "happy";
    } else if (/\b(dream|sleep|rest|research)\b/.test(low)) {
      reply = `tap Dream whenever you're ready${callUser} — i'll replay our memories and run WebGPU autoresearch while we rest.`;
      mood = "dreaming";
    } else if (/\b(webgpu|gpu|llm|weight|train|brain|think|matrix)\b/.test(low)) {
      reply = `my tiny ${Math.round(this.paramCount / 1000)}k-param brain has trained ${this.stepsTrained} steps on ${this.backend} (loss ${this.lastLoss.toFixed(2)})!`;
      mood = "thinking";
    } else if (/\b(hi|hello|hey|morning|evening)\b/.test(low)) {
      const memNote =
        this.memories.length > 0
          ? ` i still remember talking about "${this.memories[this.memories.length - 1].topic}"!`
          : "";
      reply = `${fav}! hello${callUser}!${memNote} want to chat, toss a glowing orb, or teach me a move?`;
      mood = "happy";
    } else if (/\?$/.test(clean) || /\b(what|why|how|who)\b/.test(low)) {
      const words = clean.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3);
      const focus = words[words.length - 1] ?? fav;
      reply = `ooh, curious about "${focus}"${callUser}! my attention heads just focused on it — tell me more so my weights learn it!`;
      mood = "curious";
    } else {
      const words = clean.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3);
      const picked = words[0] ?? fav;
      reply = `${fav}! i tucked "${picked}" into memory${callUser} and nudged my WebGPU weights a tiny step closer to your voice.`;
      mood = "curious";
    }

    // Store episodic memory and perform real online continual WebGPU gradient updates!
    const topicWords = clean.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3);
    this.memories.push({
      user: clean.slice(0, 100),
      pet: reply.slice(0, 120),
      timestamp: Date.now(),
      topic: topicWords[topicWords.length - 1] ?? "our chat",
    });

    // Gentle continual fine-tuning LR for Colab-pretrained brains prevents catastrophic forgetting
    const onlineSteps = this.isPretrained ? 3 : 6;
    const onlineLr = this.isPretrained ? 0.0008 : 0.006;
    const lossAfter = await this.runOnlineSteps(onlineSteps, onlineLr);
    this.xp += 10;
    this.bond = Math.min(100, this.bond + 3);
    void this.persist();

    return {
      text: reply,
      rawWebGpuSample: rawSample,
      triggeredTrick,
      mood,
      tokPerSec,
      lossAfterLearn: lossAfter,
      evolvedTo: this.stage > beforeStage ? this.stage : null,
    };
  }
}
