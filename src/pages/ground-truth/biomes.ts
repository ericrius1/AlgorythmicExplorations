import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountBiomeMap, mountBiomePatch, mountBiomesHero } from "../../demos/terrain/biomesDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-biomes": (el) => mountBiomesHero(el),
  map: (el) => mountBiomeMap(el),
  patch: (el) => mountBiomePatch(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
