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
const KICK_OUT = Math.floor(STEPS * 0.12); // radial kick: off the shell
const KICK_ALONG = Math.floor(STEPS * 0.5); // tangential kick: over the rim

// Scroll progress at which the scrub reaches sample i.
const progressAt = (i: number): number => 0.02 + (0.96 * i) / (STEPS - 1);

function simulate(): Sample[] {
  const out: Sample[] = [];
  // Cross-section: x horizontal, y up. Start on the dome, sliding slowly
  // clockwise. Slow enough that the spring only has to stretch ~0.3% to
  // supply the centripetal force, so it reads as silent.
  let x = -Math.SQRT1_2 * R;
  let y = Math.SQRT1_2 * R;
  let vx = 0.3 * Math.SQRT1_2;
  let vy = 0.3 * Math.SQRT1_2;
  const dt = 1 / 240;
  for (let i = 0; i < STEPS; i++) {
    // Scripted nudges so both springs get exercised on schedule.
    if (i === KICK_OUT) {
      const r = Math.hypot(x, y);
      vx += (x / r) * 1.2;
      vy += (y / r) * 1.2;
    }
    if (i === KICK_ALONG) {
      const r = Math.hypot(x, y);
      vx += (y / r) * 2.4;
      vy -= (x / r) * 2.4;
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

  // Time the captions off the trajectory itself rather than guessing.
  const after = (from: number, test: (s: Sample) => boolean): number => {
    for (let i = from; i < path.length; i++) if (test(path[i])) return i;
    return path.length - 1;
  };
  const inside = after(KICK_OUT, (s) => Math.hypot(s.x, s.y) < R - 0.05);
  const below = after(KICK_ALONG, (s) => s.y < 0);
  const above = after(below, (s) => s.y >= 0);
  const lead = (i: number): number => Math.max(0, progressAt(i) - 0.01);

  mountScrolly(el, {
    screens: 4,
    aspect: 0.56,
    steps: [
      {
        at: 0,
        text: "A cross-section through the dome, with the dashed arc marking the shell at radius R. The body starts sliding slowly along the arc, so the spring barely has to pull.",
      },
      {
        at: lead(KICK_OUT),
        text: "A radial kick knocks it outward past R. The shell spring immediately pulls straight back toward the center, growing stronger the farther out it strays.",
      },
      {
        at: lead(inside),
        text: "Momentum carries it inside the arc, so the spring reverses and pushes it back out. A touch of velocity damping lets the oscillation settle down.",
      },
      {
        at: lead(KICK_ALONG),
        text: "A tangential kick sends it racing along the dome. At high speed it rides slightly outside radius R, because that stretch supplies the centripetal force needed to curve its path.",
      },
      {
        at: lead(below),
        text: "Over the rim and below the equator, the floor spring kicks in at four times the stiffness and shoves it straight back up. The shell behaves like a soft guide, while the floor acts like a hard edge.",
      },
      {
        at: lead(above),
        text: "Popped back above the rim, it swings across the dome while the shell spring reels it toward the arc.",
      },
      {
        at: 0.92,
        text: "Those two force terms are the entire dome constraint. Both the octree gravity solver and the integrator run without ever knowing the world is curved.",
      },
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

      // Scrub position along the precomputed path. Linear, so the caption
      // timings computed from progressAt() line up with what's on screen.
      const scrub = Math.min(1, Math.max(0, (t - 0.02) / 0.96));
      const idx = Math.min(path.length - 1, Math.floor(scrub * (path.length - 1)));
      const s = path[idx];
      const PX = (p: Sample | { x: number; y: number }): [number, number] => [cx + p.x * S, cy - p.y * S];

      // Fading trail drawn in short contiguous chunks so alpha ramps smoothly.
      const trail = 220;
      const start = Math.max(0, idx - trail);
      const span = idx - start;
      if (span >= 1) {
        ctx.save();
        ctx.strokeStyle = PAL.dot;
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const chunks = Math.min(24, span);
        for (let c = 0; c < chunks; c++) {
          const i0 = start + Math.floor((c / chunks) * span);
          const i1 = start + Math.floor(((c + 1) / chunks) * span);
          if (i1 <= i0) continue;
          const frac = (c + 0.5) / chunks;
          ctx.globalAlpha = 0.04 + 0.58 * frac * frac;
          ctx.beginPath();
          const [x0, y0] = PX(path[i0]);
          ctx.moveTo(x0, y0);
          for (let i = i0 + 1; i <= i1; i++) {
            const [tx, ty] = PX(path[i]);
            ctx.lineTo(tx, ty);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      label(ctx, "shell  r = R", cx + S * 0.74, cy - S * 0.78, {
        color: PAL.accent,
        size: 11,
        alpha: 0.85 * appear,
        bg: "rgba(6,7,11,0.85)",
      });
      label(ctx, "equator (floor)", cx - S * 1.42, cy + 14, {
        color: PAL.muted,
        size: 11,
        alpha: 0.8 * appear,
        bg: "rgba(6,7,11,0.85)",
      });

      const [bx, by] = PX(s);

      // Radial guide from center through the body, showing r vs R.
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
      const showShell = fmag * FS > 6;
      const gmag = Math.hypot(s.gx, s.gy);
      const showFloor = gmag * FS > 6;

      let shellLabelY = 0;
      if (showShell) {
        const fxTip = bx + s.fx * FS;
        const fyTip = by - s.fy * FS;
        arrow(ctx, bx, by, fxTip, fyTip, PAL.warm, 2.5, 8);
        const flip = fxTip + 175 > w;
        shellLabelY = Math.max(40, Math.min(h - 16, fyTip));
        label(ctx, "shell spring  −k·(r−R)·r̂", flip ? fxTip - 10 : fxTip + 10, shellLabelY, {
          color: PAL.warm,
          size: 11,
          align: flip ? "right" : "left",
          bg: "rgba(6,7,11,0.85)",
        });
      }
      if (showFloor) {
        const gxTip = bx + s.gx * FS * 0.5;
        const gyTip = by - s.gy * FS * 0.5;
        arrow(ctx, bx, by, gxTip, gyTip, PAL.red, 2.5, 8);
        const flipG = gxTip + 145 > w;
        let floorLabelY = Math.max(40, Math.min(h - 16, gyTip - 10));
        if (showShell && Math.abs(floorLabelY - shellLabelY) < 20) {
          floorLabelY = floorLabelY <= shellLabelY ? Math.max(40, shellLabelY - 22) : Math.min(h - 16, shellLabelY + 22);
        }
        label(ctx, "floor spring  −4k·z", flipG ? gxTip - 10 : gxTip + 10, floorLabelY, {
          color: PAL.red,
          size: 11,
          align: flipG ? "right" : "left",
          bg: "rgba(6,7,11,0.85)",
        });
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
        bg: "rgba(6,7,11,0.85)",
      });
    },
  });
}
