// Scroll diagram for part four: one dust grain, two data structures.
// Far field from the mass pyramid, near field from the hash grid, one
// force kernel adding both answers.

import { mountScrolly, PAL, rng, phase, arrow, label } from "../lib/scrolly";

export function mountTwoStructures(el: HTMLElement): void {
  // A dusty ring around a star, in unit coords centered at (0.5, 0.5).
  const rand = rng(23);
  const px: number[] = [];
  const py: number[] = [];
  const ringR = 0.34;
  for (let i = 0; i < 420; i++) {
    const a = rand() * Math.PI * 2;
    // a couple of proto-clumps in the ring
    const clump = Math.sin(a * 3 + 1.2) * 0.5 + 0.5;
    const r = ringR + (rand() - 0.5) * (0.05 + 0.05 * (1 - clump));
    px.push(0.5 + Math.cos(a) * r);
    py.push(0.5 + Math.sin(a) * r * 0.92);
  }
  // The focus grain, on the ring at the right, with close neighbors clustered
  // slightly below-left so their contact push angles cleanly up-right against
  // the inward pull of gravity.
  const gx = 0.5 + ringR;
  const gy = 0.5;
  for (let i = 0; i < 7; i++) {
    px.push(gx - 0.003 + (rand() - 0.5) * 0.022);
    py.push(gy + 0.015 + (rand() - 0.5) * 0.018);
  }
  const N = px.length;

  // Far-field cluster summaries: ring sectors standing in for pyramid cells.
  interface Far {
    cx: number;
    cy: number;
    count: number;
    boxX: number;
    boxY: number;
    boxW: number;
    boxH: number;
  }
  const far: Far[] = [];
  const SECTORS = 7;
  for (let s = 0; s < SECTORS; s++) {
    const a0 = Math.PI * 0.25 + (s / SECTORS) * Math.PI * 1.5;
    const a1 = Math.PI * 0.25 + ((s + 1) / SECTORS) * Math.PI * 1.5;
    let cx = 0;
    let cy = 0;
    let n = 0;
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < N; i++) {
      const a = Math.atan2(py[i] - 0.5, px[i] - 0.5);
      const norm = (a - Math.PI * 0.25 + Math.PI * 4) % (Math.PI * 2);
      if (norm < (a0 - Math.PI * 0.25 + Math.PI * 4) % (Math.PI * 2)) continue;
      if (norm >= (a1 - Math.PI * 0.25 + Math.PI * 4) % (Math.PI * 2)) continue;
      cx += px[i];
      cy += py[i];
      n++;
      minX = Math.min(minX, px[i]);
      minY = Math.min(minY, py[i]);
      maxX = Math.max(maxX, px[i]);
      maxY = Math.max(maxY, py[i]);
    }
    if (n > 4) {
      far.push({
        cx: cx / n,
        cy: cy / n,
        count: n,
        boxX: minX - 0.01,
        boxY: minY - 0.01,
        boxW: maxX - minX + 0.02,
        boxH: maxY - minY + 0.02,
      });
    }
  }

  const cellW = 0.03; // hash cell ≈ one grain diameter

  mountScrolly(el, {
    screens: 4,
    aspect: 0.62,
    steps: [
      { at: 0, text: "A ring of dust orbiting a star. Watch the blue grain: on every substep it needs the gravitational pull of the whole ring and the contact push of whichever grains are touching it." },
      { at: 0.18, text: "Far field from the mass pyramid. Distant arcs of the ring collapse into single orange point masses during the tree walk, while the central star adds one analytic GM/r² pull." },
      { at: 0.45, text: "Near field from the hash grid. Each cell is one grain diameter wide, so the kernel only checks the 3×3 block around the grain. Touching neighbors push back, and the dashpot bleeds off impact energy." },
      { at: 0.74, text: "One force kernel reads both structures, adds the two vectors, and integrates. The pyramid and the hash grid stay completely independent and even use different cell sizes." },
    ],
    draw(ctx, w, h, t) {
      const m = 10;
      const S = Math.min(w - 2 * m, h - 2 * m);
      const ox = (w - S) / 2;
      const oy = (h - S) / 2;
      const X = (x: number): number => ox + x * S;
      const Y = (y: number): number => oy + y * S;

      const pIn = phase(t, 0, 0.1);
      const pFar = phase(t, 0.18, 0.42);
      const pNearGrid = phase(t, 0.44, 0.52);
      const pNearArrows = phase(t, 0.5, 0.7);
      const pNear = phase(t, 0.44, 0.7);
      const pSum = phase(t, 0.74, 0.89);

      // Star.
      ctx.save();
      ctx.globalAlpha = pIn;
      const grad = ctx.createRadialGradient(X(0.5), Y(0.5), 0, X(0.5), Y(0.5), S * 0.05);
      grad.addColorStop(0, "#fff6da");
      grad.addColorStop(1, "rgba(255, 214, 130, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(X(0.5), Y(0.5), S * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Dust.
      for (let i = 0; i < N; i++) {
        ctx.globalAlpha = 0.8 * pIn;
        ctx.fillStyle = PAL.dot;
        ctx.beginPath();
        ctx.arc(X(px[i]), Y(py[i]), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // --- far field ---
      let fxv = 0;
      let fyv = 0;
      far.forEach((f, i) => {
        const k = phase(pFar, (i / far.length) * 0.7, (i / far.length) * 0.7 + 0.3);
        if (k <= 0) return;
        const d = Math.hypot(f.cx - gx, f.cy - gy);
        const fmag = f.count / (d * d + 0.05);
        fxv += ((f.cx - gx) / d) * fmag;
        fyv += ((f.cy - gy) / d) * fmag;

        ctx.save();
        ctx.globalAlpha = 0.7 * k * (1 - 0.72 * pSum);
        ctx.strokeStyle = PAL.warm;
        ctx.lineWidth = 1;
        ctx.strokeRect(X(f.boxX), Y(f.boxY), f.boxW * S, f.boxH * S);
        ctx.fillStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(X(f.cx), Y(f.cy), 2 + 2.2 * k * Math.sqrt(f.count / 80), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.4 * k * (1 - 0.72 * pSum);
        ctx.strokeStyle = PAL.warm;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(X(f.cx), Y(f.cy));
        ctx.lineTo(X(gx), Y(gy));
        ctx.stroke();
        ctx.restore();
      });
      // Star pull contributes too.
      const dStar = Math.hypot(0.5 - gx, 0.5 - gy);
      const starMag = 700 / (dStar * dStar);
      fxv += ((0.5 - gx) / dStar) * starMag * 0.004;
      fyv += ((0.5 - gy) / dStar) * starMag * 0.004;

      // --- near field ---
      let nxv = 0;
      let nyv = 0;
      const c0x = Math.floor(gx / cellW) * cellW;
      const c0y = Math.floor(gy / cellW) * cellW;
      if (pNearGrid > 0) {
        ctx.save();
        ctx.globalAlpha = 0.82 * pNearGrid * (1 - 0.55 * pSum);
        ctx.strokeStyle = PAL.accent;
        ctx.lineWidth = 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            ctx.strokeRect(X(c0x + dx * cellW), Y(c0y + dy * cellW), cellW * S, cellW * S);
          }
        }
        ctx.restore();

        // Contact arrows from actual close neighbors.
        for (let i = 0; i < N; i++) {
          const d = Math.hypot(px[i] - gx, py[i] - gy);
          if (d < 1e-6 || d > 0.028) continue;
          const push = (0.028 - d) / 0.028;
          nxv -= ((px[i] - gx) / d) * push * 3;
          nyv -= ((py[i] - gy) / d) * push * 3;
          if (pNearArrows > 0) {
            ctx.save();
            ctx.globalAlpha = pNearArrows * (1 - 0.65 * pSum);
            ctx.fillStyle = PAL.red;
            ctx.beginPath();
            ctx.arc(X(px[i]), Y(py[i]), 2.6, 0, Math.PI * 2);
            ctx.fill();
            const ax = X(gx) - ((px[i] - gx) / d) * push * S * 0.06;
            const ay = Y(gy) - ((py[i] - gy) / d) * push * S * 0.06;
            arrow(ctx, X(gx), Y(gy), ax, ay, PAL.red, 1.6, 6);
            ctx.restore();
          }
        }
      }

      // --- sum ---
      const norm = (vx: number, vy: number, L: number): [number, number] => {
        const len = Math.hypot(vx, vy) || 1;
        return [(vx / len) * L, (vy / len) * L];
      };
      if (pSum > 0) {
        const L = S * 0.16;
        const [ax, ay] = norm(fxv, fyv, L * pSum);
        const [bx2, by2] = norm(nxv, nyv, L * 0.78 * pSum);
        // component arrows from the grain
        arrow(ctx, X(gx), Y(gy), X(gx) + ax, Y(gy) + ay, PAL.warm, 2.2, 7.5);
        arrow(ctx, X(gx), Y(gy), X(gx) + bx2, Y(gy) + by2, PAL.red, 2.2, 7.5);
        // parallelogram sum
        ctx.save();
        ctx.globalAlpha = 0.4 * pSum;
        ctx.strokeStyle = PAL.muted;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(X(gx) + ax, Y(gy) + ay);
        ctx.lineTo(X(gx) + ax + bx2, Y(gy) + ay + by2);
        ctx.moveTo(X(gx) + bx2, Y(gy) + by2);
        ctx.lineTo(X(gx) + ax + bx2, Y(gy) + ay + by2);
        ctx.stroke();
        ctx.restore();
        arrow(ctx, X(gx), Y(gy), X(gx) + ax + bx2, Y(gy) + ay + by2, "#ffffff", 2.6, 9);

        const lblAlpha = phase(pSum, 0.35, 0.85);
        if (lblAlpha > 0) {
          const pill = "rgba(6, 7, 11, 0.86)";
          const boxLeft = X(c0x - cellW);
          const boxRight = X(c0x + 2 * cellW);
          // Gravity points left into the open interior of the ring.
          const gravX = Math.min(boxLeft - 10, X(gx) + ax - 8);
          label(ctx, "gravity (pyramid)", gravX, Y(gy) + ay + 16, {
            color: PAL.warm,
            size: 11,
            align: "right",
            alpha: lblAlpha,
            bg: pill,
          });
          // Contact points up-right into clear space outside the ring.
          const contactRightX = Math.max(boxRight + 10, X(gx) + bx2 + 8);
          const fitsRight = contactRightX + 94 < w - 8;
          label(
            ctx,
            "contact (grid)",
            fitsRight ? contactRightX : w - 12,
            fitsRight ? Y(gy) + by2 : Y(gy) + by2 - 16,
            {
              color: PAL.red,
              size: 11,
              align: fitsRight ? "left" : "right",
              alpha: lblAlpha,
              bg: pill,
            },
          );
          // Resultant points up-left above the parallelogram.
          label(ctx, "net force", X(gx) + ax + bx2 - 8, Y(gy) + ay + by2 - 14, {
            color: "#ffffff",
            size: 11,
            align: "right",
            alpha: lblAlpha,
            bg: pill,
          });
        }
      }

      // Focus grain on top.
      ctx.fillStyle = PAL.accent;
      ctx.beginPath();
      ctx.arc(X(gx), Y(gy), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Phase tag.
      const tag = pSum > 0 ? "force = far + near" : pNear > 0 ? "near field: 3×3 cells" : pFar > 0 ? "far field: tree walk" : "";
      if (tag) label(ctx, tag, w - 16, 22, { color: PAL.muted, size: 12, align: "right", mono: true });
    },
  });
}
