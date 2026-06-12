import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountBearStudio } from "../../demos/bear/bearStudio";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-bear": (el) => mountBearStudio(el, { hero: true, view: "hero" }),
  parts: (el) => mountBearStudio(el, { view: "parts" }),
  loft: (el) => mountBearStudio(el, { view: "loft" }),
  sculpt: (el) => mountBearStudio(el, { view: "sculpt" }),
  final: (el) => mountBearStudio(el, { view: "final" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
