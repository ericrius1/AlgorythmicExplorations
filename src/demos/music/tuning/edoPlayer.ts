// Fig. 5 of Part 4: play other divisions. The ring is one period (an octave,
// or for Bohlen–Pierce the 3:1 "tritave") cut into equal steps; the pure
// intervals sit outside it at their true angles, joined to the nearest step
// and coloured by the miss. Underneath is a keyboard with one key per step:
// tap or drag across it, or play the scale and chords the system is good at.

import { Shell, type Demo } from "../../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../../lib/audio";
import { cents } from "./theory";
import { COL, Surface, approach, clock, dot, glow, heat, hex, label, mixRgb, rgba, roundRect, signed, text, type RGB } from "./draw";
import { Sound, type Held, type Timbre } from "./sound";
import { button, chips, tapBadge } from "./ui";

interface Target {
  ratio: [number, number];
  c: number;
}

interface System {
  id: string;
  name: string;
  n: number;
  period: number; // cents
  base: number; // Hz of step 0
  targets: Target[];
  scale: number[]; // steps
  scaleName: string;
  chords: { name: string; steps: number[] }[];
  timbre: Timbre;
}

const T = (a: number, b: number): Target => ({ ratio: [a, b], c: cents(a / b) });
const EDO_TARGETS = [T(6, 5), T(5, 4), T(4, 3), T(3, 2), T(5, 3), T(7, 4)];
const near = (n: number, period: number, c: number): number => Math.round((c * n) / period);

function edo(n: number): System {
  const st = (c: number): number => near(n, 1200, c);
  return {
    id: String(n),
    name: `${n}-equal`,
    n,
    period: 1200,
    base: 261.6256,
    targets: EDO_TARGETS,
    scale: [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2].map((r) => st(cents(r))),
    scaleName: "major scale",
    chords: [
      { name: "major triad 4:5:6", steps: [0, st(cents(5 / 4)), st(cents(3 / 2))] },
      { name: "4:5:6:7", steps: [0, st(cents(5 / 4)), st(cents(3 / 2)), st(cents(7 / 4))] },
    ],
    timbre: "organ",
  };
}

const TRITAVE = cents(3);
const BP: System = {
  id: "bp",
  name: "Bohlen–Pierce",
  n: 13,
  period: TRITAVE,
  base: 130.8128,
  targets: [T(9, 7), T(7, 5), T(5, 3), T(9, 5), T(15, 7), T(7, 3)],
  scale: [0, 2, 3, 4, 6, 7, 9, 10, 12, 13],
  scaleName: "Lambda mode",
  chords: [
    { name: "3:5:7", steps: [0, 6, 10] },
    { name: "3:5:7:9", steps: [0, 6, 10, 13] },
  ],
  timbre: "clarinet",
};

const SYSTEMS: System[] = [edo(12), edo(19), edo(22), edo(24), edo(31), edo(41), edo(53), BP];

export function mountEdoPlayer(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.66);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.32 : 0.64));
  const sound = new Sound({ level: 1, reverb: 0.12 });
  const badge = tapBadge(container, "tap the keys");

  let sys = SYSTEMS[4]; // 31-equal
  let timbre: Timbre = sys.timbre;
  const lit = new Map<number, number>(); // step → glow 0..1
  let held: Held | null = null;
  let chordTimer = 0;
  let dragKey = -1;
  let keyGeo = { x0: 0, x1: 1, y0: 0, y1: 1 };

  const freq = (step: number): number => sys.base * Math.pow(2, (step * sys.period) / sys.n / 1200);
  const silence = (): void => {
    clearTimeout(chordTimer);
    held?.release(0.2);
    held = null;
    sound.silence();
  };
  const guard = frameGuard(silence);

  const playStep = (s: number, when = 0, dur = 1.1): void => {
    sound.note(freq(s), when, { vel: 0.7, dur, timbre: timbre === "clarinet" ? "clarinet" : "keys", bright: 0.5 });
    const delay = Math.max(0, (when - sound.now()) * 1000);
    window.setTimeout(() => lit.set(s, 1), delay);
  };
  const playChord = (steps: number[]): void => {
    silence();
    held = sound.hold(steps.map(freq), { timbre, level: 0.045, attack: 0.06, cutoff: 4200 });
    steps.forEach((s) => lit.set(s, 1));
    const mine = held;
    chordTimer = window.setTimeout(() => {
      mine.release(0.5);
      if (held === mine) held = null;
    }, 2400);
  };
  const go = (fn: () => void): void => {
    badge.hide();
    void unlockAudio().then(fn);
  };

  const sysChips = chips(shell.controls, {
    label: "division",
    options: SYSTEMS.map((s) => ({ value: s.id, text: s.id === "bp" ? "Bohlen–Pierce" : `${s.n}` })),
    value: sys.id,
    wide: true,
    onChange: (id) => {
      silence();
      sys = SYSTEMS.find((s) => s.id === id)!;
      timbre = sys.timbre;
      timbreChips.set(timbre);
      rebuildButtons();
    },
  });
  void sysChips;
  const timbreChips = chips<Timbre>(shell.controls, {
    label: "timbre",
    options: [
      { value: "organ", text: "all harmonics" },
      { value: "clarinet", text: "odd harmonics only" },
    ],
    value: timbre,
    onChange: (v) => (timbre = v),
  });
  const btnRow = document.createElement("div");
  btnRow.className = "tn-btnrow";
  btnRow.style.display = "contents";
  shell.controls.appendChild(btnRow);
  const rebuildButtons = (): void => {
    btnRow.replaceChildren();
    button(btnRow, `▶ ${sys.scaleName}`, () =>
      go(() => {
        silence();
        const t0 = sound.now() + 0.05;
        const up = sys.scale;
        const seq = [...up, ...up.slice(0, -1).reverse()];
        seq.forEach((s, i) => playStep(s, t0 + i * 0.22, 0.8));
      }),
    );
    for (const ch of sys.chords) button(btnRow, `▶ ${ch.name}`, () => go(() => playChord(ch.steps)));
    button(btnRow, "■", silence);
  };
  rebuildButtons();

  // keyboard strip interaction
  const keyAt = (x: number, y: number): number => {
    const { x0, x1, y0, y1 } = keyGeo;
    if (y < y0 - 6 || y > y1 + 6 || x < x0 || x > x1) return -1;
    const k = Math.floor(((x - x0) / (x1 - x0)) * (sys.n + 1));
    return Math.max(0, Math.min(sys.n, k));
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    const k = keyAt(p.x, p.y);
    if (k < 0) return;
    shell.canvas.setPointerCapture(e.pointerId);
    dragKey = k;
    go(() => playStep(k));
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (dragKey < 0) return;
    const p = surf.local(e);
    const k = keyAt(p.x, Math.min(Math.max(p.y, keyGeo.y0), keyGeo.y1));
    if (k >= 0 && k !== dragKey) {
      dragKey = k;
      playStep(k);
    }
  });
  const end = (): void => {
    dragKey = -1;
  };
  shell.canvas.addEventListener("pointerup", end);
  shell.canvas.addEventListener("pointercancel", end);

  shell.setInfo(() => {
    const step = sys.period / sys.n;
    const parts = sys.targets.slice(0, 4).map((tg) => {
      const s = near(sys.n, sys.period, tg.c);
      return `${tg.ratio[0]}:${tg.ratio[1]} ${signed(s * step - tg.c, 1)}`;
    });
    const per = sys.id === "bp" ? "3:1 tritave" : "octave";
    return `${sys.name}: ${sys.n} steps of ${step.toFixed(2)}¢ per ${per} · ${parts.join(" · ")}`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const [k, v] of lit) {
        const nv = approach(v, 0, 3, dt);
        if (nv < 0.01) lit.delete(k);
        else lit.set(k, nv);
      }

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const step = sys.period / sys.n;
      const keysH = narrow ? Math.min(110, h * 0.2) : Math.min(120, h * 0.24);
      const ky1 = h - 26;
      const ky0 = ky1 - keysH;
      // the ring and its outer labels (R + ~50px) fit above the key labels
      const ringTop = 14;
      const ringBottom = ky0 - 26;
      const R = Math.max(40, Math.min(narrow ? w * 0.3 : w * 0.19, (ringBottom - ringTop) / 2 - (narrow ? 44 : 52)));
      const cx = narrow ? w / 2 : w * 0.27;
      const cy = (ringTop + ringBottom) / 2;

      // ---- ring of steps ----
      glow(ctx, cx, cy, R * 1.3, [40, 52, 96], 0.2);
      ctx.strokeStyle = "rgba(122, 140, 200, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      const inScale = new Set(sys.scale.map((s) => s % sys.n));
      for (let s = 0; s < sys.n; s++) {
        const tt = s / sys.n;
        const sc = inScale.has(s);
        const g = lit.get(s) ?? (s === 0 ? lit.get(sys.n) ?? 0 : 0);
        const [ax, ay] = clock(cx, cy, R - (sc ? 9 : 5), tt);
        const [bx, by] = clock(cx, cy, R + (sc ? 9 : 5), tt);
        ctx.strokeStyle = sc ? "rgba(200, 214, 255, 0.75)" : "rgba(140, 156, 210, 0.38)";
        ctx.lineWidth = sc ? 1.8 : 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        if (g > 0) {
          const [px, py] = clock(cx, cy, R, tt);
          dot(ctx, px, py, 3 + 2 * g, hex("#ffd9a0"), g, 4);
        }
      }
      // 12-equal reference (octave systems only)
      if (sys.period === 1200 && sys.n !== 12) {
        for (let p = 0; p < 12; p++) {
          const [x, y] = clock(cx, cy, R - 18, p / 12);
          ctx.fillStyle = "rgba(122, 162, 255, 0.35)";
          ctx.beginPath();
          ctx.arc(x, y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // pure targets outside the ring
      for (const tg of sys.targets) {
        const s = near(sys.n, sys.period, tg.c);
        const e = s * step - tg.c;
        const col = heat(Math.abs(e) / 20);
        const [tx, ty] = clock(cx, cy, R + 24, tg.c / sys.period);
        const [sx, sy] = clock(cx, cy, R + 10, (s * step) / sys.period);
        ctx.strokeStyle = rgba(col, 0.75);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        dot(ctx, tx, ty, 2.6, col, 1, 3);
        const [lx, ly] = clock(cx, cy, R + (narrow ? 40 : 46), tg.c / sys.period);
        text(ctx, `${tg.ratio[0]}:${tg.ratio[1]}`, lx, ly - 5, { size: narrow ? 9.5 : 10.5, color: rgba(mixRgb(col, [255, 255, 255], 0.4), 1), align: "center", base: "middle", weight: 650 });
        text(ctx, signed(e, 1), lx, ly + 8, { size: narrow ? 8.5 : 9.5, color: rgba(col, 0.9), align: "center", base: "middle", mono: true });
      }
      text(ctx, sys.id === "bp" ? "13 steps" : `${sys.n} steps`, cx, cy - 4, { size: narrow ? 13 : 15, color: COL.text, align: "center", weight: 700 });
      text(ctx, sys.id === "bp" ? "per 3:1" : "per octave", cx, cy + 13, { size: 10.5, color: COL.dim, align: "center" });

      // ---- detail table (wide screens) ----
      if (!narrow) {
        const tx0 = w * 0.53;
        let ty = 40;
        text(ctx, sys.name, tx0, ty, { size: 16, color: "#f4f6fc", weight: 700 });
        text(ctx, `one step = ${step.toFixed(2)}¢`, tx0 + 170, ty, { size: 11, color: COL.dim, mono: true });
        ty += 26;
        const cols = [tx0, tx0 + 74, tx0 + 160, tx0 + 230, tx0 + 320];
        ["pure", "cents", "step", "step ¢", "miss"].forEach((s, i) => text(ctx, s, cols[i], ty, { size: 10, color: COL.dim }));
        ty += 6;
        for (const tg of sys.targets) {
          ty += 19;
          const s = near(sys.n, sys.period, tg.c);
          const e = s * step - tg.c;
          const col = heat(Math.abs(e) / 20);
          text(ctx, `${tg.ratio[0]}:${tg.ratio[1]}`, cols[0], ty, { size: 11, color: COL.text, weight: 600 });
          text(ctx, tg.c.toFixed(1), cols[1], ty, { size: 11, color: COL.dim, mono: true });
          text(ctx, String(s), cols[2], ty, { size: 11, color: COL.text, mono: true });
          text(ctx, (s * step).toFixed(1), cols[3], ty, { size: 11, color: COL.dim, mono: true });
          text(ctx, `${signed(e, 1)}¢`, cols[4], ty, { size: 11, color: rgba(col, 1), mono: true, weight: 600 });
        }
      }

      // ---- one key per step ----
      const kx0 = narrow ? 10 : 18;
      const kx1 = w - kx0;
      keyGeo = { x0: kx0, x1: kx1, y0: ky0, y1: ky1 };
      const nk = sys.n + 1;
      const kw = (kx1 - kx0) / nk;
      const gap = Math.min(2, kw * 0.18);
      const targetAt = new Map<number, string>();
      for (const tg of sys.targets) targetAt.set(near(sys.n, sys.period, tg.c), `${tg.ratio[0]}:${tg.ratio[1]}`);
      targetAt.set(0, "1:1");
      targetAt.set(sys.n, sys.id === "bp" ? "3:1" : "2:1");
      for (let s = 0; s < nk; s++) {
        const x = kx0 + s * kw;
        const sc = inScale.has(s % sys.n) || s === sys.n;
        const g = lit.get(s) ?? 0;
        const base: RGB = sc ? [196, 204, 226] : [58, 64, 88];
        const col = mixRgb(base, hex("#ffb86b"), g);
        ctx.fillStyle = rgba(col, sc ? 0.92 : 0.95);
        roundRect(ctx, x + gap / 2, ky0, kw - gap, ky1 - ky0, Math.min(5, kw * 0.3));
        ctx.fill();
        if (g > 0) glow(ctx, x + kw / 2, ky0 + 10, kw * 1.5 + 10, hex("#ffb86b"), 0.4 * g);
        const lab = targetAt.get(s);
        const showNum = sys.n <= 24 || s % 5 === 0;
        if (showNum && kw > 9) {
          text(ctx, String(s), x + kw / 2, ky1 - 8, { size: Math.min(10, kw * 0.6), color: sc ? "#2a2f42" : "#9aa2c0", align: "center", mono: true });
        }
        if (lab) {
          text(ctx, lab, x + kw / 2, ky0 - 7, {
            size: narrow ? 8.5 : 9.5,
            color: "#cfdcff",
            align: "center",
            weight: 650,
            alpha: kw < 10 && lab.length > 3 && !narrow ? 0.85 : 1,
          });
        }
      }
      text(ctx, "one key per step · drag across to slide", kx0, ky1 + 16, { size: 10, color: COL.dim });
      if (dragKey >= 0) label(ctx, `step ${dragKey} · ${(dragKey * step).toFixed(1)}¢`, kx1, ky1 + 13, { size: 10, mono: true, align: "right" });
    },
    dispose() {
      silence();
    },
  };
}
