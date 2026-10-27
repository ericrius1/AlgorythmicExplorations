// Fig. 1 of Part 5: a scale is a step pattern. Twelve positions round a
// ring, the scale's notes lit, the gaps between them labelled in semitones
// (whole steps cool, half steps hot, wider gaps violet). "Rotate" starts the
// same pattern from its next note while C stays home, which is how one
// pattern gives seven modes. A drone on C makes the change audible.

import { Shell, type Demo } from "../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../lib/audio";
import { PC_NAMES, mod } from "./tuning/theory";
import { COL, Surface, approach, clock, clockArc, dot, glow, glowStroke, hex, mixRgb, pcColor, rgba, text, type RGB } from "./tuning/draw";
import { Sound, type Held } from "./tuning/sound";
import { button, chips, tapBadge, toggle } from "./tuning/ui";

interface Pattern {
  id: string;
  name: string;
  steps: number[]; // semitone gaps, summing to 12
  modeNames?: string[];
}

const PATTERNS: Pattern[] = [
  {
    id: "diatonic",
    name: "major (diatonic)",
    steps: [2, 2, 1, 2, 2, 2, 1],
    modeNames: ["Ionian (major)", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian (natural minor)", "Locrian"],
  },
  { id: "penta", name: "pentatonic", steps: [2, 2, 3, 2, 3], modeNames: ["major pentatonic", "rotation 2", "rotation 3", "rotation 4", "minor pentatonic"] },
  {
    id: "harmonic",
    name: "harmonic minor",
    steps: [2, 1, 2, 2, 1, 3, 1],
    modeNames: ["harmonic minor", "Locrian ♮6", "Ionian ♯5", "Dorian ♯4", "Phrygian dominant", "Lydian ♯2", "altered 𝄫7"],
  },
  {
    id: "melodic",
    name: "melodic minor",
    steps: [2, 1, 2, 2, 2, 2, 1],
    modeNames: ["melodic minor", "Dorian ♭2", "Lydian augmented", "Lydian dominant", "Mixolydian ♭6", "Locrian ♮2", "altered"],
  },
  { id: "whole", name: "whole tone", steps: [2, 2, 2, 2, 2, 2] },
  { id: "octa", name: "octatonic", steps: [2, 1, 2, 1, 2, 1, 2, 1], modeNames: ["whole–half", "half–whole"] },
];

const STEP_COL = (g: number): RGB => (g === 1 ? hex("#ff8a5c") : g === 2 ? hex("#5fd3c4") : hex("#b48cff"));
const STEP_NAME = (g: number): string => (g === 1 ? "H" : g === 2 ? "W" : g === 3 ? "W+H" : `${g}`);

export interface ScaleRingOpts {
  mode?: "hero" | "lab";
}

export function mountScaleRing(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.08 : 0.56));
  const sound = new Sound({ level: 1, reverb: 0.15 });
  const badge = tapBadge(container, "tap for sound");

  let pat = PATTERNS[0];
  let rot = 0;
  let drone: Held | null = null;
  let queue: { at: number; pc: number }[] = [];
  const beadOn = new Array(12).fill(0);
  const flash = new Array(12).fill(0);

  const pcs = (): number[] => {
    const n = pat.steps.length;
    const out = [0];
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      acc += pat.steps[(rot + i) % n];
      out.push(acc);
    }
    return out;
  };
  const gaps = (): number[] => {
    const n = pat.steps.length;
    return Array.from({ length: n }, (_, i) => pat.steps[(rot + i) % n]);
  };
  const modeName = (): string => (pat.modeNames ? pat.modeNames[rot % pat.modeNames.length] : pat.name);

  const stopDrone = (): void => {
    drone?.release(0.5);
    drone = null;
    droneBtn.set(false);
  };
  const silence = (): void => {
    stopDrone();
    sound.silence();
    queue = [];
  };
  const guard = frameGuard(silence);

  const playSeq = (notes: number[], step: number): void => {
    const t0 = sound.now() + 0.05;
    sound.silence(0.03);
    queue = notes.map((m, i) => ({ at: t0 + i * step, pc: mod(m, 12) }));
    notes.forEach((m, i) =>
      sound.note(261.6256 * Math.pow(2, m / 12), t0 + i * step, { vel: 0.62, dur: step * 3.2, timbre: "keys", bright: 0.45 }),
    );
  };
  const go = (fn: () => void): void => {
    badge.hide();
    void unlockAudio().then(fn);
  };
  const playScale = (): void => {
    const s = pcs();
    playSeq([...s, 12, ...[...s].reverse()], 0.26);
  };
  // a short tune written in scale degrees, so it takes on each mode's colour
  const TUNE = [0, 2, 4, 7, 6, 4, 5, 3, 4, 2, 1, 0];
  const playTune = (): void => {
    const s = pcs();
    const n = s.length;
    playSeq(
      TUNE.map((d) => s[mod(d, n)] + 12 * Math.floor(d / n)),
      0.25,
    );
  };

  const patChips = chips(shell.controls, {
    label: "pattern",
    options: PATTERNS.map((p) => ({ value: p.id, text: p.name })),
    value: pat.id,
    wide: true,
    onChange: (id) => {
      pat = PATTERNS.find((p) => p.id === id)!;
      rot = 0;
    },
  });
  void patChips;
  button(shell.controls, "rotate the pattern →", () => {
    rot = (rot + 1) % pat.steps.length;
    go(playScale);
  });
  button(shell.controls, "▶ scale", () => go(playScale));
  button(shell.controls, "▶ a tune", () => go(playTune));
  const droneBtn = toggle(shell.controls, ["drone on C", "drone on"], (on) => {
    if (!on) {
      stopDrone();
      return;
    }
    go(() => {
      drone = sound.hold([65.41, 130.81], { timbre: "reed", level: 0.04, attack: 0.6, cutoff: 1500 });
    });
  });

  shell.setInfo(() => {
    const s = pcs();
    return `${modeName()} on C · ${s.map((pc) => PC_NAMES[pc]).join(" ")} · steps ${gaps().map(STEP_NAME).join(" ")}`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = pcs();
      for (let pc = 0; pc < 12; pc++) {
        beadOn[pc] = approach(beadOn[pc], s.includes(pc) ? 1 : 0, 9, dt);
        flash[pc] = approach(flash[pc], 0, 4, dt);
      }
      let comet = -1;
      if (sound.ready && queue.length) {
        const t = sound.now();
        for (const q of queue) {
          if (Math.abs(t - q.at) < 0.06) {
            comet = q.pc;
            flash[q.pc] = 1;
          }
        }
        queue = queue.filter((q) => q.at > t - 0.5);
      }

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const R = narrow ? Math.min(w * 0.36, h * 0.36) : Math.min(w * 0.22, h * 0.36);
      const cx = narrow ? w / 2 : w * 0.34;
      const cy = narrow ? h * 0.47 : h * 0.52;
      const fs = narrow ? 11 : 12.5;

      glow(ctx, cx, cy, R * 1.3, [40, 52, 96], 0.2);
      if (drone) glow(ctx, cx, cy, R * 0.45, hex("#ffb86b"), 0.18 + 0.05 * Math.sin(now / 400));

      // step arcs between consecutive notes, labelled
      const g = gaps();
      s.forEach((pc, i) => {
        const gap = g[i];
        const t0 = pc / 12 + 0.012;
        const t1 = (pc + gap) / 12 - 0.012;
        clockArc(ctx, cx, cy, R, t0, t1);
        const col = STEP_COL(gap);
        glowStroke(ctx, col, 0.8, gap === 1 ? 2.6 : 1.8);
        const [lx, ly] = clock(cx, cy, R * 0.8, (pc + gap / 2) / 12);
        text(ctx, STEP_NAME(gap), lx, ly, { size: fs * 0.9, color: rgba(mixRgb(col, [255, 255, 255], 0.3), 1), align: "center", base: "middle", weight: 700, mono: true });
      });

      // beads
      for (let pc = 0; pc < 12; pc++) {
        const [x, y] = clock(cx, cy, R, pc / 12);
        ctx.fillStyle = "rgba(120, 130, 170, 0.3)";
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        const on = beadOn[pc];
        const col = pc === 0 ? ([255, 214, 150] as RGB) : pcColor(pc);
        if (on > 0.02) dot(ctx, x, y, (5 + 3 * flash[pc]) * (0.4 + 0.6 * on), col, on, 3.4 + 3 * flash[pc]);
        if (comet === pc) glow(ctx, x, y, 28, [255, 240, 210], 0.6);
        const [lx, ly] = clock(cx, cy, R + fs * 1.6, pc / 12);
        text(ctx, PC_NAMES[pc], lx, ly, {
          size: fs,
          color: on > 0.5 ? rgba(mixRgb(col, [255, 255, 255], 0.5), 1) : COL.faint,
          align: "center",
          base: "middle",
          weight: on > 0.5 ? 700 : 500,
        });
      }
      text(ctx, "C stays home", cx, cy - R - fs * 3.1, { size: 10, color: COL.dim, align: "center" });

      // ---- side panel: the pattern as a strip of steps ----
      const px = narrow ? 18 : w * 0.62;
      const pw = narrow ? w - 36 : w * 0.34;
      let py = narrow ? cy + R + fs * 3.4 : h * 0.24;
      text(ctx, modeName(), px, py, { size: narrow ? 15 : 18, color: "#f4f6fc", weight: 700 });
      py += narrow ? 22 : 30;
      // strip: one cell per semitone, lit cells are scale notes
      const cell = pw / 12;
      for (let k = 0; k < 12; k++) {
        const lit = s.includes(k);
        ctx.fillStyle = lit ? rgba(k === 0 ? [255, 214, 150] : pcColor(k), 0.85) : "rgba(255, 255, 255, 0.05)";
        ctx.fillRect(px + k * cell + 1, py, cell - 2, 16);
        text(ctx, PC_NAMES[k], px + (k + 0.5) * cell, py + 30, { size: 9.5, color: lit ? COL.text : COL.faint, align: "center" });
      }
      py += 50;
      if (!narrow) {
        text(ctx, "steps", px, py, { size: 10.5, color: COL.dim });
        py += 18;
        let x = px;
        g.forEach((gap) => {
          const wdt = gap * cell;
          ctx.fillStyle = rgba(STEP_COL(gap), 0.25);
          ctx.fillRect(x + 1, py, wdt - 2, 18);
          text(ctx, STEP_NAME(gap), x + wdt / 2, py + 13, { size: 10, color: rgba(STEP_COL(gap), 1), align: "center", weight: 700, mono: true });
          x += wdt;
        });
        py += 40;
        const half = g.filter((x) => x === 1).length;
        // smallest rotation that maps the pattern onto itself
        const n = g.length;
        let period = n;
        for (let r = 1; r < n; r++) {
          if (n % r === 0 && g.every((x, i) => x === g[(i + r) % n])) {
            period = r;
            break;
          }
        }
        const repeatSemis = g.slice(0, period).reduce((a, b) => a + b, 0);
        const note =
          period === 1
            ? "every step the same: no landmarks to tell home from anywhere else"
            : period < n
              ? `the pattern repeats every ${repeatSemis} semitones, so home is ambiguous`
              : half === 0
                ? "no half steps: no two notes clash a semitone apart"
                : `${half} half step${half === 1 ? "" : "s"}, placed unevenly: every note has different neighbours`;
        // wrap to the panel width
        ctx.font = `500 11px ${"ui-sans-serif, system-ui, sans-serif"}`;
        let line = "";
        for (const word of note.split(" ")) {
          const tryLine = line ? `${line} ${word}` : word;
          if (ctx.measureText(tryLine).width > pw && line) {
            text(ctx, line, px, py, { size: 11, color: "#f0c08a" });
            py += 16;
            line = word;
          } else line = tryLine;
        }
        if (line) text(ctx, line, px, py, { size: 11, color: "#f0c08a" });
      }
    },
    dispose() {
      silence();
    },
  };
}
