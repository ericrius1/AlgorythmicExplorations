// Scroll diagrams for Strange Matter part three. These are 2D teaching views of
// the 3D WebGPU pipeline: neighborhood growth, fixed-cost frame reuse, and the
// difference between edge-based and dual surface extraction.

import { mountScrolly, PAL, phase, lerp, arrow, label } from "../lib/scrolly";

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = "rgba(17, 19, 28, 0.76)";
  ctx.strokeStyle = PAL.grid;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  label(ctx, title, x + 14, y + 18, { color: PAL.text, size: 12, alpha });
}

function cubePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  ox: number,
  oy: number,
): void {
  ctx.beginPath();
  ctx.rect(x, y, s, s);
  ctx.moveTo(x, y);
  ctx.lineTo(x + ox, y - oy);
  ctx.lineTo(x + ox + s, y - oy);
  ctx.lineTo(x + s, y);
  ctx.moveTo(x + s, y);
  ctx.lineTo(x + ox + s, y - oy);
  ctx.lineTo(x + ox + s, y - oy + s);
  ctx.lineTo(x + s, y + s);
}

export function mountReliefNeighbors(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 4,
    aspect: 0.58,
    steps: [
      {
        at: 0,
        text: "In 2D, finding neighbors is cheap: each particle checks its own cell and the eight surrounding it — nine contiguous slices of the sorted array.",
      },
      {
        at: 0.24,
        text: "Move to 3D and that same one-cell radius becomes a 3×3×3 cube. The loop structure barely changes, but every particle now visits 27 cells instead of 9.",
      },
      {
        at: 0.52,
        text: "Magnetic fields fall off much more slowly than SPH pressure. Even trimmed to a three-radius cutoff, each particle walks a 7×7×7 block of 343 cells (four radii would jump to 729).",
      },
      {
        at: 0.78,
        text: "To keep frame rates playable, the magnetic passes run only on the first of four substeps. The remaining three substeps reuse that cached acceleration while pressure, cohesion, and walls keep integrating.",
      },
    ],
    draw(ctx, w, h, t) {
      // On a phone the three panels get short titles and side notes drop out.
      const narrow = w < 560;
      const pad = narrow ? 8 : 16;
      const gap = narrow ? 6 : 14;
      const panelW = (w - pad * 2 - gap * 2) / 3;
      const panelH = h * (narrow ? 0.6 : 0.66);
      const y = 14;
      const countLabelY = y + panelH - (narrow ? 14 : 32);
      const subLabelY = y + panelH - 14;
      const graphicTop = y + (narrow ? 30 : 44);
      const graphicBot = countLabelY - (narrow ? 12 : 18);
      const graphicH = Math.max(24, graphicBot - graphicTop);
      const graphicW = Math.max(24, panelW - (narrow ? 14 : 32));

      const p2 = 0.25 + 0.75 * phase(t, 0, 0.14);
      const p3 = phase(t, 0.24, 0.4);
      const pmag = phase(t, 0.52, 0.68);
      const pcache = phase(t, 0.76, 0.9);

      const p1x = pad;
      const p2x = pad + panelW + gap;
      const p3x = pad + (panelW + gap) * 2;

      drawPanel(ctx, p1x, y, panelW, panelH, narrow ? "2D" : "2D neighbor query", 1);
      drawPanel(ctx, p2x, y, panelW, panelH, narrow ? "3D" : "3D neighbor query", 0.32 + 0.68 * p3);
      drawPanel(ctx, p3x, y, panelW, panelH, narrow ? "magnetics" : "magnetic cutoff", 0.32 + 0.68 * pmag);

      // 2D 3x3 query, centered inside panel 1.
      const cell = Math.min(graphicW / 3.4, graphicH / 3.4);
      const x0 = p1x + (panelW - 3 * cell) / 2;
      const y0 = graphicTop + (graphicH - 3 * cell) / 2;
      ctx.save();
      ctx.globalAlpha = p2;
      for (let yy = 0; yy < 3; yy++) {
        for (let xx = 0; xx < 3; xx++) {
          const cx = x0 + xx * cell;
          const cy = y0 + yy * cell;
          ctx.fillStyle = xx === 1 && yy === 1 ? "rgba(122, 162, 255, 0.22)" : "rgba(122, 162, 255, 0.07)";
          ctx.strokeStyle = xx === 1 && yy === 1 ? PAL.accent : PAL.grid;
          ctx.lineWidth = 1;
          ctx.fillRect(cx, cy, cell, cell);
          ctx.strokeRect(cx, cy, cell, cell);
        }
      }
      ctx.fillStyle = PAL.accent;
      ctx.beginPath();
      ctx.arc(x0 + cell * 1.5, y0 + cell * 1.5, narrow ? 3.5 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      label(ctx, "9 cells", p1x + panelW / 2, countLabelY, {
        align: "center",
        color: PAL.accent,
        mono: true,
        size: narrow ? 10 : 12,
        alpha: p2,
      });

      // 3D 3x3x3 block, sized and centered cleanly inside panel 2.
      if (p3 > 0.01) {
        const cell3 = Math.min(graphicW / 4.2, graphicH / 3.9);
        const offX = cell3 * 0.34;
        const offY = cell3 * 0.22;
        const blockW = 3 * cell3 + 3 * offX;
        const blockH = 3 * cell3 + 3 * offY;
        const x1 = p2x + (panelW - blockW) / 2;
        const y1 = graphicTop + (graphicH - blockH) / 2 + 3 * offY;
        ctx.save();
        ctx.globalAlpha = p3;
        ctx.lineWidth = 1;
        for (let z = 2; z >= 0; z--) {
          const layerAlpha = 0.24 + z * 0.18;
          for (let yy = 0; yy < 3; yy++) {
            for (let xx = 0; xx < 3; xx++) {
              const cx = x1 + xx * cell3 + z * offX;
              const cy = y1 + yy * cell3 - z * offY;
              const isCenter = xx === 1 && yy === 1 && z === 1;
              ctx.fillStyle = isCenter
                ? "rgba(255, 184, 107, 0.22)"
                : `rgba(122, 162, 255, ${layerAlpha * 0.18})`;
              ctx.strokeStyle = isCenter ? PAL.warm : PAL.grid;
              cubePath(ctx, cx, cy, cell3, offX, offY);
              ctx.fillRect(cx, cy, cell3, cell3);
              ctx.stroke();
            }
          }
        }
        ctx.fillStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(x1 + cell3 * 1.5 + offX, y1 + cell3 * 1.5 - offY, narrow ? 3.5 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        label(ctx, "27 cells", p2x + panelW / 2, countLabelY, {
          align: "center",
          color: PAL.warm,
          mono: true,
          size: narrow ? 10 : 12,
          alpha: p3,
        });
      }

      // Magnetic cutoff: 9x9 four-radius plane highlighting the 7x7 three-radius block.
      if (pmag > 0.01) {
        const topOffset = narrow ? 0 : 12;
        const small = Math.min(graphicW / 9.4, (graphicH - topOffset) / 9.4);
        const gridSpan = 9 * small;
        const x2 = p3x + (panelW - gridSpan) / 2;
        const y2 = graphicTop + topOffset + (graphicH - topOffset - gridSpan) / 2;
        ctx.save();
        ctx.globalAlpha = pmag;
        ctx.lineWidth = 1;
        for (let yy = -4; yy <= 4; yy++) {
          for (let xx = -4; xx <= 4; xx++) {
            const inside = Math.abs(xx) <= 3 && Math.abs(yy) <= 3;
            const cx = x2 + (xx + 4) * small;
            const cy = y2 + (yy + 4) * small;
            ctx.fillStyle = inside ? "rgba(255, 184, 107, 0.13)" : "rgba(138, 145, 165, 0.035)";
            ctx.strokeStyle = inside ? "rgba(255, 184, 107, 0.42)" : "rgba(138, 145, 165, 0.16)";
            ctx.fillRect(cx, cy, small, small);
            ctx.strokeRect(cx, cy, small, small);
          }
        }
        // Crisp outline around the active 7x7 region.
        ctx.strokeStyle = PAL.warm;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x2 + small, y2 + small, small * 7, small * 7);

        ctx.fillStyle = PAL.red;
        ctx.beginPath();
        ctx.arc(x2 + small * 4.5, y2 + small * 4.5, narrow ? 3 : 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (!narrow) {
          label(ctx, "× 7 layers deep", p3x + panelW / 2, y2 - 12, {
            align: "center",
            color: PAL.muted,
            size: 10,
            alpha: pmag,
          });
        }
        label(ctx, "343 cells", p3x + panelW / 2, countLabelY, {
          align: "center",
          color: PAL.warm,
          mono: true,
          size: narrow ? 10 : 12,
          alpha: pmag,
        });
        if (!narrow) {
          label(ctx, "729 at four radii", p3x + panelW / 2, subLabelY, {
            align: "center",
            color: PAL.muted,
            size: 10,
            mono: true,
            alpha: pmag,
          });
        }
      }

      // Cached force timeline across the 4 substeps of a single rendered frame.
      if (pcache > 0.01) {
        const boxH = narrow ? 38 : 50;
        const availBot = h - (y + panelH);
        const ty = y + panelH + (narrow ? Math.max(10, (availBot - boxH) / 2) : Math.max(36, (availBot - boxH) / 2 + 6));
        const tx = pad + Math.max(8, w * 0.04);
        const tw = w - tx * 2;
        const slots = 4;
        const sw = tw / slots;
        const boxPad = narrow ? 4 : 8;

        if (!narrow) {
          label(ctx, "one rendered frame", tx + boxPad, ty - 16, {
            color: PAL.muted,
            mono: true,
            size: 11,
            alpha: pcache,
          });
        }
        ctx.save();
        ctx.globalAlpha = pcache;
        for (let i = 0; i < slots; i++) {
          const sx = tx + i * sw;
          roundedRect(ctx, sx + boxPad, ty, sw - boxPad * 2, boxH, 8);
          ctx.fillStyle = i === 0 ? "rgba(255, 184, 107, 0.14)" : "rgba(122, 162, 255, 0.08)";
          ctx.strokeStyle = i === 0 ? PAL.warm : PAL.grid;
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
          if (i > 0) {
            arrow(ctx, sx - boxPad + 1, ty + boxH / 2, sx + boxPad - 1, ty + boxH / 2, PAL.muted, 1.4, 5);
          }
        }
        ctx.restore();

        for (let i = 0; i < slots; i++) {
          const sx = tx + i * sw;
          label(ctx, narrow ? `step ${i + 1}` : `substep ${i + 1}`, sx + sw / 2, ty + (narrow ? 12 : 16), {
            align: "center",
            color: PAL.text,
            size: narrow ? 10 : 11,
            alpha: pcache,
          });
          const note = i === 0 ? (narrow ? "solve" : "solve magnetics") : narrow ? "reuse" : "reuse cached a";
          label(ctx, note, sx + sw / 2, ty + (narrow ? 27 : 35), {
            align: "center",
            color: i === 0 ? PAL.warm : PAL.accent,
            size: narrow ? 9 : 10,
            mono: true,
            alpha: pcache,
          });
        }
      }
    },
  });
}

// ---- Extractor comparison geometry (computed once from a real sharp-spike SDF) ----

interface EdgeCrossing {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

interface CrossedCell {
  ci: number;
  cj: number;
  crossings: EdgeCrossing[];
  massX: number;
  massY: number;
  dualX: number;
  dualY: number;
}

const EX_NX = 7;
const EX_NY = 4;
const U_APEX = 3.5;
const V_APEX = 0.2;
const SPIKE_SLOPE = 1.06;
const NORM_LEN = Math.hypot(SPIKE_SLOPE, 1);

function spikeY(u: number): number {
  return V_APEX + SPIKE_SLOPE * Math.abs(u - U_APEX);
}

// Negative inside the fluid, positive outside (air).
function spikeField(u: number, v: number): number {
  return spikeY(u) - v;
}

function spikeNormal(u: number): [number, number] {
  return u < U_APEX ? [-SPIKE_SLOPE / NORM_LEN, -1 / NORM_LEN] : [SPIKE_SLOPE / NORM_LEN, -1 / NORM_LEN];
}

function buildExtractorGeometry(): {
  cells: CrossedCell[];
  edgeVerts: [number, number][];
  peakCell: CrossedCell;
} {
  const cells: CrossedCell[] = [];
  const edgeMap = new Map<string, [number, number]>();

  for (let cj = 0; cj < EX_NY; cj++) {
    for (let ci = 0; ci < EX_NX; ci++) {
      const corners: [number, number, number][] = [
        [ci, cj, spikeField(ci, cj)],
        [ci + 1, cj, spikeField(ci + 1, cj)],
        [ci + 1, cj + 1, spikeField(ci + 1, cj + 1)],
        [ci, cj + 1, spikeField(ci, cj + 1)],
      ];
      const crossings: EdgeCrossing[] = [];
      for (let e = 0; e < 4; e++) {
        const [x0, y0, f0] = corners[e];
        const [x1, y1, f1] = corners[(e + 1) % 4];
        if ((f0 < 0) !== (f1 < 0)) {
          const frac = f0 / (f0 - f1);
          const px = lerp(x0, x1, frac);
          const py = lerp(y0, y1, frac);
          const [nx, ny] = spikeNormal(px);
          crossings.push({ x: px, y: py, nx, ny });
          const key = `${Math.round(px * 1000)},${Math.round(py * 1000)}`;
          if (!edgeMap.has(key)) edgeMap.set(key, [px, py]);
        }
      }
      if (crossings.length === 0) continue;

      let massX = 0;
      let massY = 0;
      for (const c of crossings) {
        massX += c.x;
        massY += c.y;
      }
      massX /= crossings.length;
      massY /= crossings.length;

      // Exact iterative tangent-plane solver used by the 3D shader, clamped to the cell.
      let dualX = massX;
      let dualY = massY;
      for (let it = 0; it < 24; it++) {
        let corrX = 0;
        let corrY = 0;
        for (const c of crossings) {
          const d = (c.x - dualX) * c.nx + (c.y - dualY) * c.ny;
          corrX += c.nx * d;
          corrY += c.ny * d;
        }
        dualX = Math.max(ci, Math.min(ci + 1, dualX + corrX / crossings.length));
        dualY = Math.max(cj, Math.min(cj + 1, dualY + corrY / crossings.length));
      }

      cells.push({ ci, cj, crossings, massX, massY, dualX, dualY });
    }
  }

  // Sort left-to-right along the spike contour (matches shared-edge dual adjacency).
  cells.sort((a, b) => a.massX - b.massX);
  const edgeVerts = Array.from(edgeMap.values()).sort((a, b) => a[0] - b[0]);
  const peakCell = cells.find((c) => c.ci === 3 && c.cj === 0)!;
  return { cells, edgeVerts, peakCell };
}

export function mountReliefExtractors(el: HTMLElement): void {
  const geom = buildExtractorGeometry();

  mountScrolly(el, {
    screens: 4.5,
    aspect: 0.62,
    steps: [
      {
        at: 0,
        text: "Here is a 2D slice of the same problem: density values sit only on the grid corners (orange inside the fluid, dim outside), and the true sharp spike passes between them.",
      },
      {
        at: 0.18,
        text: "Marching methods place vertices strictly on grid edges where corner signs flip. Because the top cell only sees two crossings on its sides, it bridges them with a flat bar and slices the tip right off.",
      },
      {
        at: 0.44,
        text: "Surface nets place one vertex inside each crossed cell at the average of its edge crossings, then connect neighboring cells. Averaging pulls the shoulders inward and rounds the top into a gentle arch.",
      },
      {
        at: 0.72,
        text: "Dual contouring keeps that one-vertex-per-cell grid, but reads the surface normal at each crossing too. Extending the two tangent lines inside the peak cell shows where they meet, pulling the vertex straight up to the tip.",
      },
    ],
    draw(ctx, w, h, t) {
      const narrow = w < 560;
      const padX = narrow ? 16 : 36;
      const top = 28;
      const legendRoom = narrow ? 46 : 56;
      const maxGridW = w - padX * 2;
      const maxGridH = Math.max(80, h - top - legendRoom);
      // Square grid cells so surface normals are visually perpendicular to tangent lines.
      const cellSize = Math.min(maxGridW / EX_NX, maxGridH / EX_NY);
      const gw = cellSize * EX_NX;
      const gh = cellSize * EX_NY;
      const x0 = (w - gw) / 2;
      const y0 = top;

      const pGrid = phase(t, 0, 0.08);
      const pEdge = phase(t, 0.18, 0.28);
      const pNet = phase(t, 0.44, 0.53);
      const pDual = phase(t, 0.72, 0.86);

      const X = (u: number): number => x0 + u * cellSize;
      const Y = (v: number): number => y0 + v * cellSize;

      // Soft scalar field fill beneath the true sharp spike.
      ctx.save();
      ctx.globalAlpha = 0.55 * (0.35 + 0.65 * pGrid);
      const grad = ctx.createLinearGradient(0, y0, 0, y0 + gh);
      grad.addColorStop(0, "rgba(122, 162, 255, 0.04)");
      grad.addColorStop(1, "rgba(255, 184, 107, 0.17)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(spikeY(0)));
      ctx.lineTo(X(U_APEX), Y(V_APEX));
      ctx.lineTo(X(EX_NX), Y(spikeY(EX_NX)));
      ctx.lineTo(X(EX_NX), Y(EX_NY));
      ctx.lineTo(X(0), Y(EX_NY));
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Subtle highlight on the peak cell (3, 0) once dual contouring activates.
      if (pDual > 0.01) {
        ctx.save();
        ctx.globalAlpha = pDual;
        ctx.fillStyle = "rgba(255, 184, 107, 0.08)";
        ctx.strokeStyle = "rgba(255, 184, 107, 0.35)";
        ctx.lineWidth = 1.2;
        ctx.fillRect(X(3), Y(0), cellSize, cellSize);
        ctx.strokeRect(X(3), Y(0), cellSize, cellSize);
        ctx.restore();
      }

      // Grid lines and signed corner samples.
      const gridAlpha = 0.28 + 0.72 * pGrid;
      ctx.save();
      ctx.globalAlpha = gridAlpha;
      ctx.strokeStyle = PAL.grid;
      ctx.lineWidth = 1;
      for (let i = 0; i <= EX_NX; i++) {
        ctx.beginPath();
        ctx.moveTo(X(i), Y(0));
        ctx.lineTo(X(i), Y(EX_NY));
        ctx.stroke();
      }
      for (let j = 0; j <= EX_NY; j++) {
        ctx.beginPath();
        ctx.moveTo(X(0), Y(j));
        ctx.lineTo(X(EX_NX), Y(j));
        ctx.stroke();
      }
      for (let j = 0; j <= EX_NY; j++) {
        for (let i = 0; i <= EX_NX; i++) {
          const inside = spikeField(i, j) < 0;
          ctx.fillStyle = inside ? PAL.warm : PAL.dim;
          ctx.beginPath();
          ctx.arc(X(i), Y(j), inside ? 3.4 : 2.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      label(ctx, "corner samples", X(0), Y(0) - 14, {
        color: PAL.muted,
        mono: true,
        size: narrow ? 9 : 11,
        alpha: gridAlpha,
      });

      // True sharp surface (dashed white).
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.32 * pGrid;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(X(0), Y(spikeY(0)));
      ctx.lineTo(X(U_APEX), Y(V_APEX));
      ctx.lineTo(X(EX_NX), Y(spikeY(EX_NX)));
      ctx.stroke();
      ctx.restore();
      label(ctx, narrow ? "true spike" : "true sharp surface", X(2.55), Y(0.26), {
        color: "rgba(255, 255, 255, 0.78)",
        align: "right",
        mono: true,
        size: narrow ? 9 : 11,
        alpha: (0.45 + 0.55 * pGrid) * (1 - pDual * 0.4),
        bg: "rgba(6,7,11,0.86)",
      });

      // 1. Marching: actual linear-interpolated vertices strictly ON grid edges.
      if (pEdge > 0.01) {
        const edgeAlpha = pEdge * (1 - pNet * 0.45 - pDual * 0.15);
        ctx.save();
        ctx.globalAlpha = edgeAlpha;
        ctx.strokeStyle = PAL.accent;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        geom.edgeVerts.forEach(([u, v], i) => {
          if (i === 0) ctx.moveTo(X(u), Y(v));
          else ctx.lineTo(X(u), Y(v));
        });
        ctx.stroke();
        ctx.fillStyle = PAL.accent;
        for (const [u, v] of geom.edgeVerts) {
          ctx.beginPath();
          ctx.arc(X(u), Y(v), narrow ? 3.5 : 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        label(ctx, "edge vertices", X(5.15), Y(1.25), {
          color: PAL.accent,
          mono: true,
          size: narrow ? 9 : 11,
          alpha: pEdge * (1 - pDual * 0.25),
          bg: "rgba(6,7,11,0.86)",
        });
      }

      // 2. Surface net: one averaged vertex per crossed cell, connected across shared edges.
      if (pNet > 0.01) {
        const netAlpha = pNet * (1 - pDual * 0.42);
        ctx.save();
        ctx.globalAlpha = netAlpha;
        ctx.strokeStyle = PAL.good;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        geom.cells.forEach((cell, i) => {
          if (i === 0) ctx.moveTo(X(cell.massX), Y(cell.massY));
          else ctx.lineTo(X(cell.massX), Y(cell.massY));
        });
        ctx.stroke();
        ctx.fillStyle = PAL.good;
        for (const cell of geom.cells) {
          ctx.beginPath();
          ctx.arc(X(cell.massX), Y(cell.massY), narrow ? 3.5 : 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        label(ctx, narrow ? "mass point" : "1 mass point per cell", narrow ? X(0.05) : X(0.15), Y(1.25), {
          color: PAL.good,
          mono: true,
          size: narrow ? 9 : 11,
          alpha: pNet * (1 - pDual * 0.2),
          bg: "rgba(6,7,11,0.86)",
        });
      }

      // 3. Dual contouring: true Hermite tangent lines & normals in the peak cell,
      // pulling the cell's single vertex straight up from the mass point to the sharp apex.
      if (pDual > 0.01) {
        const peak = geom.peakCell;
        ctx.save();
        ctx.globalAlpha = pDual;

        // Exact tangent lines passing through the peak cell's two edge crossings,
        // extending just past their intersection at (3.5, 0.20).
        ctx.strokeStyle = "rgba(255, 184, 107, 0.65)";
        ctx.lineWidth = 1.4;
        for (const c of peak.crossings) {
          // Tangent unit vector perpendicular to outward normal (nx, ny).
          const tx = -c.ny;
          const ty = c.nx;
          const d0 = -0.35;
          const d1 = 1.05;
          // Ensure we extend toward the apex (upward, negative y).
          const dir = ty < 0 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(X(c.x + tx * dir * d0), Y(c.y + ty * dir * d0));
          ctx.lineTo(X(c.x + tx * dir * d1), Y(c.y + ty * dir * d1));
          ctx.stroke();

          // Small outward Hermite normal arrow at the edge crossing.
          const nLen = 0.34;
          arrow(
            ctx,
            X(c.x),
            Y(c.y),
            X(c.x + c.nx * nLen),
            Y(c.y + c.ny * nLen),
            "rgba(255, 184, 107, 0.85)",
            1.4,
            5,
          );
        }

        // Dual contouring polyline smoothly walking from mass points to Hermite vertices.
        ctx.strokeStyle = PAL.warm;
        ctx.lineWidth = 3;
        ctx.beginPath();
        geom.cells.forEach((cell, i) => {
          const ux = lerp(cell.massX, cell.dualX, pDual);
          const uy = lerp(cell.massY, cell.dualY, pDual);
          if (i === 0) ctx.moveTo(X(ux), Y(uy));
          else ctx.lineTo(X(ux), Y(uy));
        });
        ctx.stroke();

        for (const cell of geom.cells) {
          const ux = lerp(cell.massX, cell.dualX, pDual);
          const uy = lerp(cell.massY, cell.dualY, pDual);
          const isPeak = cell === peak;
          ctx.fillStyle = PAL.warm;
          ctx.beginPath();
          ctx.arc(X(ux), Y(uy), isPeak ? (narrow ? 4.5 : 5.5) : narrow ? 3.5 : 4.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Upward walk arrow inside the peak cell from mass point toward the tip.
        const curTipY = lerp(peak.massY, peak.dualY, pDual);
        if (peak.massY - curTipY > 0.14) {
          arrow(ctx, X(peak.massX), Y(peak.massY - 0.07), X(peak.dualX), Y(curTipY + 0.08), PAL.warm, 1.8, 6);
        }
        ctx.restore();

        label(ctx, narrow ? "planes meet at tip" : "tangent planes meet at tip", X(4.15), Y(0.24), {
          color: PAL.warm,
          mono: true,
          size: narrow ? 9 : 11,
          alpha: pDual,
          bg: "rgba(6,7,11,0.86)",
        });
      }

      // Legend.
      const ly = y0 + gh + (narrow ? 24 : 30);
      const legendAlpha = Math.max(pEdge, pNet, pDual, 0.45);
      const items: [string, string][] = narrow
        ? [
            ["marching", PAL.accent],
            ["surface net", PAL.good],
            ["dual contouring", PAL.warm],
          ]
        : [
            ["marching: edge vertices", PAL.accent],
            ["surface net: mass point", PAL.good],
            ["dual contouring: Hermite fit", PAL.warm],
          ];
      const slotW = gw / items.length;
      for (let i = 0; i < items.length; i++) {
        const [txt, color] = items[i];
        const lx = x0 + i * slotW + 6;
        ctx.save();
        ctx.globalAlpha = legendAlpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        label(ctx, txt, lx + 10, ly, {
          color: PAL.muted,
          size: narrow ? 9 : 10,
          alpha: legendAlpha,
        });
      }
    },
  });
}
