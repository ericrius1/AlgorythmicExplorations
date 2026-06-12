import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountBonfire } from "../../demos/light/bonfire";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-fire": (el) => mountBonfire(el, { mode: "hero" }),
  sparks: (el) => mountBonfire(el, { mode: "sparks" }),
  room: (el) => mountBonfire(el, { mode: "room" }),
  dusk: (el) => mountBonfire(el, { mode: "dusk" }),
  fire: (el) => mountBonfire(el, { mode: "full" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
