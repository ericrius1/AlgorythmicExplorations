// The interface kit every project on ericlevin.dev builds its own UI from: Aether's (composer-steel.vercel.app/aether)
// glass and type — Fraunces for names, Inter for words, JetBrains Mono for numbers — its panel (a name, tabs, a body of
// sections, a foot for what's going on), its controls (a label over a thin track that fills to the accent, a white knob,
// the value in mono on the right; selects and buttons in outline; switches; segments), and the pieces a page lays over its
// canvas itself (pill buttons, a row of keys, a toast, a name in light). Each project composes its own interface from
// these, for what it is; the kit only makes them alike. One accent, turned by --k-hue (each project its own colour, as
// each of Aether's scenes has). Self-contained (it brings its own CSS and fonts) so each project carries a copy: the
// canonical one is PortfolioII/src/shared/kit.ts.

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,300;9..144,400&display=swap';
const CHEV = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238f97b5' fill='none' stroke-width='1.4'/%3E%3C/svg%3E")`;

// (plain class selectors, put first in the head: a page's own rules come later and win)
const CSS = `
:root {
  --k-hue: 210;
  --k-glass: rgba(14, 16, 26, 0.72); --k-glass-2: rgba(24, 27, 42, 0.66);
  --k-line: rgba(160, 180, 255, 0.1); --k-line-2: rgba(160, 180, 255, 0.18);
  --k-text: #e9ecf8; --k-label: #c9cee6; --k-muted: #8f97b5; --k-faint: #5b6283;
  --k-accent: hsl(var(--k-hue) 90% 68%); --k-accent-2: hsl(calc(var(--k-hue) + 40) 85% 70%);
  --k-accent-soft: hsl(var(--k-hue) 90% 68% / 0.16); --k-accent-edge: hsl(var(--k-hue) 90% 70% / 0.45);
  --k-rec: #ff4d6d; --k-ok: #5ef0b5;
  --k-ui: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --k-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
  --k-serif: "Fraunces", Georgia, serif;
}

/* the panel: under the controls' toggle, top right; a sheet from the bottom on a phone */
.k-panel {
  position: fixed; z-index: 20; top: calc(max(12px, env(safe-area-inset-top)) + 46px); right: max(12px, env(safe-area-inset-right));
  width: min(var(--k-w, 340px), calc(100vw - 24px)); max-height: calc(100dvh - max(12px, env(safe-area-inset-top)) - 58px);
  display: flex; flex-direction: column; box-sizing: border-box; color: var(--k-text); font: 400 12px/1.4 var(--k-ui); text-align: left;
  background: var(--k-glass); border: 1px solid var(--k-line); border-radius: 18px;
  -webkit-backdrop-filter: blur(22px) saturate(1.3); backdrop-filter: blur(22px) saturate(1.3);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55), inset 0 1px rgba(255, 255, 255, 0.05); -webkit-font-smoothing: antialiased;
  -webkit-user-select: none; user-select: none; transition: transform 0.45s cubic-bezier(.2, .8, .2, 1), opacity 0.35s, visibility 0.45s;
}
.k-panel.k-hidden { transform: translateX(calc(100% + 24px)); opacity: 0; visibility: hidden; pointer-events: none; }
.k-panel *, .k-panel *::before, .k-panel *::after { box-sizing: border-box; }
:where(.k-panel) :where(button, select, input) { font: inherit; color: inherit; margin: 0; }
.k-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; flex: none; }
.k-title { margin: 0; font: 300 22px/1.1 var(--k-serif); letter-spacing: 0.02em; white-space: nowrap; }
.k-sub { margin-left: auto; min-width: 0; color: var(--k-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.k-acts { display: flex; gap: 2px; flex: none; }
.k-acts:empty { display: none; }
.k-tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--k-line); flex: none; overflow-x: auto; scrollbar-width: none; }
.k-tabs::-webkit-scrollbar { display: none; }
.k-tab {
  flex: 1 0 auto; padding: 9px 6px 10px; border: 0; border-bottom: 2px solid transparent; background: none; cursor: pointer;
  font-size: 12px; letter-spacing: 0.03em; color: var(--k-muted); transition: color 0.2s, border-color 0.2s;
}
.k-tab:hover { color: var(--k-text); }
.k-tab.on { color: var(--k-text); border-bottom-color: var(--k-accent); }
.k-body {
  flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 14px 16px;
  scrollbar-width: thin; scrollbar-color: rgba(150, 160, 210, 0.25) transparent;
}
.k-foot { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; border-top: 1px solid var(--k-line); font: 11px var(--k-mono); color: var(--k-muted); }
.k-foot:empty { display: none; }
.k-gone { display: none !important; }

/* sections: a name in small capitals that folds them; inside another, a card */
.k-sec-h {
  display: flex; align-items: center; justify-content: space-between; width: 100%; margin: 12px 0 4px; padding: 2px; border: 0; background: none;
  cursor: pointer; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--k-faint); text-align: left;
}
.k-sec-h:hover { color: var(--k-muted); }
.k-sec-h i { width: 10px; height: 6px; background: ${CHEV} no-repeat center; opacity: 0.7; transition: transform 0.2s; }
.k-sec.k-shut > .k-sec-h i { transform: rotate(-90deg); }
.k-sec.k-shut > .k-sec-b { display: none; }
.k-sec .k-sec { border: 1px solid var(--k-line); background: var(--k-glass-2); border-radius: 14px; padding: 0 10px 4px; margin: 6px 0; }
.k-sec .k-sec > .k-sec-h { margin: 0; padding: 10px 2px 8px; font-size: 12.5px; text-transform: none; letter-spacing: 0; color: var(--k-label); }
.k-hint { margin: 2px 2px 8px; color: var(--k-faint); font-size: 11.5px; line-height: 1.5; }

/* a control: its label and value on a line, a slider under them */
.k-ctl { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 10px; min-height: 30px; padding: 4px 2px; }
.k-lab { font-size: 12.5px; color: var(--k-label); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.k-val {
  width: 62px; padding: 1px 3px; border: 0; border-radius: 5px; background: none; outline: none; text-align: right;
  font: 11px var(--k-mono); color: var(--k-muted); -webkit-user-select: text; user-select: text;
}
.k-val:hover { background: rgba(255, 255, 255, 0.04); }
.k-val:focus { background: rgba(255, 255, 255, 0.07); color: var(--k-text); }
.k-slider { grid-column: 1 / -1; position: relative; height: 18px; cursor: ew-resize; touch-action: none; outline: none; }
.k-track, .k-fill { position: absolute; top: 8px; height: 3px; border-radius: 3px; }
.k-track { left: 0; right: 0; background: rgba(160, 175, 230, 0.13); }
.k-fill { background: linear-gradient(90deg, hsl(var(--k-hue) 80% 60% / 0.6), var(--k-accent)); }
.k-knob {
  position: absolute; top: 3.5px; width: 11px; height: 11px; margin-left: -5.5px; border-radius: 50%; background: #f3f5ff;
  box-shadow: 0 0 0 3px hsl(var(--k-hue) 90% 68% / 0.18), 0 2px 6px rgba(0, 0, 0, 0.5); transition: box-shadow 0.15s;
}
.k-slider:hover .k-knob, .k-slider:focus-visible .k-knob, .k-slider.k-drag .k-knob { box-shadow: 0 0 0 5px hsl(var(--k-hue) 90% 68% / 0.28), 0 2px 6px rgba(0, 0, 0, 0.5); }
.k-sel {
  appearance: none; -webkit-appearance: none; min-width: 0; max-width: 200px; padding: 5px 26px 5px 9px; cursor: pointer; outline: none;
  background: rgba(255, 255, 255, 0.043) ${CHEV} no-repeat right 9px center; border: 1px solid var(--k-line); border-radius: 8px; font-size: 12px;
  text-overflow: ellipsis;
}
.k-sel:hover, .k-sel:focus-visible { border-color: var(--k-line-2); }
.k-sel option { background: #12141f; }
.k-switch { position: relative; flex: none; width: 32px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: rgba(160, 175, 230, 0.16); cursor: pointer; transition: background 0.2s; }
.k-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: #c6cbe4; transition: transform 0.2s, background 0.2s; }
.k-switch[aria-checked="true"] { background: hsl(var(--k-hue) 80% 60% / 0.55); }
.k-switch[aria-checked="true"]::after { transform: translateX(14px); background: #fff; }
.k-seg { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--k-line); border-radius: 999px; background: rgba(255, 255, 255, 0.03); }
.k-seg button { flex: 1; padding: 4px 11px; border: 0; border-radius: 999px; background: none; cursor: pointer; white-space: nowrap; font-size: 11.5px; color: var(--k-muted); transition: color 0.15s, background 0.15s; }
.k-seg button:hover { color: var(--k-text); }
.k-seg button.on { color: var(--k-text); background: var(--k-accent-soft); box-shadow: inset 0 0 0 1px hsl(var(--k-hue) 90% 70% / 0.35); }
.k-swatch { position: relative; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font: 11px var(--k-mono); color: var(--k-muted); }
.k-swatch i { width: 22px; height: 22px; border-radius: 7px; border: 1px solid var(--k-line-2); }
.k-swatch input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
/* a grid of small controls, each label over its select */
.k-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; margin: 6px 0 4px; }
.k-grid .k-ctl { display: block; min-height: 0; padding: 0; }
.k-grid .k-lab { display: block; margin-bottom: 3px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--k-faint); }
.k-grid .k-sel { width: 100%; max-width: none; }
/* buttons in the panel */
.k-row { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
.k-row > * { flex: 1 1 auto; }
.k-b {
  padding: 6px 10px; border: 1px solid var(--k-line); border-radius: 8px; background: rgba(255, 255, 255, 0.04); cursor: pointer;
  font-size: 12px; color: var(--k-label); transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.k-b:hover { border-color: var(--k-line-2); background: rgba(255, 255, 255, 0.08); color: var(--k-text); }
.k-b.on, .k-b[aria-pressed="true"] { border-color: var(--k-accent-edge); background: var(--k-accent-soft); color: var(--k-text); }
.k-b.k-wide { width: 100%; padding: 9px; margin-top: 6px; }
.k-b kbd { margin-left: 6px; font: 10px var(--k-mono); color: var(--k-faint); }
.k-icon {
  display: inline-grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 7px;
  background: none; cursor: pointer; font-size: 13px; color: var(--k-muted);
}
.k-icon:hover { color: var(--k-text); background: rgba(255, 255, 255, 0.06); }
.k-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--k-accent); box-shadow: 0 0 8px var(--k-accent); }

/* over the canvas: pill buttons (with a key on them), a row of keys, a toast, a name in light, glass */
.k-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 0 15px; border-radius: 999px;
  border: 1px solid var(--k-line-2); background: rgba(10, 12, 20, 0.5); color: var(--k-text); cursor: pointer; touch-action: manipulation;
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); font: 500 12.5px/1 var(--k-ui); letter-spacing: 0.02em; white-space: nowrap;
  -webkit-tap-highlight-color: transparent; transition: background 0.25s, border-color 0.25s, transform 0.12s;
}
.k-btn:hover { background: rgba(255, 255, 255, 0.09); border-color: rgba(200, 215, 255, 0.4); }
.k-btn:active { transform: scale(0.97); }
.k-btn:focus-visible { outline: 2px solid var(--k-accent); outline-offset: 2px; }
.k-btn.on, .k-btn[aria-pressed="true"] { background: var(--k-accent-soft); border-color: var(--k-accent-edge); }
.k-btn.primary { background: linear-gradient(135deg, hsl(var(--k-hue) 80% 60% / 0.35), hsl(calc(var(--k-hue) + 60) 80% 60% / 0.3)); border-color: hsl(var(--k-hue) 90% 75% / 0.5); }
.k-btn kbd, .k-keys kbd, kbd.k-kbd {
  display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border: 1px solid var(--k-line-2); border-radius: 5px;
  font: 500 10.5px/1 var(--k-mono); color: var(--k-muted);
}
.k-glass { background: var(--k-glass); border: 1px solid var(--k-line); border-radius: 14px; -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3); }
.k-keys { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 9px 14px; font: 12px var(--k-ui); color: var(--k-muted); }
.k-keys span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.k-name {
  font-family: var(--k-serif); font-weight: 300; letter-spacing: 0.02em; line-height: 1;
  background: linear-gradient(120deg, #cfe0ff, #f6d8ff 45%, #b9fff0); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.k-toast {
  position: fixed; left: 50%; bottom: max(34px, env(safe-area-inset-bottom)); z-index: 70; transform: translate(-50%, 10px); pointer-events: none;
  padding: 9px 16px; border-radius: 999px; background: rgba(10, 12, 20, 0.6); border: 1px solid var(--k-line); color: var(--k-text);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); font: 13px var(--k-ui); letter-spacing: 0.02em; opacity: 0;
  transition: opacity 0.35s, transform 0.35s;
}
.k-toast.on { opacity: 1; transform: translate(-50%, 0); }

@media (max-width: 640px) {
  .k-panel {
    top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: none; height: min(62dvh, 560px); border-radius: 18px 18px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .k-panel.k-hidden { transform: translateY(105%); }
  .k-tab { flex: none; padding: 11px 10px 12px; font-size: 13px; }
  .k-slider { height: 26px; }
  .k-track, .k-fill { top: 12px; }
  .k-knob { top: 6px; width: 15px; height: 15px; margin-left: -7.5px; }
}
@media (prefers-reduced-motion: reduce) { .k-panel, .k-toast, .k-switch::after { transition: none; } }
`;

let on = false;
/** puts the kit's CSS and fonts in the page (once); `hue` turns the accent */
export function kit(o: { hue?: number } = {}): void {
  if (o.hue !== undefined) document.documentElement.style.setProperty('--k-hue', String(o.hue));
  if (on) return;
  on = true;
  const style = document.createElement('style');
  style.id = 'k-kit-css';
  style.textContent = CSS;
  document.head.prepend(style);
  if (!document.querySelector(`link[href="${FONTS}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS;
    document.head.append(link);
  }
}

let toastEl: HTMLElement | null = null, toastT = 0;
/** a word at the bottom of the window, gone in a moment */
export function toast(text: string, ms = 2400): void {
  kit();
  if (!toastEl) { toastEl = el('div', 'k-toast'); toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastT);
  toastT = window.setTimeout(() => toastEl!.classList.remove('on'), ms);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

type Options = Record<string, unknown> | { text: string; value: unknown }[];
export interface BindOpts {
  label?: string;
  /** a number between these is a slider */
  min?: number; max?: number; step?: number;
  format?: (v: number) => string;
  /** a choice: a select, or segments with `seg` */
  options?: Options; seg?: boolean;
}
/** one control, bound to a property */
export interface Ctl<T = unknown> {
  readonly el: HTMLElement;
  /** reads the property again (it changed elsewhere) */
  refresh(): void;
  /** called when a hand changes it (never by a refresh) */
  on(fn: (v: T) => void): Ctl<T>;
  show(on: boolean): void;
}

const entries = (o: Options): [string, unknown][] =>
  Array.isArray(o) ? o.map((x) => [x.text, x.value]) : Object.entries(o);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const hex = (n: number) => Math.round(clamp(n, 0, 1) * 255).toString(16).padStart(2, '0');
/** the decimal places a number is written with (1e-7 too) */
const places = (x: number) => {
  const [m, e] = String(x).split('e-');
  return (m.split('.')[1]?.length ?? 0) + (e ? Number(e) : 0);
};

/** a column of controls: a panel's page, a section, a grid */
export class Group {
  protected kids: { refresh(): void }[] = [];
  constructor(readonly el: HTMLElement, protected key = '', protected store?: Store) {}

  bind<O extends object, K extends keyof O>(o: O, k: K, b: BindOpts = {}): Ctl<O[K]> {
    const fns: ((v: O[K]) => void)[] = [];
    const get = () => o[k];
    const put = (v: unknown) => { o[k] = v as O[K]; for (const f of fns) f(v as O[K]); };
    const row = el('div', 'k-ctl'), lab = el('span', 'k-lab', b.label ?? String(k));
    row.append(lab);
    const v0 = get();
    let refresh: () => void;
    if (b.options) refresh = choice(row, b, get, put);
    else if (typeof v0 === 'number' && b.min !== undefined && b.max !== undefined) refresh = slider(row, lab, b, get as () => number, put, v0);
    else if (typeof v0 === 'boolean') {
      const s = el('button', 'k-switch');
      s.type = 'button';
      s.setAttribute('role', 'switch');
      s.setAttribute('aria-label', lab.textContent!);
      s.addEventListener('click', () => { put(!get()); refresh(); s.blur(); });
      row.append(s);
      refresh = () => s.setAttribute('aria-checked', String(!!get()));
    } else if (typeof v0 === 'string' && v0.startsWith('#') || typeof v0 === 'object' && v0 && 'r' in v0) refresh = colour(row, get, put);
    else {
      const t = el('input', 'k-val');
      t.addEventListener('change', () => { put(typeof v0 === 'number' ? Number(t.value) || 0 : t.value); t.blur(); });
      row.append(t);
      refresh = () => { if (document.activeElement !== t) t.value = String(get()); };
    }
    refresh();
    this.el.append(row);
    this.kids.push({ refresh });
    const c: Ctl<O[K]> = { el: row, refresh, on: (f) => { fns.push(f); return c; }, show: (v) => row.classList.toggle('k-gone', !v) };
    return c;
  }

  /** a titled part that folds (kept folded or not, if the panel has a name) */
  section(title: string, open = true): Group {
    const sec = el('div', 'k-sec'), head = el('button', 'k-sec-h', title), body = el('div', 'k-sec-b');
    head.type = 'button';
    head.append(el('i'));
    sec.append(head, body);
    this.el.append(sec);
    const key = `${this.key}/${title}`;
    const shut = this.store?.shut(key) ?? !open;
    sec.classList.toggle('k-shut', shut);
    head.setAttribute('aria-expanded', String(!shut));
    head.addEventListener('click', () => {
      const s = sec.classList.toggle('k-shut');
      head.setAttribute('aria-expanded', String(!s));
      this.store?.setShut(key, s);
    });
    return this.child(new Group(body, key, this.store), sec);
  }

  /** small controls two to a row, each label over its control */
  grid(): Group { const g = el('div', 'k-grid'); this.el.append(g); return this.child(new Group(g, this.key, this.store), g); }

  /** buttons side by side */
  row(): Group { const r = el('div', 'k-row'); this.el.append(r); return this.child(new Group(r, this.key, this.store), r); }

  button(title: string, fn: () => void, o: { wide?: boolean; key?: string } = {}): HTMLButtonElement {
    const b = el('button', o.wide ? 'k-b k-wide' : 'k-b', title);
    b.type = 'button';
    if (o.key) b.append(Object.assign(el('kbd'), { textContent: o.key }));
    b.addEventListener('click', () => { fn(); b.blur(); });
    this.el.append(b);
    return b;
  }

  hint(text: string): HTMLElement { const p = el('p', 'k-hint', text); this.el.append(p); return p; }

  show(on: boolean): void { (this.box ?? this.el).classList.toggle('k-gone', !on); }

  refresh(): void { for (const k of this.kids) k.refresh(); }

  protected box?: HTMLElement;
  private child(g: Group, box: HTMLElement): Group { g.box = box; this.kids.push(g); return g; }
}

function choice(row: HTMLElement, b: BindOpts, get: () => unknown, put: (v: unknown) => void): () => void {
  const list = entries(b.options!);
  const at = () => list.findIndex(([, v]) => v === get());
  if (b.seg) {
    const seg = el('div', 'k-seg');
    const btns = list.map(([text, v]) => {
      const x = el('button', '', text);
      x.type = 'button';
      x.addEventListener('click', () => { if (get() !== v) put(v); refresh(); x.blur(); });
      seg.append(x);
      return x;
    });
    row.append(seg);
    const refresh = () => { const i = at(); btns.forEach((x, j) => x.classList.toggle('on', j === i)); };
    return refresh;
  }
  const s = el('select', 'k-sel');
  s.setAttribute('aria-label', row.textContent!);
  list.forEach(([text], i) => s.append(Object.assign(el('option', '', text), { value: String(i) })));
  s.addEventListener('change', () => { put(list[Number(s.value)][1]); s.blur(); });
  row.append(s);
  return () => { s.value = String(at()); };
}

function slider(row: HTMLElement, lab: HTMLElement, b: BindOpts, get: () => number, put: (v: number) => void, v0: number): () => void {
  const min = b.min!, max = b.max!, span = max - min || 1;
  // (steps count from min, and the value shows as many places as the step and min have: 0.25 stays 0.25)
  const step = b.step ?? Number((10 ** Math.floor(Math.log10(span)) / 100).toPrecision(1));
  const dec = Math.min(10, Math.max(places(step), b.step ? places(min) : 0));
  const fmt = b.format ?? ((v: number) => v.toFixed(dec));
  const zero = min < 0 && max > 0 ? -min / span : 0;
  const val = el('input', 'k-val'), s = el('div', 'k-slider'), fill = el('i', 'k-fill'), knob = el('i', 'k-knob');
  s.append(el('i', 'k-track'), fill, knob);
  s.tabIndex = 0;
  s.setAttribute('role', 'slider');
  s.setAttribute('aria-label', lab.textContent!);
  s.setAttribute('aria-valuemin', String(min));
  s.setAttribute('aria-valuemax', String(max));
  row.append(val, s);
  const set = (v: number) => {
    v = clamp(+(min + Math.round((clamp(v, min, max) - min) / step) * step).toFixed(dec), min, max);
    if (v !== get()) put(v);
    draw();
  };
  const draw = () => {
    const v = get(), t = clamp((v - min) / span, 0, 1);
    fill.style.left = `${Math.min(t, zero) * 100}%`;
    fill.style.width = `${Math.abs(t - zero) * 100}%`;
    knob.style.left = `${t * 100}%`;
    s.setAttribute('aria-valuenow', String(v));
    if (document.activeElement !== val) val.value = fmt(v);
  };
  const at = (e: PointerEvent) => { const r = s.getBoundingClientRect(); set(min + clamp((e.clientX - r.left) / r.width, 0, 1) * span); };
  s.addEventListener('pointerdown', (e) => { if (e.button) return; s.setPointerCapture(e.pointerId); s.classList.add('k-drag'); at(e); e.preventDefault(); });
  s.addEventListener('pointermove', (e) => { if (s.hasPointerCapture(e.pointerId)) at(e); });
  const end = () => { s.classList.remove('k-drag'); s.blur(); };
  s.addEventListener('pointerup', end);
  s.addEventListener('pointercancel', end);
  s.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (d) { set(get() + d * Math.max(step, span / 100) * (e.shiftKey ? 10 : 1)); e.preventDefault(); e.stopPropagation(); }
  });
  // the value can be typed; a double click on the label puts it back as it started
  val.addEventListener('focus', () => val.select());
  val.addEventListener('change', () => { const v = parseFloat(val.value); if (Number.isFinite(v)) set(v); val.blur(); });
  val.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') draw(); val.blur(); } e.stopPropagation(); });
  val.addEventListener('blur', draw);
  lab.title = `${lab.textContent} · double-click: back as it was`;
  lab.addEventListener('dblclick', () => set(v0));
  return draw;
}

function colour(row: HTMLElement, get: () => unknown, put: (v: unknown) => void): () => void {
  const w = el('label', 'k-swatch'), code = el('span'), sw = el('i'), input = el('input');
  input.type = 'color';
  w.append(code, sw, input);
  row.append(w);
  const toHex = (v: unknown): string => {
    if (typeof v === 'string') return v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v.slice(0, 7);
    const c = v as { r: number; g: number; b: number }, f = Math.max(c.r, c.g, c.b) <= 1 ? 1 : 255;
    return `#${hex(c.r / f)}${hex(c.g / f)}${hex(c.b / f)}`;
  };
  input.addEventListener('input', () => {
    const h = input.value, v = get();
    if (typeof v === 'string') put(h);
    else {
      const c = v as { r: number; g: number; b: number }, f = Math.max(c.r, c.g, c.b) <= 1 ? 1 : 255;
      const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255 * f;
      c.r = n(1); c.g = n(3); c.b = n(5);
      put(c);
    }
    refresh();
  });
  const refresh = () => { const h = toHex(get()); code.textContent = h; sw.style.background = h; input.value = h; };
  return refresh;
}

class Store {
  private s: { tab?: number; shut?: Record<string, boolean> } = {};
  constructor(private key: string) { try { this.s = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* none kept */ } }
  shut(k: string): boolean | undefined { return this.s.shut?.[k]; }
  setShut(k: string, v: boolean) { (this.s.shut ??= {})[k] = v; this.save(); }
  get tab() { return this.s.tab ?? 0; }
  set tab(i: number) { this.s.tab = i; this.save(); }
  private save() { try { localStorage.setItem(this.key, JSON.stringify(this.s)); } catch { /* private window */ } }
}

export interface PanelOptions {
  title: string;
  /** keeps which tab and which sections were left open (localStorage `ericlevin.kit.<name>`) */
  name?: string;
  /** a line beside the name (what's playing, say) */
  sub?: string;
  /** its pages, one tab each; without, the panel is one page */
  tabs?: string[];
  /** for the page's own placing and sizing */
  className?: string;
}

/** the panel: a name, tabs, a body of sections, a foot. It starts hidden: show() it (the controls' toggle says when). */
export class Panel extends Group {
  readonly root: HTMLElement;
  readonly acts: HTMLElement;
  readonly foot: HTMLElement;
  readonly pages: Group[] = [];
  private subEl: HTMLElement;
  private tabsEl: HTMLElement | null = null;
  private body: HTMLElement;
  private shown = false;

  constructor(o: PanelOptions) {
    kit();
    const root = el('aside', `k-panel k-hidden${o.className ? ` ${o.className}` : ''}`);
    const body = el('div', 'k-body');
    const store = o.name ? new Store(`ericlevin.kit.${o.name}`) : undefined;
    super(body, '', store);
    this.root = root;
    this.body = body;
    root.setAttribute('aria-label', o.title);
    root.inert = true;
    const head = el('header', 'k-head');
    this.subEl = el('span', 'k-sub', o.sub ?? '');
    this.acts = el('span', 'k-acts');
    head.append(el('h2', 'k-title', o.title), this.subEl, this.acts);
    this.foot = el('footer', 'k-foot');
    root.append(head);
    if (o.tabs) {
      this.tabsEl = el('nav', 'k-tabs');
      this.tabsEl.setAttribute('role', 'tablist');
      root.append(this.tabsEl);
    }
    root.append(body, this.foot);
    document.body.append(root);
    for (const t of o.tabs ?? []) this.page(t);
    if (this.pages.length) this.select(Math.min(store?.tab ?? 0, this.pages.length - 1), false);
  }

  /** adds a page (and its tab) */
  page(title: string): Group {
    if (!this.tabsEl) throw new Error('a panel without tabs has one page');
    const i = this.pages.length, box = el('div', 'k-page'), tab = el('button', 'k-tab', title);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => { this.select(i); tab.blur(); });
    this.tabsEl.append(tab);
    this.body.append(box);
    const g = new Group(box, title, this.store);
    this.pages.push(g);
    this.kids.push(g);
    if (i) box.classList.add('k-gone');
    return g;
  }

  /** shows a page */
  select(i: number, keep = true): void {
    this.pages.forEach((p, j) => p.el.classList.toggle('k-gone', j !== i));
    this.tabsEl?.querySelectorAll('.k-tab').forEach((t, j) => { t.classList.toggle('on', j === i); t.setAttribute('aria-selected', String(j === i)); });
    this.body.scrollTop = 0;
    if (keep && this.store) this.store.tab = i;
  }

  set sub(text: string) { this.subEl.textContent = text; }

  /** a small button by the name */
  icon(glyph: string, label: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'k-icon', glyph);
    b.type = 'button';
    b.title = b.ariaLabel = label;
    b.addEventListener('click', () => { fn(); b.blur(); });
    this.acts.append(b);
    return b;
  }

  get open(): boolean { return this.shown; }
  show(open: boolean): void {
    this.shown = open;
    this.root.classList.toggle('k-hidden', !open);
    this.root.inert = !open;
    if (open) this.refresh();
  }
}
