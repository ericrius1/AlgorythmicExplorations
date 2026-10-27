// Scroll-driven diagram for part five: one camera ray gambles its way
// through a side view of the Cornell box (open at the front, on the left).
// The paths are really traced, in 2D, with cosine-weighted bounces: the
// featured one is the first seed that reaches the lamp in a few bounces, and
// the finale shows forty more from the same pixel and counts the lucky ones.

import { mountScrolly, PAL, phase, clamp01, label, rng } from "../lib/scrolly";

const ASPECT = 0.56;
// box, in world units (x across [0, 1], y down across [0, ASPECT])
const L = 0.26; // the open front
const R = 0.95; // back wall
const T = 0.07; // ceiling
const B = 0.49; // floor
const LAMP: [number, number] = [0.55, 0.71];
const SPHERE = { x: 0.76, y: B - 0.085, r: 0.085 };
const ALBEDO = 0.73;
const CAM = { x: 0.06, y: 0.21 };
const P0 = { x: 0.47, y: B }; // where this pixel's camera ray lands

interface Pt {
  x: number;
  y: number;
}
interface Path {
  pts: Pt[]; // camera, then every bounce, then where it ended
  lamp: boolean;
}

type HitKind = "floor" | "ceiling" | "back" | "sphere" | "lamp" | "out";

function intersect(o: Pt, d: Pt): { t: number; n: Pt; kind: HitKind } {
  let best = { t: Infinity, n: { x: 0, y: 0 }, kind: "out" as HitKind };
  const wall = (t: number, n: Pt, kind: HitKind): void => {
    if (t > 1e-6 && t < best.t) best = { t, n, kind };
  };
  if (d.y > 0) {
    const t = (B - o.y) / d.y;
    const x = o.x + d.x * t;
    if (x > L && x < R) wall(t, { x: 0, y: -1 }, "floor");
  }
  if (d.y < 0) {
    const t = (T - o.y) / d.y;
    const x = o.x + d.x * t;
    if (x > L && x < R) wall(t, { x: 0, y: 1 }, x > LAMP[0] && x < LAMP[1] ? "lamp" : "ceiling");
  }
  if (d.x > 0) {
    const t = (R - o.x) / d.x;
    const y = o.y + d.y * t;
    if (y > T && y < B) wall(t, { x: -1, y: 0 }, "back");
  }
  // the sphere
  const ox = o.x - SPHERE.x;
  const oy = o.y - SPHERE.y;
  const b = ox * d.x + oy * d.y;
  const c = ox * ox + oy * oy - SPHERE.r * SPHERE.r;
  const disc = b * b - c;
  if (disc > 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 1e-6 && t < best.t) {
      const hx = o.x + d.x * t - SPHERE.x;
      const hy = o.y + d.y * t - SPHERE.y;
      best = { t, n: { x: hx / SPHERE.r, y: hy / SPHERE.r }, kind: "sphere" };
    }
  }
  return best;
}

// one path from this pixel: up to six bounces, cosine-weighted in 2D
function tracePath(rand: () => number): Path {
  const pts: Pt[] = [CAM, P0];
  let o: Pt = P0;
  let n: Pt = { x: 0, y: -1 };
  for (let bounce = 0; bounce < 6; bounce++) {
    // a 2D Lambert lobe: sin θ uniform in [−1, 1] around the normal
    const s = rand() * 2 - 1;
    const cth = Math.sqrt(1 - s * s);
    const d = { x: n.x * cth - n.y * s, y: n.y * cth + n.x * s };
    const hit = intersect(o, d);
    if (hit.kind === "out") {
      pts.push({ x: o.x + d.x * 0.3, y: o.y + d.y * 0.3 });
      return { pts, lamp: false };
    }
    const p = { x: o.x + d.x * hit.t, y: o.y + d.y * hit.t };
    pts.push(p);
    if (hit.kind === "lamp") return { pts, lamp: true };
    o = p;
    n = hit.n;
  }
  return { pts, lamp: false };
}

export function mountPhotonWalk(container: HTMLElement): void {
  // the featured path: the first seed that finds the lamp after three
  // bounces, one of them off the sphere, none of them hugging the open front
  const touchesSphere = (q: Pt): boolean => Math.abs(Math.hypot(q.x - SPHERE.x, q.y - SPHERE.y) - SPHERE.r) < 1e-3;
  let featured: Path | null = null;
  for (let seed = 1; seed < 20000 && !featured; seed++) {
    const p = tracePath(rng(seed));
    const mids = p.pts.slice(2, -1);
    const spread = p.pts.slice(1, -1).every((q, i, a) => i === 0 || Math.hypot(q.x - a[i - 1].x, q.y - a[i - 1].y) > 0.18);
    if (p.lamp && p.pts.length === 5 && spread && mids.some(touchesSphere) && mids.every((q) => q.x > L + 0.08)) featured = p;
  }
  const path = featured!;
  const bounces = path.pts.length - 3; // diffuse bounces before the lamp
  const lastWeight = Math.pow(ALBEDO, bounces + 1);

  // the finale: forty more from the same pixel
  const crowdRand = rng(424242);
  const crowd: Path[] = [];
  for (let i = 0; i < 40; i++) crowd.push(tracePath(crowdRand));
  const lucky = crowd.filter((p) => p.lamp).length;

  // the cosine fan at the first bounce, for the "roll the dice" step
  const fan: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const s = -1 + (2 * i) / 16;
    fan.push({ x: -s * 1, y: -Math.sqrt(1 - s * s) });
  }

  mountScrolly(container, {
    screens: 4,
    aspect: ASPECT,
    steps: [
      {
        at: 0.0,
        text: "The rendering equation in words: the light leaving a point is what it emits, plus the light arriving from every direction, dimmed by the surface. Here the camera's ray for one pixel lands on the floor.",
      },
      {
        at: 0.16,
        text: "Light could arrive at that point from any direction above it. Monte Carlo doesn't try them all. It picks one at random, favouring the directions a matte surface cares about most.",
      },
      {
        at: 0.36,
        text: `Every bounce multiplies the path's <em>throughput</em> by the surface colour, ${ALBEDO} for these white walls, so each bounce counts for less than the one before.`,
      },
      {
        at: 0.58,
        text: `This path found the lamp after ${bounces + 1} bounces. Its light is worth ${lastWeight.toFixed(2)} of the lamp's by the time it reaches the camera. Paths that leave through the open front, or run out of bounces, bring back nothing.`,
      },
      {
        at: 0.8,
        text: `One path is a terrible estimate. Forty more from the same pixel: ${lucky} of them found the lamp. The average of all of them, over thousands of samples, is the answer to the integral.`,
      },
    ],
    draw(ctx, w, h, t) {
      const s = Math.min(w, h / ASPECT);
      const ox = (w - s) / 2;
      const oy = (h - s * ASPECT) / 2;
      const X = (x: number): number => ox + x * s;
      const Y = (y: number): number => oy + y * s;

      // the box, side view: floor, ceiling, back wall; open on the left
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#5a6178";
      ctx.beginPath();
      ctx.moveTo(X(L), Y(T));
      ctx.lineTo(X(R), Y(T));
      ctx.lineTo(X(R), Y(B));
      ctx.lineTo(X(L), Y(B));
      ctx.stroke();
      // the lamp
      ctx.strokeStyle = PAL.warm;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(X(LAMP[0]), Y(T));
      ctx.lineTo(X(LAMP[1]), Y(T));
      ctx.stroke();
      label(ctx, "lamp", X((LAMP[0] + LAMP[1]) / 2), Y(T) + 13, { color: PAL.warm, align: "center", size: 11 });
      label(ctx, "open front", X(L), Y(B) + 14, { color: PAL.muted, align: "center", size: 11 });
      // the sphere
      ctx.beginPath();
      ctx.arc(X(SPHERE.x), Y(SPHERE.y), SPHERE.r * s, 0, Math.PI * 2);
      ctx.fillStyle = "#1d2233";
      ctx.fill();
      ctx.strokeStyle = "#5a6178";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // the camera: a small body and lens pointing into the box
      ctx.save();
      ctx.translate(X(CAM.x), Y(CAM.y));
      ctx.rotate(Math.atan2(P0.y - CAM.y, P0.x - CAM.x));
      ctx.fillStyle = "#3a4054";
      ctx.strokeStyle = PAL.text;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(-16, -9, 18, 18, 3);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(2, -5);
      ctx.lineTo(9, -8);
      ctx.lineTo(9, 8);
      ctx.lineTo(2, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      label(ctx, "camera", X(CAM.x), Y(CAM.y) - 20, { color: PAL.muted, align: "center", size: 11 });

      // the finale fades the featured path back and draws the crowd
      const pCrowd = phase(t, 0.8, 0.95);
      const featuredAlpha = 1 - 0.65 * pCrowd;

      // the featured path, segment by segment, dimming as throughput drops
      const pAll = phase(t, 0.05, 0.66);
      const segs = path.pts.length - 1;
      // hold at the first bounce while the dice fan is up
      const prog = pAll < 0.25 ? (pAll / 0.25) * 1 : 1 + ((pAll - 0.25) / 0.75) * (segs - 1);
      for (let i = 0; i < segs; i++) {
        const a = clamp01(prog - i);
        if (a <= 0) break;
        const p0 = path.pts[i];
        const p1 = path.pts[i + 1];
        const wgt = i === 0 ? 1 : Math.pow(ALBEDO, i);
        ctx.globalAlpha = featuredAlpha * (0.35 + 0.65 * wgt);
        ctx.strokeStyle = PAL.warm;
        ctx.lineWidth = 1 + 2.2 * wgt;
        ctx.beginPath();
        ctx.moveTo(X(p0.x), Y(p0.y));
        ctx.lineTo(X(p0.x + (p1.x - p0.x) * a), Y(p0.y + (p1.y - p0.y) * a));
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (a >= 1 && i < segs - 1 && i >= 1) {
          ctx.fillStyle = PAL.accent;
          ctx.beginPath();
          ctx.arc(X(p1.x), Y(p1.y), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // running throughput beside each bounce, once the path has left it
        const showAt = i === 0 ? 1.15 : i + 1.15;
        if (i < segs - 1 && prog >= showAt && pCrowd < 0.5 && (i > 0 || t > 0.4)) {
          const wNext = Math.pow(ALBEDO, i + 1);
          const onFloor = p1.y > (T + B) / 2;
          const nearBack = p1.x > 0.85;
          label(ctx, wNext.toFixed(2), X(p1.x) + (nearBack ? -7 : 6), Y(p1.y) + (onFloor ? -12 : 14), {
            align: nearBack ? "right" : "left",
            color: PAL.muted,
            size: 11,
            mono: true,
            alpha: 1 - 2 * pCrowd,
          });
        }
      }
      // first landing point, and the dice fan around it
      if (prog >= 1) {
        ctx.fillStyle = PAL.accent;
        ctx.beginPath();
        ctx.arc(X(P0.x), Y(P0.y), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const pFan = phase(t, 0.14, 0.2) * (1 - phase(t, 0.34, 0.42));
      if (pFan > 0) {
        const len = 0.09;
        for (const f of fan) {
          // longer where the cosine lobe is heavier
          const k = -f.y;
          ctx.strokeStyle = PAL.accent;
          ctx.globalAlpha = pFan * (0.15 + 0.5 * k);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(X(P0.x), Y(P0.y));
          ctx.lineTo(X(P0.x + f.x * len * k), Y(P0.y + f.y * len * k));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        label(ctx, "pick one at random", X(P0.x), Y(P0.y - 0.12), { color: PAL.accent, align: "center", size: 11, alpha: pFan });
      }

      if (prog >= 1.15 && pCrowd < 0.5) {
        label(ctx, "numbers: throughput so far", X(R), Y(B) + 14, { color: PAL.muted, size: 11, align: "right", alpha: 1 - 2 * pCrowd });
      }

      // the payoff
      const pWin = phase(t, 0.6, 0.66) * (1 - pCrowd);
      if (pWin > 0) {
        const end = path.pts[path.pts.length - 1];
        ctx.globalAlpha = pWin;
        ctx.fillStyle = PAL.warm;
        ctx.shadowColor = PAL.warm;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(X(end.x), Y(end.y), 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        const right = end.x > 0.6;
        label(ctx, `found it · worth ${lastWeight.toFixed(2)}`, X(end.x) + (right ? -10 : 10), Y(end.y) + 28, {
          color: PAL.warm,
          alpha: pWin,
          size: 12,
          align: right ? "right" : "left",
        });
      }

      // the crowd
      if (pCrowd > 0) {
        const shown = Math.floor(pCrowd * crowd.length);
        let found = 0;
        for (let i = 0; i < shown; i++) {
          const p = crowd[i];
          if (p.lamp) found++;
          ctx.strokeStyle = p.lamp ? PAL.warm : PAL.dot;
          ctx.globalAlpha = p.lamp ? 0.85 : 0.16;
          ctx.lineWidth = p.lamp ? 1.6 : 1;
          ctx.beginPath();
          ctx.moveTo(X(p.pts[1].x), Y(p.pts[1].y));
          for (let k = 2; k < p.pts.length; k++) ctx.lineTo(X(p.pts[k].x), Y(p.pts[k].y));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        label(ctx, `${found} of ${shown} found the lamp`, X(R), Y(B) + 14, { color: PAL.warm, align: "right", size: 12 });
      }
    },
  });
}
