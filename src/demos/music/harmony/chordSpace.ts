// Every three-note chord type on one triangle. A chord's three notes cut the
// octave into three gaps (a, b, c) that add up to 12 semitones; the triangle
// plots every such split. The corners are triple unisons, the edges are
// two-note chords (one gap is zero), and the centre is the augmented triad,
// the only chord that splits the octave evenly. Moving one note by a semitone
// widens one gap and narrows another, which is a step to a neighbouring dot.
//
// Tapping a dot plays that chord type at whichever transposition is the
// smallest voice-leading move from the chord you just heard, so the geometry
// is audible: neighbours really are one semitone apart.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { heatRgb } from "../../../lib/palette";
import { PC_NAMES, chordRoughness, midiToFreq, mod12, voiceLead } from "./theory";
import { COL, clear, figureAspect, font, glow, glowPath, line, refresh, rgba, setActive, smooth, tapToPlay, text, view2d } from "./draw";
import { harmonicTone, startAudio, strip, soon } from "./sound";

type Gaps = [number, number, number];

interface Dot {
  g: Gaps;
  rough: number;
  label: string;
  kind: "maj" | "min" | "aug" | "dim" | "sus" | "cluster" | "other" | "dyad" | "unison";
}

const key = (g: Gaps): string => g.join(",");

function classify(g: Gaps): { label: string; kind: Dot["kind"] } {
  const zeros = g.filter((x) => x === 0).length;
  if (zeros === 2) return { label: "unison", kind: "unison" };
  if (zeros === 1) return { label: "", kind: "dyad" };
  // compare as a cycle: rotations are the same chord type
  const rots = [g, [g[1], g[2], g[0]], [g[2], g[0], g[1]]].map((r) => r.join(","));
  const is = (x: string): boolean => rots.includes(x);
  if (is("4,4,4")) return { label: "aug", kind: "aug" };
  if (is("4,3,5")) return { label: "maj", kind: "maj" };
  if (is("3,4,5")) return { label: "min", kind: "min" };
  if (is("3,3,6")) return { label: "dim", kind: "dim" };
  if (is("5,2,5")) return { label: "sus", kind: "sus" };
  if (is("1,1,10")) return { label: "cluster", kind: "cluster" };
  return { label: "", kind: "other" };
}

// Name a sounding chord (three MIDI notes) by its root, when it has a common name.
function nameOf(notes: number[]): string {
  const pcs = [...new Set(notes.map(mod12))];
  if (pcs.length === 1) return `${PC_NAMES[pcs[0]]} unison`;
  if (pcs.length === 2) {
    const d = mod12(pcs[1] - pcs[0]);
    return `${PC_NAMES[pcs[0]]}–${PC_NAMES[pcs[1]]} (${Math.min(d, 12 - d)} semitones)`;
  }
  const shapes: [number[], string][] = [
    [[0, 4, 7], ""],
    [[0, 3, 7], "m"],
    [[0, 3, 6], "°"],
    [[0, 4, 8], "+"],
    [[0, 5, 7], "sus4"],
    [[0, 1, 2], " cluster"],
  ];
  for (const r of pcs) {
    const set = pcs.map((p) => mod12(p - r)).sort((a, b) => a - b);
    for (const [sh, suf] of shapes) {
      if (sh.join() === set.join()) return `${PC_NAMES[r]}${suf}`;
    }
  }
  return pcs.map((p) => PC_NAMES[p]).join("–");
}

export async function mountChordSpace(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, figureAspect(container, 0.7, 1.12));
  container.classList.add("mh-fig");
  const canvas = shell.canvas;
  const v = view2d(canvas);

  // ---- the dots ---------------------------------------------------------------------
  const dots: Dot[] = [];
  for (let a = 0; a <= 12; a++) {
    for (let b = 0; a + b <= 12; b++) {
      const g: Gaps = [a, b, 12 - a - b];
      const { label, kind } = classify(g);
      // a chord type's roughness: the average of its three close-position
      // voicings (each note taking a turn at the bottom), built up from C4
      const rots: Gaps[] = [g, [g[1], g[2], g[0]], [g[2], g[0], g[1]]];
      const rough = rots.reduce((s, r) => s + chordRoughness([60, 60 + r[0], 60 + r[0] + r[1]].map(midiToFreq)), 0) / 3;
      dots.push({ g, rough, label, kind });
    }
  }
  const interior = dots.filter((d) => d.kind !== "dyad" && d.kind !== "unison");
  const rMin = Math.min(...interior.map((d) => d.rough));
  const rMax = Math.max(...interior.map((d) => d.rough));
  const byKey = new Map(dots.map((d) => [key(d.g), d]));

  // ---- state ---------------------------------------------------------------------------
  let cur: Gaps = [4, 3, 5];
  let notes = [60, 64, 67]; // what's sounding, as voices
  let lastMove = "";
  const path: { g: Gaps; at: number }[] = [{ g: cur, at: performance.now() }];
  let hover: Gaps | null = null;
  let seq: Gaps[] = [];
  let seqTimer = 0;

  // ---- sound ----------------------------------------------------------------------------------
  let tone: ReturnType<typeof harmonicTone> | null = null;
  const ensure = async (): Promise<void> => {
    await startAudio();
    if (!tone) tone = harmonicTone(strip({ db: -1, reverb: 0.2 }).input, 8);
  };
  const sound = (): void => {
    if (!tone) return;
    tone.release();
    const t = soon();
    notes.forEach((m, k) => tone!.playHz(midiToFreq(m), 1.9, t + k * 0.006, 0.72));
  };

  // realise a chord type at the transposition nearest the current notes
  // (ties go to a chord you didn't just come from, so walks keep moving)
  const pcKey = (ns: number[]): string => [...new Set(ns.map(mod12))].sort((a, b) => a - b).join(",");
  let previous = "";
  const moveTo = (g: Gaps): void => {
    let best = notes;
    let bestCost = Infinity;
    for (let t = 0; t < 12; t++) {
      const pcs = [t, t + g[0], t + g[0] + g[1]].map(mod12);
      const cand = voiceLead(notes, pcs, 53, 79);
      const cost =
        cand.reduce((s, m, k) => s + Math.abs(m - notes[k]), 0) +
        Math.abs(cand[0] + cand[1] + cand[2] - 192) * 0.01 +
        (pcKey(cand) === previous ? 0.5 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
    const moves: string[] = [];
    best.forEach((m, k) => {
      if (m !== notes[k]) moves.push(`${PC_NAMES[mod12(notes[k])]}→${PC_NAMES[mod12(m)]}`);
    });
    const total = best.reduce((s, m, k) => s + Math.abs(m - notes[k]), 0);
    const from = nameOf(notes);
    previous = pcKey(notes);
    notes = best;
    lastMove = moves.length ? `${from} → ${nameOf(notes)}: ${moves.join(", ")} (${total} semitone${total === 1 ? "" : "s"})` : `${nameOf(notes)}`;
    cur = g;
    path.push({ g, at: performance.now() });
    if (path.length > 10) path.shift();
    sound();
  };

  const runSeq = (gs: Gaps[], ms: number): void => {
    clearInterval(seqTimer);
    seq = gs.slice();
    const tick = (): void => {
      const g = seq.shift();
      if (!g) {
        clearInterval(seqTimer);
        syncBtns();
        return;
      }
      moveTo(g);
    };
    tick();
    seqTimer = window.setInterval(tick, ms);
  };

  const guard = frameGuard(() => {
    clearInterval(seqTimer);
    seq = [];
    tone?.release();
    syncBtns();
  });
  const tap = tapToPlay(container, "Tap to hear C major", () => {
    void ensure().then(() => {
      tap.hide();
      sound();
    });
  }, 0.9);

  // ---- controls ---------------------------------------------------------------------------------
  const HEX: Gaps[] = [
    [4, 3, 5],
    [3, 4, 5],
    [3, 5, 4],
    [4, 5, 3],
    [5, 4, 3],
    [5, 3, 4],
    [4, 3, 5],
  ];
  const btns: HTMLButtonElement[] = [];
  const syncBtns = (): void => btns.forEach((b) => setActive(b, false));
  const start = (gs: Gaps[], ms: number, b: HTMLButtonElement): void => {
    void ensure().then(() => {
      tap.hide();
      notes = [60, 64, 67];
      cur = [4, 3, 5];
      previous = "";
      syncBtns();
      setActive(b, true);
      runSeq(gs, ms);
    });
  };
  const b1 = shell.button("augmented → major or minor", () =>
    start(
      [
        [4, 4, 4],
        [4, 3, 5],
        [4, 4, 4],
        [4, 5, 3],
      ],
      1500,
      b1,
    ),
  );
  const b2 = shell.button("circle the augmented triad", () => start(HEX, 1350, b2));
  btns.push(b1, b2);
  shell.button("reset to C major", () => {
    void ensure().then(() => {
      tap.hide();
      clearInterval(seqTimer);
      syncBtns();
      notes = [60, 64, 67];
      cur = [4, 3, 5];
      previous = "";
      lastMove = "C";
      path.length = 0;
      path.push({ g: cur, at: performance.now() });
      sound();
    });
  });

  shell.setInfo(() => {
    const d = byKey.get(key(cur))!;
    const gaps = `gaps ${cur[0]} + ${cur[1]} + ${cur[2]}`;
    return `${lastMove || "C major (C–E–G)"} · ${gaps} · roughness ${d.rough.toFixed(2)}`;
  });

  // ---- geometry ------------------------------------------------------------------------------------
  let A: [number, number] = [0, 0];
  let B: [number, number] = [0, 0];
  let C: [number, number] = [0, 0];
  const P = (g: Gaps): [number, number] => [
    (g[0] * A[0] + g[1] * B[0] + g[2] * C[0]) / 12,
    (g[0] * A[1] + g[1] * B[1] + g[2] * C[1]) / 12,
  ];
  let dotR = 6;

  const pickAt = (cx: number, cy: number): Gaps | null => {
    const r = canvas.getBoundingClientRect();
    const x = ((cx - r.left) / r.width) * v.w;
    const y = ((cy - r.top) / r.height) * v.h;
    let best: Gaps | null = null;
    let bd = Infinity;
    for (const d of dots) {
      const [px, py] = P(d.g);
      const dd = Math.hypot(px - x, py - y);
      if (dd < bd) {
        bd = dd;
        best = d.g;
      }
    }
    return bd < dotR * 2.6 ? best : null;
  };
  canvas.addEventListener("pointermove", (e) => (hover = pickAt(e.clientX, e.clientY)));
  canvas.addEventListener("pointerleave", () => (hover = null));
  canvas.addEventListener("pointerdown", (e) => {
    const g = pickAt(e.clientX, e.clientY);
    if (!g) return;
    clearInterval(seqTimer);
    syncBtns();
    void ensure().then(() => {
      tap.hide();
      moveTo(g);
    });
  });

  const heat = (r: number): string => {
    const t = Math.min(1, Math.max(0, (r - rMin) / (rMax - rMin)));
    const [R, G, Bc] = heatRgb(0.15 + 0.85 * t);
    return `#${[R, G, Bc].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
  };

  const draw = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    const narrow = w / px < 520;
    clear(v, "#0b0d16", "#06070b");
    const now = performance.now();

    // fit the triangle; leave room for the legend
    const side = Math.min(w * (narrow ? 0.86 : 0.6), (h - (narrow ? 96 : 40) * px) / (Math.sqrt(3) / 2));
    const cx = narrow ? w / 2 : w * 0.42;
    const cy = (narrow ? 44 : 18) * px + (side * Math.sqrt(3)) / 2;
    A = [cx, cy - (side * Math.sqrt(3)) / 2];
    B = [cx - side / 2, cy];
    C = [cx + side / 2, cy];
    dotR = Math.max(4.5 * px, side / 44);

    // triangle frame
    ctx.beginPath();
    ctx.moveTo(A[0], A[1]);
    ctx.lineTo(B[0], B[1]);
    ctx.lineTo(C[0], C[1]);
    ctx.closePath();
    ctx.fillStyle = "rgba(122, 162, 255, 0.025)";
    ctx.fill();
    ctx.strokeStyle = rgba("#8a91a5", 0.3);
    ctx.lineWidth = 1 * px;
    ctx.stroke();

    // mirror lines (two gaps equal): a chord on one equals its own upside-down
    ctx.setLineDash([3 * px, 5 * px]);
    for (const [p, q] of [
      [A, [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2]],
      [B, [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2]],
      [C, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]],
    ] as [number, number][][]) {
      line(ctx, p[0], p[1], q[0], q[1], rgba("#c9d1ea", 0.14), 1 * px);
    }
    ctx.setLineDash([]);

    // neighbour links of the current chord (one semitone away)
    const nb: Gaps[] = [];
    const deltas: Gaps[] = [
      [1, -1, 0],
      [-1, 1, 0],
      [0, 1, -1],
      [0, -1, 1],
      [1, 0, -1],
      [-1, 0, 1],
    ];
    for (const d of deltas) {
      const g: Gaps = [cur[0] + d[0], cur[1] + d[1], cur[2] + d[2]];
      if (g.every((x) => x >= 0)) nb.push(g);
    }
    const [ux, uy] = P(cur);
    for (const g of nb) {
      const [nx, ny] = P(g);
      line(ctx, ux, uy, nx, ny, rgba(COL.white, 0.22), 1.2 * px);
    }

    // path you walked
    for (let k = 1; k < path.length; k++) {
      const [x0, y0] = P(path[k - 1].g);
      const [x1, y1] = P(path[k].g);
      const age = path.length - 1 - k;
      glowPath(
        ctx,
        (c) => {
          c.moveTo(x0, y0);
          c.lineTo(x1, y1);
        },
        COL.white,
        1.5 * px,
        Math.max(0.1, 0.8 - age * 0.12),
      );
    }

    // dots
    for (const d of dots) {
      const [x, y] = P(d.g);
      const isCur = key(d.g) === key(cur);
      const isHover = hover && key(d.g) === key(hover);
      if (d.kind === "dyad" || d.kind === "unison") {
        ctx.beginPath();
        ctx.arc(x, y, dotR * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = rgba("#8a91a5", 0.45);
        ctx.fill();
      } else {
        const col = heat(d.rough);
        if (d.kind === "maj" || d.kind === "min" || d.kind === "aug") glow(ctx, x, y, dotR * 3.2, d.kind === "min" ? COL.minor : d.kind === "aug" ? COL.aug : COL.major, 0.35);
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        if (d.kind === "maj" || d.kind === "min" || d.kind === "aug") {
          ctx.strokeStyle = d.kind === "min" ? COL.minor : d.kind === "aug" ? COL.aug : COL.major;
          ctx.lineWidth = 2 * px;
          ctx.stroke();
        }
      }
      if (isHover && !isCur) {
        ctx.beginPath();
        ctx.arc(x, y, dotR * 1.7, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(COL.white, 0.6);
        ctx.lineWidth = 1.2 * px;
        ctx.stroke();
      }
    }

    // current chord marker
    {
      const arrive = path[path.length - 1].at;
      const pulse = 1 - smooth((now - arrive) / 700);
      glow(ctx, ux, uy, dotR * (4 + 3 * pulse), COL.white, 0.7);
      ctx.beginPath();
      ctx.arc(ux, uy, dotR * 1.55, 0, Math.PI * 2);
      ctx.strokeStyle = COL.white;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }

    // labels
    ctx.font = font(px, narrow ? 9.5 : 11, 700);
    for (const d of dots) {
      if (!d.label || d.kind === "unison") continue;
      const [x, y] = P(d.g);
      const col = d.kind === "maj" ? COL.major : d.kind === "min" ? COL.minor : d.kind === "aug" ? COL.aug : COL.muted;
      // push labels outward from the centre so they don't sit on the dots
      const [mx, my] = P([4, 4, 4]);
      let dx = x - mx;
      let dy = y - my;
      const L = Math.hypot(dx, dy) || 1;
      dx /= L;
      dy /= L;
      const off = d.kind === "aug" ? 0 : dotR * 2.3;
      const lx = d.kind === "aug" ? x : x + dx * off;
      const ly = d.kind === "aug" ? y - dotR * 2.4 : y + dy * off;
      text(ctx, d.label, lx, ly, { color: col, align: "center", alpha: 0.95 });
    }
    // corners and edges
    const cfont = font(px, narrow ? 9 : 10, 600);
    text(ctx, "unison", A[0], A[1] - 10 * px, { color: COL.muted, align: "center", font: cfont });
    text(ctx, "unison", B[0] - 4 * px, B[1] + 13 * px, { color: COL.muted, align: "center", font: cfont });
    text(ctx, "unison", C[0] + 4 * px, C[1] + 13 * px, { color: COL.muted, align: "center", font: cfont });
    text(ctx, "two-note chords along the edges", (B[0] + C[0]) / 2, B[1] + 13 * px, { color: COL.dim, align: "center", font: cfont });

    // legend (right side on wide screens, under the triangle on phones)
    const lgx = narrow ? 12 * px : w * 0.78;
    const lgy = narrow ? 12 * px : h * 0.22;
    const lgw = narrow ? 84 * px : w * 0.18;
    text(ctx, "roughness", lgx, lgy, { color: COL.muted, font: font(px, 10, 600) });
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = heat(rMin + ((rMax - rMin) * k) / 39);
      ctx.fillRect(lgx + (lgw * k) / 40, lgy + 9 * px, lgw / 40 + 1, 7 * px);
    }
    text(ctx, "smooth", lgx, lgy + 26 * px, { color: COL.dim, font: font(px, 9, 600) });
    text(ctx, "rough", lgx + lgw, lgy + 26 * px, { color: COL.dim, align: "right", font: font(px, 9, 600) });
    if (!narrow) {
      const notesTxt = notes.map((m) => PC_NAMES[mod12(m)]).join(" ");
      text(ctx, nameOf(notes), lgx, lgy + 66 * px, { color: COL.bright, font: font(px, 20, 700) });
      text(ctx, notesTxt, lgx, lgy + 90 * px, { color: COL.muted, font: font(px, 12, 600, true) });
      text(ctx, `${cur[0]} + ${cur[1]} + ${cur[2]}`, lgx, lgy + 110 * px, { color: COL.muted, font: font(px, 12, 600, true) });
      text(ctx, "white lines: one semitone away", lgx, lgy + 140 * px, { color: COL.dim, font: font(px, 9.5, 600) });
    }
  };

  return {
    frame() {
      shell.tick();
      guard.pulse();
      draw();
    },
    dispose() {
      clearInterval(seqTimer);
      tone?.release();
    },
  };
}
