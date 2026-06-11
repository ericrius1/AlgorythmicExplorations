import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountScaleRing } from "./demos/scaleRing";
import { mountFifthsKeys } from "./demos/fifthsKeys";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  hero: (el) => mountScaleRing(el, { mode: "hero" }),
  ring: (el) => mountScaleRing(el),
  keys: (el) => mountFifthsKeys(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
