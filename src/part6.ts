import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountPlayground } from "./demos/playground";
import { mountFlowField } from "./demos/flowField";
import { mountHandViz } from "./demos/handViz";
import { mountProjection } from "./scrolly/projection";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-toy": (el) => mountPlayground(el, { hero: true }),
  flow: mountFlowField,
  hand: mountHandViz,
  playground: (el) => mountPlayground(el, {}),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

const scrollies: Record<string, (el: HTMLElement) => void> = {
  projection: mountProjection,
};
for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  scrollies[el.dataset.scrolly!]?.(el);
}
