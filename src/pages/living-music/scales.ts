import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountScaleRing } from "../../demos/music/scaleRing";
import { mountFifthsKeys } from "../../demos/music/fifthsKeys";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  ring: (el) => mountScaleRing(el),
  keys: (el) => mountFifthsKeys(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
