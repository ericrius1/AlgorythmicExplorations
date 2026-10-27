// Scroll-driven diagram for part four: one ray sphere-traces toward a scene.
// At every position the distance function gives the ray a radius of empty
// space; the ray moves that far and asks again. Then a second ray grazes an
// edge and shows why silhouettes are expensive.
//
// The scene lives in world units with x across [0, 1] and y down across
// [0, ASPECT]; one scale for both axes, so every circle drawn really is the
// distance to the nearest surface.

import { mountScrolly, PAL, phase, clamp01, label, arrow } from "../lib/scrolly";

interface Circle {
  x: number;
  y: number;
  r: number;
}

const ASPECT = 0.56;
const FLOOR = 0.5; // a floor line near the bottom

const blobs: Circle[] = [
  { x: 0.74, y: 0.3, r: 0.11 },
  { x: 0.91, y: 0.07, r: 0.065 },
  { x: 0.6, y: 0.44, r: 0.055 },
  { x: 0.33, y: 0.07, r: 0.045 },
];

function sdf(x: number, y: number): number {
  let d = FLOOR - y;
  for (const b of blobs) d = Math.min(d, Math.hypot(x - b.x, y - b.y) - b.r);
  return d;
}

interface March {
  pts: Circle[];
  hit: boolean;
}

function march(ox: number, oy: number, ang: number, maxSteps: number): March {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const pts: Circle[] = [];
  let t = 0;
  for (let i = 0; i < maxSteps; i++) {
    const x = ox + dx * t;
    const y = oy + dy * t;
    if (x > 1.02) return { pts, hit: false };
    const r = sdf(x, y);
    pts.push({ x, y, r });
    if (r < 0.002) return { pts, hit: true };
    t += r;
  }
  return { pts, hit: false };
}

export function mountSphereMarch(container: HTMLElement): void {
  // ray one heads for the big blob; ray two skims its top edge
  const hitRay = march(0.04, 0.34, 0.05, 64);
  // aim the grazing ray so it passes within a hair of the top of the big blob
  const gx = 0.04;
  const gy = 0.185;
  const b0 = blobs[0];
  const dist = Math.hypot(b0.x - gx, b0.y - gy);
  const tangent = Math.atan2(b0.y - gy, b0.x - gx) - Math.asin((b0.r + 0.004) / dist);
  const grazeRay = march(gx, gy, tangent, 200);
  const nHit = hitRay.pts.length;
  const nGraze = grazeRay.pts.length;
  // how many of the grazing ray's steps were spent near the edge
  const nearEdge = grazeRay.pts.filter((p) => p.r < 0.02).length;

  mountScrolly(container, {
    screens: 4,
    aspect: ASPECT,
    steps: [
      {
        at: 0.0,
        text: "A ray starts at the left. It can't see the scene. The only thing it can ask is how far it is to the nearest surface, from where it is right now.",
      },
      {
        at: 0.16,
        text: "The answer is the radius of a circle with nothing inside it. The ray can move that far along its direction and be sure it hasn't passed through anything.",
      },
      {
        at: 0.36,
        text: "So it moves, and asks again. Out in the open the circles are big and the ray covers ground quickly.",
      },
      {
        at: 0.56,
        text: `Near a surface the answers shrink and the ray slows down, until it's within a small tolerance of the surface. This ray took ${nHit} steps.`,
      },
      {
        at: 0.72,
        text: `A ray that only grazes a surface has it worse. Every answer along the edge is small, so it inches past: ${nGraze} steps, ${nearEdge} of them right at the edge. Silhouettes are expensive for this reason.`,
      },
    ],
    draw(ctx, w, h, t) {
      // one scale for both axes, centred if the canvas is a little off-aspect
      const s = Math.min(w, h / ASPECT);
      const ox = (w - s) / 2;
      const oy = (h - s * ASPECT) / 2;
      const X = (x: number): number => ox + x * s;
      const Y = (y: number): number => oy + y * s;

      // floor
      ctx.fillStyle = "#151a28";
      ctx.fillRect(X(0), Y(FLOOR), s, h - Y(FLOOR));
      ctx.strokeStyle = PAL.dim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(FLOOR));
      ctx.lineTo(X(1), Y(FLOOR));
      ctx.stroke();

      // the scene's shapes
      for (const b of blobs) {
        ctx.beginPath();
        ctx.arc(X(b.x), Y(b.y), b.r * s, 0, Math.PI * 2);
        ctx.fillStyle = "#1d2233";
        ctx.fill();
        ctx.strokeStyle = "#4a5270";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      const drawMarch = (
        m: March,
        p: number,
        color: string,
        circleAlpha: number,
        dot: number,
      ): number => {
        const n = m.pts.length;
        // the first circle appears before the ray moves
        const shown = Math.min(n, Math.floor(p * (n + 0.999)));
        for (let i = 0; i < shown; i++) {
          const c = m.pts[i];
          const a = clamp01(p * (n + 0.999) - i);
          if (c.r * s > 1.5) {
            ctx.beginPath();
            ctx.arc(X(c.x), Y(c.y), c.r * s, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.05 * a;
            ctx.fill();
            ctx.globalAlpha = circleAlpha * a;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.globalAlpha = a;
          if (i > 0) {
            const q = m.pts[i - 1];
            if (Math.hypot(X(c.x) - X(q.x), Y(c.y) - Y(q.y)) > 9) {
              arrow(ctx, X(q.x), Y(q.y), X(c.x), Y(c.y), color, 1.6, 6);
            } else {
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.6;
              ctx.beginPath();
              ctx.moveTo(X(q.x), Y(q.y));
              ctx.lineTo(X(c.x), Y(c.y));
              ctx.stroke();
            }
          }
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(X(c.x), Y(c.y), dot, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        return shown;
      };

      // ray one: first just the question, then the march
      const p1 = phase(t, 0.1, 0.62);
      const shown1 = drawMarch(hitRay, p1, PAL.warm, 0.6, 3);
      label(ctx, "the ray", X(hitRay.pts[0].x), Y(hitRay.pts[0].y) - 14, { color: PAL.warm, size: 12 });
      if (shown1 === 0) {
        ctx.fillStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(X(hitRay.pts[0].x), Y(hitRay.pts[0].y), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (shown1 === 1) {
        const c = hitRay.pts[0];
        label(ctx, "nearest surface is this far", X(c.x) + c.r * s * 0.35, Y(c.y) + c.r * s * 0.55, {
          color: PAL.muted,
          size: 11,
        });
      }
      if (shown1 >= nHit) {
        const c = hitRay.pts[nHit - 1];
        label(ctx, `hit · ${nHit} steps`, X(c.x) - 8, Y(c.y) + 18, { color: PAL.warm, size: 12, align: "right" });
      }

      // ray two: the graze
      const p2 = phase(t, 0.72, 0.97);
      if (p2 > 0) {
        const shown2 = drawMarch(grazeRay, p2, PAL.red, 0.35, 2);
        if (shown2 > 0) {
          const c0 = grazeRay.pts[0];
          label(ctx, "a grazing ray", X(c0.x), Y(c0.y) - 14, { color: PAL.red, size: 12 });
          const c = grazeRay.pts[shown2 - 1];
          const done = shown2 >= nGraze;
          const txt = done ? `${nGraze} steps` : `${shown2} steps…`;
          label(ctx, txt, Math.min(X(c.x) + 8, X(1) - 4), Y(c.y) - 14, {
            color: PAL.red,
            size: 12,
            align: X(c.x) > X(0.85) ? "right" : "left",
          });
        }
      }
    },
  });
}
