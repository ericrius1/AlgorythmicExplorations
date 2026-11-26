import { wirePage } from "../../core/wirePage";
import { mountGuessingHero, mountMarkovDemo, mountSoftmaxTempDemo } from "../../demos/llm/guessingDemos";

wirePage({
  hero: mountGuessingHero,
  "markov-builder": mountMarkovDemo,
  "softmax-temp": mountSoftmaxTempDemo,
});
