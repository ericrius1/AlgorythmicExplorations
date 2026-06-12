import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountEuclid } from "../../demos/music/euclid";
import { mountMelodyWalk } from "../../demos/music/melodyWalk";
import { mountJukeboxGen } from "../../demos/music/jukeboxGen";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  euclid: (el) => mountEuclid(el),
  walk: (el) => mountMelodyWalk(el),
  jukebox: (el) => mountJukeboxGen(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
