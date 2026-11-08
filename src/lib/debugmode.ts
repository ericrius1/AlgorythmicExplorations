// The page's debug mode (; or ?debug / ?stats): one per page however many demos it holds, on the site's shared module
// (./debug.ts, a copy of PortfolioII/src/shared/debug.ts). Frame rate and time are the page's own (it ticks itself on
// requestAnimationFrame, only while open), then each demo's canvas and its line. Never in the normal page.
// On a page that plays notes from the keyboard (music/input.ts, demos/music/synth), ; is a key: there ?debug opens it.
import { makeDebug, type Debug } from "./debug";

export const keysPlay = { on: false };
let debug: Debug | null = null;
const demos: { canvas: HTMLCanvasElement; info: () => string }[] = [];

export function pageDebug(): Debug {
  if (debug) return debug;
  const d = makeDebug({ canvas: () => demos[0]?.canvas, corner: "bottom-left", blocked: () => keysPlay.on });
  d.rows("demos", () => demos.map((x, i) => [`${i + 1} · ${x.canvas.width}×${x.canvas.height}`, x.info() || "–"]));
  let raf = 0;
  const loop = (t: number) => { d.tick(t); raf = requestAnimationFrame(loop); };
  d.onChange((open) => { cancelAnimationFrame(raf); if (open) raf = requestAnimationFrame(loop); });
  if (d.open) raf = requestAnimationFrame(loop);
  return (debug = d);
}

/** a demo's canvas and its line, for the page's debug mode */
export function registerDemo(canvas: HTMLCanvasElement, info: () => string): void {
  demos.push({ canvas, info });
  pageDebug();
}
