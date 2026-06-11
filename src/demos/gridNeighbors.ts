// Demo 2 of part three: the uniform grid, made touchable. Same pile of
// discs, but space is cut into cells one interaction-radius wide; each
// particle only tests the 3×3 cells around it. Your cursor runs the same
// query: yellow cells are the ones it would search, yellow discs the only
// candidates it would test.

import { Shell, type Demo } from "../lib/demoShell";
import {
  seedBox,
  contactForce,
  integrateContacts,
  drawContacts,
  canvasMouse,
  type ContactSim,
} from "./contactsCpu";

const GRID = 24; // cells per side; cell width = 2/24 ≈ 0.083 > 2·R
const VIEW = 0.92;
const N = 3500;

export function mountGridNeighbors(container: HTMLElement): Demo {
  const shell = new Shell(container);
  const ctx = shell.canvas.getContext("2d")!;
  let sim: ContactSim = seedBox(N);
  let ax = new Float32Array(N);
  let ay = new Float32Array(N);
  let showGrid = true;
  let candidates = 0;
  const mouse = canvasMouse(shell);

  // counting sort, the same three moves the GPU will make
  const counts = new Int32Array(GRID * GRID);
  const starts = new Int32Array(GRID * GRID + 1);
  const order = new Int32Array(N);
  const cellOf = (x: number, y: number): number => {
    const cx = Math.min(GRID - 1, Math.max(0, Math.floor(((x + 1) / 2) * GRID)));
    const cy = Math.min(GRID - 1, Math.max(0, Math.floor(((y + 1) / 2) * GRID)));
    return cy * GRID + cx;
  };

  shell.button("toggle grid lines", () => (showGrid = !showGrid));
  shell.button("re-seed", () => (sim = seedBox(N)));
  shell.setInfo(
    () =>
      `${candidates.toLocaleString()} candidate pairs this step — the all-pairs loop would check ` +
      `${(((N * (N - 1)) / 2 / 1e6)).toFixed(1)}M`,
  );

  return {
    frame() {
      shell.tick();
      const s = sim.state;

      // build: count, prefix-sum, scatter
      counts.fill(0);
      for (let i = 0; i < N; i++) counts[cellOf(s[i * 4], s[i * 4 + 1])]++;
      let acc = 0;
      for (let c = 0; c < GRID * GRID; c++) {
        starts[c] = acc;
        acc += counts[c];
      }
      starts[GRID * GRID] = acc;
      const cursor = starts.slice(0, GRID * GRID);
      for (let i = 0; i < N; i++) order[cursor[cellOf(s[i * 4], s[i * 4 + 1])]++] = i;

      // forces: each particle vs its 3×3 neighbourhood only
      ax.fill(0);
      ay.fill(0);
      candidates = 0;
      for (let i = 0; i < N; i++) {
        const cx = Math.min(GRID - 1, Math.max(0, Math.floor(((s[i * 4] + 1) / 2) * GRID)));
        const cy = Math.min(GRID - 1, Math.max(0, Math.floor(((s[i * 4 + 1] + 1) / 2) * GRID)));
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const gx = cx + ox;
            const gy = cy + oy;
            if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
            const c = gy * GRID + gx;
            for (let k = starts[c]; k < starts[c + 1]; k++) {
              const j = order[k];
              if (j <= i) continue; // each pair once
              candidates++;
              contactForce(s, i, j, ax, ay);
            }
          }
        }
      }
      integrateContacts(s, N, ax, ay, { dt: 0.016, mouse: mouse.get() });

      drawContacts(ctx, sim, null);

      const { width, height } = ctx.canvas;
      const sc = (Math.min(width, height) / 2) * VIEW;
      const ox0 = width / 2;
      const oy0 = height / 2;
      const cw = (sc * 2) / GRID;

      if (showGrid) {
        ctx.strokeStyle = "rgba(80, 90, 120, 0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let g = 0; g <= GRID; g++) {
          ctx.moveTo(ox0 - sc + g * cw, oy0 - sc);
          ctx.lineTo(ox0 - sc + g * cw, oy0 + sc);
          ctx.moveTo(ox0 - sc, oy0 - sc + g * cw);
          ctx.lineTo(ox0 + sc, oy0 - sc + g * cw);
        }
        ctx.stroke();
      }

      const m = mouse.get();
      if (m && Math.abs(m[0]) < 1 && Math.abs(m[1]) < 1) {
        const cx = Math.min(GRID - 1, Math.max(0, Math.floor(((m[0] + 1) / 2) * GRID)));
        const cy = Math.min(GRID - 1, Math.max(0, Math.floor(((m[1] + 1) / 2) * GRID)));
        ctx.strokeStyle = "rgba(255, 205, 80, 0.55)";
        ctx.fillStyle = "rgba(255, 205, 80, 0.06)";
        let near = 0;
        ctx.beginPath();
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const gx = cx + ox;
            const gy = cy + oy;
            if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
            ctx.rect(ox0 - sc + gx * cw, oy0 + sc - (gy + 1) * cw, cw, cw);
            near += starts[gy * GRID + gx + 1] - starts[gy * GRID + gx];
          }
        }
        ctx.fill();
        ctx.stroke();

        // highlight the candidates inside the 3×3 window
        ctx.fillStyle = "rgb(255, 220, 110)";
        ctx.beginPath();
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const gx = cx + ox;
            const gy = cy + oy;
            if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
            const c = gy * GRID + gx;
            for (let k = starts[c]; k < starts[c + 1]; k++) {
              const j = order[k];
              const x = ox0 + s[j * 4] * sc;
              const y = oy0 - s[j * 4 + 1] * sc;
              ctx.moveTo(x + 2.2, y);
              ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            }
          }
        }
        ctx.fill();
        shell.readout.textContent = `cursor's query: ${near} candidates of ${N.toLocaleString()} particles`;
      }
    },
  };
}
