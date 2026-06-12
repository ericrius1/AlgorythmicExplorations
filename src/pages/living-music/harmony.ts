import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountBeats } from "../../demos/music/beats";
import { mountLissajous } from "../../demos/music/lissajous";
import { mountComb } from "../../demos/music/comb";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  beats: (el) => mountBeats(el),
  lissajous: (el) => mountLissajous(el),
  comb: (el) => mountComb(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
