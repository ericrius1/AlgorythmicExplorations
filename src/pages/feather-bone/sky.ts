import "../../style.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountWorld, mountPilot, mountSandbox } from "../../demos/bird/birdSky";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-sky": (el) => mountSandbox(el, { hero: true }),
  world: (el) => mountWorld(el),
  pilot: (el) => mountPilot(el),
  sandbox: (el) => mountSandbox(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
