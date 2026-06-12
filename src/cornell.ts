import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountCornell } from "./demos/cornell";
import { mountPhotonWalk } from "./scrolly/photonWalk";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-box": (el) => mountCornell(el, { mode: "hero" }),
  noise: (el) => mountCornell(el, { mode: "noise" }),
  nee: (el) => mountCornell(el, { mode: "nee" }),
  bounces: (el) => mountCornell(el, { mode: "bounces" }),
  full: (el) => mountCornell(el, { mode: "full" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  if (el.dataset.scrolly === "photon-walk") mountPhotonWalk(el);
}
