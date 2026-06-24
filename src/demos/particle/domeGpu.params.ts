// Dome demo params — defaults and Tweakpane ranges in one place.
// Bump SCHEMA_VERSION when folders/keys change.

import type { ParamSchema } from "../../lib/devTools";
import type { DomeSubstance } from "./domeGpu";

export const SCHEMA_VERSION = "dome-v1";

export const PARAM_SCHEMA = {
  substance: {
    mode: {
      value: "nbody" as DomeSubstance,
      options: { "n-body gravity": "nbody", "SPH water": "water" },
      label: "substance",
    },
  },
  particles: {
    count: { value: 20000, min: 8000, max: 60000, step: 2000, label: "count" },
    nbodySteps: { value: 2, min: 1, max: 8, step: 1, label: "n-body steps / frame" },
    pointSize: { value: 0.005, min: 0.002, max: 0.012, step: 0.0005, label: "point size" },
  },
  dome: {
    shellR: { value: 0.9, min: 0.65, max: 1.1, step: 0.02, label: "shell radius" },
    shellK: { value: 6, min: 0, max: 20, step: 0.5, label: "shell stiffness" },
  },
  nbody: {
    gScale: { value: 0.5, min: 0.1, max: 2, step: 0.05, label: "G scale" },
    theta: { value: 0.8, min: 0.4, max: 1.4, step: 0.05, label: "θ" },
    damping: { value: 1.0, min: 0.99, max: 1.0, step: 0.001, label: "damping" },
  },
  water: {
    steps: { value: 3, min: 1, max: 6, step: 1, label: "steps / frame" },
    gravity: { value: 2.2, min: 0.5, max: 6, step: 0.1, label: "gravity" },
    stiffness: { value: 55, min: 10, max: 120, step: 1, label: "stiffness" },
    restDensity: { value: 2.0, min: 0.5, max: 4, step: 0.1, label: "rest density" },
    mouseStrength: { value: 45, min: 0, max: 120, step: 1, label: "stir strength" },
    colorScale: { value: 1.4, min: 0.5, max: 4, step: 0.1, label: "color scale" },
  },
  camera: {
    elevation: { value: 0.55, min: 0.1, max: 1.4, step: 0.02, label: "elevation" },
    distance: { value: 2.4, min: 1.2, max: 6, step: 0.1, label: "distance" },
  },
  render: {
    colorScale: { value: 2.0, min: 0.5, max: 4, step: 0.1, label: "n-body color scale" },
  },
} satisfies ParamSchema;

export type DomeParams = import("../../lib/devTools").ParamValues<typeof PARAM_SCHEMA>;
