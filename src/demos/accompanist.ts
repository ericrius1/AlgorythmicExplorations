// The accompanist: you play — QWERTY keys, Web MIDI, or the on-screen piano —
// and an algorithmic bandmate plays along. It infers the key from a decaying
// pitch-class histogram (Krumhansl–Kessler profile correlation), picks chords
// by weighing evidence against cadence pull, voices them with minimal motion,
// and adapts its busyness to yours: play sparse and it fills, play busy and
// it gets out of the way.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import {
  Tone, masterBus, unlockAudio, frameGuard, soundHint,
  midiToFreq, midiName, StepClock, NOTE_NAMES,
} from "../lib/audio";
import { Piano } from "../lib/piano";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10]; // natural minor — see the prose for the apology
const ROMAN_MAJ = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const ROMAN_MIN = ["i", "ii°", "III", "iv", "v", "VI", "VII"];

// Krumhansl & Kessler's probe-tone profiles (1982): how strongly listeners
// rate each pitch class as "belonging" after hearing a key-defining context.
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// A small prior over scale degrees: tonal music leans on I, IV, V. The
// diminished triad is technically diatonic and practically a hand grenade.
const DEGREE_PRIOR_MAJ = [0.04, 0.0, 0.0, 0.03, 0.035, 0.012, -0.03];
const DEGREE_PRIOR_MIN = [0.04, -0.03, 0.012, 0.03, 0.035, 0.012, 0.0];

// FL-Studio-style QWERTY note map: two interleaved rows, like a piano.
const KEYMAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16,
};

const STYLES = ["auto", "pad", "comping", "arpeggio"] as const;

function pearson(a: number[] | Float32Array, b: number[], rot: number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[(i + rot) % 12] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 1e-9 && db > 1e-9 ? num / Math.sqrt(da * db) : 0;
}

export async function mountAccompanist(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.52);
  const g2d = shell.canvas.getContext("2d");
  if (!g2d) return gpuMissing(container);
  soundHint(container, "click, then play your keyboard (A–K row)");

  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // ---- the ear: decaying pitch-class evidence ---------------------------------
  // Two memories, two half-lives. The slow one decides the key (a listener's
  // sense of key survives a whole phrase); the fast one decides the chord
  // (harmony lives in the last bar or so).
  const earSlow = new Float32Array(12);
  const earFast = new Float32Array(12);
  const noteTimes: number[] = []; // for notes-per-second

  let keyRoot = 0;
  let keyIsMinor = false;
  let keyKnown = false;
  let keyConf = 0;
  let pendKey = -1; // candidate key (root*2 + minor) waiting out the hysteresis
  let pendCount = 0;

  const scale = (): number[] => (keyIsMinor ? MINOR : MAJOR);

  const inferKey = (): void => {
    let total = 0;
    for (let i = 0; i < 12; i++) total += earSlow[i];
    if (total < 1.5) return; // a couple of notes before the band trusts its ears
    let best = -2;
    let bestKey = 0;
    for (let r = 0; r < 12; r++) {
      const cMaj = pearson(earSlow, KK_MAJ, r);
      const cMin = pearson(earSlow, KK_MIN, r);
      if (cMaj > best) {
        best = cMaj;
        bestKey = r * 2;
      }
      if (cMin > best) {
        best = cMin;
        bestKey = r * 2 + 1;
      }
    }
    const cur = keyRoot * 2 + (keyIsMinor ? 1 : 0);
    if (!keyKnown) {
      keyRoot = bestKey >> 1;
      keyIsMinor = (bestKey & 1) === 1;
      keyKnown = true;
      keyConf = best;
      return;
    }
    keyConf = pearson(earSlow, keyIsMinor ? KK_MIN : KK_MAJ, keyRoot);
    // Hysteresis: a new key must win clearly, two bars running. One borrowed
    // chord shouldn't make the bassist lunge for a new tonic.
    if (bestKey !== cur && best > keyConf + 0.03) {
      if (bestKey === pendKey) pendCount++;
      else {
        pendKey = bestKey;
        pendCount = 1;
      }
      if (pendCount >= 3) {
        keyRoot = bestKey >> 1;
        keyIsMinor = (bestKey & 1) === 1;
        keyConf = best;
        pendKey = -1;
        pendCount = 0;
      }
    } else {
      pendKey = -1;
      pendCount = 0;
    }
  };

  // ---- the hands: chord choice + voicing --------------------------------------
  let chordDeg = 0;
  let haveChord = false;
  const triadPcs = (deg: number): number[] => {
    const s = scale();
    return [s[deg % 7], s[(deg + 2) % 7], s[(deg + 4) % 7]].map((pc) => (pc + keyRoot) % 12);
  };
  const chordQuality = (deg: number): string => {
    const [r, t, f] = triadPcs(deg);
    const third = (t - r + 12) % 12;
    const fifth = (f - r + 12) % 12;
    return fifth === 6 ? "°" : third === 3 ? "m" : "";
  };
  const chordLabel = (deg: number): string => {
    const roman = (keyIsMinor ? ROMAN_MIN : ROMAN_MAJ)[deg];
    return `${roman} · ${NOTE_NAMES[triadPcs(deg)[0]]}${chordQuality(deg)}`;
  };

  const chooseChord = (): void => {
    if (!keyKnown) return;
    const ev = new Float32Array(12);
    let total = 0;
    for (let i = 0; i < 12; i++) {
      ev[i] = earFast[i];
      total += earFast[i];
    }
    for (const m of held.keys()) {
      ev[((m % 12) + 12) % 12] += 1.5; // what's under the fingers right now counts most
      total += 1.5;
    }
    if (total < 0.2) return; // player's gone quiet — keep vamping the last chord
    const prior = keyIsMinor ? DEGREE_PRIOR_MIN : DEGREE_PRIOR_MAJ;
    let best = -1;
    let bestDeg = chordDeg;
    for (let d = 0; d < 7; d++) {
      let s = 0;
      for (const pc of triadPcs(d)) s += ev[pc] / total;
      s += prior[d];
      if (haveChord && d === chordDeg) s += 0.06; // inertia: changing has to be worth it
      if (haveChord && d === (chordDeg + 3) % 7) s += 0.05; // root falls a fifth — the strongest move in tonal music
      if (s > best) {
        best = s;
        bestDeg = d;
      }
    }
    chordDeg = bestDeg;
    haveChord = true;
  };

  // Voice the triad near the previous voicing: try all three inversions in the
  // octave around middle C, keep the one whose fingers move least.
  let voicing: number[] = [];
  const voiceChord = (): number[] => {
    const pcs = triadPcs(chordDeg);
    let best: number[] | null = null;
    let bestCost = Infinity;
    for (let inv = 0; inv < 3; inv++) {
      let low = pcs[inv] + 48;
      while (low < 57) low += 12;
      const notes = [low];
      for (let k = 1; k < 3; k++) {
        let n = pcs[(inv + k) % 3] + 48;
        while (n <= notes[k - 1]) n += 12;
        notes.push(n);
      }
      let cost = 0;
      if (voicing.length === 3) for (let k = 0; k < 3; k++) cost += Math.abs(notes[k] - voicing[k]);
      else cost = Math.abs(notes[0] - 60); // first chord: just stay near middle C
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
    voicing = best!;
    return voicing;
  };

  // ---- the band ----------------------------------------------------------------
  const reverb = new Tone.Reverb({ decay: 2.6, wet: 0.25 }).connect(masterBus());
  const comp = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.04, decay: 0.3, sustain: 0.5, release: 0.5 },
    volume: -16,
  }).connect(reverb);
  const arpSyn = new Tone.Synth({
    oscillator: { type: "triangle8" },
    envelope: { attack: 0.01, decay: 0.18, sustain: 0.2, release: 0.25 },
    volume: -18,
  }).connect(reverb);
  const bassSyn = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.02, decay: 0.25, sustain: 0.55, release: 0.35 },
    volume: -9,
  }).connect(masterBus());
  const kickSyn = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, volume: -13 }).connect(masterBus());
  const hatFilter = new Tone.Filter(8500, "highpass").connect(masterBus());
  const hatSyn = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
    volume: -22,
  }).connect(hatFilter);
  // the player's own notes, so QWERTY and the on-screen piano make sound too
  const playerSyn = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.6, release: 0.3 },
    volume: -8,
  }).connect(masterBus());

  // Accompanist notes currently sounding, for the ribbon (audio-clock times).
  const botNotes: { midi: number; start: number; end: number }[] = [];
  const botPlay = (
    syn: { triggerAttackRelease(note: number, dur: number, time: number, vel?: number): unknown },
    midi: number,
    dur: number,
    time: number,
    vel = 0.8,
  ): void => {
    syn.triggerAttackRelease(midiToFreq(midi), dur, time, vel);
    botNotes.push({ midi, start: time, end: time + dur });
  };

  // ---- the taste: density adaptation --------------------------------------------
  let styleIdx = 0; // auto
  let groove = true;
  let barStyle: (typeof STYLES)[number] = "pad"; // resolved once per bar
  const playerNps = (): number => {
    const now = performance.now();
    while (noteTimes.length && noteTimes[0] < now - 3000) noteTimes.shift();
    return noteTimes.length / 3;
  };
  const resolveStyle = (): void => {
    if (STYLES[styleIdx] !== "auto") {
      barStyle = STYLES[styleIdx];
      return;
    }
    const nps = playerNps();
    // The whole trick of accompaniment in one line: density is a seesaw.
    barStyle = nps < 0.8 ? "arpeggio" : nps < 2.8 ? "comping" : "pad";
  };

  // ---- the clock ----------------------------------------------------------------
  const clock = new StepClock(90, 4, (step, time) => {
    const s16 = step % 16;
    const beat = 60 / clock.bpm;

    if (s16 === 0) resolveStyle();
    if ((s16 === 0 || s16 === 8) && keyKnown) chooseChord();
    if (!keyKnown || !haveChord) return; // band hasn't heard enough yet

    const v = s16 === 0 || s16 === 8 ? voiceChord() : voicing;
    const root = triadPcs(chordDeg)[0];
    const bassRoot = root + 36 + (root > 7 ? 0 : 12); // keep the bass in E1–B2 territory
    const fifth = bassRoot + 7;

    // drums: brushes, not a drum machine
    if (groove) {
      if (s16 === 0 || s16 === 8) kickSyn.triggerAttackRelease(45, 0.1, time);
      if (s16 % 2 === 0) hatSyn.triggerAttackRelease(0.03, time, s16 % 4 === 0 ? 0.8 : 0.35);
    }

    // bass: roots and fifths, like a bassist who's heard the song before
    if (s16 === 0) botPlay(bassSyn, bassRoot, beat * 1.6, time, 0.9);
    if (s16 === 8) botPlay(bassSyn, barStyle === "pad" ? bassRoot : fifth, beat * 1.2, time, 0.7);

    // harmony, in the style the seesaw picked
    if (barStyle === "pad") {
      if (s16 === 0) for (const n of v) botPlay(comp, n, beat * 3.8, time, 0.6);
    } else if (barStyle === "comping") {
      if (s16 === 4 || s16 === 12) for (const n of v) botPlay(comp, n, beat * 0.6, time, 0.7);
    } else {
      // arpeggio: fill the space the player is leaving
      if (s16 === 0) for (const n of v) botPlay(comp, n, beat * 3.8, time, 0.35);
      if (s16 % 2 === 0) {
        const seq = [0, 1, 2, 3, 2, 1];
        const idx = seq[(step >> 1) % 6];
        const n = idx < 3 ? v[idx] : v[0] + 12;
        botPlay(arpSyn, n, beat * 0.45, time, 0.55);
      }
    }
  });

  // ---- player input ---------------------------------------------------------------
  const held = new Map<number, number>(); // midi → 1 (a set, but Map matches Piano use)
  let lastFrameAt = performance.now();

  const noteOn = (m: number, vel = 0.8): void => {
    void unlockAudio().then(() => {
      if (!clock.isRunning) clock.start();
    });
    if (held.has(m)) return;
    held.set(m, 1);
    const pc = ((m % 12) + 12) % 12;
    earSlow[pc] += 1;
    earFast[pc] += 1;
    noteTimes.push(performance.now());
    playerSyn.triggerAttack(midiToFreq(m), undefined, vel);
  };
  const noteOff = (m: number): void => {
    if (!held.delete(m)) return;
    playerSyn.triggerRelease(midiToFreq(m));
  };

  // QWERTY: armed by the first click so the page doesn't eat keystrokes while
  // the reader is still scrolling. Dead keys when the demo is off screen.
  let armed = false;
  let octave = 60; // midi of the 'a' key
  const qwertyHeld = new Map<string, number>(); // key char → midi it triggered
  container.addEventListener("pointerdown", () => {
    armed = true;
  });
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!armed || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    // dead keys when the demo is off screen (frames stop; the watchdog's
    // fallback cadence can leave ~1s gaps, so the threshold is generous)
    if (performance.now() - lastFrameAt > 1500) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === "z" || k === "x") {
      octave = Math.max(36, Math.min(84, octave + (k === "z" ? -12 : 12)));
      e.preventDefault();
      return;
    }
    const off = KEYMAP[k];
    if (off === undefined || qwertyHeld.has(k)) return;
    e.preventDefault();
    const m = octave + off;
    qwertyHeld.set(k, m);
    noteOn(m);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    const m = qwertyHeld.get(e.key.toLowerCase());
    if (m === undefined) return;
    qwertyHeld.delete(e.key.toLowerCase());
    noteOff(m);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // Web MIDI: plug in and play, no setup
  let midiPortName: string | null = null;
  if (navigator.requestMIDIAccess) {
    navigator
      .requestMIDIAccess()
      .then((access) => {
        const wire = (): void => {
          midiPortName = null;
          for (const input of access.inputs.values()) {
            midiPortName = input.name ?? "midi in";
            input.onmidimessage = (e: MIDIMessageEvent): void => {
              const data = e.data;
              if (!data || data.length < 3) return;
              const [st, note, vel] = data;
              if ((st & 0xf0) === 0x90 && vel > 0) noteOn(note, vel / 127);
              else if ((st & 0xf0) === 0x80 || ((st & 0xf0) === 0x90 && vel === 0)) noteOff(note);
            };
          }
        };
        wire();
        access.onstatechange = wire;
      })
      .catch(() => {});
  }

  // On-screen piano, with the QWERTY keycaps printed on the keys
  const piano = new Piano({
    low: 48,
    high: 84,
    onPress: (m) => {
      armed = true;
      noteOn(m);
      window.setTimeout(() => noteOff(m), 380);
    },
  });
  const capNames = Object.entries(KEYMAP);
  let capOctave = -1;
  const syncCaps = (): void => {
    if (capOctave === octave) return;
    capOctave = octave;
    const caps = new Map<number, string>();
    for (const [k, off] of capNames) caps.set(octave + off, k === ";" ? ";" : k.toUpperCase());
    piano.setLabels(caps);
  };
  syncCaps();
  shell.controls.before(piano.el);

  // ---- controls -----------------------------------------------------------------
  let styleBtn: HTMLButtonElement;
  shell.button(`style: ${STYLES[styleIdx]}`, () => {
    styleIdx = (styleIdx + 1) % STYLES.length;
    styleBtn.textContent = `style: ${STYLES[styleIdx]}`;
  });
  styleBtn = shell.controls.lastElementChild as HTMLButtonElement;
  let grooveBtn: HTMLButtonElement;
  shell.button("groove: on", () => {
    groove = !groove;
    grooveBtn.textContent = `groove: ${groove ? "on" : "off"}`;
  });
  grooveBtn = shell.controls.lastElementChild as HTMLButtonElement;
  shell.button("🧹 reset ear", () => {
    earSlow.fill(0);
    earFast.fill(0);
    keyKnown = false;
    haveChord = false;
    keyConf = 0;
    voicing = [];
  });
  shell.slider({
    label: "tempo",
    min: 60,
    max: 140,
    step: 1,
    value: clock.bpm,
    format: (v) => `${Math.round(v)} bpm`,
    onInput: (v) => (clock.bpm = v),
  });

  const silence = (): void => {
    clock.stop();
    comp.releaseAll();
    playerSyn.releaseAll();
    botNotes.length = 0;
  };
  const guard = frameGuard(silence);

  shell.setInfo(() => {
    const midi = midiPortName ? ` · MIDI: ${midiPortName}` : "";
    const key = keyKnown
      ? `${NOTE_NAMES[keyRoot]} ${keyIsMinor ? "minor" : "major"} (${Math.round(keyConf * 100)}%)`
      : "listening…";
    const auto = STYLES[styleIdx] === "auto" ? ` · playing ${barStyle}` : "";
    return `${key}${auto}${midi} · ${playerNps().toFixed(1)} notes/s · Z/X octave`;
  });

  // ---- the ribbon ------------------------------------------------------------------
  const HIST = 420;
  const histPlayer: number[][] = Array.from({ length: HIST }, () => []);
  const histBot: number[][] = Array.from({ length: HIST }, () => []);
  const histMark: (string | null)[] = new Array(HIST).fill(null);
  let head = 0;
  let lastMark = "";
  let lastDecay = performance.now();
  let lastKeyCheck = 0;

  const LO = 28; // E1, room for the bass
  const HI = 88; // E6
  const yOf = (m: number): number => H - ((m - LO) / (HI - LO)) * (H - 20 * dpr) - 10 * dpr;

  return {
    frame() {
      shell.tick();
      guard.pulse();
      lastFrameAt = performance.now();

      // memories fade — that's what makes them memories
      const dt = (lastFrameAt - lastDecay) / 1000;
      lastDecay = lastFrameAt;
      const fs = Math.pow(2, -dt / 5);
      const ff = Math.pow(2, -dt / 1.2);
      for (let i = 0; i < 12; i++) {
        earSlow[i] *= fs;
        earFast[i] *= ff;
      }
      // the key sense runs on the frame loop (throttled), not the clock — the
      // readout should react to your first notes even before the band starts
      if (lastFrameAt - lastKeyCheck > 500) {
        lastKeyCheck = lastFrameAt;
        inferKey();
      }
      syncCaps();

      // record this frame's notes
      const now = Tone.now();
      for (let i = botNotes.length - 1; i >= 0; i--) {
        if (botNotes[i].end < now - 0.1) botNotes.splice(i, 1);
      }
      histPlayer[head] = [...held.keys()];
      histBot[head] = botNotes.filter((n) => n.start <= now && now < n.end).map((n) => n.midi);
      const mark = keyKnown && haveChord ? chordLabel(chordDeg) : "";
      histMark[head] = mark !== lastMark && mark ? mark : null;
      lastMark = mark || lastMark;
      head = (head + 1) % HIST;

      piano.setHeld([...histBot[(head + HIST - 1) % HIST]], [...held.keys()][0] ?? -1);

      // ---- draw ---------------------------------------------------------------
      g2d.fillStyle = "#0a0b10";
      g2d.fillRect(0, 0, W, H);

      // gridlines: the inferred key's scale, tonic labeled
      if (keyKnown) {
        const s = scale();
        for (let m = LO; m <= HI; m++) {
          const pc = (((m - keyRoot) % 12) + 12) % 12;
          if (!s.includes(pc)) continue;
          const y = yOf(m);
          g2d.fillStyle = pc === 0 ? "rgba(140,150,255,0.30)" : "rgba(120,130,180,0.10)";
          g2d.fillRect(0, y, W, 1);
          if (pc === 0) {
            g2d.fillStyle = "rgba(140,150,255,0.5)";
            g2d.font = `${11 * dpr}px ui-monospace, monospace`;
            g2d.fillText(midiName(m), 6 * dpr, y - 3 * dpr);
          }
        }
      }

      // traces, oldest → newest: you in white, the band in amber
      const colW = W / HIST;
      for (let i = 0; i < HIST; i++) {
        const idx = (head + i) % HIST;
        const x = i * colW;
        const fade = 0.25 + 0.75 * (i / HIST);
        for (const v of histBot[idx]) {
          g2d.fillStyle = `rgba(255,170,80,${0.55 * fade})`;
          g2d.fillRect(x, yOf(v) - 1.5 * dpr, Math.max(colW, 1), 3 * dpr);
        }
        for (const m of histPlayer[idx]) {
          g2d.fillStyle = `rgba(235,245,255,${0.9 * fade})`;
          g2d.fillRect(x, yOf(m) - 1.5 * dpr, Math.max(colW, 1), 3 * dpr);
        }
        if (histMark[idx]) {
          g2d.fillStyle = `rgba(255,170,80,${0.5 * fade})`;
          g2d.fillRect(x, 0, 1, H);
          g2d.font = `${10 * dpr}px ui-monospace, monospace`;
          g2d.fillText(histMark[idx]!, x + 3 * dpr, H - 6 * dpr);
        }
      }

      // beat dots
      if (clock.isRunning) {
        const beat = Math.floor(clock.phase(16) * 4);
        for (let b = 0; b < 4; b++) {
          g2d.fillStyle = b === beat ? "rgba(255,170,80,0.95)" : "rgba(120,130,180,0.3)";
          g2d.beginPath();
          g2d.arc((10 + b * 14) * dpr, 12 * dpr, 4 * dpr, 0, Math.PI * 2);
          g2d.fill();
        }
      }

      // big current-chord label
      if (keyKnown && haveChord) {
        g2d.fillStyle = "rgba(255,170,80,0.95)";
        g2d.font = `600 ${22 * dpr}px ui-monospace, monospace`;
        const label = chordLabel(chordDeg);
        g2d.fillText(label, W - g2d.measureText(label).width - 14 * dpr, 30 * dpr);
      } else {
        g2d.fillStyle = "rgba(120,130,180,0.6)";
        g2d.font = `${14 * dpr}px ui-monospace, monospace`;
        const label = armed ? "play a few notes…" : "click to arm the keys";
        g2d.fillText(label, W - g2d.measureText(label).width - 14 * dpr, 26 * dpr);
      }
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      silence();
      comp.dispose();
      arpSyn.dispose();
      bassSyn.dispose();
      kickSyn.dispose();
      hatSyn.dispose();
      hatFilter.dispose();
      playerSyn.dispose();
      reverb.dispose();
    },
  };
}
