import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountPrism } from "./demos/prism";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-prism": (el) => mountPrism(el, { mode: "hero" }),
  bench: (el) => mountPrism(el, { mode: "bench" }),
  caustics: (el) => mountPrism(el, { mode: "caustics" }),
  full: (el) => mountPrism(el, { mode: "full" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
