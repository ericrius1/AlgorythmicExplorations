import "../style.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountWingIK, mountUnfold, mountFlapCycle, mountFlapAll } from "../../demos/bird/birdWing";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-wing": (el) => mountFlapAll(el, { hero: true }),
  reach: (el) => mountWingIK(el),
  unfold: (el) => mountUnfold(el),
  cycle: (el) => mountFlapCycle(el),
  all: (el) => mountFlapAll(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
