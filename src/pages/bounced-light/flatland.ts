import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountSculpt } from "../../demos/light/sculpt";
import { mountSphereMarch } from "../../scrolly/sphereMarch";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-sculpt": (el) => mountSculpt(el, { mode: "hero" }),
  blend: (el) => mountSculpt(el, { mode: "blend" }),
  steps: (el) => mountSculpt(el, { mode: "steps" }),
  shade: (el) => mountSculpt(el, { mode: "shade" }),
  full: (el) => mountSculpt(el, { mode: "full" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  if (el.dataset.scrolly === "sphere-march") mountSphereMarch(el);
}
