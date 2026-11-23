import { wirePage } from "../../core/wirePage";
import { mountCompanionSanctuary, mountSpeciesGallery } from "../../demos/llm/companionDemos";

wirePage({
  hero: mountCompanionSanctuary,
  gallery: mountSpeciesGallery,
});
