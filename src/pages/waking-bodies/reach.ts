import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountReachStudio } from "../../demos/bear/reachStudio";
import { mountFabrikChain } from "../../demos/bear/fabrikChain";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-reach": (el) => mountReachStudio(el, { hero: true, view: "hero" }),
  reach: (el) => mountReachStudio(el, { view: "reach" }),
  fabrik: (el) => mountFabrikChain(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
