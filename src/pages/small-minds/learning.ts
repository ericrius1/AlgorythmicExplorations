import { wirePage } from "../../core/wirePage";
import {
  mountLearningHero,
  mountGradDescentDemo,
  mountBackpropGraphDemo,
} from "../../demos/llm/learningDemos";

wirePage({
  hero: mountLearningHero,
  "grad-descent": mountGradDescentDemo,
  "backprop-graph": mountBackpropGraphDemo,
});
