// Naming the chord. Every triad (12 roots × major, minor, diminished) is
// scored against what you're holding plus the last second or so of notes.
// With the key prior on, chords that belong to the key get a head start, and
// the tonic, subdominant and dominant a little more. The winner is played
// back softly under your notes.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { pageNow, toAudioTime } from "./clock";
import { C, font, rgba, roundRect, ui } from "./draw";
import { KeyEar, bestChord, chordEvidence, scoreChords, type ChordScore } from "./ear";
import { LeadVoice } from "./instruments";
import { TouchPiano, onOctave, qwertyBase, registerSink } from "./input";
import {
  type Chord,
  type Key,
  FIFTHS,
  QUALITIES,
  chordId,
  chordName,
  diatonicChords,
  keyName,
  roman,
  sameChord,
  spell,
  triadPcs,
  voiceLead,
} from "./theory";
import { playGate, segmented, smallButton, stage } from "./ui";

const EXAMPLES: { label: string; notes: number[] }[] = [
  { label: "D + A", notes: [62, 69] },
  { label: "A + C", notes: [57, 60] },
  { label: "G B D F", notes: [55, 59, 62, 65] },
  { label: "B D F", notes: [59, 62, 65] },
  { label: "B♭ D F", notes: [58, 62, 65] },
  { label: "E G♯ B", notes: [64, 68, 71] },
];

export function mountChordFinder(container: HTMLElement): Demo {
  const shell = new Shell(container, (window.innerWidth || 1024) < 560 ? 0.9 : 0.46);
  const g = shell.canvas.getContext("2d")!;
  const wrap = stage(shell);
  const ear = new KeyEar();
  ear.fastHalfLife = 0.9;
  let key: Key = { root: 0, minor: false };
  let useKey = true;
  let voice: LeadVoice | null = null;
  let soundOn = false;
  let chord: Chord | null = null;
  let voicing: number[] = [];
  let scores: ChordScore[] = [];
  const ev = new Float32Array(12);
  let timers: number[] = [];
  // before the reader starts it, show G B D F being held
  let frozen = true;
  const preview = [55, 59, 62, 65];
  for (const m of preview) ear.noteOn(m);

  const turnOn = (): void => {
    if (!voice) voice = new LeadVoice();
    voice.fadeTo(1, 0.1);
    soundOn = true;
    if (frozen) {
      frozen = false;
      for (const m of preview) ear.noteOff(m);
    }
  };
  const gate = playGate(wrap, "Tap to play", "hold notes, or try an example below", turnOn);

  const on = (m: number, v = 0.72): void => {
    if (!soundOn) gate.el.click();
    voice?.on(m, v);
    ear.noteOn(m);
  };
  const off = (m: number): void => {
    voice?.off(m);
    ear.noteOff(m);
  };

  const piano = new TouchPiano(48, 84, (m) => on(m), off);
  piano.setCaps(qwertyBase());
  onOctave((b) => piano.setCaps(b));
  wrap.after(piano.el);
  registerSink({ el: container, armed: () => soundOn, noteOn: on, noteOff: off });

  for (const ex of EXAMPLES) {
    smallButton(shell.controls, ex.label, () => {
      for (const t of timers) clearTimeout(t);
      timers = [];
      for (const m of [...ear.held.keys()]) off(m);
      for (const m of ex.notes) on(m, 0.6);
      timers.push(window.setTimeout(() => ex.notes.forEach(off), 1800));
    });
  }
  const brk = document.createElement("span");
  brk.className = "mp-break";
  shell.controls.appendChild(brk);
  const KEYS: Record<string, Key> = {
    "C major": { root: 0, minor: false },
    "G major": { root: 7, minor: false },
    "A minor": { root: 9, minor: true },
  };
  segmented(shell.controls, "key", Object.keys(KEYS), "C major", (v) => (key = KEYS[v]));
  segmented(shell.controls, "key prior", ["on", "off"] as const, "on", (v) => (useKey = v === "on"));

  const guard = frameGuard(() => {
    if (!soundOn) return;
    for (const t of timers) clearTimeout(t);
    timers = [];
    for (const m of [...ear.held.keys()]) off(m);
    soundOn = false;
    voice?.fadeTo(0, 0.1);
    gate.show("Tap to resume");
  });

  shell.setInfo(() => {
    if (!chord) return `${keyName(key)} · hold two or three notes`;
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    const [a, b] = sorted;
    const name = (s: ChordScore): string => chordName({ root: Math.floor(s.id / 3), q: QUALITIES[s.id % 3] }, key);
    return `best ${name(a)} ${a.score.toFixed(2)} · runner-up ${name(b)} ${b.score.toFixed(2)} · in ${keyName(key)}`;
  });

  let last = pageNow();
  const shown = new Float32Array(36);

  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = pageNow();
      if (!frozen) ear.update(Math.min(0.1, now - last));
      last = now;
      chordEvidence(ear, ev);
      let total = 0;
      for (let i = 0; i < 12; i++) total += ev[i];
      scores = scoreChords(ev, key, chord, { useKey, inertia: useKey ? 0.06 : 0 }, scores);
      if (total > 0.25) {
        const b = bestChord(scores);
        if (!sameChord(b, chord)) {
          chord = b;
          voicing = voiceLead(voicing, [...triadPcs(b)], 48);
          if (soundOn && voice && ear.held.size > 0) voice.chord(voicing, 1.4, toAudioTime(now + 0.02), 0.45);
        }
      }
      for (const sc of scores) shown[sc.id] += (sc.score - shown[sc.id]) * 0.2;

      const W = shell.canvas.width;
      const H = shell.canvas.height;
      const s = ui(shell.canvas);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);

      // ---- evidence ----
      const ex = 16 * s;
      const ey = 34 * s;
      const ew = Math.min(W * 0.55, 420 * s);
      const eh = H * 0.2;
      g.fillStyle = "rgba(220,226,245,0.85)";
      g.font = font(12 * s, 650);
      g.fillText(frozen ? "evidence: holding G B D F" : "evidence: held notes + the last second", ex, 20 * s);
      let mx = 1;
      for (let i = 0; i < 12; i++) mx = Math.max(mx, ev[i]);
      const cw = ew / 12;
      const held = new Set([...ear.held.keys()].map((m) => ((m % 12) + 12) % 12));
      for (let pc = 0; pc < 12; pc++) {
        const v = ev[pc] / mx;
        const x = ex + pc * cw;
        g.fillStyle = "rgba(122,162,255,0.06)";
        g.fillRect(x + cw * 0.2, ey, cw * 0.6, eh);
        g.fillStyle = held.has(pc) ? rgba(C.you, 0.95) : rgba(C.you, 0.4);
        g.fillRect(x + cw * 0.2, ey + eh - v * eh, cw * 0.6, v * eh);
        g.fillStyle = held.has(pc) ? "#fff" : "rgba(200,210,240,0.65)";
        g.font = font(10 * s, 600);
        g.textAlign = "center";
        g.fillText(spell(pc, key), x + cw / 2, ey + eh + 13 * s);
        g.textAlign = "left";
      }

      // the winner, large, at the right of the evidence
      if (chord) {
        g.textAlign = "right";
        g.fillStyle = "rgba(255,206,150,0.96)";
        g.font = font(26 * s, 750);
        g.fillText(chordName(chord, key), W - 18 * s, 38 * s);
        g.font = font(12 * s, 600, true);
        g.fillStyle = "rgba(255,206,150,0.7)";
        g.fillText(`${roman(chord, key)} in ${keyName(key)}`, W - 18 * s, 56 * s);
        g.textAlign = "left";
      }

      // ---- the grid: roots in circle-of-fifths order ----
      const gx = 16 * s + 26 * s;
      const gy = ey + eh + 30 * s;
      const gw = W - gx - 16 * s;
      const cell = gw / 12;
      const rowH = Math.min((H - gy - 12 * s) / 3 - 5 * s, 64 * s);
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of shown) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      const dia = diatonicChords(key);
      const rowNames = ["maj", "min", "dim"];
      for (let qi = 0; qi < 3; qi++) {
        const y = gy + qi * (rowH + 5 * s);
        g.fillStyle = "rgba(170,180,210,0.6)";
        g.font = font(10 * s, 600);
        g.fillText(rowNames[qi], 16 * s, y + rowH * 0.6);
        for (let slot = 0; slot < 12; slot++) {
          const c: Chord = { root: FIFTHS[slot], q: QUALITIES[qi] };
          const id = chordId(c);
          const v = hi > lo && total > 0.25 ? (shown[id] - lo) / (hi - lo) : 0;
          const x = gx + slot * cell;
          const win = sameChord(c, chord) && total > 0.25;
          const inKey = dia.some((d) => sameChord(d, c));
          g.fillStyle = win ? rgba(C.comp, 0.6) : rgba(C.accent, 0.03 + Math.pow(v, 2.2) * 0.6);
          if (win) {
            g.shadowColor = rgba(C.comp, 0.9);
            g.shadowBlur = 14 * s;
          }
          roundRect(g, x + 1.5 * s, y, cell - 3 * s, rowH, 5 * s);
          g.fill();
          g.shadowBlur = 0;
          if (inKey && useKey) {
            g.strokeStyle = rgba(C.accent, 0.5);
            g.lineWidth = s;
            g.stroke();
          }
          g.textAlign = "center";
          g.fillStyle = win ? "#fff" : `rgba(220,228,250,${0.35 + v * 0.65})`;
          g.font = font(Math.min(12 * s, cell * 0.3), 700);
          g.fillText(chordName(c, key), x + cell / 2, y + rowH * 0.62);
          g.textAlign = "left";
        }
      }
    },
    dispose() {
      for (const t of timers) clearTimeout(t);
      voice?.dispose();
    },
  };
}
