import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountSpiralFifths } from "../../demos/music/spiralFifths";
import { mountCommaLab } from "../../demos/music/commaLab";
import { mountWhyTwelve } from "../../demos/music/whyTwelve";

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
