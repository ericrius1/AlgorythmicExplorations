// Scroll-driven diagram for part four: one ray sphere-traces toward a scene.
// At every position the distance function hands the ray a radius of certified
// empty space; the ray leaps exactly that far and asks again. The same
// figure then shows the cheap miss: a ray that grazes the surface creeps.

import { mountScrolly, PAL, phase, clamp01, label, arrow } from "../lib/scrolly";

interface Circle { x: number; y: number; r: number }

export function mountSphereMarch(container: HTMLElement): void {
  // scene in unit coords (x 0..1, y 0..1, y up drawn down later)
  const blobs: Circle[] = [
    { x: 0.78, y: 0.62, r: 0.16 },
    { x: 0.86, y: 0.38, r: 0.12 },
    { x: 0.62, y: 0.8, r: 0.1 },
  ];

  const sdf = (x: number, y: number): number => {
    let d = Infinity;
    for (const b of blobs) d = Math.min(d, Math.hypot(x - b.x, y - b.y) - b.r);
    return d;
  };

  // precompute the two marches
  const marchFrom = (ox: number, oy: number, dx: number, dy: number, n: number): { x: number; y: number; r: number }[] => {
    const pts: { x: number; y: number; r: number }[] = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      const x = ox + dx * t;
      const y = oy + dy * t;
      const r = sdf(x, y);
      pts.push({ x, y, r });
      if (r < 0.004) break;
      t += r;
    }
    return pts;
  };

  const hit = marchFrom(0.07, 0.42, Math.cos(-0.12), Math.sin(-0.12), 10);
  // grazing ray: passes just over the top blob
  const graze = marchFrom(0.07, 0.28, Math.cos(0.06), Math.sin(0.06), 26);

  mountScrolly(container, {
    screens: 4,
    aspect: 0.56,
    steps: [
      { at: 0.0, text: "One ray, marching toward a scene it cannot see. All it may do is ask, at any point: <em>how far is the nearest surface?</em>" },
      { at: 0.18, text: "The answer is a radius of <em>certified empty space</em> — a circle that touches nothing. The ray can leap that far with no risk of skipping through a surface." },
      { at: 0.42, text: "From the new position, ask again. Far from everything, the circles are huge and the ray crosses the scene in a few leaps. This is the distance field doing for one ray what it did for thousands in part one." },
      { at: 0.62, text: "Close to a surface, the answers shrink, and the ray brakes to a halt exactly at the boundary — within ten steps here." },
      { at: 0.78, text: "The failure mode: a ray that <em>grazes</em> a surface. Every answer is tiny — certified space is honest but unhelpful — and the ray creeps for dozens of steps. Step-count heatmaps glow brightest along silhouettes for exactly this reason." },
    ],
    draw(ctx, w, h, t) {
      const X = (x: number): number => x * w;
      const Y = (y: number): number => y * h;

      // the scene blobs
      for (const b of blobs) {
        ctx.beginPath();
        ctx.arc(X(b.x), Y(b.y), b.r * w, 0, Math.PI * 2);
        ctx.fillStyle = "#1d2233";
        ctx.fill();
        ctx.strokeStyle = PAL.dim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // phase 1: the hit march, circle by circle
      const p1 = phase(t, 0.05, 0.6);
      const shown = Math.min(hit.length, Math.floor(p1 * (hit.length + 1)));
      for (let i = 0; i < shown; i++) {
        const s = hit[i];
        const a = clamp01(p1 * (hit.length + 1) - i);
        ctx.beginPath();
        ctx.arc(X(s.x), Y(s.y), Math.max(s.r * w, 1.2), 0, Math.PI * 2);
        ctx.strokeStyle = PAL.accent;
        ctx.globalAlpha = 0.55 * a;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.fillStyle = PAL.warm;
        ctx.beginPath();
        ctx.arc(X(s.x), Y(s.y), 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (i > 0) {
          const q = hit[i - 1];
          ctx.globalAlpha = a;
          arrow(ctx, X(q.x), Y(q.y), X(s.x), Y(s.y), PAL.warm, 1.6, 6);
          ctx.globalAlpha = 1;
        }
      }
      if (p1 > 0 && shown > 0) {
        label(ctx, "the ray", X(hit[0].x) - 4, Y(hit[0].y) - 14, { color: PAL.warm, size: 12 });
      }

      // phase 2: the grazing ray
      const p2 = phase(t, 0.72, 0.98);
      if (p2 > 0) {
        const shown2 = Math.min(graze.length, Math.floor(p2 * (graze.length + 2)));
        for (let i = 0; i < shown2; i++) {
          const s = graze[i];
          ctx.beginPath();
          ctx.arc(X(s.x), Y(s.y), Math.max(s.r * w, 1.0), 0, Math.PI * 2);
          ctx.strokeStyle = PAL.red;
          ctx.globalAlpha = 0.4;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = PAL.red;
          ctx.beginPath();
          ctx.arc(X(s.x), Y(s.y), 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        if (shown2 > 3) {
          label(ctx, `${shown2} steps and still going…`, X(graze[shown2 - 1].x) - 30, Y(graze[shown2 - 1].y) - 16, {
            color: PAL.red, size: 12, align: "right",
          });
        }
      }

      // step counter for the hit march
      if (shown > 1) {
        label(ctx, `${Math.min(shown, hit.length)} steps`, X(0.06), Y(0.92), { color: PAL.muted, size: 12, mono: true });
      }
    },
  });
}
