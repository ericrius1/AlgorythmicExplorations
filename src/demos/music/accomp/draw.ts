// Drawing helpers shared by the accompanist figures: colours, Retina-aware
// sizes, and a scrolling piano roll that can show the band's planned notes
// before they sound.

import { pixelRatio } from "../../../lib/palette";
import { midiName } from "../../../lib/audio";
import type { Accompanist, BandNote, PlayerNote } from "./band";
import { type Key, pcOf, scaleOf, spell } from "./theory";
import { pageNow } from "./clock";

export const C = {
  bg: "#090a10",
  you: [226, 240, 255] as const,
  ghost: [186, 204, 255] as const,
  comp: [255, 184, 107] as const,
  pad: [255, 150, 90] as const,
  bass: [160, 140, 255] as const,
  answer: [125, 224, 176] as const,
  accent: [122, 162, 255] as const,
  muted: "rgba(150,160,190,0.7)",
  text: "#e7ebf6",
};

export const rgba = (c: readonly number[], a: number): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export function ui(canvas: HTMLCanvasElement): number {
  return pixelRatio(canvas);
}

export function font(px: number, weight = 600, mono = false): string {
  return `${weight} ${px}px ${mono ? 'ui-monospace, "SF Mono", Menlo, monospace' : "ui-sans-serif, system-ui, -apple-system, sans-serif"}`;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

const KIND_COLOR: Record<string, readonly number[]> = {
  comp: C.comp,
  arp: C.comp,
  pad: C.pad,
  bass: C.bass,
  answer: C.answer,
};

export interface RollOpts {
  lo: number; // lowest midi shown
  hi: number;
  past: number; // seconds of history to the left of the now line
  future: number; // seconds to the right
  showDrums: boolean;
  showSpans: boolean;
}

// A piano roll with time flowing right to left through a fixed "now" line.
export function drawRoll(
  g: CanvasRenderingContext2D,
  band: Accompanist,
  x0: number,
  y0: number,
  w: number,
  h: number,
  s: number, // device pixels per CSS pixel
  o: RollOpts,
): void {
  const now = pageNow();
  const nowX = x0 + w * (o.past / (o.past + o.future));
  const pps = w / (o.past + o.future);
  const xOf = (t: number): number => nowX + (t - now) * pps;
  const rows = o.hi - o.lo + 1;
  const rowH = h / rows;
  const yOf = (m: number): number => y0 + h - (m - o.lo + 1) * rowH;
  const key: Key | null = band.ear.key;

  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();

  // scale rows of the current key; the tonic gets a label
  if (key) {
    const sc = scaleOf(key);
    for (let m = o.lo; m <= o.hi; m++) {
      const pc = pcOf(m);
      if (!sc.includes(pc)) continue;
      g.fillStyle = pc === key.root ? "rgba(122,162,255,0.11)" : "rgba(122,162,255,0.035)";
      g.fillRect(x0, yOf(m), w, rowH);
    }
  }

  // bars and beats
  if (band.clock.isRunning) {
    const first = Math.floor(band.clock.stepAt(now - o.past) / 4) * 4;
    const last = band.clock.stepAt(now + o.future);
    for (let st = first; st <= last; st += 4) {
      const x = xOf(band.clock.timeOf(st));
      const bar = st % 16 === 0;
      g.fillStyle = bar ? "rgba(170,180,220,0.16)" : "rgba(170,180,220,0.05)";
      g.fillRect(x, y0, Math.max(1, s), h);
    }
  }

  // chord changes
  g.font = font(11 * s, 650);
  for (let i = 0; i < band.marks.length; i++) {
    const mk = band.marks[i];
    const x = xOf(mk.t);
    if (x > x0 + w) continue;
    g.fillStyle = "rgba(255,184,107,0.28)";
    g.fillRect(x, y0, Math.max(1, s), h);
    const next = band.marks[i + 1];
    const room = (next ? xOf(next.t) : x0 + w) - x;
    if (room > 34 * s) {
      g.fillStyle = "rgba(255,200,140,0.92)";
      g.fillText(mk.name, Math.max(x + 5 * s, x0 + 4 * s), y0 + 15 * s);
      g.fillStyle = "rgba(255,200,140,0.55)";
      g.font = font(10 * s, 500, true);
      g.fillText(mk.roman, Math.max(x + 5 * s, x0 + 4 * s), y0 + 28 * s);
      g.font = font(11 * s, 650);
    }
  }

  // call → answer brackets
  if (o.showSpans) {
    for (const sp of band.spans) {
      const bracket = (a: number, b: number, label: string, col: readonly number[]): void => {
        const xa = xOf(a);
        const xb = xOf(b);
        if (xb < x0 || xa > x0 + w) return;
        const y = y0 + 38 * s;
        g.strokeStyle = rgba(col, 0.6);
        g.lineWidth = 1.5 * s;
        g.beginPath();
        g.moveTo(xa, y + 6 * s);
        g.lineTo(xa, y);
        g.lineTo(xb, y);
        g.lineTo(xb, y + 6 * s);
        g.stroke();
        g.fillStyle = rgba(col, 0.9);
        g.font = font(10.5 * s, 650);
        g.fillText(label, xa + 4 * s, y - 5 * s);
      };
      bracket(sp.callT0, sp.callT1, "call", C.you);
      bracket(sp.t0, sp.t1, `answer · ${sp.mode}`, C.answer);
    }
  }

  // notes: band first, you on top
  const drawBar = (m: number, t0: number, t1: number, col: readonly number[], a: number, glow: boolean, thick = 1): void => {
    if (m < o.lo || m > o.hi) return;
    const xa = Math.max(x0 - 4, xOf(t0));
    const xb = Math.min(x0 + w + 4, xOf(t1));
    if (xb < x0 || xa > x0 + w) return;
    const y = yOf(m) + rowH * 0.12;
    const hh = Math.max(2 * s, rowH * 0.76 * thick);
    if (glow) {
      g.shadowColor = rgba(col, 0.9);
      g.shadowBlur = 10 * s;
    }
    g.fillStyle = rgba(col, a);
    roundRect(g, xa, y, Math.max(2 * s, xb - xa), hh, 2.5 * s);
    g.fill();
    g.shadowBlur = 0;
  };

  for (const n of band.band as BandNote[]) {
    if (n.cancelled || n.kind === "drum") continue;
    const col = KIND_COLOR[n.kind];
    const live = n.t <= now && now < n.t + n.dur;
    const future = n.t > now;
    const a = n.kind === "pad" ? 0.32 : future ? 0.38 : live ? 0.95 : 0.6;
    drawBar(n.midi, n.t, n.t + n.dur, col, a, live && n.kind !== "pad");
  }
  for (const p of band.player as PlayerNote[]) {
    const t1 = p.t1 ?? now;
    const live = p.t0 <= now && (p.t1 === null || now < p.t1);
    drawBar(p.midi, p.t0, Math.max(t1, p.t0 + 0.05), p.ghost ? C.ghost : C.you, p.t0 > now ? 0.4 : live ? 1 : 0.75, live);
  }

  // drum ticks along the bottom
  if (o.showDrums) {
    for (const n of band.band) {
      if (n.kind !== "drum" || n.cancelled) continue;
      const x = xOf(n.t);
      if (x < x0 || x > x0 + w) continue;
      const hh = (n.voice === "kick" ? 9 : n.voice === "brush" ? 7 : 4) * s;
      g.fillStyle = n.t > now ? "rgba(200,205,230,0.18)" : "rgba(200,205,230,0.45)";
      g.fillRect(x - s, y0 + h - hh - 2 * s, 2 * s, hh);
    }
  }

  // now line
  const grad = g.createLinearGradient(nowX - 30 * s, 0, nowX, 0);
  grad.addColorStop(0, "rgba(122,162,255,0)");
  grad.addColorStop(1, "rgba(122,162,255,0.10)");
  g.fillStyle = grad;
  g.fillRect(nowX - 30 * s, y0, 30 * s, h);
  g.fillStyle = "rgba(190,205,255,0.55)";
  g.fillRect(nowX, y0, Math.max(1, s), h);

  // tonic labels on the left
  if (key) {
    g.font = font(10 * s, 600, true);
    g.fillStyle = "rgba(150,170,240,0.75)";
    for (let m = o.lo; m <= o.hi; m++) {
      if (pcOf(m) !== key.root) continue;
      g.fillText(`${spell(key.root, key)}${Math.floor(m / 12) - 1}`, x0 + 5 * s, yOf(m) + rowH * 0.8);
    }
  } else {
    g.font = font(10 * s, 600, true);
    g.fillStyle = "rgba(150,170,240,0.5)";
    for (let m = o.lo; m <= o.hi; m++) if (pcOf(m) === 0) g.fillText(midiName(m), x0 + 5 * s, yOf(m) + rowH * 0.8);
  }
  g.restore();
}
