// Demo 2 of part four: spatial hashing, made touchable. The same pile of
// discs as part three's grid demo, but cells no longer own a counter each —
// their integer coordinates hash into a small table of buckets. Your cursor
// runs the query: yellow cells are the 3×3 window, red cells are strangers
// that happen to share a bucket with it, and red discs are the impostor
// candidates the distance test will throw away.

import { Shell, type Demo } from "../lib/demoShell";
import {
  seedBox,
  contactForce,
  integrateContacts,
  drawContacts,
  canvasMouse,
  type ContactSim,
} from "./contactsCpu";

const GRID = 24; // visible cells per side; cell width > one disc diameter
const VIEW = 0.92;
const N = 3500;

export function mountHashNeighbors(container: HTMLElement): Demo {
  const shell = new Shell(container);
  const ctx = shell.canvas.getContext("2d")!;
  let sim: ContactSim = seedBox(N);
  const ax = new Float32Array(N);
  const ay = new Float32Array(N);
  let table = 128; // buckets — deliberately far fewer than the 576 cells
  const mouse = canvasMouse(shell);

  const cellXY = (x: number, y: number): [number, number] => [
    Math.min(GRID - 1, Math.max(0, Math.floor(((x + 1) / 2) * GRID))),
    Math.min(GRID - 1, Math.max(0, Math.floor(((y + 1) / 2) * GRID))),
  ];
  // Same mix as the GPU shader: two large odd constants, one per axis.
  const bucketOf = (cx: number, cy: number): number =>
    ((Math.imul(cx, 0x9e3779b1) ^ Math.imul(cy, 0x85ebca77)) >>> 0) % table;

  let counts = new Int32Array(table);
  let starts = new Int32Array(table + 1);
  const order = new Int32Array(N);
  const retable = (): void => {
    counts = new Int32Array(table);
    starts = new Int32Array(table + 1);
  };

  shell.slider({
    label: "hash table buckets",
    min: 32,
    max: 4096,
    step: 1,
    value: table,
    log: true,
    format: (v) => String(1 << Math.round(Math.log2(v))),
    onInput: (v) => {
      table = 1 << Math.round(Math.log2(v));
      retable();
    },
  });
  shell.button("re-seed", () => (sim = seedBox(N)));

  return {
    frame() {
      shell.tick();
      const s = sim.state;

      // build: count, prefix-sum, scatter — by bucket instead of by cell
      counts.fill(0);
      for (let i = 0; i < N; i++) {
        const [cx, cy] = cellXY(s[i * 4], s[i * 4 + 1]);
        counts[bucketOf(cx, cy)]++;
      }
      let acc = 0;
      for (let b = 0; b < table; b++) {
        starts[b] = acc;
        acc += counts[b];
      }
      starts[table] = acc;
      const cursor = starts.slice(0, table);
      for (let i = 0; i < N; i++) {
        const [cx, cy] = cellXY(s[i * 4], s[i * 4 + 1]);
        order[cursor[bucketOf(cx, cy)]++] = i;
      }

      // forces: 9 cells -> deduped buckets -> distance test sorts out the rest
      ax.fill(0);
      ay.fill(0);
      for (let i = 0; i < N; i++) {
        const [cx, cy] = cellXY(s[i * 4], s[i * 4 + 1]);
        const seen: number[] = [];
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const b = bucketOf(cx + ox, cy + oy);
            if (seen.includes(b)) continue;
            seen.push(b);
            for (let k = starts[b]; k < starts[b + 1]; k++) {
              const j = order[k];
              if (j <= i) continue; // each pair once
              contactForce(s, i, j, ax, ay); // impostors fail its distance test
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

      const m = mouse.get();
      if (!m || Math.abs(m[0]) >= 1 || Math.abs(m[1]) >= 1) {
        shell.readout.textContent = `${N.toLocaleString()} discs · ${GRID * GRID} cells share ${table} buckets — point at the pile`;
        return;
      }

      const [cx, cy] = cellXY(m[0], m[1]);
      const window = new Set<number>();
      const buckets = new Set<number>();
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
          window.add(gy * GRID + gx);
          buckets.add(bucketOf(gx, gy));
        }
      }

      // red: every far-away cell whose bucket collides with the query's
      ctx.strokeStyle = "rgba(255, 95, 95, 0.5)";
      ctx.fillStyle = "rgba(255, 95, 95, 0.07)";
      ctx.beginPath();
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          if (window.has(gy * GRID + gx) || !buckets.has(bucketOf(gx, gy))) continue;
          ctx.rect(ox0 - sc + gx * cw, oy0 + sc - (gy + 1) * cw, cw, cw);
        }
      }
      ctx.fill();
      ctx.stroke();

      // yellow: the 3×3 window itself
      ctx.strokeStyle = "rgba(255, 205, 80, 0.55)";
      ctx.fillStyle = "rgba(255, 205, 80, 0.06)";
      ctx.beginPath();
      for (const c of window) {
        const gx = c % GRID;
        const gy = Math.floor(c / GRID);
        ctx.rect(ox0 - sc + gx * cw, oy0 + sc - (gy + 1) * cw, cw, cw);
      }
      ctx.fill();
      ctx.stroke();

      // candidates: everyone in the query's buckets; impostors drawn red
      let real = 0;
      let impostors = 0;
      const dotPath = (j: number): void => {
        const x = ox0 + s[j * 4] * sc;
        const y = oy0 - s[j * 4 + 1] * sc;
        ctx.moveTo(x + 2.2, y);
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      };
      ctx.fillStyle = "rgb(255, 220, 110)";
      ctx.beginPath();
      for (const b of buckets) {
        for (let k = starts[b]; k < starts[b + 1]; k++) {
          const j = order[k];
          const [jx, jy] = cellXY(s[j * 4], s[j * 4 + 1]);
          if (window.has(jy * GRID + jx)) {
            real++;
            dotPath(j);
          }
        }
      }
      ctx.fill();
      ctx.fillStyle = "rgb(255, 110, 110)";
      ctx.beginPath();
      for (const b of buckets) {
        for (let k = starts[b]; k < starts[b + 1]; k++) {
          const j = order[k];
          const [jx, jy] = cellXY(s[j * 4], s[j * 4 + 1]);
          if (!window.has(jy * GRID + jx)) {
            impostors++;
            dotPath(j);
          }
        }
      }
      ctx.fill();

      shell.readout.textContent =
        `9 cells → ${buckets.size} buckets → ${real + impostors} candidates: ` +
        `${real} real, ${impostors} impostors for the distance test to discard`;
    },
  };
}
