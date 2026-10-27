// Fig. 1 of Part 4: stack fifths and watch two views at once. Left, the
// pitch spiral (one turn per octave), where twelve fifths climb seven
// octaves and overshoot. Right, the same notes folded into one octave, with
// the scale they make and its step sizes. Five, seven and twelve fifths-worth
// of notes give scales with exactly two step sizes (pentatonic, diatonic,
// chromatic); the thirteenth note adds a sliver: the comma. The fifth-size
// slider bends every fifth at once, so you can close the gap by hand.

import { Shell, type Demo } from "../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../lib/audio";
import { FIFTH, PC_NAMES, chainScale, fifthName, folded, stepKinds, mod } from "./tuning/theory";
import {
  COL,
  Surface,
  approach,
  clock,
  clockArc,
  dot,
  glow,
  glowStroke,
  hex,
  label,
  mixRgb,
  pcColor,
  rgba,
  signed,
  text,
  type RGB,
} from "./tuning/draw";
import { PitchSpiral, type SpiralState } from "./tuning/spiral";
import { Sound, hz, type Held } from "./tuning/sound";
import { button, chips, range, tapBadge } from "./tuning/ui";

const LANDMARKS: { c: number; name: string }[] = [
  { c: FIFTH, name: "pure 3:2" },
  { c: 700, name: "equal" },
  { c: 696.578, name: "¼-comma meantone" },
  { c: 694.737, name: "19-equal" },
  { c: 705.882, name: "17-equal" },
];

const STEP_COLORS: RGB[] = [hex("#6f9bff"), hex("#ffb86b"), hex("#ff6b5e")];

export function mountSpiralFifths(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const narrow = (w: number): boolean => w < 600;
  // phone: spiral, folded circle and ruler stack vertically (2·0.4w + 2·0.25w + 232 px)
  const surf = new Surface(shell.canvas, (w) => (narrow(w) ? 1.3 + 232 / w : 0.6));
  const spiral = new PitchSpiral();
  const sound = new Sound({ level: 0.9, reverb: 0.15 });
  const badge = tapBadge(container, "tap for sound");

  let n = 13; // notes on the chain: C plus n−1 fifths
  let fifth = FIFTH;
  let pen = 12;
  let dyad: Held | null = null;
  const flash = new Array(13).fill(0);
  const state: SpiralState = {
    fifth,
    count: n,
    pen,
    flash,
    hover: -1,
    commaAlpha: 1,
    labels: true,
    trailAlpha: 1,
  };

  const releaseDyad = (): void => {
    dyad?.release(0.4);
    dyad = null;
  };
  const silence = (): void => {
    releaseDyad();
    sound.silence();
  };
  const guard = frameGuard(silence);

  const playNote = (k: number): void => {
    flash[k] = 1;
    sound.note(hz(folded(k, fifth)), 0, { vel: 0.65, dur: 1.5, timbre: "keys", bright: 0.5 });
  };
  const withSound = (fn: () => void): void => {
    badge.hide();
    void unlockAudio().then(fn);
  };

  const setN = (v: number, play = true): void => {
    const prev = n;
    n = Math.max(1, Math.min(13, v));
    quick.set(n === 5 || n === 7 || n === 12 || n === 13 ? n : 0);
    releaseDyad();
    if (play && n > prev) withSound(() => playNote(n - 1));
  };

  button(shell.controls, "start over", () => {
    setN(1, false);
    withSound(() => playNote(0));
  });
  button(shell.controls, "+ stack a fifth", () => setN(n + 1));
  button(shell.controls, "− remove", () => setN(n - 1, false));
  const quick = chips<number>(shell.controls, {
    label: "notes on the chain",
    options: [
      { value: 5, text: "5", title: "C G D A E: pentatonic" },
      { value: 7, text: "7", title: "F C G D A E B, shifted: diatonic" },
      { value: 12, text: "12", title: "chromatic" },
      { value: 13, text: "13", title: "twelve fifths: the comma" },
    ],
    value: 13,
    onChange: (v) => setN(v, false),
  });
  const br = document.createElement("div");
  br.className = "tn-break";
  shell.controls.appendChild(br);
  const fifthSlider = range(shell.controls, {
    label: "size of every fifth",
    min: 690,
    max: 708,
    step: 0.01,
    value: FIFTH,
    format: (v) => {
      const lm = LANDMARKS.find((l) => Math.abs(l.c - v) < 0.02);
      return `${v.toFixed(2)}¢${lm ? ` · ${lm.name}` : ""}`;
    },
    onInput: (v) => {
      // snap to landmarks so 700.00 and 701.96 are easy to hit
      const lm = LANDMARKS.find((l) => Math.abs(l.c - v) < 0.35);
      fifth = lm ? lm.c : v;
      if (lm) fifthSlider.set(lm.c);
      if (dyad) dyad.set([hz(0), hz(commaPitch())]);
    },
  });
  button(shell.controls, "▶ play the scale", () =>
    withSound(() => {
      releaseDyad();
      const { pitches } = chainScale(n, fifth);
      const t0 = sound.now() + 0.05;
      [...pitches, 1200].forEach((p, i) => sound.note(hz(p), t0 + i * 0.24, { vel: 0.6, dur: 0.9, timbre: "keys" }));
    }),
  );
  const commaPitch = (): number => {
    const c = 12 * fifth - 8400;
    return c;
  };
  button(shell.controls, "▶ C against the 13th note", () =>
    withSound(() => {
      if (n < 13) setN(13, false);
      releaseDyad();
      sound.silence();
      dyad = sound.hold([hz(0), hz(commaPitch())], { timbre: "organ", level: 0.055, attack: 0.15, cutoff: 3200 });
      window.setTimeout(releaseDyad, 4200);
    }),
  );

  shell.setInfo(() => {
    const { gaps } = chainScale(n, fifth);
    const kinds = stepKinds(gaps);
    const steps = kinds.map((k) => `${k.size.toFixed(1)}¢ ×${k.count}`).join(", ");
    const gap = 12 * fifth - 8400;
    const tail = n === 13 ? ` · 12 fifths − 7 octaves = ${signed(gap, 2)}¢` : "";
    return `${n} note${n === 1 ? "" : "s"} · ${kinds.length} step size${kinds.length === 1 ? "" : "s"}: ${steps}${tail}`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      pen = approach(pen, n - 1, 7, dt);
      if (Math.abs(pen - (n - 1)) < 0.002) pen = n - 1;
      for (let k = 0; k < flash.length; k++) flash[k] = approach(flash[k], 0, 2.5, dt);
      state.fifth = fifth;
      state.count = Math.max(1, Math.min(n, Math.floor(pen + 0.02) + 1));
      state.pen = pen;
      state.commaAlpha = approach(state.commaAlpha, n === 13 ? 1 : 0, 8, dt);

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const isNarrow = narrow(w);

      // ---- left / top: the spiral ----
      let sx: number, sy: number, sR: number;
      if (isNarrow) {
        sR = w * 0.4;
        sx = w / 2;
        sy = sR + 30;
      } else {
        sR = Math.min(w * 0.22, h * 0.41);
        sx = w * 0.26;
        sy = h * 0.5;
      }
      spiral.layout(sx, sy, sR);
      const sc = Math.max(0.8, Math.min(1.05, sR / 200));
      spiral.draw(ctx, state, now / 1000, sc);
      if (n === 13) {
        const gap = 12 * fifth - 8400;
        spiral.commaTag(ctx, state, Math.abs(gap) < 0.01 ? "closed" : `${signed(gap, 2)}¢`, sc);
      }
      text(ctx, "unfolded: one turn per octave", sx, isNarrow ? 14 : 22, {
        size: 11,
        color: COL.dim,
        align: "center",
      });

      // ---- right / bottom: the folded octave ----
      const pitches = Array.from({ length: n }, (_, k) => ({ k, c: folded(k, fifth) })).sort((a, b) => a.c - b.c);
      const gaps = pitches.map((p, i) => (i + 1 < pitches.length ? pitches[i + 1].c : 1200) - p.c);
      const kinds = stepKinds(gaps);
      const kindOf = (g: number): number => kinds.findIndex((kd) => Math.abs(kd.size - g) < 0.05);

      let fx: number, fy: number, fR: number, rulerY: number, rx0: number, rx1: number;
      if (isNarrow) {
        fR = w * 0.25;
        fx = w / 2;
        fy = sy + sR + 46 + fR;
        rulerY = fy + fR + 80;
        rx0 = 22;
        rx1 = w - 22;
      } else {
        fR = Math.min(w * 0.14, h * 0.25);
        fx = w * 0.74;
        fy = h * 0.06 + fR + 26;
        rulerY = fy + fR + Math.max(70, h * 0.17);
        rx0 = w * 0.53;
        rx1 = w - 26;
      }
      text(ctx, "folded into one octave", fx, fy - fR - 30, { size: 11, color: COL.dim, align: "center" });

      // equal-tempered reference spokes
      for (let p = 0; p < 12; p++) {
        const [ax, ay] = clock(fx, fy, fR - 6, p / 12);
        const [bx, by] = clock(fx, fy, fR + 6, p / 12);
        ctx.strokeStyle = "rgba(122, 140, 200, 0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(122, 140, 200, 0.12)";
      ctx.beginPath();
      ctx.arc(fx, fy, fR, 0, Math.PI * 2);
      ctx.stroke();

      // step arcs, coloured by size class
      pitches.forEach((p, i) => {
        const g = gaps[i];
        if (n < 2) return;
        const kind = kindOf(g);
        const col = STEP_COLORS[Math.min(2, kind)];
        const t0 = p.c / 1200;
        const t1 = (p.c + g) / 1200;
        clockArc(ctx, fx, fy, fR, t0 + 0.004, t1 - 0.004);
        glowStroke(ctx, col, 0.85, 2.2);
        if (g > 60 && n <= 13) {
          const [lx, ly] = clock(fx, fy, fR + 15, (t0 + t1) / 2);
          text(ctx, g.toFixed(1), lx, ly, { size: 9.5, color: rgba(col, 0.95), align: "center", base: "middle", mono: true });
        }
      });
      // notes on the folded circle
      pitches.forEach((p, i) => {
        const [x, y] = clock(fx, fy, fR, p.c / 1200);
        const col = p.k === 12 ? (hex("#ff8a6e") as RGB) : pcColor(mod(p.k * 7, 12));
        dot(ctx, x, y, 3.6 + 2 * flash[p.k], col, 1, 3.4);
        // crowded neighbours (C and B♯) get their labels staggered inward
        const prev = i > 0 ? pitches[i - 1].c : pitches[pitches.length - 1].c - 1200;
        const crowd = p.c - prev < 45 && pitches.length > 1;
        const [lx, ly] = clock(fx, fy, fR - (crowd ? 31 : 17), p.c / 1200);
        text(ctx, fifthName(p.k), lx, ly, {
          size: 10.5,
          color: rgba(mixRgb(col, [255, 255, 255], 0.5), 1),
          align: "center",
          base: "middle",
          weight: 650,
        });
      });

      // ---- the ruler: positions in cents against the equal grid ----
      const X = (c: number): number => rx0 + ((rx1 - rx0) * c) / 1200;
      ctx.strokeStyle = "rgba(160, 175, 220, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(0), rulerY);
      ctx.lineTo(X(1200), rulerY);
      ctx.stroke();
      for (let p = 0; p <= 12; p++) {
        ctx.strokeStyle = "rgba(160, 175, 220, 0.3)";
        ctx.beginPath();
        ctx.moveTo(X(p * 100), rulerY - 4);
        ctx.lineTo(X(p * 100), rulerY + 4);
        ctx.stroke();
        if (p < 12 || !isNarrow)
          text(ctx, p === 12 ? "C" : PC_NAMES[p], X(p * 100), rulerY + 16, {
            size: 9.5,
            color: COL.dim,
            align: "center",
            alpha: 0.75,
          });
      }
      // steps as coloured bars just above the ruler
      pitches.forEach((p, i) => {
        if (n < 2) return;
        const kind = kindOf(gaps[i]);
        const col = STEP_COLORS[Math.min(2, kind)];
        ctx.fillStyle = rgba(col, 0.22);
        ctx.fillRect(X(p.c) + 1, rulerY - 10, X(p.c + gaps[i]) - X(p.c) - 2, 6);
      });
      pitches.forEach((p, i) => {
        const x = X(p.c);
        const col = p.k === 12 ? (hex("#ff8a6e") as RGB) : pcColor(mod(p.k * 7, 12));
        dot(ctx, x, rulerY - 7, 3, col, 1, 3);
        // deviation from the nearest equal-tempered note, alternating rows
        const dev = p.c - Math.round(p.c / 100) * 100;
        const row = i % 2;
        const ly = rulerY - 24 - row * 14;
        if (n > 1 || p.k === 0)
          text(ctx, Math.abs(dev) < 0.05 ? "0" : signed(dev, 1), x, ly, {
            size: 9,
            color: rgba(mixRgb(col, [255, 255, 255], 0.4), 0.9),
            align: "center",
            mono: true,
          });
      });
      text(ctx, "cents away from the piano's note", X(0), rulerY - 56, { size: 10, color: COL.dim });

      // legend of step sizes
      let lx = X(0);
      const ly = rulerY + 38;
      kinds.forEach((kd, i) => {
        const col = STEP_COLORS[Math.min(2, i)];
        ctx.fillStyle = rgba(col, 0.9);
        ctx.fillRect(lx, ly - 6, 10, 6);
        const s = `${kd.size.toFixed(1)}¢ × ${kd.count}`;
        const tw = text(ctx, s, lx + 14, ly, { size: 10.5, color: COL.text, mono: true });
        lx += tw + 30;
      });
      if (n === 13 && Math.abs(12 * fifth - 8400) > 0.05) {
        glow(ctx, X(0), rulerY - 7, 16, hex("#ff6b5e"), 0.25);
      }
      if (n === 13) {
        const gap = 12 * fifth - 8400;
        const msg =
          Math.abs(gap) < 0.05
            ? "the 13th note lands on C: the circle closes"
            : gap > 0
              ? `B♯ sits ${gap.toFixed(2)}¢ above C: a sliver of a step`
              : `the 13th note falls ${(-gap).toFixed(2)}¢ short of C`;
        label(ctx, msg, isNarrow ? w / 2 : (rx0 + rx1) / 2, ly + 24, { size: 10.5, color: "#ffc2b0", mono: true });
      }
    },
    dispose() {
      silence();
    },
  };
}
