import "../style.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountApproach, mountFlare, mountSong, mountLandingAct } from "../../demos/bird/birdLanding";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-landing": (el) => mountLandingAct(el, { hero: true }),
  approach: (el) => mountApproach(el),
  flare: (el) => mountFlare(el),
  song: (el) => mountSong(el),
  act: (el) => mountLandingAct(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
