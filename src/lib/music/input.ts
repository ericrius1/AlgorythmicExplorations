// Note input for playable figures: the computer keyboard as a piano, Web MIDI,
// and a router that sends both to one figure at a time.
//
// Routing: the figure the reader touched last (if still on screen), otherwise
// the most visible registered figure. Notes are always released on the figure
// that received their note-on, even if the target changes while a key is held.

import "../../styles/music.css";
import { installUnlock } from "./lifecycle";

export type NoteSource = "qwerty" | "midi" | "pointer";

export interface NoteHandlers {
  onNoteOn(midi: number, velocity: number, source: NoteSource): void;
  onNoteOff(midi: number, source: NoteSource): void;
  /** MIDI sustain pedal (CC64). If omitted, NoteInput holds note-offs while the pedal is down. */
  onSustain?(down: boolean): void;
  /** MIDI pitch bend in semitones (±2 range). */
  onPitchBend?(semitones: number): void;
}

export interface NoteInputOptions {
  /** Computer keyboard as piano (default true). */
  qwerty?: boolean;
  /** Receive Web MIDI notes once requestMidi() has succeeded (default true). */
  midi?: boolean;
  /** Octave of the A key: 4 → A plays C4 (MIDI 60). Z / X change it. */
  octave?: number;
  /** Velocity for computer-keyboard notes (C / V change it). Default 0.8. */
  velocity?: number;
}

// physical key → semitone above the current octave's C
const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
const KEYCAP: Record<string, string> = {
  KeyA: "A", KeyW: "W", KeyS: "S", KeyE: "E", KeyD: "D", KeyF: "F", KeyT: "T", KeyG: "G", KeyY: "Y",
  KeyH: "H", KeyU: "U", KeyJ: "J", KeyK: "K", KeyO: "O", KeyL: "L", KeyP: "P", Semicolon: ";", Quote: "'",
};

const targets = new Set<NoteInput>();
let lastTouched: NoteInput | null = null;
let keyboardUsed = false;
let ringTarget: NoteInput | null = null;

function visibleArea(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? w * h : 0;
}

function activeTarget(kind: "qwerty" | "midi"): NoteInput | null {
  const ok = (t: NoteInput): boolean => (kind === "qwerty" ? t.opts.qwerty : t.opts.midi);
  if (lastTouched && targets.has(lastTouched) && ok(lastTouched) && visibleArea(lastTouched.el) > 0) return lastTouched;
  let best: NoteInput | null = null;
  let bestArea = 0;
  for (const t of targets) {
    if (!ok(t)) continue;
    const a = visibleArea(t.el);
    if (a > bestArea) {
      best = t;
      bestArea = a;
    }
  }
  return best;
}

function updateRing(): void {
  const t = keyboardUsed ? activeTarget("qwerty") : null;
  if (t === ringTarget) return;
  ringTarget?.el.classList.remove("is-note-target");
  ringTarget = t;
  t?.el.classList.add("is-note-target");
}

// ---- computer keyboard -----------------------------------------------------------

const pressed = new Map<string, { target: NoteInput; midi: number }>();
let keysInstalled = false;

function typingInto(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["range", "checkbox", "radio", "button", "submit", "reset", "color"].includes(type);
  }
  return false;
}

function releaseAllKeys(): void {
  for (const { target, midi } of pressed.values()) target.emitOff(midi, "qwerty");
  pressed.clear();
}

function installKeys(): void {
  if (keysInstalled) return;
  keysInstalled = true;
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typingInto(e)) return;
    const code = e.code;
    const isNote = code in KEYMAP;
    const isCtl = code === "KeyZ" || code === "KeyX" || code === "KeyC" || code === "KeyV";
    if (!isNote && !isCtl) return;
    const t = activeTarget("qwerty");
    if (!t) return;
    e.preventDefault();
    if (e.repeat) return;
    if (!keyboardUsed) {
      keyboardUsed = true;
      updateRing();
    }
    if (isCtl) {
      if (code === "KeyZ") t.octave = Math.max(0, t.octave - 1);
      else if (code === "KeyX") t.octave = Math.min(8, t.octave + 1);
      else if (code === "KeyC") t.velocity = Math.max(0.1, Math.round((t.velocity - 0.1) * 10) / 10);
      else t.velocity = Math.min(1, Math.round((t.velocity + 0.1) * 10) / 10);
      return;
    }
    if (pressed.has(code)) return;
    const midi = (t.octave + 1) * 12 + KEYMAP[code];
    if (midi > 127) return;
    pressed.set(code, { target: t, midi });
    t.emitOn(midi, t.velocity, "qwerty");
  });
  window.addEventListener("keyup", (e) => {
    const p = pressed.get(e.code);
    if (!p) return;
    pressed.delete(e.code);
    p.target.emitOff(p.midi, "qwerty");
  });
  window.addEventListener("blur", releaseAllKeys);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAllKeys();
  });
  let raf = 0;
  window.addEventListener(
    "scroll",
    () => {
      if (!keyboardUsed || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateRing();
      });
    },
    { passive: true },
  );
}

// ---- Web MIDI ------------------------------------------------------------------------

export type MidiStatus = "unsupported" | "idle" | "pending" | "ready" | "denied";

let midiStatusValue: MidiStatus =
  typeof navigator !== "undefined" && "requestMIDIAccess" in navigator ? "idle" : "unsupported";
let midiAccess: MIDIAccess | null = null;
let midiPromise: Promise<boolean> | null = null;
const midiListeners = new Set<(status: MidiStatus, devices: string[]) => void>();
const midiHeld = new Map<number, NoteInput>(); // note → target that got the note-on

export function midiStatus(): MidiStatus {
  return midiStatusValue;
}

export function midiDevices(): string[] {
  if (!midiAccess) return [];
  const out: string[] = [];
  midiAccess.inputs.forEach((i) => out.push(i.name || "MIDI input"));
  return out;
}

export function onMidiChange(cb: (status: MidiStatus, devices: string[]) => void): () => void {
  midiListeners.add(cb);
  return () => midiListeners.delete(cb);
}

function notifyMidi(): void {
  const d = midiDevices();
  for (const cb of midiListeners) cb(midiStatusValue, d);
}

function onMidiMessage(e: MIDIMessageEvent): void {
  const d = e.data;
  if (!d || d.length < 2) return;
  const cmd = d[0] & 0xf0;
  const a = d[1];
  const b = d.length > 2 ? d[2] : 0;
  if (cmd === 0x90 && b > 0) {
    const t = activeTarget("midi");
    if (!t) return;
    midiHeld.get(a)?.emitOff(a, "midi");
    midiHeld.set(a, t);
    t.emitOn(a, b / 127, "midi");
  } else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) {
    const t = midiHeld.get(a);
    midiHeld.delete(a);
    t?.emitOff(a, "midi");
  } else if (cmd === 0xb0) {
    const t = activeTarget("midi");
    if (a === 64) t?.emitSustain(b >= 64);
    else if (a === 123 || a === 120) {
      for (const [n, tt] of midiHeld) tt.emitOff(n, "midi");
      midiHeld.clear();
    }
  } else if (cmd === 0xe0) {
    const v = ((b << 7) | a) - 8192;
    activeTarget("midi")?.handlers.onPitchBend?.((v / 8192) * 2);
  }
}

function attachInputs(): void {
  midiAccess?.inputs.forEach((input) => {
    input.onmidimessage = onMidiMessage;
  });
}

/**
 * Ask for Web MIDI access. Call from a click handler. Resolves true once
 * access is granted (even with no devices plugged in yet), false when the
 * browser has no Web MIDI or the reader declines.
 */
export function requestMidi(): Promise<boolean> {
  if (midiStatusValue === "unsupported") return Promise.resolve(false);
  if (midiPromise) return midiPromise;
  midiStatusValue = "pending";
  notifyMidi();
  midiPromise = navigator
    .requestMIDIAccess({ sysex: false })
    .then((access) => {
      midiAccess = access;
      midiStatusValue = "ready";
      attachInputs();
      access.onstatechange = () => {
        attachInputs();
        notifyMidi();
      };
      notifyMidi();
      return true;
    })
    .catch(() => {
      midiStatusValue = "denied";
      midiPromise = null;
      notifyMidi();
      return false;
    });
  return midiPromise;
}

/** A small "MIDI" button that requests access and shows the device count. Hidden where Web MIDI doesn't exist. */
export function midiButton(): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "demo-button midi-button";
  const sync = (): void => {
    const s = midiStatusValue;
    const n = midiDevices().length;
    b.hidden = s === "unsupported";
    b.dataset.status = s;
    b.textContent =
      s === "ready"
        ? n > 0
          ? `MIDI · ${n} device${n === 1 ? "" : "s"}`
          : "MIDI · plug in a keyboard"
        : s === "pending"
          ? "MIDI · asking…"
          : s === "denied"
            ? "MIDI · blocked"
            : "Connect MIDI";
    b.title =
      s === "ready" && n > 0 ? midiDevices().join(", ") : "Play this figure from a MIDI keyboard (Web MIDI)";
  };
  sync();
  onMidiChange(sync);
  b.addEventListener("click", () => void requestMidi());
  return b;
}

// ---- NoteInput -------------------------------------------------------------------------

export class NoteInput {
  readonly el: HTMLElement;
  readonly handlers: NoteHandlers;
  readonly opts: Required<Pick<NoteInputOptions, "qwerty" | "midi">>;
  /** Called when Z / X change the octave. */
  onOctaveChange: ((octave: number) => void) | null = null;
  velocity: number;
  private _octave: number;
  private sustain = false;
  private deferred = new Set<number>();
  private down = new Set<number>();
  private onPointer = (): void => {
    lastTouched = this;
    if (keyboardUsed) updateRing();
  };

  constructor(target: HTMLElement, handlers: NoteHandlers, opts: NoteInputOptions = {}) {
    this.el = target;
    this.handlers = handlers;
    this.opts = { qwerty: opts.qwerty ?? true, midi: opts.midi ?? true };
    this._octave = opts.octave ?? 4;
    this.velocity = opts.velocity ?? 0.8;
    targets.add(this);
    installUnlock();
    if (this.opts.qwerty) installKeys();
    target.addEventListener("pointerdown", this.onPointer, true);
    target.addEventListener("focusin", this.onPointer);
  }

  get octave(): number {
    return this._octave;
  }
  set octave(o: number) {
    if (o === this._octave) return;
    this._octave = o;
    this.onOctaveChange?.(o);
  }

  /** midi → keycap ("A", "W", …) for the current octave. */
  qwertyLabels(): Map<number, string> {
    const out = new Map<number, string>();
    const base = (this._octave + 1) * 12;
    for (const [code, semi] of Object.entries(KEYMAP)) out.set(base + semi, KEYCAP[code]);
    return out;
  }

  /** Make this the figure that receives keyboard and MIDI notes. */
  activate(): void {
    lastTouched = this;
    updateRing();
  }

  /** Feed a note in from elsewhere (e.g. an on-screen keyboard), with the same sustain handling. */
  emitOn(midi: number, velocity: number, source: NoteSource): void {
    this.deferred.delete(midi);
    if (this.down.has(midi)) this.handlers.onNoteOff(midi, source);
    this.down.add(midi);
    this.handlers.onNoteOn(midi, velocity, source);
  }

  emitOff(midi: number, source: NoteSource): void {
    if (!this.down.has(midi)) return;
    if (this.sustain && !this.handlers.onSustain) {
      this.deferred.add(midi);
      return;
    }
    this.down.delete(midi);
    this.handlers.onNoteOff(midi, source);
  }

  emitSustain(on: boolean): void {
    this.sustain = on;
    if (this.handlers.onSustain) {
      this.handlers.onSustain(on);
      return;
    }
    if (!on) {
      for (const m of this.deferred) {
        this.down.delete(m);
        this.handlers.onNoteOff(m, "midi");
      }
      this.deferred.clear();
    }
  }

  /** Release everything this input is holding. */
  releaseAll(): void {
    for (const [code, p] of pressed) {
      if (p.target === this) pressed.delete(code);
    }
    for (const [n, t] of midiHeld) if (t === this) midiHeld.delete(n);
    for (const m of this.down) this.handlers.onNoteOff(m, "qwerty");
    this.down.clear();
    this.deferred.clear();
  }

  dispose(): void {
    this.releaseAll();
    targets.delete(this);
    if (lastTouched === this) lastTouched = null;
    if (ringTarget === this) {
      this.el.classList.remove("is-note-target");
      ringTarget = null;
    }
    this.el.removeEventListener("pointerdown", this.onPointer, true);
    this.el.removeEventListener("focusin", this.onPointer);
  }
}
