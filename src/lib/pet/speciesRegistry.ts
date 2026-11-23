// Open Species Registry for Small Minds: Part 5.
// Starts with 6 distinct procedural 3D companions and is structured so adding
// 10–20+ more species (crafted by any model or artist) is a single-line plug-in.

import { EXTRA_SPECIES } from "./speciesExtra";
import { GEMINI_SPECIES } from "./speciesGemini";
import type { SpeciesDefinition } from "./types";

export const SPECIES_CATALOG: SpeciesDefinition[] = [
  ...EXTRA_SPECIES,
  ...GEMINI_SPECIES,
];

export function getSpeciesById(id: string): SpeciesDefinition {
  return SPECIES_CATALOG.find((s) => s.id === id) ?? SPECIES_CATALOG[0];
}
