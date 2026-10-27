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
                       └─► DC-block high-pass 15 Hz (2nd-order Butterworth)
                           ► glue compressor (−14 dB thr, 2:1, 12 dB knee, 20 ms / 250 ms;
                             its automatic makeup gain is cancelled, so quiet material is at unity)
                           ► brickwall look-ahead limiter, ceiling −1 dBFS, 5 ms look-ahead
                             (AudioWorklet; a native compressor + soft clipper stands in until
                             it loads, and for good where worklets don't load)
                           ► masterProbe() taps (scope / spectrum / meter read here)
                           ► listener volume / mute ─► speakers
shared reverb send ─► convolution reverb (generated, damped IR) ─► masterBus()
```

So existing demos need no change. Several demos at once can't clip: the
limiter holds the output at or below −1 dBFS (measured offline: six stacked
saws at gain 0.9 plus a click at gain 4 come out at −1.00 dBFS peak with the
worklet, −1.81 dBFS on the native fallback). Quiet material passes flat on both
paths: a −26 dBFS sine at 40 Hz–10 kHz measures −0.07…0.00 dB in realtime
(worklet and native in Chrome 152; native in headless Chromium 140), and −40 / −20 dBFS sines are 0.00 dB
offline. Louder mixes get gently glued (a −6 dBFS sine comes out 1.2 dB lower).

The stages inside the chain are native Web Audio nodes with their values set
directly (`chain.compressor` is a `DynamicsCompressorNode`); `input`, `post`
and `output` are unity `Tone.Gain`s for connecting.

The `masterBus()` Gain is still 0.8 and the legacy `waveform()` / `spectrum()`
taps still read the bus before the chain, so existing figures look the same.
Anything that bypasses `masterBus()` (`.toDestination()`, its own
`AudioContext`) also bypasses the limiter.

```ts
import { masterChain, reverbSend, connectOut, setMasterVolume, masterVolume,
         setMuted, isMuted, onSoundChange, limiterReduction } from "../../lib/music/master";

masterChain();                          // builds the chain (masterBus() does it too)
masterChain().ready;                    // Promise<void>: worklet limiter in, or native final (≤ 3 s);
                                        //   never rejects
masterChain().limiterKind();            // "worklet" | "native"
masterChain().setGlue(false);           // bypass the glue compressor (loudness demos); limiter stays
buildMasterChain({ native: true });     // a fresh chain on the current context (for Tone.Offline tests)
CEILING_DB;                             // −1
reverbSend();                           // Tone.Gain: input of the shared reverb (100% wet)
connectOut(synth, { reverb: 0.25 });    // synth → masterBus() dry + 0.25 → shared reverb;
                                        //   returns { dry: Tone.Gain, send: Tone.Gain }
setMasterVolume(0.7);                   // listener volume 0..1 (perceptual curve), post-limiter
setMuted(true);  isMuted();             // listener mute (ramped, no clicks)
onSoundChange(({ muted, volume }) => …) // returns an unsubscribe fn
limiterReduction();                     // current limiter gain reduction in dB (≥ 0), for meters
                                        //   (0 on the native fallback)
compressorMakeupDb(-14, 12, 2);         // 2.31: a DynamicsCompressorNode's automatic makeup gain
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

`soundEnabled()` returns false when the visitor has switched sound off. The
pill is a listener control: it sets the post-limiter volume/mute from section 1,
so demos keep running (and their visuals keep moving) while muted. `meter: true`
(default) adds a slim level glow to the pill.

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

Voices are built from native Web Audio nodes per note (analytic envelopes,
true exponential decays, click-free releases and voice stealing); the pluck
runs Karplus–Strong in an AudioWorklet and falls back to a synth pluck where
worklets don't load. Each instrument registers itself with `stopAll()`.

```ts
import { createInstrument, PRESETS, type Instrument, type PresetName } from "../../lib/music/instruments";

const ep = createInstrument("epiano", { reverb: 0.2, volume: -3 });
ep.noteOn(60, 0.8);                     // (midi, velocity 0..1 = 0.8, time?)
ep.noteOff(60);                         // (midi, time?)
ep.play([60, 64, 67], 1.5, time, 0.7);  // chord for 1.5 s at an AudioContext time
ep.releaseAll();                        // (time?)
ep.sounding;                            // ReadonlySet<number>: held notes + notes from play()
await ep.ready();                       // builds nodes now; for pluck waits for the worklet (≤ 3 s)
ep.setReverb(0.3);                      // shared-reverb send 0..1
ep.volume = -6;                         // dB
ep.output;                              // Tone.Gain (already connected to masterBus())
ep.connect(someNode);                   // re-route the output instead (drops bus + reverb send)
ep.dispose();
createInstrument("pad", { destination: myGain, polyphony: 6 });  // options: volume (dB), reverb,
                                        //   destination, polyphony
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
diatonicChord(60, SCALES.major, 4);     // [67, 71, 74]: the V triad in C (degree is 0-based;
                                        //   4th arg true = sevenths)
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
Z / X  octave down / up       C / V  velocity down / up (0.1 steps)
(ignored while typing in inputs or with Cmd/Ctrl/Alt held; no key repeat; all notes
 released on window blur)
```

```ts
import { NoteInput, requestMidi, midiStatus, onMidiChange, midiButton } from "../../lib/music/input";

const input = new NoteInput(container, {
  onNoteOn: (midi, velocity, source) => inst.noteOn(midi, velocity),   // source: "qwerty"|"midi"|"pointer"
  onNoteOff: (midi, source) => inst.noteOff(midi),
  onSustain: (down) => {},              // optional, MIDI CC64 (omit it and NoteInput holds the
                                        //   note-offs itself while the pedal is down)
  onPitchBend: (semitones) => {},       // optional, ±2 semitones
}, { qwerty: true, midi: true, octave: 4, velocity: 0.8 });  // octave 4: A plays C4 (MIDI 60)
input.octave;                           // read/write; Z/X change it
input.qwertyLabels();                   // Map<midi, "A"|"W"|…> for keycap labels
input.onOctaveChange = (o) => {};
input.velocity;                         // read/write; C/V change it
input.activate();                       // claim keyboard/MIDI focus explicitly
input.emitOn(60, 0.8, "pointer");       // feed notes from your own UI (e.g. a PianoKeyboard)
input.emitOff(60, "pointer");           //   through the same routing + sustain handling
input.releaseAll();
input.dispose();

await requestMidi();                    // call from a click handler; resolves false when the
                                        //   browser has no Web MIDI or the reader declines
midiStatus();                           // "unsupported" | "idle" | "pending" | "ready" | "denied"
midiDevices();                          // names of connected MIDI inputs
onMidiChange((status, deviceNames) => {});  // returns an unsubscribe fn
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
  low: 48, high: 72,                    // MIDI range (inclusive); widened to white keys
  height: 110,                          // CSS px (default: 16 % of the width, clamped to 72..120)
  labels: "c",                          // "none" | "c" (C only) | "white" | "all" | Map<midi,string>
  scale: { root: 60, intervals: SCALES.major },   // optional: dots on in-scale keys, root ringed
  onNoteOn: (midi, velocity) => {}, onNoteOff: (midi) => {},
});
kb.press(60, true);                     // show a key as held (e.g. from QWERTY/MIDI)
kb.setSounding([64, 67]);               // notes sounding from elsewhere (sequencer, chord demo)
kb.setScale(62, SCALES.dorian);         // or kb.setScale(null)
kb.setLabels(input.qwertyLabels());
kb.setRange(36, 84);
kb.releaseAll();
kb.dispose();
```

One-liner that wires an instrument + keyboard widget + QWERTY/MIDI together:

```ts
import { mountPlayable } from "../../lib/music/keyboard";
const p = mountPlayable(container, { instrument: "epiano", low: 48, high: 76, labels: "qwerty" });
p.el; p.instrument; p.keyboard; p.input; // the parts, for further wiring
p.dispose();
// options: instrument (preset name or an Instrument), low, high, height, labels (KeyLabels |
//   "qwerty"), scale, octave (of the A key; default octave of `low` + 1), qwerty, midi,
//   hint (the "play with A–K" line + MIDI button, default true), onNoteOn, onNoteOff
```

The old DOM `Piano` in `src/lib/piano.ts` is unchanged.

## 8. Analysis (`analysis.ts`)

```ts
import { masterProbe, AudioProbe } from "../../lib/music/analysis";

const probe = masterProbe();            // taps the master output (post-limiter, pre-volume)
const mine = new AudioProbe(myGainNode);// or tap any Tone node / native AudioNode (any context,
                                        //   e.g. a page's own AudioContext), or a getter () => node
probe.active;                           // false until audio is running (data is silent before)
probe.sampleRate;
probe.time();                           // Float32Array (mono, 4096 samples, latest)
probe.freqDb();                         // Float32Array (dB per FFT bin, fftSize 8192)
probe.binHz;                            // Hz per bin
probe.levels();                         // { peakL, peakR, rmsL, rmsR } linear, this frame
probe.pitch();                          // { hz, clarity } (YIN, every other frame), or null
mine.dispose();
```

Data is pulled once per animation frame and shared by every view reading it.
Probes build their analysers only once audio is running, so they never create
an AudioContext before a gesture.

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
new LevelMeter(el, { orientation: "horizontal", minDb: -60, showReduction: true });
                                        // vertical: { orientation: "vertical", height: 180, width: 76 }

// common options: { source?: AudioProbe; auto?: boolean; height?: number; renderer?: "auto" | "2d" }
// common members: view.el, view.draw(), view.dispose(), view.renderer ("pending" | "gpu" | "2d")
scope.setWindow(30); scope.setGain(2);
spectrum.setMarkers([440, 880]); spectrum.setRange(50, 8000); spectrum.peak; // { hz, db } | null
```

Defaults: scope `height` 180, `windowMs` 20, `trigger` true (stable rising-edge
trigger), `showPitch` true; spectrum `height` 200, 30 Hz–16 kHz, −96…−6 dB,
`labels` "notes" ("hz", "both", "none"), `peakHold` and `showPeak` true, `decay`
60 dB/s; spectrogram `height` 220, 40 Hz–12 kHz, −100…−20 dB, `seconds` 6;
meter horizontal height 46. Add `?music2d` to a page URL to force the 2D
renderer everywhere. `ShaderView` (shaderCanvas.ts) gained two additive
members for this: `manualUpload` + `markData(start, end)` for partial data
uploads, and a `failed` getter.

## 10. Styles (`src/styles/music.css`)

Classes: `.sound-control` (floating pill; `.is-inline` when given a parent),
`.music-view` (canvas layers `.mv-back` / `.mv-front`; `.music-scope`,
`.music-spectrum`, `.music-spectrogram`), `.level-meter` (`.is-vertical`),
`.pkb` (piano keyboard), `.playable` (mountPlayable wrapper), `.midi-button`,
`.is-note-target` (focus ring for the figure receiving QWERTY/MIDI),
`.kbd-hint` (small "play with A–K" hint line), `.music-row` (flex row for
side-by-side views, wraps on narrow screens). Uses the site tokens
(`--accent`, `--accent-warm`, `--border`, `--panel`, `--muted`).

## Test page

`/pages/core/music-lab.html` (unlisted) exercises everything: every preset on
a playable keyboard, scope/spectrum/spectrogram/meter, a "stress" button that
stacks loud demos to show the limiter holding.

## Browser notes

- Headless Chromium (Playwright's 140 and headless Chrome) never finishes
  `audioWorklet.addModule`, so there the limiter stays native and the pluck
  uses its synth fallback; `ready()` promises settle after 3 s. Real Chrome
  (152) loads both worklets in well under a second.
- Headless Chromium 140 sometimes plays a `Tone.Oscillator` scheduled to
  start in the future an octave high (its frequency signal and the native
  param's 440 add). Real Chrome measures 439–441 Hz for the same code. The
  instruments here use native oscillators and aren't affected; keep it in
  mind when a headless pitch measurement looks doubled.

## Status

All modules above are implemented and typecheck. Verified in the lab page
(screenshots at 1280 and 375 px, no console errors) and with offline renders.
