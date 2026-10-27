// The generative band. One seed writes a whole song: a style, a key and mode,
// a tempo and swing, a form (intro, verses, choruses, a bridge, an outro),
// chord progressions for each section voiced with the minimum-motion search
// from part six, Euclidean drum and percussion patterns, a bass line locked
// to the kick, and melodies built from short motifs that repeat and vary.
// Everything is written up front as a list of events on a step grid; the
// scheduler plays them with swing, per-instrument timing lean and 1/f
// "human" jitter, through a mixed and bussed set of synths. When the outro
// ends, the next song is written and the band carries on.

import {
  bjorklund,
  gaussian,
  mod12,
  mulberry32,
  PinkNoise,
  pick,
  rotate,
  voiceLead,
  weighted,
  keyUsesFlats,
  spell,
} from "./theory";
import {
  Clock,
  Tone,
  audioTime,
  bass as makeBass,
  drumKit,
  epiano,
  lead as makeLead,
  pad as makePad,
  setDelayTempo,
  startAudio,
  strip,
  type DrumName,
  type Inst,
  type Kit,
  type LeadKind,
  type Strip,
} from "./sound";

export type TrackName = "drums" | "bass" | "keys" | "pad" | "lead";
export const TRACKS: TrackName[] = ["drums", "bass", "keys", "pad", "lead"];
export type StyleName = "lofi" | "pop" | "afro" | "bossa";
export type ModeName = "major" | "minor" | "dorian" | "mixolydian";
export type Humanize = "off" | "white" | "pink";

const SCALES: Record<ModeName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

type Ext = "triad" | "7" | "9" | "add9" | "sus2" | "sus4";

export interface Chord {
  deg: number;
  ext: Ext;
  root: number; // pitch class
  pcs: number[]; // pitch classes, root first
  label: string;
}

export type SectionKind = "intro" | "verse" | "chorus" | "bridge" | "outro";

export interface Section {
  kind: SectionKind;
  startBar: number;
  bars: number;
  energy: number;
}

export interface NoteEvent {
  step: number; // absolute step in the song
  track: TrackName;
  midi: number; // for drums: unused
  drum?: DrumName;
  dur: number; // in steps
  vel: number;
  lean: number; // seconds, a steady push or drag for this instrument
  jw: number; // white jitter, seconds (unit-scaled)
  jp: number; // pink jitter, seconds (unit-scaled)
  pitch?: number; // drum pitch in Hz, when it matters
  offset?: number; // seconds, e.g. the spread of a strummed chord
}

export interface Song {
  seed: number;
  style: StyleName;
  styleLabel: string;
  tonic: number;
  mode: ModeName;
  bpm: number;
  swing: number; // 0.5 straight … 0.66 triplet, applied to odd steps
  grid: number; // steps per bar
  stepsPerBeat: number;
  sections: Section[];
  chords: Chord[]; // one per bar
  events: NoteEvent[]; // sorted by step
  byStep: Map<number, NoteEvent[]>;
  totalSteps: number;
  drumRings: { name: DrumName; pattern: boolean[] }[]; // for the hero's rings
}

// ---- chords ----------------------------------------------------------------------

function chordOf(tonic: number, mode: ModeName, deg: number, ext: Ext): Chord {
  const flats = keyUsesFlats(tonic, mode);
  const sc = SCALES[mode];
  const at = (k: number): number => sc[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
  const iv = (k: number): number => at(k) - at(0);
  let e = ext;
  // keep extensions consonant with the mode: no diminished-fourth sus, no flat-nine
  if (e === "sus4" && iv(3) !== 5) e = "triad";
  if (e === "sus2" && iv(1) !== 2) e = "triad";
  if ((e === "9" || e === "add9") && mod12(iv(8)) !== 2) e = e === "9" ? "7" : "triad";
  const ks = e === "sus2" ? [0, 1, 4] : e === "sus4" ? [0, 3, 4] : e === "7" ? [0, 2, 4, 6] : e === "9" ? [0, 2, 4, 6, 8] : e === "add9" ? [0, 2, 4, 8] : [0, 2, 4];
  const root = mod12(tonic + sc[deg]);
  const pcs = ks.map((k) => mod12(tonic + at(k)));
  return { deg, ext: e, root, pcs, label: chordLabel(spell(root, flats), ks.map((k) => iv(k))) };
}

function chordLabel(name: string, iv: number[]): string {
  const has = (x: number): boolean => iv.map(mod12).includes(x);
  if (has(5) && !has(3) && !has(4)) return `${name}sus4`;
  if (has(2) && !has(3) && !has(4) && iv.length === 3) return `${name}sus2`;
  const minor = has(3);
  const dim = minor && has(6) && !has(7);
  const seventh = has(11) ? "maj7" : has(10) ? "7" : "";
  const ninth = iv.some((x) => x === 14);
  if (dim) return seventh ? `${name}m7♭5` : `${name}°`;
  const q = minor ? "m" : "";
  if (ninth && seventh) return seventh === "maj7" ? `${name}${q}maj9` : `${name}${q}9`;
  if (ninth) return `${name}${q}add9`;
  if (seventh === "maj7") return minor ? `${name}m(maj7)` : `${name}maj7`;
  if (seventh === "7") return `${name}${q}7`;
  return `${name}${q}`;
}

// Progression banks, as scale degrees (0 = tonic), four bars each.
const BANKS: Record<ModeName, Record<"verse" | "chorus" | "bridge", number[][]>> = {
  major: {
    verse: [
      [0, 4, 5, 3],
      [0, 5, 3, 4],
      [5, 3, 0, 4],
      [0, 3, 5, 4],
      [0, 2, 3, 4],
      [0, 5, 1, 4],
    ],
    chorus: [
      [3, 4, 2, 5],
      [3, 0, 4, 5],
      [3, 4, 0, 0],
      [5, 3, 0, 4],
      [0, 4, 5, 3],
    ],
    bridge: [
      [5, 4, 3, 4],
      [1, 4, 0, 5],
      [5, 3, 1, 4],
      [3, 3, 5, 4],
    ],
  },
  minor: {
    verse: [
      [0, 5, 2, 6],
      [0, 6, 5, 6],
      [0, 3, 6, 2],
      [0, 5, 3, 6],
    ],
    chorus: [
      [5, 6, 0, 0],
      [5, 2, 6, 0],
      [3, 5, 0, 6],
      [2, 6, 5, 6],
    ],
    bridge: [
      [3, 4, 5, 6],
      [5, 3, 0, 6],
      [3, 0, 3, 6],
    ],
  },
  dorian: {
    verse: [
      [0, 3, 0, 3],
      [0, 3, 6, 0],
      [0, 6, 3, 0],
    ],
    chorus: [
      [6, 3, 0, 0],
      [2, 3, 0, 0],
      [3, 6, 0, 4],
    ],
    bridge: [
      [2, 3, 2, 6],
      [6, 3, 6, 3],
    ],
  },
  mixolydian: {
    verse: [
      [0, 6, 3, 0],
      [0, 3, 6, 3],
      [0, 0, 6, 3],
    ],
    chorus: [
      [3, 6, 0, 0],
      [6, 3, 0, 4],
      [3, 0, 6, 0],
    ],
    bridge: [
      [4, 3, 6, 0],
      [5, 6, 3, 6],
    ],
  },
};

// ---- styles ---------------------------------------------------------------------------

interface StyleDef {
  label: string;
  bpm: [number, number];
  grid: number;
  stepsPerBeat: number;
  swing: [number, number];
  modes: [ModeName, number][];
  ext(rng: () => number, deg: number, kind: SectionKind): Ext;
  keys: "epiano" | "pluck" | "marimba";
  lead: LeadKind;
  padCutoff: number;
  leanMs: Partial<Record<TrackName | DrumName, number>>;
  jitterMs: Partial<Record<TrackName | DrumName, number>>;
  duck: number; // how far the kick ducks the pad and keys (0..1)
}

const STYLES: Record<StyleName, StyleDef> = {
  lofi: {
    label: "lo-fi",
    bpm: [72, 84],
    grid: 16,
    stepsPerBeat: 4,
    swing: [0.56, 0.61],
    modes: [
      ["major", 3],
      ["dorian", 2],
      ["minor", 1],
    ],
    ext: (rng, deg) => (deg === 4 ? (rng() < 0.6 ? "7" : "9") : rng() < 0.55 ? "7" : "9"),
    keys: "epiano",
    lead: "flute",
    padCutoff: 900,
    leanMs: { snare: 14, rim: 10, hat: -3, keys: 12, bass: 6, lead: 5 },
    jitterMs: { kick: 4, snare: 6, hat: 6, keys: 8, bass: 5, lead: 9, rim: 6, openhat: 6 },
    duck: 0.18,
  },
  pop: {
    label: "synth-pop",
    bpm: [104, 118],
    grid: 16,
    stepsPerBeat: 4,
    swing: [0.5, 0.5],
    modes: [
      ["major", 3],
      ["minor", 2],
    ],
    ext: (rng, deg, kind) => (kind === "chorus" && (deg === 0 || deg === 3) && rng() < 0.35 ? "add9" : deg === 4 && rng() < 0.25 ? "sus4" : rng() < 0.12 ? "sus2" : "triad"),
    keys: "pluck",
    lead: "square",
    padCutoff: 1700,
    leanMs: { clap: 2, hat: -2 },
    jitterMs: { kick: 1.5, snare: 2, clap: 2, hat: 3, keys: 2, bass: 2, lead: 4, openhat: 3 },
    duck: 0.4,
  },
  afro: {
    label: "12/8 bell groove",
    bpm: [100, 112],
    grid: 12,
    stepsPerBeat: 3,
    swing: [0.5, 0.5],
    modes: [
      ["dorian", 2],
      ["mixolydian", 2],
      ["major", 1],
    ],
    ext: (rng) => (rng() < 0.3 ? "7" : "triad"),
    keys: "marimba",
    lead: "flute",
    padCutoff: 1200,
    leanMs: { conga: 4, shaker: -2 },
    jitterMs: { bell: 2.5, kick: 4, conga: 7, shaker: 5, keys: 6, bass: 5, lead: 8 },
    duck: 0.12,
  },
  bossa: {
    label: "bossa",
    bpm: [124, 136],
    grid: 16,
    stepsPerBeat: 4,
    swing: [0.5, 0.52],
    modes: [
      ["major", 3],
      ["dorian", 1],
    ],
    ext: (rng, deg) => (deg === 4 ? "7" : rng() < 0.75 ? "7" : "9"),
    keys: "pluck",
    lead: "flute",
    padCutoff: 1000,
    leanMs: { rim: 3, keys: 6, lead: 6 },
    jitterMs: { kick: 4, rim: 4, shaker: 5, keys: 7, bass: 4, lead: 9 },
    duck: 0.1,
  },
};

export const STYLE_NAMES: StyleName[] = ["lofi", "pop", "afro", "bossa"];
export const styleLabel = (s: StyleName): string => STYLES[s].label;

// ---- the songwriter ----------------------------------------------------------------------

interface MelNote {
  at: number; // step within the phrase
  dur: number;
  deg: number; // scale degree (can exceed 7: octaves)
  vel: number;
}

export function writeSong(seed: number, forceStyle?: StyleName): Song {
  const rng = mulberry32(seed);
  const style: StyleName = forceStyle ?? pick(rng, STYLE_NAMES);
  const S = STYLES[style];
  const mode = weighted(rng, S.modes);
  const tonic = Math.floor(rng() * 12);
  const bpm = Math.round(S.bpm[0] + rng() * (S.bpm[1] - S.bpm[0]));
  const swing = S.swing[0] + rng() * (S.swing[1] - S.swing[0]);
  const G = S.grid;
  const sc = SCALES[mode];

  // ---- form ----
  const short = style === "afro" ? 1 : 0; // the bell groove gets a longer groove-in
  const plan: [SectionKind, number, number][] = [
    ["intro", 4 + short * 4, 0.28],
    ["verse", 8, 0.55],
    ["chorus", 8, 0.85],
    ["verse", 8, 0.6],
    ["chorus", 8, 0.9],
    ["bridge", 8, 0.42],
    ["chorus", 8, 1],
    ["outro", 4, 0.22],
  ];
  const sections: Section[] = [];
  let bar = 0;
  for (const [kind, bars, energy] of plan) {
    sections.push({ kind, startBar: bar, bars, energy });
    bar += bars;
  }
  const totalBars = bar;

  // ---- harmony ----
  const progs = {
    verse: pick(rng, BANKS[mode].verse),
    chorus: pick(rng, BANKS[mode].chorus),
    bridge: pick(rng, BANKS[mode].bridge),
  };
  if (progs.chorus.join() === progs.verse.join()) progs.chorus = BANKS[mode].chorus[0];
  const extFor = new Map<string, Ext>();
  const chords: Chord[] = [];
  for (const sec of sections) {
    const src = sec.kind === "intro" || sec.kind === "outro" ? progs.verse : progs[sec.kind];
    for (let b = 0; b < sec.bars; b++) {
      let deg = src[b % src.length];
      // outro and the last bar of the song come home
      if (sec.kind === "outro" && b === sec.bars - 1) deg = 0;
      const k = `${sec.kind}:${deg}`;
      if (!extFor.has(k)) extFor.set(k, S.ext(rng, deg, sec.kind));
      chords.push(chordOf(tonic, mode, deg, extFor.get(k)!));
    }
  }

  // ---- events ----
  const events: NoteEvent[] = [];
  const pinkBy = new Map<string, PinkNoise>();
  const jitRng = mulberry32(seed ^ 0x9e3779b9);
  const add = (e: Omit<NoteEvent, "lean" | "jw" | "jp">, who: TrackName | DrumName): void => {
    let pn = pinkBy.get(who);
    if (!pn) {
      pn = new PinkNoise(jitRng, 6);
      pinkBy.set(who, pn);
    }
    const sd = (S.jitterMs[who] ?? 4) / 1000;
    events.push({
      ...e,
      vel: Math.max(0.05, Math.min(1, e.vel)),
      lean: (S.leanMs[who] ?? 0) / 1000,
      jw: gaussian(jitRng) * sd,
      jp: pn.next() * sd,
    });
  };
  const drum = (step: number, d: DrumName, vel: number, pitch?: number): void => {
    add({ step, track: "drums", midi: 0, drum: d, dur: 1, vel, pitch }, d);
  };

  const secOf = (b: number): Section => sections.find((s) => b >= s.startBar && b < s.startBar + s.bars)!;

  // drum patterns (the Euclidean ones are the point of this article)
  const E = (k: number, n: number, r = 0): boolean[] => rotate(bjorklund(k, n), r);
  const lofiKicks = [
    [0, 10],
    [0, 7, 10],
    [0, 3, 10],
    [0, 10, 11],
  ];
  const lofiKick = pick(rng, lofiKicks);
  const lofiKickB = pick(rng, lofiKicks);
  const bell = E(7, 12); // x.xx.x.xx.x.
  const conga = E(5, 12, 2 + Math.floor(rng() * 3));
  const clave = E(5, 16, 13); // bossa clave: x..x..x...x..x..
  const popHatK = 11 + Math.floor(rng() * 3);
  const rings: { name: DrumName; pattern: boolean[] }[] = [];
  const toPat = (steps: number[], n: number): boolean[] => Array.from({ length: n }, (_, i) => steps.includes(i));
  if (style === "lofi") {
    rings.push({ name: "kick", pattern: toPat(lofiKick, 16) }, { name: "snare", pattern: toPat([4, 12], 16) }, { name: "hat", pattern: E(8, 16) });
  } else if (style === "pop") {
    rings.push({ name: "kick", pattern: E(4, 16) }, { name: "clap", pattern: toPat([4, 12], 16) }, { name: "hat", pattern: E(popHatK, 16) });
  } else if (style === "afro") {
    rings.push({ name: "bell", pattern: bell }, { name: "conga", pattern: conga }, { name: "kick", pattern: E(4, 12) });
  } else {
    rings.push({ name: "rim", pattern: clave }, { name: "kick", pattern: toPat([0, 6, 8, 14], 16) }, { name: "shaker", pattern: E(8, 16) });
  }

  for (let b = 0; b < totalBars; b++) {
    const sec = secOf(b);
    const inSec = b - sec.startBar;
    const last = inSec === sec.bars - 1;
    const next = sections[sections.indexOf(sec) + 1];
    const fill = last && next && next.energy >= 0.5;
    const e = sec.energy;
    const s0 = b * G;

    if (style === "lofi") {
      const kicks = inSec % 4 === 3 ? lofiKickB : lofiKick;
      if (e >= 0.4) {
        for (const st of kicks) if (!(fill && st >= 12)) drum(s0 + st, "kick", st === 0 ? 0.95 : 0.78);
        drum(s0 + 4, e > 0.5 ? "snare" : "rim", 0.82 + rng() * 0.08);
        if (!fill) drum(s0 + 12, e > 0.5 ? "snare" : "rim", 0.86 + rng() * 0.08);
        if (rng() < 0.35 && !fill) drum(s0 + pick(rng, [7, 9, 15]), "snare", 0.16 + rng() * 0.06); // ghost
      }
      if (e >= 0.2) {
        for (let st = 0; st < 16; st += 2) drum(s0 + st, st === 14 && e > 0.8 && rng() < 0.3 ? "openhat" : "hat", (st % 4 === 0 ? 0.6 : 0.4) + rng() * 0.08);
        if (e > 0.5) for (let st = 1; st < 16; st += 4) if (rng() < 0.45) drum(s0 + st + 2, "hat", 0.2 + rng() * 0.06);
      }
      if (fill) {
        drum(s0 + 12, "snare", 0.7);
        drum(s0 + 14, "snare", 0.55);
        drum(s0 + 15, "snare", 0.75);
      }
    } else if (style === "pop") {
      if (e >= 0.4) {
        const fourFloor = sec.kind === "chorus" || e > 0.8;
        const ks = fourFloor ? [0, 4, 8, 12] : [0, 6, 8];
        for (const st of ks) if (!(fill && st >= 12)) drum(s0 + st, "kick", st === 0 ? 1 : 0.88);
        for (const st of [4, 12]) {
          if (fill && st === 12) continue;
          drum(s0 + st, "clap", 0.8);
          drum(s0 + st, "snare", 0.45);
        }
      }
      if (e >= 0.25) {
        const hats = E(e > 0.7 ? popHatK : 8, 16);
        hats.forEach((on, st) => {
          if (on) drum(s0 + st, "hat", [0.55, 0.28, 0.42, 0.3][st % 4] + rng() * 0.06);
        });
        if (e > 0.8) for (const st of [2, 6, 10, 14]) drum(s0 + st, "openhat", 0.45);
      }
      if (inSec === 0 && (sec.kind === "chorus" || sec.kind === "verse") && b > 0) drum(s0, "crash", sec.kind === "chorus" ? 0.8 : 0.5);
      if (fill) for (let st = 12; st < 16; st++) drum(s0 + st, "snare", 0.4 + (st - 12) * 0.16);
    } else if (style === "afro") {
      bell.forEach((on, st) => {
        if (on && e >= 0.25) drum(s0 + st, "bell", (st === 0 ? 0.85 : 0.6) + rng() * 0.08, 740);
      });
      if (e >= 0.4) {
        for (const st of [0, 3, 6, 9]) if (!(fill && st >= 9)) drum(s0 + st, "kick", st === 0 ? 0.9 : st === 6 ? 0.75 : 0.5);
        conga.forEach((on, st) => {
          if (on && !(fill && st >= 6)) drum(s0 + st, "conga", 0.5 + rng() * 0.15, st % 3 === 0 ? 220 : 294);
        });
      }
      for (let st = 0; st < 12; st++) if (e >= 0.15) drum(s0 + st, "shaker", (st % 3 === 0 ? 0.5 : 0.28) + rng() * 0.06);
      if (fill) {
        const run = E(5, 6);
        run.forEach((on, k) => {
          if (on) drum(s0 + 6 + k, "conga", 0.5 + k * 0.08, k % 2 ? 330 : 247);
        });
      }
    } else {
      // bossa
      if (e >= 0.3) {
        clave.forEach((on, st) => {
          if (on) drum(s0 + st, "rim", 0.7 + rng() * 0.1, 1700);
        });
        for (const st of [0, 6, 8, 14]) drum(s0 + st, "kick", st % 8 === 0 ? 0.75 : 0.5);
      }
      for (let st = 0; st < 16; st++) if (e >= 0.2) drum(s0 + st, "shaker", (st % 4 === 0 ? 0.42 : st % 2 === 0 ? 0.3 : 0.2) + rng() * 0.05);
      if (fill) for (const st of [12, 13, 14, 15]) drum(s0 + st, "rim", 0.5 + (st - 12) * 0.1, 1500);
    }
  }

  // ---- bass ----
  let bassPrev = 40;
  const bassNote = (pc: number): number => {
    let m = pc + 12 * Math.round((bassPrev - pc) / 12);
    while (m < 33) m += 12;
    while (m > 45) m -= 12;
    bassPrev = m;
    return m;
  };
  for (let b = 0; b < totalBars; b++) {
    const sec = secOf(b);
    if (sec.energy < 0.35 && sec.kind !== "outro") continue;
    const c = chords[b];
    const nextC = chords[b + 1] ?? c;
    const s0 = b * G;
    const root = bassNote(c.root);
    const fifth = root + 7 <= 47 ? root + 7 : root - 5;
    if (sec.kind === "outro") {
      if (b === sec.startBar + sec.bars - 1) add({ step: s0, track: "bass", midi: root, dur: G * 0.9, vel: 0.7 }, "bass");
      continue;
    }
    const approach = (): number => {
      const target = nextC.root + 12 * Math.round((root - nextC.root) / 12);
      return target > root ? target - 1 : target + (target === root ? 0 : 1);
    };
    if (style === "lofi") {
      add({ step: s0, track: "bass", midi: root, dur: 6, vel: 0.85 }, "bass");
      add({ step: s0 + 7, track: "bass", midi: root, dur: 2, vel: 0.55 }, "bass");
      add({ step: s0 + 10, track: "bass", midi: rng() < 0.5 ? root : fifth, dur: 3, vel: 0.7 }, "bass");
      if (nextC.root !== c.root && rng() < 0.6) add({ step: s0 + 14, track: "bass", midi: approach(), dur: 2, vel: 0.6 }, "bass");
    } else if (style === "pop") {
      const busy = sec.energy > 0.7;
      for (let st = 0; st < 16; st += 2) {
        if (!busy && st % 4 !== 0 && st !== 6) continue;
        const up = busy && st % 4 === 2 && rng() < 0.35;
        add({ step: s0 + st, track: "bass", midi: up ? root + 12 : root, dur: busy ? 1.6 : 3, vel: st % 4 === 0 ? 0.85 : 0.62 }, "bass");
      }
    } else if (style === "afro") {
      add({ step: s0, track: "bass", midi: root, dur: 4, vel: 0.85 }, "bass");
      add({ step: s0 + 5, track: "bass", midi: fifth, dur: 1, vel: 0.55 }, "bass");
      add({ step: s0 + 6, track: "bass", midi: root, dur: 3, vel: 0.75 }, "bass");
      add({ step: s0 + 10, track: "bass", midi: nextC.root !== c.root ? approach() : fifth, dur: 2, vel: 0.6 }, "bass");
    } else {
      add({ step: s0, track: "bass", midi: root, dur: 5, vel: 0.8 }, "bass");
      add({ step: s0 + 6, track: "bass", midi: fifth, dur: 2, vel: 0.6 }, "bass");
      add({ step: s0 + 8, track: "bass", midi: fifth, dur: 5, vel: 0.72 }, "bass");
      add({ step: s0 + 14, track: "bass", midi: nextC.root !== c.root ? approach() : root, dur: 2, vel: 0.55 }, "bass");
    }
  }

  // ---- keys and pad, voice-led ----
  let keyVoices = [55, 60, 64, 67].map((m) => m + (tonic > 6 ? tonic - 12 : tonic));
  let padVoices = [57, 62, 66].map((m) => m + (tonic > 6 ? tonic - 12 : tonic));
  const compSets: Record<StyleName, number[][]> = {
    lofi: [
      [0, 6, 10],
      [0, 3, 8, 14],
      [0, 10],
      [0, 7, 11],
    ],
    pop: [[0]],
    afro: [E(5, 12, 1).map((x, i) => (x ? i : -1)).filter((i) => i >= 0)],
    bossa: [
      [0, 3, 6, 10, 13],
      [0, 3, 6, 9, 12],
    ],
  };
  const comp = pick(rng, compSets[style]);
  const compB = pick(rng, compSets[style]);
  const arpMask = E(popHatK - 2, 16, 1);
  for (let b = 0; b < totalBars; b++) {
    const sec = secOf(b);
    const c = chords[b];
    const s0 = b * G;
    const e = sec.energy;
    const pcs = c.pcs.length > 4 ? c.pcs.slice(1) : c.pcs; // rootless 9ths: the bass has the root
    keyVoices = voiceLead(keyVoices, pcs, 52, 76);
    padVoices = voiceLead(padVoices, c.pcs.slice(0, 3), 55, 74);

    // pad: intro, bridge, outro, and quietly under choruses
    if (sec.kind !== "verse" || style === "pop") {
      const v = sec.kind === "chorus" ? 0.42 : 0.6;
      for (const m of padVoices) add({ step: s0, track: "pad", midi: m, dur: G * 0.98, vel: v }, "pad");
    }

    if (style === "pop") {
      // the "keys" part is an arpeggio over the voiced chord, masked by a Euclidean pattern
      if (e < 0.4) continue;
      const tones = [...keyVoices].sort((x, y) => x - y);
      let k = 0;
      arpMask.forEach((on, st) => {
        if (!on) return;
        const m = tones[k % tones.length] + (Math.floor(k / tones.length) % 2) * 12;
        add({ step: s0 + st, track: "keys", midi: m, dur: 1.5, vel: 0.5 + (st % 4 === 0 ? 0.2 : 0) + rng() * 0.08 }, "keys");
        k++;
      });
      continue;
    }
    if (sec.kind === "outro" && b === sec.startBar + sec.bars - 1) {
      [...keyVoices].sort((x, y) => x - y).forEach((m, j) => add({ step: s0, track: "keys", midi: m, dur: G * 1.5, vel: 0.5, offset: j * 0.03 }, "keys"));
      continue;
    }
    const hits = (sec.startBar + b) % 2 === 1 ? compB : comp;
    const sparse = e < 0.45 && style !== "afro";
    hits.forEach((st, i) => {
      if (sparse && i > 1) return;
      const nextHit = hits[i + 1] ?? G;
      const dur = Math.max(1, Math.min(nextHit - st, style === "lofi" ? 6 : 3)) * 0.92;
      const vel = (i === 0 ? 0.62 : 0.45) + rng() * 0.1;
      if (style === "afro") {
        // marimba: broken chord, one or two notes per hit
        const ts = [...keyVoices].sort((x, y) => x - y);
        add({ step: s0 + st, track: "keys", midi: ts[(i * 2) % ts.length], dur: 1, vel }, "keys");
        if (i % 2 === 0) add({ step: s0 + st, track: "keys", midi: ts[(i * 2 + 1) % ts.length], dur: 1, vel: vel * 0.8 }, "keys");
      } else {
        // a soft strum: each note a few ms later than the one below
        [...keyVoices].sort((x, y) => x - y).forEach((m, j) => {
          add({ step: s0 + st, track: "keys", midi: m, dur, vel: vel * (0.9 + 0.05 * j), offset: j * 0.011 }, "keys");
        });
      }
    });
  }

  // ---- melody: motifs that repeat and vary ----
  const center = 4 + Math.floor(rng() * 3); // in scale degrees above the lead's low tonic
  const strong = (st: number): boolean => st % (G / 2) === 0;
  const chordDegsAt = (barAbs: number): number[] => {
    const c = chords[barAbs];
    return c.pcs.slice(0, 3).map((pc) => sc.findIndex((x) => mod12(tonic + x) === pc)).filter((d) => d >= 0);
  };
  const nearestChordTone = (d: number, barAbs: number): number => {
    const tones = chordDegsAt(barAbs);
    let best = d;
    let bd = 99;
    for (let x = d - 3; x <= d + 3; x++) {
      if (tones.includes(((x % 7) + 7) % 7) && Math.abs(x - d) < bd) {
        bd = Math.abs(x - d);
        best = x;
      }
    }
    return best;
  };
  const rhythm = (density: number): number[] => {
    // two bars: a syncopated first bar, a shorter answer, a breath at the end
    const eighths = G === 12 ? 6 : 8;
    const unit = G / eighths;
    const k1 = Math.max(3, Math.min(eighths - 1, Math.round(3 + density * 3)));
    const bar1 = rotate(bjorklund(k1, eighths), Math.floor(rng() * 3)).map((x, i) => (x ? i * unit : -1)).filter((x) => x >= 0);
    const k2 = Math.max(2, k1 - 2);
    const bar2 = rotate(bjorklund(k2, Math.round(eighths * 0.75)), Math.floor(rng() * 2))
      .map((x, i) => (x ? G + i * unit : -1))
      .filter((x) => x >= 0);
    const all = [...bar1, ...bar2];
    if (rng() < 0.4 && all[0] === 0) all[0] = unit / 2 > 0 ? Math.round(unit / 2) : 0; // a pushed first note
    return [...new Set(all)].sort((a, b) => a - b);
  };
  const contour = (at: number[], startBar: number, ctr: number, endOnTonic: boolean): MelNote[] => {
    const out: MelNote[] = [];
    let d = nearestChordTone(ctr, startBar);
    let lastLeap = 0;
    at.forEach((st, i) => {
      const barAbs = startBar + Math.floor(st / G);
      if (i > 0) {
        let mv: number;
        if (lastLeap !== 0 && rng() < 0.75) mv = -Math.sign(lastLeap); // fill the gap
        else mv = weighted(rng, [
          [0, 0.12],
          [1, 0.31],
          [-1, 0.31],
          [2, 0.08],
          [-2, 0.08],
          [3, 0.05],
          [-3, 0.05],
        ]);
        lastLeap = Math.abs(mv) >= 2 ? mv : 0;
        d += mv;
        if (d > ctr + 4) d -= 2;
        if (d < ctr - 5) d += 2;
      }
      if (strong(st % G) && rng() < 0.85) d = nearestChordTone(d, barAbs);
      const isLast = i === at.length - 1;
      if (isLast) {
        d = endOnTonic ? Math.round(d / 7) * 7 : nearestChordTone(d, barAbs);
      }
      const nxt = at[i + 1] ?? 2 * G;
      const dur = isLast ? Math.max(2, Math.min(G * 2 - st - 1, G * 0.75)) : Math.max(1, (nxt - st) * 0.9);
      out.push({ at: st, dur, deg: d, vel: (strong(st % G) ? 0.72 : 0.58) + rng() * 0.1 });
    });
    return out;
  };
  // re-fit a motif onto new chords: same rhythm and shape, strong beats moved to chord tones
  const vary = (m: MelNote[], startBar: number, endOnTonic: boolean, change: number): MelNote[] =>
    m.map((n, i) => {
      let d = n.deg;
      const barAbs = startBar + Math.floor(n.at / G);
      if (strong(n.at % G)) d = nearestChordTone(d, barAbs);
      if (i >= m.length - change) d += pick(rng, [-1, 1, 2, -2]);
      if (i === m.length - 1) d = endOnTonic ? Math.round(d / 7) * 7 : nearestChordTone(d, barAbs);
      return { ...n, deg: d };
    });
  const leadBase = mod12(tonic) + 48 + (tonic > 7 ? -12 : 0) + 12; // low tonic of the lead register
  const degMidi = (d: number): number => leadBase + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);

  const phraseCache = new Map<string, MelNote[][]>();
  for (const sec of sections) {
    if (sec.kind !== "verse" && sec.kind !== "chorus") continue;
    const key = sec.kind;
    let phrases = phraseCache.get(key);
    const ctr = center + (sec.kind === "chorus" ? 2 : 0);
    if (!phrases) {
      const dens = sec.kind === "chorus" ? 0.75 : 0.5;
      const a = contour(rhythm(dens), sec.startBar, ctr, false);
      const b = contour(rhythm(dens + 0.1), sec.startBar + 4, ctr + 1, false);
      phrases = [a, vary(a, sec.startBar + 2, false, 2), b, vary(a, sec.startBar + 6, true, 1)];
      phraseCache.set(key, phrases);
    } else {
      // a repeat of the section: the same tune, re-fitted and slightly varied
      phrases = phrases.map((p, i) => vary(p, sec.startBar + i * 2, i === 3, rng() < 0.5 ? 1 : 0));
    }
    phrases.forEach((p, i) => {
      for (const n of p) {
        const step = (sec.startBar + i * 2) * G + n.at;
        add({ step, track: "lead", midi: degMidi(n.deg), dur: n.dur, vel: n.vel * (0.85 + sec.energy * 0.2) }, "lead");
      }
    });
  }

  events.sort((a, b) => a.step - b.step);
  const byStep = new Map<number, NoteEvent[]>();
  for (const ev of events) {
    const k = Math.floor(ev.step);
    let arr = byStep.get(k);
    if (!arr) byStep.set(k, (arr = []));
    arr.push(ev);
  }

  return {
    seed,
    style,
    styleLabel: S.label,
    tonic,
    mode,
    bpm,
    swing,
    grid: G,
    stepsPerBeat: S.stepsPerBeat,
    sections,
    chords,
    events,
    byStep,
    totalSteps: totalBars * G,
    drumRings: rings,
  };
}

// ---- the band: instruments, mixing, scheduling --------------------------------------------

export interface Played {
  ev: NoteEvent;
  time: number; // AudioContext time it sounds
  end: number;
}

export class Band {
  song: Song;
  humanize: Humanize = "pink";
  readonly muted = new Set<TrackName>();
  played: Played[] = [];
  onSong: ((s: Song) => void) | null = null;
  private clock: Clock;
  private songStartStep = 0;
  private built = false;
  private kit: Kit | null = null;
  private inst: Partial<Record<TrackName, Inst>> = {};
  private keysKind = "";
  private leadKind = "";
  private strips: Partial<Record<TrackName, Strip>> = {};
  private drumStrips: Partial<Record<DrumName, Strip>> = {};
  private duckGain: Tone.Gain | null = null;
  private padCut: Tone.Filter | null = null;
  private lockStyle: StyleName | undefined;
  private pendingStyle: StyleName | undefined;
  private pending: Song | null = null;

  constructor(seed = Math.floor(Math.random() * 1e9), style?: StyleName) {
    this.lockStyle = style;
    this.song = writeSong(seed, style);
    this.clock = new Clock(this.song.bpm, this.song.stepsPerBeat, (step, time, dur) => this.tick(step, time, dur));
  }

  get isRunning(): boolean {
    return this.clock.isRunning;
  }

  // position in the current song, in steps (fractional)
  position(): number {
    if (!this.clock.isRunning) return 0;
    return Math.max(0, this.clock.position() - this.songStartStep);
  }

  section(pos = this.position()): Section {
    const bar = Math.floor(pos / this.song.grid);
    return this.song.sections.find((s) => bar >= s.startBar && bar < s.startBar + s.bars) ?? this.song.sections[0];
  }

  async start(): Promise<void> {
    await startAudio();
    this.build();
    this.applySongSound();
    this.songStartStep = 0;
    this.clock.bpm = this.song.bpm;
    this.clock.stepsPerBeat = this.song.stepsPerBeat;
    this.clock.start(0);
  }

  stop(): void {
    this.clock.stop();
    for (const i of Object.values(this.inst)) i?.release();
    this.played = [];
  }

  newSong(seed = Math.floor(Math.random() * 1e9), style?: StyleName): void {
    if (style) this.lockStyle = style;
    const next = writeSong(seed, style ?? this.lockStyle);
    if (this.clock.isRunning) {
      // switch on the next step, without stopping the clock
      this.pending = next;
    } else {
      this.song = next;
      this.onSong?.(this.song);
    }
  }

  setStyleLock(style: StyleName | undefined): void {
    this.lockStyle = style;
    this.pendingStyle = style;
  }

  setMute(t: TrackName, on: boolean): void {
    if (on) this.muted.add(t);
    else this.muted.delete(t);
    this.strips[t]?.mute(on);
    if (t === "drums") for (const s of Object.values(this.drumStrips)) s?.mute(on);
  }

  setTempo(bpm: number): void {
    this.song.bpm = bpm;
    this.clock.bpm = bpm;
    if (this.built) setDelayTempo(bpm);
  }

  // ---- internals ----
  private build(): void {
    if (this.built) return;
    this.built = true;
    // a duck bus: the kick pushes the pad and keys down for a moment
    this.duckGain = new Tone.Gain(1);
    const duckOut = this.duckGain;
    this.strips = {
      bass: strip({ db: -4 }),
      keys: strip({ db: -7, reverb: 0.22, pan: -0.15, dest: duckOut }),
      pad: strip({ db: -11, reverb: 0.4, dest: duckOut }),
      lead: strip({ db: -6, reverb: 0.24, delay: 0.2, pan: 0.12 }),
    };
    duckOut.connect(strip({ db: 0 }).input);
    const d = (db: number, pan = 0, reverb = 0): Strip => strip({ db, pan, reverb });
    this.drumStrips = {
      kick: d(-2),
      snare: d(-6, 0.04, 0.14),
      clap: d(-7, -0.04, 0.16),
      hat: d(-12, 0.28),
      openhat: d(-13, 0.28, 0.08),
      shaker: d(-13, -0.32, 0.05),
      rim: d(-10, -0.18, 0.1),
      bell: d(-11, 0.3, 0.08),
      conga: d(-8, -0.22, 0.1),
      crash: d(-15, 0.18, 0.1),
    };
    const dests: Partial<Record<DrumName, Tone.InputNode>> = {};
    for (const [k, s] of Object.entries(this.drumStrips)) dests[k as DrumName] = s!.input;
    this.kit = drumKit(dests, this.drumStrips.kick!.input);
    this.inst.bass = makeBass(this.strips.bass!.input, -10);
    const p = makePad(this.strips.pad!.input, -20, 1200);
    this.padCut = p.filter;
    this.inst.pad = p;
    for (const t of TRACKS) if (this.muted.has(t)) this.setMute(t, true);
  }

  // swap the keys and lead instruments to suit the song's style
  private applySongSound(): void {
    const S = STYLES[this.song.style];
    if (this.keysKind !== S.keys) {
      this.inst.keys?.dispose();
      this.inst.keys = S.keys === "epiano" ? epiano(this.strips.keys!.input, -9) : makeLead(S.keys, this.strips.keys!.input, S.keys === "pluck" ? -14 : -12);
      this.keysKind = S.keys;
    }
    if (this.leadKind !== S.lead) {
      this.inst.lead?.dispose();
      this.inst.lead = makeLead(S.lead, this.strips.lead!.input, -12);
      this.leadKind = S.lead;
    }
    this.padCut?.frequency.rampTo(S.padCutoff, 0.5);
    setDelayTempo(this.song.bpm);
  }

  private tick(clockStep: number, time: number, dur: number): void {
    let step = clockStep - this.songStartStep;
    if (step >= this.song.totalSteps || this.pending) {
      // the song is over (or a new one was asked for): write the next and keep going
      const fresh = this.pending ?? writeSong(Math.floor(Math.random() * 1e9), this.pendingStyle ?? this.lockStyle);
      this.pending = null;
      for (const i of Object.values(this.inst)) i?.release();
      this.song = fresh;
      this.applySongSound();
      this.clock.bpm = this.song.bpm;
      this.clock.stepsPerBeat = this.song.stepsPerBeat;
      this.songStartStep = clockStep;
      step = 0;
      this.played = [];
      this.onSong?.(this.song);
    }
    const evs = this.song.byStep.get(step);
    if (!evs) return;
    const swingOff = this.song.stepsPerBeat === 4 && step % 2 === 1 ? (2 * this.song.swing - 1) * dur : 0;
    const floor = audioTime() + 0.005;
    for (const ev of evs) {
      if (this.muted.has(ev.track)) continue;
      const human = this.humanize === "off" ? 0 : ev.lean + (this.humanize === "pink" ? ev.jp : ev.jw);
      const t = Math.max(floor, time + swingOff + human + (ev.offset ?? 0));
      const vel = ev.vel;
      if (ev.track === "drums") {
        this.kit?.hit(ev.drum!, t, vel, ev.pitch);
        if (ev.drum === "kick") this.duck(t);
      } else {
        const len = ev.dur * dur;
        this.inst[ev.track]?.play(ev.midi, len, t, vel);
      }
      this.played.push({ ev, time: t, end: t + Math.max(ev.dur * dur, 0.08) });
    }
    // keep the visual log short
    if (this.played.length > 600) this.played.splice(0, this.played.length - 400);
  }

  private duck(t: number): void {
    const g = this.duckGain;
    if (!g) return;
    const depth = STYLES[this.song.style].duck;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(1 - depth, t);
    g.gain.linearRampToValueAtTime(1, t + 0.22);
  }
}

export function keyName(s: Song): string {
  return `${spell(s.tonic, keyUsesFlats(s.tonic, s.mode))} ${s.mode}`;
}

export function describeSong(s: Song): string {
  return `${s.styleLabel} · ${keyName(s)} · ${s.bpm} bpm${s.swing > 0.51 ? ` · swing ${Math.round(s.swing * 100)}%` : ""}`;
}
