// Scroll diagram for part five: solving Poisson's equation in the wave
// alphabet. A lumpy density curve splits into sine components, each component
// is divided by -k², and the pieces recombine into a smooth potential whose
// downhill slope is the force.

import { mountScrolly, PAL, phase, lerp, arrow, label } from "../lib/scrolly";

interface Wave {
  k: number;
  amp: number;
  phi: number;
  color: string;
}

const WAVES: Wave[] = [
  { k: 1, amp: 0.42, phi: 0.4, color: "#7aa2ff" },
  { k: 2, amp: 0.3, phi: 2.1, color: "#7dd6a0" },
  { k: 4, amp: 0.22, phi: 4.4, color: "#ffb86b" },
  { k: 8, amp: 0.16, phi: 1.0, color: "#ff8585" },
];

export function mountPoissonWaves(el: HTMLElement): void {
  const rho = (x: number): number => {
    let v = 0;
    for (const wv of WAVES) v += wv.amp * Math.sin(wv.k * Math.PI * 2 * x + wv.phi);
    return v;
  };
  const phi = (x: number): number => {
    let v = 0;
    for (const wv of WAVES) v += (-wv.amp / (wv.k * wv.k)) * Math.sin(wv.k * Math.PI * 2 * x + wv.phi);
    return v;
  };

  mountScrolly(el, {
    screens: 5,
    aspect: 0.72,
    steps: [
      { at: 0, text: "A lumpy density field ρ(x) along one line of the box. Poisson's equation asks: what potential φ has this as its curvature? In position space, every point couples to every point." },
      { at: 0.14, text: "Change alphabets. The FFT rewrites the same curve as a sum of sine waves — here four of them, k = 1, 2, 4, 8 ripples per box. Nothing is lost; this is the identical object, re-spelled." },
      { at: 0.42, text: "Now solve. A sine wave passes through ∇² unchanged in shape, just scaled by −k². So per wave, the equation is one division: φₖ = −ρₖ / k². Watch the high frequencies flatten — gravity cares about bulk, not detail." },
      { at: 0.68, text: "Inverse FFT: sum the scaled waves back up. The jagged density became a smooth potential — the deep well sits under the biggest mass concentration." },
      { at: 0.86, text: "Forces are the downhill direction, F = −∇φ: difference neighbouring cells and you're done. A 262,144-unknown system, solved by elementwise division." },
    ],
    draw(ctx, w, h, t) {
      const mx = Math.max(20, w * 0.06);
      const plotW = w - 2 * mx;
      const SAMPLES = 160;

      const pRho = phase(t, 0, 0.12);
      const pSplit = phase(t, 0.14, 0.4);
      const pDiv = phase(t, 0.42, 0.66);
      const pSum = phase(t, 0.68, 0.84);
      const pForce = phase(t, 0.86, 0.98);

      // Layout: density lane on top, 4 component lanes, potential lane at bottom.
      const rhoY = h * 0.13;
      const rhoAmp = h * 0.085;
      const laneTop = h * 0.3;
      const laneGap = h * 0.115;
      const laneAmp = h * 0.042;
      const phiY = h * 0.88;
      const phiAmp = h * 0.1;

      const drawCurve = (
        fn: (x: number) => number,
        yMid: number,
        yScale: number,
        color: string,
        alpha: number,
        width = 1.8,
        growTo = 1,
      ): void => {
        if (alpha <= 0.004) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        const n = Math.max(2, Math.floor(SAMPLES * growTo));
        for (let i = 0; i <= n; i++) {
          const x = i / SAMPLES;
          const sx = mx + x * plotW;
          const sy = yMid - fn(x) * yScale;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.restore();
      };

      // Axis lines.
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = PAL.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, rhoY);
      ctx.lineTo(mx + plotW, rhoY);
      ctx.stroke();
      ctx.restore();

      // Density curve. It dims once decomposition starts.
      const rhoAlpha = pRho * lerp(1, 0.3, pSplit);
      drawCurve(rho, rhoY, rhoAmp, PAL.text, rhoAlpha, 2, pRho);
      label(ctx, "density  ρ(x)", mx, rhoY - rhoAmp - 10, { color: PAL.text, size: 12, alpha: pRho });

      // Component lanes: each wave slides from the density lane to its own
      // lane during pSplit, then its amplitude shrinks by 1/k² during pDiv,
      // then it slides down to the potential lane (negated) during pSum.
      WAVES.forEach((wv, i) => {
        const stag = phase(pSplit, i * 0.12, i * 0.12 + 0.6);
        if (stag <= 0) return;
        const laneY = laneTop + i * laneGap;
        const divK = phase(pDiv, i * 0.1, i * 0.1 + 0.55);
        const amp = lerp(wv.amp, wv.amp / (wv.k * wv.k), divK);
        const sign = lerp(1, -1, pSum); // φ flips sign (−1/k²)
        const yMid = lerp(rhoY, lerp(laneY, phiY, pSum), stag);
        const scale = lerp(rhoAmp, lerp(laneAmp / 0.45, phiAmp, pSum), stag);
        const alpha = stag * lerp(1, 0.0, phase(pSum, 0.75, 1));
        drawCurve(
          (x) => sign * amp * Math.sin(wv.k * Math.PI * 2 * x + wv.phi),
          yMid,
          scale,
          wv.color,
          alpha,
          1.6,
        );
        if (pSum < 0.4) {
          label(ctx, `k = ${wv.k}`, mx - 6, laneY, {
            color: wv.color,
            size: 11,
            align: "right",
            mono: true,
            alpha: stag * (1 - phase(pSum, 0, 0.4)),
          });
          // amplitude + division annotation
          const ampText =
            divK > 0.3 ? `÷ ${wv.k * wv.k} → ${(wv.amp / (wv.k * wv.k)).toFixed(3)}` : `amp ${wv.amp.toFixed(2)}`;
          label(ctx, ampText, mx + plotW, laneY - laneAmp - 8, {
            color: divK > 0.3 ? PAL.warm : PAL.muted,
            size: 10,
            mono: true,
            align: "right",
            alpha: stag * (1 - phase(pSum, 0, 0.4)),
          });
        }
      });

      // Potential curve assembling.
      if (pSum > 0.3) {
        const a = phase(pSum, 0.3, 1);
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = PAL.grid;
        ctx.beginPath();
        ctx.moveTo(mx, phiY);
        ctx.lineTo(mx + plotW, phiY);
        ctx.stroke();
        ctx.restore();
        drawCurve(phi, phiY, phiAmp, PAL.warm, a, 2.2);
        label(ctx, "potential  φ(x)", mx, phiY - phiAmp - 10, { color: PAL.warm, size: 12, alpha: a });
      }

      // Force arrows: downhill along φ.
      if (pForce > 0) {
        const nArrows = 12;
        for (let i = 1; i < nArrows; i++) {
          const x = i / nArrows;
          const eps = 0.004;
          const slope = (phi(x + eps) - phi(x - eps)) / (2 * eps);
          const fx = -slope; // F = -dφ/dx
          const sx = mx + x * plotW;
          const sy = phiY - phi(x) * phiAmp - 12;
          const L = Math.max(-34, Math.min(34, fx * 26)) * pForce;
          if (Math.abs(L) < 3) continue;
          arrow(ctx, sx, sy, sx + L, sy, PAL.good, 1.8, 6);
        }
        label(ctx, "F = −∇φ  (downhill)", mx + plotW, phiY - phiAmp - 10, {
          color: PAL.good,
          size: 11,
          align: "right",
          alpha: pForce,
        });
      }

      // Stage tag.
      const tag =
        pForce > 0
          ? "gradient"
          : pSum > 0
            ? "inverse FFT"
            : pDiv > 0
              ? "divide by −k²"
              : pSplit > 0
                ? "FFT"
                : "";
      if (tag) label(ctx, tag, w - 16, 20, { color: PAL.muted, size: 12, align: "right", mono: true });
    },
  });
}
