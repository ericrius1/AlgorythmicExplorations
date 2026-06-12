// Demo 5 of part five: cloud-in-cell deposit, touchable. Drag the particles;
// each one splits its mass over the four cells under it, weighted by overlap.
// The NGP button shows the alternative — all mass to the nearest cell — and
// why nobody uses it: drag slowly and watch the mass *jump*.

import { Shell, type Demo } from "../../lib/demoShell";

const COLS = 12;
const ROWS = 7;

interface P {
  x: number; // grid units [0, COLS)
  y: number;
}

export function mountCicDeposit(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.58);
  const ctx = shell.canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const parts: P[] = [
    { x: 3.3, y: 2.4 },
    { x: 7.8, y: 4.1 },
    { x: 8.4, y: 1.7 },
    { x: 4.9, y: 5.2 },
  ];
  let cic = true;
  let drag = -1;

  const cellW = (): number => ctx.canvas.width / COLS;
  const cellH = (): number => ctx.canvas.height / ROWS;

  const toGrid = (e: PointerEvent): [number, number] => {
    const r = shell.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * COLS, ((e.clientY - r.top) / r.height) * ROWS];
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    const [gx, gy] = toGrid(e);
    let best = 1.2;
    drag = -1;
    parts.forEach((p, i) => {
      const d = Math.hypot(p.x - gx, p.y - gy);
      if (d < best) {
        best = d;
        drag = i;
      }
    });
    if (drag >= 0) shell.canvas.setPointerCapture(e.pointerId);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const [gx, gy] = toGrid(e);
    parts[drag].x = Math.min(COLS - 0.51, Math.max(0.51, gx));
    parts[drag].y = Math.min(ROWS - 0.51, Math.max(0.51, gy));
  });
  shell.canvas.addEventListener("pointerup", () => (drag = -1));

  shell.button("CIC — split over 4 cells", () => (cic = true));
  shell.button("NGP — nearest cell only", () => (cic = false));
  shell.setInfo(() =>
    cic
      ? "cloud-in-cell: weights are overlap areas; they always sum to 1 — drag a particle"
      : "nearest grid point: drag slowly across a cell border and watch the mass teleport",
  );

  return {
    frame() {
      shell.tick();
      const { width: w, height: h } = ctx.canvas;
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      // accumulate deposits
      const mass: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
      interface Share {
        c: number;
        r: number;
        wgt: number;
        p: P;
      }
      const shares: Share[] = [];
      for (const p of parts) {
        if (cic) {
          const gx = p.x - 0.5;
          const gy = p.y - 0.5;
          const i0 = Math.floor(gx);
          const j0 = Math.floor(gy);
          const fx = gx - i0;
          const fy = gy - j0;
          const add = (c: number, r: number, wgt: number): void => {
            if (c >= 0 && c < COLS && r >= 0 && r < ROWS && wgt > 0.0005) {
              mass[r][c] += wgt;
              shares.push({ c, r, wgt, p });
            }
          };
          add(i0, j0, (1 - fx) * (1 - fy));
          add(i0 + 1, j0, fx * (1 - fy));
          add(i0, j0 + 1, (1 - fx) * fy);
          add(i0 + 1, j0 + 1, fx * fy);
        } else {
          const c = Math.min(COLS - 1, Math.max(0, Math.floor(p.x)));
          const r = Math.min(ROWS - 1, Math.max(0, Math.floor(p.y)));
          mass[r][c] += 1;
          shares.push({ c, r, wgt: 1, p });
        }
      }

      // cells shaded by mass
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const m = mass[r][c];
          if (m > 0.0005) {
            ctx.fillStyle = `rgba(122, 162, 255, ${Math.min(0.85, m * 0.55)})`;
            ctx.fillRect(c * cellW(), r * cellH(), cellW(), cellH());
          }
        }
      }

      // grid lines
      ctx.strokeStyle = "rgba(80, 90, 120, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= COLS; c++) {
        ctx.moveTo(c * cellW(), 0);
        ctx.lineTo(c * cellW(), h);
      }
      for (let r = 0; r <= ROWS; r++) {
        ctx.moveTo(0, r * cellH());
        ctx.lineTo(w, r * cellH());
      }
      ctx.stroke();

      // weight labels and tethers
      ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "center";
      for (const s of shares) {
        const cx = (s.c + 0.5) * cellW();
        const cy = (s.r + 0.5) * cellH();
        ctx.strokeStyle = "rgba(255, 184, 107, 0.35)";
        ctx.beginPath();
        ctx.moveTo(s.p.x * cellW(), s.p.y * cellH());
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.fillStyle = "rgba(240, 243, 250, 0.95)";
        ctx.fillText(s.wgt.toFixed(2), cx, cy + 4 * dpr);
      }

      // the particles
      for (const p of parts) {
        ctx.fillStyle = "#ffb86b";
        ctx.beginPath();
        ctx.arc(p.x * cellW(), p.y * cellH(), 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 184, 107, 0.5)";
        ctx.beginPath();
        ctx.arc(p.x * cellW(), p.y * cellH(), 8 * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  };
}
