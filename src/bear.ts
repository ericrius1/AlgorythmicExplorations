import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountBearStudio } from "./demos/bearStudio";
import { mountSminSlice } from "./demos/sminSlice";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-bear": (el) => mountBearStudio(el, { hero: true, view: "hero" }),
  parts: (el) => mountBearStudio(el, { view: "parts" }),
  smin: (el) => mountSminSlice(el),
  sculpt: (el) => mountBearStudio(el, { view: "sculpt" }),
  march: (el) => mountBearStudio(el, { view: "march" }),
  final: (el) => mountBearStudio(el, { view: "final" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
