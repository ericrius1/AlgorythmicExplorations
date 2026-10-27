// Scroll diagram for the lava-lamp post: one radiance-cascade probe, drawn
// to scale. Each level has 4× the rays of the one below and covers the next
// interval out (0–4, 4–20, 20–84 px in the real renderer), while its probes
// get half as dense in each direction. Then the merge runs top-down: a ray
// that hit nothing takes the average of the four rays one level up that
// continue it, and the light flows inward to the probe.

import { mountScrolly, PAL, phase, lerp, label } from "../lib/scrolly";

interface Level {
  rays: number;
  r0: number; // interval start, in units of cascade 0's interval (4 px)
  r1: number;
}

const LEVELS: Level[] = [
  { rays: 4, r0: 0, r1: 1 },
  { rays: 16, r0: 1, r1: 5 },
  { rays: 64, r0: 5, r1: 21 },
];
const PX = [0, 4, 20, 84]; // real interval bounds, scene pixels

interface Disc {
  x: number;
  y: number;
  r: number;
}

// Ray–circle intersection from (px,py) along (ux,uy): distance, or Infinity.
function hitDisc(px: number, py: number, ux: number, uy: number, c: Disc): number {
  const ox = c.x - px;
  const oy = c.y - py;
  const b = ox * ux + oy * uy;
  const det = b * b - (ox * ox + oy * oy) + c.r * c.r;
  if (det < 0 || b < 0) return Infinity;
  const d = b - Math.sqrt(det);
  return d > 0 ? d : Infinity;
}

const levelStart = (l: number): number => 0.08 + l * 0.22;

export function mountCascadeRays(el: HTMLElement): void {
  mountScrolly(el, {
    screens: 4.5,
    aspect: 0.6,
    steps: [
      {
        at: 0,
        text: "One probe (blue), one hot blob that gives off light, one cold blob that blocks it. The probe needs to know how much light arrives from every direction.",
      },
      {
        at: 0.08,
        text: "Cascade 0: four short rays, out to 4 px. Probes at this level sit 2 px apart, because light from close by changes quickly from one spot to the next.",
      },
      {
        at: 0.3,
        text: "Cascade 1: sixteen rays from 4 to 20 px, each starting where cascade 0 stopped. Its probes are twice as far apart, so there are a quarter as many of them.",
      },
      {
        at: 0.52,
        text: "Cascade 2: sixty-four rays from 20 to 84 px. Some reach the hot blob. Others stop at the cold blob first, and that gap in the fan is the shadow.",
      },
      {
        at: 0.78,
        text: "The merge, from the top level down: a ray that hit nothing takes the average of the four rays one level up that continue it. The warm rays flow inward until the probe has its light.",
      },
    ],
    draw(ctx, w, h, t) {
      const small = w < 520;
      const px = w * 0.27;
      const py = h * 0.56;
      const R = Math.min(w * 0.66, h * 1.2); // outer edge of cascade 2
      const unit = R / 21;

      const light: Disc = { x: px + R * 0.62 * Math.cos(-0.42), y: py + R * 0.62 * Math.sin(-0.42), r: R * 0.13 };
      const cold: Disc = { x: px + R * 0.36 * Math.cos(-0.175), y: py + R * 0.36 * Math.sin(-0.175), r: R * 0.055 };
      const near: Disc = { x: px + R * 0.165 * Math.cos(2.45), y: py + R * 0.165 * Math.sin(2.45), r: R * 0.036 };

      const pIn = phase(t, 0, 0.06);
      const pMerge = phase(t, 0.78, 0.97);
      const shown = (l: number): number => phase(t, levelStart(l), levelStart(l) + 0.18);

      // ---- probe grids: each level's probes are half as dense per axis
      let current = -1;
      for (let l = 0; l < LEVELS.length; l++) if (t >= levelStart(l)) current = l;
      for (let l = 0; l < LEVELS.length; l++) {
        const on = phase(t, levelStart(l), levelStart(l) + 0.05) * (l === LEVELS.length - 1 ? 1 : 1 - phase(t, levelStart(l + 1), levelStart(l + 1) + 0.05));
        if (on <= 0.01 || pMerge > 0.5) continue;
        const sp = unit * 0.5 * Math.pow(2, l); // to scale: cascade 0 probes are 2 px apart
        ctx.save();
        ctx.globalAlpha = 0.34 * on * (1 - pMerge * 2);
        ctx.fillStyle = PAL.accent;
        const dot = sp < 8 ? 1 : 1.5;
        const x0 = px - Math.floor(px / sp) * sp;
        const y0 = py - Math.floor(py / sp) * sp;
        for (let y = y0; y < h; y += sp) {
          for (let x = x0; x < w; x += sp) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
        }
        ctx.restore();
      }

      // ---- interval rings
      for (let l = 0; l < LEVELS.length; l++) {
        const pl = shown(l);
        if (pl <= 0) continue;
        ctx.save();
        ctx.globalAlpha = 0.22 * pl;
        ctx.strokeStyle = PAL.accent;
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, LEVELS[l].r1 * unit, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ---- blobs
      ctx.save();
      ctx.globalAlpha = pIn;
      const lg = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.r * 2.2);
      lg.addColorStop(0, "rgba(255, 196, 120, 0.85)");
      lg.addColorStop(1, "rgba(255, 160, 80, 0)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(light.x, light.y, light.r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd59a";
      ctx.beginPath();
      ctx.arc(light.x, light.y, light.r, 0, Math.PI * 2);
      ctx.fill();
      for (const c of [cold, near]) {
        ctx.fillStyle = "#1c2030";
        ctx.strokeStyle = "#3b4360";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      label(ctx, "hot wax (emits)", light.x, light.y - light.r - 11, { color: PAL.warm, size: small ? 10 : 11, align: "center", alpha: pIn });
      label(ctx, "cold wax (blocks)", cold.x + cold.r * 0.2, cold.y + cold.r + 13, { color: PAL.muted, size: small ? 10 : 11, align: "center", alpha: pIn });

      // ---- trace every level's rays: what each one hits, and the light it
      // carries back after the merge (1 = the hot blob, fully)
      type Ray = { a: number; ux: number; uy: number; r0: number; end: number; hit: "light" | "block" | "none"; skip: boolean };
      const rays: Ray[][] = LEVELS.map((lv) => {
        const out: Ray[] = [];
        for (let i = 0; i < lv.rays; i++) {
          const a = ((i + 0.5) / lv.rays) * Math.PI * 2;
          const ux = Math.cos(a);
          const uy = Math.sin(a);
          const r0 = lv.r0 * unit;
          const r1 = lv.r1 * unit;
          const dL = hitDisc(px, py, ux, uy, light);
          const dB = Math.min(hitDisc(px, py, ux, uy, cold), hitDisc(px, py, ux, uy, near));
          const d = Math.min(dL, dB);
          // a hit closer than this level's interval was a lower level's job
          const skip = d < r0;
          let end = r1;
          let hit: Ray["hit"] = "none";
          if (d >= r0 && d < r1) {
            end = d;
            hit = d === dL ? "light" : "block";
          }
          out.push({ a, ux, uy, r0, end, hit, skip });
        }
        return out;
      });
      // merged light per ray, top level first
      const carried: number[][] = LEVELS.map((lv) => new Array(lv.rays).fill(0));
      for (let l = LEVELS.length - 1; l >= 0; l--) {
        for (let i = 0; i < LEVELS[l].rays; i++) {
          const r = rays[l][i];
          if (r.hit === "light") carried[l][i] = 1;
          else if (r.hit === "block") carried[l][i] = 0;
          else if (l + 1 < LEVELS.length) {
            let s = 0;
            for (let c = 0; c < 4; c++) s += carried[l + 1][i * 4 + c];
            carried[l][i] = s / 4;
          }
        }
      }

      for (let l = 0; l < LEVELS.length; l++) {
        const extend = shown(l);
        if (extend <= 0) continue;
        // the merge sweeps down: top level lights first
        const sweep = phase(pMerge, (LEVELS.length - 1 - l) * 0.28, (LEVELS.length - 1 - l) * 0.28 + 0.4);
        for (let i = 0; i < LEVELS[l].rays; i++) {
          const r = rays[l][i];
          if (r.skip) continue;
          const rEnd = lerp(r.r0, Math.max(r.r0, r.end), extend);
          let color = "#5a6486";
          let alpha = 0.6;
          if (r.hit === "light" && rEnd >= r.end - 0.5) {
            color = PAL.warm;
            alpha = 0.9;
          } else if (r.hit === "block" && rEnd >= r.end - 0.5) {
            color = "#55607f";
            alpha = 0.7;
          }
          const warm = r.hit === "none" ? carried[l][i] * sweep : 0;
          ctx.save();
          ctx.lineCap = "round";
          ctx.lineWidth = l === 0 ? 2.4 : l === 1 ? 1.6 : 1.1;
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.moveTo(px + r.ux * r.r0, py + r.uy * r.r0);
          ctx.lineTo(px + r.ux * rEnd, py + r.uy * rEnd);
          ctx.stroke();
          if (warm > 0.01) {
            ctx.globalAlpha = 0.25 + 0.7 * warm;
            ctx.strokeStyle = PAL.warm;
            ctx.beginPath();
            ctx.moveTo(px + r.ux * r.r0, py + r.uy * r.r0);
            ctx.lineTo(px + r.ux * rEnd, py + r.uy * rEnd);
            ctx.stroke();
          }
          if (r.hit !== "none" && rEnd >= r.end - 0.5) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(px + r.ux * rEnd, py + r.uy * rEnd, l === 2 ? 1.8 : 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      // ---- level labels, stacked in the top-left corner
      const fs = small ? 9.5 : 11;
      const nShown = LEVELS.filter((_, l) => shown(l) > 0).length;
      if (nShown > 0) {
        // a dark backing so the labels read over the rays
        ctx.save();
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = PAL.bg;
        ctx.beginPath();
        ctx.roundRect(6, 6, small ? 150 : 380, nShown * (fs + 7) + 6, 6);
        ctx.fill();
        ctx.restore();
      }
      for (let l = 0; l < LEVELS.length; l++) {
        const a = shown(l);
        if (a <= 0) continue;
        const spacing = 2 << l;
        const txt = small
          ? `c${l}: ${LEVELS[l].rays} rays · ${PX[l]}–${PX[l + 1]} px`
          : `cascade ${l}: ${LEVELS[l].rays} rays · ${PX[l]}–${PX[l + 1]} px · probes every ${spacing} px`;
        label(ctx, txt, 12, 16 + l * (fs + 7), {
          color: l === current && pMerge === 0 ? PAL.accent : PAL.muted,
          size: fs,
          mono: true,
          alpha: a,
        });
      }

      // ---- the probe, glowing with whatever the merge delivered
      let probeLight = 0;
      for (let i = 0; i < 4; i++) probeLight += carried[0][i] / 4;
      const glow = phase(pMerge, 0.82, 1) * Math.min(1, Math.sqrt(probeLight) * 1.6);
      if (glow > 0) {
        const pg = ctx.createRadialGradient(px, py, 0, px, py, 30);
        pg.addColorStop(0, `rgba(255, 200, 130, ${0.65 * glow})`);
        pg.addColorStop(1, "rgba(255, 200, 130, 0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, 30, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = PAL.accent;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
      label(ctx, "probe", px - 10, py + 4, { color: PAL.accent, size: small ? 10 : 11, align: "right", alpha: pIn });

      // ---- the cost: probes × rays is the same at every level
      if (current >= 0 && pMerge === 0) {
        const k = Math.pow(4, current);
        const txt =
          current === 0
            ? "every level costs the same: probes × rays"
            : small
              ? `1/${k} the probes × ${k}× the rays`
              : `level ${current}: 1/${k} the probes × ${k}× the rays = same cost`;
        ctx.save();
        ctx.font = `${fs}px ui-monospace, Menlo, monospace`;
        const tw = ctx.measureText(txt).width;
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = PAL.bg;
        ctx.beginPath();
        ctx.roundRect(w - 18 - tw, h - 24, tw + 12, 20, 6);
        ctx.fill();
        ctx.restore();
        label(ctx, txt, w - 12, h - 14, { color: PAL.muted, size: fs, mono: true, align: "right", alpha: 0.9 });
      }
    },
  });
}
