// The Tonnetz: pitch classes on a triangular lattice (fifths left to right,
// major thirds up-right, minor thirds down-right), so every triangle is a
// major or minor triad and every pair of triangles sharing an edge is one of
// the neo-Riemannian moves P, L or R. A walker steps from triangle to
// triangle; one note moves each time and the other two stay put, which you
// can see (a spark jumps one corner) and hear (one voice moves).
//
// Used twice: as the chords hero (a calm silent walk until you tap, then the
// walk plays) and as an in-article figure with P/L/R buttons and cycles.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import {
  type Cell,
  type PLR,
  type Triad,
  cellAt,
  cellCenter,
  cellPLR,
  cellTriad,
  cellVerts,
  latticePc,
  latticeXY,
  PC_NAMES,
  triadName,
  triadPcs,
  voiceLead,
  mod12,
} from "./theory";
import { COL, clear, figureAspect, font, glow, glowPath, refresh, rgba, setActive, smooth, tapToPlay, text, view2d } from "./draw";
import { Clock, bass, epiano, pad, startAudio, strip, type Inst, soon } from "./sound";

interface Step {
  cell: Cell;
  at: number; // performance.now() of arrival
  op: PLR | null;
}

interface Phrase {
  name: string;
  ops: PLR[];
}

const CYCLES: Record<string, Phrase> = {
  hex: { name: "hexatonic cycle: P, L, P, L…", ops: ["P", "L", "P", "L", "P", "L"] },
  oct: { name: "octatonic cycle: P, R, P, R…", ops: ["P", "R", "P", "R", "P", "R", "P", "R"] },
  lr: { name: "L–R chain: all 24 triads", ops: Array.from({ length: 24 }, (_, k) => (k % 2 === 0 ? "L" : "R") as PLR) },
};

export interface TonnetzOpts {
  hero?: boolean;
}

export async function mountTonnetz(container: HTMLElement, opts: TonnetzOpts = {}): Promise<Demo> {
  const hero = !!opts.hero;
  const shell = new Shell(container, hero ? 0.56 : figureAspect(container, 0.6, 0.95));
  const canvas = shell.canvas;
  const v = view2d(canvas);
  if (!hero) container.classList.add("mh-fig");

  // ---- state -------------------------------------------------------------------
  let cur: Cell = { i: 0, j: 0, up: true }; // C major
  const trail: Step[] = [{ cell: cur, at: performance.now(), op: null }];
  let spark: { from: [number, number]; to: [number, number]; at: number } | null = null;
  let cam = cellCenter(cur);
  let hover: Cell | null = null;
  let voicing = [60, 64, 67];
  let queue: PLR[] = [];
  let phraseName = "";
  let lastOp: PLR | null = null;
  let nextIdle = performance.now() + 1800;
  let playing = false; // the audible walk
  let cycleRun = false; // a figure cycle in progress

  // ---- audio (built on first gesture) -----------------------------------------------
  let keys: Inst | null = null;
  let warm: Inst | null = null;
  let low: Inst | null = null;
  const ensureAudio = async (): Promise<void> => {
    await startAudio();
    if (keys) return;
    const sk = strip({ db: hero ? -2 : 0, reverb: 0.32, pan: -0.05 });
    const sp = strip({ db: hero ? -3 : -4, reverb: 0.45 });
    const sb = strip({ db: -3 });
    keys = epiano(sk.input, -13);
    warm = pad(sp.input, -27, 1100);
    low = bass(sb.input, -17);
  };

  const sound = (moved: number[]): void => {
    if (!keys || !warm || !low) return;
    const t = soon();
    const tri = cellTriad(cur);
    const order = voicing.map((m, k) => ({ m, k })).sort((a, b) => a.m - b.m);
    order.forEach(({ m, k }, n) => {
      const isMoved = moved.includes(k);
      keys!.play(m, 2.2, t + n * 0.012 + Math.random() * 0.006, isMoved ? 0.62 : 0.4);
    });
    for (const m of voicing) warm.play(m, 1.6, t, 0.5);
    let b = 36 + tri.root;
    if (b < 40) b += 12;
    low.play(b, 1.7, t, 0.55);
  };

  const silence = (): void => {
    keys?.release();
    warm?.release();
    low?.release();
  };

  // ---- moving around ---------------------------------------------------------------------
  const vertexXY = (c: Cell, which: number): [number, number] => {
    const [i, j] = cellVerts(c)[which];
    return latticeXY(i, j);
  };

  const goTo = (next: Cell, op: PLR | null, audible: boolean): void => {
    const prevCell = cur;
    // the corner that is new (for the spark)
    const pv = cellVerts(prevCell).map(([i, j]) => `${i},${j}`);
    const nv = cellVerts(next).map(([i, j]) => `${i},${j}`);
    const fromIdx = pv.findIndex((k) => !nv.includes(k));
    const toIdx = nv.findIndex((k) => !pv.includes(k));
    spark = fromIdx >= 0 && toIdx >= 0 && op ? { from: vertexXY(prevCell, fromIdx), to: vertexXY(next, toIdx), at: performance.now() } : null;
    cur = next;
    trail.push({ cell: next, at: performance.now(), op });
    if (trail.length > 16) trail.shift();
    lastOp = op;
    const before = voicing.slice();
    voicing = voiceLead(voicing, triadPcs(cellTriad(next)), 55, 76);
    const moved = voicing.map((m, k) => (m !== before[k] ? k : -1)).filter((k) => k >= 0);
    if (audible) sound(moved);
  };

  const step = (audible: boolean): void => {
    if (queue.length === 0) {
      if (!hero && cycleRun) {
        // a figure cycle ends where it began
        cycleRun = false;
        stopWalk();
        return;
      }
      const r = Math.random();
      if (r < 0.18) {
        queue = CYCLES.hex.ops.slice();
        phraseName = "hexatonic cycle";
      } else if (r < 0.32) {
        queue = CYCLES.lr.ops.slice(0, 6);
        phraseName = "L–R chain";
      } else {
        // wander: never undo the last move straight away
        const ops: PLR[] = [];
        let prev = lastOp;
        for (let k = 0; k < 4; k++) {
          const choices = (["P", "L", "R"] as PLR[]).filter((o) => o !== prev);
          const o = choices[Math.floor(Math.random() * choices.length)];
          ops.push(o);
          prev = o;
        }
        queue = ops;
        phraseName = "wandering";
      }
    }
    const op = queue.shift()!;
    goTo(cellPLR(cur, op), op, audible);
  };

  // the audible walk: a chord every two beats
  const clock = new Clock(hero ? 62 : 66, 1, (s) => {
    if (s % 2 === 0 && s > 0) step(true);
  });

  const tap = tapToPlay(
    container,
    hero ? "Tap to play the walk" : "Tap to hear the walk",
    () => {
      void ensureAudio().then(() => {
        sound([0, 1, 2]);
        startWalk();
      });
    },
    hero ? ((container.clientWidth || 800) < 740 ? 0.84 : 0.6) : 0.82,
  );

  const startWalk = (): void => {
    playing = true;
    tap.hide();
    if (!clock.isRunning) clock.start();
    syncButtons();
  };
  function stopWalk(): void {
    playing = false;
    cycleRun = false;
    clock.stop();
    syncButtons();
  }

  const guard = frameGuard(() => {
    if (playing) {
      stopWalk();
      tap.show();
    }
    silence();
  });

  // ---- pointer ------------------------------------------------------------------------------
  let scale = 1;
  let ax = 0;
  let ay = 0;
  const toLattice = (cx: number, cy: number): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const x = ((cx - r.left) / r.width) * v.w;
    const y = ((cy - r.top) / r.height) * v.h;
    return [cam[0] + (x - ax) / scale, cam[1] - (y - ay) / scale];
  };
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = toLattice(e.clientX, e.clientY);
    hover = cellAt(x, y);
  });
  canvas.addEventListener("pointerleave", () => (hover = null));
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = toLattice(e.clientX, e.clientY);
    const target = cellAt(x, y);
    if (target.i === cur.i && target.j === cur.j && target.up === cur.up) {
      void ensureAudio().then(() => sound([0, 1, 2]));
      return;
    }
    const op = (["P", "L", "R"] as PLR[]).find((o) => {
      const c = cellPLR(cur, o);
      return c.i === target.i && c.j === target.j && c.up === target.up;
    });
    queue = [];
    phraseName = "";
    goTo(target, op ?? null, false);
    void ensureAudio().then(() => {
      sound([0, 1, 2]);
      if (hero && !playing) startWalk();
    });
  });

  // ---- controls -------------------------------------------------------------------------------
  let playBtn: HTMLButtonElement | null = null;
  const cycleBtns: HTMLButtonElement[] = [];
  const syncButtons = (): void => {
    if (playBtn) playBtn.textContent = playing ? "■ stop" : hero ? "▶ play" : "▶ random walk";
    for (const b of cycleBtns) setActive(b, false);
  };

  if (hero) {
    playBtn = shell.button("▶ play", () => {
      if (playing) {
        stopWalk();
        silence();
        tap.show();
      } else {
        void ensureAudio().then(() => {
          sound([0, 1, 2]);
          startWalk();
        });
      }
    });
  } else {
    for (const op of ["P", "L", "R"] as PLR[]) {
      shell.button(op, () => {
        queue = [];
        phraseName = "";
        void ensureAudio().then(() => {
          tap.hide();
          goTo(cellPLR(cur, op), op, true);
        });
      });
    }
    playBtn = shell.button("▶ random walk", () => {
      if (playing) {
        stopWalk();
        silence();
      } else {
        queue = [];
        void ensureAudio().then(startWalk);
      }
    });
    for (const key of ["hex", "oct", "lr"] as const) {
      const label = key === "hex" ? "P–L cycle" : key === "oct" ? "P–R cycle" : "L–R chain";
      const b = shell.button(label, () => {
        void ensureAudio().then(() => {
          queue = CYCLES[key].ops.slice();
          phraseName = CYCLES[key].name;
          cycleRun = true;
          sound([0, 1, 2]);
          startWalk();
          setActive(b, true);
        });
      });
      cycleBtns.push(b);
    }
  }

  shell.setInfo(() => {
    const t = cellTriad(cur);
    const pcs = triadPcs(t).map((p) => PC_NAMES[p]).join("–");
    const last = trail.length > 1 ? trail[trail.length - 1] : null;
    const prev = trail.length > 1 ? cellTriad(trail[trail.length - 2].cell) : null;
    let move = "";
    if (last?.op && prev) {
      const a = triadPcs(prev);
      const b = triadPcs(t);
      const from = a.find((p) => !b.includes(p));
      const to = b.find((p) => !a.includes(p));
      if (from !== undefined && to !== undefined) {
        const d = mod12(to - from);
        const semis = d > 6 ? d - 12 : d;
        move = ` · ${last.op}: ${triadName(prev)} → ${triadName(t)}, ${PC_NAMES[from]} moves to ${PC_NAMES[to]} (${semis > 0 ? "+" : ""}${semis})`;
      }
    }
    const tail = phraseName && playing ? ` · ${phraseName}` : "";
    return `${triadName(t)} = ${pcs}${move}${tail}`;
  });

  // ---- drawing ----------------------------------------------------------------------------------
  const triadColor = (t: Triad): string => (t.minor ? COL.minor : COL.major);

  const draw = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    const now = performance.now();
    const narrow = w / px < 520;
    // title overlays the bottom of the hero on wide screens; keep the action above it
    const overlay = hero && !narrow;
    scale = hero ? Math.max(62 * px, Math.min(w, h * 1.4) / (narrow ? 5.2 : 8.4)) : Math.min(w / (narrow ? 5.6 : 8.6), h / 4.6);
    ax = w * 0.5;
    ay = overlay ? h * 0.4 : h * 0.5;

    // camera eases toward the current chord
    const target = cellCenter(cur);
    cam = [cam[0] + (target[0] - cam[0]) * 0.045, cam[1] + (target[1] - cam[1]) * 0.045];
    const S = (x: number, y: number): [number, number] => [ax + (x - cam[0]) * scale, ay - (y - cam[1]) * scale];

    clear(v, "#0b0d16", "#05060a");
    // a soft pool of light under the current chord
    const [hx, hy] = S(target[0], target[1]);
    glow(ctx, hx, hy, scale * 3.2, triadColor(cellTriad(cur)), 0.16);

    // visible lattice range
    const span = Math.ceil(Math.max(w, h) / scale) + 3;
    const jc = Math.round(cam[1] / (Math.sqrt(3) / 2));
    const ic = Math.round(cam[0] - jc * 0.5);
    const cells: Cell[] = [];
    for (let j = jc - span; j <= jc + span; j++) {
      for (let i = ic - span - 2; i <= ic + span + 2; i++) {
        const [x, y] = latticeXY(i, j);
        const [sx, sy] = S(x, y);
        if (sx < -scale * 1.5 || sx > w + scale * 1.5 || sy < -scale * 1.5 || sy > h + scale * 1.5) continue;
        cells.push({ i, j, up: true }, { i, j, up: false });
      }
    }

    // distance falloff so the far lattice recedes
    const fade = (x: number, y: number): number => {
      const [sx, sy] = S(x, y);
      const d = Math.hypot(sx - ax, sy - ay) / Math.max(w, h);
      return Math.max(0, 1 - d * 1.35);
    };

    // faint triangle fills: the major/minor checkerboard
    for (const c of cells) {
      const vs = cellVerts(c).map(([i, j]) => S(...latticeXY(i, j)));
      const [cx, cy] = cellCenter(c);
      const f = fade(cx, cy);
      if (f <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(vs[0][0], vs[0][1]);
      ctx.lineTo(vs[1][0], vs[1][1]);
      ctx.lineTo(vs[2][0], vs[2][1]);
      ctx.closePath();
      ctx.fillStyle = rgba(c.up ? COL.major : COL.minor, 0.035 * f);
      ctx.fill();
    }

    // trail: triangles you came through, fading with age
    trail.forEach((s, k) => {
      const age = trail.length - 1 - k;
      if (age === 0) return;
      const a = Math.max(0, 0.22 - age * 0.018);
      const vs = cellVerts(s.cell).map(([i, j]) => S(...latticeXY(i, j)));
      ctx.beginPath();
      ctx.moveTo(vs[0][0], vs[0][1]);
      ctx.lineTo(vs[1][0], vs[1][1]);
      ctx.lineTo(vs[2][0], vs[2][1]);
      ctx.closePath();
      ctx.fillStyle = rgba(triadColor(cellTriad(s.cell)), a);
      ctx.fill();
    });

    // hover
    if (hover && !(hover.i === cur.i && hover.j === cur.j && hover.up === cur.up)) {
      const vs = cellVerts(hover).map(([i, j]) => S(...latticeXY(i, j)));
      ctx.beginPath();
      ctx.moveTo(vs[0][0], vs[0][1]);
      ctx.lineTo(vs[1][0], vs[1][1]);
      ctx.lineTo(vs[2][0], vs[2][1]);
      ctx.closePath();
      ctx.fillStyle = rgba(triadColor(cellTriad(hover)), 0.14);
      ctx.fill();
      ctx.strokeStyle = rgba(triadColor(cellTriad(hover)), 0.5);
      ctx.lineWidth = 1.2 * px;
      ctx.stroke();
    }

    // edges, coloured by interval: fifths neutral, major thirds warm, minor thirds cool
    const edgeCol = [rgba("#c9d1ea", 0.16), rgba(COL.major, 0.14), rgba(COL.minor, 0.14)];
    const dirs: [number, number][] = [
      [1, 0],
      [0, 1],
      [1, -1],
    ];
    ctx.lineWidth = 1 * px;
    for (let d = 0; d < 3; d++) {
      ctx.beginPath();
      for (const c of cells) {
        if (!c.up) continue;
        const [x0, y0] = latticeXY(c.i, c.j);
        if (fade(x0, y0) <= 0) continue;
        const [x1, y1] = latticeXY(c.i + dirs[d][0], c.j + dirs[d][1]);
        const a = S(x0, y0);
        const b = S(x1, y1);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.strokeStyle = edgeCol[d];
      ctx.stroke();
    }

    // the path line through the trail's centres
    if (trail.length > 1) {
      for (let k = 1; k < trail.length; k++) {
        const age = trail.length - 1 - k;
        const a = cellCenter(trail[k - 1].cell);
        const b = cellCenter(trail[k].cell);
        const pa = S(a[0], a[1]);
        const pb = S(b[0], b[1]);
        glowPath(
          ctx,
          (c) => {
            c.moveTo(pa[0], pa[1]);
            c.lineTo(pb[0], pb[1]);
          },
          COL.white,
          1.3 * px,
          Math.max(0, 0.55 - age * 0.04),
        );
      }
    }

    // current triangle
    const curT = cellTriad(cur);
    const cc = triadColor(curT);
    const arrive = trail[trail.length - 1].at;
    const pulse = 1 - smooth((now - arrive) / 900);
    const cvs = cellVerts(cur).map(([i, j]) => S(...latticeXY(i, j)));
    ctx.beginPath();
    ctx.moveTo(cvs[0][0], cvs[0][1]);
    ctx.lineTo(cvs[1][0], cvs[1][1]);
    ctx.lineTo(cvs[2][0], cvs[2][1]);
    ctx.closePath();
    ctx.fillStyle = rgba(cc, 0.2 + 0.18 * pulse);
    ctx.fill();
    glowPath(
      ctx,
      (c) => {
        c.moveTo(cvs[0][0], cvs[0][1]);
        c.lineTo(cvs[1][0], cvs[1][1]);
        c.lineTo(cvs[2][0], cvs[2][1]);
        c.closePath();
      },
      cc,
      1.6 * px,
      0.75 + 0.25 * pulse,
    );

    // triangle labels (chord names); the three P/L/R neighbours are tagged
    const nbrs = (["P", "L", "R"] as PLR[]).map((op) => ({ op, c: cellPLR(cur, op) }));
    const labelSize = hero ? (narrow ? 11 : 12.5) : narrow ? 10 : 11.5;
    for (const c of cells) {
      const [x, y] = cellCenter(c);
      const f = fade(x, y);
      if (f <= 0.05) continue;
      const isCur = c.i === cur.i && c.j === cur.j && c.up === cur.up;
      if (isCur) continue;
      const [sx, sy] = S(x, y);
      const nb = nbrs.find((n) => n.c.i === c.i && n.c.j === c.j && n.c.up === c.up);
      const col = c.up ? COL.major : COL.minor;
      if (nb) {
        const a = hero ? 0.75 : 1;
        text(ctx, triadName(cellTriad(c)), sx, sy + 5 * px, { color: col, align: "center", alpha: 0.85 * a, font: font(px, labelSize, 700) });
        text(ctx, nb.op, sx, sy - 9 * px, { color: COL.bright, align: "center", alpha: 0.9 * a, font: font(px, labelSize - 1, 800) });
      } else {
        text(ctx, triadName(cellTriad(c)), sx, sy, { color: col, align: "center", alpha: 0.3 * f, font: font(px, labelSize, 600) });
      }
    }
    {
      const [x, y] = cellCenter(cur);
      const [sx, sy] = S(x, y);
      text(ctx, triadName(curT), sx, sy + 0.5 * px, {
        color: COL.bright,
        align: "center",
        font: font(px, hero ? (narrow ? 15 : 19) : narrow ? 13 : 15, 700),
      });
    }

    // nodes
    const curPcs = triadPcs(curT);
    const nodeR = Math.max(9 * px, scale * 0.17);
    for (const c of cells) {
      if (!c.up) continue;
      const [x, y] = latticeXY(c.i, c.j);
      const f = fade(x, y);
      if (f <= 0.02) continue;
      const [sx, sy] = S(x, y);
      const pc = latticePc(c.i, c.j);
      const inCur = cellVerts(cur).some(([i, j]) => i === c.i && j === c.j);
      if (inCur) {
        glow(ctx, sx, sy, nodeR * 3.4, cc, 0.55 + 0.4 * pulse);
      }
      ctx.beginPath();
      ctx.arc(sx, sy, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = inCur ? rgba(cc, 0.95) : `rgba(16, 19, 30, ${0.92 * f})`;
      ctx.fill();
      ctx.strokeStyle = inCur ? rgba("#ffffff", 0.8) : rgba(curPcs.includes(pc) ? cc : "#8a91a5", 0.45 * f);
      ctx.lineWidth = 1.1 * px;
      ctx.stroke();
      text(ctx, PC_NAMES[pc], sx, sy + 0.5 * px, {
        color: inCur ? "#11131c" : COL.text,
        align: "center",
        font: font(px, Math.min(13, (nodeR / px) * 0.95), 700),
        alpha: inCur ? 1 : 0.85 * f,
      });
    }

    // the moving voice: a spark from the corner that left to the corner that arrived
    if (spark) {
      const t = (now - spark.at) / 650;
      if (t < 1.4) {
        const e = smooth(Math.min(1, t));
        const x = spark.from[0] + (spark.to[0] - spark.from[0]) * e;
        const y = spark.from[1] + (spark.to[1] - spark.from[1]) * e;
        const [sx, sy] = S(x, y);
        const fadeOut = t < 1 ? 1 : 1 - (t - 1) / 0.4;
        glow(ctx, sx, sy, nodeR * 2.6, COL.white, 0.9 * fadeOut);
        const [fx, fy] = S(...spark.from);
        glowPath(
          ctx,
          (c) => {
            c.moveTo(fx, fy);
            c.lineTo(sx, sy);
          },
          COL.white,
          1.4 * px,
          0.5 * fadeOut,
        );
      } else spark = null;
    }

    // legend for the figure
    if (!hero) {
      const lx = 14 * px;
      let ly = h - 16 * px;
      ctx.font = font(px, 10.5, 600);
      ctx.fillStyle = "rgba(8, 10, 16, 0.85)";
      ctx.fillRect(lx - 8 * px, ly - 40 * px, 112 * px, 50 * px);
      const rows: [string, string][] = [
        ["minor third ↘", COL.minor],
        ["major third ↗", COL.major],
        ["perfect fifth →", "#c9d1ea"],
      ];
      for (const [s, c] of rows) {
        text(ctx, s, lx, ly, { color: c, alpha: 0.8 });
        ly -= 16 * px;
      }
    }
  };

  return {
    frame() {
      shell.tick();
      guard.pulse();
      const t = performance.now();
      // silent drift until someone presses play (hero only); figures stay put
      if (hero && !playing && t > nextIdle) {
        step(false);
        nextIdle = t + 2600;
      }
      draw();
    },
    dispose() {
      stopWalk();
      silence();
    },
  };
}
