import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountAccompanist } from "./demos/accompanist";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  accompanist: mountAccompanist,
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}
