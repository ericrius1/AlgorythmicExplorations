// Small UI pieces shared by the music-play figures: a "tap to play" gate laid
// over the canvas (audio never starts without it), segmented option buttons,
// and a wrapper so overlays can sit on top of a Shell's canvas.

import { unlockAudio } from "../../../lib/audio";
import type { Shell } from "../../../lib/demoShell";

// Wrap the shell's canvas in a positioned box so overlays can sit over it.
export function stage(shell: Shell): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "mp-stage";
  shell.canvas.replaceWith(wrap);
  wrap.appendChild(shell.canvas);
  return wrap;
}

export interface Gate {
  el: HTMLButtonElement;
  show(text?: string): void;
  hide(): void;
  readonly open: boolean;
}

// A big, obvious play button. The click unlocks Web Audio and then runs
// onStart; the gate hides itself until show() brings it back (for example
// after the figure scrolls away and goes quiet).
export function playGate(
  host: HTMLElement,
  text: string,
  sub: string,
  onStart: () => void | Promise<void>,
): Gate {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "mp-gate";
  const icon = document.createElement("span");
  icon.className = "mp-gate-icon";
  icon.textContent = "▶";
  const label = document.createElement("span");
  label.className = "mp-gate-text";
  label.textContent = text;
  const small = document.createElement("span");
  small.className = "mp-gate-sub";
  small.textContent = sub;
  const words = document.createElement("span");
  words.className = "mp-gate-words";
  words.append(label, small);
  el.append(icon, words);
  host.appendChild(el);
  let open = false;
  const gate: Gate = {
    el,
    show(t?: string) {
      if (t) label.textContent = t;
      el.classList.remove("is-hidden");
      open = false;
    },
    hide() {
      el.classList.add("is-hidden");
      open = true;
    },
    get open() {
      return open;
    },
  };
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    void unlockAudio().then(async () => {
      gate.hide();
      await onStart();
    });
  });
  return gate;
}

// A row of mutually exclusive buttons.
export function segmented<T extends string>(
  parent: HTMLElement,
  label: string,
  options: readonly T[],
  value: T,
  onPick: (v: T) => void,
  names: Partial<Record<T, string>> = {},
): { set(v: T): void; el: HTMLDivElement } {
  const el = document.createElement("div");
  el.className = "mp-seg";
  const cap = document.createElement("span");
  cap.className = "mp-seg-label";
  cap.textContent = label;
  el.appendChild(cap);
  const btns = new Map<T, HTMLButtonElement>();
  for (const o of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mp-seg-btn";
    b.textContent = names[o] ?? o;
    b.addEventListener("click", () => {
      set(o);
      onPick(o);
    });
    el.appendChild(b);
    btns.set(o, b);
  }
  const set = (v: T): void => {
    for (const [k, b] of btns) b.classList.toggle("is-on", k === v);
  };
  set(value);
  parent.appendChild(el);
  return { set, el };
}

export function smallButton(parent: HTMLElement, text: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `demo-button ${cls}`.trim();
  b.textContent = text;
  b.addEventListener("click", onClick);
  parent.appendChild(b);
  return b;
}
