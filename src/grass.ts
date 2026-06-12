import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountBladeAnatomy, mountMeadow, mountGrassHero } from "./demos/grassDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-grass": (el) => mountGrassHero(el),
  blade: (el) => mountBladeAnatomy(el),
  meadow: (el) => mountMeadow(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
