import "../style.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountForceDiagram, mountGlide, mountBankedTurn, mountFreeFlight } from "../../demos/bird/birdFlight";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-flight": (el) => mountFreeFlight(el, { hero: true }),
  forces: (el) => mountForceDiagram(el),
  glide: (el) => mountGlide(el),
  bank: (el) => mountBankedTurn(el),
  free: (el) => mountFreeFlight(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
