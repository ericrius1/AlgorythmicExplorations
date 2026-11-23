import { wirePage } from "../../core/wirePage";
import { mountMatmulHero, mountGemmRace, mountTokenizerEmbed } from "../../demos/llm/matmulDemos";

wirePage({
  hero: mountMatmulHero,
  "gemm-race": mountGemmRace,
  "tokenizer-embed": mountTokenizerEmbed,
});
