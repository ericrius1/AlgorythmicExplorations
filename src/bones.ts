import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountRigWeights, mountRigFK, mountRigPose, mountRigAlive } from "./demos/birdRig";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-rig": (el) => mountRigAlive(el, { hero: true }),
  weights: (el) => mountRigWeights(el),
  fk: (el) => mountRigFK(el),
  pose: (el) => mountRigPose(el),
  alive: (el) => mountRigAlive(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
