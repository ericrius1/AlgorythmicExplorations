// Scroll diagram for the lava-lamp post: one radiance-cascade probe. As the
// reader scrolls, each cascade level's rays extend through their annulus —
// few directions near, many directions far — then the merge flows the light
// back inward to the probe.

import { mountScrolly, PAL, phase, lerp, label } from "../lib/scrolly";

interface Level {
  rays: number;
  r0: number; // interval start, fraction of scene scale
  r1: number; // interval end
}

const LEVELS: Level[] = [
  { rays: 8, r0: 0, r1: 0.08 },
  { rays: 16, r0: 0.08, r1: 0.26 },
  { rays: 32, r0: 0.26, r1: 0.78 },
];

export function mountCascadeRays(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 4.5,
    aspect: 0.6,
    steps: [
      { at: 0, text: "One probe (blue), one hot blob (orange), one cold blob (dark). The probe wants the light arriving from every direction — without marching hundreds of full-length rays." },
      { at: 0.08, text: "Cascade 0: a handful of short rays. Near the probe, light changes fast from place to place but barely with direction — so sample space densely (every probe has these) and direction coarsely." },
      { at: 0.3, text: "Cascade 1: twice the directions, covering the next annulus. Each ray starts where cascade 0 gave up. Rays that hit the cold blob stop — that's a shadow being born." },
      { at: 0.52, text: "Cascade 2: more directions still, reaching across the scene. Far light needs angular precision and almost no spatial — these probes are sparse, so the total cost per level stays constant." },
      { at: 0.78, text: "The merge: each ray that hit nothing inherits the radiance of matching directions one level out. Light flows inward through the hierarchy, and the probe ends up knowing the whole scene — shadows included." },
    ],
    draw(ctx, w, h, t) {
      const px = w * 0.36;
      const py = h * 0.52;
      const S = Math.min(w * 0.62, h * 1.04); // scene scale

      // Scene objects.
      const light = { x: w * 0.78, y: h * 0.26, r: Math.min(w, h) * 0.07 };
      const blocker = { x: w * 0.62, y: h * 0.66, r: Math.min(w, h) * 0.085 };

      const pIn = phase(t, 0, 0.06);
      const pMerge = phase(t, 0.78, 0.97);

      // Annulus guides.
      for (let l = 0; l < LEVELS.length; l++) {
        const lv = LEVELS[l];
        const pl = phase(t, 0.08 + l * 0.22, 0.08 + l * 0.22 + 0.06);
        if (pl <= 0) continue;
        ctx.save();
        ctx.globalAlpha = 0.16 * pl;
        ctx.strokeStyle = PAL.accent;
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, lv.r1 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Blobs.
      ctx.save();
      ctx.globalAlpha = pIn;
      const lg = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.r * 1.8);
      lg.addColorStop(0, "rgba(255, 200, 120, 0.9)");
      lg.addColorStop(1, "rgba(255, 200, 120, 0)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(light.x, light.y, light.r * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd9a0";
      ctx.beginPath();
      ctx.arc(light.x, light.y, light.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#1c2030";
      ctx.strokeStyle = "#343b52";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(blocker.x, blocker.y, blocker.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      label(ctx, "hot wax (emits)", light.x, light.y - light.r - 12, {
        color: PAL.warm,
        size: 11,
        align: "center",
        alpha: pIn,
      });
      label(ctx, "cold wax (blocks)", blocker.x, blocker.y + blocker.r + 14, {
        color: PAL.muted,
        size: 11,
        align: "center",
        alpha: pIn,
      });

      // Ray-circle hit test along a direction; returns distance or Infinity.
      const hit = (ux: number, uy: number, c: { x: number; y: number; r: number }): number => {
        const ox = c.x - px;
        const oy = c.y - py;
        const b = ox * ux + oy * uy;
        const det = b * b - (ox * ox + oy * oy) + c.r * c.r;
        if (det < 0 || b < 0) return Infinity;
        const d = b - Math.sqrt(det);
        return d > 0 ? d : Infinity;
      };

      // Cast all levels' rays.
      for (let l = 0; l < LEVELS.length; l++) {
        const lv = LEVELS[l];
        const extend = phase(t, 0.08 + l * 0.22, 0.08 + l * 0.22 + 0.18);
        if (extend <= 0) continue;
        for (let i = 0; i < lv.rays; i++) {
          const a = ((i + 0.5) / lv.rays) * Math.PI * 2;
          const ux = Math.cos(a);
          const uy = Math.sin(a);
          const r0 = lv.r0 * S;
          const r1full = lv.r1 * S;

          const dLight = hit(ux, uy, light);
          const dBlock = hit(ux, uy, blocker);
          const dHit = Math.min(dLight, dBlock);

          // The ray only exists inside its interval [r0, r1]; it stops early
          // if it hits something inside the interval. A hit before r0 means a
          // closer level already saw it — draw nothing.
          if (dHit < r0) continue;
          let rEnd = lerp(r0, r1full, extend);
          let kind: "miss" | "light" | "block" = "miss";
          if (dHit < rEnd) {
            rEnd = dHit;
            kind = dHit === dLight ? "light" : "block";
          }

          // Merge phase: rays that saw light brighten; the brightness flows
          // inward (outer levels first).
          let alpha = 0.4;
          let color = PAL.dim;
          if (kind === "light") {
            color = PAL.warm;
            alpha = 0.85;
          } else if (kind === "block") {
            color = "#444c66";
            alpha = 0.5;
          }
          if (pMerge > 0 && kind === "miss") {
            // inherited radiance from outer levels, sweeping inward
            const sweep = phase(pMerge, (LEVELS.length - 1 - l) * 0.25, (LEVELS.length - 1 - l) * 0.25 + 0.5);
            // does this direction eventually see light at any outer level?
            const everLight = dLight < Infinity && dLight < hit(ux, uy, blocker);
            if (everLight && sweep > 0) {
              color = PAL.warm;
              alpha = lerp(0.4, 0.75, sweep);
            }
          }

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = color;
          ctx.lineWidth = l === 0 ? 2 : 1.3;
          ctx.beginPath();
          ctx.moveTo(px + ux * r0, py + uy * r0);
          ctx.lineTo(px + ux * rEnd, py + uy * rEnd);
          ctx.stroke();
          // hit markers
          if (kind !== "miss" && rEnd >= dHit - 0.5) {
            ctx.fillStyle = color;
            ctx.globalAlpha = Math.min(1, alpha + 0.2);
            ctx.beginPath();
            ctx.arc(px + ux * rEnd, py + uy * rEnd, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
        // level annotation, up-left of the probe but kept on-canvas
        const midR = ((lv.r0 + lv.r1) / 2) * S;
        label(ctx, `cascade ${l}: ${lv.rays} rays`, Math.max(8, px - midR * 0.6), py - midR * 0.78 - 6, {
          color: PAL.accent,
          size: 10,
          mono: true,
          alpha: extend * 0.9,
        });
      }

      // Probe, glowing once merged.
      const glow = pMerge;
      if (glow > 0) {
        const pg = ctx.createRadialGradient(px, py, 0, px, py, 26);
        pg.addColorStop(0, `rgba(255, 205, 140, ${0.55 * glow})`);
        pg.addColorStop(1, "rgba(255, 205, 140, 0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, 26, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = PAL.accent;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
      label(ctx, "probe", px, py + 18, { color: PAL.accent, size: 11, align: "center", alpha: pIn });

      // Cost tag.
      const shown = LEVELS.filter((_, l) => phase(t, 0.08 + l * 0.22, 0.08 + l * 0.22 + 0.18) > 0).length;
      if (shown > 0) {
        label(ctx, `levels: ${shown} · cost per level: constant`, w - 14, 20, {
          color: PAL.muted,
          size: 11,
          align: "right",
          mono: true,
        });
      }
    },
  });
}
