// Fig. 5 of Part 5: scales that don't live on the twelve-note grid. Each
// scale's notes are pins at their tuned positions above a strip of the
// twelve equal-tempered semitones, so you can see which ones fall between
// the piano's keys and by how much. Maqam intonation follows the pitches
// MaqamWorld uses for its examples; the rāga notes are tuned to simple ratios
// against the drone; slendro is the average of Surjodiningrat's measurements
// of Javanese gamelan, and pelog is Braun's nine-step model of the same data.

import { Shell, type Demo } from "../../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../../lib/audio";
import { PC_NAMES, mod } from "./theory";
import { COL, Surface, approach, dot, glow, hex, label, mixRgb, rgba, roundRect, signed, text, type RGB } from "./draw";
import { Sound, type Held, type Timbre } from "./sound";
import { button, chips, tapBadge, toggle } from "./ui";

interface Note {
  c: number; // cents above the tonic
  name: string;
  sub?: string;
  alt?: boolean; // only used descending
  andolan?: boolean;
}

interface World {
  id: string;
  chip: string;
  title: string;
  tradition: "maqam" | "raga" | "gamelan";
  tonicPc: number;
  octave: number;
  notes: Note[];
  up: number[]; // indices into notes; notes.length = octave, −1 … = below
  down: number[];
  drone: "tanpura" | "tonic" | null;
  timbre: Timbre;
  caption: string;
  subsets?: { id: string; text: string; tones: number[] }[];
}

const SCALES: World[] = [
  {
    id: "rast",
    chip: "maqam Rast",
    title: "Maqam Rast on C",
    tradition: "maqam",
    tonicPc: 0,
    octave: 1200,
    notes: [
      { c: 0, name: "C" },
      { c: 203.9, name: "D" },
      { c: 354.6, name: "E𝄳" },
      { c: 498.0, name: "F" },
      { c: 702.0, name: "G" },
      { c: 905.9, name: "A" },
      { c: 996.1, name: "B♭", alt: true, sub: "down" },
      { c: 1063.7, name: "B𝄳" },
    ],
    up: [0, 1, 2, 3, 4, 5, 7, 8],
    down: [8, 6, 5, 4, 3, 2, 1, 0],
    drone: "tonic",
    timbre: "keys",
    caption: "jins Rast on C and again on G; coming down, the seventh drops to B♭",
  },
  {
    id: "bayati",
    chip: "maqam Bayati",
    title: "Maqam Bayati on D",
    tradition: "maqam",
    tonicPc: 2,
    octave: 1200,
    notes: [
      { c: 0, name: "D" },
      { c: 150.7, name: "E𝄳" },
      { c: 280.9, name: "F" },
      { c: 498.1, name: "G" },
      { c: 702.0, name: "A" },
      { c: 792.2, name: "B♭" },
      { c: 996.1, name: "C" },
    ],
    up: [0, 1, 2, 3, 4, 5, 6, 7],
    down: [7, 6, 5, 4, 3, 2, 1, 0],
    drone: "tonic",
    timbre: "keys",
    caption: "jins Bayati on D (a neutral second, then a small step), jins Nahawand on G",
  },
  {
    id: "hijaz",
    chip: "maqam Hijaz",
    title: "Maqam Hijaz on D",
    tradition: "maqam",
    tonicPc: 2,
    octave: 1200,
    notes: [
      { c: 0, name: "D" },
      { c: 123.4, name: "E♭" },
      { c: 425.2, name: "F♯" },
      { c: 498.1, name: "G" },
      { c: 702.0, name: "A" },
      { c: 792.2, name: "B♭" },
      { c: 996.1, name: "C" },
    ],
    up: [0, 1, 2, 3, 4, 5, 6, 7],
    down: [7, 6, 5, 4, 3, 2, 1, 0],
    drone: "tonic",
    timbre: "keys",
    caption: "jins Hijaz on D: a small step, a wide step of about 300¢, a small step; jins Nahawand on G",
  },
  {
    id: "yaman",
    chip: "rāga Yaman",
    title: "Rāga Yaman, Sa on C",
    tradition: "raga",
    tonicPc: 0,
    octave: 1200,
    notes: [
      { c: 0, name: "Sa" },
      { c: 203.9, name: "Re" },
      { c: 386.3, name: "Ga" },
      { c: 590.2, name: "Ma", sub: "tīvra" },
      { c: 702.0, name: "Pa" },
      { c: 884.4, name: "Dha" },
      { c: 1088.3, name: "Ni" },
    ],
    up: [-1, 1, 2, 3, 5, 6, 7],
    down: [7, 6, 5, 4, 3, 2, 1, 0],
    drone: "tanpura",
    timbre: "keys",
    caption: "evening rāga; ascends Ni Re Ga Ma Dha Ni Sa, descends with Pa; notes tuned to ratios against Sa",
  },
  {
    id: "bhairav",
    chip: "rāga Bhairav",
    title: "Rāga Bhairav, Sa on C",
    tradition: "raga",
    tonicPc: 0,
    octave: 1200,
    notes: [
      { c: 0, name: "Sa" },
      { c: 111.7, name: "Re", sub: "komal", andolan: true },
      { c: 386.3, name: "Ga" },
      { c: 498.0, name: "Ma" },
      { c: 702.0, name: "Pa" },
      { c: 813.7, name: "Dha", sub: "komal", andolan: true },
      { c: 1088.3, name: "Ni" },
    ],
    up: [0, 1, 2, 3, 4, 5, 6, 7],
    down: [7, 6, 5, 4, 3, 2, 1, 0],
    drone: "tanpura",
    timbre: "keys",
    caption: "morning rāga; komal Re and komal Dha are played with a slow sway, andolan",
  },
  {
    id: "slendro",
    chip: "slendro",
    title: "Slendro (Javanese gamelan)",
    tradition: "gamelan",
    tonicPc: 0,
    octave: 1208,
    notes: [
      { c: 0, name: "1", sub: "ji" },
      { c: 231, name: "2", sub: "ro" },
      { c: 474, name: "3", sub: "lu" },
      { c: 717, name: "5", sub: "ma" },
      { c: 955, name: "6", sub: "nem" },
    ],
    up: [0, 1, 2, 3, 4, 5],
    down: [5, 4, 3, 2, 1, 0],
    drone: null,
    timbre: "metal",
    caption: "five nearly equal steps (231–253¢); average of measured Central Javanese sets, octave 1208¢",
  },
  {
    id: "pelog",
    chip: "pelog",
    title: "Pelog (Javanese gamelan)",
    tradition: "gamelan",
    tonicPc: 0,
    octave: 1200,
    notes: [
      { c: 0, name: "1", sub: "ji" },
      { c: 133, name: "2", sub: "ro" },
      { c: 267, name: "3", sub: "lu" },
      { c: 533, name: "4", sub: "pat" },
      { c: 667, name: "5", sub: "ma" },
      { c: 800, name: "6", sub: "nem" },
      { c: 933, name: "7", sub: "pi" },
    ],
    up: [0, 1, 2, 3, 4, 5, 6, 7],
    down: [7, 6, 5, 4, 3, 2, 1, 0],
    drone: null,
    timbre: "metal",
    caption: "seven tones; pieces mostly use five. Modelled as steps of a nine-step division (133¢)",
    subsets: [
      { id: "all", text: "all seven", tones: [0, 1, 2, 3, 4, 5, 6] },
      { id: "nem", text: "pathet nem / lima: 1 2 3 5 6", tones: [0, 1, 2, 4, 5] },
      { id: "barang", text: "pathet barang: 2 3 5 6 7", tones: [1, 2, 4, 5, 6] },
    ],
  },
];

// Draw a note name, turning the half-flat (𝄳, missing from most fonts) into
// a flat with a slash through it.
function noteName(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color: string): void {
  if (!name.includes("𝄳")) {
    text(ctx, name, x, y, { size, color, align: "center", weight: 700 });
    return;
  }
  const shown = name.replace("𝄳", "♭");
  ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
  const wAll = ctx.measureText(shown).width;
  const wFlat = ctx.measureText("♭").width;
  text(ctx, shown, x, y, { size, color, align: "center", weight: 700 });
  const fx = x + wAll / 2 - wFlat / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(fx - size * 0.28, y - size * 0.18);
  ctx.lineTo(fx + size * 0.28, y - size * 0.62);
  ctx.stroke();
}

const TRAD_COLOR: Record<World["tradition"], RGB> = {
  maqam: hex("#ffb86b"),
  raga: hex("#ff8ab0"),
  gamelan: hex("#7fd8c8"),
};

export function mountWorldScales(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.02 : 0.42));
  const sound = new Sound({ level: 1, reverb: 0.2 });
  const badge = tapBadge(container, "tap for sound");

  let sc = SCALES[0];
  let subset = "all";
  const flash = new Map<number, number>();
  let drone: Held | null = null;
  let tanpura = 0;
  let droneOn = false;
  let pins: { x: number; y: number; i: number }[] = [];

  const base = (): number => 261.6256 * Math.pow(2, sc.tonicPc / 12);
  const centsOf = (i: number): number => {
    if (i < 0) return sc.notes[mod(i, sc.notes.length)].c - sc.octave;
    if (i >= sc.notes.length) return sc.octave + sc.notes[i - sc.notes.length].c;
    return sc.notes[i].c;
  };
  const allowed = (i: number): boolean => {
    const sub = sc.subsets?.find((s) => s.id === subset);
    if (!sub || sub.id === "all") return true;
    return sub.tones.includes(mod(i, sc.notes.length));
  };

  const stopDrone = (): void => {
    drone?.release(0.6);
    drone = null;
    clearInterval(tanpura);
    tanpura = 0;
  };
  const silence = (): void => {
    stopDrone();
    sound.silence();
    if (droneOn) {
      droneOn = false;
      droneBtn.set(false);
    }
  };
  const guard = frameGuard(silence);

  const startDrone = (): void => {
    stopDrone();
    if (!sc.drone) return;
    const tonic = base() / 2;
    if (sc.drone === "tanpura") {
      // Pa Sa Sa Sa: the low fifth, two middle Sas, the low Sa
      const pluck = (): void => {
        const t0 = sound.now() + 0.05;
        [tonic * 0.75, tonic, tonic * 1.0015, tonic / 2].forEach((f, i) =>
          sound.note(f, t0 + i * 0.62, { timbre: "tanpura", dur: 4.2, vel: i === 3 ? 0.42 : 0.32, bright: 0.85 }),
        );
      };
      pluck();
      tanpura = window.setInterval(pluck, 2480);
    } else {
      drone = sound.hold([tonic / 2, tonic], { timbre: "reed", level: 0.035, attack: 0.6, cutoff: 1400 });
    }
  };

  const playNote = (i: number, at = 0, dur = 0.9): void => {
    const n = sc.notes[mod(i, sc.notes.length)];
    const f = base() * Math.pow(2, centsOf(i) / 1200);
    sound.note(f, at, {
      timbre: sc.timbre,
      dur: sc.timbre === "metal" ? 2.2 : dur,
      vel: 0.62,
      bright: 0.45,
      vibrato: n.andolan && i >= 0 && i < sc.notes.length ? { rate: 1.1, depthCents: 22, delay: 0.12 } : undefined,
    });
    const delay = Math.max(0, (at - sound.now()) * 1000);
    window.setTimeout(() => flash.set(i < 0 || i >= sc.notes.length ? mod(i, sc.notes.length) : i, 1), delay);
  };
  const playUpDown = (): void => {
    sound.silence(0.03);
    const step = sc.tradition === "raga" ? 0.5 : 0.36;
    const t0 = sound.now() + 0.08;
    const seq = [...sc.up, ...sc.down.slice(1)].filter((i) => allowed(i));
    seq.forEach((i, k) => playNote(i, t0 + k * step, step * 1.5));
  };
  const go = (fn: () => void): void => {
    badge.hide();
    void unlockAudio().then(fn);
  };

  const scaleChips = chips(shell.controls, {
    label: "scale",
    options: SCALES.map((s) => ({ value: s.id, text: s.chip })),
    value: sc.id,
    wide: true,
    onChange: (id) => {
      silence();
      sc = SCALES.find((s) => s.id === id)!;
      subset = "all";
      subChips.el.style.display = sc.subsets ? "" : "none";
      subChips.set("all");
      droneBtn.el.disabled = !sc.drone;
      droneBtn.el.textContent = sc.drone === "tanpura" ? "tanpura drone" : sc.drone ? "drone on the tonic" : "no drone";
    },
  });
  void scaleChips;
  const subChips = chips(shell.controls, {
    label: "pelog subset",
    options: SCALES[6].subsets!.map((s) => ({ value: s.id, text: s.text })),
    value: "all",
    onChange: (v) => (subset = v),
  });
  subChips.el.style.display = "none";
  button(shell.controls, "▶ up and down", () => go(playUpDown));
  const droneBtn = toggle(shell.controls, ["drone on the tonic", "drone on"], (on) => {
    droneOn = on;
    if (on) go(startDrone);
    else stopDrone();
  });

  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    let best = -1;
    let bd = 26;
    for (const pin of pins) {
      const d = Math.hypot(pin.x - p.x, pin.y - p.y);
      if (d < bd) {
        bd = d;
        best = pin.i;
      }
    }
    if (best >= 0) go(() => playNote(best));
  });

  shell.setInfo(() => {
    const steps = sc.notes
      .filter((n) => !n.alt)
      .map((n, i, arr) => (i + 1 < arr.length ? arr[i + 1].c : sc.octave) - n.c);
    return `${sc.title} · steps ${steps.map((s) => s.toFixed(0)).join(" ")} ¢`;
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
        const nv = approach(v, 0, 3, dt);
        if (nv < 0.01) flash.delete(k);
        else flash.set(k, nv);
      }

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const x0 = narrow ? 16 : 30;
      const x1 = w - (narrow ? 16 : 30);
      const span = sc.octave + 100; // show a little past the octave
      const X = (c: number): number => x0 + ((x1 - x0) * (c + 50)) / span;
      const stripY = h * 0.7;
      const stripH = narrow ? 44 : 56;
      const tcol = TRAD_COLOR[sc.tradition];

      text(ctx, sc.title, x0, narrow ? 24 : 30, { size: narrow ? 14 : 16, color: "#f4f6fc", weight: 700 });
      // the caption wraps to the figure width (two or three lines on a phone)
      ctx.font = `400 ${narrow ? 10 : 11}px ui-sans-serif, system-ui, sans-serif`;
      const capLines: string[] = [];
      for (const word of sc.caption.split(" ")) {
        const cur = capLines.length ? capLines[capLines.length - 1] : "";
        if (cur && ctx.measureText(`${cur} ${word}`).width > x1 - x0) capLines.push(word);
        else if (capLines.length) capLines[capLines.length - 1] = cur ? `${cur} ${word}` : word;
        else capLines.push(word);
      }
      capLines.forEach((ln, i) => text(ctx, ln, x0, (narrow ? 42 : 50) + i * 13, { size: narrow ? 10 : 11, color: COL.dim }));
      const capExtra = (capLines.length - 1) * 13;

      // the twelve-note grid: one cell per equal-tempered semitone
      for (let s = 0; s <= 12; s++) {
        const pc = mod(sc.tonicPc + s, 12);
        const black = [1, 3, 6, 8, 10].includes(pc);
        const xa = X(s * 100 - 50);
        const xb = X(s * 100 + 50);
        ctx.fillStyle = black ? "#1a1d2b" : "#c9cedd";
        roundRect(ctx, xa + 1, stripY, xb - xa - 2, stripH, 4);
        ctx.fill();
        text(ctx, PC_NAMES[pc], (xa + xb) / 2, stripY + stripH - 8, {
          size: narrow ? 9 : 10.5,
          color: black ? "#9aa2c0" : "#2a2f42",
          align: "center",
          weight: 600,
        });
      }
      text(ctx, "the piano's twelve notes", x0, stripY + stripH + 18, { size: 10, color: COL.dim });

      // cents ruler under the pins
      const rulerY = stripY - 14;
      ctx.strokeStyle = "rgba(160, 175, 220, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(-50), rulerY);
      ctx.lineTo(X(sc.octave + 50), rulerY);
      ctx.stroke();
      for (let c = 0; c <= 1200; c += 50) {
        const major = c % 100 === 0;
        ctx.strokeStyle = major ? "rgba(160, 175, 220, 0.35)" : "rgba(160, 175, 220, 0.18)";
        ctx.beginPath();
        ctx.moveTo(X(c), rulerY - (major ? 4 : 2));
        ctx.lineTo(X(c), rulerY + (major ? 4 : 2));
        ctx.stroke();
      }

      // pins
      pins = [];
      const top = (narrow ? 70 : 82) + capExtra;
      const rows = 2;
      const visible = sc.notes.map((n, i) => ({ n, i })).concat([{ n: { c: sc.octave, name: sc.notes[0].name, sub: sc.notes[0].sub }, i: sc.notes.length }]);
      visible.forEach(({ n, i }, k) => {
        const on = allowed(i);
        const x = X(n.c);
        const row = k % rows;
        const py = top + row * (narrow ? 44 : 50) + 16;
        const f = flash.get(i === sc.notes.length ? 0 : i) ?? 0;
        const col = n.alt ? mixRgb(tcol, [150, 160, 200], 0.5) : tcol;
        const a = on ? 1 : 0.25;
        ctx.strokeStyle = rgba(col, 0.45 * a);
        ctx.lineWidth = 1.2;
        ctx.setLineDash(n.alt ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(x, py + 12);
        ctx.lineTo(x, stripY - 2);
        ctx.stroke();
        ctx.setLineDash([]);
        glow(ctx, x, stripY + 4, 16 + 10 * f, col, (0.25 + 0.5 * f) * a);
        dot(ctx, x, rulerY, 3.4 + 2 * f, col, a, 3);
        // label block
        const nearest = Math.round(n.c / 100);
        const dev = n.c - nearest * 100;
        const etName = PC_NAMES[mod(sc.tonicPc + nearest, 12)];
        noteName(ctx, n.name, x, py - 4, narrow ? 13 : 15, rgba(mixRgb(col, [255, 255, 255], 0.45), a));
        if (n.sub) text(ctx, n.sub, x, py + 9, { size: 9.5, color: rgba(col, 0.85 * a), align: "center" });
        const devStr = Math.abs(dev) < 0.5 ? `= ${etName}` : `${etName} ${signed(dev, 0)}`;
        const ly = rulerY - 16 - row * 17;
        label(ctx, narrow ? `${n.c.toFixed(0)}¢` : `${n.c.toFixed(0)}¢ · ${devStr}`, x, ly, {
          size: narrow ? 8.5 : 9.5,
          mono: true,
          color: Math.abs(dev) > 20 ? "#ffd2a8" : "#c8d0e6",
          bg: "rgba(8, 9, 14, 0.78)",
        });
        pins.push({ x, y: py, i: i === sc.notes.length ? sc.notes.length : i });
        pins.push({ x, y: ly, i: i === sc.notes.length ? sc.notes.length : i });
      });
    },
    dispose() {
      silence();
    },
  };
}
