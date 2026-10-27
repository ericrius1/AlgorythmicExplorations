import "../../styles/music-play.css";
import { wirePage } from "../../core/wirePage";
import { mountAccompanist } from "../../demos/music/accompanist";
import { mountAccompHero } from "../../demos/music/accomp/hero";
import { mountProbeTest } from "../../demos/music/accomp/probe";
import { mountKeyFinder } from "../../demos/music/accomp/keyfind";
import { mountChordFinder } from "../../demos/music/accomp/chordfind";
import { mountAnswerFig } from "../../demos/music/accomp/answer";

wirePage({
  hero: mountAccompHero,
  probe: mountProbeTest,
  keyfinder: mountKeyFinder,
  chords: mountChordFinder,
  answer: mountAnswerFig,
  accompanist: mountAccompanist,
});
