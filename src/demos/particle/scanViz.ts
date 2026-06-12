// Demo 3 of part three: counting sort, watchable. Sixteen cells of
// particles → a histogram → a parallel prefix sum (Hillis-Steele, log₂
// passes) → start offsets → every particle scattered to its final slot.

import { Shell, type Demo } from "../../lib/demoShell";

const CELLS = 16;
const DOTS = 56;
const PASSES = 4; // log2(16)

interface Dot {
  x: number; // 0..1
  jy: number; // vertical jitter
  cell: number;
}

const hue = (c: number): string => `hsl(${(c * 360) / CELLS + 10}, 65%, 62%)`;

export function mountScanViz(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.7);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let dots: Dot[] = [];
  let counts: number[] = [];
  let values: number[] = []; // what the bars currently show
  let phase = 0; // 0 counts · 1..4 scan passes · 5 exclusive shift · 6 scatter
  let auto = true;
  let clock = 0;

  const shuffle = (): void => {
    dots = [];
    for (let i = 0; i < DOTS; i++) {
      const x = Math.random();
      dots.push({ x, jy: Math.random(), cell: Math.min(CELLS - 1, Math.floor(x * CELLS)) });
    }
    counts = new Array(CELLS).fill(0);
    for (const d of dots) counts[d.cell]++;
    values = counts.slice();
    phase = 0;
    clock = 0;
  };
  shuffle();

  const advance = (): void => {
    phase++;
    if (phase > 6) {
      shuffle();
      return;
    }
    if (phase >= 1 && phase <= PASSES) {
      const d = 1 << (phase - 1);
      const next = values.slice();
      for (let i = 0; i < CELLS; i++) {
        if (i >= d) next[i] = values[i] + values[i - d];
      }
      values = next;
    } else if (phase === 5) {
      // inclusive → exclusive: shift right, zero in front
      values = [0, ...values.slice(0, CELLS - 1)];
    }
  };

  shell.button("step", () => {
    auto = false;
    advance();
  });
  shell.button("auto-play", () => (auto = !auto));
  shell.button("shuffle", shuffle);

  const phaseText = (): string => {
    if (phase === 0) return "histogram: count the particles in each cell";
    if (phase <= PASSES) {
      const d = 1 << (phase - 1);
      return `scan pass ${phase}/4 (d=${d}): every cell adds the value ${d} to its left — in parallel`;
    }
    if (phase === 5) return "shift right one cell: each cell's start index in the sorted array";
    return "scatter: every particle copied to start[cell] + slots already claimed";
  };
  shell.setInfo(phaseText);

  return {
    frame() {
      shell.tick();
      if (auto) {
        clock++;
        if (clock > (phase === 6 ? 200 : 95)) {
          clock = 0;
          advance();
        }
      }

      const { width: w, height: h } = ctx.canvas;
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);
      const colW = w / CELLS;
      const font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.font = font;
      ctx.textAlign = "center";

      // --- top strip: the particles, in their cells -------------------------
      const dotTop = 0.04 * h;
      const dotH = 0.13 * h;
      ctx.strokeStyle = "rgba(80, 90, 120, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= CELLS; c++) {
        ctx.moveTo(c * colW, dotTop - 4);
        ctx.lineTo(c * colW, dotTop + dotH + 4);
      }
      ctx.stroke();
      for (const d of dots) {
        ctx.fillStyle = hue(d.cell);
        ctx.beginPath();
        ctx.arc(d.x * w, dotTop + d.jy * dotH, 2.4 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- middle: the bars --------------------------------------------------
      const barBase = 0.66 * h;
      const barTop = 0.26 * h;
      const maxV = Math.max(...values, 1);
      const bw = colW * 0.62;
      for (let c = 0; c < CELLS; c++) {
        const bh = ((barBase - barTop) * values[c]) / maxV;
        const x = c * colW + (colW - bw) / 2;
        ctx.fillStyle = phase === 0 ? hue(c) : "rgba(122, 162, 255, 0.75)";
        ctx.fillRect(x, barBase - bh, bw, bh);
        ctx.fillStyle = "#d7dbe6";
        ctx.fillText(String(values[c]), c * colW + colW / 2, barBase + 14 * dpr);
      }

      // arrows for the active scan pass
      if (phase >= 1 && phase <= PASSES) {
        const d = 1 << (phase - 1);
        ctx.strokeStyle = "rgba(255, 205, 80, 0.5)";
        ctx.fillStyle = "rgba(255, 205, 80, 0.9)";
        for (let i = d; i < CELLS; i++) {
          const x0 = (i - d) * colW + colW / 2;
          const x1 = i * colW + colW / 2;
          const y = barTop - 8 * dpr - (i % 2) * 8 * dpr;
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1 - 4 * dpr, y);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x1 - 5 * dpr, y - 3 * dpr);
          ctx.lineTo(x1 - 5 * dpr, y + 3 * dpr);
          ctx.fill();
        }
      }

      // --- bottom: the sorted array ------------------------------------------
      const stripTop = 0.8 * h;
      const stripH = 0.1 * h;
      ctx.strokeStyle = "rgba(80, 90, 120, 0.4)";
      ctx.strokeRect(0.5, stripTop, w - 1, stripH);
      if (phase >= 5) {
        // segment outlines from the offsets
        const total = DOTS;
        for (let c = 0; c < CELLS; c++) {
          const start = phase === 5 ? values[c] : values[c];
          const x = (start / total) * w;
          ctx.strokeStyle = "rgba(122, 162, 255, 0.5)";
          ctx.beginPath();
          ctx.moveTo(x, stripTop);
          ctx.lineTo(x, stripTop + stripH);
          ctx.stroke();
          if (counts[c] > 0) {
            ctx.fillStyle = "rgba(215, 219, 230, 0.55)";
            ctx.fillText(String(start), x + 2 + 8 * dpr, stripTop + stripH + 13 * dpr);
          }
        }
      }
      if (phase === 6) {
        // particles placed: cell c occupies [start, start+count)
        const total = DOTS;
        let placed = 0;
        for (let c = 0; c < CELLS; c++) {
          for (let k = 0; k < counts[c]; k++) {
            const x = ((values[c] + k + 0.5) / total) * w;
            ctx.fillStyle = hue(c);
            ctx.beginPath();
            ctx.arc(x, stripTop + stripH / 2, 2.6 * dpr, 0, Math.PI * 2);
            ctx.fill();
            placed++;
          }
        }
        ctx.fillStyle = "rgba(215, 219, 230, 0.7)";
        ctx.textAlign = "left";
        ctx.fillText(`${placed} particles, grouped by cell, zero pointers`, 6 * dpr, stripTop - 5 * dpr);
        ctx.textAlign = "center";
      }
    },
  };
}
