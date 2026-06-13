import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountDish } from "../../demos/ferro/ferroDish";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-relief": (el) => mountDish(el, { hero: true, extractor: "dc" }),
  pipeline: (el) => mountDish(el, { pipeline: true, extractor: "tets" }),
  relief: (el) => mountDish(el, { full: true, extractor: "dc" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
