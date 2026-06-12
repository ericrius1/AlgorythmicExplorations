import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountRigStudio } from "./demos/rigStudio";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-rig": (el) => mountRigStudio(el, { hero: true, view: "hero" }),
  fk: (el) => mountRigStudio(el, { view: "fk" }),
  weights: (el) => mountRigStudio(el, { view: "weights" }),
  skin: (el) => mountRigStudio(el, { view: "skin" }),
  dance: (el) => mountRigStudio(el, { view: "dance" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
