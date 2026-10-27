// Fig. 3 of Part 4: six ways to hide the comma. The twelve keys sit round
// the circle of fifths. Each arc between neighbours is one fifth, labelled
// with how far it was shaved from pure (the wolf glows red). Each key is
// coloured by its major third: green is pure, orange is equal temperament's
// +13.7¢, red and magenta are worse. Click a key to hear its major triad in
// that tuning, or tour all twelve.

import { Shell, type Demo } from "../../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../../lib/audio";
import { CIRCLE, MAJ3, FIFTH, TEMPERAMENTS, temperamentTable, type Temperament } from "./theory";
import { COL, Surface, approach, clock, clockArc, glow, glowStroke, heat, hex, label, mixRgb, rgba, signed, text, type RGB } from "./draw";
import { Sound, hz, type Held } from "./sound";
import { button, chips, tapBadge } from "./ui";

export function mountTemperWheel(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.38 : 0.6));
  const sound = new Sound({ level: 1 });
  const badge = tapBadge(container, "tap a key");

  let temp: Temperament = TEMPERAMENTS[1];
  let table = temperamentTable(temp);
  let sel = 0;
  let held: Held | null = null;
  let tour = 0;
  let tourIdx = -1;
  const shown = { third: table.third.slice(), fifth: table.fifth.slice() };
  const flash = new Array(12).fill(0);
  let hover = -1;
  let geo = { cx: 0, cy: 0, R: 0 };

  const stopTour = (): void => {
    clearInterval(tour);
    tour = 0;
    tourIdx = -1;
  };
  const silence = (): void => {
    stopTour();
    held?.release(0.3);
    held = null;
  };
  const guard = frameGuard(silence);

  // root of key i in a comfortable register around middle C
  const triad = (i: number): number[] => {
    let root = table.pitch[i];
    if (root > 700) root -= 1200;
    return [root, root + table.third[i], root + table.fifth[i]].map((c) => hz(c));
  };

  const playKey = (i: number, dur = 2.2): void => {
    sel = i;
    flash[i] = 1;
    held?.release(0.12);
    held = sound.hold(triad(i), { timbre: "organ", level: 0.05, attack: 0.05, cutoff: 3800 });
    const mine = held;
    window.setTimeout(() => {
      if (held === mine) {
        held.release(0.35);
        held = null;
      }
    }, dur * 1000);
  };

  chips(shell.controls, {
    label: "tuning",
    options: TEMPERAMENTS.map((t) => ({ value: t.id, text: t.short })),
    value: temp.id,
    wide: true,
    onChange: (id) => {
      temp = TEMPERAMENTS.find((t) => t.id === id)!;
      table = temperamentTable(temp);
      if (held && !tour) {
        held.set(triad(sel), 0.25);
      }
    },
  });
  button(shell.controls, "▶ tour the keys", () => {
    badge.hide();
    void unlockAudio().then(() => {
      stopTour();
      tourIdx = 0;
      playKey(0, 1.5);
      tour = window.setInterval(() => {
        tourIdx++;
        if (tourIdx >= 12) {
          stopTour();
          return;
        }
        playKey(tourIdx, 1.5);
      }, 1500);
    });
  });
  button(shell.controls, "■ stop", silence);

  const pick = (x: number, y: number): number => {
    let best = -1;
    let bd = Math.max(26, geo.R * 0.16);
    for (let i = 0; i < 12; i++) {
      const [nx, ny] = clock(geo.cx, geo.cy, geo.R, i / 12);
      const d = Math.hypot(nx - x, ny - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  shell.canvas.addEventListener("pointermove", (e) => {
    const p = surf.local(e);
    hover = pick(p.x, p.y);
    shell.canvas.style.cursor = hover >= 0 ? "pointer" : "default";
  });
  shell.canvas.addEventListener("pointerleave", () => (hover = -1));
  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    const i = pick(p.x, p.y);
    if (i < 0) return;
    badge.hide();
    stopTour();
    void unlockAudio().then(() => playKey(i));
  });

  const beat = (i: number): { third: number; fifth: number } => {
    const [r, t3, t5] = triad(i);
    return { third: Math.abs(5 * r - 4 * t3), fifth: Math.abs(3 * r - 2 * t5) };
  };

  shell.setInfo(() => {
    const d3 = table.third[sel] - MAJ3;
    const d5 = table.fifth[sel] - FIFTH;
    const b = beat(sel);
    return `${CIRCLE[sel]} major in ${temp.name}: third ${table.third[sel].toFixed(1)}¢ (${signed(d3)}), fifth ${table.fifth[sel].toFixed(1)}¢ (${signed(d5)}) · beats near middle C: third ${b.third.toFixed(1)}/s, fifth ${b.fifth.toFixed(1)}/s`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (let i = 0; i < 12; i++) {
        shown.third[i] = approach(shown.third[i], table.third[i], 9, dt);
        shown.fifth[i] = approach(shown.fifth[i], table.fifth[i], 9, dt);
        flash[i] = approach(flash[i], 0, 2.5, dt);
      }

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const R = narrow ? Math.min(w * 0.36, h * 0.27) : Math.min(w * 0.25, h * 0.37);
      const cx = narrow ? w / 2 : w * 0.33;
      const cy = narrow ? R + 46 : h * 0.5;
      geo = { cx, cy, R };
      const t = now / 1000;

      glow(ctx, cx, cy, R * 1.3, [40, 52, 96], 0.2);

      // fifths: arcs between neighbours, labelled with their tempering
      for (let i = 0; i < 12; i++) {
        const dev = shown.fifth[i] - FIFTH;
        const wolf = Math.abs(dev) > 10;
        const col: RGB = wolf ? hex("#ff5d6c") : Math.abs(dev) < 0.05 ? hex("#9ff0c4") : mixRgb(hex("#9ff0c4"), hex("#6f9bff"), Math.min(1, -dev / 6));
        const t0 = i / 12 + 0.024;
        const t1 = (i + 1) / 12 - 0.024;
        if (wolf) {
          // a jagged arc for the wolf
          ctx.beginPath();
          const n = 26;
          for (let k = 0; k <= n; k++) {
            const tt = t0 + ((t1 - t0) * k) / n;
            const wob = (k % 2 ? 1 : -1) * 3.2 * (0.7 + 0.3 * Math.sin(t * 9));
            const [x, y] = clock(cx, cy, R + wob, tt);
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          glowStroke(ctx, col, 0.95, 2);
        } else {
          clockArc(ctx, cx, cy, R, t0, t1);
          glowStroke(ctx, col, 0.6 + Math.min(0.35, Math.abs(dev) / 15), 1.4 + Math.min(2, Math.abs(dev) / 3));
        }
        const [lx, ly] = clock(cx, cy, R + (narrow ? 22 : 26), (i + 0.5) / 12);
        const s = Math.abs(dev) < 0.05 ? "pure" : signed(dev, 1);
        text(ctx, s, lx, ly, {
          size: narrow ? 9.5 : 10.5,
          color: rgba(mixRgb(col, [255, 255, 255], 0.35), wolf ? 1 : 0.85),
          align: "center",
          base: "middle",
          mono: true,
          weight: wolf ? 700 : 500,
        });
      }
      if (!narrow) text(ctx, "fifths, ¢ from pure", cx, cy - R - 44, { size: 10.5, color: COL.dim, align: "center" });

      // thirds: bars pointing inward from each key, coloured by error
      for (let i = 0; i < 12; i++) {
        const d3 = shown.third[i] - MAJ3;
        const col = heat(d3 / 36);
        const r0 = R - (narrow ? 17 : 21);
        const len = Math.max(0, Math.min(1, d3 / 45)) * R * 0.5;
        const [ax, ay] = clock(cx, cy, r0, i / 12);
        const [bx, by] = clock(cx, cy, r0 - len, i / 12);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        glowStroke(ctx, col, 0.85, narrow ? 3 : 4);
        const [tx, ty] = clock(cx, cy, r0 - len - (narrow ? 11 : 13), i / 12);
        text(ctx, Math.abs(d3) < 0.05 ? "0" : signed(d3, 1), tx, ty, {
          size: narrow ? 8.5 : 9.5,
          color: rgba(mixRgb(col, [255, 255, 255], 0.3), 0.95),
          align: "center",
          base: "middle",
          mono: true,
        });
      }

      // key nodes
      for (let i = 0; i < 12; i++) {
        const d3 = shown.third[i] - MAJ3;
        const col = heat(d3 / 36);
        const [x, y] = clock(cx, cy, R, i / 12);
        const r = (narrow ? 12 : 15) * (1 + 0.18 * flash[i]);
        glow(ctx, x, y, r * 2.6, col, 0.25 + 0.4 * flash[i] + (i === sel ? 0.15 : 0));
        ctx.fillStyle = rgba(mixRgb(col, [8, 9, 14], 0.55), 1);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = i === sel ? 2.2 : hover === i ? 1.6 : 1;
        ctx.strokeStyle = rgba(mixRgb(col, [255, 255, 255], 0.3), i === sel || hover === i ? 1 : 0.7);
        ctx.stroke();
        text(ctx, CIRCLE[i], x, y + 0.5, { size: narrow ? 10.5 : 12, color: "#f4f6fc", align: "center", base: "middle", weight: 700 });
      }

      // centre: name and year
      text(ctx, temp.short, cx, cy - 6, { size: narrow ? 12 : 14, color: COL.text, align: "center", weight: 700 });
      text(ctx, temp.year, cx, cy + 12, { size: 10.5, color: COL.dim, align: "center" });

      // ---- detail panel ----
      const px = narrow ? 18 : w * 0.66;
      let py = narrow ? cy + R + 54 : h * 0.17;
      const lineH = narrow ? 18 : 20;
      const d3 = table.third[sel] - MAJ3;
      const d5 = table.fifth[sel] - FIFTH;
      const b = beat(sel);
      text(ctx, `${CIRCLE[sel]} major`, px, py, { size: narrow ? 15 : 17, color: "#f4f6fc", weight: 700 });
      py += lineH * 1.3;
      const row = (k: string, v: string, col: string): void => {
        text(ctx, k, px, py, { size: 11, color: COL.dim });
        text(ctx, v, px + (narrow ? 104 : 112), py, { size: 11, color: col, mono: true });
        py += lineH;
      };
      row("major third", `${table.third[sel].toFixed(1)}¢  ${signed(d3)}`, rgba(heat(d3 / 36), 1));
      row("fifth", `${table.fifth[sel].toFixed(1)}¢  ${signed(d5)}`, Math.abs(d5) > 10 ? "#ff8a8a" : "#bfe8d4");
      row("third beats", `${b.third.toFixed(1)} per second`, COL.text);
      row("fifth beats", `${b.fifth.toFixed(1)} per second`, COL.text);
      py += lineH * 0.5;
      // the spread across all twelve keys
      const thirds = table.third.map((v) => v - MAJ3);
      const best = Math.min(...thirds);
      const worst = Math.max(...thirds);
      text(ctx, "thirds across all 12 keys", px, py, { size: 11, color: COL.dim });
      py += lineH * 0.9;
      const bw = narrow ? w - px * 2 : w - px - 26;
      const sx = (d: number): number => px + (bw * Math.max(0, Math.min(45, d + 2))) / 47;
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.fillRect(px, py - 6, bw, 12);
      for (const ref of [0, 13.686, 21.506]) {
        ctx.fillStyle = "rgba(200, 210, 240, 0.25)";
        ctx.fillRect(sx(ref), py - 9, 1, 18);
      }
      thirds.forEach((d, i) => {
        const col = heat(d / 36);
        ctx.fillStyle = rgba(col, i === sel ? 1 : 0.75);
        ctx.beginPath();
        ctx.arc(sx(d), py, i === sel ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
      py += 22;
      text(ctx, "pure", sx(0), py, { size: 9.5, color: COL.dim, align: "center" });
      text(ctx, "equal", sx(13.686), py, { size: 9.5, color: COL.dim, align: "center" });
      text(ctx, "Pyth.", sx(21.506), py + (narrow ? 0 : 0), { size: 9.5, color: COL.dim, align: "left" });
      py += lineH;
      label(ctx, `best ${signed(best)}¢ · worst ${signed(worst)}¢`, px, py + 4, { size: 10.5, mono: true, align: "left", color: "#ffd9b0" });
    },
    dispose() {
      silence();
    },
  };
}
