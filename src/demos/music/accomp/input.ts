// Note input for every playable figure on the page: the computer keyboard as a
// piano (two rows, like a tracker), Web MIDI once the reader asks for it, and
// an on-screen piano with press and release. Keyboard and MIDI notes go to
// whichever playable figure is most on screen, and only after the reader has
// tapped one of them (that tap is what unlocks the audio).

import { pcOf } from "./theory";

export interface NoteSink {
  el: HTMLElement;
  noteOn(midi: number, vel: number): void;
  noteOff(midi: number): void;
  armed(): boolean; // has this figure been tapped / unlocked yet?
}

// a w s e d f t g y h u j k o l p ; '  →  C C♯ D … F (an octave and a half)
export const KEYMAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};

const sinks = new Set<NoteSink>();
let octaveBase = 60;
const octaveListeners = new Set<(base: number) => void>();
const downKeys = new Map<string, { sink: NoteSink; midi: number }>();
let installed = false;
let midiState: "off" | "pending" | "on" | "none" | "denied" = "off";
let midiName = "";
const midiHeld = new Map<number, NoteSink>();

export function qwertyBase(): number {
  return octaveBase;
}
export function onOctave(fn: (base: number) => void): () => void {
  octaveListeners.add(fn);
  return () => octaveListeners.delete(fn);
}

function visibleArea(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
  return h * w;
}

function target(): NoteSink | null {
  let best: NoteSink | null = null;
  let bestA = 0;
  for (const s of sinks) {
    if (!s.armed()) continue;
    const a = visibleArea(s.el);
    if (a > bestA) {
      bestA = a;
      best = s;
    }
  }
  return bestA > 4000 ? best : null;
}

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
    const k = e.key.toLowerCase();
    const sink = target();
    if (!sink) return;
    if (k === "z" || k === "x") {
      octaveBase = Math.max(36, Math.min(84, octaveBase + (k === "z" ? -12 : 12)));
      for (const fn of octaveListeners) fn(octaveBase);
      e.preventDefault();
      return;
    }
    const off = KEYMAP[k];
    if (off === undefined || downKeys.has(k)) return;
    e.preventDefault();
    const midi = octaveBase + off;
    downKeys.set(k, { sink, midi });
    sink.noteOn(midi, 0.75);
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    const d = downKeys.get(k);
    if (!d) return;
    downKeys.delete(k);
    d.sink.noteOff(d.midi);
  });
  // a lost focus would strand held notes
  window.addEventListener("blur", () => {
    for (const d of downKeys.values()) d.sink.noteOff(d.midi);
    downKeys.clear();
  });
}

export function registerSink(s: NoteSink): () => void {
  install();
  sinks.add(s);
  return () => sinks.delete(s);
}

// ---- Web MIDI -----------------------------------------------------------------

export function midiStatus(): string {
  switch (midiState) {
    case "on":
      return `MIDI: ${midiName}`;
    case "pending":
      return "MIDI: asking…";
    case "none":
      return "MIDI: no device";
    case "denied":
      return "MIDI: unavailable";
    default:
      return "";
  }
}

// Ask for MIDI only when the reader clicks the button: browsers show a
// permission prompt for it.
export function enableMidi(onChange: () => void): void {
  if (midiState === "on" || midiState === "pending") return;
  if (!navigator.requestMIDIAccess) {
    midiState = "denied";
    onChange();
    return;
  }
  midiState = "pending";
  onChange();
  navigator
    .requestMIDIAccess()
    .then((access) => {
      const wire = (): void => {
        midiName = "";
        for (const input of access.inputs.values()) {
          midiName = midiName || (input.name ?? "input");
          input.onmidimessage = (e: MIDIMessageEvent): void => {
            const data = e.data;
            if (!data || data.length < 3) return;
            const [st, note, vel] = data;
            const cmd = st & 0xf0;
            if (cmd === 0x90 && vel > 0) {
              const sink = target();
              if (!sink) return;
              midiHeld.set(note, sink);
              sink.noteOn(note, Math.max(0.15, vel / 127));
            } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
              const sink = midiHeld.get(note);
              midiHeld.delete(note);
              sink?.noteOff(note);
            }
          };
        }
        midiState = midiName ? "on" : "none";
        onChange();
      };
      wire();
      access.onstatechange = wire;
    })
    .catch(() => {
      midiState = "denied";
      onChange();
    });
}

// ---- on-screen piano ------------------------------------------------------------

const BLACK = new Set([1, 3, 6, 8, 10]);

// Uses the site's .piano styles. Unlike lib/piano.ts it reports releases, and
// a finger can slide across the keys.
export class TouchPiano {
  readonly el: HTMLDivElement;
  private keys = new Map<number, HTMLDivElement>();
  private pointers = new Map<number, number>(); // pointerId → midi

  constructor(
    low: number,
    high: number,
    private onDown: (m: number) => void,
    private onUp: (m: number) => void,
  ) {
    this.el = document.createElement("div");
    this.el.className = "piano mp-piano";
    const whites: number[] = [];
    for (let m = low; m <= high; m++) if (!BLACK.has(pcOf(m))) whites.push(m);
    const w = 100 / whites.length;
    whites.forEach((m, i) => this.add(m, "piano-white", i * w, w));
    whites.forEach((m, i) => {
      const b = m + 1;
      if (b <= high && BLACK.has(pcOf(b))) this.add(b, "piano-black", (i + 0.68) * w, w * 0.64);
    });
    this.el.addEventListener("pointerdown", (e) => {
      const m = this.keyAt(e);
      if (m === null) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, m);
      this.onDown(m);
    });
    this.el.addEventListener("pointermove", (e) => {
      const cur = this.pointers.get(e.pointerId);
      if (cur === undefined) return;
      const m = this.keyAt(e);
      if (m === null || m === cur) return;
      this.onUp(cur);
      this.pointers.set(e.pointerId, m);
      this.onDown(m);
    });
    const up = (e: PointerEvent): void => {
      const cur = this.pointers.get(e.pointerId);
      if (cur === undefined) return;
      this.pointers.delete(e.pointerId);
      this.onUp(cur);
    };
    this.el.addEventListener("pointerup", up);
    this.el.addEventListener("pointercancel", up);
  }

  private add(m: number, cls: string, left: number, width: number): void {
    const k = document.createElement("div");
    k.className = `piano-key ${cls}`;
    k.style.left = `${left}%`;
    k.style.width = `${width}%`;
    k.dataset.midi = String(m);
    this.el.appendChild(k);
    this.keys.set(m, k);
  }

  private keyAt(e: PointerEvent): number | null {
    const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const k = hit?.closest<HTMLElement>(".piano-key");
    if (!k || !this.el.contains(k)) return null;
    return Number(k.dataset.midi);
  }

  // you: classes "is-you"; band: "is-held"; root: "is-root"
  light(you: Iterable<number>, band: Iterable<number>, root = -1): void {
    const y = new Set(you);
    const b = new Set(band);
    for (const [m, k] of this.keys) {
      k.classList.toggle("is-you", y.has(m));
      k.classList.toggle("is-held", b.has(m) && !y.has(m) && m !== root);
      k.classList.toggle("is-root", m === root && !y.has(m));
    }
  }

  setCaps(base: number): void {
    const caps = new Map<number, string>();
    for (const [k, off] of Object.entries(KEYMAP)) caps.set(base + off, k.toUpperCase());
    for (const [m, k] of this.keys) {
      let cap = k.querySelector<HTMLSpanElement>(".piano-cap");
      const text = caps.get(m);
      if (!text) {
        cap?.remove();
        continue;
      }
      if (!cap) {
        cap = document.createElement("span");
        cap.className = "piano-cap";
        k.appendChild(cap);
      }
      cap.textContent = text;
    }
  }
}
