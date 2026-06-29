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

function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string): void {
  ctx.save();
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = "rgba(17, 19, 28, 0.76)";
  ctx.strokeStyle = PAL.grid;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  label(ctx, title, x + 14, y + 18, { color: PAL.text, size: 12 });
  ctx.restore();
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
      { at: 0, text: "A 2D grid query is cheap: a particle checks its own cell and the eight around it. Nine cell ranges, then contiguous particle runs." },
      { at: 0.24, text: "In 3D the same one-cell radius becomes a 3×3×3 block. The code shape is identical, but the loop body runs 27 times instead of 9." },
      { at: 0.52, text: "Magnetics reaches farther than pressure. A three-radius cutoff is 7×7×7 = 343 cells; the old four-radius sweep would be 729." },
      { at: 0.78, text: "The expensive magnetic pass runs once per frame. The next three substeps reuse the cached acceleration while pressure, tension, and collisions keep integrating." },
    ],
    draw(ctx, w, h, t) {
      const pad = 16;
      const gap = 14;
      const panelW = (w - pad * 2 - gap * 2) / 3;
      const panelH = h * 0.68;
      const y = 18;
      const p2 = phase(t, 0, 0.16);
      const p3 = phase(t, 0.24, 0.44);
      const pmag = phase(t, 0.52, 0.72);
      const pcache = phase(t, 0.78, 1);

      drawPanel(ctx, pad, y, panelW, panelH, "2D neighbour query");
      drawPanel(ctx, pad + panelW + gap, y, panelW, panelH, "3D neighbour query");
      drawPanel(ctx, pad + (panelW + gap) * 2, y, panelW, panelH, "magnetic cutoff");

      // 2D 3x3 query.
      const x0 = pad + panelW * 0.18;
      const y0 = y + panelH * 0.25;
      const cell = Math.min(panelW * 0.18, panelH * 0.16);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * p2;
      for (let yy = 0; yy < 3; yy++) {
        for (let xx = 0; xx < 3; xx++) {
          const cx = x0 + xx * cell;
          const cy = y0 + yy * cell;
          ctx.fillStyle = xx === 1 && yy === 1 ? "rgba(122, 162, 255, 0.22)" : "rgba(122, 162, 255, 0.07)";
          ctx.strokeStyle = xx === 1 && yy === 1 ? PAL.accent : PAL.grid;
          ctx.fillRect(cx, cy, cell, cell);
          ctx.strokeRect(cx, cy, cell, cell);
        }
      }
      ctx.fillStyle = PAL.accent;
      ctx.beginPath();
      ctx.arc(x0 + cell * 1.5, y0 + cell * 1.5, 5, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, "9 cells", pad + panelW / 2, y0 + cell * 3 + 28, { align: "center", color: PAL.accent, mono: true });
      ctx.restore();

      // 3D 3x3x3 block, drawn as three offset layers.
      const x1 = pad + panelW + gap + panelW * 0.16;
      const y1 = y + panelH * 0.34;
      const offX = cell * 0.34;
      const offY = cell * 0.22;
      ctx.save();
      ctx.globalAlpha = p3;
      for (let z = 2; z >= 0; z--) {
        const layerAlpha = 0.24 + z * 0.18;
        for (let yy = 0; yy < 3; yy++) {
          for (let xx = 0; xx < 3; xx++) {
            const cx = x1 + xx * cell + z * offX;
            const cy = y1 + yy * cell - z * offY;
            ctx.fillStyle = xx === 1 && yy === 1 && z === 1 ? "rgba(255, 184, 107, 0.2)" : `rgba(122, 162, 255, ${layerAlpha * 0.18})`;
            ctx.strokeStyle = xx === 1 && yy === 1 && z === 1 ? PAL.warm : PAL.grid;
            cubePath(ctx, cx, cy, cell, offX, offY);
            ctx.fillRect(cx, cy, cell, cell);
            ctx.stroke();
          }
        }
      }
      ctx.fillStyle = PAL.warm;
      ctx.beginPath();
      ctx.arc(x1 + cell * 1.5 + offX, y1 + cell * 1.5 - offY, 5, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, "27 cells", pad + panelW + gap + panelW / 2, y0 + cell * 3 + 28, {
        align: "center",
        color: PAL.warm,
        mono: true,
      });
      ctx.restore();

      // Magnetic cutoff: 7x7 visible plane plus z stack count.
      const x2 = pad + (panelW + gap) * 2 + panelW * 0.13;
      const y2 = y + panelH * 0.22;
      const small = Math.min(panelW * 0.08, panelH * 0.07);
      ctx.save();
      ctx.globalAlpha = pmag;
      for (let yy = -4; yy <= 4; yy++) {
        for (let xx = -4; xx <= 4; xx++) {
          const insideNew = Math.abs(xx) <= 3 && Math.abs(yy) <= 3;
          const cx = x2 + (xx + 4) * small;
          const cy = y2 + (yy + 4) * small;
          ctx.fillStyle = insideNew ? "rgba(255, 184, 107, 0.13)" : "rgba(138, 145, 165, 0.035)";
          ctx.strokeStyle = insideNew ? "rgba(255, 184, 107, 0.45)" : "rgba(138, 145, 165, 0.18)";
          ctx.fillRect(cx, cy, small, small);
          ctx.strokeRect(cx, cy, small, small);
        }
      }
      ctx.fillStyle = PAL.red;
      ctx.beginPath();
      ctx.arc(x2 + small * 4.5, y2 + small * 4.5, 4.2, 0, Math.PI * 2);
      ctx.fill();
      label(ctx, "7 layers deep", x2 + small * 9 + 8, y2 + small * 2.2, { color: PAL.muted, size: 10 });
      label(ctx, "343 cells", pad + (panelW + gap) * 2 + panelW / 2, y0 + cell * 3 + 28, {
        align: "center",
        color: PAL.warm,
        mono: true,
      });
      label(ctx, "729 at four radii", pad + (panelW + gap) * 2 + panelW / 2, y0 + cell * 3 + 47, {
        align: "center",
        color: PAL.muted,
        size: 10,
        mono: true,
      });
      ctx.restore();

      // Cached force timeline.
      const ty = y + panelH + h * 0.1;
      const tx = pad + Math.max(12, w * 0.05);
      const tw = w - tx * 2;
      ctx.save();
      ctx.globalAlpha = pcache;
      label(ctx, "one rendered frame", tx, ty - 18, { color: PAL.muted, mono: true });
      const slots = 4;
      const sw = tw / slots;
      for (let i = 0; i < slots; i++) {
        const sx = tx + i * sw;
        roundedRect(ctx, sx + 4, ty, sw - 8, 50, 8);
        ctx.fillStyle = i === 0 ? "rgba(255, 184, 107, 0.14)" : "rgba(122, 162, 255, 0.08)";
        ctx.strokeStyle = i === 0 ? PAL.warm : PAL.grid;
        ctx.fill();
        ctx.stroke();
        label(ctx, `substep ${i + 1}`, sx + sw / 2, ty + 15, { align: "center", color: PAL.text, size: 11 });
        label(ctx, i === 0 ? "solve magnetics" : "reuse cached a", sx + sw / 2, ty + 34, {
          align: "center",
          color: i === 0 ? PAL.warm : PAL.accent,
          size: 10,
          mono: true,
        });
        if (i > 0) arrow(ctx, sx - 6, ty + 25, sx + 5, ty + 25, PAL.muted, 1.4, 5);
      }
      ctx.restore();
    },
  });
}

export function mountReliefExtractors(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 4.5,
    aspect: 0.62,
    steps: [
      { at: 0, text: "A 2D slice of the 3D problem: samples live on grid corners, and the surface is the threshold line hidden between them." },
      { at: 0.18, text: "Marching methods put vertices on edges where signs flip. The cell is handled locally, so the mesh inherits the grid's little diagonal decisions." },
      { at: 0.46, text: "Surface nets flip the construction: one vertex per crossed cell, then neighboring cells connect. Averaging edge crossings makes a smooth, rounded tip." },
      { at: 0.72, text: "Dual contouring keeps the same connectivity but also uses normals. The vertex walks toward the tangent-plane intersection, preserving the spike." },
    ],
    draw(ctx, w, h, t) {
      const mx = Math.max(34, w * 0.08);
      const top = 24;
      const gw = w - mx * 2;
      const gh = h * 0.7;
      const nx = 6;
      const ny = 4;
      const sx = gw / nx;
      const sy = gh / ny;
      const x0 = mx;
      const y0 = top + 6;
      const pGrid = phase(t, 0, 0.1);
      const pEdge = phase(t, 0.18, 0.38);
      const pNet = phase(t, 0.46, 0.66);
      const pDual = phase(t, 0.72, 0.96);

      const X = (u: number): number => x0 + u * sx;
      const Y = (v: number): number => y0 + v * sy;

      // A stylized spike in grid coordinates.
      const left = [
        [1.05, 3.35],
        [2.3, 1.58],
        [2.78, 0.78],
      ];
      const right = [
        [3.22, 0.78],
        [3.72, 1.58],
        [4.95, 3.35],
      ];
      const allCross = [...left, ...right];
      const massVerts = [
        [1.55, 2.86],
        [2.22, 1.92],
        [2.68, 1.22],
        [3.32, 1.22],
        [3.78, 1.92],
        [4.45, 2.86],
      ];
      const dualVerts = [
        [1.42, 3.04],
        [2.08, 2.06],
        [2.92, 0.82],
        [3.08, 0.82],
        [3.92, 2.06],
        [4.58, 3.04],
      ];

      // Soft scalar field under the threshold line.
      ctx.save();
      ctx.globalAlpha = 0.55 * pGrid;
      const grad = ctx.createLinearGradient(0, y0, 0, y0 + gh);
      grad.addColorStop(0, "rgba(122, 162, 255, 0.03)");
      grad.addColorStop(1, "rgba(255, 184, 107, 0.16)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(X(1.0), Y(3.45));
      ctx.lineTo(X(2.78), Y(0.72));
      ctx.lineTo(X(3.22), Y(0.72));
      ctx.lineTo(X(5.0), Y(3.45));
      ctx.lineTo(X(5.35), Y(4));
      ctx.lineTo(X(0.65), Y(4));
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Grid and signs.
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * pGrid;
      ctx.strokeStyle = PAL.grid;
      ctx.lineWidth = 1;
      for (let i = 0; i <= nx; i++) {
        ctx.beginPath();
        ctx.moveTo(X(i), Y(0));
        ctx.lineTo(X(i), Y(ny));
        ctx.stroke();
      }
      for (let j = 0; j <= ny; j++) {
        ctx.beginPath();
        ctx.moveTo(X(0), Y(j));
        ctx.lineTo(X(nx), Y(j));
        ctx.stroke();
      }
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const center = Math.abs(i - 3);
          const thresholdY = 0.64 + center * 0.62;
          const inside = j > thresholdY;
          ctx.fillStyle = inside ? PAL.warm : PAL.dim;
          ctx.beginPath();
          ctx.arc(X(i), Y(j), inside ? 3.3 : 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      label(ctx, "corner samples", X(0), Y(0) - 14, { color: PAL.muted, mono: true, size: 11 });
      ctx.restore();

      // True threshold shape.
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.25 * pGrid;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(X(1.0), Y(3.45));
      ctx.lineTo(X(2.78), Y(0.72));
      ctx.lineTo(X(3.22), Y(0.72));
      ctx.lineTo(X(5.0), Y(3.45));
      ctx.stroke();
      ctx.restore();

      // Edge crossings and marching-style local segments.
      if (pEdge > 0) {
        ctx.save();
        ctx.globalAlpha = pEdge * (1 - pDual * 0.25);
        ctx.strokeStyle = PAL.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < allCross.length; i++) {
          const [a, b] = allCross[i];
          if (i === 0) ctx.moveTo(X(a), Y(b));
          else ctx.lineTo(X(a), Y(b));
        }
        ctx.stroke();
        for (const [a, b] of allCross) {
          ctx.fillStyle = PAL.accent;
          ctx.beginPath();
          ctx.arc(X(a), Y(b), 5, 0, Math.PI * 2);
          ctx.fill();
        }
        label(ctx, "edge vertices", X(4.9), Y(1.05), { color: PAL.accent, mono: true, alpha: pEdge });
        ctx.restore();
      }

      // Surface-net mass points.
      if (pNet > 0) {
        ctx.save();
        ctx.globalAlpha = pNet * (1 - pDual * 0.35);
        ctx.strokeStyle = PAL.good;
        ctx.lineWidth = 3;
        ctx.beginPath();
        massVerts.forEach(([a, b], i) => {
          if (i === 0) ctx.moveTo(X(a), Y(b));
          else ctx.lineTo(X(a), Y(b));
        });
        ctx.stroke();
        for (const [a, b] of massVerts) {
          ctx.fillStyle = PAL.good;
          ctx.beginPath();
          ctx.arc(X(a), Y(b), 5, 0, Math.PI * 2);
          ctx.fill();
        }
        label(ctx, "one averaged vertex per cell", X(0.2), Y(3.72), {
          color: PAL.good,
          mono: true,
          alpha: pNet,
        });
        ctx.restore();
      }

      // Dual-contouring tangent planes and sharpened vertices.
      if (pDual > 0) {
        ctx.save();
        ctx.globalAlpha = pDual;
        ctx.strokeStyle = "rgba(255, 184, 107, 0.55)";
        ctx.lineWidth = 1.4;
        const tangentPlanes = [
          [2.46, 1.38, -0.58],
          [3.54, 1.38, 0.58],
          [3.0, 0.82, 0],
        ];
        for (const [a, b, slope] of tangentPlanes) {
          const len = 0.78;
          ctx.beginPath();
          ctx.moveTo(X(a - len), Y(b - slope * len));
          ctx.lineTo(X(a + len), Y(b + slope * len));
          ctx.stroke();
        }
        ctx.strokeStyle = PAL.warm;
        ctx.lineWidth = 3;
        ctx.beginPath();
        dualVerts.forEach(([a, b], i) => {
          const m = massVerts[i];
          const x = lerp(m[0], a, pDual);
          const y = lerp(m[1], b, pDual);
          if (i === 0) ctx.moveTo(X(x), Y(y));
          else ctx.lineTo(X(x), Y(y));
        });
        ctx.stroke();
        for (let i = 0; i < dualVerts.length; i++) {
          const m = massVerts[i];
          const d = dualVerts[i];
          const x = lerp(m[0], d[0], pDual);
          const y = lerp(m[1], d[1], pDual);
          ctx.fillStyle = PAL.warm;
          ctx.beginPath();
          ctx.arc(X(x), Y(y), 5, 0, Math.PI * 2);
          ctx.fill();
        }
        arrow(ctx, X(2.72), Y(1.18), X(2.95), Y(0.86), PAL.warm, 1.8, 7);
        arrow(ctx, X(3.28), Y(1.18), X(3.05), Y(0.86), PAL.warm, 1.8, 7);
        label(ctx, "planes meet at the feature", X(3.15), Y(0.42), {
          color: PAL.warm,
          mono: true,
          alpha: pDual,
        });
        ctx.restore();
      }

      // Legend.
      const ly = y0 + gh + 32;
      ctx.save();
      ctx.globalAlpha = Math.max(pEdge, pNet, pDual, 0.35);
      const items: [string, string][] = [
        ["marching: edge vertices", PAL.accent],
        ["surface net: mass point", PAL.good],
        ["dual contouring: Hermite fit", PAL.warm],
      ];
      let lx = mx;
      for (const [txt, color] of items) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
        label(ctx, txt, lx + 10, ly, { color: PAL.muted, size: 10 });
        lx += Math.min(220, w * 0.31);
      }
      ctx.restore();
    },
  });
}
