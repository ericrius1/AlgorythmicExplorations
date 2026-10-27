// The pitch spiral: angle = position inside the octave (C at 12 o'clock,
// clockwise), radius = how high the note is. One full turn is one octave, so
// stacking a fifth moves 0.585 of a turn outward along the curve, and twelve
// fifths wind round seven times. Drawn by the Part 4 hero and Fig. 1.

import { FIFTH, PC_NAMES, fifthName, mod } from "./theory";
import { COL, type RGB, clock, clockArc, dot, glow, glowStroke, hex, label, mixRgb, pcColor, rgba, text } from "./draw";

export interface SpiralState {
  fifth: number; // size of each stacked fifth, cents
  count: number; // nodes shown: k = 0 … count−1
  pen: number; // how far the trail has been drawn, in fifths (fractional)
  flash: number[]; // per-node bloom, 0..1
  hover: number; // highlighted node or −1
  commaAlpha: number; // 0..1 visibility of the gap marker
  labels: boolean;
  trailAlpha: number;
}

export class PitchSpiral {
  cx = 0;
  cy = 0;
  R = 100;
  r0 = 16;
  // radius scale: 12 pure fifths reach the outer edge
  readonly cMax = 12 * FIFTH;
  maxNodes = 13;

  layout(cx: number, cy: number, R: number): void {
    this.cx = cx;
    this.cy = cy;
    this.R = R;
    this.r0 = R * 0.17;
  }

  rOf(c: number): number {
    return this.r0 + ((this.R - this.r0) * c) / this.cMax;
  }

  at(c: number): [number, number] {
    return clock(this.cx, this.cy, this.rOf(c), c / 1200);
  }

  nodeAt(k: number, fifth: number): [number, number] {
    return this.at(k * fifth);
  }

  // Nearest node to (x, y) within `reach` CSS px, or −1.
  pick(x: number, y: number, s: SpiralState, reach: number): number {
    let best = -1;
    let bd = reach;
    for (let k = 0; k < s.count; k++) {
      const [nx, ny] = this.nodeAt(k, s.fifth);
      const d = Math.hypot(nx - x, ny - y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  draw(ctx: CanvasRenderingContext2D, s: SpiralState, t: number, scale = 1): void {
    const { cx, cy, R } = this;
    const fs = Math.max(10, Math.min(14.5, R * 0.064));

    // backdrop: soft centre glow
    glow(ctx, cx, cy, R * 1.25, [40, 52, 96], 0.22);

    // semitone spokes with equal-tempered names round the rim
    ctx.lineWidth = 1;
    for (let p = 0; p < 12; p++) {
      const [x0, y0] = clock(cx, cy, this.r0 * 0.55, p / 12);
      const [x1, y1] = clock(cx, cy, R + 6, p / 12);
      ctx.strokeStyle = p === 0 ? "rgba(122, 162, 255, 0.28)" : "rgba(122, 140, 200, 0.10)";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const [lx, ly] = clock(cx, cy, R + fs * 1.25, p / 12);
      text(ctx, PC_NAMES[p], lx, ly, {
        size: fs * 0.92,
        color: p === 0 ? "#aac2ff" : COL.dim,
        align: "center",
        base: "middle",
        weight: p === 0 ? 700 : 500,
        alpha: p === 0 ? 0.95 : 0.6,
      });
    }

    // the whole spiral, faint: every pitch from the start up seven octaves
    this.path(ctx, 0, this.cMax + 40, 3);
    ctx.strokeStyle = "rgba(120, 140, 210, 0.13)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // octave crossings on the C spoke
    for (let o = 1; o <= 7; o++) {
      const [x, y] = this.at(o * 1200);
      ctx.fillStyle = "rgba(170, 194, 255, 0.35)";
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // trail of the stacked fifths, cool to warm
    const penC = Math.max(0, s.pen) * s.fifth;
    if (penC > 1 && s.trailAlpha > 0.01) {
      const segs = Math.max(6, Math.ceil(penC / 70));
      const step = penC / segs;
      for (let i = 0; i < segs; i++) {
        const c0 = i * step;
        const c1 = c0 + step + 0.5;
        this.path(ctx, c0, c1, 5);
        const col = trailColor(c0 / this.cMax);
        glowStroke(ctx, col, 0.75 * s.trailAlpha, 1.6 * scale);
      }
    }

    // comma: the gap between the twelfth fifth and seven octaves
    const k12 = 12;
    if (s.count > k12 && s.commaAlpha > 0.01) {
      const c12 = k12 * s.fifth;
      const gap = c12 - 8400; // + = overshoot (pure fifths), − = falls short
      const rr = this.rOf(c12);
      const [tx, ty] = this.at(8400);
      // target: where seven octaves up would be
      ctx.strokeStyle = rgba(hex("#aac2ff"), 0.55 * s.commaAlpha);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(tx, ty, 6 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (Math.abs(gap) > 0.05) {
        const t0 = Math.min(0, gap / 1200);
        const t1 = Math.max(0, gap / 1200);
        const pulse = 0.75 + 0.25 * Math.sin(t * 4.2);
        clockArc(ctx, cx, cy, rr, t0, t1);
        glowStroke(ctx, hex("#ff6b5e"), s.commaAlpha * pulse, 3 * scale);
      }
    }

    // nodes
    for (let k = 0; k < Math.min(s.count, this.maxNodes); k++) {
      const c = k * s.fifth;
      const [x, y] = this.at(c);
      const pc = mod(Math.round((k * 7) % 12), 12);
      const col = pcColor(pc);
      const f = s.flash[k] ?? 0;
      const hov = s.hover === k ? 1 : 0;
      const isComma = k === 12;
      const base = isComma ? (hex("#ff8a6e") as RGB) : col;
      dot(ctx, x, y, (3.4 + 2.2 * f + 1.4 * hov) * scale, base, 0.95, 3.6 + 2 * f);
      if (s.labels) {
        // label outward from the centre
        const ang = Math.atan2(y - cy, x - cx);
        const off = (fs * 1.05 + 4) * scale;
        let lx = x + Math.cos(ang) * off;
        let ly = y + Math.sin(ang) * off;
        if (isComma) {
          // B♯ sits next to the C spoke: put its label beside it, on the side
          // of the gap, so it doesn't sit on top of the rim's "C"
          const side = 12 * s.fifth - 8400 >= 0 ? 1 : -1;
          const tx = -Math.sin(ang) * side;
          const ty = Math.cos(ang) * side;
          lx = x + tx * off * 1.25 + Math.cos(ang) * off * 0.2;
          ly = y + ty * off * 1.25 + Math.sin(ang) * off * 0.2;
        }
        const name = fifthName(k);
        text(ctx, name, lx, ly, {
          size: fs * (k === 0 || isComma ? 1.05 : 0.92),
          color: rgba(mixRgb(base, [255, 255, 255], 0.55), 1),
          align: "center",
          base: "middle",
          weight: 650,
          alpha: 0.75 + 0.25 * Math.max(f, hov),
        });
      }
    }
  }

  // Path along the spiral between two pitches.
  path(ctx: CanvasRenderingContext2D, c0: number, c1: number, stepCents: number): void {
    ctx.beginPath();
    const n = Math.max(2, Math.ceil((c1 - c0) / stepCents));
    for (let i = 0; i <= n; i++) {
      const c = c0 + ((c1 - c0) * i) / n;
      const [x, y] = this.at(c);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  // Tag next to the comma arc.
  commaTag(ctx: CanvasRenderingContext2D, s: SpiralState, textStr: string, scale = 1): void {
    if (s.count <= 12 || s.commaAlpha < 0.02) return;
    const c12 = 12 * s.fifth;
    const rr = this.rOf(c12);
    const gap = c12 - 8400;
    const side = gap >= 0 ? 1 : -1;
    const [x, y] = clock(this.cx, this.cy, rr + 16 * scale, (side * 0.045 + gap / 1200) as number);
    ctx.globalAlpha = s.commaAlpha;
    label(ctx, textStr, x + side * 6 * scale, y - 4 * scale, {
      size: 11 * scale,
      color: "#ffb4a3",
      align: side > 0 ? "left" : "right",
      mono: true,
    });
    ctx.globalAlpha = 1;
  }
}

const TRAIL: RGB[] = [hex("#5f8bff"), hex("#9b8cff"), hex("#e48ad0"), hex("#ffb86b")];
export function trailColor(t: number): RGB {
  const x = Math.max(0, Math.min(1, t)) * (TRAIL.length - 1);
  const i = Math.min(TRAIL.length - 2, Math.floor(x));
  return mixRgb(TRAIL[i], TRAIL[i + 1], x - i);
}
