// Fig: one bandgap against the sun (Shockley–Queisser losses), and
// Fig: two bandgaps sharing it (the tandem spectrum split).
// Both use the detailed-balance model in physics.ts.

import type { Demo } from "../../lib/demoShell";
import {
  E_MIN,
  N_E,
  PHOTON_FLUX,
  SI_GAP,
  SQ_CURVE,
  SUN_POWER,
  TANDEM_CURVE,
  bromideFor,
  energyAt,
  idealTandem,
  nmFromEv,
  powerBetween,
  sqCell,
} from "./physics";
import {
  C_HEAT,
  C_KEPT,
  C_PASS,
  C_SI,
  C_TOP,
  C_VOLT,
  FAINT,
  INK,
  MUTED,
  TEXT,
  chip,
  clamp,
  figureCanvas,
  font,
  pointerPos,
  rgba,
  text,
  wavelengthCss,
} from "./draw";

const Q = 1.602176634e-19;

interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
  e0: number;
  e1: number;
}

const xOf = (p: Plot, ev: number): number => p.x + ((ev - p.e0) / (p.e1 - p.e0)) * p.w;
const evOf = (p: Plot, x: number): number => p.e0 + ((x - p.x) / p.w) * (p.e1 - p.e0);

/** energy axis with eV ticks below and wavelength ticks above */
function energyAxes(ctx: CanvasRenderingContext2D, p: Plot, narrow: boolean): void {
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y + p.h + 0.5);
  ctx.lineTo(p.x + p.w, p.y + p.h + 0.5);
  ctx.stroke();
  font(ctx, 10, 400, true);
  const step = narrow ? 1 : 0.5;
  for (let e = Math.ceil(p.e0 / step) * step; e <= p.e1 + 1e-6; e += step) {
    const x = xOf(p, e);
    ctx.fillStyle = MUTED;
    ctx.fillRect(x, p.y + p.h, 1, 4);
    text(ctx, `${e.toFixed(e % 1 ? 1 : 0)}`, x, p.y + p.h + 25, MUTED, "center");
  }
  text(ctx, "photon energy, eV", p.x + p.w, p.y + p.h + 38, MUTED, "right");
  // visible-light strip under the axis
  for (let x = 0; x < p.w; x += 2) {
    const nm = nmFromEv(evOf(p, p.x + x));
    ctx.fillStyle = wavelengthCss(nm, nm > 780 ? 0.35 : 0.85);
    ctx.fillRect(p.x + x, p.y + p.h + 5, 2, 5);
  }
  const nms = narrow ? [2000, 1000, 500] : [2000, 1000, 700, 500, 400];
  for (const nm of nms) {
    const x = xOf(p, 1239.84 / nm);
    if (x < p.x || x > p.x + p.w) continue;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x, p.y - 4, 1, 4);
    text(ctx, `${nm}`, x, p.y - 8, MUTED, "center");
  }
  text(ctx, "nm", p.x - 4, p.y - 8, MUTED, "right");
}

function gateLine(ctx: CanvasRenderingContext2D, p: Plot, ev: number, color: string, label: string, side: "auto" | "left" = "auto"): void {
  const x = xOf(p, ev);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(x, p.y - 2);
  ctx.lineTo(x, p.y + p.h);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // handle
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, p.y + 6, 4.5, 0, Math.PI * 2);
  ctx.fill();
  font(ctx, 11, 600);
  const right = side === "auto" && x + 8 + ctx.measureText(label).width < p.x + p.w;
  text(ctx, label, right ? x + 8 : x - 8, p.y + 18, color, right ? "left" : "right");
}

/** small efficiency-vs-gap curve */
function curvePanel(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  e0: number,
  e1: number,
  yMax: number,
  series: { pts: { eg: number; v: number }[]; color: string; dash?: number[] }[],
  marker: { eg: number; v: number; color: string } | null,
  title: string,
  refs: { eg: number; label: string }[] = [],
): void {
  const X = (e: number): number => r.x + ((e - e0) / (e1 - e0)) * r.w;
  const Y = (v: number): number => r.y + r.h - (v / yMax) * r.h;
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  font(ctx, 10, 400, true);
  for (let v = 10; v < yMax; v += 10) {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(r.x, Y(v), r.w, 1);
    text(ctx, `${v}%`, r.x - 4, Y(v) + 3, MUTED, "right");
  }
  for (let e = Math.ceil(e0 * 2) / 2; e <= e1 + 1e-6; e += 0.5) {
    text(ctx, e.toFixed(1), X(e), r.y + r.h + 13, MUTED, "center");
  }
  for (const ref of refs) {
    const x = X(ref.eg);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x, r.y, 1, r.h);
    font(ctx, 9);
    text(ctx, ref.label, x + 3, r.y + 11, MUTED);
  }
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dash ?? []);
    ctx.beginPath();
    s.pts.forEach((pt, i) => (i ? ctx.lineTo(X(pt.eg), Y(pt.v)) : ctx.moveTo(X(pt.eg), Y(pt.v))));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (marker) {
    ctx.fillStyle = marker.color;
    ctx.shadowColor = marker.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(X(marker.eg), Y(marker.v), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  font(ctx, 11, 600);
  text(ctx, title, r.x, r.y - 7, TEXT);
}

/** drag along a plot to move a gap */
function dragGap(canvas: HTMLCanvasElement, W: number, plot: () => Plot, set: (ev: number) => void): void {
  let down = false;
  const apply = (e: PointerEvent): void => {
    const p = plot();
    const pos = pointerPos(canvas, e, W);
    if (pos.y < p.y - 20 || pos.y > p.y + p.h + 12) return;
    set(evOf(p, pos.x));
  };
  canvas.addEventListener("pointerdown", (e) => {
    const p = plot();
    const pos = pointerPos(canvas, e, W);
    if (pos.x < p.x - 10 || pos.x > p.x + p.w + 10 || pos.y < p.y - 20 || pos.y > p.y + p.h + 12) return;
    down = true;
    canvas.setPointerCapture(e.pointerId);
    apply(e);
  });
  canvas.addEventListener("pointermove", (e) => down && apply(e));
  canvas.addEventListener("pointerup", () => (down = false));
  canvas.addEventListener("pointercancel", () => (down = false));
}

// ---------------------------------------------------------------------------

export function mountBandgapLossMap(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.6, 1.65);
  const { ctx, W, H, narrow, shell } = fig;
  let eg = SI_GAP;
  let dirty = true;

  const slider = shell.slider({
    label: "Bandgap",
    min: 0.7,
    max: 2.4,
    step: 0.01,
    value: eg,
    format: (v) => `${v.toFixed(2)} eV`,
    onInput: (v) => {
      eg = v;
      dirty = true;
    },
  });

  const plot: Plot = narrow
    ? { x: 40, y: 30, w: W - 52, h: H * 0.34, e0: 0.4, e1: 3.6 }
    : { x: 52, y: 34, w: W * 0.6 - 52, h: H - 100, e0: 0.4, e1: 3.6 };

  dragGap(shell.canvas, W, () => plot, (ev) => {
    eg = clamp(Math.round(ev * 100) / 100, 0.7, 2.4);
    slider.value = String(eg);
    slider.dispatchEvent(new Event("input"));
  });

  // spectral power density (mW/cm² per eV) on the plot grid
  const density = new Float64Array(N_E);
  let peak = 0;
  for (let i = 0; i < N_E; i++) {
    density[i] = PHOTON_FLUX[i] * energyAt(i) * Q * 0.1;
    peak = Math.max(peak, density[i]);
  }

  const losses = (): { kept: number; volt: number; heat: number; pass: number; cell: ReturnType<typeof sqCell> } => {
    const cell = sqCell(eg);
    const photonsAbove = cell.jsc; // mA/cm² = photon current
    const pass = powerBetween(0.3, eg);
    const above = SUN_POWER - pass;
    const heat = above - photonsAbove * eg; // E - Eg for every absorbed photon
    const kept = cell.pmax;
    const volt = photonsAbove * eg - kept;
    return { kept, volt, heat, pass, cell };
  };

  shell.setInfo(() => {
    const l = losses();
    return `${eg.toFixed(2)} eV (${Math.round(nmFromEv(eg))} nm) · limit ${l.cell.pmax.toFixed(1)}% · Jsc ${l.cell.jsc.toFixed(1)} mA/cm² · Voc ${l.cell.voc.toFixed(2)} V`;
  });

  const draw = (): void => {
    fig.begin();
    const l = losses();
    const p = plot;
    const vmpEff = l.cell.pmax / (l.cell.jsc || 1); // energy kept per absorbed photon, eV
    const yOf = (d: number): number => p.y + p.h - (d / peak) * p.h * 0.94;

    // stacked fill: for every column, split the sunlight at that energy into its fates
    const cols = Math.ceil(p.w);
    for (let c = 0; c < cols; c++) {
      const e = evOf(p, p.x + c + 0.5);
      const i = Math.round((e - E_MIN) / 0.002);
      if (i < 0 || i >= N_E) continue;
      const top = yOf(density[i]);
      const base = p.y + p.h;
      const hgt = base - top;
      if (e < eg) {
        ctx.fillStyle = rgba(C_PASS, 0.75);
        ctx.fillRect(p.x + c, top, 1.2, hgt);
      } else {
        const fk = vmpEff / e;
        const fv = (eg - vmpEff) / e;
        ctx.fillStyle = rgba(C_KEPT, 0.9);
        ctx.fillRect(p.x + c, base - hgt * fk, 1.2, hgt * fk);
        ctx.fillStyle = rgba(C_VOLT, 0.8);
        ctx.fillRect(p.x + c, base - hgt * (fk + fv), 1.2, hgt * fv);
        ctx.fillStyle = rgba(C_HEAT, 0.8);
        ctx.fillRect(p.x + c, top, 1.2, hgt * (1 - fk - fv));
      }
    }
    // spectrum outline
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let c = 0; c <= cols; c += 2) {
      const e = evOf(p, p.x + c);
      const i = clamp(Math.round((e - E_MIN) / 0.002), 0, N_E - 1);
      const y = yOf(density[i]);
      c ? ctx.lineTo(p.x + c, y) : ctx.moveTo(p.x + c, y);
    }
    ctx.stroke();
    energyAxes(ctx, p, narrow);
    gateLine(ctx, p, eg, INK, `gap ${eg.toFixed(2)} eV`);
    font(ctx, 10);
    text(ctx, "sunlight power per eV", p.x + p.w - 2, p.y + 34, MUTED, "right");

    // legend with the energy split, then the efficiency curve
    const rows: [string, string, number][] = [
      [C_KEPT, "electrical power", l.kept],
      [C_VOLT, "voltage and emission loss", l.volt],
      [C_HEAT, "heat (energy above the gap)", l.heat],
      [C_PASS, "passes through (below the gap)", l.pass],
    ];
    const lx = narrow ? 14 : W * 0.65;
    let ly = narrow ? p.y + p.h + 64 : 46;
    const lh = narrow ? 19 : 22;
    font(ctx, 11, 600);
    text(ctx, "where 100 mW/cm² of sunlight goes", lx, ly, TEXT);
    ly += lh;
    for (const [color, label, v] of rows) {
      chip(ctx, lx, ly, color, label, 12);
      font(ctx, 12, 600, true);
      text(ctx, `${v.toFixed(1)}%`, W - 14, ly, INK, "right");
      ly += lh;
    }

    const cr = narrow
      ? { x: 40, y: ly + 22, w: W - 56, h: H - ly - 46 }
      : { x: W * 0.65 + 26, y: ly + 30, w: W * 0.35 - 40, h: H - ly - 66 };
    curvePanel(
      ctx,
      cr,
      0.5,
      2.6,
      40,
      [{ pts: SQ_CURVE.map((d) => ({ eg: d.eg, v: d.eff })), color: C_KEPT }],
      { eg, v: l.cell.pmax, color: INK },
      "limit vs bandgap",
      [
        { eg: 1.12, label: "Si" },
        { eg: 1.68, label: "perovskite" },
      ],
    );
  };

  return {
    frame() {
      if (dirty) {
        draw();
        dirty = false;
      }
      shell.tick();
    },
  };
}

// ---------------------------------------------------------------------------

export function mountSpectrumSplitter(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.6, 1.45);
  const { ctx, W, H, narrow, shell } = fig;
  let top = 1.68;
  let dirty = true;

  const slider = shell.slider({
    label: "Top-cell bandgap",
    min: 1.45,
    max: 2.2,
    step: 0.01,
    value: top,
    format: (v) => `${v.toFixed(2)} eV`,
    onInput: (v) => {
      top = v;
      dirty = true;
    },
  });

  const plot: Plot = narrow
    ? { x: 40, y: 30, w: W - 52, h: H * 0.3, e0: 0.5, e1: 3.6 }
    : { x: 52, y: 34, w: W * 0.6 - 52, h: H - 100, e0: 0.5, e1: 3.6 };

  dragGap(shell.canvas, W, () => plot, (ev) => {
    top = clamp(Math.round(ev * 100) / 100, 1.45, 2.2);
    slider.value = String(top);
    slider.dispatchEvent(new Event("input"));
  });

  let peak = 0;
  for (let i = 0; i < N_E; i++) peak = Math.max(peak, PHOTON_FLUX[i]);
  const siAlone = sqCell(SI_GAP).pmax;

  const brText = (): string => {
    const x = bromideFor(top);
    if (x === null) return top < 1.6 ? "lower than any iodide–bromide mix" : "higher than all-bromide";
    return `≈ ${Math.round(x * 100)}% Br`;
  };

  shell.setInfo(() => {
    const t = idealTandem(top);
    return `top ${top.toFixed(2)} eV (${brText()}) · perovskite ${t.jTop.toFixed(1)} / silicon ${t.jBot.toFixed(1)} mA/cm² · 2-terminal ${t.twoT.pmax.toFixed(1)}% · 4-terminal ${t.fourT.toFixed(1)}%`;
  });

  const draw = (): void => {
    fig.begin();
    const t = idealTandem(top);
    const p = plot;
    const yOf = (f: number): number => p.y + p.h - (f / peak) * p.h * 0.94;
    const cols = Math.ceil(p.w);
    for (let c = 0; c < cols; c++) {
      const e = evOf(p, p.x + c + 0.5);
      const i = Math.round((e - E_MIN) / 0.002);
      if (i < 0 || i >= N_E) continue;
      const y = yOf(PHOTON_FLUX[i]);
      ctx.fillStyle = e >= top ? rgba(C_TOP, 0.8) : e >= SI_GAP ? rgba(C_SI, 0.8) : rgba(C_PASS, 0.6);
      ctx.fillRect(p.x + c, y, 1.2, p.y + p.h - y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let c = 0; c <= cols; c += 2) {
      const e = evOf(p, p.x + c);
      const i = clamp(Math.round((e - E_MIN) / 0.002), 0, N_E - 1);
      c ? ctx.lineTo(p.x + c, yOf(PHOTON_FLUX[i])) : ctx.moveTo(p.x + c, yOf(PHOTON_FLUX[i]));
    }
    ctx.stroke();
    energyAxes(ctx, p, narrow);
    gateLine(ctx, p, SI_GAP, C_SI, narrow ? "Si" : "silicon 1.12", narrow ? "left" : "auto");
    gateLine(ctx, p, top, C_TOP, `top ${top.toFixed(2)}`);
    font(ctx, 10);
    text(ctx, "photons per eV", p.x + p.w - 2, p.y + 34, MUTED, "right");

    // currents: in series both cells carry the smaller one
    const bx = narrow ? 14 : W * 0.65;
    const bw = narrow ? W - 28 : W * 0.35 - 14;
    let by = narrow ? p.y + p.h + 66 : 46;
    font(ctx, 11, 600);
    text(ctx, "photocurrent, mA/cm²", bx, by, TEXT);
    by += 12;
    const jMax = 30;
    const matched = Math.min(t.jTop, t.jBot);
    for (const [label, j, color] of [
      ["perovskite", t.jTop, C_TOP],
      ["silicon", t.jBot, C_SI],
    ] as const) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(bx, by, bw, 20);
      ctx.fillStyle = rgba(color, 0.65);
      ctx.fillRect(bx, by, (bw * j) / jMax, 20);
      // the part a series stack can't use
      if (j > matched + 0.05) {
        ctx.fillStyle = "rgba(6,7,11,0.55)";
        ctx.fillRect(bx + (bw * matched) / jMax, by, (bw * (j - matched)) / jMax, 20);
        ctx.strokeStyle = rgba(color, 0.9);
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(bx + (bw * matched) / jMax + 0.5, by + 0.5, (bw * (j - matched)) / jMax - 1, 19);
        ctx.setLineDash([]);
      }
      font(ctx, 11);
      text(ctx, label, bx + 7, by + 14, INK);
      font(ctx, 11, 600, true);
      text(ctx, j.toFixed(1), bx + bw - 6, by + 14, INK, "right");
      by += 26;
    }
    const mx = bx + (bw * matched) / jMax;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, by - 56);
    ctx.lineTo(mx, by - 4);
    ctx.stroke();
    font(ctx, 11);
    const limiter =
      Math.abs(t.jTop - t.jBot) < 0.3 ? "matched: neither cell wastes current" : t.jTop < t.jBot ? "the perovskite limits the stack" : "the silicon limits the stack";
    text(ctx, limiter, bx, by + 10, Math.abs(t.jTop - t.jBot) < 0.3 ? C_KEPT : MUTED);
    by += 18;

    const cr = narrow
      ? { x: 40, y: by + 34, w: W - 56, h: H - by - 76 }
      : { x: W * 0.65 + 26, y: by + 34, w: W * 0.35 - 40, h: H - by - 86 };
    curvePanel(
      ctx,
      cr,
      1.3,
      2.3,
      50,
      [
        { pts: TANDEM_CURVE.map((d) => ({ eg: d.eg, v: d.fourT })), color: rgba(C_TOP, 0.55), dash: [4, 4] },
        { pts: TANDEM_CURVE.map((d) => ({ eg: d.eg, v: d.twoT })), color: C_TOP },
        { pts: [{ eg: 1.3, v: siAlone }, { eg: 2.3, v: siAlone }], color: rgba(C_SI, 0.8), dash: [2, 4] },
      ],
      { eg: top, v: t.twoT.pmax, color: INK },
      "limit vs top-cell bandgap",
    );
    font(ctx, 10);
    text(ctx, "solid: 2-terminal · dashed: 4-terminal", cr.x, cr.y + cr.h + 28, MUTED);
    text(ctx, `dotted: silicon alone, ${siAlone.toFixed(1)}%`, cr.x, cr.y + cr.h + 41, MUTED);
  };

  return {
    frame() {
      if (dirty) {
        draw();
        dirty = false;
      }
      shell.tick();
    },
  };
}

