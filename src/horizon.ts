import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountChunkDiagram, mountInfiniteFlight, mountHorizonHero } from "./demos/horizonDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-horizon": (el) => mountHorizonHero(el),
  rings: (el) => mountChunkDiagram(el),
  flight: (el) => mountInfiniteFlight(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
