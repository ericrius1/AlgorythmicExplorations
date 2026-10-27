# Music toolkit (`src/lib/music/`)

Shared audio + UI foundation for the Living Music and Acoustic Spaces series.
Everything here is additive: `src/lib/audio.ts`, `src/lib/piano.ts` and
`src/lib/shaderCanvas.ts` keep every existing export with the same behaviour.

Import from the barrel or from the individual modules:

```ts
import { createInstrument, PianoKeyboard, Oscilloscope } from "../../lib/music";
// or
import { createInstrument } from "../../lib/music/instruments";
```

Components that render UI import `src/styles/music.css` themselves, so a page
gets the styles as soon as it uses one. Music pages can also import it directly
(`import "../../styles/music.css";`).

Status: see the "Status" table at the bottom; it says what is implemented.

---

## 1. Master chain (`master.ts`) — automatic

Everything that connects to `masterBus()` (from `src/lib/audio.ts`, unchanged
API) now flows through one shared chain before the speakers:

```
masterBus() Gain 0.8 ──┬── legacy taps: waveform() / spectrum()   (unchanged, pre-chain)
                       └─► DC-block high-pass 20 Hz
                           ► glue compressor (−18 dB thr, 2:1, soft knee, auto makeup cancelled)
                           ► brickwall look-ahead limiter, ceiling −1 dBFS (AudioWorklet;
                             native compressor + soft clipper fallback)
                           ► masterProbe() taps (scope / spectrum / meter read here)
                           ► listener volume / mute ─► speakers
shared reverb send ─► convolution reverb (generated, damped IR) ─► masterBus()
```

So existing demos need no change. Several demos at once can't clip: the
limiter holds the output at or below −1 dBFS.

```ts
import { masterChain, reverbSend, connectOut, setMasterVolume, masterVolume,
         setMuted, isMuted, onSoundChange, limiterReduction } from "../../lib/music/master";

masterChain();                          // builds the chain (masterBus() does it too)
masterChain().ready;                    // Promise<void>: resolves once the worklet limiter is in
reverbSend();                           // Tone.Gain: input of the shared reverb (100% wet)
connectOut(synth, { reverb: 0.25 });    // synth → masterBus() dry + 0.25 → shared reverb;
                                        //   returns { dry: Tone.Gain, send: Tone.Gain }
setMasterVolume(0.7);                   // listener volume 0..1 (perceptual curve), post-limiter
setMuted(true);  isMuted();             // listener mute (ramped, no clicks)
onSoundChange(({ muted, volume }) => …) // returns an unsubscribe fn
limiterReduction();                     // current limiter gain reduction in dB (≥ 0), for meters
```

## 2. Lifecycle helpers (`lifecycle.ts`)

```ts
import { installUnlock, fadeOut, fadeTo, whenOffscreen, registerVoice, stopAll } from "../../lib/music/lifecycle";

installUnlock();                        // first pointerdown/keydown/touchend anywhere unlocks audio
                                        //   (calls unlockAudio() from audio.ts). Idempotent.
fadeTo(gain, 0.5, 0.1);                 // ramp a Tone.Gain (or AudioParam-like) to a value over s
await fadeOut(gain, 0.2);               // ramp to 0, resolves when silent
const stop = whenOffscreen(container, () => inst.releaseAll(), () => {/*back*/});
                                        // IntersectionObserver; callbacks on leave / re-enter.
                                        //   returns a disposer
registerVoice(() => mySilencer());      // joins the global stopAll() list; returns an unregister fn
stopAll();                              // releases every instrument + registered voice (panic)
```

`frameGuard()` / `soundHint()` from `audio.ts` still work as before.

## 3. Sound control (`soundControl.ts`)

A small floating pill (bottom-right) with an on/off toggle and a volume slider,
remembered per visitor in `localStorage` (all storage access is try/catch'd).
It also installs unlock-on-first-gesture. Call once per music page.

```ts
import { mountSoundControl } from "../../lib/music/soundControl";
mountSoundControl();                    // or mountSoundControl({ parent: someEl, meter: true })
```

`soundEnabled()` returns false when the visitor has switched sound off.

## 4. Instruments (`instruments.ts`)

Presets tuned to sound good through the master chain, with sensible polyphony
and envelopes. Notes are MIDI numbers (fractional values are fine for
microtonal work: 60.5 is a quarter-tone above middle C). `time` is an
AudioContext time in seconds (e.g. the `time` StepClock hands you); omit it to
play immediately (no Tone look-ahead delay, for live input).

| preset    | what it is                                                  | polyphony |
|-----------|-------------------------------------------------------------|-----------|
| `epiano`  | FM electric piano (tine + body, velocity-sensitive brightness, gentle tremolo) | 16 |
| `pluck`   | Karplus–Strong plucked string (round-robin voices)          | 8         |
| `pad`     | warm detuned-saw pad, slow attack, low-pass, chorus         | 10        |
| `bass`    | saw + sub bass with filter envelope, mono with glide        | 1         |
| `bell`    | inharmonic FM bell, long ring                              | 12        |
| `organ`   | drawbar-style additive organ with rotary-ish vibrato        | 12        |
| `marimba` | mallet: sine body + fast-decaying overtone                   | 12        |
| `sine`    | clean sine with soft envelope (for tuning/spectrum lessons) | 16        |

```ts
import { createInstrument, PRESETS, type Instrument, type PresetName } from "../../lib/music/instruments";

const ep = createInstrument("epiano", { reverb: 0.2, volume: -3 });
ep.noteOn(60, 0.8);                     // (midi, velocity 0..1 = 0.8, time?)
ep.noteOff(60);                         // (midi, time?)
ep.play([60, 64, 67], 1.5, time, 0.7);  // chord for 1.5 s at an AudioContext time
ep.releaseAll();
ep.sounding;                            // ReadonlySet<number> of held notes
ep.volume = -6;                         // dB
ep.output;                              // Tone.Gain (already connected to masterBus())
ep.connect(someNode);                   // re-route the output instead
ep.dispose();
PRESETS.pad.label;                      // "Warm pad" (+ .description)
```

## 5. Music theory (`theory.ts`)

```ts
import { SCALES, CHORDS, pc, noteName, parseNote, inScale, scaleNotes, chordNotes } from "../../lib/music/theory";

SCALES.major;                           // [0,2,4,5,7,9,11]  (also minor, harmonicMinor, dorian,
                                        //   phrygian, lydian, mixolydian, locrian, majorPentatonic,
                                        //   minorPentatonic, blues, wholeTone, chromatic)
CHORDS.maj7;                            // [0,4,7,11]  (maj, min, dim, aug, sus2, sus4, dom7, maj7,
                                        //   min7, m7b5, dim7, add9)
pc(61);                                 // 1
noteName(61);                           // "C♯4"; noteName(61, { flats: true }) → "D♭4";
                                        //   { octave: false } → "C♯"
parseNote("Bb3");                       // 58 (accepts #, b, ♯, ♭)
inScale(64, 60, SCALES.major);          // true
scaleNotes(60, SCALES.minorPentatonic, 2); // MIDI notes over 2 octaves (+ top root)
chordNotes(60, "min7", 1);              // first inversion
```

`NOTE_NAMES`, `midiToFreq`, `midiName`, `freqLabel`, `cents` stay in `audio.ts`.

## 6. Note input (`input.ts`)

QWERTY-as-piano, Web MIDI and pointer input, all delivered to one handler.
When several playable figures are on a page, keyboard and MIDI notes go to the
one the reader touched last (if it's still on screen), otherwise to the most
visible one; that figure gets a subtle focus ring (`.is-note-target`).

Layout (physical keys, works on any keyboard layout):
```
 W E   T Y U   O P        black keys
A S D F G H J K L ; '     white keys: A = C of the current octave … ' = F an octave up
Z / X  octave down / up       (ignored while typing in inputs; no key repeat; all notes
                               released on window blur)
```

```ts
import { NoteInput, requestMidi, midiStatus, onMidiChange, midiButton } from "../../lib/music/input";

const input = new NoteInput(container, {
  onNoteOn: (midi, velocity, source) => inst.noteOn(midi, velocity),   // source: "qwerty"|"midi"|"pointer"
  onNoteOff: (midi, source) => inst.noteOff(midi),
  onSustain: (down) => {},              // optional, MIDI CC64
}, { qwerty: true, midi: true, octave: 4 });   // octave 4: the A key plays C4 (MIDI 60)
input.octave;                           // read/write; Z/X change it
input.qwertyLabels();                   // Map<midi, "A"|"W"|…> for keycap labels
input.onOctaveChange = (o) => {};
input.activate();                       // claim keyboard/MIDI focus explicitly
input.dispose();

await requestMidi();                    // call from a click handler; resolves false when the
                                        //   browser has no Web MIDI or the reader declines
midiStatus();                           // "unsupported" | "idle" | "pending" | "ready" | "denied"
onMidiChange((status, deviceNames) => {});
shell.controls.append(midiButton());    // ready-made "MIDI" button that does the above;
                                        //   hides itself where Web MIDI doesn't exist
```

## 7. Piano keyboard widget (`keyboard.ts`)

High-DPI canvas keyboard: multitouch, glissando (slide across keys), velocity
from where you strike the key (front = loud), pressed notes (warm) vs notes
sounding from elsewhere (cool), optional labels and scale highlighting. Resizes
with its container.

```ts
import { PianoKeyboard } from "../../lib/music/keyboard";

const kb = new PianoKeyboard(parentEl, {
  low: 48, high: 72,                    // MIDI range (inclusive); starts/ends are tidied to white keys
  height: 110,                          // CSS px (default: 96, or 0.16 × width if smaller)
  labels: "c",                          // "none" | "c" (C only) | "white" | "all" | Map<midi,string>
  scale: { root: 60, intervals: SCALES.major },   // optional: dots on in-scale keys, root ringed
  onNoteOn: (midi, velocity) => {}, onNoteOff: (midi) => {},
});
kb.press(60, true);                     // show a key as held (e.g. from QWERTY/MIDI)
kb.setSounding([64, 67]);               // notes sounding from elsewhere (sequencer, chord demo)
kb.setScale(62, SCALES.dorian);         // or kb.setScale(null)
kb.setLabels(input.qwertyLabels());
kb.setRange(36, 84);
kb.dispose();
```

One-liner that wires an instrument + keyboard widget + QWERTY/MIDI together:

```ts
import { mountPlayable } from "../../lib/music/keyboard";
const p = mountPlayable(container, { instrument: "epiano", low: 48, high: 76, labels: "qwerty" });
p.instrument; p.keyboard; p.input;      // the parts, for further wiring
p.dispose();
```

The old DOM `Piano` in `src/lib/piano.ts` is unchanged.

## 8. Analysis (`analysis.ts`)

```ts
import { masterProbe, AudioProbe } from "../../lib/music/analysis";

const probe = masterProbe();            // taps the master output (post-limiter, pre-volume)
const mine = new AudioProbe(myGainNode);// or tap any Tone node / AudioNode
probe.sampleRate;
probe.time();                           // Float32Array (mono, 4096 samples, latest)
probe.freqDb();                         // Float32Array (dB per FFT bin, fftSize 8192)
probe.binHz;                            // Hz per bin
probe.levels();                         // { peakL, peakR, rmsL, rmsR } linear, this frame
probe.pitch();                          // { hz, clarity } from autocorrelation, or null
```

Data is pulled once per animation frame and shared by every view reading it.

## 9. Visual components (`views.ts`)

High-DPI views fed by a probe (default: `masterProbe()`). Rendered with WebGPU
through `ShaderView` (glow traces, same look as the series' shader figures),
with a Canvas 2D fallback where WebGPU is missing. Labels/graticule are drawn
on a 2D overlay. By default each view runs its own animation loop only while
on screen; pass `auto: false` and call `view.draw()` from your demo's `frame()`
instead if you want lockstep with your own drawing.

```ts
import { Oscilloscope, SpectrumView, Spectrogram, LevelMeter } from "../../lib/music/views";

new Oscilloscope(el, { height: 180, color: "#7aa2ff", windowMs: 20, gain: 1, trigger: true,
                       showPitch: true });
new SpectrumView(el, { height: 200, minHz: 30, maxHz: 16000, minDb: -96, maxDb: -6,
                       labels: "notes", peakHold: true, markers: [440] });
new Spectrogram(el, { height: 220, minHz: 40, maxHz: 12000, minDb: -100, maxDb: -20,
                      seconds: 6 });
new LevelMeter(el, { height: 34, orientation: "horizontal", showReduction: true });

// common: { source?: AudioProbe; auto?: boolean; height?: number } + view.draw(), view.dispose(), view.el
```

## 10. Styles (`src/styles/music.css`)

Classes: `.sound-control` (floating pill), `.music-view` (+ `.music-view canvas`
layers), `.pkb` (piano keyboard), `.level-meter`, `.midi-button`,
`.is-note-target` (focus ring for the figure receiving QWERTY/MIDI),
`.kbd-hint` (small "play with A–K" hint line), `.music-row` (flex row for
side-by-side views). Uses the site tokens (`--accent`, `--accent-warm`,
`--border`, `--panel`, `--muted`).

## Test page

`/pages/core/music-lab.html` (unlisted) exercises everything: every preset on
a playable keyboard, scope/spectrum/spectrogram/meter, a "stress" button that
stacks loud demos to show the limiter holding.

## Status

| module | state |
|---|---|
| README | written |
| master.ts / limiter worklet | in progress |
| lifecycle.ts, soundControl.ts | in progress |
| instruments.ts, theory.ts | in progress |
| input.ts, keyboard.ts | in progress |
| analysis.ts, views.ts | in progress |
| music.css, music-lab page | in progress |
