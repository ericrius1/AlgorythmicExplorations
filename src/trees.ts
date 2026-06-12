import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountColonize2D, mountTreeStudio, mountGroveHero } from "./demos/treesDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-grove": (el) => mountGroveHero(el),
  colonize: (el) => mountColonize2D(el),
  studio: (el) => mountTreeStudio(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
