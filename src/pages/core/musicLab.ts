// Unlisted test bench for src/lib/music/. Each section mounts independently so
// one failing part doesn't take down the rest. `window.__musicLab` exposes the
// offline checks for automated runs.

import { initNav } from "../../lib/siteNav";
import { Tone, masterBus, unlockAudio, midiToFreq } from "../../lib/audio";
import { Piano } from "../../lib/piano";
import { mountLabViews } from "./musicLabViews";
import { buildMasterChain, masterChain, limiterReduction, CEILING_DB } from "../../lib/music/master";
import { mountSoundControl } from "../../lib/music/soundControl";
import { createInstrument, PRESETS, type Instrument, type PresetName } from "../../lib/music/instruments";
import { PianoKeyboard } from "../../lib/music/keyboard";
import { NoteInput, midiButton } from "../../lib/music/input";
import { SCALES, noteName, parseNote, chordNotes, diatonicChord } from "../../lib/music/theory";
import { stopAll } from "../../lib/music/lifecycle";

initNav();
mountSoundControl();

function controlsRow(parent: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "demo-controls";
  parent.appendChild(row);
  return row;
}

function button(row: HTMLElement, label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "demo-button";
  b.textContent = label;
  b.addEventListener("click", fn);
  row.appendChild(b);
  return b;
}

function select(row: HTMLElement, label: string, options: string[], onChange: (v: string) => void): HTMLSelectElement {
  const wrap = document.createElement("label");
  wrap.className = "demo-slider";
  wrap.style.minWidth = "auto";
  const name = document.createElement("span");
  name.textContent = label;
  const s = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    s.appendChild(opt);
  }
  s.addEventListener("change", () => onChange(s.value));
  wrap.append(name, s);
  row.appendChild(wrap);
  return s;
}

// ---- instruments -----------------------------------------------------------------------

function mountInstruments(el: HTMLElement): void {
  const insts = new Map<PresetName, Instrument>();
  const get = (p: PresetName): Instrument => {
    let i = insts.get(p);
    if (!i) {
      i = createInstrument(p);
      insts.set(p, i);
    }
    return i;
  };
  let preset: PresetName = "epiano";
  let current = get(preset);

  const presetRow = controlsRow(el);
  const presetBtns = new Map<PresetName, HTMLButtonElement>();
  const syncPresets = (): void => {
    for (const [p, b] of presetBtns) b.style.borderColor = p === preset ? "var(--accent)" : "";
    info.textContent = PRESETS[preset].description;
  };
  for (const p of Object.keys(PRESETS) as PresetName[]) {
    presetBtns.set(
      p,
      button(presetRow, PRESETS[p].label, () => {
        current.releaseAll();
        preset = p;
        current = get(p);
        void unlockAudio();
        syncPresets();
      }),
    );
  }

  const kbWrap = document.createElement("div");
  el.appendChild(kbWrap);
  let input: NoteInput;
  const kb = new PianoKeyboard(kbWrap, {
    low: 48,
    high: 79,
    labels: "c",
    onNoteOn: (m, v) => input.emitOn(m, v, "pointer"),
    onNoteOff: (m) => input.emitOff(m, "pointer"),
  });
  let last = "—";
  input = new NoteInput(el, {
    onNoteOn: (m, v, src) => {
      current.noteOn(m, v);
      if (src !== "pointer") kb.press(m, true);
      last = `${noteName(m)} (${m}) vel ${v.toFixed(2)} via ${src}`;
    },
    onNoteOff: (m, src) => {
      current.noteOff(m);
      if (src !== "pointer") kb.press(m, false);
    },
  });

  const optRow = controlsRow(el);
  select(optRow, "labels", ["c", "white", "all", "qwerty", "none"], (v) => {
    labelMode = v;
    kb.setLabels(v === "qwerty" ? input.qwertyLabels() : (v as "c" | "white" | "all" | "none"));
  });
  let labelMode = "c";
  input.onOctaveChange = () => {
    if (labelMode === "qwerty") kb.setLabels(input.qwertyLabels());
  };
  select(optRow, "scale", ["none", "C major", "A minor pentatonic", "D dorian", "E blues"], (v) => {
    if (v === "none") kb.setScale(null);
    else if (v === "C major") kb.setScale(60, SCALES.major);
    else if (v === "A minor pentatonic") kb.setScale(57, SCALES.minorPentatonic);
    else if (v === "D dorian") kb.setScale(62, SCALES.dorian);
    else kb.setScale(64, SCALES.blues);
  });
  button(optRow, "▶ phrase", () => {
    void unlockAudio().then(() => {
      // I–vi–IV–V in C, then an arpeggio, on the audio clock
      const t0 = Tone.immediate() + 0.05;
      const prog = [0, 5, 3, 4].map((d) => diatonicChord(60, SCALES.major, d));
      prog.forEach((ch, i) => current.play(ch, 0.9, t0 + i, 0.7));
      const arp = [...chordNotes(parseNote("C5"), "maj7"), 79, 76, 72];
      arp.forEach((m, i) => current.play(m, 0.22, t0 + 4 + i * 0.18, 0.55 + 0.05 * i));
    });
  });
  button(optRow, "■ stop all", () => stopAll());
  optRow.appendChild(midiButton());

  const info = document.createElement("div");
  info.className = "demo-readout";
  el.appendChild(info);
  const status = document.createElement("div");
  status.className = "demo-readout";
  el.appendChild(status);
  syncPresets();

  const tick = (): void => {
    kb.setSounding(current.sounding);
    status.textContent = `last: ${last} · octave ${input.octave} (A = C${input.octave}) · velocity ${input.velocity.toFixed(1)} · sounding ${[...current.sounding].map((m) => noteName(m)).join(" ") || "–"}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- master chain --------------------------------------------------------------------------

interface Measure {
  peakDb: number;
  rmsDb: number;
}

function measure(buf: AudioBuffer, from = 0, to = buf.duration): Measure {
  let peak = 0;
  let sum = 0;
  let n = 0;
  const a = Math.floor(from * buf.sampleRate);
  const b = Math.min(buf.length, Math.floor(to * buf.sampleRate));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = a; i < b; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
      sum += d[i] * d[i];
      n++;
    }
  }
  const db = (x: number): number => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 100) / 100;
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(n, 1))) };
}

/** Loud stacked material (≈ +14 dB over full scale) through a fresh master chain. */
async function offlineLimiter(native: boolean): Promise<Record<string, unknown>> {
  let kind = "";
  const buf = await Tone.Offline(async () => {
    const chain = buildMasterChain({ native });
    if (!native) await chain.ready;
    kind = chain.limiterKind();
    chain.output.toDestination();
    // a sudden full-scale click train after silence (tests the look-ahead)
    const click = new Tone.Oscillator(2000, "square");
    const cg = new Tone.Gain(4).connect(chain.input);
    click.connect(cg).start(0.3).stop(0.31);
    // six detuned saws at 0.9 each, a dense chord
    for (const [i, m] of [36, 43, 48, 52, 55, 60].entries()) {
      const g = new Tone.Gain(0.9).connect(chain.input);
      new Tone.Oscillator(midiToFreq(m) * (1 + i * 0.001), "sawtooth").connect(g).start(0.6).stop(2.6);
    }
  }, 3, 2, 48000);
  const b = buf.get() as AudioBuffer;
  return { limiter: kind, ceilingDb: CEILING_DB, whole: measure(b), click: measure(b, 0.25, 0.4), chord: measure(b, 0.7, 2.5) };
}

/** Gain of the chain for quiet and moderate sines (should be ~0 dB when quiet). */
async function offlineGain(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, amp] of [
    ["-40 dBFS", 0.01],
    ["-20 dBFS", 0.1],
    ["-12 dBFS", 0.25],
    ["-6 dBFS", 0.5],
  ] as [string, number][]) {
    const buf = await Tone.Offline(async () => {
      const chain = buildMasterChain({});
      await chain.ready;
      chain.output.toDestination();
      const g = new Tone.Gain(amp).connect(chain.input);
      new Tone.Oscillator(1000, "sine").connect(g).start(0).stop(2);
    }, 2, 2, 48000);
    const m = measure(buf.get() as AudioBuffer, 1, 1.9);
    const inRms = 20 * Math.log10(amp / Math.SQRT2);
    out[name] = Math.round((m.rmsDb - inRms) * 100) / 100;
  }
  return out;
}

/** Peak/RMS of each preset: one C4 at velocity 0.8, and a 5-note chord. */
async function presetLevels(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const p of Object.keys(PRESETS) as PresetName[]) {
    const buf = await Tone.Offline(async () => {
      const dest = new Tone.Gain(1).toDestination();
      const inst = createInstrument(p, { destination: dest });
      await inst.ready();
      inst.play(60, 1.0, 0.05, 0.8);
      inst.play(p === "bass" ? [36] : [48, 55, 60, 64, 67], 1.5, 1.6, 0.8);
    }, 3.4, 2, 48000);
    const b = buf.get() as AudioBuffer;
    out[p] = { note: measure(b, 0.05, 1.05), chord: measure(b, 1.6, 3.1) };
  }
  return out;
}

function mountMaster(el: HTMLElement): void {
  const row = controlsRow(el);
  const out = document.createElement("pre");
  out.className = "lab-out";
  out.style.cssText = "font-size:0.72rem;white-space:pre-wrap;margin:0.6rem 0 0;max-height:22rem;overflow:auto";
  let glue = true;
  let stress: Instrument[] = [];
  let saw: Tone.Oscillator | null = null;
  button(row, "▶ stress (8 instruments + saw)", () => {
    void unlockAudio().then(() => {
      const t = Tone.immediate() + 0.05;
      stress = (Object.keys(PRESETS) as PresetName[]).map((p) => createInstrument(p, { volume: 6 }));
      stress.forEach((inst, i) => inst.play(chordNotes(48 + i, "maj7"), 3, t, 1));
      saw = new Tone.Oscillator(110, "sawtooth").connect(new Tone.Gain(0.9).connect(masterBus()));
      saw.start(t).stop(t + 3);
      window.setTimeout(() => {
        for (const s of stress) s.dispose();
        stress = [];
      }, 5000);
    });
  });
  button(row, "glue on/off", () => {
    glue = !glue;
    masterChain().setGlue(glue);
  });
  button(row, "offline: limiter", () => {
    out.textContent = "rendering…";
    void Promise.all([offlineLimiter(false), offlineLimiter(true)]).then((r) => (out.textContent = JSON.stringify(r, null, 1)));
  });
  button(row, "offline: chain gain", () => {
    out.textContent = "rendering…";
    void offlineGain().then((r) => (out.textContent = JSON.stringify(r, null, 1)));
  });
  button(row, "offline: preset levels", () => {
    out.textContent = "rendering…";
    void presetLevels().then((r) => (out.textContent = JSON.stringify(r, null, 1)));
  });
  const status = document.createElement("div");
  status.className = "demo-readout";
  el.append(status, out);
  window.setInterval(() => {
    const ctx = Tone.getContext();
    status.textContent = `context ${ctx.state} @ ${ctx.sampleRate} Hz · limiter ${masterChain().limiterKind()} · reduction ${limiterReduction().toFixed(1)} dB · glue ${glue ? "on" : "off"}`;
  }, 250);
}

// ---- legacy DOM piano (unchanged API) -------------------------------------------------------

function mountLegacy(el: HTMLElement): void {
  const inst = createInstrument("sine");
  const p = new Piano({
    low: 60,
    high: 72,
    onPress: (m) => {
      void unlockAudio();
      inst.play(m, 0.4);
      p.setHeld([m], m);
    },
  });
  el.appendChild(p.el);
  const caps = new Map<number, string>([
    [60, "A"],
    [62, "S"],
    [64, "D"],
  ]);
  p.setLabels(caps);
}

declare global {
  interface Window {
    __musicLab?: Record<string, unknown>;
  }
}
window.__musicLab = { offlineLimiter, offlineGain, presetLevels, masterChain };

const sections: [string, (el: HTMLElement) => void | Promise<void>][] = [
  ["lab-instruments", mountInstruments],
  ["lab-views", mountLabViews],
  ["lab-master", mountMaster],
  ["lab-legacy", mountLegacy],
];

for (const [id, mount] of sections) {
  const el = document.getElementById(id);
  if (!el) continue;
  Promise.resolve()
    .then(() => mount(el))
    .catch((err) => console.error(`music-lab: ${id} failed`, err));
}
