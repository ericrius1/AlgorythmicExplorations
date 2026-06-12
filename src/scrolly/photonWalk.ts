// Scroll-driven diagram for part five: one camera ray gambles its way
// through the Cornell box (side view). Each diffuse bounce picks a random
// direction; the throughput thins; one lucky path reaches the lamp.

import { mountScrolly, PAL, phase, clamp01, label } from "../lib/scrolly";

export function mountPhotonWalk(container: HTMLElement): void {
  // box in unit coords: floor y=0.88, ceiling y=0.12, left x=0.22, right x=0.95
  const L = 0.22;
  const R = 0.95;
  const T = 0.14;
  const B = 0.88;

  // a hand-authored path: camera → floor → red wall → sphere → lamp
  const path = [
    { x: 0.02, y: 0.42 },
    { x: 0.62, y: B },     // floor
    { x: L, y: 0.52 },     // left (red) wall
    { x: 0.56, y: 0.62 },  // the sphere
    { x: 0.66, y: T },     // the lamp!
  ];
  const weights = [1, 0.73, 0.47, 0.34]; // throughput after each bounce

  mountScrolly(container, {
    screens: 4,
    aspect: 0.56,
    steps: [
      { at: 0.0, text: "The rendering equation, in one sentence: light leaving a point = light it <em>emits</em> + light <em>arriving</em> from every direction, dimmed by the surface color. The \"every direction\" makes it an integral — and the integrand contains the equation itself, recursively." },
      { at: 0.2, text: "Monte Carlo's bargain: don't integrate over every direction. Follow <em>one</em> random direction, honestly weighted — here, a camera ray hits the floor and rolls dice for its next direction." },
      { at: 0.45, text: "Each bounce multiplies the path's <em>throughput</em> by the surface's color — the path dims as it goes, which is why deep bounces matter less and why the series converges." },
      { at: 0.7, text: "This path got lucky: it found the lamp. Its whole journey lights up that first floor pixel — tinted by everything it touched on the way. Most paths find only darkness; they contribute zero." },
      { at: 0.88, text: "One path is a terrible estimate. But its <em>expected value</em> is the exact integral — so average a few hundred lucky and unlucky paths per pixel and the truth emerges out of static. That is the whole algorithm." },
    ],
    draw(ctx, w, h, t) {
      const X = (x: number): number => x * w;
      const Y = (y: number): number => y * h;

      // box walls
      ctx.lineWidth = 3;
      ctx.strokeStyle = PAL.dim;
      ctx.beginPath(); ctx.moveTo(X(L), Y(T)); ctx.lineTo(X(R), Y(T)); ctx.stroke(); // ceiling
      ctx.beginPath(); ctx.moveTo(X(L), Y(B)); ctx.lineTo(X(R), Y(B)); ctx.stroke(); // floor
      ctx.strokeStyle = PAL.red;
      ctx.beginPath(); ctx.moveTo(X(L), Y(T)); ctx.lineTo(X(L), Y(B)); ctx.stroke(); // red wall
      ctx.strokeStyle = PAL.good;
      ctx.beginPath(); ctx.moveTo(X(R), Y(T)); ctx.lineTo(X(R), Y(B)); ctx.stroke(); // green wall
      // the lamp
      ctx.strokeStyle = PAL.warm;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(X(0.58), Y(T)); ctx.lineTo(X(0.74), Y(T)); ctx.stroke();
      label(ctx, "lamp", X(0.66), Y(T) - 12, { color: PAL.warm, align: "center" });
      // the sphere
      ctx.beginPath();
      ctx.arc(X(0.56), Y(0.68), 0.085 * h, 0, Math.PI * 2);
      ctx.fillStyle = "#1d2233";
      ctx.fill();
      ctx.strokeStyle = PAL.dim;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // camera
      label(ctx, "📷", X(0.015), Y(0.40), { size: 18 });

      // the path, segment by segment
      const pAll = phase(t, 0.12, 0.78);
      const segs = path.length - 1;
      const prog = pAll * segs;
      for (let i = 0; i < segs; i++) {
        const a = clamp01(prog - i);
        if (a <= 0) break;
        const p0 = path[i];
        const p1 = path[i + 1];
        const ex = p0.x + (p1.x - p0.x) * a;
        const ey = p0.y + (p1.y - p0.y) * a;
        const wgt = weights[Math.min(i, weights.length - 1)];
        ctx.strokeStyle = PAL.warm;
        ctx.globalAlpha = 0.25 + 0.75 * wgt;
        ctx.lineWidth = 1.2 + 2.6 * wgt;
        ctx.beginPath();
        ctx.moveTo(X(p0.x), Y(p0.y));
        ctx.lineTo(X(ex), Y(ey));
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (a >= 1 && i < segs - 1) {
          // bounce dot + dice
          ctx.fillStyle = PAL.accent;
          ctx.beginPath();
          ctx.arc(X(p1.x), Y(p1.y), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // throughput readout
      const bDone = Math.floor(Math.min(prog, segs));
      if (bDone >= 1) {
        const wgt = weights[Math.min(bDone - 1, weights.length - 1)];
        label(ctx, `throughput ≈ ${wgt.toFixed(2)}`, X(0.04), Y(0.94), { color: PAL.muted, mono: true });
      }
      // the payoff
      const pWin = phase(t, 0.72, 0.8);
      if (pWin > 0) {
        ctx.globalAlpha = pWin;
        ctx.fillStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(X(0.66), Y(T), 7 + 5 * Math.sin(t * 40), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        label(ctx, "found it — pay the pixel", X(0.66), Y(T) + 22, { color: PAL.warm, align: "center", alpha: pWin });
      }
      // the static→truth finale
      const pAvg = phase(t, 0.86, 1.0);
      if (pAvg > 0) {
        // a noisy strip resolving left to right
        const y0 = 0.30;
        for (let i = 0; i < 60; i++) {
          const x = 0.3 + (i / 60) * 0.5;
          const resolve = clamp01(pAvg * 2.2 - i / 60);
          const noise = (Math.sin(i * 91.7) * 0.5 + Math.sin(i * 47.3 + 2.0) * 0.5) * (1 - resolve);
          const v = 0.55 + 0.45 * Math.sin((i / 60) * Math.PI) + noise * 0.8;
          ctx.fillStyle = `rgba(255, 184, 107, ${clamp01(v) * 0.85 * pAvg})`;
          ctx.fillRect(X(x), Y(y0), w * 0.5 / 60 + 1, 14);
        }
        label(ctx, "1 path = static · many paths = light", X(0.55), Y(y0) - 12, {
          color: PAL.muted, align: "center", alpha: pAvg,
        });
      }
    },
  });
}
