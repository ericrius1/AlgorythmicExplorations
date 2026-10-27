// Playing the figures: a computer-keyboard piano, Web MIDI, and an on-screen
// keyboard strip with multitouch and glissando. Keys and MIDI go to one
// figure at a time: the one you touched last if it's still on screen,
// otherwise the most visible one, marked with a soft ring.
//
// Layout (physical keys, so it works on any keyboard layout):
//    W E   T Y U   O P        black keys
//   A S D F G H J K L ; '     white keys, A = C
//   Z / X  octave down / up

export interface NoteTarget {
  el: HTMLElement;
  /** midi note of the A key */
  base: number;
  minBase?: number;
  maxBase?: number;
  on(note: number, vel: number): void;
  off(note: number): void;
  bend?(semis: number): void;
  mod?(v: number): void;
  /** called when base changes (Z/X or the strip's octave buttons) */
  onBase?(): void;
}

const CODE_OFFSET: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};
const CODE_CAP: Record<string, string> = {
  KeyA: "A",
  KeyW: "W",
  KeyS: "S",
  KeyE: "E",
  KeyD: "D",
  KeyF: "F",
  KeyT: "T",
  KeyG: "G",
  KeyY: "Y",
  KeyH: "H",
  KeyU: "U",
  KeyJ: "J",
  KeyK: "K",
  KeyO: "O",
  KeyL: "L",
  KeyP: "P",
  Semicolon: ";",
  Quote: "'",
};

export function capLabels(base: number): Map<number, string> {
  const m = new Map<number, string>();
  for (const [code, off] of Object.entries(CODE_OFFSET)) m.set(base + off, CODE_CAP[code]);
  return m;
}

// ---------------------------------------------------------------- router

function visibleFraction(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  if (r.height <= 0) return 0;
  const top = Math.max(r.top, 0);
  const bot = Math.min(r.bottom, window.innerHeight);
  return Math.max(0, bot - top) / Math.min(r.height, window.innerHeight);
}

class Router {
  private targets = new Set<NoteTarget>();
  private last: NoteTarget | null = null;
  private held = new Map<string, { t: NoteTarget; note: number }>();
  private marked: NoteTarget | null = null;
  private installed = false;
  private sustain = false;
  private sustained = new Map<NoteTarget, Set<number>>();
  midiState: "off" | "pending" | "on" | "denied" | "none" = "off";
  midiNames: string[] = [];
  private midiHeld = new Map<number, NoteTarget>();
  private listeners = new Set<() => void>();

  add(t: NoteTarget): void {
    this.targets.add(t);
    this.install();
    t.el.addEventListener("pointerdown", () => this.touch(t));
  }

  touch(t: NoteTarget): void {
    this.last = t;
    this.mark();
  }

  current(): NoteTarget | null {
    if (this.last && visibleFraction(this.last.el) > 0.3) return this.last;
    let best: NoteTarget | null = null;
    let bestF = 0.35;
    for (const t of this.targets) {
      const f = visibleFraction(t.el);
      if (f > bestF) {
        bestF = f;
        best = t;
      }
    }
    return best;
  }

  isCurrent(t: NoteTarget): boolean {
    return this.current() === t;
  }

  private mark(): void {
    const c = this.current();
    if (c === this.marked) return;
    this.marked?.el.classList.remove("synth-target");
    c?.el.classList.add("synth-target");
    this.marked = c;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private install(): void {
    if (this.installed) return;
    this.installed = true;
    let queued = false;
    const remark = (): void => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        this.mark();
      });
    };
    window.addEventListener("scroll", remark, { passive: true });
    window.addEventListener("resize", remark, { passive: true });
    window.addEventListener("keydown", (e) => this.keydown(e));
    window.addEventListener("keyup", (e) => this.keyup(e));
    window.addEventListener("blur", () => this.releaseAll());
  }

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
    if (t.tagName === "INPUT") {
      const type = (t as HTMLInputElement).type;
      return type !== "range" && type !== "checkbox" && type !== "radio" && type !== "button";
    }
    return false;
  }

  private keydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey || this.typing(e)) return;
    const t = this.current();
    if (!t) return;
    if (e.code === "KeyZ" || e.code === "KeyX") {
      if (e.repeat) return;
      const lo = t.minBase ?? 24;
      const hi = t.maxBase ?? 96;
      t.base = Math.max(lo, Math.min(hi, t.base + (e.code === "KeyZ" ? -12 : 12)));
      t.onBase?.();
      e.preventDefault();
      return;
    }
    const off = CODE_OFFSET[e.code];
    if (off === undefined) return;
    e.preventDefault();
    if (e.repeat || this.held.has(e.code)) return;
    const note = t.base + off;
    this.held.set(e.code, { t, note });
    this.touch(t);
    t.on(note, 0.8);
  }

  private keyup(e: KeyboardEvent): void {
    const h = this.held.get(e.code);
    if (!h) return;
    this.held.delete(e.code);
    this.release(h.t, h.note);
  }

  /** note off, or deferred while the sustain pedal is down */
  release(t: NoteTarget, note: number): void {
    if (this.sustain) {
      let s = this.sustained.get(t);
      if (!s) this.sustained.set(t, (s = new Set()));
      s.add(note);
      return;
    }
    t.off(note);
  }

  releaseAll(): void {
    for (const h of this.held.values()) h.t.off(h.note);
    this.held.clear();
    for (const [n, t] of this.midiHeld) t.off(n);
    this.midiHeld.clear();
  }

  // ---- MIDI ----

  async enableMidi(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      this.midiState = "none";
      this.changed();
      return;
    }
    if (this.midiState === "on" || this.midiState === "pending") return;
    this.midiState = "pending";
    this.changed();
    try {
      const access = await navigator.requestMIDIAccess();
      const wire = (): void => {
        this.midiNames = [];
        for (const input of access.inputs.values()) {
          this.midiNames.push(input.name ?? "MIDI in");
          input.onmidimessage = (ev: MIDIMessageEvent) => this.midi(ev.data);
        }
        this.changed();
      };
      wire();
      access.onstatechange = wire;
      this.midiState = "on";
    } catch {
      this.midiState = "denied";
    }
    this.changed();
  }

  private midi(data: Uint8Array | null): void {
    if (!data || data.length < 2) return;
    const st = data[0] & 0xf0;
    const a = data[1];
    const b = data[2] ?? 0;
    if (st === 0x90 && b > 0) {
      const t = this.current();
      if (!t) return;
      this.midiHeld.set(a, t);
      t.on(a, b / 127);
    } else if (st === 0x80 || (st === 0x90 && b === 0)) {
      const t = this.midiHeld.get(a);
      if (!t) return;
      this.midiHeld.delete(a);
      this.release(t, a);
    } else if (st === 0xe0) {
      const v = ((b << 7) | a) / 8192 - 1;
      this.current()?.bend?.(v * 2);
    } else if (st === 0xb0 && a === 1) {
      this.current()?.mod?.(b / 127);
    } else if (st === 0xb0 && a === 64) {
      const down = b >= 64;
      if (!down && this.sustain) {
        this.sustain = false;
        for (const [t, notes] of this.sustained) {
          for (const n of notes) {
            const stillHeld = [...this.midiHeld].some(([m, tt]) => m === n && tt === t);
            if (!stillHeld) t.off(n);
          }
        }
        this.sustained.clear();
      } else this.sustain = down;
    }
  }
}

export const router = new Router();

// ---------------------------------------------------------------- the strip

const BLACK = new Set([1, 3, 6, 8, 10]);

export interface StripOpts {
  low?: number;
  /** white keys to show on a wide screen; fewer on narrow ones */
  whites?: number;
}

/**
 * An on-screen keyboard bound to a NoteTarget. The range follows the
 * target's base octave so the keycap letters always fit on it.
 */
export class KeyStrip {
  readonly el: HTMLDivElement;
  private keysEl: HTMLDivElement;
  private label: HTMLSpanElement;
  private midiBtn: HTMLButtonElement;
  private t: NoteTarget;
  private keys = new Map<number, HTMLDivElement>();
  private low = 48;
  private high = 72;
  private pointers = new Map<number, number>(); // pointerId → note
  private lit = new Set<number>();
  private opts: StripOpts;

  constructor(target: NoteTarget, opts: StripOpts = {}) {
    this.t = target;
    this.opts = opts;
    this.el = document.createElement("div");
    this.el.className = "synth-keys";
    const bar = document.createElement("div");
    bar.className = "synth-keys-bar";
    const down = document.createElement("button");
    down.className = "synth-oct";
    down.textContent = "−";
    down.title = "Octave down (Z)";
    const up = document.createElement("button");
    up.className = "synth-oct";
    up.textContent = "+";
    up.title = "Octave up (X)";
    this.label = document.createElement("span");
    this.label.className = "synth-keys-label";
    const shift = (d: number): void => {
      const lo = target.minBase ?? 24;
      const hi = target.maxBase ?? 96;
      target.base = Math.max(lo, Math.min(hi, target.base + d));
      target.onBase?.();
      this.layout();
    };
    down.addEventListener("click", () => shift(-12));
    up.addEventListener("click", () => shift(12));
    this.midiBtn = document.createElement("button");
    this.midiBtn.className = "synth-midi";
    this.midiBtn.textContent = "MIDI";
    this.midiBtn.title = "Play this page with a MIDI keyboard";
    this.midiBtn.addEventListener("click", () => void router.enableMidi());
    if (!navigator.requestMIDIAccess) this.midiBtn.hidden = true;
    router.onChange(() => this.syncMidi());
    const hint = document.createElement("span");
    hint.className = "synth-keys-hint";
    hint.textContent = "keys A–K · Z/X octave";
    bar.append(down, this.label, up, hint, this.midiBtn);
    this.keysEl = document.createElement("div");
    this.keysEl.className = "synth-keys-row";
    this.el.append(this.keysEl, bar);
    this.wire();
    const prev = target.onBase;
    target.onBase = () => {
      prev?.();
      this.layout();
    };
    this.layout();
    window.addEventListener("resize", () => this.layout());
    this.syncMidi();
  }

  private syncMidi(): void {
    const s = router.midiState;
    this.midiBtn.classList.toggle("is-on", s === "on");
    this.midiBtn.textContent =
      s === "on" ? (router.midiNames.length ? `MIDI · ${router.midiNames[0]}` : "MIDI · no device") : s === "pending" ? "MIDI…" : s === "denied" ? "MIDI blocked" : "MIDI";
  }

  /** Rebuild keys around the target's base octave. */
  layout(): void {
    const width = this.el.clientWidth || this.el.parentElement?.clientWidth || 700;
    const maxWhites = this.opts.whites ?? 17;
    const whites = Math.max(8, Math.min(maxWhites, Math.floor(width / 30)));
    // start at the C below the A key's note when there's room, so the QWERTY
    // run (C … F an octave up) sits on screen
    let low = this.t.base;
    const span = whites >= 15 ? 7 : 0;
    if (whites >= 15) low = this.t.base - 12 + span; // a fifth below: G
    while (BLACK.has(((low % 12) + 12) % 12)) low--;
    let count = 0;
    let high = low;
    for (let m = low; count < whites; m++) {
      if (!BLACK.has(m % 12)) count++;
      high = m;
    }
    if (low === this.low && high === this.high && this.keys.size) {
      this.labels();
      return;
    }
    this.low = low;
    this.high = high;
    this.keysEl.replaceChildren();
    this.keys.clear();
    const wl: number[] = [];
    for (let m = low; m <= high; m++) if (!BLACK.has(m % 12)) wl.push(m);
    const ww = 100 / wl.length;
    wl.forEach((m, i) => {
      const k = document.createElement("div");
      k.className = "synth-key is-white";
      k.style.left = `${i * ww}%`;
      k.style.width = `${ww}%`;
      k.dataset.note = String(m);
      this.keysEl.appendChild(k);
      this.keys.set(m, k);
      const b = m + 1;
      if (b <= high && BLACK.has(b % 12)) {
        const kb = document.createElement("div");
        kb.className = "synth-key is-black";
        kb.style.left = `${(i + 0.66) * ww}%`;
        kb.style.width = `${ww * 0.68}%`;
        kb.dataset.note = String(b);
        this.keysEl.appendChild(kb);
        this.keys.set(b, kb);
      }
    });
    this.labels();
    this.paint();
  }

  private labels(): void {
    const caps = capLabels(this.t.base);
    for (const [m, k] of this.keys) {
      const c = caps.get(m);
      k.textContent = "";
      if (c) {
        const s = document.createElement("span");
        s.className = "synth-cap";
        s.textContent = c;
        k.appendChild(s);
      }
      if (m % 12 === 0) {
        const s = document.createElement("span");
        s.className = "synth-cname";
        s.textContent = `C${Math.floor(m / 12) - 1}`;
        k.appendChild(s);
      }
    }
    this.label.textContent = `C${Math.floor(this.t.base / 12) - 1}`;
  }

  private noteAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = el?.closest<HTMLElement>(".synth-key");
    if (!k || !this.keysEl.contains(k)) return null;
    return Number(k.dataset.note);
  }

  private velAt(note: number, y: number): number {
    const k = this.keys.get(note);
    if (!k) return 0.8;
    const r = k.getBoundingClientRect();
    return 0.45 + 0.55 * Math.min(1, Math.max(0, (y - r.top) / r.height));
  }

  private wire(): void {
    const el = this.keysEl;
    el.addEventListener("pointerdown", (e) => {
      const n = this.noteAt(e.clientX, e.clientY);
      if (n === null) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, n);
      router.touch(this.t);
      this.t.on(n, this.velAt(n, e.clientY));
      this.paint();
    });
    el.addEventListener("pointermove", (e) => {
      const cur = this.pointers.get(e.pointerId);
      if (cur === undefined) return;
      const n = this.noteAt(e.clientX, e.clientY);
      if (n === null || n === cur) return;
      this.t.off(cur);
      this.pointers.set(e.pointerId, n);
      this.t.on(n, this.velAt(n, e.clientY));
      this.paint();
    });
    const up = (e: PointerEvent): void => {
      const cur = this.pointers.get(e.pointerId);
      if (cur === undefined) return;
      this.pointers.delete(e.pointerId);
      this.t.off(cur);
      this.paint();
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }

  /** Light the keys that are sounding (from the engine's telemetry). */
  setLit(notes: Iterable<number>): void {
    const next = new Set<number>();
    for (const n of notes) next.add(Math.round(n));
    let same = next.size === this.lit.size;
    if (same) for (const n of next) if (!this.lit.has(n)) same = false;
    if (same) return;
    this.lit = next;
    this.paint();
  }

  private paint(): void {
    const pressed = new Set(this.pointers.values());
    for (const [m, k] of this.keys) {
      k.classList.toggle("is-down", pressed.has(m));
      k.classList.toggle("is-lit", this.lit.has(m));
    }
  }

  releaseAll(): void {
    for (const n of this.pointers.values()) this.t.off(n);
    this.pointers.clear();
    this.paint();
  }
}
