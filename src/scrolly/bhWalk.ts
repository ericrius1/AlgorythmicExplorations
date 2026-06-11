// Scroll diagram for part one: how a Barnes-Hut tree walk replaces thousands
// of pairwise forces with a few dozen cluster terms, from one body's view.

import { mountScrolly, PAL, rng, phase, lerp, arrow, label } from "../lib/scrolly";

interface Cell {
  x: number; // [0,1] square coords
  y: number;
  size: number;
  depth: number;
  comX: number;
  comY: number;
  count: number;
  children: Cell[] | null;
  points: number[]; // indices, only for leaves
}

const THETA = 0.85;
const MAX_DEPTH = 5;

function buildTree(px: number[], py: number[]): Cell {
  const make = (x: number, y: number, size: number, depth: number, idx: number[]): Cell => {
    let cx = 0;
    let cy = 0;
    for (const i of idx) {
      cx += px[i];
      cy += py[i];
    }
    const n = idx.length;
    const cell: Cell = {
      x,
      y,
      size,
      depth,
      comX: n ? cx / n : x + size / 2,
      comY: n ? cy / n : y + size / 2,
      count: n,
      children: null,
      points: idx,
    };
    if (n > 1 && depth < MAX_DEPTH) {
      const half = size / 2;
      const quads: number[][] = [[], [], [], []];
      for (const i of idx) {
        const qx = px[i] >= x + half ? 1 : 0;
        const qy = py[i] >= y + half ? 1 : 0;
        quads[qy * 2 + qx].push(i);
      }
      cell.children = [];
      for (let q = 0; q < 4; q++) {
        if (quads[q].length === 0) continue;
        cell.children.push(make(x + (q % 2) * half, y + Math.floor(q / 2) * half, half, depth + 1, quads[q]));
      }
      cell.points = [];
    }
    return cell;
  };
  return make(0, 0, 1, 0, px.map((_, i) => i));
}

export function mountBhWalk(el: HTMLElement): void {
  // A two-clump "galaxy" plus scattered field stars, in the unit square.
  const rand = rng(41);
  const px: number[] = [];
  const py: number[] = [];
  const put = (cx: number, cy: number, spread: number, n: number): void => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = spread * Math.sqrt(rand());
      px.push(cx + Math.cos(a) * r);
      py.push(cy + Math.sin(a) * r * 0.85);
    }
  };
  put(0.72, 0.42, 0.2, 150);
  put(0.55, 0.78, 0.12, 70);
  put(0.35, 0.25, 0.1, 45);
  for (let i = 0; i < 55; i++) {
    px.push(rand());
    py.push(rand());
  }
  const N = px.length;
  const bodyX = 0.12;
  const bodyY = 0.6;

  const tree = buildTree(px, py);

  // Run the actual walk once: which cells get accepted as single terms, and
  // which individual points survive as exact near-field work.
  const accepted: Cell[] = [];
  const exact: number[] = [];
  const walk = (c: Cell): void => {
    const d = Math.hypot(c.comX - bodyX, c.comY - bodyY);
    if (c.children === null) {
      if (c.count > 0) {
        if (c.count === 1) exact.push(c.points[0]);
        else if (c.size < THETA * d) accepted.push(c);
        else exact.push(...c.points);
      }
      return;
    }
    if (c.size < THETA * d) {
      accepted.push(c);
      return;
    }
    for (const ch of c.children) walk(ch);
  };
  walk(tree);
  accepted.sort((a, b) => {
    const da = Math.hypot(a.comX - bodyX, a.comY - bodyY);
    const db = Math.hypot(b.comX - bodyX, b.comY - bodyY);
    return db - da; // farthest collapses first
  });

  const cells: Cell[] = [];
  const collect = (c: Cell): void => {
    cells.push(c);
    if (c.children) for (const ch of c.children) collect(ch);
  };
  collect(tree);

  mountScrolly(el, {
    screens: 4,
    aspect: 0.62,
    steps: [
      { at: 0, text: "One body, asking for its force. The honest answer: one line to every other body — 320 of them here, 300,000 in the hero demo." },
      { at: 0.2, text: "Build the quadtree: split any square holding more than one body, recursively. Every cell stores its total mass and centre of mass." },
      { at: 0.42, text: "The walk. Each cell takes one test: width < θ × distance? If yes, the whole cell collapses into a single point mass (orange dot, one arrow). Far cells pass easily; near cells split open." },
      { at: 0.78, text: "Result: a few dozen cluster terms plus a handful of exact near neighbours, summed into one acceleration — within a fraction of a percent of the exact answer." },
    ],
    draw(ctx, w, h, t) {
      const m = 14;
      const S = Math.min(w - 2 * m, h - 2 * m);
      const ox = (w - S) / 2;
      const oy = (h - S) / 2;
      const X = (x: number): number => ox + x * S;
      const Y = (y: number): number => oy + y * S;

      const pLines = phase(t, 0.02, 0.16);
      const pLinesOut = phase(t, 0.2, 0.3);
      const pTree = phase(t, 0.2, 0.42);
      const pWalk = phase(t, 0.42, 0.78);
      const pSum = phase(t, 0.78, 0.97);

      // Which accepted cells have collapsed so far (staggered, farthest first).
      const collapsed = (i: number): number =>
        phase(pWalk, (i / accepted.length) * 0.85, (i / accepted.length) * 0.85 + 0.15);

      // Membership of points in collapsed cells → dim them.
      const dimmed = new Float32Array(N);
      accepted.forEach((c, i) => {
        const k = collapsed(i);
        if (k <= 0) return;
        const mark = (cell: Cell): void => {
          if (cell.children) for (const ch of cell.children) mark(ch);
          else for (const p of cell.points) dimmed[p] = Math.max(dimmed[p], k);
        };
        mark(c);
      });

      // Naive lines, then fade out.
      const lineAlpha = pLines * (1 - pLinesOut);
      if (lineAlpha > 0.005) {
        ctx.save();
        ctx.globalAlpha = 0.3 * lineAlpha;
        ctx.strokeStyle = PAL.accent;
        ctx.lineWidth = 0.6;
        for (let i = 0; i < N; i += 2) {
          const g = phase(pLines, (i / N) * 0.6, (i / N) * 0.6 + 0.4);
          if (g <= 0) continue;
          ctx.beginPath();
          ctx.moveTo(X(bodyX), Y(bodyY));
          ctx.lineTo(lerp(X(bodyX), X(px[i]), g), lerp(Y(bodyY), Y(py[i]), g));
          ctx.stroke();
        }
        ctx.restore();
      }

      // Quadtree cells, fading in by depth, fading once the walk replaces them.
      if (pTree > 0) {
        ctx.save();
        for (const c of cells) {
          const din = phase(pTree, c.depth / (MAX_DEPTH + 1), (c.depth + 1) / (MAX_DEPTH + 1));
          if (din <= 0) continue;
          ctx.globalAlpha = 0.5 * din * (1 - 0.75 * pSum);
          ctx.strokeStyle = PAL.grid;
          ctx.lineWidth = 1;
          ctx.strokeRect(X(c.x), Y(c.y), c.size * S, c.size * S);
        }
        ctx.restore();
      }

      // Bodies.
      for (let i = 0; i < N; i++) {
        const d = dimmed[i];
        ctx.globalAlpha = lerp(0.9, 0.18, d);
        ctx.fillStyle = PAL.dot;
        ctx.beginPath();
        ctx.arc(X(px[i]), Y(py[i]), 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Accepted cells: highlight box, grow COM dot, arrow to body.
      let nx = 0;
      let ny = 0;
      accepted.forEach((c, i) => {
        const k = collapsed(i);
        if (k <= 0) return;
        const ax = X(c.comX);
        const ay = Y(c.comY);
        const d2 = Math.hypot(c.comX - bodyX, c.comY - bodyY);
        const f = c.count / (d2 * d2 + 0.02);
        nx += ((c.comX - bodyX) / d2) * f;
        ny += ((c.comY - bodyY) / d2) * f;

        ctx.save();
        ctx.globalAlpha = k * (1 - 0.85 * pSum);
        ctx.strokeStyle = PAL.warm;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(X(c.x), Y(c.y), c.size * S, c.size * S);
        ctx.globalAlpha = k * (1 - 0.5 * pSum);
        ctx.fillStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(ax, ay, 2 + 2.5 * Math.sqrt(c.count / 40) * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.5 * k * (1 - pSum);
        arrow(ctx, ax, ay, lerp(ax, X(bodyX), 0.92), lerp(ay, Y(bodyY), 0.92), PAL.warm, 1, 5);
        ctx.restore();
      });

      // Exact near-field lines during/after the walk.
      if (pWalk > 0.6) {
        const g = phase(pWalk, 0.6, 1);
        ctx.save();
        ctx.globalAlpha = 0.65 * g * (1 - 0.6 * pSum);
        ctx.strokeStyle = PAL.accent;
        ctx.lineWidth = 1;
        for (const i of exact) {
          ctx.beginPath();
          ctx.moveTo(X(bodyX), Y(bodyY));
          ctx.lineTo(X(px[i]), Y(py[i]));
          ctx.stroke();
        }
        ctx.restore();
      }

      // Net force arrow.
      if (pSum > 0) {
        const len = Math.hypot(nx, ny) || 1;
        const ux = nx / len;
        const uy = ny / len;
        const L = S * 0.16 * pSum;
        arrow(ctx, X(bodyX), Y(bodyY), X(bodyX) + ux * L, Y(bodyY) + uy * L, "#ffffff", 2.5, 9);
      }

      // Test body.
      ctx.fillStyle = PAL.accent;
      ctx.beginPath();
      ctx.arc(X(bodyX), Y(bodyY), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Term counter.
      const naive = N - 1;
      let terms = naive;
      if (t > 0.42) {
        let done = 0;
        accepted.forEach((_, i) => {
          if (collapsed(i) > 0.5) done++;
        });
        const remaining = accepted.length - done;
        terms = Math.round(lerp(naive, accepted.length + exact.length, done / Math.max(1, accepted.length)));
        if (remaining === 0) terms = accepted.length + exact.length;
      }
      label(ctx, `force terms: ${terms}`, w - 16, 22, { color: PAL.warm, size: 13, align: "right", mono: true });
      if (t > 0.42) {
        label(ctx, `θ = ${THETA}`, w - 16, 40, { color: PAL.muted, size: 11, align: "right", mono: true });
      }
    },
  });
}
