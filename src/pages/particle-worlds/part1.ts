import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountSlingshot } from "../../demos/particle/slingshot";
import { mountNaiveCpu } from "../../demos/particle/naiveCpu";
import { mountNaiveGpu } from "../../demos/particle/naiveGpu";
import { mountBarnesHut } from "../../demos/particle/barnesHut";
import { mountPyramidLevels } from "../../demos/particle/pyramidLevels";
import { mountPyramidGpu } from "../../demos/particle/pyramidGpu";
import { mountBhWalk } from "../../scrolly/bhWalk";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  hero: (el) => mountPyramidGpu(el, { count: 20000, steps: 2, hero: true }),
  slingshot: mountSlingshot,
  "naive-cpu": mountNaiveCpu,
  "naive-gpu": mountNaiveGpu,
  "barnes-hut": mountBarnesHut,
  "pyramid-levels": mountPyramidLevels,
  "pyramid-gpu": (el) => mountPyramidGpu(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

const scrollies: Record<string, (el: HTMLElement) => void> = {
  "bh-walk": mountBhWalk,
};
for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  scrollies[el.dataset.scrolly!]?.(el);
}
