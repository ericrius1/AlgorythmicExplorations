import { initNav } from "../../lib/siteNav";
import { mountLazy, type Demo } from "../../lib/demoShell";
import { mountSoundControl } from "../../lib/music/soundControl";
import { mountHarmonograph } from "../../demos/music/sound/harmonograph";
import { mountBeats } from "../../demos/music/beats";
import { mountLissajous } from "../../demos/music/lissajous";
import { mountComb } from "../../demos/music/comb";
import "../../styles/music-sound.css";

initNav();
mountSoundControl();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  hero: mountHarmonograph,
  beats: mountBeats,
  lissajous: mountLissajous,
  comb: (el) => mountComb(el, { mode: "harmonic" }),
  timbre: (el) => mountComb(el, { mode: "timbre" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
