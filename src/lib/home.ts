// The way home, the same in every project on ericlevin.dev: the portfolio's mark (its tab's icon, a gold world in two
// rings) in a pill of the same glass as the controls' toggle, with the name beside it where there's room, back to
// ericlevin.dev; and right after it a second, smaller pill for getting in touch, an X (Twitter) and an envelope (an
// email). A page puts them in its own top row (at the start of its title, or beside its other round buttons); by
// default they float top left, in a row of their own. Self-contained (it brings its own CSS) so each project carries a
// copy: the canonical one is PortfolioII/src/shared/home.ts. It wears the kit's glass (kit.ts's --k-*, with their
// values to fall back on where a page has no kit); a page themes it further with --home-* on the link and the contact
// pill (.home-contact), or above.

export const HOME = 'https://www.ericlevin.dev/';
export const X = { href: 'https://x.com/ericlevin77', handle: '@ericlevin77' };
export const EMAIL = 'ericrius1@gmail.com';

const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <circle class="home-r2" cx="16" cy="16" r="14.5" fill="none" stroke="#B98CFF" stroke-width="1.6" opacity=".6" />
  <circle class="home-r1" cx="16" cy="16" r="11" fill="none" stroke="#6FE3F0" stroke-width="1.8" opacity=".8" />
  <circle cx="16" cy="16" r="7" fill="#E8C15A" />
</svg>`;
const X_MARK = `<svg class="home-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L1.8 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>`;
const MAIL = `<svg class="home-mail" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.2" /><path d="m3.8 7 8.2 6.2L20.2 7" /></svg>`;

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
/* the contact pill: the same glass, an X and an envelope side by side, each a finger-sized target */
.home-contact {
  --home-ink: var(--k-text, #e9ecf8); --home-bg: rgba(10, 12, 20, 0.5); --home-edge: var(--k-line-2, rgba(160, 180, 255, 0.18));
  display: inline-flex; flex: none; align-items: stretch; box-sizing: border-box; height: 38px; margin: 0; padding: 0 2px;
  border-radius: 999px; border: 1px solid var(--home-edge); background: var(--home-bg); color: var(--home-ink);
  -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3);
  box-shadow: 0 6px 24px -10px rgba(0, 0, 0, 0.55); opacity: 0.72; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  transition: opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease;
}
.home-contact:hover, .home-contact:focus-within { opacity: 1; border-color: var(--k-accent-edge, rgba(185, 140, 255, 0.45)); }
.home-contact a { display: grid; place-items: center; width: 32px; margin: 0; padding: 0; border-radius: 999px; color: inherit; text-decoration: none; }
.home-contact a:focus-visible { outline: 2px solid var(--home-ink); outline-offset: -2px; }
.home-contact svg { display: block; width: 15px; height: 15px; overflow: visible; transition: transform 0.3s ease; }
.home-contact a:hover svg { transform: scale(1.14); }
.home-contact .home-x { fill: currentColor; }
.home-contact .home-mail { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; stroke-linecap: round; }
/* floating (no row of the page's own to go in): the two together, top left */
.home-row {
  position: fixed; z-index: 60; top: max(12px, env(safe-area-inset-top)); left: max(12px, env(safe-area-inset-left));
  display: flex; align-items: center; gap: 8px; margin: 0;
}
@media (prefers-reduced-motion: reduce) { .home-contact, .home-contact svg { transition: none; } }
`;

export interface HomeOptions {
  /** where the link goes (a page's own row of buttons, or its title); by default it floats top left */
  mount?: HTMLElement;
  /** put it before this child of `mount` (its first, say) instead of after the last */
  before?: Element | null;
  /** just the mark, never the name beside it */
  mark?: boolean;
  /** leave out the contact pill (the X and the email) that comes right after it */
  contact?: boolean;
}

export function home(o: HomeOptions = {}): HTMLAnchorElement {
  if (!document.getElementById('home-link-css')) {
    const style = document.createElement('style');
    style.id = 'home-link-css';
    style.textContent = CSS;
    document.head.prepend(style);
  }
  const withContact = o.contact !== false;
  const a = document.createElement('a');
  a.href = HOME;
  // (floating with the contact pill, the two go in a row that floats: the link sits in it as it would in a page's own)
  a.className = `home-link${o.mount || withContact ? ' home-inline' : ''}${o.mark ? ' home-mark' : ''}`;
  a.setAttribute('aria-label', 'ericlevin.dev: all the worlds');
  a.title = 'ericlevin.dev: all the worlds';
  a.innerHTML = `${MARK}<span>ericlevin.dev</span>`;
  // (a press on it isn't a press on whatever's under it: a world that plays to every touch, say)
  quiet(a);
  let at = o.mount ?? document.body;
  let before = o.before !== undefined ? o.before : null;
  if (!o.mount && withContact) {
    const row = document.createElement('div');
    row.className = 'home-row';
    at.insertBefore(row, before);
    at = row;
    before = null;
  }
  at.insertBefore(a, before);
  if (withContact) at.insertBefore(contact(), before);
  return a;
}

/** the contact pill: the X (Twitter) and the email, each its own link */
function contact(): HTMLElement {
  const c = document.createElement('span');
  c.className = 'home-contact';
  c.innerHTML =
    `<a href="${X.href}" target="_blank" rel="noopener" aria-label="Eric Levin on X (Twitter), ${X.handle}" title="${X.handle}">${X_MARK}</a>` +
    `<a href="mailto:${EMAIL}" aria-label="Email Eric Levin, ${EMAIL}" title="${EMAIL}">${MAIL}</a>`;
  quiet(c);
  return c;
}

function quiet(el: HTMLElement) {
  for (const t of ['pointerdown', 'touchstart', 'mousedown', 'wheel'] as const) el.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
}
