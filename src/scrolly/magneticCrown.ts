// Scroll diagram for Strange Matter part two: a uniform field magnetizes the
// particles, then pairwise attraction and repulsion organize a crown.

import { arrow, label, lerp, mountScrolly, PAL, phase, rng } from "../lib/scrolly";

interface Particle {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  peak: number;
  row: number;
}

const PEAKS = [0.22, 0.5, 0.78];
const COLS = 17;
const ROWS = 5;

function makeParticles(): Particle[] {
  const rand = rng(42);
  const particles: Particle[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = 0.11 + (col / (COLS - 1)) * 0.78 + (rand() - 0.5) * 0.008;
      const y0 = 0.75 - row * 0.052 + (rand() - 0.5) * 0.008;

      let peak = 0;
      let best = Infinity;
      for (let i = 0; i < PEAKS.length; i++) {
        const d = Math.abs(x0 - PEAKS[i]);
        if (d < best) {
          best = d;
          peak = i;
        }
      }

      // Upper rows gather strongly into peaks; lower rows move less so the
      // body remains a connected pool.
      const gather = (row / (ROWS - 1)) ** 1.5;
      const targetX = lerp(x0, PEAKS[peak], gather * 0.66);
      const local = Math.max(0, 1 - best / 0.17);
      const lift = local ** 2 * gather * 0.28;

      particles.push({
        x0,
        y0,
        x1: targetX,
        y1: y0 - lift,
        peak,
        row,
      });
    }
  }

  return particles;
}

function drawMoment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  alpha: number,
  color = PAL.accent,
): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  arrow(ctx, x, y + length * 0.45, x, y - length * 0.55, color, 1.25, 4);
  ctx.restore();
}

function drawSurface(
  ctx: CanvasRenderingContext2D,
  X: (x: number) => number,
  Y: (y: number) => number,
  crown: number,
): void {
  ctx.save();
  ctx.strokeStyle = PAL.dot;
  ctx.lineWidth = 1.8;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  const samples = 90;
  for (let i = 0; i <= samples; i++) {
    const x = 0.08 + (i / samples) * 0.84;
    let lift = 0;
    for (const peak of PEAKS) {
      const d = (x - peak) / 0.065;
      lift += Math.exp(-d * d) * 0.25;
    }
    const y = 0.515 - crown * lift;
    if (i === 0) ctx.moveTo(X(x), Y(y));
    else ctx.lineTo(X(x), Y(y));
  }
  ctx.stroke();
  ctx.restore();
}

function forcePair(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  outward: boolean,
  alpha: number,
  color: string,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sign = outward ? -1 : 1;
  const a = Math.min(24, len * 0.34);

  ctx.save();
  ctx.globalAlpha *= alpha;
  arrow(ctx, x0, y0, x0 + ux * a * sign, y0 + uy * a * sign, color, 2.1, 7);
  arrow(ctx, x1, y1, x1 - ux * a * sign, y1 - uy * a * sign, color, 2.1, 7);
  ctx.restore();
}

export function mountMagneticCrown(el: HTMLElement): void {
  const particles = makeParticles();

  mountScrolly(el, {
    screens: 5,
    aspect: 0.58,
    steps: [
      {
        at: 0,
        text: "The applied field has the same strength and direction everywhere. Because its gradient is zero, it cannot pull the fluid toward any location.",
      },
      {
        at: 0.18,
        text: "The uniform field still magnetizes the fluid. Each particle acquires an upward magnetic moment, and each moment produces its own local field.",
      },
      {
        at: 0.38,
        text: "Aligned particles attract head to tail. That attraction gathers particles vertically and starts raising columns from the surface.",
      },
      {
        at: 0.58,
        text: "The same aligned particles repel when they sit side by side. Neighboring columns therefore push apart instead of merging into one wide mound.",
      },
      {
        at: 0.78,
        text: "Vertical attraction builds spikes; horizontal repulsion spaces them. Gravity and surface tension limit their height and sharpness, producing the crown.",
      },
    ],
    draw(ctx, w, h, t) {
      const padX = Math.max(12, w * 0.04);
      const padY = Math.max(12, h * 0.04);
      const drawW = w - padX * 2;
      const drawH = h - padY * 2;
      const X = (x: number): number => padX + x * drawW;
      const Y = (y: number): number => padY + y * drawH;
      const compact = w < 520;

      const pField = 0.35 + phase(t, 0, 0.1) * 0.65;
      const pMoments = phase(t, 0.18, 0.34);
      const pVertical = phase(t, 0.38, 0.54);
      const pHorizontal = phase(t, 0.58, 0.74);
      const pCrown = phase(t, 0.76, 0.97);
      const organize = phase(t, 0.36, 0.94);

      // Dish.
      ctx.save();
      ctx.globalAlpha = pField;
      ctx.strokeStyle = PAL.grid;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X(0.07), Y(0.49));
      ctx.lineTo(X(0.07), Y(0.82));
      ctx.quadraticCurveTo(X(0.07), Y(0.87), X(0.13), Y(0.87));
      ctx.lineTo(X(0.87), Y(0.87));
      ctx.quadraticCurveTo(X(0.93), Y(0.87), X(0.93), Y(0.82));
      ctx.lineTo(X(0.93), Y(0.49));
      ctx.stroke();
      ctx.restore();

      drawSurface(ctx, X, Y, pCrown);

      // Uniform external field. Equal arrows make the zero gradient visible.
      const fieldFade = 1 - phase(t, 0.3, 0.42) * 0.62;
      for (let i = 0; i < 7; i++) {
        const x = 0.13 + (i / 6) * 0.74;
        ctx.save();
        ctx.globalAlpha = pField * fieldFade * 0.72;
        arrow(ctx, X(x), Y(0.42), X(x), Y(0.15), PAL.warm, 1.8, 7);
        ctx.restore();
      }
      label(ctx, "uniform external field  H", X(0.5), Y(0.1), {
        color: PAL.warm,
        size: compact ? 9 : 12,
        align: "center",
        alpha: pField * fieldFade * (1 - pCrown * 0.9),
        mono: true,
      });
      label(ctx, "∇H = 0  →  no net force", X(0.5), Y(0.94), {
        color: PAL.good,
        size: compact ? 9 : 12,
        align: "center",
        alpha: pField * (1 - phase(t, 0.32, 0.48)),
        mono: true,
      });

      // Particle body, morphing from a flat pool into columns.
      for (const p of particles) {
        const x = X(lerp(p.x0, p.x1, organize));
        const y = Y(lerp(p.y0, p.y1, organize));
        const upper = p.row / (ROWS - 1);
        const active = pMoments * (0.45 + upper * 0.55);

        ctx.fillStyle = active > 0.35 ? PAL.accent : PAL.dot;
        ctx.globalAlpha = 0.48 + active * 0.42;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.1, drawW * 0.0036), 0, Math.PI * 2);
        ctx.fill();

        if (pMoments > 0.05 && (p.row >= 2 || p.peak === 1)) {
          drawMoment(ctx, x, y, Math.max(8, drawH * 0.032), pMoments * 0.72);
        }
      }
      ctx.globalAlpha = 1;

      // Isolate a vertical pair to explain head-to-tail attraction.
      if (pVertical > 0) {
        const x = X(0.5);
        const y0 = Y(0.47);
        const y1 = Y(0.64);
        ctx.save();
        ctx.globalAlpha = pVertical * (1 - pCrown);
        ctx.fillStyle = PAL.accent;
        for (const y of [y0, y1]) {
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fill();
          drawMoment(ctx, x, y, 22, 1, PAL.accent);
        }
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = PAL.good;
        ctx.beginPath();
        ctx.moveTo(x, y0 + 8);
        ctx.lineTo(x, y1 - 8);
        ctx.stroke();
        ctx.setLineDash([]);
        forcePair(ctx, x, y0, x, y1, false, 1, PAL.good);
        ctx.restore();
        if (!compact) {
          label(ctx, "head-to-tail attraction", x + 22, (y0 + y1) / 2, {
            color: PAL.good,
            size: 11,
            alpha: pVertical * (1 - pCrown),
          });
        }
      }

      // Isolate a horizontal pair to explain side-by-side repulsion.
      if (pHorizontal > 0) {
        const x0 = X(0.37);
        const x1 = X(0.63);
        const y = Y(0.43);
        ctx.save();
        ctx.globalAlpha = pHorizontal * (1 - pCrown);
        ctx.fillStyle = PAL.accent;
        for (const x of [x0, x1]) {
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fill();
          drawMoment(ctx, x, y, 22, 1, PAL.accent);
        }
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = PAL.red;
        ctx.beginPath();
        ctx.moveTo(x0 + 8, y);
        ctx.lineTo(x1 - 8, y);
        ctx.stroke();
        ctx.setLineDash([]);
        forcePair(ctx, x0, y, x1, y, true, 1, PAL.red);
        ctx.restore();
        if (!compact) {
          label(ctx, "side-by-side repulsion", (x0 + x1) / 2, y - 28, {
            color: PAL.red,
            size: 11,
            align: "center",
            alpha: pHorizontal * (1 - pCrown),
          });
        }
      }

      // Final balance annotations.
      if (pCrown > 0) {
        for (const peak of PEAKS) {
          arrow(ctx, X(peak), Y(0.18), X(peak), Y(0.28), PAL.muted, 1.5, 6);
        }
        label(ctx, "gravity + surface tension limit the spikes", X(0.5), Y(0.12), {
          color: PAL.muted,
          size: compact ? 9 : 11,
          align: "center",
          alpha: pCrown,
        });

        const spacingY = Y(0.38);
        arrow(ctx, X(PEAKS[0] + 0.02), spacingY, X(PEAKS[1] - 0.02), spacingY, PAL.red, 1.5, 6);
        arrow(ctx, X(PEAKS[1] - 0.02), spacingY, X(PEAKS[0] + 0.02), spacingY, PAL.red, 1.5, 6);
        arrow(ctx, X(PEAKS[1] + 0.02), spacingY, X(PEAKS[2] - 0.02), spacingY, PAL.red, 1.5, 6);
        arrow(ctx, X(PEAKS[2] - 0.02), spacingY, X(PEAKS[1] + 0.02), spacingY, PAL.red, 1.5, 6);
        label(ctx, "repulsion sets the spacing", X(0.5), spacingY - 15, {
          color: PAL.red,
          size: compact ? 9 : 11,
          align: "center",
          alpha: pCrown,
        });
      }

      if (!compact) {
        const state =
          pCrown > 0.3
            ? "crown: attraction + repulsion + restoring forces"
            : pHorizontal > 0.3
              ? "pair force: repel sideways"
              : pVertical > 0.3
                ? "pair force: attract vertically"
                : pMoments > 0.3
                  ? "uniform field: magnetization without net force"
                  : "uniform field: zero gradient";
        label(ctx, state, w - 14, 20, {
          color: PAL.muted,
          size: 10,
          align: "right",
          mono: true,
        });
      }
    },
  });
}
