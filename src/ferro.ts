import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountFerro } from "./demos/ferroFluid";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-ferro": (el) => mountFerro(el, { hero: true }),
  mesh: (el) => mountFerro(el, { view: 1 }),
  ferro: (el) => mountFerro(el, { full: true }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
