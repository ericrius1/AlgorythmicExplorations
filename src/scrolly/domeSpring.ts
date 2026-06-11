// Scroll diagram for part two: the dome constraint as a penalty force.
// A real spring-physics trajectory is precomputed once; scrolling scrubs
// along it, so the reader can park the body at the exact moment a spring
// fires and study the force arrow.

import { mountScrolly, PAL, phase, arrow, label } from "../lib/scrolly";

interface Sample {
  x: number;
  y: number;
  fx: number; // shell spring force
  fy: number;
  gx: number; // floor spring force
  gy: number;
}

const R = 1; // shell radius
const K = 26; // shell spring stiffness
const STEPS = 1400;

function simulate(): Sample[] {
  const out: Sample[] = [];
  // Cross-section: x horizontal, y up. Start on the dome, sliding right.
  let x = -Math.SQRT1_2 * R;
  let y = Math.SQRT1_2 * R;
  let vx = 0.6;
  let vy = 0.6;
  const dt = 1 / 240;
  for (let i = 0; i < STEPS; i++) {
    // Scripted nudges so both springs get exercised on schedule.
    if (i === Math.floor(STEPS * 0.12)) {
      const r = Math.hypot(x, y);
      vx += (x / r) * 1.5;
      vy += (y / r) * 1.5;
    }
    if (i === Math.floor(STEPS * 0.52)) {
      vy -= 2.6;
    }
    const r = Math.hypot(x, y) || 1e-6;
    const fx = -(x / r) * (r - R) * K;
    const fy = -(y / r) * (r - R) * K;
    let gx = 0;
    let gy = 0;
    if (y < 0) {
      gy = -y * K * 4;
    }
    vx += (fx + gx) * dt;
    vy += (fy + gy) * dt;
    vx *= 0.999;
    vy *= 0.999;
    x += vx * dt;
    y += vy * dt;
    out.push({ x, y, fx, fy, gx, gy });
  }
  return out;
}

export function mountDomeSpring(el: HTMLElement): void {
  const path = simulate();

  mountScrolly(el, {
    screens: 4,
    aspect: 0.56,
    steps: [
      { at: 0, text: "Cross-section of the dome. The dashed arc is the target shell, radius R. The body starts on it, moving along it — the spring is silent while r = R." },
      { at: 0.1, text: "A kick sends it outside the shell. Now r > R, and the spring fires: a force pointing radially inward, proportional to how far the rule is broken." },
      { at: 0.35, text: "Overshoot, correct, overshoot — the body oscillates around the shell while the spring negotiates it back. Light damping settles the argument." },
      { at: 0.52, text: "A second kick slings it around the rim. The spring keeps tugging it back toward the shell the whole way — the force is always proportional to the current violation, nothing more." },
      { at: 0.76, text: "It dips below the equator, and the floor spring (4× stiffer) shoves it straight back up. The equator is a hard edge; the shell is a soft preference." },
      { at: 0.9, text: "That's the whole constraint: two if-statements producing forces. The integrator and the gravity solver never learn the world became a dome." },
    ],
    draw(ctx, w, h, t) {
      const cx = w / 2;
      const cy = h * 0.78;
      const S = Math.min(w * 0.32, h * 0.6); // pixels per unit R

      const appear = phase(t, 0, 0.06);

      // Floor (equator) line.
      ctx.save();
      ctx.globalAlpha = appear;
      ctx.strokeStyle = PAL.grid;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - S * 1.45, cy);
      ctx.lineTo(cx + S * 1.45, cy);
      ctx.stroke();

      // Shell arc, dashed.
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = PAL.accent;
      ctx.globalAlpha = 0.55 * appear;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, S * R, Math.PI, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      label(ctx, "shell  r = R", cx + S * 0.74, cy - S * 0.78, { color: PAL.accent, size: 11, alpha: 0.8 * appear });
      label(ctx, "equator (floor)", cx - S * 1.42, cy + 14, { color: PAL.muted, size: 11, alpha: 0.8 * appear });

      // Scrub position along the precomputed path.
      const scrub = phase(t, 0.02, 0.98);
      const idx = Math.min(path.length - 1, Math.floor(scrub * (path.length - 1)));
      const s = path[idx];
      const PX = (p: Sample | { x: number; y: number }): [number, number] => [cx + p.x * S, cy - p.y * S];

      // Trail.
      ctx.save();
      ctx.strokeStyle = PAL.dot;
      ctx.lineWidth = 1.4;
      const trail = 220;
      ctx.beginPath();
      for (let i = Math.max(0, idx - trail); i <= idx; i++) {
        const [tx, ty] = PX(path[i]);
        const a = (i - (idx - trail)) / trail;
        if (i === Math.max(0, idx - trail)) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
        ctx.globalAlpha = 0.1 + 0.4 * a;
      }
      ctx.globalAlpha = 0.45;
      ctx.stroke();
      ctx.restore();

      const [bx, by] = PX(s);

      // Radial guide from centre through the body, showing r vs R.
      const r = Math.hypot(s.x, s.y);
      const off = Math.abs(r - R);
      if (off > 0.02 && s.y > -0.02) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = PAL.muted;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Spring force arrows (scaled for visibility).
      const FS = S / K / 0.55;
      const fmag = Math.hypot(s.fx, s.fy);
      if (fmag * FS > 6) {
        arrow(ctx, bx, by, bx + s.fx * FS, by - s.fy * FS, PAL.warm, 2.5, 8);
        label(ctx, "shell spring  −k·(r−R)·r̂", bx + s.fx * FS + 8, by - s.fy * FS, {
          color: PAL.warm,
          size: 11,
        });
      }
      const gmag = Math.hypot(s.gx, s.gy);
      if (gmag * FS > 6) {
        arrow(ctx, bx, by, bx + s.gx * FS * 0.5, by - s.gy * FS * 0.5, PAL.red, 2.5, 8);
        label(ctx, "floor spring  −4k·z", bx + 12, by - s.gy * FS * 0.5 - 10, { color: PAL.red, size: 11 });
      }

      // Body.
      ctx.fillStyle = PAL.accent;
      ctx.beginPath();
      ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Live readout of the violation.
      const below = s.y < 0;
      const state = below ? "below floor" : off < 0.03 ? "on shell" : r > R ? "outside shell" : "inside shell";
      label(ctx, `r − R = ${(r - R).toFixed(2)}   ${state}`, w - 16, 22, {
        color: below ? PAL.red : off < 0.03 ? PAL.good : PAL.warm,
        size: 12,
        align: "right",
        mono: true,
      });
    },
  });
}
