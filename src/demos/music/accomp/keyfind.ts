// Key finding, live. Left: the ear's fading histogram of pitch classes and
// the winning key's profile, both drawn as distance from their own average,
// so the correlation is "how often the bars and the dots point the same way".
// Right: all 24 keys scored, majors on top, minors below, in circle-of-fifths
// order. Play, or let one of the tunes play into it.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { pageNow, toAudioTime } from "./clock";
import { C, font, rgba, roundRect, ui } from "./draw";
import { KeyEar } from "./ear";
import { LeadVoice } from "./instruments";
import { TouchPiano, onOctave, qwertyBase, registerSink } from "./input";
import { FIFTHS, KK_MAJOR, KK_MINOR, keyIndex, keyName, keyOf, keyShort, spell } from "./theory";
import { playGate, smallButton, stage } from "./ui";

type Tune = { name: string; bpm: number; notes: [number, number][] }; // [midi or -1 rest, beats]

const TUNES: Tune[] = [
  {
    // "Twinkle, Twinkle, Little Star" (traditional): never plays a B or a B♭
    name: "Twinkle (C major)",
    bpm: 132,
    notes: [
      [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
      [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
      [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
      [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
      [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
      [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
    ],
  },
  {
    // a short tune of mine in A minor, with the raised seventh (G♯) at cadences
    name: "a tune in A minor",
    bpm: 120,
    notes: [
      [69, 1], [72, 1], [76, 1.5], [74, 0.5], [72, 1], [71, 1], [69, 2],
      [64, 1], [69, 1], [71, 1], [72, 1], [71, 1.5], [69, 0.5], [68, 2],
      [69, 1], [72, 1], [76, 1], [77, 1], [76, 1], [74, 1], [72, 1], [71, 1],
      [72, 1], [71, 1], [69, 1], [68, 1], [69, 3], [-1, 1],
    ],
  },
  {
    // a phrase of mine in C major, then the same phrase twice in E♭ major
    name: "C major, then E♭ major",
    bpm: 132,
    notes: [
      [60, 1], [64, 1], [67, 1], [72, 1], [71, 1], [67, 1], [65, 1], [62, 1],
      [64, 1], [65, 1], [67, 1], [69, 1], [67, 1], [65, 1], [64, 1], [60, 1],
      [62, 1], [67, 1], [71, 1], [74, 1], [72, 2], [60, 2],
      ...[0, 1].flatMap((): [number, number][] => [
        [63, 1], [67, 1], [70, 1], [75, 1], [74, 1], [70, 1], [68, 1], [65, 1],
        [67, 1], [68, 1], [70, 1], [72, 1], [70, 1], [68, 1], [67, 1], [63, 1],
        [65, 1], [70, 1], [74, 1], [77, 1], [75, 2], [63, 2],
      ]),
    ],
  },
  {
    // all twelve pitch classes at once: a flat histogram
    name: "all twelve notes at once",
    bpm: 60,
    notes: [],
  },
];

// Run a tune through an ear instantly, in simulated time, so the figure has
// something to show before anyone presses play.
function simulate(ear: KeyEar, tune: Tune): void {
  const beat = 60 / tune.bpm;
  const ev: [number, number, boolean][] = [];
  let t = 0;
  for (const [m, b] of tune.notes) {
    if (m >= 0) ev.push([t, m, true], [t + b * beat * 0.9, m, false]);
    t += b * beat;
  }
  ev.sort((a, b) => a[0] - b[0]);
  let i = 0;
  for (let time = 0; time <= t; time += 1 / 30) {
    while (i < ev.length && ev[i][0] <= time) {
      const [, m, on] = ev[i++];
      if (on) ear.noteOn(m);
      else ear.noteOff(m);
    }
    ear.update(1 / 30);
  }
  for (const m of [...ear.held.keys()]) ear.noteOff(m);
}

export function mountKeyFinder(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.52);
  const g = shell.canvas.getContext("2d")!;
  const wrap = stage(shell);
  const ear = new KeyEar();
  // until the reader starts it, the figure shows Twinkle's notes, frozen
  simulate(ear, TUNES[0]);
  let frozen = true;
  let voice: LeadVoice | null = null;
  let soundOn = false;
  let timers: number[] = [];
  let playing = -1;

  const turnOn = (): void => {
    if (!voice) voice = new LeadVoice();
    voice.fadeTo(1, 0.1);
    soundOn = true;
    frozen = false;
  };
  const gate = playGate(wrap, "Tap to listen", "then play, or pick a tune below", turnOn);

  const stopTune = (): void => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    for (const m of [...ear.held.keys()]) ear.noteOff(m);
    voice?.hush();
    playing = -1;
  };

  const playTune = (i: number): void => {
    stopTune();
    if (!soundOn) gate.el.click();
    const tune = TUNES[i];
    playing = i;
    ear.reset();
    if (!tune.notes.length) {
      const at = pageNow() + 0.1;
      for (let m = 60; m < 72; m++) {
        voice?.note(m, 1.6, toAudioTime(at), 0.32);
        ear.noteOn(m);
        timers.push(window.setTimeout(() => ear.noteOff(m), 1700));
      }
      timers.push(window.setTimeout(() => (playing = -1), 1800));
      return;
    }
    const beat = 60 / tune.bpm;
    let t = pageNow() + 0.2;
    const now = pageNow();
    for (const [m, b] of tune.notes) {
      const dur = b * beat;
      if (m >= 0) {
        const at = t;
        timers.push(
          window.setTimeout(() => {
            voice?.note(m, dur * 0.9, toAudioTime(at), 0.7);
            ear.noteOn(m);
          }, Math.max(0, (at - now - 0.05) * 1000)),
        );
        timers.push(window.setTimeout(() => ear.noteOff(m), (at + dur * 0.9 - now) * 1000));
      }
      t += dur;
    }
    timers.push(window.setTimeout(() => (playing = -1), (t - now) * 1000));
  };

  const piano = new TouchPiano(
    48,
    84,
    (m) => {
      if (!soundOn) gate.el.click();
      voice?.on(m, 0.72);
      ear.noteOn(m);
    },
    (m) => {
      voice?.off(m);
      ear.noteOff(m);
    },
  );
  piano.setCaps(qwertyBase());
  onOctave((b) => piano.setCaps(b));
  wrap.after(piano.el);
  registerSink({
    el: container,
    armed: () => soundOn,
    noteOn: (m, v) => {
      if (playing >= 0) stopTune();
      voice?.on(m, v);
      ear.noteOn(m);
    },
    noteOff: (m) => {
      voice?.off(m);
      ear.noteOff(m);
    },
  });

  const tuneBtns = TUNES.map((t, i) => smallButton(shell.controls, `▶ ${t.name}`, () => playTune(i)));
  smallButton(shell.controls, "clear memory", () => {
    stopTune();
    ear.reset();
  });
  const brk = document.createElement("span");
  brk.className = "mp-break";
  shell.controls.appendChild(brk);
  shell.slider({
    label: "memory half-life",
    min: 1,
    max: 20,
    step: 0.5,
    value: ear.halfLife,
    format: (v) => `${v.toFixed(1)} s`,
    onInput: (v) => (ear.halfLife = v),
  });

  const guard = frameGuard(() => {
    if (!soundOn) return;
    stopTune();
    soundOn = false;
    voice?.fadeTo(0, 0.1);
    gate.show("Tap to resume");
  });

  shell.setInfo(() => {
    if (ear.keyIdx < 0) return "no key yet: play a few notes";
    const sorted = [...ear.scores.keys()].sort((a, b) => ear.scores[b] - ear.scores[a]);
    const k = ear.key!;
    const second = sorted.find((i) => i !== ear.keyIdx)!;
    return `${keyName(k)} r = ${ear.scores[ear.keyIdx].toFixed(2)} · runner-up ${keyName(keyOf(second))} ${ear.scores[second].toFixed(2)}`;
  });

  let last = pageNow();
  const shown = new Float32Array(24);

  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = pageNow();
      if (!frozen) ear.update(Math.min(0.1, now - last));
      last = now;
      for (const [i, b] of tuneBtns.entries()) b.classList.toggle("is-on", i === playing);
      for (let i = 0; i < 24; i++) shown[i] += (ear.scores[i] - shown[i]) * 0.15;

      const W = shell.canvas.width;
      const H = shell.canvas.height;
      const s = ui(shell.canvas);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);
      const narrow = W / s < 560;

      // ---- left: histogram vs profile, as deviations from their means ----
      const lx = 16 * s;
      const ly = 40 * s;
      const lw = narrow ? W - 32 * s : W * 0.5;
      const lh = narrow ? H * 0.46 : H - ly - 30 * s;
      const mid = ly + lh * 0.55;
      const colW = lw / 12;
      const best = ear.keyIdx >= 0 ? keyOf(ear.keyIdx) : null;
      g.font = font(12 * s, 650);
      g.fillStyle = "rgba(220,226,245,0.85)";
      g.fillText(frozen ? "what the ear remembers after Twinkle" : "what the ear remembers", lx, 22 * s);
      if (best) {
        g.fillStyle = rgba(C.accent, 0.95);
        const head = frozen ? "what the ear remembers after Twinkle " : "what the ear remembers ";
        g.fillText(`· ${keyName(best)} profile`, lx + g.measureText(head).width, 22 * s);
      }
      let mh = 0;
      for (let i = 0; i < 12; i++) mh += ear.hist[i];
      mh /= 12;
      let sh = 0;
      for (let i = 0; i < 12; i++) sh += (ear.hist[i] - mh) ** 2;
      sh = Math.sqrt(sh / 12) || 1;
      const prof = best ? (best.minor ? KK_MINOR : KK_MAJOR) : null;
      let mp = 0;
      let sp = 1;
      if (prof) {
        mp = prof.reduce((a, b) => a + b, 0) / 12;
        sp = Math.sqrt(prof.reduce((a, b) => a + (b - mp) ** 2, 0) / 12);
      }
      const unit = lh * 0.2; // one standard deviation
      g.fillStyle = "rgba(170,180,220,0.25)";
      g.fillRect(lx, mid, lw, Math.max(1, s));
      const held = new Set([...ear.held.keys()].map((m) => ((m % 12) + 12) % 12));
      for (let pc = 0; pc < 12; pc++) {
        const x = lx + pc * colW;
        const z = ear.total() > 0.05 ? (ear.hist[pc] - mh) / sh : 0;
        const y = mid - Math.max(-2.2, Math.min(2.6, z)) * unit;
        const lit = held.has(pc);
        g.fillStyle = lit ? rgba(C.you, 0.95) : rgba(C.you, 0.5);
        if (lit) {
          g.shadowColor = rgba(C.you, 0.8);
          g.shadowBlur = 10 * s;
        }
        g.fillRect(x + colW * 0.18, Math.min(y, mid), colW * 0.64, Math.abs(mid - y));
        g.shadowBlur = 0;
        if (prof && best) {
          const zp = (prof[(pc - best.root + 12) % 12] - mp) / sp;
          const yp = mid - zp * unit;
          g.fillStyle = rgba(C.accent, 1);
          g.beginPath();
          g.arc(x + colW / 2, yp, 4.5 * s, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = lit ? "#fff" : "rgba(200,210,240,0.7)";
        g.font = font(10.5 * s, 600);
        g.textAlign = "center";
        g.fillText(spell(pc, best), x + colW / 2, ly + lh + 14 * s);
        g.textAlign = "left";
      }
      if (prof && best) {
        g.strokeStyle = rgba(C.accent, 0.55);
        g.lineWidth = 1.5 * s;
        g.beginPath();
        for (let pc = 0; pc < 12; pc++) {
          const zp = (prof[(pc - best.root + 12) % 12] - mp) / sp;
          const x = lx + pc * colW + colW / 2;
          if (pc === 0) g.moveTo(x, mid - zp * unit);
          else g.lineTo(x, mid - zp * unit);
        }
        g.stroke();
      }

      // ---- right: all 24 keys ----
      const rx = narrow ? 16 * s : W * 0.56;
      const ry = narrow ? ly + lh + 40 * s : 40 * s;
      const rw = narrow ? W - 32 * s : W - rx - 16 * s;
      const cell = rw / 12;
      const rowH = Math.min(cell * 1.15, 44 * s);
      g.fillStyle = "rgba(220,226,245,0.85)";
      g.font = font(12 * s, 650);
      g.fillText("all 24 keys, scored", rx, ry - 18 * s);
      const ch = ear.challengeProgress();
      for (let row = 0; row < 2; row++) {
        for (let slot = 0; slot < 12; slot++) {
          const majorRoot = FIFTHS[slot];
          const k = row === 0 ? { root: majorRoot, minor: false } : { root: (majorRoot + 9) % 12, minor: true };
          const idx = keyIndex(k);
          const v = shown[idx];
          const b = Math.max(0, Math.min(1, (v - 0.1) / 0.8));
          const x = rx + slot * cell;
          const y = ry + row * (rowH + 6 * s);
          const isCur = idx === ear.keyIdx;
          g.fillStyle = isCur ? rgba(C.comp, 0.25 + b * 0.5) : rgba(C.accent, 0.04 + Math.pow(b, 1.5) * 0.55);
          if (isCur) {
            g.shadowColor = rgba(C.comp, 0.8);
            g.shadowBlur = 14 * s;
          }
          roundRect(g, x + 1.5 * s, y, cell - 3 * s, rowH, 5 * s);
          g.fill();
          g.shadowBlur = 0;
          if (idx === ch.idx && ch.t > 0) {
            g.fillStyle = rgba(C.answer, 0.85);
            g.fillRect(x + 1.5 * s, y + rowH - 3 * s, (cell - 3 * s) * ch.t, 3 * s);
          }
          g.textAlign = "center";
          g.fillStyle = isCur ? "#fff6ea" : `rgba(220,228,250,${0.4 + b * 0.6})`;
          g.font = font(Math.min(12 * s, cell * 0.3), 700);
          g.fillText(keyShort(k), x + cell / 2, y + rowH * 0.45);
          g.font = font(Math.min(9.5 * s, cell * 0.24), 500, true);
          g.fillStyle = `rgba(200,210,240,${0.35 + b * 0.5})`;
          g.fillText(ear.total() > 1 ? v.toFixed(2).replace("0.", ".") : "", x + cell / 2, y + rowH * 0.8);
          g.textAlign = "left";
        }
      }
      // the readout under the grid
      const ty = ry + 2 * (rowH + 6 * s) + 24 * s;
      if (best) {
        g.fillStyle = "#f4f6ff";
        g.font = font(22 * s, 750);
        g.fillText(keyName(best), rx, ty + 6 * s);
        g.fillStyle = rgba(C.comp, 0.9);
        g.font = font(12 * s, 600, true);
        g.fillText(`r = ${ear.scores[ear.keyIdx].toFixed(2)}`, rx, ty + 26 * s);
        if (ch.idx >= 0 && ch.t > 0) {
          g.fillStyle = rgba(C.answer, 0.9);
          g.fillText(`${keyName(keyOf(ch.idx))} is catching up…`, rx + 90 * s, ty + 26 * s);
        }
      } else {
        g.fillStyle = "rgba(200,210,240,0.6)";
        g.font = font(14 * s, 600);
        g.fillText(ear.total() > 1.2 ? "no key stands out" : "listening…", rx, ty + 6 * s);
      }
    },
    dispose() {
      stopTune();
      voice?.dispose();
    },
  };
}
