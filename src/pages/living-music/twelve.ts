import "../../styles/music-tuning.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy, type Demo } from "../../lib/demoShell";
import { mountSoundControl } from "../../lib/music/soundControl";
import { mountHeroSpiral } from "../../demos/music/tuning/heroSpiral";
import { mountSpiralFifths } from "../../demos/music/spiralFifths";
import { mountCommaLab } from "../../demos/music/commaLab";
import { mountTemperWheel } from "../../demos/music/tuning/temperWheel";
import { mountWhyTwelve } from "../../demos/music/whyTwelve";
import { mountEdoPlayer } from "../../demos/music/tuning/edoPlayer";

initNav();
mountSoundControl();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  hero: mountHeroSpiral,
  spiral: mountSpiralFifths,
  comma: mountCommaLab,
  temper: mountTemperWheel,
  whytwelve: mountWhyTwelve,
  edo: mountEdoPlayer,
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
