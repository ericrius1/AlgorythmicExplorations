// Scroll diagram for part six: the pressure projection. A velocity field with
// an illegal pile-up gets its divergence measured, a pressure field pushes
// back, and the gradient subtraction leaves pure swirl.

import { mountScrolly, PAL, phase, lerp, arrow, label } from "../lib/scrolly";

const GW = 22;
const GH = 14;
const JACOBI_SNAPSHOTS = 16;
const JACOBI_PER_SNAPSHOT = 5;

export function mountProjection(el: HTMLElement): void {
  // Initial field: a gentle swirl plus a strong divergent source — the kind
  // of field a stirring hand leaves behind.
  const u0 = new Float32Array(GW * GH);
  const v0 = new Float32Array(GW * GH);
  const cx1 = GW * 0.32;
  const cy1 = GH * 0.55;
  const cx2 = GW * 0.68;
  const cy2 = GH * 0.4;
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const idx = j * GW + i;
      // swirl around (cx1, cy1)
      const dx1 = i - cx1;
      const dy1 = j - cy1;
      const r1 = Math.hypot(dx1, dy1) + 1e-3;
      const s1 = Math.exp(-(r1 * r1) / 30) * 1.4;
      u0[idx] += (-dy1 / r1) * s1;
      v0[idx] += (dx1 / r1) * s1;
      // divergent source at (cx2, cy2)
      const dx2 = i - cx2;
      const dy2 = j - cy2;
      const r2 = Math.hypot(dx2, dy2) + 1e-3;
      const s2 = Math.exp(-(r2 * r2) / 14) * 1.7;
      u0[idx] += (dx2 / r2) * s2;
      v0[idx] += (dy2 / r2) * s2;
    }
  }

  // Divergence (central differences, clamped edges).
  const at = (f: Float32Array, i: number, j: number): number =>
    f[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))];
  const div = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      div[j * GW + i] = (at(u0, i + 1, j) - at(u0, i - 1, j) + at(v0, i, j + 1) - at(v0, i, j - 1)) / 2;
    }
  }

  // Jacobi iterations on ∇²p = div, snapshots saved as the solve progresses.
  const snapshots: Float32Array[] = [];
  let p = new Float32Array(GW * GH);
  snapshots.push(p.slice());
  for (let s = 0; s < JACOBI_SNAPSHOTS; s++) {
    for (let it = 0; it < JACOBI_PER_SNAPSHOT; it++) {
      const q = new Float32Array(GW * GH);
      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          q[j * GW + i] = (at(p, i - 1, j) + at(p, i + 1, j) + at(p, i, j - 1) + at(p, i, j + 1) - div[j * GW + i]) / 4;
        }
      }
      p = q;
    }
    snapshots.push(p.slice());
  }
  const pFinal = snapshots[snapshots.length - 1];

  // Projected field: u1 = u0 − ∇p.
  const u1 = new Float32Array(GW * GH);
  const v1 = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      u1[j * GW + i] = u0[j * GW + i] - (at(pFinal, i + 1, j) - at(pFinal, i - 1, j)) / 2;
      v1[j * GW + i] = v0[j * GW + i] - (at(pFinal, i, j + 1) - at(pFinal, i, j - 1)) / 2;
    }
  }

  let maxP = 0;
  for (const v of pFinal) maxP = Math.max(maxP, Math.abs(v));
  let maxD = 0;
  for (const v of div) maxD = Math.max(maxD, Math.abs(v));

  mountScrolly(el, {
    screens: 4,
    aspect: 0.6,
    steps: [
      { at: 0, text: "A velocity field after stirring: a vortex on the left, and an illegal pile-up on the right where flow pours outward from nothing. Real incompressible fluid forbids that." },
      { at: 0.16, text: "Measure the crime: divergence. Red cells create fluid, blue cells swallow it. The vortex barely registers — rotation is legal. The source glows red." },
      { at: 0.38, text: "Solve ∇²p = ∇·u for pressure. Here it's Jacobi relaxation: every cell repeatedly averages its neighbours. Scrub slowly — you're watching the pressure field negotiate itself into shape, sweep by sweep." },
      { at: 0.68, text: "Subtract the pressure gradient. The outflow collapses, the divergence map goes dark, and what's left is pure swirl — the part of the motion that reads as fluid." },
    ],
    draw(ctx, w, h, t) {
      const m = 12;
      const cw = (w - 2 * m) / GW;
      const ch = (h - 2 * m - 16) / GH;
      const ox = m;
      const oy = m;

      const pIn = phase(t, 0, 0.1);
      const pDiv = phase(t, 0.16, 0.34);
      const pSolve = phase(t, 0.38, 0.66);
      const pProj = phase(t, 0.68, 0.92);

      // Divergence underlay (fades as the projection removes it).
      const divAlpha = pDiv * (1 - pProj);
      if (divAlpha > 0.01) {
        for (let j = 0; j < GH; j++) {
          for (let i = 0; i < GW; i++) {
            const d = div[j * GW + i] / maxD;
            if (Math.abs(d) < 0.04) continue;
            ctx.fillStyle = d > 0 ? `rgba(255, 110, 110, ${0.45 * d * divAlpha})` : `rgba(100, 150, 255, ${-0.45 * d * divAlpha})`;
            ctx.fillRect(ox + i * cw, oy + j * ch, cw, ch);
          }
        }
      }

      // Pressure contours during the solve (snapshot scrubbed by progress).
      if (pSolve > 0) {
        const snapF = pSolve * (snapshots.length - 1);
        const s0 = Math.floor(snapF);
        const s1 = Math.min(snapshots.length - 1, s0 + 1);
        const mix = snapF - s0;
        const alpha = Math.min(1, pSolve * 3) * (1 - 0.55 * pProj);
        for (let j = 0; j < GH; j++) {
          for (let i = 0; i < GW; i++) {
            const val = lerp(snapshots[s0][j * GW + i], snapshots[s1][j * GW + i], mix) / (maxP || 1);
            if (Math.abs(val) < 0.05) continue;
            ctx.fillStyle =
              val > 0
                ? `rgba(255, 184, 107, ${0.4 * Math.min(1, val) * alpha})`
                : `rgba(125, 214, 160, ${0.4 * Math.min(1, -val) * alpha})`;
            ctx.fillRect(ox + i * cw, oy + j * ch, cw, ch);
          }
        }
        const sweeps = Math.round(snapF * JACOBI_PER_SNAPSHOT);
        label(ctx, `jacobi sweeps: ${sweeps}`, w - 14, h - 10, {
          color: PAL.muted,
          size: 11,
          align: "right",
          mono: true,
          alpha: Math.min(1, pSolve * 3) * (1 - pProj),
        });
      }

      // Velocity arrows, interpolating from raw to projected.
      const step = 2;
      for (let j = 0; j < GH; j += 1) {
        for (let i = 0; i < GW; i += 1) {
          if ((i + j) % step !== 0) continue;
          const idx = j * GW + i;
          const ux = lerp(u0[idx], u1[idx], pProj);
          const uy = lerp(v0[idx], v1[idx], pProj);
          const mag = Math.hypot(ux, uy);
          if (mag < 0.05) continue;
          const x = ox + (i + 0.5) * cw;
          const y = oy + (j + 0.5) * ch;
          const L = Math.min(cw * 1.5, mag * cw * 0.9);
          ctx.globalAlpha = pIn * Math.min(1, 0.35 + mag * 0.5);
          arrow(ctx, x - (ux / mag) * L * 0.5, y - (uy / mag) * L * 0.5, x + (ux / mag) * L * 0.5, y + (uy / mag) * L * 0.5, PAL.dot, 1.3, 4.5);
        }
      }
      ctx.globalAlpha = 1;

      // Stage tag.
      const tag =
        pProj > 0
          ? "u ← u − ∇p"
          : pSolve > 0
            ? "∇²p = ∇·u"
            : pDiv > 0
              ? "measure divergence"
              : "raw velocity field";
      label(ctx, tag, w - 14, 20, { color: PAL.muted, size: 12, align: "right", mono: true });
    },
  });
}
