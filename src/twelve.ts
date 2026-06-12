import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountSpiralFifths } from "./demos/spiralFifths";
import { mountCommaLab } from "./demos/commaLab";
import { mountWhyTwelve } from "./demos/whyTwelve";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  spiral: (el) => mountSpiralFifths(el),
  comma: (el) => mountCommaLab(el),
  whytwelve: (el) => mountWhyTwelve(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
