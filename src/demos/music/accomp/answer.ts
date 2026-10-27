// Call and response on its own: no drums and only a held pad, so the answers
// are easy to hear. Play a phrase and stop; the vibraphone answers a bar
// later. Pick how it answers, or let it choose.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { Accompanist, type AnswerSetting } from "./band";
import { pageNow } from "./clock";
import { C, drawRoll, font, rgba, roundRect, ui } from "./draw";
import { ANSWER_MODES, IntervalHabits, makeAnswer, type AnswerNote } from "./responder";
import { BandVoices } from "./instruments";
import { TouchPiano, onOctave, qwertyBase, registerSink } from "./input";
import { playGate, segmented, smallButton, stage } from "./ui";

// Example calls: [midi, start step, length in steps]. Short phrases I wrote,
// one in C major and one in A minor.
const CALLS: { label: string; notes: [number, number, number][] }[] = [
  {
    label: "a phrase in C",
    notes: [[60, 0, 2], [64, 2, 2], [67, 4, 2], [64, 6, 2], [62, 8, 2], [65, 10, 2], [69, 12, 4]],
  },
  {
    label: "a phrase in A minor",
    notes: [[69, 0, 3], [71, 3, 1], [72, 4, 2], [76, 6, 2], [74, 8, 2], [72, 10, 2], [71, 12, 2], [68, 14, 2]],
  },
];

// The four kinds of answer to the first example call, worked out ahead of time
// for the figure's resting state. The call ends on D F A, so the chord is Dm.
function previewAnswers(): { label: string; notes: AnswerNote[] }[] {
  const key = { root: 0, minor: false };
  const chord = { root: 2, q: "min" as const };
  const call = CALLS[0].notes.map(([midi, step, dur]) => ({ midi, step, dur }));
  const habits = new IntervalHabits();
  call.forEach((n, i) => habits.observe(n.midi, key, i === 0));
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [{ label: "call", notes: call.map((n) => ({ midi: n.midi, offset: n.step, dur: n.dur })) }];
  for (const m of ANSWER_MODES) out.push({ label: m, notes: makeAnswer(call, key, chord, m, habits, rand) });
  return out;
}

export function mountAnswerFig(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.46);
  const g = shell.canvas.getContext("2d")!;
  const wrap = stage(shell);
  const band = new Accompanist(92);
  band.groove = false;
  band.style = "hold";
  band.answers = "auto";
  let voices: BandVoices | null = null;
  let soundOn = false;
  let timers: number[] = [];
  const preview = previewAnswers();

  const turnOn = (): void => {
    if (!voices) voices = new BandVoices();
    voices.fader.gain.value = 0;
    voices.fadeTo(1, 0.2);
    band.attachVoices(voices);
    soundOn = true;
  };
  const gate = playGate(wrap, "Tap to play", "play a phrase, then stop and listen", turnOn);

  const piano = new TouchPiano(
    55,
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

  segmented<AnswerSetting>(
    shell.controls,
    "answer by",
    ["auto", "echo", "mirror", "sequence", "riff"],
    "auto",
    (v) => (band.answers = v),
  );
  const brk = document.createElement("span");
  brk.className = "mp-break";
  shell.controls.appendChild(brk);
  for (const call of CALLS) {
    smallButton(shell.controls, `▶ ${call.label}`, () => {
      if (!soundOn) gate.el.click();
      for (const t of timers) clearTimeout(t);
      timers = [];
      if (!band.clock.isRunning) band.start();
      // start on the next bar line so the call sits on the grid
      const next = band.clock.nextStep <= 1 ? 4 : Math.ceil((band.clock.nextStep + 2) / 16) * 16;
      for (const [m, st, len] of call.notes) {
        const t = band.clock.timeOf(next + st) + band.clock.swingOf(next + st);
        band.ghostNote(m, t, len * band.clock.stepDur * 0.92, 0.72);
      }
    });
  }
  smallButton(shell.controls, "reset", () => band.reset());

  const guard = frameGuard(() => {
    if (!soundOn) return;
    for (const t of timers) clearTimeout(t);
    soundOn = false;
    band.stop();
    band.voices = null;
    voices?.fadeTo(0, 0.15);
    gate.show("Tap to resume");
  });

  shell.setInfo(() => {
    const sp = band.spans[band.spans.length - 1];
    const k = band.ear.key;
    const last = sp ? `last answer: ${sp.mode}` : "no answer yet";
    return `${k ? band.chordLabel() : "listening…"} · ${last} · the habits table has ${band.habits.total} moves`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      band.update();
      const W = shell.canvas.width;
      const H = shell.canvas.height;
      const s = ui(shell.canvas);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);
      drawRoll(g, band, 0, 0, W, H, s, { lo: 50, hi: 88, past: 7, future: 3.2, showDrums: false, showSpans: true });
      if (!band.player.length) {
        // resting state: one call and its four possible answers
        g.fillStyle = "rgba(9,10,16,0.82)";
        g.fillRect(0, 0, W, H);
        let lo = 127;
        let hi = 0;
        for (const p of preview) for (const n of p.notes) {
          lo = Math.min(lo, n.midi);
          hi = Math.max(hi, n.midi);
        }
        lo -= 2;
        hi += 2;
        const pad = 14 * s;
        const pw = (W - pad * 6) / 5;
        const py = 46 * s;
        const ph = H - py - 34 * s;
        preview.forEach((p, i) => {
          const px = pad + i * (pw + pad);
          const col = i === 0 ? C.you : C.answer;
          g.fillStyle = "rgba(122,162,255,0.05)";
          roundRect(g, px, py, pw, ph, 8 * s);
          g.fill();
          g.fillStyle = rgba(col, 0.95);
          g.font = font(12 * s, 700);
          g.fillText(p.label, px + 2 * s, py - 10 * s);
          const span = 18;
          for (const n of p.notes) {
            const x = px + 6 * s + (n.offset / span) * (pw - 12 * s);
            const w = Math.max(3 * s, (n.dur / span) * (pw - 12 * s) - 2 * s);
            const y = py + ph - 8 * s - ((n.midi - lo) / (hi - lo)) * (ph - 16 * s);
            g.fillStyle = rgba(col, 0.9);
            roundRect(g, x, y - 3 * s, w, 6 * s, 2.5 * s);
            g.fill();
          }
        });
        g.fillStyle = "rgba(200,210,240,0.6)";
        g.font = font(11 * s, 600);
        g.textAlign = "center";
        g.fillText("one call (C E G E D F A) and the four ways the band can answer it over Dm", W / 2, H - 12 * s);
        g.textAlign = "left";
      }
      const now = pageNow();
      const you = [...band.ear.held.keys()];
      const vib = band.band.filter((n) => n.kind === "answer" && !n.cancelled && n.t <= now && now < n.t + n.dur);
      piano.light(you, vib.map((n) => n.midi));
    },
    dispose() {
      band.stop();
      voices?.dispose();
    },
  };
}
