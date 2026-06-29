import { wirePage } from "../../core/wirePage";
import {
  mountAcousticRoom,
  mountBandMaterial,
  mountFrameBudget,
  mountHealingMini,
  mountProbePath,
  mountReflectionLobe,
} from "../../demos/music/acousticSpace";

wirePage({
  room: mountAcousticRoom,
  probes: mountProbePath,
  material: mountBandMaterial,
  lobe: mountReflectionLobe,
  budget: mountFrameBudget,
  healing: mountHealingMini,
});
