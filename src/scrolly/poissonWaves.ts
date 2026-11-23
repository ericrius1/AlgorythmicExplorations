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
      { at: 0, text: "A lumpy density slice ρ(x) across the box. Poisson's equation asks which potential φ(x) has this curve as its curvature, and in position space every point depends on every other point." },
      { at: 0.16, text: "The FFT rewrites the same curve as a stack of sine waves: here four frequencies, k = 1, 2, 4, and 8 cycles per box, carrying the exact same information in frequency space." },
      { at: 0.4, text: "Each sine wave passes through the Laplacian unchanged in shape, only multiplied by −k². Solving Poisson's equation becomes dividing each wave by −k², flipping its sign and flattening the short ripples." },
      { at: 0.68, text: "An inverse FFT sums the scaled waves back together. Because high frequencies were heavily damped, the jagged density turns into a smooth potential whose deepest valley sits under the densest mass." },
      { at: 0.86, text: "Taking finite differences between neighboring cells gives the downhill force F = −∇φ. A 262,144-unknown system solved by elementwise division." },
    ],
    draw(ctx, w, h, t) {
      const mx = Math.max(52, w * 0.08);
      const plotW = w - 2 * mx;
      const SAMPLES = 160;

      const pRho = phase(t, 0, 0.12);
      const pSplit = phase(t, 0.16, 0.38);
      const pDiv = phase(t, 0.4, 0.64);
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
      // lane during pSplit, flips sign and shrinks by -1/k² during pDiv,
      // then slides down to combine into the potential lane during pSum.
      WAVES.forEach((wv, i) => {
        const stag = phase(pSplit, i * 0.1, i * 0.1 + 0.55);
        if (stag <= 0) return;
        const laneY = laneTop + i * laneGap;
        const divK = phase(pDiv, i * 0.08, i * 0.08 + 0.52);
        const ampSigned = lerp(wv.amp, -wv.amp / (wv.k * wv.k), divK);
        const yMid = lerp(rhoY, lerp(laneY, phiY, pSum), stag);
        const scale = lerp(rhoAmp, lerp(laneAmp / 0.45, phiAmp, pSum), stag);
        const alpha = stag * lerp(1, 0.0, phase(pSum, 0.75, 1));
        drawCurve(
          (x) => ampSigned * Math.sin(wv.k * Math.PI * 2 * x + wv.phi),
          yMid,
          scale,
          wv.color,
          alpha,
          1.6,
        );
        if (pSum < 0.4) {
          label(ctx, `k = ${wv.k}`, mx - 8, laneY, {
            color: wv.color,
            size: 11,
            align: "right",
            mono: true,
            alpha: stag * (1 - phase(pSum, 0, 0.4)),
          });
          // amplitude + signed division annotation
          const ampText =
            divK > 0.3
              ? `÷ (−${wv.k * wv.k}) → −${(wv.amp / (wv.k * wv.k)).toFixed(3)}`
              : `amp ${wv.amp.toFixed(2)}`;
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
