import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountOctaves1D, mountMap2D, mountRelief, mountTerrainHero } from "./demos/terrainDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-terrain": (el) => mountTerrainHero(el),
  octaves: (el) => mountOctaves1D(el),
  map: (el) => mountMap2D(el),
  relief: (el) => mountRelief(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
