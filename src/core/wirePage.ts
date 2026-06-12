// Shared page bootstrap: nav + lazy demo mounts + optional scrolly diagrams.
// Every essay entry module calls wirePage() once with its mount tables.

import { initNav } from "../lib/siteNav";
import { mountLazy, type Demo } from "../lib/demoShell";

export type DemoMount = (el: HTMLElement) => Demo | Promise<Demo>;
export type ScrollyMount = (el: HTMLElement) => void;

export function wirePage(
  demos: Record<string, DemoMount> = {},
  scrollies: Record<string, ScrollyMount> = {},
): void {
  initNav();

  for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
    const kind = el.dataset.demo!;
    const make = demos[kind];
    if (make) mountLazy(el, () => make(el));
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-scrolly]")) {
    const kind = el.dataset.scrolly!;
    scrollies[kind]?.(el);
  }
}
