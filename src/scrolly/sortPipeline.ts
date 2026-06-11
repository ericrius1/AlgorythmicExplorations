// Scroll diagram for part three: counting sort, end to end — histogram,
// prefix-sum (scan), scatter — scrubbed by scroll so each pass can be studied.

import { mountScrolly, PAL, rng, phase, lerp, arrow, label } from "../lib/scrolly";

const CELLS = 6;
const N = 18;

const CELL_COLORS = ["#7aa2ff", "#7dd6a0", "#ffb86b", "#ff8585", "#c79bff", "#6ad4d4"];

export function mountSortPipeline(el: HTMLElement): void {
  // Particles with fixed positions in a 1D strip of 6 cells.
  const rand = rng(7);
  const cellOf: number[] = [];
  const fx: number[] = []; // x within the strip, [0,1]
  const fy: number[] = [];
  for (let i = 0; i < N; i++) {
    const c = Math.floor(rand() * CELLS);
    cellOf.push(c);
    fx.push((c + 0.15 + rand() * 0.7) / CELLS);
    fy.push(0.2 + rand() * 0.6);
  }

  // Histogram.
  const counts = new Array(CELLS).fill(0);
  for (const c of cellOf) counts[c]++;

  // Hillis–Steele inclusive scan rounds (offsets 1, 2, 4).
  const rounds: number[][] = [counts.slice()];
  for (let off = 1; off < CELLS; off *= 2) {
    const prev = rounds[rounds.length - 1];
    const next = prev.slice();
    for (let i = off; i < CELLS; i++) next[i] = prev[i] + prev[i - off];
    rounds.push(next);
  }
  const inclusive = rounds[rounds.length - 1];
  const starts = [0, ...inclusive.slice(0, -1)];

  // Final slot of every particle (stable within a cell, by index order).
  const claimed = new Array(CELLS).fill(0);
  const slot: number[] = [];
  for (let i = 0; i < N; i++) {
    slot.push(starts[cellOf[i]] + claimed[cellOf[i]]++);
  }

  mountScrolly(el, {
    screens: 5,
    aspect: 0.66,
    steps: [
      { at: 0, text: "18 particles in a strip of 6 cells, coloured by which cell they fall in. The goal: every cell's particles contiguous in one array, no lists, no pointers." },
      { at: 0.14, text: "Pass 1 — histogram. Every particle atomically bumps its cell's counter. Thousands of threads can do this at once; order doesn't matter, only the totals." },
      { at: 0.34, text: "Pass 2 — scan. Where does each cell's run start? That's the running total of all counts before it. Hillis–Steele: every element adds the value 1 to its left, then 2, then 4. After log₂(n) rounds, done — all elements in parallel each round." },
      { at: 0.72, text: "Pass 3 — scatter. Each particle claims a slot: start of its cell's run, plus an atomic ticket. One copy, and the array is sorted." },
      { at: 0.92, text: "Neighbours in space are now neighbours in memory. The 3×3 query reads each cell as one clean contiguous run." },
    ],
    draw(ctx, w, h, t) {
      const mx = Math.max(56, w * 0.08);
      const stripW = w - 2 * mx;
      const stripY = h * 0.05;
      const stripH = h * 0.24;
      const cw = stripW / CELLS;

      const pStrip = phase(t, 0, 0.1);
      const pHist = phase(t, 0.14, 0.32);
      const pScanIn = phase(t, 0.34, 0.4);
      const pScatter = phase(t, 0.72, 0.92);

      // --- strip with cells ---
      ctx.save();
      ctx.globalAlpha = pStrip;
      ctx.strokeStyle = PAL.grid;
      ctx.lineWidth = 1;
      for (let c = 0; c <= CELLS; c++) {
        ctx.beginPath();
        ctx.moveTo(mx + c * cw, stripY);
        ctx.lineTo(mx + c * cw, stripY + stripH);
        ctx.stroke();
      }
      ctx.strokeRect(mx, stripY, stripW, stripH);
      for (let c = 0; c < CELLS; c++) {
        label(ctx, `cell ${c}`, mx + c * cw + cw / 2, stripY - 10, {
          color: PAL.muted,
          size: 10,
          align: "center",
          alpha: pStrip,
        });
      }
      ctx.restore();

      // --- histogram row ---
      const histY = stripY + stripH + h * 0.07;
      const boxH = h * 0.075;
      if (pHist > 0 || t >= 0.32) {
        for (let c = 0; c < CELLS; c++) {
          const shown = Math.round(counts[c] * Math.min(1, pHist * 1.6));
          ctx.globalAlpha = Math.min(1, pHist * 2);
          ctx.strokeStyle = PAL.grid;
          ctx.strokeRect(mx + c * cw + 4, histY, cw - 8, boxH);
          label(ctx, String(shown), mx + c * cw + cw / 2, histY + boxH / 2, {
            color: PAL.text,
            size: 13,
            align: "center",
            mono: true,
            alpha: Math.min(1, pHist * 2),
          });
        }
        label(ctx, "counts", mx - 8, histY + boxH / 2, {
          color: PAL.muted,
          size: 10,
          align: "right",
          alpha: Math.min(1, pHist * 2),
        });
        ctx.globalAlpha = 1;
      }

      // --- scan rounds ---
      const scanY0 = histY + boxH + h * 0.04;
      const rowGap = boxH + h * 0.025;
      const nRounds = rounds.length - 1; // 3 add rounds
      for (let r = 1; r <= nRounds; r++) {
        const t0 = 0.4 + ((r - 1) / nRounds) * 0.3;
        const t1 = 0.4 + (r / nRounds) * 0.3;
        const pr = phase(t, t0, t1);
        if (pr <= 0) continue;
        const y = scanY0 + (r - 1) * rowGap;
        const off = 1 << (r - 1);
        for (let c = 0; c < CELLS; c++) {
          ctx.globalAlpha = pr;
          ctx.strokeStyle = PAL.grid;
          ctx.strokeRect(mx + c * cw + 4, y, cw - 8, boxH);
          const val = pr > 0.6 ? rounds[r][c] : rounds[r - 1][c];
          label(ctx, String(val), mx + c * cw + cw / 2, y + boxH / 2, {
            color: c >= off && pr > 0.6 ? PAL.warm : PAL.text,
            size: 13,
            align: "center",
            mono: true,
            alpha: pr,
          });
          // Arrow from the element `off` to the left, in the row above.
          if (c >= off && pr > 0.15 && pr < 0.85) {
            const fromX = mx + (c - off) * cw + cw / 2;
            const fromY = y - rowGap + boxH;
            const a = phase(pr, 0.15, 0.6);
            ctx.globalAlpha = a * (1 - phase(pr, 0.7, 0.85));
            arrow(ctx, fromX, fromY, lerp(fromX, mx + c * cw + cw / 2, a), lerp(fromY, y, a), PAL.accent, 1.2, 5);
          }
        }
        label(ctx, `+${off}`, mx - 8, y + boxH / 2, {
          color: PAL.accent,
          size: 11,
          align: "right",
          mono: true,
          alpha: pr,
        });
        ctx.globalAlpha = 1;
      }
      if (pScanIn > 0) {
        label(ctx, "scan: running totals in log₂ rounds", mx + stripW, scanY0 - 8, {
          color: PAL.muted,
          size: 10,
          align: "right",
          alpha: pScanIn * (1 - phase(t, 0.85, 0.95)),
        });
      }

      // --- output row ---
      const outY = scanY0 + nRounds * rowGap + h * 0.02;
      const slotW = stripW / N;
      const pOut = phase(t, 0.68, 0.74);
      if (pOut > 0) {
        ctx.globalAlpha = pOut;
        ctx.strokeStyle = PAL.grid;
        for (let i = 0; i < N; i++) {
          ctx.strokeRect(mx + i * slotW, outY, slotW, boxH);
        }
        // starts[] markers.
        for (let c = 0; c < CELLS; c++) {
          const x = mx + starts[c] * slotW;
          ctx.strokeStyle = CELL_COLORS[c];
          ctx.beginPath();
          ctx.moveTo(x, outY - 5);
          ctx.lineTo(x, outY + boxH + 5);
          ctx.stroke();
          label(ctx, String(starts[c]), x + 3, outY + boxH + 12, {
            color: CELL_COLORS[c],
            size: 9,
            mono: true,
            alpha: pOut,
          });
        }
        label(ctx, "sorted", mx - 8, outY + boxH / 2, { color: PAL.muted, size: 10, align: "right", alpha: pOut });
        ctx.globalAlpha = 1;
      }

      // --- particles: in strip, then flying to slots ---
      for (let i = 0; i < N; i++) {
        const sx = mx + fx[i] * stripW;
        const sy = stripY + fy[i] * stripH;
        const dx = mx + slot[i] * slotW + slotW / 2;
        const dy = outY + boxH / 2;
        const fly = phase(pScatter, (i / N) * 0.5, (i / N) * 0.5 + 0.5);
        const x = lerp(sx, dx, fly);
        // arc the flight path a little
        const y = lerp(sy, dy, fly) - Math.sin(fly * Math.PI) * 18;
        ctx.globalAlpha = pStrip;
        ctx.fillStyle = CELL_COLORS[cellOf[i]];
        ctx.beginPath();
        ctx.arc(x, y, 4.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Histogram pulse: during the count, faint ticks from particles to boxes.
      if (pHist > 0 && pHist < 1) {
        ctx.save();
        for (let i = 0; i < N; i++) {
          const g = phase(pHist, (i / N) * 0.7, (i / N) * 0.7 + 0.3);
          if (g <= 0 || g >= 1) continue;
          const sx = mx + fx[i] * stripW;
          const sy = stripY + fy[i] * stripH;
          const dx = mx + cellOf[i] * cw + cw / 2;
          const dy = histY;
          ctx.globalAlpha = 0.6 * Math.sin(g * Math.PI);
          ctx.fillStyle = CELL_COLORS[cellOf[i]];
          ctx.beginPath();
          ctx.arc(lerp(sx, dx, g), lerp(sy, dy, g), 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    },
  });
}
