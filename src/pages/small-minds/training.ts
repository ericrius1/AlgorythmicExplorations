import { wirePage } from "../../core/wirePage";
import { mountTrainingHero, mountGradFlowDemo, mountLiveTrainer } from "../../demos/llm/trainingDemos";

wirePage({
  hero: mountTrainingHero,
  "grad-flow": mountGradFlowDemo,
  "live-trainer": mountLiveTrainer,
});
