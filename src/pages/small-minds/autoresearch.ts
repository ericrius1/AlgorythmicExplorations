import { wirePage } from "../../core/wirePage";
import {
  mountAutoResearchHero,
  mountKvQuantDemo,
  mountAutoResearchLab,
} from "../../demos/llm/autoresearchDemos";

wirePage({
  hero: mountAutoResearchHero,
  "kv-quant": mountKvQuantDemo,
  "autoresearch-lab": mountAutoResearchLab,
});
