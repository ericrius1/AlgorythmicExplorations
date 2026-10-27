// The accompanist's brain. It listens through a KeyEar, picks a chord every
// half bar, voices it close to the last one, and plans half a bar of bass,
// keys and brushes at a time. How much it plays depends on how much you play.
// When you leave a gap after a phrase, it answers.

import { BandClock, pageNow, toAudioTime } from "./clock";
import { KeyEar, bestChord, chordEvidence, scoreChords, type ChordScore } from "./ear";
import { BandVoices, type VoiceName } from "./instruments";
import { ANSWER_MODES, IntervalHabits, makeAnswer, type AnswerMode, type CallNote } from "./responder";
import {
  type Chord,
  type Key,
  chordName,
  pcOf,
  roman,
  rootlessTones,
  sameChord,
  triadPcs,
  voiceLead,
} from "./theory";

export type Style = "fill" | "comp" | "hold";
export type StyleSetting = "auto" | Style;
export type AnswerSetting = "off" | "auto" | AnswerMode;

export type NoteKind = "comp" | "pad" | "arp" | "bass" | "answer" | "drum";
export interface BandNote {
  voice: VoiceName;
  kind: NoteKind;
  midi: number;
  step: number;
  t: number; // page time it sounds
  dur: number; // seconds
  vel: number;
  cancelled?: boolean;
}

export interface PlayerNote {
  midi: number;
  t0: number;
  t1: number | null;
  ghost: boolean;
}

export interface ChordMark {
  t: number;
  chord: Chord;
  key: Key;
  name: string;
  roman: string;
}

export interface AnswerSpan {
  mode: AnswerMode;
  t0: number;
  t1: number;
  callT0: number;
  callT1: number;
}

const HISTORY = 14; // seconds of notes kept for drawing

export class Accompanist {
  readonly ear = new KeyEar();
  readonly clock: BandClock;
  voices: BandVoices | null = null;
  style: StyleSetting = "auto";
  resolved: Style = "fill";
  groove = true;
  answers: AnswerSetting = "auto";
  chord: Chord | null = null;
  chordScores: ChordScore[] = [];
  readonly marks: ChordMark[] = [];
  readonly band: BandNote[] = [];
  readonly player: PlayerNote[] = [];
  readonly spans: AnswerSpan[] = [];
  readonly habits = new IntervalHabits();
  leadLevel = 1; // the player's own instrument
  onStepHook: ((step: number, t: number) => void) | null = null;
  onUserNote: (() => void) | null = null;

  private onsets: number[] = [];
  private planned = new Map<number, BandNote[]>();
  private compPrev: number[] = [];
  private padPrev: number[] = [];
  private call: CallNote[] = [];
  private callT0 = 0;
  private lastActivity = -1e9;
  private answered = true;
  private answerUntilStep = -1;
  private lastMode: AnswerMode | null = null;
  private lastUpdate = pageNow();
  private quietSince = pageNow();
  private ev = new Float32Array(12);
  private heldStart = new Map<number, PlayerNote>();

  constructor(bpm = 96) {
    this.clock = new BandClock(bpm, (step, t) => this.onStep(step, t));
    this.clock.swing = 0.6;
  }

  get beat(): number {
    return 60 / this.clock.bpm;
  }

  attachVoices(v: BandVoices): void {
    this.voices = v;
  }

  // ---- input ------------------------------------------------------------------

  noteOn(m: number, vel = 0.75): void {
    this.voices?.leadOn(m, vel * this.leadLevel);
    this.onUserNote?.();
    this.hearOn(m, pageNow(), false);
  }

  noteOff(m: number): void {
    this.voices?.leadOff(m);
    this.hearOff(m, pageNow());
  }

  // A note from an automatic player, scheduled at page time t.
  ghostNote(m: number, t: number, dur: number, vel: number): void {
    const v = this.voices;
    if (v) {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      v.lead.triggerAttackRelease(f, dur, toAudioTime(t), vel * this.leadLevel);
    }
    const now = pageNow();
    window.setTimeout(() => this.hearOn(m, t, true), Math.max(0, (t - now) * 1000));
    window.setTimeout(() => this.hearOff(m, t + dur), Math.max(0, (t + dur - now) * 1000));
  }

  private hearOn(m: number, t: number, ghost: boolean): void {
    if (this.ear.held.has(m)) return;
    this.ear.noteOn(m);
    const n: PlayerNote = { midi: m, t0: t, t1: null, ghost };
    this.player.push(n);
    this.heldStart.set(m, n);
    this.onsets.push(t);
    if (!this.clock.isRunning) this.clock.start();
    this.quietSince = Infinity;

    // call tracking: a gap of more than a beat starts a new phrase
    const newPhrase = t - this.lastActivity > this.beat * 1.05 || this.call.length === 0;
    if (newPhrase) {
      this.call = [];
      this.callT0 = t;
    }
    this.habits.observe(m, this.ear.key, newPhrase);
    this.call.push({ midi: m, step: this.clock.stepAt(t), dur: 1 });
    this.answered = false;
    this.lastActivity = t;
    // the band stops talking when you start again
    this.cancelAnswer();
  }

  private hearOff(m: number, t: number): void {
    this.ear.noteOff(m);
    const n = this.heldStart.get(m);
    if (n) {
      n.t1 = t;
      this.heldStart.delete(m);
      const c = [...this.call].reverse().find((x) => x.midi === m);
      if (c) c.dur = Math.max(0.5, this.clock.stepAt(t) - c.step);
    }
    this.lastActivity = Math.max(this.lastActivity, t);
    if (this.ear.held.size === 0) this.quietSince = t;
  }

  notesPerSecond(now = pageNow()): number {
    while (this.onsets.length && this.onsets[0] < now - 4) this.onsets.shift();
    return this.onsets.length / 4;
  }

  // ---- per frame ------------------------------------------------------------------

  update(): void {
    const now = pageNow();
    const dt = Math.min(0.1, now - this.lastUpdate);
    this.lastUpdate = now;
    this.ear.update(dt);
    chordEvidence(this.ear, this.ev);
    this.chordScores = scoreChords(this.ev, this.ear.key, this.chord, { useKey: true, inertia: 0.06 }, this.chordScores);

    // the phrase is over: one beat of silence after at least three notes
    if (
      !this.answered &&
      this.answers !== "off" &&
      this.clock.isRunning &&
      this.ear.held.size === 0 &&
      this.call.length >= 3 &&
      now - this.lastActivity > this.beat * 0.95 &&
      this.ear.key &&
      this.chord
    ) {
      this.answered = true;
      this.scheduleAnswer();
    }

    // long silence: the band winds down after eight bars
    if (this.clock.isRunning && now - this.quietSince > this.beat * 32 && this.answerUntilStep < this.clock.nextStep) {
      this.stop();
    }

    // forget what scrolled off the left edge
    const cut = now - HISTORY;
    while (this.player.length && (this.player[0].t1 ?? Infinity) < cut) this.player.shift();
    while (this.band.length && this.band[0].t + this.band[0].dur < cut) this.band.shift();
    while (this.marks.length > 1 && this.marks[1].t < cut) this.marks.shift();
    while (this.spans.length && this.spans[0].t1 < cut) this.spans.shift();
  }

  start(): void {
    this.clock.start();
    this.quietSince = pageNow();
  }

  stop(): void {
    this.clock.stop();
    for (const list of this.planned.values()) for (const n of list) n.cancelled = true;
    this.planned.clear();
    this.voices?.hush();
    this.answerUntilStep = -1;
  }

  reset(): void {
    this.stop();
    this.ear.reset();
    this.chord = null;
    this.compPrev = [];
    this.padPrev = [];
    this.call = [];
    this.marks.length = 0;
  }

  // ---- the clock ---------------------------------------------------------------------

  private onStep(step: number, t: number): void {
    this.onStepHook?.(step, t);
    const s16 = step % 16;
    if (s16 === 0) this.resolveStyle();
    if (step % 8 === 0) this.planHalfBar(step);
    else if (step % 8 === 4) this.maybeChangeOnBeat(step);

    const due = this.planned.get(step);
    if (!due) return;
    this.planned.delete(step);
    const v = this.voices;
    for (const n of due) {
      if (n.cancelled || !v) continue;
      v.play(n.voice, n.midi, n.dur, toAudioTime(n.t), n.vel);
    }
  }

  private resolveStyle(): void {
    if (this.style !== "auto") {
      this.resolved = this.style;
      return;
    }
    // the seesaw: the more you play, the less the band plays
    const nps = this.notesPerSecond();
    this.resolved = nps < 0.7 ? "fill" : nps < 2.6 ? "comp" : "hold";
  }

  private chooseChord(step: number, strict: boolean): boolean {
    const key = this.ear.key;
    if (!key) return false;
    const best = bestChord(this.chordScores);
    const top = this.chordScores.find((s) => s.id === best.root * 3 + ["maj", "min", "dim"].indexOf(best.q));
    if (!top || top.fit < (strict ? 0.45 : 0.15)) return !!this.chord;
    if (sameChord(best, this.chord)) return true;
    this.chord = best;
    this.marks.push({
      t: this.clock.timeOf(step),
      chord: best,
      key,
      name: chordName(best, key),
      roman: roman(best, key),
    });
    return true;
  }

  private maybeChangeOnBeat(step: number): void {
    // mid-half-bar changes only for clear chords under the fingers
    if (this.ear.held.size < 2) return;
    const before = this.chord;
    if (!this.chooseChord(step, true) || sameChord(before, this.chord)) return;
    // replan the rest of this half bar
    for (let s = step; s < step + 4; s++) {
      const list = this.planned.get(s);
      if (!list) continue;
      for (const n of list) if (n.kind !== "drum" && n.kind !== "answer") n.cancelled = true;
    }
    this.planHarmony(step, 4);
  }

  private add(step: number, voice: VoiceName, kind: NoteKind, midi: number, durSteps: number, vel: number): void {
    const t = this.clock.timeOf(step) + this.clock.swingOf(step);
    const n: BandNote = {
      voice,
      kind,
      midi,
      step,
      t,
      dur: durSteps * this.clock.stepDur,
      vel: Math.max(0.05, Math.min(1, vel + (Math.random() - 0.5) * 0.1)),
    };
    let list = this.planned.get(step);
    if (!list) this.planned.set(step, (list = []));
    list.push(n);
    this.band.push(n);
  }

  private planHalfBar(step: number): void {
    const playing = !!this.ear.key && this.player.length > 0;
    if (!playing) return;
    this.chooseChord(step, false);
    if (this.groove) this.planDrums(step);
    this.planHarmony(step, 8);
  }

  private planDrums(step: number): void {
    for (let b = step; b < step + 8; b += 4) {
      const beatInBar = (b % 16) / 4;
      this.add(b, "ride", "drum", 0, 2, beatInBar % 2 === 1 ? 0.5 : 0.36);
      if (beatInBar % 2 === 1) {
        this.add(b, "brush", "drum", 0, 1, 0.5);
        this.add(b + 2, "ride", "drum", 0, 1, 0.26); // the swung skip beat
      }
      if (beatInBar === 0) this.add(b, "kick", "drum", 0, 1, 0.55);
      if (beatInBar === 2) this.add(b, "kick", "drum", 0, 1, 0.3);
    }
  }

  private planHarmony(step: number, len: number): void {
    const key = this.ear.key;
    const chord = this.chord;
    if (!key || !chord) return;
    const answering = this.answerUntilStep > step;
    const tri = triadPcs(chord);
    const root = tri[0];
    const bassRoot = 36 + ((root - 36) % 12 + 12) % 12; // C2..B2
    const fifth = bassRoot + 7 > 50 ? bassRoot - 5 : bassRoot + 7;
    const half = step % 16 === 0 ? 0 : 1;
    const style = this.resolved;
    const end = step + len;
    const at = (off: number): number => step + off;
    const inRange = (s: number): boolean => s >= step && s < end;

    // ---- bass ----
    if (style === "hold") {
      if (len === 8) this.add(step, "bass", "bass", bassRoot, 7.6, 0.85);
      else this.add(step, "bass", "bass", bassRoot, len - 0.4, 0.75);
    } else if (style === "comp") {
      // a two-feel: root on one, fifth on three, sometimes a pickup into the next bar
      this.add(step, "bass", "bass", half === 0 || len === 4 ? bassRoot : fifth, 3.6, 0.85);
      if (inRange(at(4))) this.add(at(4), "bass", "bass", half === 0 ? bassRoot : fifth, 1.7, 0.55);
      if (half === 1 && inRange(at(6)) && Math.random() < 0.4) {
        this.add(at(6), "bass", "bass", bassRoot + (Math.random() < 0.5 ? -1 : 1), 1.6, 0.6);
      }
    } else {
      this.add(step, "bass", "bass", bassRoot, 3.6, 0.85);
      if (inRange(at(4))) this.add(at(4), "bass", "bass", Math.random() < 0.5 ? fifth : bassRoot + 12, 3.2, 0.6);
    }

    // ---- keys ----
    if (style === "hold" || answering) {
      // sustained pad: plain triad, held for the half bar
      this.padPrev = voiceLead(this.padPrev, [...tri], 55);
      for (const m of this.padPrev) this.add(step, "pad", "pad", m, len - 0.3, answering ? 0.32 : 0.45);
      if (answering && style !== "hold") {
        // one soft chord on the keys so the harmony still speaks
        this.compPrev = voiceLead(this.compPrev, rootlessTones(chord, key), 52);
        if (half === 0) for (const m of this.compPrev) this.add(step, "keys", "comp", m, 3, 0.35);
      }
      return;
    }
    if (style === "comp") {
      this.compPrev = voiceLead(this.compPrev, rootlessTones(chord, key), 52);
      // jazz comping figures, in eighth-note slots of the half bar
      const figures = [[0], [2], [6], [0, 6], [2, 6], [4], [0, 4], [6]];
      const fig = figures[Math.floor(Math.random() * figures.length)];
      for (const off of fig) {
        if (!inRange(at(off))) continue;
        const dur = off === 6 ? 2.6 : 1.6;
        for (const m of this.compPrev) this.add(at(off), "keys", "comp", m, dur, 0.62);
      }
      return;
    }
    // fill: a soft pad and an arpeggio running through the space you left
    this.padPrev = voiceLead(this.padPrev, [...tri], 55);
    for (const m of this.padPrev) this.add(step, "pad", "pad", m, len - 0.3, 0.3);
    const arp = [...this.padPrev, this.padPrev[0] + 12];
    const order = half === 0 ? [0, 1, 2, 3] : [3, 2, 1, 2];
    for (let i = 0; i < len / 2; i++) {
      const s = at(i * 2);
      this.add(s, "keys", "arp", arp[order[i % 4]] + 12, 1.7, i === 0 ? 0.5 : 0.38);
    }
  }

  // ---- answers --------------------------------------------------------------------------

  private pickMode(): AnswerMode {
    if (this.answers !== "auto" && this.answers !== "off") return this.answers;
    const opts = ANSWER_MODES.filter((m) => m !== this.lastMode && (m !== "riff" || this.habits.total > 4));
    const m = opts[Math.floor(Math.random() * opts.length)];
    this.lastMode = m;
    return m;
  }

  private scheduleAnswer(): void {
    const key = this.ear.key!;
    const chord = this.chord!;
    const call = this.call.slice(0, 12);
    const first = Math.round(call[0].step / 2) * 2;
    const lastEnd = call.reduce((a, n) => Math.max(a, n.step + n.dur), first);
    // answer at the same place in the bar the call started, one phrase later
    let start = first + Math.max(8, Math.ceil((lastEnd - first) / 8) * 8);
    const soonest = this.clock.nextStep + 1;
    while (start < soonest) start += 4;
    const mode = this.pickMode();
    const notes = makeAnswer(call, key, chord, mode, this.habits);
    if (!notes.length) return;
    let endStep = start;
    for (const n of notes) {
      this.add(start + n.offset, "vibes", "answer", n.midi, n.dur * 0.95, 0.72);
      endStep = Math.max(endStep, start + n.offset + n.dur);
    }
    this.answerUntilStep = endStep;
    this.spans.push({
      mode,
      t0: this.clock.timeOf(start),
      t1: this.clock.timeOf(endStep),
      callT0: this.callT0,
      callT1: this.lastActivity,
    });
  }

  private cancelAnswer(): void {
    if (this.answerUntilStep < 0) return;
    const now = pageNow();
    for (const list of this.planned.values()) {
      for (const n of list) if (n.kind === "answer" && n.t > now + 0.03) n.cancelled = true;
    }
    const span = this.spans[this.spans.length - 1];
    if (span && span.t1 > now) span.t1 = Math.max(span.t0, now);
    this.answerUntilStep = -1;
  }

  // ---- for the readouts ------------------------------------------------------------------

  chordLabel(): string {
    const key = this.ear.key;
    if (!key || !this.chord) return "";
    return `${chordName(this.chord, key)} · ${roman(this.chord, key)}`;
  }

  heldPcs(): number[] {
    return [...this.ear.held.keys()].map(pcOf);
  }
}
