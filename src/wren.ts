import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountBirdFull, mountBirdParts, mountBirdSlice, mountBirdNets } from "./demos/birdModel";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-bird": (el) => mountBirdFull(el, { hero: true }),
  parts: (el) => mountBirdParts(el),
  slice: (el) => mountBirdSlice(el),
  nets: (el) => mountBirdNets(el),
  "bird-full": (el) => mountBirdFull(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
