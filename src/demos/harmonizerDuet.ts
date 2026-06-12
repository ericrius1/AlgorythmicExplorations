// The harmonizer: listen (microphone, MPM pitch detection) or play (Web MIDI
// or the on-screen piano), and diatonic harmony voices follow in real time.
// The melody's exact pitch — bends, vibrato, cents and all — carries through
// to the harmony as a frequency ratio, the way a pedal harmonizer does it.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import {
  Tone, masterBus, unlockAudio, frameGuard, soundHint,
  midiToFreq, midiName, freqLabel, NOTE_NAMES,
} from "../lib/audio";
import { PitchTracker } from "../lib/pitch";
import { Piano } from "../lib/piano";

const SCALE = [0, 2, 4, 5, 7, 9, 11]; // major
const MODES = ["third above", "third below", "both thirds"] as const;

// Snap a midi note into the key, return [snapped, ...harmony notes].
function harmonize(m: number, root: number, mode: number): { snapped: number; voices: number[] } {
  const rel = (((m - root) % 12) + 12) % 12;
  let deg = 0;
  let best = 99;
  for (let i = 0; i < 7; i++) {
    const d = Math.min(Math.abs(SCALE[i] - rel), 12 - Math.abs(SCALE[i] - rel));
    if (d < best) {
      best = d;
      deg = i;
    }
  }
  let base = m - rel;
  let snapped = base + SCALE[deg];
  if (snapped - m > 6) snapped -= 12;
  if (m - snapped > 6) snapped += 12;
  base = snapped - SCALE[deg];
  const at = (d: number): number => {
    const oct = Math.floor(d / 7);
    const idx = ((d % 7) + 7) % 7;
    return base + SCALE[idx] + oct * 12;
  };
  const voices = mode === 0 ? [at(deg + 2)] : mode === 1 ? [at(deg - 2)] : [at(deg + 2), at(deg - 2)];
  return { snapped, voices };
}

export async function mountHarmonizer(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.52);
  const g2d = shell.canvas.getContext("2d");
  if (!g2d) return gpuMissing(container);
  soundHint(container, "tap, then 🎤 listen or play the keys");

  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // ---- state ----------------------------------------------------------------
  let root = 0; // C
  let mode = 0; // third above
  let listening = false;
  let midiPortName: string | null = null;
  const tracker = new PitchTracker();

  // pitch ribbon history: one entry per frame
  const HIST = 420;
  const histMelody = new Float32Array(HIST).fill(-1); // float midi, -1 = silence
  const histVoices: number[][] = Array.from({ length: HIST }, () => []);
  let head = 0;

  // ---- voices ----------------------------------------------------------------
  const bus = new Tone.Gain(0.9);
  bus.connect(masterBus());
  const mkVoice = (): Tone.Synth =>
    new Tone.Synth({
      oscillator: { type: "triangle8" },
      envelope: { attack: 0.03, decay: 0.1, sustain: 0.75, release: 0.25 },
      portamento: 0.03,
      volume: -10,
    }).connect(bus);
  const harmonyVoices = [mkVoice(), mkVoice()];
  // keyboard path: polyphonic, one synth for played notes, one for harmonies
  const keyMelody = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.6, release: 0.3 },
    volume: -8,
  }).connect(bus);
  const keyHarmony = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.04, decay: 0.15, sustain: 0.6, release: 0.3 },
    volume: -12,
  }).connect(bus);

  let sungVoices: number[] = []; // currently sounding harmony (mic path)
  let sungSnapped = -1;
  let stableCand = -1;
  let stableCount = 0;
  let silentCount = 0;

  const releaseSung = (): void => {
    if (sungVoices.length) for (const v of harmonyVoices) v.triggerRelease();
    sungVoices = [];
    sungSnapped = -1;
  };

  const guard = frameGuard(() => {
    releaseSung();
    keyMelody.releaseAll();
    keyHarmony.releaseAll();
  });

  // ---- mic path ---------------------------------------------------------------
  const micFrame = (): { freq: number; clarity: number } => {
    const f = tracker.analyze();
    const good = f.freq > 60 && f.freq < 2200 && f.clarity > 0.9 && f.rms > 0.008;
    if (good) {
      silentCount = 0;
      const midiF = 69 + 12 * Math.log2(f.freq / 440);
      const cand = Math.round(midiF);
      if (cand === stableCand) stableCount++;
      else {
        stableCand = cand;
        stableCount = 0;
      }
      if (stableCount >= 2 && cand !== sungSnapped) {
        const h = harmonize(cand, root, mode);
        sungSnapped = h.snapped;
        const ratioBase = midiToFreq(h.snapped);
        h.voices.forEach((v, i) => {
          const fv = (midiToFreq(v) / ratioBase) * f.freq;
          if (i < sungVoices.length) harmonyVoices[i].setNote(fv);
          else harmonyVoices[i].triggerAttack(fv);
        });
        for (let i = h.voices.length; i < sungVoices.length; i++) harmonyVoices[i].triggerRelease();
        sungVoices = h.voices;
      } else if (sungVoices.length) {
        // same note — let the harmony ride the bend
        const ratioBase = midiToFreq(sungSnapped);
        sungVoices.forEach((v, i) => harmonyVoices[i].setNote((midiToFreq(v) / ratioBase) * f.freq));
      }
      return { freq: f.freq, clarity: f.clarity };
    }
    silentCount++;
    if (silentCount > 14) releaseSung();
    return { freq: 0, clarity: f.clarity };
  };

  // ---- keyboard + MIDI path ------------------------------------------------------
  const held = new Map<number, number[]>(); // played note → harmony notes
  const noteOn = (m: number, vel = 0.8): void => {
    void unlockAudio();
    const h = harmonize(m, root, mode);
    held.set(m, h.voices);
    keyMelody.triggerAttack(midiToFreq(m), undefined, vel);
    for (const v of h.voices) keyHarmony.triggerAttack(midiToFreq(v), undefined, vel * 0.8);
  };
  const noteOff = (m: number): void => {
    keyMelody.triggerRelease(midiToFreq(m));
    for (const v of held.get(m) ?? []) keyHarmony.triggerRelease(midiToFreq(v));
    held.delete(m);
  };

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

  // ---- piano (works with no mic and no MIDI) -----------------------------------
  const piano = new Piano({
    low: 48,
    high: 84,
    onPress: (m) => {
      noteOn(m);
      window.setTimeout(() => noteOff(m), 450);
    },
  });
  shell.controls.before(piano.el);

  // ---- controls -------------------------------------------------------------------
  shell.button("🎤 listen", () => {
    void unlockAudio().then(async () => {
      if (listening) {
        tracker.stop();
        listening = false;
        releaseSung();
      } else {
        try {
          await tracker.start();
          listening = true;
        } catch {
          midiPortName = midiPortName ?? null; // mic refused; piano still works
        }
      }
      const b = shell.controls.querySelectorAll("button")[0];
      if (b) b.textContent = listening ? "🔴 stop listening" : "🎤 listen";
    });
  });
  shell.button(`key: ${NOTE_NAMES[root]} major`, function (this: void) {
    root = (root + 7) % 12; // walk the circle of fifths, naturally
  });
  const keyBtn = shell.controls.querySelectorAll("button")[1];
  keyBtn?.addEventListener("click", () => (keyBtn.textContent = `key: ${NOTE_NAMES[root]} major`));
  shell.button(`harmony: ${MODES[mode]}`, function (this: void) {
    mode = (mode + 1) % MODES.length;
  });
  const modeBtn = shell.controls.querySelectorAll("button")[2];
  modeBtn?.addEventListener("click", () => (modeBtn.textContent = `harmony: ${MODES[mode]}`));

  let lastLabel = "—";
  shell.setInfo(() => {
    const midi = midiPortName ? ` · MIDI: ${midiPortName}` : "";
    return `${lastLabel}${midi} · key of ${NOTE_NAMES[root]}`;
  });

  // ---- pitch ribbon -----------------------------------------------------------------
  const LO = 40; // E2
  const HI = 88; // E6
  const yOf = (m: number): number => H - ((m - LO) / (HI - LO)) * H;

  return {
    frame() {
      shell.tick();
      guard.pulse();

      // advance history
      let freq = 0;
      let clarity = 0;
      if (listening) ({ freq, clarity } = micFrame());
      const midiF = freq > 0 ? 69 + 12 * Math.log2(freq / 440) : -1;
      histMelody[head] = midiF;
      histVoices[head] = listening && freq > 0 && sungVoices.length
        ? [...sungVoices]
        : [...held.values()].flat();
      head = (head + 1) % HIST;
      lastLabel = freq > 0 ? `${freqLabel(freq)} · clarity ${clarity.toFixed(2)}` : listening ? "listening…" : "—";

      // light the piano
      const melodyKey = listening && sungSnapped > 0 ? sungSnapped : -1;
      const harmKeys = listening ? sungVoices : [...held.values()].flat();
      const playedKeys = listening ? [] : [...held.keys()];
      piano.setHeld([...harmKeys, ...playedKeys], melodyKey >= 0 ? melodyKey : playedKeys[0] ?? -1);

      // ---- draw -------------------------------------------------------------
      g2d.fillStyle = "#0a0b10";
      g2d.fillRect(0, 0, W, H);

      // scale gridlines: in-key notes faint, roots brighter
      for (let m = LO; m <= HI; m++) {
        const pc = (((m - root) % 12) + 12) % 12;
        if (!SCALE.includes(pc)) continue;
        const y = yOf(m);
        g2d.fillStyle = pc === 0 ? "rgba(140,150,255,0.30)" : "rgba(120,130,180,0.10)";
        g2d.fillRect(0, y, W, 1);
        if (pc === 0) {
          g2d.fillStyle = "rgba(140,150,255,0.5)";
          g2d.font = `${11 * dpr}px ui-monospace, monospace`;
          g2d.fillText(midiName(m), 6 * dpr, y - 3 * dpr);
        }
      }

      // traces, oldest → newest
      const colW = W / HIST;
      for (let i = 0; i < HIST; i++) {
        const idx = (head + i) % HIST;
        const x = i * colW;
        const fade = 0.25 + 0.75 * (i / HIST);
        for (const v of histVoices[idx]) {
          g2d.fillStyle = `rgba(255,170,80,${0.55 * fade})`;
          g2d.fillRect(x, yOf(v) - 1.5 * dpr, Math.max(colW, 1), 3 * dpr);
        }
        const m = histMelody[idx];
        if (m > 0) {
          g2d.fillStyle = `rgba(235,245,255,${0.9 * fade})`;
          g2d.fillRect(x, yOf(m) - 1.5 * dpr, Math.max(colW, 1), 3 * dpr);
        }
      }

      // big current-note label
      if (freq > 0) {
        g2d.fillStyle = "rgba(235,245,255,0.95)";
        g2d.font = `600 ${26 * dpr}px ui-monospace, monospace`;
        g2d.fillText(freqLabel(freq), W - 150 * dpr, 34 * dpr);
      }
    },
    dispose() {
      tracker.stop();
      releaseSung();
      keyMelody.dispose();
      keyHarmony.dispose();
      for (const v of harmonyVoices) v.dispose();
      bus.dispose();
    },
  };
}
