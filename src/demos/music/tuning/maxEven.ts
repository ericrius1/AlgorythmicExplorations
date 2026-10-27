// Fig. 3 of Part 5: spread k notes round the octave as evenly as the
// semitone grid allows. Left, the notes on the chromatic ring; right, the
// same notes on the circle of fifths, where the pentatonic and diatonic sets
// turn out to be unbroken chains. Below, the interval count: how many pairs
// of notes sit 1, 2 … 6 semitones apart. Click positions on the left ring to
// make your own set and see how it scores.

import { Shell, type Demo } from "../../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../../lib/audio";
import { PC_NAMES, intervalVector, maximallyEven, mod, spread } from "./theory";
import { COL, Surface, approach, clock, dot, glow, glowStroke, hex, label, mixRgb, pcColor, rgba, text, type RGB } from "./draw";
import { Sound } from "./sound";
import { button, range, tapBadge } from "./ui";

const NAMES: Record<number, string> = {
  1: "one note",
  2: "a tritone",
  3: "augmented triad",
  4: "diminished seventh chord",
  5: "pentatonic scale",
  6: "whole-tone scale",
  7: "diatonic scale",
  8: "octatonic scale",
  9: "Messiaen's third mode",
  10: "Messiaen's seventh mode",
  11: "all but one",
  12: "chromatic scale",
};

const WHITE = [0, 2, 4, 5, 7, 9, 11];

// the transposition of the maximally even k-set that starts on C and sits
// best on the white keys (so 7 comes out as C major, 5 as C major pentatonic)
function niceEven(k: number): number[] {
  const base = maximallyEven(k);
  let best = base;
  let score = -1;
  for (let t = 0; t < 12; t++) {
    const s = base.map((p) => mod(p + t, 12)).sort((a, b) => a - b);
    if (!s.includes(0)) continue;
    const sc = s.filter((p) => WHITE.includes(p)).length;
    if (sc > score) {
      score = sc;
      best = s;
    }
  }
  return best;
}

// most spread any k-set can be (the maximally even one)
const MAX_SPREAD = Array.from({ length: 13 }, (_, k) => (k > 0 ? spread(maximallyEven(k)) : 0));

export function mountMaxEven(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.45 : 0.48));
  const sound = new Sound({ level: 1, reverb: 0.15 });
  const badge = tapBadge(container, "tap for sound");

  let k = 7;
  let set = niceEven(7);
  let custom = false;
  const on = new Array(12).fill(0);
  const flash = new Array(12).fill(0);
  let geo = { cx: 0, cy: 0, R: 1 };

  const guard = frameGuard(() => sound.silence());
  const play = (pcs: number[]): void => {
    const t0 = sound.now() + 0.05;
    sound.silence(0.03);
    [...pcs, 12].forEach((pc, i) => {
      sound.note(261.6256 * Math.pow(2, pc / 12), t0 + i * 0.2, { vel: 0.6, dur: 0.8, timbre: "keys", bright: 0.45 });
      window.setTimeout(() => (flash[pc % 12] = 1), (t0 - sound.now() + i * 0.2) * 1000);
    });
  };

  const slider = range(shell.controls, {
    label: "how many notes",
    min: 1,
    max: 12,
    step: 1,
    value: 7,
    format: (v) => `${v} · ${NAMES[v]}`,
    onInput: (v) => {
      k = v;
      set = niceEven(v);
      custom = false;
    },
  });
  button(shell.controls, "▶ play the set", () => {
    badge.hide();
    void unlockAudio().then(() => play(set));
  });
  button(shell.controls, "reset to evenest", () => {
    set = niceEven(k);
    custom = false;
  });

  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    let best = -1;
    let bd = Math.max(22, geo.R * 0.2);
    for (let pc = 0; pc < 12; pc++) {
      const [x, y] = clock(geo.cx, geo.cy, geo.R, pc / 12);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bd) {
        bd = d;
        best = pc;
      }
    }
    if (best < 0) return;
    if (set.includes(best)) {
      if (set.length > 1) set = set.filter((x) => x !== best);
    } else set = [...set, best].sort((a, b) => a - b);
    custom = true;
    k = set.length;
    slider.set(k);
    flash[best] = 1;
    badge.hide();
    void unlockAudio().then(() =>
      sound.note(261.6256 * Math.pow(2, best / 12), 0, { vel: 0.6, dur: 0.9, timbre: "keys", bright: 0.45 }),
    );
  });

  const fifthsChain = (pcs: number[]): boolean => {
    if (pcs.length <= 1 || pcs.length >= 12) return true;
    const pos = new Set(pcs.map((pc) => mod(pc * 7, 12)));
    // unbroken arc on the fifths circle: exactly one gap
    let gaps = 0;
    for (let q = 0; q < 12; q++) if (pos.has(q) && !pos.has((q + 1) % 12)) gaps++;
    return gaps === 1;
  };

  shell.setInfo(() => {
    const iv = intervalVector(set);
    const ev = MAX_SPREAD[set.length] > 0 ? spread(set) / MAX_SPREAD[set.length] : 1;
    const name = custom ? "your set" : NAMES[set.length];
    return `${name}: ${set.map((pc) => PC_NAMES[pc]).join(" ")} · evenness ${(ev * 100).toFixed(1)}% · intervals ⟨${iv.join(", ")}⟩`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (let pc = 0; pc < 12; pc++) {
        on[pc] = approach(on[pc], set.includes(pc) ? 1 : 0, 10, dt);
        flash[pc] = approach(flash[pc], 0, 4, dt);
      }

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const R = narrow ? Math.min(w * 0.3, h * 0.17) : Math.min(w * 0.135, h * 0.33);
      const c1 = narrow ? { x: w * 0.5, y: R + 40 } : { x: w * 0.175, y: h * 0.5 + 4 };
      const c2 = narrow ? { x: w * 0.5, y: c1.y + 2 * R + 76 } : { x: w * 0.5, y: h * 0.5 + 4 };
      geo = { cx: c1.x, cy: c1.y, R };
      const fs = narrow ? 10.5 : 11.5;

      const ring = (cx: number, cy: number, angleOf: (pc: number) => number, title: string, chain: boolean): void => {
        glow(ctx, cx, cy, R * 1.35, [40, 52, 96], 0.18);
        ctx.strokeStyle = "rgba(122, 140, 200, 0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();
        // polygon through the set, in ring order
        const pts = set.map((pc) => ({ pc, a: angleOf(pc) })).sort((a, b) => a.a - b.a);
        if (pts.length > 1) {
          ctx.beginPath();
          pts.forEach((p, i) => {
            const [x, y] = clock(cx, cy, R, p.a);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fillStyle = "rgba(122, 162, 255, 0.06)";
          ctx.fill();
          glowStroke(ctx, chain ? hex("#7dd6a0") : hex("#7aa2ff"), 0.5, 1.2);
        }
        for (let pc = 0; pc < 12; pc++) {
          const [x, y] = clock(cx, cy, R, angleOf(pc));
          ctx.fillStyle = "rgba(120, 130, 170, 0.3)";
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          const col: RGB = pc === 0 ? [255, 214, 150] : pcColor(pc);
          if (on[pc] > 0.02) dot(ctx, x, y, (4.6 + 3 * flash[pc]) * (0.4 + 0.6 * on[pc]), col, on[pc], 3.4);
          const [lx, ly] = clock(cx, cy, R + fs * 1.55, angleOf(pc));
          text(ctx, PC_NAMES[pc], lx, ly, {
            size: fs,
            color: on[pc] > 0.5 ? rgba(mixRgb(col, [255, 255, 255], 0.5), 1) : COL.faint,
            align: "center",
            base: "middle",
            weight: on[pc] > 0.5 ? 700 : 500,
          });
        }
        text(ctx, title, cx, cy - R - fs * 3, { size: 10.5, color: COL.dim, align: "center" });
      };

      const chain = fifthsChain(set);
      ring(c1.x, c1.y, (pc) => pc / 12, "chromatic order (click to edit)", false);
      ring(c2.x, c2.y, (pc) => mod(pc * 7, 12) / 12, "circle of fifths order", chain);
      label(ctx, chain ? "one unbroken chain of fifths" : "not a single chain of fifths", c2.x, c2.y + R + fs * 3.2, {
        size: 10.5,
        color: chain ? "#a8f0c8" : "#9aa8d0",
      });

      // ---- interval content ----
      const iv = intervalVector(set);
      const px = narrow ? 22 : w * 0.76;
      const pw = narrow ? w - 44 : w * 0.21;
      let py = narrow ? c2.y + R + 70 : h * 0.5 - 100;
      text(ctx, "pairs at each distance", px, py, { size: 10.5, color: COL.dim });
      py += 14;
      const maxCount = Math.max(6, ...iv);
      const barH = narrow ? 13 : 17;
      const distinct = new Set(iv.filter((x) => x > 0)).size === iv.filter((x) => x > 0).length && iv.every((x) => x > 0);
      const labels = ["1 semitone", "2", "3", "4", "5", "6 (tritone)"];
      iv.forEach((c, i) => {
        const y = py + i * (barH + 7);
        const bw = (pw - 70) * (c / maxCount);
        ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
        ctx.fillRect(px + 70, y, pw - 70, barH);
        ctx.fillStyle = rgba(distinct ? hex("#7dd6a0") : hex("#7aa2ff"), 0.75);
        ctx.fillRect(px + 70, y, bw, barH);
        text(ctx, labels[i], px, y + barH - 4, { size: 10, color: COL.dim });
        text(ctx, String(c), px + 74 + bw, y + barH - 4, { size: 10.5, color: COL.text, mono: true, weight: 600 });
      });
      py += 6 * (barH + 7) + 10;
      const ev = MAX_SPREAD[set.length] > 0 ? spread(set) / MAX_SPREAD[set.length] : 1;
      text(ctx, `evenness ${(ev * 100).toFixed(1)}%`, px, py + 4, { size: 12, color: ev > 0.9999 ? "#a8f0c8" : "#f0c08a", weight: 700, mono: true });
      py += 20;
      if (distinct) text(ctx, "every distance occurs a different", px, py + 4, { size: 10.5, color: "#a8f0c8" });
      if (distinct) text(ctx, "number of times", px, py + 18, { size: 10.5, color: "#a8f0c8" });
    },
    dispose() {
      sound.silence();
    },
  };
}
