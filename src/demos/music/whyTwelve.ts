// Fig. 4 of Part 4: why twelve? Divide the octave into N equal steps for
// every N from 5 to 53 and measure how close the nearest step gets to a pure
// fifth (blue), a pure major third (amber) and, optionally, the harmonic
// seventh 7:4 (violet). The fifth's record-setters are labelled with the
// continued-fraction convergents of log2(3/2): 3/5, 7/12, 24/41, 31/53.
// Click a column to hear a pure fifth slide to that system's fifth.

import { Shell, type Demo } from "../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../lib/audio";
import { FIFTH, MAJ3, HARM7, convergents, nearestStep } from "./tuning/theory";
import { COL, Surface, approach, glow, hex, label, rgba, signed, text, type RGB } from "./tuning/draw";
import { Sound, type Held } from "./tuning/sound";
import { chips, tapBadge } from "./tuning/ui";

const NMIN = 5;
const NMAX = 53;
const COUNT = NMAX - NMIN + 1;
const YMAX = 50; // cents shown before clipping (square-root scale)
const ROOT = 196; // G3

const BLUE: RGB = hex("#6f9bff");
const AMBER: RGB = hex("#ffb86b");
const VIOLET: RGB = hex("#c08cff");

export function mountWhyTwelve(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.52);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 0.95 : 0.5));
  const sound = new Sound({ level: 1 });
  const badge = tapBadge(container, "tap a column");

  const err = (n: number, target: number): number => nearestStep(n, target).err;
  // fifth record-setters: smaller error than every smaller N
  const records = new Set<number>();
  let best = Infinity;
  for (let n = NMIN; n <= NMAX; n++) {
    const e = Math.abs(err(n, FIFTH));
    if (e < best - 1e-9) {
      best = e;
      records.add(n);
    }
  }
  const conv = new Map<number, string>();
  for (const [p, q] of convergents(Math.log2(3 / 2), 8)) if (q >= NMIN && q <= NMAX) conv.set(q, `${p}/${q}`);

  let sel = 12;
  let show7 = false;
  let flash = 0;
  let hover = -1;
  let held: Held | null = null;
  let seq = 0;
  let geo = { x0: 0, x1: 1 };
  const grow = new Array(COUNT).fill(0);

  const silence = (): void => {
    clearTimeout(seq);
    held?.release(0.25);
    held = null;
  };
  const guard = frameGuard(silence);

  const audition = (n: number): void => {
    silence();
    const approx = nearestStep(n, FIFTH).cents;
    held = sound.hold([ROOT, ROOT * 1.5], { timbre: "organ", level: 0.055, attack: 0.1, cutoff: 3500 });
    const mine = held;
    seq = window.setTimeout(() => {
      mine.set([ROOT, ROOT * Math.pow(2, approx / 1200)], 0.06);
      seq = window.setTimeout(() => {
        mine.release(0.4);
        if (held === mine) held = null;
      }, 1700);
    }, 1300);
  };

  const colAt = (x: number): number => {
    const k = Math.floor(((x - geo.x0) / (geo.x1 - geo.x0)) * COUNT);
    return k >= 0 && k < COUNT ? NMIN + k : -1;
  };
  shell.canvas.addEventListener("pointermove", (e) => {
    hover = colAt(surf.local(e).x);
    shell.canvas.style.cursor = hover > 0 ? "pointer" : "default";
  });
  shell.canvas.addEventListener("pointerleave", () => (hover = -1));
  shell.canvas.addEventListener("pointerdown", (e) => {
    const n = colAt(surf.local(e).x);
    if (n < 0) return;
    sel = n;
    flash = 1;
    badge.hide();
    void unlockAudio().then(() => audition(n));
  });

  const quick = chips<number>(shell.controls, {
    label: "hear a pure fifth slide to…",
    options: [5, 7, 12, 19, 31, 41, 53].map((n) => ({ value: n, text: `${n}-equal` })),
    value: sel,
    onChange: (n) => {
      sel = n;
      flash = 1;
      badge.hide();
      void unlockAudio().then(() => audition(n));
    },
  });
  chips<boolean>(shell.controls, {
    label: "also show",
    options: [
      { value: false, text: "fifth and third" },
      { value: true, text: "+ harmonic 7th (7:4)" },
    ],
    value: false,
    onChange: (v) => (show7 = v),
  });

  shell.setInfo(() => {
    const s = 1200 / sel;
    const f5 = nearestStep(sel, FIFTH);
    const f3 = nearestStep(sel, MAJ3);
    const f7 = nearestStep(sel, HARM7);
    return `${sel} steps of ${s.toFixed(2)}¢ · fifth ${f5.cents.toFixed(1)} (${signed(f5.err, 2)}) · third ${f3.cents.toFixed(1)} (${signed(f3.err, 2)}) · 7:4 ${f7.cents.toFixed(1)} (${signed(f7.err, 2)})`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      flash = approach(flash, 0, 2.2, dt);
      const q = [5, 7, 12, 19, 31, 41, 53].includes(sel) ? sel : -1;
      if (q !== quick.get()) quick.set(q);
      for (let k = 0; k < COUNT; k++) grow[k] = approach(grow[k], 1, 4 + k * 0.05, dt);

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const padL = narrow ? 30 : 44;
      const padR = 12;
      const top = narrow ? 50 : 46;
      const bottom = h - (narrow ? 42 : 40);
      const x0 = padL;
      const x1 = w - padR;
      geo = { x0, x1 };
      const cw = (x1 - x0) / COUNT;
      // square-root scale: room for the small errors that matter
      const Y = (c: number): number => bottom - (bottom - top) * Math.sqrt(Math.min(c, YMAX) / YMAX);

      // gridlines
      for (const g of [0, 1, 2, 5, 10, 20, 50]) {
        const y = Y(g);
        ctx.strokeStyle = g === 0 ? "rgba(160, 175, 220, 0.4)" : "rgba(122, 140, 200, 0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        text(ctx, `${g}¢`, x0 - 6, y + 3, { size: 9.5, color: COL.dim, align: "right", mono: true, alpha: 0.75 });
      }
      text(ctx, "how far the nearest step misses the pure interval", x0, top - (narrow ? 32 : 24), { size: 11, color: COL.dim });

      // legend
      const items: [RGB, string][] = [
        [BLUE, "fifth 3:2"],
        [AMBER, "major third 5:4"],
      ];
      if (show7) items.push([VIOLET, "harmonic 7th 7:4"]);
      let lx = narrow ? x0 : x1 - (show7 ? 330 : 210);
      const ly = narrow ? top - 14 : top - 22;
      for (const [c, s] of items) {
        ctx.fillStyle = rgba(c, 0.9);
        ctx.fillRect(lx, ly - 7, 9, 9);
        lx += 14 + text(ctx, s, lx + 13, ly + 1, { size: 10.5, color: COL.text }) + 12;
      }

      const series: [number, RGB][] = [
        [FIFTH, BLUE],
        [MAJ3, AMBER],
      ];
      if (show7) series.push([HARM7, VIOLET]);
      const bw = Math.max(1.5, (cw * 0.78) / series.length);

      for (let k = 0; k < COUNT; k++) {
        const n = NMIN + k;
        const cx = x0 + cw * (k + 0.5);
        const isSel = n === sel;
        const isHov = n === hover;
        if (isSel || isHov) {
          ctx.fillStyle = isSel ? "rgba(255, 220, 170, 0.07)" : "rgba(122, 162, 255, 0.06)";
          ctx.fillRect(cx - cw / 2, top - 6, cw, bottom - top + 6);
        }
        series.forEach(([target, col], si) => {
          const e = Math.abs(err(n, target)) * grow[k];
          const bx = cx - (series.length * bw) / 2 + si * bw;
          const y = Y(e);
          const alpha = isSel ? 1 : si === 0 ? (records.has(n) ? 0.95 : 0.6) : 0.42;
          ctx.fillStyle = rgba(col, alpha);
          ctx.fillRect(bx + 0.4, y, bw - 0.8, bottom - y);
          if (e > YMAX) {
            // clipped: a notch on top
            ctx.fillStyle = "#06070b";
            ctx.fillRect(bx, Y(YMAX) + 4, bw, 2);
          }
        });
        // x labels
        const labelled = narrow ? [5, 12, 19, 31, 41, 53].includes(n) : n % 2 === 1 || n === 12 || n === 22;
        if (labelled || isSel) {
          text(ctx, String(n), cx, bottom + 13, {
            size: narrow ? 9.5 : 9,
            color: isSel ? "#ffe2c2" : records.has(n) ? "#cfdcff" : COL.dim,
            align: "center",
            mono: true,
            weight: isSel || records.has(n) ? 700 : 400,
          });
        }
        // convergent tags over the fifth's record-setters
        const tag = conv.get(n);
        if (tag) {
          const e = Math.abs(err(n, FIFTH));
          const y = Math.min(Y(e), Y(Math.abs(err(n, MAJ3)))) - 14;
          label(ctx, tag, cx, Math.max(top + 6, y), { size: narrow ? 9 : 10, mono: true, color: "#cfdcff" });
        }
      }
      text(ctx, "steps per octave →", x1, bottom + 30, { size: 10, color: COL.dim, align: "right" });

      // selection beacon
      const sk = sel - NMIN;
      const scx = x0 + cw * (sk + 0.5);
      glow(ctx, scx, bottom + 22, 10 + 8 * flash, hex("#ffd9b0"), 0.5 + 0.5 * flash);
    },
    dispose() {
      silence();
    },
  };
}
