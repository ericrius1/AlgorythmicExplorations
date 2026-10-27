import "../../styles/music-harmony.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy, type Demo } from "../../lib/demoShell";
import { mountJukeboxGen } from "../../demos/music/jukeboxGen";
import { mountEuclid } from "../../demos/music/euclid";
import { mountMelodyWalk } from "../../demos/music/melodyWalk";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  hero: (el) => mountJukeboxGen(el, { mode: "hero" }),
  euclid: (el) => mountEuclid(el),
  walk: (el) => mountMelodyWalk(el),
  jukebox: (el) => mountJukeboxGen(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
