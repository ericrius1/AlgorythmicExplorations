import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountFog } from "./demos/fog";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-mist": (el) => mountFog(el, { mode: "hero" }),
  halo: (el) => mountFog(el, { mode: "halo" }),
  shafts: (el) => mountFog(el, { mode: "shafts" }),
  forest: (el) => mountFog(el, { mode: "forest" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
