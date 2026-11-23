import { wirePage } from "../../core/wirePage";
import {
  mountAttentionHero,
  mountRopeDemo,
  mountFlashAttnDemo,
  mountBlockDemo,
} from "../../demos/llm/attentionDemos";

wirePage({
  hero: mountAttentionHero,
  rope: mountRopeDemo,
  "flash-attn": mountFlashAttnDemo,
  block: mountBlockDemo,
});
