import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountDropletTrace, mountErode3D, mountErosionHero } from "../../demos/terrain/erosionDemos";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-erosion": (el) => mountErosionHero(el),
  droplets: (el) => mountDropletTrace(el),
  erode: (el) => mountErode3D(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
