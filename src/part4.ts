import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountAccretion } from "./demos/accretionGpu";
import { mountHashNeighbors } from "./demos/hashNeighbors";
import { mountTwoStructures } from "./scrolly/twoStructures";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-disk": (el) => mountAccretion(el, { mode: "disk", hero: true }),
  ghosts: (el) => mountAccretion(el, { mode: "collapse", physics: "gravity" }),
  hash: mountHashNeighbors,
  collapse: (el) => mountAccretion(el, { mode: "collapse", physics: "both" }),
  disk: (el) => mountAccretion(el, { mode: "disk" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

const scrollies: Record<string, (el: HTMLElement) => void> = {
  "two-structures": mountTwoStructures,
};
for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  scrollies[el.dataset.scrolly!]?.(el);
}
