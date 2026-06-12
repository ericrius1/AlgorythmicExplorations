import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountQigongStudio } from "./demos/qigongStudio";
import { mountSpringTrace } from "./demos/springTrace";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-qigong": (el) => mountQigongStudio(el, { hero: true, view: "hero" }),
  springs: (el) => mountSpringTrace(el),
  form: (el) => mountQigongStudio(el, { view: "form" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
