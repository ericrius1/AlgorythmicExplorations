// Scroll diagram for part four: one dust grain, two data structures.
// Far field from the mass pyramid, near field from the hash grid, one
// force kernel adding both answers.

import { mountScrolly, PAL, rng, phase, arrow, label } from "../lib/scrolly";

export function mountTwoStructures(el: HTMLElement): void {
  // A dusty ring around a star, in unit coords centred at (0.5, 0.5).
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
  // The focus grain, on the ring at the right, with a few true neighbours.
  const gx = 0.5 + ringR;
  const gy = 0.5;
  for (let i = 0; i < 7; i++) {
    px.push(gx + (rand() - 0.5) * 0.045);
    py.push(gy + (rand() - 0.5) * 0.045);
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
      { at: 0, text: "A ring of dust around a star. Follow one grain (blue). Each substep it needs two answers: the pull of the whole ring, and the shove of whatever it's touching." },
      { at: 0.18, text: "Far field — the pyramid. Distant stretches of ring collapse into single point masses (orange), part one's tree walk. The star isn't even in the buffer: one analytic GM/r² term." },
      { at: 0.48, text: "Near field — the hash grid. Cells one grain-diameter wide; only the 3×3 block around the grain is searched. Touching neighbours push back, and the dashpot in that push bleeds off energy." },
      { at: 0.78, text: "One kernel asks both structures, adds the arrows, integrates. The structures never talk to each other — they don't even use the same cell size." },
    ],
    draw(ctx, w, h, t) {
      const m = 10;
      const S = Math.min(w - 2 * m, h - 2 * m);
      const ox = (w - S) / 2;
      const oy = (h - S) / 2;
      const X = (x: number): number => ox + x * S;
      const Y = (y: number): number => oy + y * S;

      const pIn = phase(t, 0, 0.1);
      const pFar = phase(t, 0.18, 0.46);
      const pNear = phase(t, 0.48, 0.76);
      const pSum = phase(t, 0.78, 0.97);

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
        ctx.globalAlpha = 0.7 * k * (1 - 0.7 * pSum);
        ctx.strokeStyle = PAL.warm;
        ctx.lineWidth = 1;
        ctx.strokeRect(X(f.boxX), Y(f.boxY), f.boxW * S, f.boxH * S);
        ctx.fillStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(X(f.cx), Y(f.cy), 2 + 2.2 * k * Math.sqrt(f.count / 80), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.4 * k * (1 - 0.7 * pSum);
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
      if (pNear > 0) {
        const c0x = Math.floor(gx / cellW) * cellW;
        const c0y = Math.floor(gy / cellW) * cellW;
        ctx.save();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const k = phase(pNear, 0, 0.4);
            ctx.globalAlpha = 0.8 * k * (1 - 0.5 * pSum);
            ctx.strokeStyle = PAL.accent;
            ctx.lineWidth = 1;
            ctx.strokeRect(X(c0x + dx * cellW), Y(c0y + dy * cellW), cellW * S, cellW * S);
          }
        }
        ctx.restore();

        // Contact arrows from actual close neighbours.
        const kA = phase(pNear, 0.4, 1);
        for (let i = 0; i < N; i++) {
          const d = Math.hypot(px[i] - gx, py[i] - gy);
          if (d < 1e-6 || d > 0.028) continue;
          const push = (0.028 - d) / 0.028;
          nxv -= ((px[i] - gx) / d) * push * 3;
          nyv -= ((py[i] - gy) / d) * push * 3;
          if (kA > 0) {
            ctx.save();
            ctx.globalAlpha = kA * (1 - 0.5 * pSum);
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
        const L = S * 0.13;
        const [ax, ay] = norm(fxv, fyv, L * pSum);
        const [bx2, by2] = norm(nxv, nyv, L * 0.7 * pSum);
        // component arrows from the grain
        arrow(ctx, X(gx), Y(gy), X(gx) + ax, Y(gy) + ay, PAL.warm, 2, 7);
        arrow(ctx, X(gx), Y(gy), X(gx) + bx2, Y(gy) + by2, PAL.red, 2, 7);
        // parallelogram sum
        ctx.save();
        ctx.globalAlpha = 0.35 * pSum;
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
        label(ctx, "gravity (pyramid)", X(gx) + ax + 6, Y(gy) + ay + 10, { color: PAL.warm, size: 10, alpha: pSum });
        label(ctx, "contact (grid)", X(gx) + bx2 + 6, Y(gy) + by2 - 8, { color: PAL.red, size: 10, alpha: pSum });
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
