import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountNoteHero } from "./demos/noteHero";
import { mountOscillo } from "./demos/oscillo";
import { mountPluckString } from "./demos/pluckString";
import { mountHarmonics } from "./demos/harmonics";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  hero: (el) => mountNoteHero(el),
  oscillo: (el) => mountOscillo(el),
  string: (el) => mountPluckString(el),
  harmonics: (el) => mountHarmonics(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
