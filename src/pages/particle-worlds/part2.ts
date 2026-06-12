import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountNaive3D } from "../../demos/particle/naive3dGpu";
import { mountPyramid3D } from "../../demos/particle/pyramid3dGpu";
import { mountDomeSpring } from "../../scrolly/domeSpring";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-dome": (el) => mountPyramid3D(el, { count: 20000, steps: 2, dome: true, hero: true }),
  "naive-3d": mountNaive3D,
  "pyramid-3d": (el) => mountPyramid3D(el, { count: 20000 }),
  "dome-morph": (el) => mountPyramid3D(el, { count: 20000, dome: true, domeSlider: true }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

const scrollies: Record<string, (el: HTMLElement) => void> = {
  "dome-spring": mountDomeSpring,
};
for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  scrollies[el.dataset.scrolly!]?.(el);
}
