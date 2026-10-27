// Fig. 6 of Part 5: one slider for the fifth. Every tuning in the
// meantone family (Pythagorean, quarter-comma meantone, 12-, 19-, 31- and
// 53-equal) is a chain of identical fifths, so a single number sets all of
// them. Pick a mode, drag the fifth, and the scale's whole steps, half steps
// and thirds all move together: at 685.7¢ the seven steps become equal
// (7-equal), at 720¢ the half steps vanish and two notes merge (5-equal).
// Play it from the pads, the keyboard (A S D F G H J K L ; '), or the chord
// buttons, which build triads from the scale's own notes.

import { Shell, type Demo } from "../../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../../lib/audio";
import { CHAIN_SCALES, FIFTH, MAJ3, mod, type ChainScale } from "./theory";
import { COL, Surface, approach, dot, glow, hex, label, mixRgb, pcColor, rgba, roundRect, signed, text, type RGB } from "./draw";
import { Sound, type Held } from "./sound";
import { button, chips, range, tapBadge, toggle } from "./ui";

const DETENTS: { f: number; name: string }[] = [
  { f: 1200 * (4 / 7), name: "7-equal" },
  { f: 694.737, name: "19-equal" },
  { f: 696.578, name: "¼-comma" },
  { f: 696.774, name: "31-equal" },
  { f: 700, name: "12-equal" },
  { f: 701.887, name: "53-equal" },
  { f: FIFTH, name: "Pythagorean" },
  { f: 720, name: "5-equal" },
];
const FMIN = 1200 * (4 / 7);
const FMAX = 720;
const KEYS = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote"];
const KEY_LABELS = ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

let activeExplorer: object | null = null;

export function mountExplorer(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.25 : 0.5));
  const sound = new Sound({ level: 1, reverb: 0.16 });
  const badge = tapBadge(container, "tap a pad");
  const me = {};

  let fifth = 696.578;
  let scale: ChainScale = CHAIN_SCALES[1];
  let held: Held | null = null;
  let tune = 0;
  const flash = new Map<number, number>(); // degree index (0…13) → glow
  let pads: { x0: number; x1: number; y0: number; y1: number; d: number }[] = [];
  const shown = new Array(8).fill(0);

  const n = (): number => scale.q.length;
  // pitch of scale degree d (0 = tonic, can exceed n for upper octaves), cents
  const pitch = (d: number): number => {
    const len = n();
    const oct = Math.floor(d / len);
    const q = scale.q[mod(d, len)];
    return mod(q * fifth, 1200) + 1200 * oct;
  };
  const freq = (d: number): number => 261.6256 * Math.pow(2, pitch(d) / 1200);

  const silence = (): void => {
    clearTimeout(tune);
    held?.release(0.2);
    held = null;
    sound.silence();
    improv.set(false);
    improvising = false;
  };
  const guard = frameGuard(silence);

  const hit = (d: number, vel = 0.65): void => {
    sound.note(freq(d), 0, { vel, dur: 1.3, timbre: "keys", bright: 0.5 });
    flash.set(d, 1);
  };
  const chord = (deg: number): void => {
    const ds = [deg, deg + 2, deg + 4];
    held?.release(0.15);
    held = sound.hold(ds.map(freq), { timbre: "organ", level: 0.045, attack: 0.05, cutoff: 4000 });
    ds.forEach((d) => flash.set(d, 1));
    const mine = held;
    window.setTimeout(() => {
      if (held === mine) {
        mine.release(0.4);
        held = null;
      }
    }, 1700);
  };
  const go = (fn: () => void): void => {
    badge.hide();
    activeExplorer = me;
    void unlockAudio().then(fn);
  };

  // controls
  const fSlider = range(shell.controls, {
    label: "size of the fifth",
    min: FMIN,
    max: FMAX,
    step: 0.01,
    value: fifth,
    format: (v) => {
      const d = DETENTS.find((x) => Math.abs(x.f - v) < 0.05);
      return `${v.toFixed(2)}¢${d ? ` · ${d.name}` : ""}`;
    },
    onInput: (v) => {
      const d = DETENTS.find((x) => Math.abs(x.f - v) < 0.4);
      fifth = d ? d.f : v;
      if (d) fSlider.set(d.f);
      detentChips.set(d ? d.name : "");
      retune();
    },
  });
  const detentChips = chips<string>(shell.controls, {
    label: "jump to",
    options: DETENTS.map((d) => ({ value: d.name, text: d.name })),
    value: "¼-comma",
    wide: true,
    onChange: (name) => {
      fifth = DETENTS.find((d) => d.name === name)!.f;
      fSlider.set(fifth);
      retune();
    },
  });
  chips<string>(shell.controls, {
    label: "mode",
    options: CHAIN_SCALES.map((s) => ({ value: s.id, text: s.name })),
    value: scale.id,
    wide: true,
    onChange: (id) => {
      scale = CHAIN_SCALES.find((s) => s.id === id)!;
      silence();
      rebuildChordButtons();
    },
  });
  const retune = (): void => {
    if (held) held.set(currentChord().map(freq), 0.12);
  };
  let lastChordDeg = 0;
  const currentChord = (): number[] => [lastChordDeg, lastChordDeg + 2, lastChordDeg + 4];
  const chordRow = document.createElement("div");
  chordRow.style.display = "contents";
  shell.controls.appendChild(chordRow);
  const rebuildChordButtons = (): void => {
    chordRow.replaceChildren();
    if (n() < 7) return;
    for (let d = 0; d < 7; d++) {
      button(chordRow, `${ROMAN[d]}`, () =>
        go(() => {
          lastChordDeg = d;
          chord(d);
        }),
      ).title = `triad on degree ${d + 1}`;
    }
  };
  rebuildChordButtons();
  let improvising = false;
  const improv = toggle(shell.controls, ["▶ improvise", "■ stop"], (on) => {
    if (!on) {
      silence();
      return;
    }
    go(() => {
      improvising = true;
      let deg = 0;
      let count = 0;
      const stepFn = (): void => {
        if (!improvising) return;
        const r = Math.random();
        deg += r < 0.38 ? 1 : r < 0.76 ? -1 : r < 0.88 ? 2 : -2;
        deg = Math.max(-1, Math.min(n() * 2 - 1, deg));
        count++;
        if (count % 8 === 0) {
          deg = [0, n()].reduce((a, b) => (Math.abs(b - deg) < Math.abs(a - deg) ? b : a));
          if (n() >= 7) {
            lastChordDeg = [0, 3, 4, 0][Math.floor(count / 8) % 4];
            chord(lastChordDeg);
          }
        }
        hit(deg, 0.55);
        tune = window.setTimeout(stepFn, count % 8 === 7 ? 600 : 280);
      };
      stepFn();
    });
  });

  // keyboard: only the explorer you touched last listens
  const onKey = (e: KeyboardEvent): void => {
    if (activeExplorer !== me || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const i = KEYS.indexOf(e.code);
    if (i < 0) return;
    const r = shell.canvas.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    e.preventDefault();
    badge.hide();
    void unlockAudio().then(() => hit(i));
  };
  window.addEventListener("keydown", onKey);
  container.addEventListener("pointerdown", () => (activeExplorer = me));

  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    const pad = pads.find((q) => p.x >= q.x0 && p.x <= q.x1 && p.y >= q.y0 && p.y <= q.y1);
    if (pad) go(() => hit(pad.d));
  });

  shell.setInfo(() => {
    const T = 2 * fifth - 1200;
    const s = 3600 - 5 * fifth;
    const third = 4 * fifth - 2400;
    return `fifth ${fifth.toFixed(2)}¢ · whole step ${T.toFixed(1)}¢ · half step ${s.toFixed(1)}¢ · major third ${third.toFixed(1)}¢ (${signed(third - MAJ3)} from pure)`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const [k, v] of flash) {
        const nv = approach(v, 0, 3.5, dt);
        if (nv < 0.01) flash.delete(k);
        else flash.set(k, nv);
      }
      const len = n();
      for (let d = 0; d <= len; d++) shown[d] = approach(shown[d] || pitch(d), pitch(d), 14, dt);

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const x0 = narrow ? 18 : 40;
      const x1 = w - (narrow ? 18 : 40);
      const X = (c: number): number => x0 + ((x1 - x0) * c) / 1200;

      // ---- the octave as a line, with the 12-equal grid ----
      const lineY = narrow ? 70 : 84;
      text(ctx, "one octave", x0, lineY - 44, { size: 10.5, color: COL.dim });
      ctx.strokeStyle = "rgba(160, 175, 220, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(0), lineY);
      ctx.lineTo(X(1200), lineY);
      ctx.stroke();
      for (let k = 0; k <= 12; k++) {
        ctx.strokeStyle = "rgba(122, 140, 200, 0.22)";
        ctx.beginPath();
        ctx.moveTo(X(k * 100), lineY - 5);
        ctx.lineTo(X(k * 100), lineY + 5);
        ctx.stroke();
      }
      // steps between notes
      for (let d = 0; d < len; d++) {
        const a = shown[d];
        const b = d + 1 < len ? shown[d + 1] : 1200;
        const step = b - a;
        const col: RGB = step < 140 ? hex("#ff8a5c") : step < 230 ? hex("#5fd3c4") : hex("#b48cff");
        ctx.fillStyle = rgba(col, 0.2);
        ctx.fillRect(X(a) + 1, lineY + 10, Math.max(0, X(b) - X(a) - 2), 12);
        if (X(b) - X(a) > 26)
          text(ctx, step.toFixed(0), (X(a) + X(b)) / 2, lineY + 36, { size: narrow ? 9 : 10, color: rgba(col, 1), align: "center", mono: true });
      }
      for (let d = 0; d < len; d++) {
        const c = shown[d];
        const pcGuess = mod(Math.round(c / 100), 12);
        const col: RGB = d === 0 ? [255, 214, 150] : pcColor(pcGuess);
        const f = Math.max(flash.get(d) ?? 0, flash.get(d + len) ?? 0);
        dot(ctx, X(c), lineY, 4.5 + 2.5 * f, col, 1, 3.4 + 3 * f);
        text(ctx, scale.degrees[d], X(c), lineY - 14, { size: narrow ? 10 : 11.5, color: rgba(mixRgb(col, [255, 255, 255], 0.5), 1), align: "center", weight: 700 });
      }
      dot(ctx, X(1200), lineY, 3.5, [255, 214, 150], 0.6, 3);

      // ---- the dial: where this fifth sits between 7-equal and 5-equal ----
      const dialY = lineY + (narrow ? 70 : 78);
      // piecewise scale: the historical tunings all sit between 692 and 704,
      // so that stretch gets most of the width
      const DX = (f: number): number => {
        const u =
          f < 692 ? (0.14 * (f - FMIN)) / (692 - FMIN) : f < 704 ? 0.14 + (0.72 * (f - 692)) / 12 : 0.86 + (0.14 * (f - 704)) / (FMAX - 704);
        return x0 + (x1 - x0) * u;
      };
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      roundRect(ctx, x0, dialY - 4, x1 - x0, 8, 4);
      ctx.fill();
      // pure-third point
      const pureThirdF = (MAJ3 + 2400) / 4;
      glow(ctx, DX(pureThirdF), dialY, 14, hex("#7dd6a0"), 0.4);
      DETENTS.forEach((d, i) => {
        const x = DX(d.f);
        ctx.fillStyle = "rgba(200, 210, 240, 0.5)";
        ctx.fillRect(x - 0.5, dialY - 7, 1, 14);
        const lower = d.name === "31-equal" || d.name === "53-equal";
        const align: CanvasTextAlign = i === 0 ? "left" : i === DETENTS.length - 1 ? "right" : d.name === "¼-comma" || d.name === "Pythagorean" ? "right" : lower ? "left" : "center";
        const near = Math.abs(d.f - fifth) < 0.05;
        if (!narrow || [0, 2, 4, 6, 7].includes(i))
          text(ctx, d.name, x + (align === "left" ? -2 : align === "right" ? 2 : 0), dialY + (lower ? 32 : 20), {
            size: narrow ? 8.5 : 9.5,
            color: near ? "#ffd9a0" : COL.dim,
            align,
            weight: near ? 700 : 400,
          });
      });
      dot(ctx, DX(fifth), dialY, 6, hex("#ffd9a0"), 1, 3);
      text(ctx, "fifth size, 685.7¢ to 720¢ (the middle is stretched; the green glow is where major thirds are pure)", x0, dialY - 14, { size: 10, color: COL.dim });

      // ---- pads: two octaves of the scale ----
      const padTop = dialY + (narrow ? 50 : 52);
      const padBottom = h - (narrow ? 14 : 18);
      const count = Math.min(KEYS.length + 3, len * 2 + 1);
      const rows = narrow ? 2 : 1;
      const perRow = Math.ceil(count / rows);
      const gap = 6;
      const pw = (x1 - x0 - gap * (perRow - 1)) / perRow;
      const ph = (padBottom - padTop - gap * (rows - 1)) / rows;
      pads = [];
      for (let d = 0; d < count; d++) {
        const r = Math.floor(d / perRow);
        const cIdx = d % perRow;
        const px = x0 + cIdx * (pw + gap);
        const py = padTop + r * (ph + gap);
        const f = flash.get(d) ?? 0;
        const pc = mod(Math.round(pitch(d) / 100), 12);
        const col: RGB = mod(d, len) === 0 ? [255, 214, 150] : pcColor(pc);
        ctx.fillStyle = rgba(mixRgb([22, 25, 38], col, 0.18 + 0.5 * f), 1);
        roundRect(ctx, px, py, pw, ph, 8);
        ctx.fill();
        ctx.strokeStyle = rgba(col, 0.35 + 0.5 * f);
        ctx.lineWidth = 1;
        ctx.stroke();
        if (f > 0.02) glow(ctx, px + pw / 2, py + ph / 2, Math.max(pw, ph) * 0.8, col, 0.35 * f);
        text(ctx, scale.degrees[mod(d, len)], px + pw / 2, py + ph * 0.42, { size: Math.min(15, pw * 0.32), color: "#f4f6fc", align: "center", base: "middle", weight: 700 });
        text(ctx, `${pitch(d).toFixed(0)}¢`, px + pw / 2, py + ph * 0.68, { size: Math.min(9.5, pw * 0.2), color: COL.dim, align: "center", base: "middle", mono: true });
        if (d < KEYS.length && !narrow) text(ctx, KEY_LABELS[d], px + 7, py + 13, { size: 9, color: "#7a8199", mono: true });
        pads.push({ x0: px, x1: px + pw, y0: py, y1: py + ph, d });
      }
      if (len < 7) label(ctx, "chord buttons need a seven-note mode", w / 2, padTop - 16, { size: 10 });
    },
    dispose() {
      silence();
      window.removeEventListener("keydown", onKey);
    },
  };
}
