import "../../styles/music-harmony.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy, type Demo } from "../../lib/demoShell";
import { mountSoundControl } from "../../lib/music/soundControl";
import { mountJukeboxGen } from "../../demos/music/jukeboxGen";
import { mountEuclid } from "../../demos/music/euclid";
import { mountPoly } from "../../demos/music/harmony/poly";
import { mountSwing } from "../../demos/music/harmony/swing";
import { mountMelodyWalk } from "../../demos/music/melodyWalk";

initNav();
mountSoundControl();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  hero: (el) => mountJukeboxGen(el, { mode: "hero" }),
  euclid: (el) => mountEuclid(el),
  poly: (el) => mountPoly(el),
  swing: (el) => mountSwing(el),
  walk: (el) => mountMelodyWalk(el),
  jukebox: (el) => mountJukeboxGen(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
