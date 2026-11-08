// Debug mode, on `;` (or ?debug / ?stats in the address to open it as the page loads): the numbers and views for
// whoever is building the thing, never in the normal interface. Frames a second and their time (the slowest tenth
// too), what the GPU takes of a frame where the browser can time it, GPU memory, the JS heap (Chrome on a computer)
// and the size the world is drawn at; then whatever the project adds: more rows (`rows`), switches (`flag`) and its
// own views (`view`, any element: a graph, a texture, a map). Nothing is measured while it's shut.
// Self-contained (its own CSS, no imports) so each project carries a copy, as it does kit.ts: the canonical one is
// PortfolioII/src/shared/debug.ts. Change it there first, then copy it into the projects.

/** what debug mode reads from the engine (weft's Kit has all of it; every field is optional) */
export interface DebugKit {
  renderScale?: number;
  profiler?: { readonly available: boolean; frameMs: number; force: boolean };
  memory?(): { total: number };
}

export type DebugRows = [string, string | number][];

export interface DebugOptions {
  /** the engine, once there is one */
  kit?: () => DebugKit | null | undefined;
  /** the canvas the world is drawn on (for its size) */
  canvas?: HTMLCanvasElement | (() => HTMLCanvasElement | null | undefined);
  /** GPU memory in bytes, where the project counts it itself rather than the kit */
  gpuBytes?: () => number | null | undefined;
  /** which corner it sits in (default bottom right) */
  corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** the key that opens and shuts it (default ;) */
  key?: string;
  /** address parameters that open it on load (default debug and stats) */
  params?: string[];
  /** z-index (default 60, over the panels) */
  z?: number;
  /** true while the key belongs to something else (an instrument being played, say) */
  blocked?: () => boolean;
}

export interface Debug {
  readonly open: boolean;
  readonly el: HTMLElement;
  show(open: boolean): void;
  toggle(): void;
  /** each frame, with performance.now() (does nothing while it's shut) */
  tick(now?: number): void;
  /** a block of rows under a title, read twice a second while open */
  rows(title: string, read: () => DebugRows): void;
  /** a switch: label, its state, what turning it does */
  flag(label: string, get: () => boolean, set: (on: boolean) => void): void;
  /** a button that does something once */
  action(label: string, run: () => void): void;
  /** a view of the project's own (any element); `update` runs with the rows while open */
  view(title: string, el: HTMLElement, update?: () => void): void;
  /** hear it open and shut (to start or stop costly views); returns the unsubscribe */
  onChange(fn: (open: boolean) => void): () => void;
  /** the frame numbers as of the last read (for tests and hooks) */
  readonly frame: { fps: number; ms: number; p90: number; gpuMs: number };
}

const CSS = `
.dbg { position: fixed; z-index: var(--dbg-z, 60); max-height: calc(100dvh - 24px); max-width: calc(100vw - 24px); overflow: auto; min-width: 190px;
  padding: 8px 11px 9px; border-radius: 10px; pointer-events: none; overscroll-behavior: contain;
  background: rgba(10, 12, 20, 0.78); border: 1px solid rgba(160, 180, 255, 0.16); color: #9aa2c0;
  font: 11px/1.5 "JetBrains Mono", ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.dbg[hidden] { display: none; }
.dbg.tl { top: max(12px, env(safe-area-inset-top)); left: max(12px, env(safe-area-inset-left)); }
.dbg.tr { top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); }
.dbg.bl { bottom: max(12px, env(safe-area-inset-bottom)); left: max(12px, env(safe-area-inset-left)); }
.dbg.br { bottom: max(12px, env(safe-area-inset-bottom)); right: max(12px, env(safe-area-inset-right)); }
.dbg .dbg-h { display: flex; justify-content: space-between; gap: 12px; color: #e9ecf8; letter-spacing: .04em; }
.dbg .dbg-h i { font-style: normal; color: #5b6283; }
.dbg .dbg-t { margin: 7px 0 2px; color: #5b6283; text-transform: lowercase; }
.dbg .dbg-g { display: grid; grid-template-columns: auto 1fr; gap: 0 14px; }
.dbg .dbg-g span { white-space: nowrap; }
.dbg .dbg-g b { font-weight: 400; color: #e9ecf8; text-align: right; white-space: nowrap; }
.dbg .dbg-g b.ok { color: #5ef0b5; } .dbg .dbg-g b.warn { color: #ffd479; } .dbg .dbg-g b.bad { color: #ff6b81; }
.dbg label, .dbg button { pointer-events: auto; cursor: pointer; }
.dbg label { display: flex; align-items: center; gap: 7px; color: #c9cee6; }
.dbg input[type=checkbox] { margin: 0; accent-color: #7fb2ff; }
.dbg button { margin: 3px 4px 0 0; padding: 2px 8px; border-radius: 6px; font: inherit; color: #c9cee6;
  background: transparent; border: 1px solid rgba(160, 180, 255, 0.25); }
.dbg button:hover { color: #fff; border-color: rgba(160, 180, 255, 0.5); }
.dbg .dbg-v { pointer-events: auto; margin-top: 3px; }
`;

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(b < 1e8 ? 1 : 0)} MB`);
const esc = (s: string) => s.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'));

export function makeDebug(o: DebugOptions = {}): Debug {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const box = document.createElement('div');
  box.className = `dbg ${({ 'top-left': 'tl', 'top-right': 'tr', 'bottom-left': 'bl', 'bottom-right': 'br' } as const)[o.corner ?? 'bottom-right']}`;
  box.hidden = true;
  box.setAttribute('aria-live', 'off');
  if (o.z) box.style.setProperty('--dbg-z', String(o.z));
  const key = o.key ?? ';';
  box.innerHTML = `<div class="dbg-h"><span>debug</span><i>${esc(key)} to shut</i></div><div class="dbg-g" data-frame></div>`;
  const frameGrid = box.querySelector('[data-frame]') as HTMLElement;
  const add = <T extends HTMLElement>(el: T): T => { box.append(el); return el; };
  const ready = () => document.body ? document.body.append(box) : addEventListener('DOMContentLoaded', () => document.body.append(box), { once: true });
  ready();

  let on = false, t0 = 0, last = 0, frames: number[] = [], forced: boolean | null = null;
  const blocks: { grid: HTMLElement; read: () => DebugRows }[] = [];
  const updates: (() => void)[] = [];
  const flags: { input: HTMLInputElement; get: () => boolean }[] = [];
  const listeners = new Set<(open: boolean) => void>();
  const frame = { fps: 0, ms: 0, p90: 0, gpuMs: 0 };
  const canvas = () => (typeof o.canvas === 'function' ? o.canvas() : o.canvas) ?? null;
  const grid = (rows: DebugRows) => rows.map(([a, b]) => `<span>${esc(a)}</span><b>${esc(String(b))}</b>`).join('');

  function read(now: number) {
    const k = o.kit?.() ?? null;
    const n = frames.length, sorted = frames.slice().sort((a, b) => a - b);
    frame.ms = n ? frames.reduce((a, b) => a + b, 0) / n : 0;
    frame.fps = frame.ms ? 1000 / frame.ms : 0;
    frame.p90 = n ? sorted[Math.floor(n * 0.9)] : 0;
    frame.gpuMs = k?.profiler?.available && k.profiler.frameMs > 0 ? k.profiler.frameMs : 0;
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    const gpuBytes = o.gpuBytes?.() ?? (k?.memory ? k.memory().total : null);
    const c = canvas();
    const fpsCls = frame.fps >= 55 ? 'ok' : frame.fps >= 30 ? 'warn' : 'bad';
    frameGrid.innerHTML = `<span>fps</span><b class="${n ? fpsCls : ''}">${n ? frame.fps.toFixed(0) : '–'}</b>` + grid([
      ['frame', `${frame.ms.toFixed(1)} ms · p90 ${frame.p90.toFixed(0)}`],
      ['gpu', frame.gpuMs ? `${frame.gpuMs.toFixed(1)} ms` : k?.profiler ? 'not timed here' : '–'],
      ['gpu mem', gpuBytes != null ? mb(gpuBytes) : '–'],
      ['js heap', heap ? mb(heap) : '–'],
      ['drawn at', c ? `${c.width}×${c.height}${k?.renderScale != null ? ` · ${Math.round(k.renderScale * 100)}%` : ''}` : '–'],
    ]);
    for (const b of blocks) { try { b.grid.innerHTML = grid(b.read()); } catch (e) { b.grid.textContent = String(e); } }
    for (const f of flags) f.input.checked = f.get();
    for (const u of updates) { try { u(); } catch { /* a view's own trouble stays its own */ } }
    frames = []; t0 = now;
  }

  function show(want: boolean) {
    if (want === on) return;
    on = want;
    box.hidden = !on;
    frames = []; t0 = performance.now(); last = 0;
    const p = o.kit?.()?.profiler;
    if (p) { if (on) { forced = p.force; p.force = true; } else if (forced !== null) { p.force = forced; forced = null; } }
    if (on) read(t0);
    for (const fn of listeners) fn(on);
  }

  function tick(now = performance.now()) {
    if (!on) return;
    const p = o.kit?.()?.profiler;
    if (p && !p.force) { forced ??= p.force; p.force = true; }
    if (last) frames.push(now - last);
    last = now;
    if (now - t0 >= 500) read(now);
  }

  addEventListener('keydown', (e) => {
    if (e.key !== key || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (o.blocked?.()) return;
    e.preventDefault();
    show(!on);
  });
  const q = new URLSearchParams(location.search);
  if ((o.params ?? ['debug', 'stats']).some((p) => q.has(p))) show(true);

  return {
    get open() { return on; },
    el: box,
    show, toggle: () => show(!on), tick, frame,
    rows(title, readRows) {
      const t = add(document.createElement('div')); t.className = 'dbg-t'; t.textContent = title;
      const g = add(document.createElement('div')); g.className = 'dbg-g';
      blocks.push({ grid: g, read: readRows });
    },
    flag(label, get, set) {
      const l = add(document.createElement('label'));
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = get();
      input.addEventListener('change', () => set(input.checked));
      l.append(input, label);
      flags.push({ input, get });
    },
    action(label, run) {
      const b = add(document.createElement('button')); b.type = 'button'; b.textContent = label;
      b.addEventListener('click', run);
    },
    view(title, el, update) {
      const t = add(document.createElement('div')); t.className = 'dbg-t'; t.textContent = title;
      const w = add(document.createElement('div')); w.className = 'dbg-v'; w.append(el);
      if (update) updates.push(update);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
