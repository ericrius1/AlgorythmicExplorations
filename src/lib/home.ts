// The way home, the same in every project on ericlevin.dev: the portfolio's mark (its tab's icon, a gold world in two
// rings) in a pill of the same glass as the controls' toggle, with the name beside it where there's room, back to
// ericlevin.dev. A page puts it in its own top row (at the start of its title, or beside its other round buttons);
// by default it floats top left. Self-contained (it brings its own CSS) so each project carries a copy: the canonical
// one is PortfolioII/src/shared/home.ts. It wears the kit's glass (kit.ts's --k-*, with their values to fall back on
// where a page has no kit); a page themes it further with --home-* on the link or above.

export const HOME = 'https://www.ericlevin.dev/';

const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <circle class="home-r2" cx="16" cy="16" r="14.5" fill="none" stroke="#B98CFF" stroke-width="1.6" opacity=".6" />
  <circle class="home-r1" cx="16" cy="16" r="11" fill="none" stroke="#6FE3F0" stroke-width="1.8" opacity=".8" />
  <circle cx="16" cy="16" r="7" fill="#E8C15A" />
</svg>`;

// (plain class selectors, put first in the head: a page's own rules for the link come later and win)
const CSS = `
.home-link {
  --home-ink: var(--k-text, #e9ecf8); --home-bg: rgba(10, 12, 20, 0.5); --home-edge: var(--k-line-2, rgba(160, 180, 255, 0.18));
  position: fixed; z-index: 60; top: max(12px, env(safe-area-inset-top)); left: max(12px, env(safe-area-inset-left));
  display: inline-flex; flex: none; align-items: center; gap: 8px; box-sizing: border-box; height: 38px; min-width: 38px; margin: 0;
  padding: 0 13px 0 8px; border-radius: 999px; border: 1px solid var(--home-edge); background: var(--home-bg); color: var(--home-ink);
  -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3);
  box-shadow: 0 6px 24px -10px rgba(0, 0, 0, 0.55);
  font: 500 11px/1 var(--k-mono, "JetBrains Mono"), ui-monospace, monospace; letter-spacing: 0.02em; text-decoration: none;
  white-space: nowrap; opacity: 0.72; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  transition: opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease;
}
.home-link.home-inline { position: relative; z-index: auto; top: auto; left: auto; }
.home-link:hover, .home-link:focus-visible { opacity: 1; border-color: var(--k-accent-edge, rgba(185, 140, 255, 0.45)); }
.home-link:focus-visible { outline: 2px solid var(--home-ink); outline-offset: 2px; }
.home-link svg { display: block; flex: none; width: 20px; height: 20px; overflow: visible; }
.home-link svg circle { transform-origin: 16px 16px; transition: transform 0.5s cubic-bezier(.16, 1, .3, 1); }
/* (the rings open out under the pointer) */
.home-link:hover .home-r1 { transform: scale(1.12); }
.home-link:hover .home-r2 { transform: scale(1.16); }
/* just the mark: asked for, or a phone */
.home-link.home-mark { padding: 0; width: 38px; justify-content: center; }
.home-link.home-mark span { display: none; }
@media (max-width: 640px) { .home-link { padding: 0; width: 38px; justify-content: center; } .home-link span { display: none; } }
@media (prefers-reduced-motion: reduce) { .home-link, .home-link svg circle { transition: none; } }
`;

export interface HomeOptions {
  /** where the link goes (a page's own row of buttons, or its title); by default it floats top left */
  mount?: HTMLElement;
  /** put it before this child of `mount` (its first, say) instead of after the last */
  before?: Element | null;
  /** just the mark, never the name beside it */
  mark?: boolean;
}

export function home(o: HomeOptions = {}): HTMLAnchorElement {
  if (!document.getElementById('home-link-css')) {
    const style = document.createElement('style');
    style.id = 'home-link-css';
    style.textContent = CSS;
    document.head.prepend(style);
  }
  const a = document.createElement('a');
  a.href = HOME;
  a.className = `home-link${o.mount ? ' home-inline' : ''}${o.mark ? ' home-mark' : ''}`;
  a.setAttribute('aria-label', 'ericlevin.dev: all the worlds');
  a.title = 'ericlevin.dev: all the worlds';
  a.innerHTML = `${MARK}<span>ericlevin.dev</span>`;
  // (a press on it isn't a press on whatever's under it: a world that plays to every touch, say)
  for (const t of ['pointerdown', 'touchstart', 'mousedown', 'wheel'] as const) a.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  const at = o.mount ?? document.body;
  at.insertBefore(a, o.before !== undefined ? o.before : null);
  return a;
}
