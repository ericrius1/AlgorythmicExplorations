// Shared contract for procedural 3D pet species in Small Minds: Part 5.
// Adding a new species to the sanctuary only requires implementing
// SpeciesDefinition and registering it in speciesRegistry.ts.

import type * as THREE from "three/webgpu";

export type PetAuthor = "Claude Opus 5.5" | "Gemini 4 Neon";

export type EvolutionStage = 1 | 2 | 3 | 4;

export type PetMood =
  | "idle"
  | "happy"
  | "curious"
  | "playful"
  | "thinking"
  | "dreaming"
  | "proud"
  | "sleepy";

export type PetTrick = "hop" | "spin" | "sing" | "dash" | "bow" | "flip";

export interface PetPoseInput {
  /** Monotonic elapsed seconds */
  time: number;
  /** Frame delta seconds (clamped <= 0.05) */
  dt: number;
  /** Current emotional state */
  mood: PetMood;
  /** Visual evolution stage 1..4 */
  evolution: EvolutionStage;
  /** 0..1 vitality / liveliness */
  energy: number;
  /** 0..1 affection / warmth */
  affection: number;
  /** 0..1 intensity while generating/speaking a reply */
  speaking: number;
  /** 0..1 intensity while user is typing or interacting */
  listening: number;
  /** 0..1 neural activity pulse from the live WebGPU LLM */
  attentionPulse: number;
  /** 0..1 transient delight burst when being petted */
  petted: number;
  /** World-space point the pet should glance toward */
  lookTarget: THREE.Vector3;
  /** Active trick being performed, if any */
  activeTrick: PetTrick | null;
  /** 0..1 normalized progress through the active trick */
  trickPhase: number;
  /** Horizontal world velocity for gait/lean animation */
  speed: number;
}

export interface PetModelRig {
  /** Root group placed on the sanctuary ground at y = 0, facing +Z */
  root: THREE.Group;
  /** Anchor near the top of the head for thought bubbles / sparkles */
  headAnchor: THREE.Object3D;
  /** Meshes eligible for raycast petting & hover highlights */
  hitMeshes: THREE.Object3D[];
  /** Per-frame procedural animation update */
  update(pose: PetPoseInput): void;
  /** Update visual ornaments / proportions for evolution stage 1..4 */
  setEvolution(stage: EvolutionStage): void;
  /** Free geometries & materials */
  dispose(): void;
}

export interface SpeciesDefinition {
  id: string;
  name: string;
  species: string;
  author: PetAuthor;
  accentHex: string;
  tagline: string;
  /** Short personality flavor used to seed the pet's WebGPU micro-LLM */
  personalitySeed: string;
  /** Signature favorite words/motifs */
  favoriteWords: string[];
  /** Base musical pitch in Hz for gentle chirps/purrs */
  voicePitch: number;
  /** Build the procedural 3D rig (facing +Z, feet resting at y = 0, height ~0.8..1.2 units) */
  buildRig(): PetModelRig;
}

export const EVOLUTION_NAMES: Record<EvolutionStage, string> = {
  1: "Hatchling",
  2: "Curious Sprout",
  3: "Radiant Friend",
  4: "Starlight Sage",
};

export const TRICK_LIST: { id: PetTrick; label: string; cue: string; emoji: string }[] = [
  { id: "hop", label: "Hop", cue: "jump up", emoji: "✦" },
  { id: "spin", label: "Spin", cue: "twirl around", emoji: "↻" },
  { id: "sing", label: "Sing", cue: "sing a note", emoji: "♪" },
  { id: "dash", label: "Zoomies", cue: "zip around", emoji: "⚡" },
  { id: "bow", label: "Bow", cue: "take a bow", emoji: "✿" },
  { id: "flip", label: "Starflip", cue: "backflip", emoji: "★" },
];
