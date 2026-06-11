import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountLavaLamp } from "./demos/lavaLamp";
import { mountLavaTemp } from "./demos/lavaTemp";
import { mountRcPaint } from "./demos/rcPaint";
import { mountCascadeRays } from "./scrolly/cascadeRays";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-lamp": (el) => mountLavaLamp(el, { hero: true }),
  temp: mountLavaTemp,
  paint: mountRcPaint,
  lamp: (el) => mountLavaLamp(el, { full: true }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

const scrollies: Record<string, (el: HTMLElement) => void> = {
  "cascade-rays": mountCascadeRays,
};
for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  scrollies[el.dataset.scrolly!]?.(el);
}
