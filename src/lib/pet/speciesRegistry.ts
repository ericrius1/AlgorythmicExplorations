// Open Species Registry for Small Minds: Part 5.
// 3 procedural 3D companions crafted by Claude Opus 5.5 (Mochi, Kitsune, Pebble)
// and 3 crafted by Gemini 4 Neon (Pip, Bramble, Luma) — press `;` in the
// sanctuary to see live FPS, WebGPU LLM stats, and each creature's model author!
// Adding up to 20+ more species only requires registering another builder here.

import { CLAUDE_SPECIES } from "./speciesClaude";
import { GEMINI_SPECIES } from "./speciesGemini";
import type { SpeciesDefinition } from "./types";

export const SPECIES_CATALOG: SpeciesDefinition[] = [
  ...CLAUDE_SPECIES,
  ...GEMINI_SPECIES,
];

export function getSpeciesById(id: string): SpeciesDefinition {
  return SPECIES_CATALOG.find((s) => s.id === id) ?? SPECIES_CATALOG[0];
}
