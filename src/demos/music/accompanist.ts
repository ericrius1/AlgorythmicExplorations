// The full accompanist, as a jam figure: you play (computer keyboard, MIDI, or
// the on-screen keys) and the band listens, picks a key and chords, comps,
// and answers your phrases. The piano roll runs right to left through the
// "now" line, and the band's planned notes are drawn before they sound.

import { Shell, type Demo } from "../../lib/demoShell";
import { frameGuard } from "../../lib/audio";
import { Accompanist, type AnswerSetting, type StyleSetting } from "./accomp/band";
import { pageNow } from "./accomp/clock";
import { C, drawRoll, font, rgba, roundRect, ui } from "./accomp/draw";
import { Ghost } from "./accomp/ghost";
import { BandVoices } from "./accomp/instruments";
import { TouchPiano, enableMidi, midiStatus, onOctave, qwertyBase, registerSink } from "./accomp/input";
import { keyName } from "./accomp/theory";
import { playGate, segmented, smallButton, stage } from "./accomp/ui";

export function mountAccompanist(container: HTMLElement): Demo {
  const shell = new Shell(container, (window.innerWidth || 1024) < 560 ? 0.95 : 0.56);
  const g = shell.canvas.getContext("2d")!;
  const wrap = stage(shell);
  const band = new Accompanist(96);
  const ghost = new Ghost(band);
  // until the reader taps in, the stand-in plays silently so the roll isn't empty
  let previewing = true;
  let wantGhost = false;
  band.start();
  band.onStepHook = (s, t) => ghost.onStep(s, t);
  band.onUserNote = () => {
    if (ghost.enabled && !previewing) {
      ghost.enabled = false;
      syncGhost();
    }
  };

  let voices: BandVoices | null = null;
  let soundOn = false;
  const turnOn = (): void => {
    if (previewing) {
      previewing = false;
      band.reset();
      ghost.enabled = wantGhost;
      ghost.key = { root: 0, minor: false };
      wantGhost = false;
      if (ghost.enabled) band.start();
      syncGhost();
    }
    if (!voices) voices = new BandVoices();
    voices.fader.gain.value = 0;
    voices.fadeTo(1, 0.3);
    band.attachVoices(voices);
    soundOn = true;
  };
  const gate = playGate(wrap, "Tap to jam", "then play the keys below, or type A S D F…", turnOn);
  const guard = frameGuard(() => {
    if (!soundOn) return;
    soundOn = false;
    band.stop();
    band.voices = null;
    voices?.fadeTo(0, 0.15);
    gate.show("Tap to resume");
  });

  // ---- input ----
  const piano = new TouchPiano(
    48,
    84,
    (m) => {
      if (!soundOn) gate.el.click();
      band.noteOn(m, 0.72);
    },
    (m) => band.noteOff(m),
  );
  piano.setCaps(qwertyBase());
  onOctave((b) => piano.setCaps(b));
  wrap.after(piano.el);
  registerSink({
    el: container,
    armed: () => soundOn,
    noteOn: (m, v) => band.noteOn(m, v),
    noteOff: (m) => band.noteOff(m),
  });

  // ---- controls ----
  segmented<StyleSetting>(shell.controls, "band", ["auto", "fill", "comp", "hold"], "auto", (v) => (band.style = v));
  segmented<AnswerSetting>(
    shell.controls,
    "answers",
    ["auto", "echo", "mirror", "sequence", "riff", "off"],
    "auto",
    (v) => (band.answers = v),
  );
  const brk = document.createElement("span");
  brk.className = "mp-break";
  shell.controls.appendChild(brk);
  const ghostBtn = smallButton(shell.controls, "▶ stand-in plays", () => {
    if (previewing || !soundOn) {
      wantGhost = previewing;
      if (!previewing) ghost.enabled = true;
      gate.el.click();
      syncGhost();
      return;
    }
    ghost.enabled = !ghost.enabled;
    if (ghost.enabled) {
      ghost.key = band.ear.key ?? { root: 0, minor: false };
      if (!band.clock.isRunning) band.start();
    }
    syncGhost();
  });
  function syncGhost(): void {
    ghostBtn.textContent = ghost.enabled && !previewing ? "■ stop the stand-in" : "▶ stand-in plays";
  }
  const grooveBtn = smallButton(shell.controls, "brushes: on", () => {
    band.groove = !band.groove;
    grooveBtn.textContent = `brushes: ${band.groove ? "on" : "off"}`;
  });
  const midiBtn = smallButton(shell.controls, "use a MIDI keyboard", () => {
    enableMidi(() => (midiBtn.textContent = midiStatus() || "use a MIDI keyboard"));
  });
  smallButton(shell.controls, "reset", () => band.reset());
  shell.slider({
    label: "tempo",
    min: 70,
    max: 140,
    step: 1,
    value: band.clock.bpm,
    format: (v) => `${Math.round(v)} bpm`,
    onInput: (v) => band.clock.setBpm(v),
  });

  shell.setInfo(() => {
    const k = band.ear.key;
    const nps = band.notesPerSecond().toFixed(1);
    const key = k ? `${keyName(k)} (r = ${band.ear.conf().toFixed(2)})` : "listening…";
    return `${key} · you: ${nps} notes/s → band: ${band.resolved} · Z/X shift octave`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      if (ghost.enabled && !band.clock.isRunning) band.start();
      band.update();
      const now = pageNow();
      const W = shell.canvas.width;
      const H = shell.canvas.height;
      const s = ui(shell.canvas);

      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);
      drawRoll(g, band, 0, 0, W, H, s, { lo: 36, hi: 88, past: 7.5, future: 2.2, showDrums: true, showSpans: true });

      // top-right: the chord, big
      const k = band.ear.key;
      g.textAlign = "right";
      if (k && band.chord) {
        g.fillStyle = "rgba(255,206,150,0.96)";
        g.shadowColor = "rgba(255,184,107,0.6)";
        g.shadowBlur = 14 * s;
        g.font = font(26 * s, 750);
        g.fillText(band.chordLabel().split(" · ")[0], W - 14 * s, 34 * s);
        g.shadowBlur = 0;
        g.font = font(12 * s, 600, true);
        g.fillStyle = "rgba(255,206,150,0.7)";
        g.fillText(band.chordLabel().split(" · ")[1] + ` in ${keyName(k)}`, W - 14 * s, 52 * s);
      } else {
        g.fillStyle = "rgba(190,200,235,0.7)";
        g.font = font(14 * s, 600);
        g.fillText(soundOn ? "play a few notes…" : "", W - 14 * s, 30 * s);
      }

      // bottom-right: the density seesaw
      const nps = band.notesPerSecond(now);
      const bx = W - 170 * s;
      const by = H - 40 * s;
      g.fillStyle = "rgba(9,10,16,0.7)";
      roundRect(g, bx - 10 * s, by - 18 * s, 166 * s, 46 * s, 8 * s);
      g.fill();
      g.textAlign = "left";
      g.font = font(10 * s, 600);
      g.fillStyle = C.muted;
      g.fillText("you play →", bx, by - 4 * s);
      const meterW = 146 * s;
      g.fillStyle = "rgba(122,162,255,0.15)";
      g.fillRect(bx, by + 2 * s, meterW, 5 * s);
      const tick = (v: number): number => bx + Math.min(1, v / 4) * meterW;
      g.fillStyle = "rgba(200,210,240,0.35)";
      g.fillRect(tick(0.7), by, s, 9 * s);
      g.fillRect(tick(2.6), by, s, 9 * s);
      g.fillStyle = rgba(C.you, 0.95);
      g.fillRect(bx, by + 2 * s, Math.min(1, nps / 4) * meterW, 5 * s);
      g.font = font(10 * s, 600);
      const labels: [string, number][] = [
        ["fill", 0.35],
        ["comp", 1.65],
        ["hold", 3.3],
      ];
      for (const [name, v] of labels) {
        g.fillStyle = band.resolved === name ? rgba(C.comp, 1) : "rgba(170,180,210,0.5)";
        g.textAlign = "center";
        g.fillText(name, tick(v), by + 21 * s);
      }
      g.textAlign = "left";

      // the on-screen keys show you, the band's chord, and the bass
      const you = [...band.ear.held.keys()];
      const bandNow = band.band.filter((n) => !n.cancelled && n.kind !== "drum" && n.t <= now && now < n.t + n.dur);
      const bassNow = bandNow.find((n) => n.kind === "bass");
      piano.light(
        you,
        bandNow.filter((n) => n.kind !== "bass").map((n) => n.midi),
        bassNow ? bassNow.midi + 12 : -1,
      );
    },
    dispose() {
      band.stop();
      voices?.dispose();
    },
  };
}
