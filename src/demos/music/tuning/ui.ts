// DOM bits the tuning figures share: segmented "chip" pickers, a play
// toggle, and the hero's tap-to-play badge. Styles live in
// src/styles/music-tuning.css.

import { Group } from "../../../lib/kit";

export interface ChipOpts<T> {
  label?: string;
  options: { value: T; text: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  wide?: boolean;
}

export interface Chips<T> {
  el: HTMLDivElement;
  set(v: T, fire?: boolean): void;
  get(): T;
}

export function chips<T>(parent: HTMLElement, o: ChipOpts<T>): Chips<T> {
  const el = document.createElement("div");
  el.className = "tn-chips" + (o.wide ? " tn-chips-wide" : "");
  el.setAttribute("role", "radiogroup");
  if (o.label) {
    const l = document.createElement("span");
    l.className = "tn-chips-label";
    l.textContent = o.label;
    el.appendChild(l);
    el.setAttribute("aria-label", o.label);
  }
  const row = document.createElement("span");
  row.className = "tn-chips-row";
  el.appendChild(row);
  let cur = o.value;
  const btns: HTMLButtonElement[] = [];
  const sync = (): void => {
    btns.forEach((b, i) => {
      const on = o.options[i].value === cur;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
    });
  };
  o.options.forEach((opt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tn-chip";
    b.setAttribute("role", "radio");
    b.textContent = opt.text;
    if (opt.title) b.title = opt.title;
    b.addEventListener("click", () => {
      cur = opt.value;
      sync();
      o.onChange(cur);
    });
    row.appendChild(b);
    btns.push(b);
  });
  sync();
  parent.appendChild(el);
  return {
    el,
    set(v: T, fire = false) {
      cur = v;
      sync();
      if (fire) o.onChange(v);
    },
    get: () => cur,
  };
}

// A button whose label flips between two states.
export function toggle(
  parent: HTMLElement,
  labels: [string, string],
  onChange: (on: boolean) => void,
  cls = "",
): { el: HTMLButtonElement; set(on: boolean): void; get(): boolean; setLabels(next: [string, string]): void } {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `demo-button tn-toggle ${cls}`.trim();
  let on = false;
  let curLabels: [string, string] = [...labels];
  const sync = (): void => {
    b.textContent = on ? curLabels[1] : curLabels[0];
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  };
  b.addEventListener("click", () => {
    on = !on;
    sync();
    onChange(on);
  });
  sync();
  parent.appendChild(b);
  return {
    el: b,
    set(v: boolean) {
      on = v;
      sync();
    },
    get: () => on,
    setLabels(next: [string, string]) {
      curLabels = [...next];
      sync();
    },
  };
}

export function button(parent: HTMLElement, label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `demo-button ${cls}`.trim();
  b.textContent = label;
  b.addEventListener("click", onClick);
  parent.appendChild(b);
  return b;
}

// A labeled kit slider for figures that also update the value from code
// (such as snapping to tuning landmarks or syncing with preset chips).
export function range(
  parent: HTMLElement,
  o: { label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; onInput: (v: number) => void },
): { set(v: number): void } {
  const wrap = document.createElement("label");
  wrap.className = "demo-slider tn-range";
  const state = { v: o.value };
  const ctl = new Group(wrap).bind(state, "v", {
    label: o.label,
    min: o.min,
    max: o.max,
    step: o.step,
    format: o.format,
  });
  const val = wrap.querySelector<HTMLInputElement>(".k-val");
  const sizeVal = (s: string): void => {
    if (!val) return;
    val.style.width = `${Math.max(4, s.length) + 1.2}ch`;
  };
  if (val) {
    val.readOnly = true;
    val.tabIndex = -1;
    sizeVal(o.format(o.value));
  }
  ctl.on((v) => {
    sizeVal(o.format(v));
    o.onInput(v);
  });
  parent.appendChild(wrap);
  return {
    set(v: number) {
      state.v = v;
      ctl.refresh();
      sizeVal(o.format(v));
    },
  };
}

// "Tap to play" badge for figures that make sound. Unlike soundHint() it
// stays clickable and hides once the figure has made a sound.
export function tapBadge(container: HTMLElement, textContent = "tap to play"): { el: HTMLElement; hide(): void } {
  const el = document.createElement("span");
  el.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5c1 .8 1 4.2 0 5M12.8 3.8c2 1.8 2 6.6 0 8.4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg><span></span>`;
  el.querySelector("span")!.textContent = textContent;
  // In essay pages the figure has a header line (Fig. N · title · hint):
  // the badge sits there, out of the drawing's way.
  const head = container.querySelector<HTMLElement>(".demo-head");
  if (head) {
    el.className = "tn-badge tn-badge-inline";
    head.appendChild(el);
  } else {
    container.style.position = "relative";
    el.className = "tn-badge";
    container.appendChild(el);
  }
  return {
    el,
    hide() {
      el.classList.add("is-hidden");
    },
  };
}
