import "../../styles/music-tuning.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy, type Demo } from "../../lib/demoShell";
import { mountSoundControl } from "../../lib/music/soundControl";
import { mountHeroRing } from "../../demos/music/tuning/heroRing";
import { mountScaleRing } from "../../demos/music/scaleRing";
import { mountModeLadder } from "../../demos/music/tuning/modeLadder";
import { mountMaxEven } from "../../demos/music/tuning/maxEven";
import { mountFifthsKeys } from "../../demos/music/fifthsKeys";
import { mountWorldScales } from "../../demos/music/tuning/worldScales";
import { mountExplorer } from "../../demos/music/tuning/explorer";

initNav();
mountSoundControl();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  hero: mountHeroRing,
  ring: mountScaleRing,
  ladder: mountModeLadder,
  even: mountMaxEven,
  keys: mountFifthsKeys,
  world: mountWorldScales,
  explorer: mountExplorer,
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
