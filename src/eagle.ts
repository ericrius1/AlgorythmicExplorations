import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountBirdFull, mountBirdStations, mountBirdLoft, mountFeather, mountCoat } from "./demos/birdModel";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-bird": (el) => mountBirdFull(el, { hero: true }),
  stations: (el) => mountBirdStations(el),
  loft: (el) => mountBirdLoft(el),
  feather: (el) => mountFeather(el),
  coat: (el) => mountCoat(el),
  "bird-full": (el) => mountBirdFull(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
