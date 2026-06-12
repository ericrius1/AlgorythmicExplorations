import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountOscillo } from "../../demos/music/oscillo";
import { mountPluckString } from "../../demos/music/pluckString";
import { mountHarmonics } from "../../demos/music/harmonics";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  oscillo: (el) => mountOscillo(el),
  string: (el) => mountPluckString(el),
  harmonics: (el) => mountHarmonics(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
