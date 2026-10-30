// The controls' toggle, the same in every project on ericlevin.dev: a sliders button with its key (/) on it shows or
// hides the page's interface (its panel, or the whole HUD), and / anywhere does the same. It shows by default (a panel
// that would cover the piece on a phone starts folded away there); folded, the button stays, dimmed, to bring it back.
// Whichever way it's left is kept, project by project. Self-contained (it brings its own CSS) so each project carries a
// copy: the canonical one is PortfolioII/src/shared/controls.ts. A page themes it with --ctl-* on the button or above.

const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <path d="M3 5h14M3 10h14M3 15h14" />
  <circle class="ctl-k1" cx="7" cy="5" r="2.2" /><circle class="ctl-k2" cx="13" cy="10" r="2.2" /><circle class="ctl-k3" cx="9" cy="15" r="2.2" />
</svg>`;

// (plain class selectors, put first in the head: a page's own rules for the button come later and win, while a reset
// for every button, being less specific, doesn't)
const CSS = `
.ctl-toggle {
  --ctl-ink: #f3eef5; --ctl-bg: rgba(14, 11, 20, 0.5); --ctl-edge: rgba(243, 238, 245, 0.16);
  --ctl-on-ink: #0b0910; --ctl-on-bg: rgba(243, 238, 245, 0.9); --ctl-on-edge: transparent;
  position: fixed; z-index: 60; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right));
  display: inline-flex; flex: none; align-items: center; gap: 7px; box-sizing: border-box; height: 38px; margin: 0; padding: 0 9px 0 11px;
  border-radius: 999px; border: 1px solid var(--ctl-edge); background: var(--ctl-bg); color: var(--ctl-ink);
  -webkit-backdrop-filter: blur(12px) saturate(1.3); backdrop-filter: blur(12px) saturate(1.3);
  box-shadow: 0 6px 24px -10px rgba(0, 0, 0, 0.55);
  font: 500 11px/1 "Space Mono", ui-monospace, monospace; cursor: pointer; opacity: 0.5;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  transition: opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}
.ctl-toggle.ctl-inline { position: relative; z-index: auto; top: auto; right: auto; }
.ctl-toggle:hover, .ctl-toggle:focus-visible { opacity: 1; }
.ctl-toggle:focus-visible { outline: 2px solid var(--ctl-ink); outline-offset: 2px; }
.ctl-toggle[aria-pressed="true"] { opacity: 1; background: var(--ctl-on-bg); color: var(--ctl-on-ink); border-color: var(--ctl-on-edge); }
.ctl-toggle svg { display: block; width: 18px; height: 18px; overflow: visible; }
.ctl-toggle path { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; opacity: 0.55; }
.ctl-toggle circle { fill: currentColor; transition: transform 0.35s cubic-bezier(.5, 0, .2, 1); }
/* folded: the knobs slide home */
.ctl-toggle[aria-pressed="false"] .ctl-k1 { transform: translateX(3px); }
.ctl-toggle[aria-pressed="false"] .ctl-k2 { transform: translateX(-3px); }
.ctl-toggle[aria-pressed="false"] .ctl-k3 { transform: translateX(1px); }
.ctl-toggle kbd {
  display: grid; place-items: center; box-sizing: border-box; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px;
  border: 1px solid currentColor; font: inherit; line-height: 1; opacity: 0.7;
}
/* no keyboard to press it with */
@media (hover: none) and (pointer: coarse) { .ctl-toggle kbd { display: none; } .ctl-toggle { padding: 0 11px; } }
@media (prefers-reduced-motion: reduce) { .ctl-toggle, .ctl-toggle circle { transition: none; } }
`;

export interface ControlsOptions {
  /** the project, for keeping its choice apart from the others' (localStorage `ericlevin.controls.<name>`) */
  name: string;
  /** shows or hides the page's interface */
  onChange(open: boolean): void;
  /** what it shows and hides, for its tooltip: 'the controls' by default */
  label?: string;
  /** shown by default on a phone too (an interface the page is used through); otherwise folded there */
  phone?: boolean;
  /** where the button goes (a page's own row of buttons); by default it floats top right */
  mount?: HTMLElement;
  /** while this says so, / is left alone (a film playing over the page, say) */
  paused?: () => boolean;
}

export interface Controls {
  readonly open: boolean;
  readonly button: HTMLButtonElement;
  /** shows or hides the panel; `keep` false leaves the kept choice as it was (a ?debug link, say) */
  set(open: boolean, keep?: boolean): void;
  toggle(): void;
}

const kept = (key: string): boolean | null => {
  try { const v = localStorage.getItem(key); return v === '1' ? true : v === '0' ? false : null; } catch { return null; }
};
const keep = (key: string, open: boolean) => { try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* private window */ } };
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

export function controls(o: ControlsOptions): Controls {
  if (!document.getElementById('ctl-toggle-css')) {
    const style = document.createElement('style');
    style.id = 'ctl-toggle-css';
    style.textContent = CSS;
    document.head.prepend(style);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = o.mount ? 'ctl-toggle ctl-inline' : 'ctl-toggle';
  const key = `ericlevin.controls.${o.name}`, label = o.label ?? 'the controls';
  button.setAttribute('aria-label', label.replace(/^the /, '').replace(/^./, (c) => c.toUpperCase()));
  button.setAttribute('aria-keyshortcuts', '/');
  button.innerHTML = `${ICON}<kbd aria-hidden="true">/</kbd>`;
  (o.mount ?? document.body).append(button);

  let open = false;
  const set = (v: boolean, k = true) => {
    open = v;
    button.setAttribute('aria-pressed', String(v));
    button.title = `${v ? 'Hide' : 'Show'} ${label}  ( / )`;
    if (k) keep(key, v);
    o.onChange(v);
  };
  button.addEventListener('click', () => set(!open));
  addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.repeat || typing(e.target) || o.paused?.()) return;
    e.preventDefault();
    set(!open);
  });
  set(kept(key) ?? (o.phone || !matchMedia('(max-width: 640px)').matches), false);
  return { get open() { return open; }, button, set, toggle: () => set(!open) };
}
