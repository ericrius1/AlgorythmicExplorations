import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountCrown } from "../../demos/ferro/ferroCrown";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-crown": (el) => mountCrown(el, { hero: true }),
  moments: (el) => mountCrown(el, { view: 4 }),
  duel: (el) => mountCrown(el, { duel: true }),
  crown: (el) => mountCrown(el, { full: true }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
