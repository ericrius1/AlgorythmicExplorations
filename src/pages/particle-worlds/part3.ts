import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountContactsCpu } from "../../demos/particle/contactsCpu";
import { mountGridNeighbors } from "../../demos/particle/gridNeighbors";
import { mountScanViz } from "../../demos/particle/scanViz";
import { mountFluid } from "../../demos/particle/fluidGpu";
import { mountSortPipeline } from "../../scrolly/sortPipeline";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-fluid": (el) => mountFluid(el, { mode: "sph", count: 45000, hero: true }),
  "naive-contacts": mountContactsCpu,
  "grid-cursor": mountGridNeighbors,
  scan: mountScanViz,
  grains: (el) => mountFluid(el, { mode: "grains", count: 12000 }),
  sph: (el) => mountFluid(el, { mode: "sph", count: 50000 }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

const scrollies: Record<string, (el: HTMLElement) => void> = {
  "sort-pipeline": mountSortPipeline,
};
for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  scrollies[el.dataset.scrolly!]?.(el);
}
