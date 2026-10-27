// Run Krumhansl and Kessler's probe-tone test on yourself. A cadence sets up
// a key, then one probe note plays, and you rate how well it fit, 1 to 7. All
// twelve pitch classes, in random order. Like the original study, every sound
// is a Shepard tone (octaves under a bell-shaped curve), so you judge the note
// name and not how high it is. Your profile is drawn over theirs.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { pageNow, toAudioTime } from "./clock";
import { C, font, rgba, roundRect, ui } from "./draw";
import { ShepardVoice } from "./instruments";
import { KK_MAJOR, KK_MINOR, correlate } from "./theory";
import { playGate, segmented, smallButton, stage } from "./ui";

type Mode = "major" | "minor";
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const CADENCE: Record<Mode, number[][]> = {
  major: [[0, 4, 7], [5, 9, 0], [7, 11, 2], [0, 4, 7]],
  minor: [[0, 3, 7], [5, 8, 0], [7, 11, 2], [0, 3, 7]],
};
const CHORD_LABELS: Record<Mode, string[]> = { major: ["I", "IV", "V", "I"], minor: ["i", "iv", "V", "i"] };
const CH = 0.62; // seconds per context chord
const GAP = 0.45; // silence before the probe
const PROBE = 1.1;

function shuffled(): number[] {
  const a = [...Array(12).keys()];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function mountProbeTest(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const g = shell.canvas.getContext("2d")!;
  const wrap = stage(shell);
  let voice: ShepardVoice | null = null;
  let mode: Mode = "major";
  let order = shuffled();
  let trial = 0;
  let ratings: (number | null)[] = new Array(12).fill(null);
  let phase: "idle" | "playing" | "rate" | "done" = "idle";
  let trialStart = 0; // page time the current trial's first chord sounds
  let timers: number[] = [];

  const clearTimers = (): void => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };

  const playTrial = (): void => {
    if (!voice) voice = new ShepardVoice();
    clearTimers();
    voice.hush();
    phase = "playing";
    syncRate();
    const t0 = pageNow() + 0.15;
    trialStart = t0;
    CADENCE[mode].forEach((pcs, i) => voice!.play(pcs, CH * 0.92, toAudioTime(t0 + i * CH), 0.62));
    const tp = t0 + 4 * CH + GAP;
    voice.play([order[trial]], PROBE, toAudioTime(tp), 0.8);
    timers.push(
      window.setTimeout(() => {
        phase = "rate";
        syncRate();
      }, (tp - pageNow()) * 1000),
    );
  };

  const gate = playGate(wrap, "Tap to start the test", "twelve short questions, about a minute", () => {
    if (phase === "done") restart();
    playTrial();
  });

  const restart = (): void => {
    order = shuffled();
    trial = 0;
    ratings = new Array(12).fill(null);
    phase = "idle";
  };

  // ---- controls: the rating row ----
  const row = document.createElement("div");
  row.className = "mp-rate";
  const lab = document.createElement("span");
  lab.className = "mp-rate-label";
  lab.textContent = "How well did the last note fit?";
  row.appendChild(lab);
  const lo = document.createElement("span");
  lo.className = "mp-rate-ends";
  lo.textContent = "badly";
  row.appendChild(lo);
  const rateBtns: HTMLButtonElement[] = [];
  for (let v = 1; v <= 7; v++) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = String(v);
    b.addEventListener("click", () => rate(v));
    row.appendChild(b);
    rateBtns.push(b);
  }
  const hi = document.createElement("span");
  hi.className = "mp-rate-ends";
  hi.textContent = "well";
  row.appendChild(hi);
  shell.controls.appendChild(row);
  const brk = document.createElement("span");
  brk.className = "mp-break";
  shell.controls.appendChild(brk);
  const syncRate = (): void => {
    for (const b of rateBtns) b.disabled = phase !== "rate";
  };
  syncRate();

  const rate = (v: number): void => {
    if (phase !== "rate") return;
    ratings[order[trial]] = v;
    trial++;
    if (trial >= 12) {
      phase = "done";
      voice?.hush();
      syncRate();
      return;
    }
    phase = "playing";
    syncRate();
    timers.push(window.setTimeout(playTrial, 450));
  };

  smallButton(shell.controls, "↻ replay this one", () => {
    if (phase === "playing" || phase === "rate") playTrial();
  });
  segmented<Mode>(shell.controls, "context", ["major", "minor"], mode, (v) => {
    mode = v;
    clearTimers();
    voice?.hush();
    restart();
    if (gate.open) playTrial();
  });
  smallButton(shell.controls, "start over", () => {
    clearTimers();
    voice?.hush();
    restart();
    if (gate.open) playTrial();
    else gate.show("Tap to start the test");
  });

  const guard = frameGuard(() => {
    if (!gate.open) return;
    clearTimers();
    voice?.hush();
    if (phase === "playing" || phase === "rate") {
      phase = "idle";
      syncRate();
      gate.show("Tap to resume");
    } else gate.show(phase === "done" ? "Tap to try again" : "Tap to start the test");
  });

  const profile = (): number[] => (mode === "major" ? KK_MAJOR : KK_MINOR);
  shell.setInfo(() => {
    const done = ratings.filter((r) => r !== null).length;
    if (phase === "done") {
      const r = correlate(ratings.map((x) => x ?? 0), profile(), 0);
      return `done · your ratings vs Krumhansl & Kessler's ${mode} profile: r = ${r.toFixed(2)}`;
    }
    return `${done} of 12 rated · context: ${CHORD_LABELS[mode].join("–")} in C ${mode}`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      const W = shell.canvas.width;
      const H = shell.canvas.height;
      const s = ui(shell.canvas);
      const now = pageNow();
      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);

      // ---- the trial strip: four context chords, then the probe ----
      const sx = 18 * s;
      const sy = 16 * s;
      const bw = 44 * s;
      const bh = 26 * s;
      const labels = [...CHORD_LABELS[mode], "?"];
      labels.forEach((l, i) => {
        const x = sx + i * (bw + 6 * s) + (i === 4 ? 12 * s : 0);
        const t0 = trialStart + (i < 4 ? i * CH : 4 * CH + GAP);
        const dur = i < 4 ? CH : PROBE;
        const live = (phase === "playing" || phase === "rate") && now >= t0 && now < t0 + dur;
        g.fillStyle = live ? rgba(i === 4 ? C.comp : C.accent, 0.5) : "rgba(122,162,255,0.07)";
        roundRect(g, x, sy, bw, bh, 6 * s);
        g.fill();
        g.strokeStyle = rgba(i === 4 ? C.comp : C.accent, live ? 0.9 : 0.25);
        g.lineWidth = s;
        g.stroke();
        g.fillStyle = live ? "#fff" : "rgba(200,210,240,0.6)";
        g.font = font(12 * s, 650);
        g.textAlign = "center";
        g.fillText(l, x + bw / 2, sy + bh * 0.68);
      });
      g.textAlign = "left";
      const msg =
        phase === "idle"
          ? "Each question: a cadence in C, then one note. Rate the note."
          : phase === "playing"
            ? `Question ${trial + 1} of 12 · listen…`
            : phase === "rate"
              ? `Question ${trial + 1} of 12 · how well did that note fit?`
              : "Your profile (amber) against the one measured in 1982 (blue).";
      g.fillStyle = "rgba(220,226,245,0.85)";
      g.font = font(13 * s, 600);
      g.fillText(msg, sx + 5 * (bw + 6 * s) + 26 * s, sy + bh * 0.68);

      // ---- bars: the published profile, and yours ----
      const px = 40 * s;
      const py = sy + bh + 34 * s;
      const pw = W - px - 18 * s;
      const ph = H - py - 34 * s;
      const colW = pw / 12;
      const yOf = (v: number): number => py + ph - ((v - 1) / 6) * ph;
      g.strokeStyle = "rgba(170,180,220,0.1)";
      g.fillStyle = "rgba(170,180,220,0.5)";
      g.font = font(10 * s, 500, true);
      g.lineWidth = s;
      for (let v = 1; v <= 7; v++) {
        const y = yOf(v);
        g.beginPath();
        g.moveTo(px, y);
        g.lineTo(px + pw, y);
        g.stroke();
        g.fillText(String(v), px - 16 * s, y + 4 * s);
      }
      const prof = profile();
      const probeNow = phase === "playing" || phase === "rate" ? order[trial] : -1;
      for (let pc = 0; pc < 12; pc++) {
        const x = px + pc * colW;
        const cx = x + colW / 2;
        // published profile: an outlined bar
        g.strokeStyle = rgba(C.accent, 0.75);
        g.fillStyle = rgba(C.accent, 0.12);
        roundRect(g, x + colW * 0.16, yOf(prof[pc]), colW * 0.68, ph - (yOf(prof[pc]) - py), 4 * s);
        g.fill();
        g.stroke();
        // yours
        const r = ratings[pc];
        if (r !== null) {
          g.fillStyle = rgba(C.comp, 0.95);
          g.shadowColor = rgba(C.comp, 0.8);
          g.shadowBlur = 10 * s;
          g.beginPath();
          g.arc(cx, yOf(r), 6.5 * s, 0, Math.PI * 2);
          g.fill();
          g.shadowBlur = 0;
        }
        if (pc === probeNow && phase === "rate") {
          g.strokeStyle = rgba(C.comp, 0.7);
          g.setLineDash([4 * s, 4 * s]);
          g.strokeRect(x + 2 * s, py - 6 * s, colW - 4 * s, ph + 6 * s);
          g.setLineDash([]);
        }
        g.fillStyle = [0, 2, 4, 5, 7, 9, 11].includes(pc) ? "rgba(225,232,250,0.9)" : "rgba(170,180,210,0.6)";
        g.font = font(11 * s, 650);
        g.textAlign = "center";
        g.fillText(mode === "minor" && pc === 3 ? "E♭" : NAMES[pc], cx, py + ph + 18 * s);
      }
      g.textAlign = "left";
      // connect your dots
      g.strokeStyle = rgba(C.comp, 0.55);
      g.lineWidth = 1.5 * s;
      g.beginPath();
      let started = false;
      for (let pc = 0; pc < 12; pc++) {
        const r = ratings[pc];
        if (r === null) {
          started = false;
          continue;
        }
        const x = px + pc * colW + colW / 2;
        if (!started) g.moveTo(x, yOf(r));
        else g.lineTo(x, yOf(r));
        started = true;
      }
      g.stroke();

      if (phase === "done") {
        const r = correlate(ratings.map((x) => x ?? 0), prof, 0);
        g.fillStyle = "rgba(9,10,16,0.78)";
        roundRect(g, W - 230 * s, py - 4 * s, 212 * s, 48 * s, 8 * s);
        g.fill();
        g.fillStyle = rgba(C.comp, 1);
        g.font = font(20 * s, 750);
        g.fillText(`r = ${r.toFixed(2)}`, W - 216 * s, py + 22 * s);
        g.fillStyle = "rgba(220,226,245,0.75)";
        g.font = font(11 * s, 600);
        g.fillText("correlation with the 1982 profile", W - 216 * s, py + 37 * s);
      }
    },
    dispose() {
      clearTimers();
      voice?.dispose();
    },
  };
}
