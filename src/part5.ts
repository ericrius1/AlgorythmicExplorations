import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountCosmo } from "./demos/cosmoGpu";
import { mountFourierDraw } from "./demos/fourierDraw";
import { mountCicDeposit } from "./demos/cicDeposit";
import { mountPoissonPaint } from "./demos/poissonPaint";
import { mountFftButterfly } from "./demos/fftButterfly";
import { mountPoissonWaves } from "./scrolly/poissonWaves";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  "hero-web": (el) => mountCosmo(el, { mode: "web", hero: true }),
  fourier: mountFourierDraw,
  paint: mountPoissonPaint,
  butterfly: mountFftButterfly,
  cic: mountCicDeposit,
  collapse: (el) => mountCosmo(el, { mode: "collapse" }),
  web: (el) => mountCosmo(el, { mode: "web" }),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const kind = el.dataset.demo!;
  const make = mounts[kind];
  if (make) mountLazy(el, () => make(el));
}

const scrollies: Record<string, (el: HTMLElement) => void> = {
  "poisson-waves": mountPoissonWaves,
};
for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
  scrollies[el.dataset.scrolly!]?.(el);
}
