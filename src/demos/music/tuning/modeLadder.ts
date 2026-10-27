// Fig. 2 of Part 5: the seven modes of the major scale, all on C, sorted
// from brightest to darkest. Each row is one mode; each column one of the
// twelve notes. Going down a row always lowers exactly one note by a
// semitone, drawn as a small slide. Click a row to hear it over a drone, or
// walk the whole ladder.

import { Shell, type Demo } from "../../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../../lib/audio";
import { PC_NAMES } from "./theory";
import { COL, Surface, approach, glow, hex, mixRgb, rgba, roundRect, text, type RGB } from "./draw";
import { Sound, type Held } from "./sound";
import { button, tapBadge, toggle } from "./ui";

const MODES: { name: string; pcs: number[]; formula: string; note: string }[] = [
  { name: "Lydian", pcs: [0, 2, 4, 6, 7, 9, 11], formula: "1 2 3 ♯4 5 6 7", note: "raised fourth" },
  { name: "Ionian", pcs: [0, 2, 4, 5, 7, 9, 11], formula: "1 2 3 4 5 6 7", note: "the major scale" },
  { name: "Mixolydian", pcs: [0, 2, 4, 5, 7, 9, 10], formula: "1 2 3 4 5 6 ♭7", note: "major with a flat seventh" },
  { name: "Dorian", pcs: [0, 2, 3, 5, 7, 9, 10], formula: "1 2 ♭3 4 5 6 ♭7", note: "minor with a raised sixth" },
  { name: "Aeolian", pcs: [0, 2, 3, 5, 7, 8, 10], formula: "1 2 ♭3 4 5 ♭6 ♭7", note: "the natural minor scale" },
  { name: "Phrygian", pcs: [0, 1, 3, 5, 7, 8, 10], formula: "1 ♭2 ♭3 4 5 ♭6 ♭7", note: "minor with a flat second" },
  { name: "Locrian", pcs: [0, 1, 3, 5, 6, 8, 10], formula: "1 ♭2 ♭3 4 ♭5 ♭6 ♭7", note: "even the fifth is flat" },
];

export function mountModeLadder(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.6);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.2 : 0.56));
  const sound = new Sound({ level: 1, reverb: 0.15 });
  const badge = tapBadge(container, "tap a row");

  let sel = 1;
  let drone: Held | null = null;
  let walk = 0;
  let queue: { at: number; row: number; pc: number }[] = [];
  const rowGlow = new Array(7).fill(0);
  const cellFlash: number[][] = MODES.map(() => new Array(13).fill(0));
  let geo = { top: 0, rowH: 1 };

  const stopWalk = (): void => {
    clearTimeout(walk);
    walk = 0;
  };
  const stopDrone = (): void => {
    drone?.release(0.5);
    drone = null;
    droneBtn.set(false);
  };
  const silence = (): void => {
    stopWalk();
    stopDrone();
    sound.silence();
    queue = [];
  };
  const guard = frameGuard(silence);

  const ensureDrone = (): void => {
    if (!drone) {
      drone = sound.hold([65.41, 130.81], { timbre: "reed", level: 0.035, attack: 0.5, cutoff: 1500 });
      droneBtn.set(true);
    }
  };

  const playRow = (row: number, t0: number, step = 0.2): number => {
    const pcs = [...MODES[row].pcs, 12];
    const seq = [...pcs, ...pcs.slice(0, -1).reverse()];
    seq.forEach((pc, i) => {
      const at = t0 + i * step;
      queue.push({ at, row, pc });
      sound.note(261.6256 * Math.pow(2, pc / 12), at, { vel: 0.6, dur: 0.75, timbre: "keys", bright: 0.45 });
    });
    return seq.length * step;
  };
  const go = (fn: () => void): void => {
    badge.hide();
    void unlockAudio().then(fn);
  };

  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    const row = Math.floor((p.y - geo.top) / geo.rowH);
    if (row < 0 || row >= 7) return;
    sel = row;
    rowGlow[row] = 1;
    go(() => {
      stopWalk();
      sound.silence(0.03);
      queue = [];
      ensureDrone();
      playRow(row, sound.now() + 0.05);
    });
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    const p = surf.local(e);
    const row = Math.floor((p.y - geo.top) / geo.rowH);
    shell.canvas.style.cursor = row >= 0 && row < 7 ? "pointer" : "default";
  });

  button(shell.controls, "▶ walk the ladder, bright to dark", () =>
    go(() => {
      silence();
      ensureDrone();
      let t = sound.now() + 0.1;
      for (let r = 0; r < 7; r++) {
        const dur = playRow(r, t, 0.17);
        const startMs = (t - sound.now()) * 1000;
        window.setTimeout(() => (sel = r), Math.max(0, startMs));
        t += dur + 0.35;
      }
      walk = window.setTimeout(() => (walk = 0), (t - sound.now()) * 1000);
    }),
  );
  const droneBtn = toggle(shell.controls, ["drone on C", "drone on"], (on) => {
    if (!on) stopDrone();
    else go(ensureDrone);
  });
  button(shell.controls, "■ stop", silence);

  shell.setInfo(() => {
    const m = MODES[sel];
    const prev = sel > 0 ? MODES[sel - 1] : null;
    let diff = "";
    if (prev) {
      const gone = prev.pcs.find((pc) => !m.pcs.includes(pc))!;
      const came = m.pcs.find((pc) => !prev.pcs.includes(pc))!;
      diff = ` · one step darker than ${prev.name}: ${PC_NAMES[gone]} → ${PC_NAMES[came]}`;
    }
    return `${m.name}: ${m.formula} (${m.note})${diff}`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (let r = 0; r < 7; r++) {
        rowGlow[r] = approach(rowGlow[r], r === sel ? 0.6 : 0, 5, dt);
        for (let k = 0; k < 13; k++) cellFlash[r][k] = approach(cellFlash[r][k], 0, 5, dt);
      }
      if (sound.ready && queue.length) {
        const t = sound.now();
        for (const q of queue) if (Math.abs(t - q.at) < 0.05) cellFlash[q.row][q.pc] = 1;
        queue = queue.filter((q) => q.at > t - 0.3);
      }

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const nameW = narrow ? 78 : 112;
      const rightW = narrow ? 0 : 150;
      const top = narrow ? 44 : 46;
      const bottom = h - (narrow ? 16 : 18);
      const rowH = (bottom - top) / 7;
      geo = { top, rowH };
      const gx0 = 14 + nameW;
      const gx1 = w - 14 - rightW;
      const cw = (gx1 - gx0) / 13;

      // column heads
      for (let k = 0; k <= 12; k++) {
        text(ctx, k === 12 ? "C" : PC_NAMES[k], gx0 + (k + 0.5) * cw, top - 12, {
          size: narrow ? 9.5 : 11,
          color: COL.dim,
          align: "center",
        });
      }
      text(ctx, "brighter", 14, top - 12, { size: 10, color: "#ffd9a0" });
      text(ctx, "darker", 14, bottom + 12, { size: 10, color: "#c4a8ff" });

      for (let r = 0; r < 7; r++) {
        const m = MODES[r];
        const y0 = top + r * rowH;
        const cy = y0 + rowH / 2;
        const tone: RGB = mixRgb([255, 196, 120], [160, 120, 255], r / 6);
        if (rowGlow[r] > 0.01) {
          ctx.fillStyle = rgba(tone, 0.08 * rowGlow[r] + 0.03);
          roundRect(ctx, 8, y0 + 2, w - 16, rowH - 4, 8);
          ctx.fill();
        }
        text(ctx, m.name, 14, cy + 4, { size: narrow ? 11.5 : 13, color: rgba(mixRgb(tone, [255, 255, 255], 0.45), 1), weight: 700 });
        if (!narrow) text(ctx, m.formula, gx1 + 14, cy + 4, { size: 10.5, color: COL.dim, mono: true });

        const prev = r > 0 ? MODES[r - 1].pcs : null;
        const cellR = Math.min(cw * 0.32, rowH * 0.28);
        for (let k = 0; k <= 12; k++) {
          const pc = k % 12;
          const x = gx0 + (k + 0.5) * cw;
          const lit = m.pcs.includes(pc);
          if (!lit) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
            ctx.beginPath();
            ctx.arc(x, cy, 2, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          const moved = prev && !prev.includes(pc);
          const col: RGB = pc === 0 ? [255, 222, 170] : moved ? hex("#ff7a4a") : mixRgb(tone, [200, 210, 240], 0.35);
          const f = cellFlash[r][k];
          glow(ctx, x, cy, cellR * (2.6 + 2 * f), col, 0.22 + 0.4 * f);
          ctx.fillStyle = rgba(mixRgb(col, [255, 255, 255], 0.3 + 0.4 * f), 0.95);
          ctx.beginPath();
          ctx.arc(x, cy, cellR, 0, Math.PI * 2);
          ctx.fill();
          if (moved) {
            // the note slid down a semitone from the row above
            const fromX = x + cw;
            const fromY = cy - rowH;
            ctx.strokeStyle = "rgba(255, 150, 100, 0.7)";
            ctx.lineWidth = 1.4;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(fromX - cellR * 0.6, fromY + cellR * 0.8);
            ctx.lineTo(x + cellR * 0.7, cy - cellR * 0.8);
            ctx.stroke();
            ctx.setLineDash([]);
            text(ctx, "♭", x - cellR - 7, cy - cellR * 0.2, { size: 12, color: "#ffb48a", align: "center", base: "middle", weight: 700 });
          }
        }
      }
    },
    dispose() {
      silence();
    },
  };
}
