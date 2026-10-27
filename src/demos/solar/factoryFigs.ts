// From cell to product: defect yield vs area, lifetime energy with
// degradation, and cost per watt with area-related system costs.

import type { Demo } from "../../lib/demoShell";
import {
  C_BAD,
  C_HEAT,
  C_KEPT,
  C_SI,
  C_TOP,
  FAINT,
  INK,
  MUTED,
  TEXT,
  figureCanvas,
  font,
  rgba,
  roundRect,
  text,
  wrap,
} from "./draw";

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ---------------------------------------------------------------------------
// Yield vs area

const WAFER_CM = 18.2; // M10 wafer side
const WAFER_AREA = WAFER_CM * WAFER_CM;

export function mountYieldArea(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.56, 1.45);
  const { ctx, W, H, narrow, shell } = fig;
  let density = 0.02; // killer defects per cm²
  let cellArea = 4; // cm²
  let dirty = true;

  shell.slider({
    label: "Killer defects",
    min: 0.0001,
    max: 0.5,
    step: 0.001,
    log: true,
    value: density,
    format: (v) => `${v < 0.001 ? v.toFixed(4) : v < 0.01 ? v.toFixed(3) : v.toFixed(2)} per cm²`,
    onInput: (v) => {
      density = v;
      dirty = true;
    },
  });
  shell.slider({
    label: "Cell size",
    min: 1,
    max: WAFER_AREA,
    step: 1,
    log: true,
    value: cellArea,
    format: (v) => `${Math.round(v)} cm²`,
    onInput: (v) => {
      cellArea = v;
      dirty = true;
    },
  });

  // a fixed pool of random defect positions, so moving the slider adds or
  // removes defects instead of reshuffling them
  const rnd = seeded(5);
  const pool: [number, number][] = [];
  for (let i = 0; i < 400; i++) pool.push([rnd(), rnd()]);

  const yieldAt = (a: number): number => Math.exp(-density * a);

  shell.setInfo(() => {
    const n = Math.max(1, Math.round(Math.sqrt(WAFER_AREA / cellArea)));
    const a = WAFER_AREA / (n * n);
    return `${n * n} cell${n > 1 ? "s" : ""} of ${a.toFixed(a < 10 ? 1 : 0)} cm² · expected yield e^(−D·A) = ${(yieldAt(a) * 100).toFixed(1)}%`;
  });

  const draw = (): void => {
    fig.begin();
    const n = Math.max(1, Math.round(Math.sqrt(WAFER_AREA / cellArea)));
    const a = WAFER_AREA / (n * n);
    const side = narrow ? Math.min(W - 40, H * 0.5) : Math.min(H - 70, W * 0.5);
    const ox = narrow ? (W - side) / 2 : 24;
    const oy = 40;
    const count = Math.min(pool.length, Math.round(density * WAFER_AREA));
    const bad = new Set<number>();
    for (let k = 0; k < count; k++) {
      const [u, v] = pool[k];
      bad.add(Math.min(n - 1, Math.floor(v * n)) * n + Math.min(n - 1, Math.floor(u * n)));
    }
    const cs = side / n;
    const gap = Math.min(2, cs * 0.08);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const isBad = bad.has(r * n + c);
        ctx.fillStyle = isBad ? rgba(C_BAD, 0.55) : rgba(C_SI, 0.42);
        ctx.fillRect(ox + c * cs + gap / 2, oy + r * cs + gap / 2, cs - gap, cs - gap);
      }
    }
    ctx.fillStyle = "#ffe9b0";
    for (let k = 0; k < count; k++) {
      const [u, v] = pool[k];
      ctx.beginPath();
      ctx.arc(ox + u * side, oy + v * side, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = FAINT;
    ctx.strokeRect(ox - 0.5, oy - 0.5, side + 1, side + 1);
    font(ctx, 11, 600);
    text(ctx, `one ${WAFER_CM} cm wafer (M10), cut into ${n * n} cell${n > 1 ? "s" : ""}`, ox, oy - 12, TEXT);
    const good = n * n - bad.size;
    font(ctx, 11);
    text(ctx, `${good} good · ${bad.size} with a defect · ${count} defects`, ox, oy + side + 18, MUTED);

    // yield curve against area, log x
    const px = narrow ? 46 : ox + side + 64;
    const pw = narrow ? W - 64 : W - px - 22;
    const py = narrow ? oy + side + 62 : 62;
    const ph = narrow ? H - py - 38 : H - 126;
    const lx = (ar: number): number => px + (Math.log10(ar) / Math.log10(1000)) * pw;
    const Y = (y: number): number => py + ph - y * ph;
    ctx.strokeStyle = FAINT;
    ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
    font(ctx, 10, 400, true);
    for (const ar of [1, 10, 100, 1000]) text(ctx, `${ar}`, lx(ar), py + ph + 13, MUTED, "center");
    for (const y of [0, 0.5, 1]) text(ctx, `${y * 100}%`, px - 4, Y(y) + 3, MUTED, "right");
    font(ctx, 10);
    text(ctx, "cell area, cm²", px + pw, py + ph + 26, MUTED, "right");
    font(ctx, 11, 600);
    text(ctx, "share of cells with no defect", px, py - 14, TEXT);
    ctx.strokeStyle = C_KEPT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k <= 200; k++) {
      const ar = Math.pow(10, (k / 200) * 3);
      k ? ctx.lineTo(lx(ar), Y(yieldAt(ar))) : ctx.moveTo(lx(ar), Y(yieldAt(ar)));
    }
    ctx.stroke();
    for (const [ar, label] of [
      [1, "record cell"],
      [WAFER_AREA, "full wafer"],
    ] as const) {
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(lx(ar), py, 1, ph);
      const yv = yieldAt(ar);
      font(ctx, 9);
      text(ctx, label, lx(ar) + (ar > 100 ? -4 : 4), py + ph - 8, MUTED, ar > 100 ? "right" : "left");
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(lx(ar), Y(yv), 3, 0, Math.PI * 2);
      ctx.fill();
      font(ctx, 10, 600, true);
      const pct = yv * 100 < 1 ? (yv * 100).toFixed(1) : (yv * 100).toFixed(0);
      // keep the value label inside the plot, below the point when it sits near the top
      const ly = Y(yv) < py + 20 ? Y(yv) + 16 : Y(yv) - 7;
      text(ctx, `${pct}%`, lx(ar) + (ar > 100 ? -7 : 7), ly, INK, ar > 100 ? "right" : "left");
    }
    ctx.fillStyle = C_HEAT;
    ctx.beginPath();
    ctx.arc(lx(a), Y(yieldAt(a)), 4.5, 0, Math.PI * 2);
    ctx.fill();
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
// Efficiency over a module's life

const SI_START = 22; // %
const SI_RATE = 0.5; // % of initial power per year

export function mountLifetimeEnergy(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.5, 1.05);
  const { ctx, W, H, narrow, shell } = fig;
  let start = 26;
  let rate = 1.5;
  const YEARS = 25;
  let dirty = true;

  shell.slider({
    label: "Tandem starting efficiency",
    min: 22,
    max: 32,
    step: 0.1,
    value: start,
    format: (v) => `${v.toFixed(1)}%`,
    onInput: (v) => {
      start = v;
      dirty = true;
    },
  });
  shell.slider({
    label: "Tandem degradation",
    min: 0,
    max: 4,
    step: 0.05,
    value: rate,
    format: (v) => `${v.toFixed(2)}% / year`,
    onInput: (v) => {
      rate = v;
      dirty = true;
    },
  });

  const eff = (e0: number, r: number, t: number): number => Math.max(0, e0 * (1 - (r / 100) * t));
  // energy over the life is the average efficiency times the years (same sunlight for both)
  const lifetime = (e0: number, r: number): number => {
    let sum = 0;
    for (let k = 0; k < 1000; k++) sum += eff(e0, r, ((k + 0.5) / 1000) * YEARS);
    return (sum / 1000) * YEARS;
  };
  const cross = (): number | null => {
    for (let t = 0; t <= YEARS; t += 0.05) if (eff(start, rate, t) < eff(SI_START, SI_RATE, t)) return t;
    return null;
  };

  shell.setInfo(() => {
    const gain = lifetime(start, rate) / lifetime(SI_START, SI_RATE) - 1;
    const c = cross();
    return `over ${YEARS} years the tandem makes ${gain >= 0 ? "+" : ""}${(gain * 100).toFixed(1)}% energy vs silicon${c === null ? " and stays ahead" : ` · falls behind in year ${c.toFixed(1)}`}`;
  });

  const draw = (): void => {
    fig.begin();
    const px = 46;
    const pw = W - px - (narrow ? 18 : 170);
    const py = 32;
    const ph = H - py - (narrow ? 96 : 46);
    const X = (t: number): number => px + (t / YEARS) * pw;
    const eMin = 10;
    const eMax = 33;
    const Y = (e: number): number => py + ph - ((e - eMin) / (eMax - eMin)) * ph;
    ctx.strokeStyle = FAINT;
    ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
    font(ctx, 10, 400, true);
    for (let t = 0; t <= YEARS; t += 5) text(ctx, `${t}`, X(t), py + ph + 14, MUTED, "center");
    for (let e = 10; e <= 30; e += 5) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(px, Y(e), pw, 1);
      text(ctx, `${e}%`, px - 4, Y(e) + 3, MUTED, "right");
    }
    font(ctx, 10);
    text(ctx, "years in the field", px + pw, py + ph + 28, MUTED, "right");

    // shaded gap between the two lines: gold while the tandem is ahead, red after
    for (let k = 0; k < 100; k++) {
      const t0 = (k / 100) * YEARS;
      const t1 = ((k + 1) / 100) * YEARS;
      const ahead = eff(start, rate, (t0 + t1) / 2) >= eff(SI_START, SI_RATE, (t0 + t1) / 2);
      ctx.fillStyle = ahead ? rgba(C_KEPT, 0.16) : rgba(C_BAD, 0.2);
      ctx.beginPath();
      ctx.moveTo(X(t0), Y(eff(start, rate, t0)));
      ctx.lineTo(X(t1), Y(eff(start, rate, t1)));
      ctx.lineTo(X(t1), Y(eff(SI_START, SI_RATE, t1)));
      ctx.lineTo(X(t0), Y(eff(SI_START, SI_RATE, t0)));
      ctx.closePath();
      ctx.fill();
    }

    const line = (e0: number, r: number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(eff(e0, r, 0)));
      ctx.lineTo(X(YEARS), Y(eff(e0, r, YEARS)));
      ctx.stroke();
    };
    line(SI_START, SI_RATE, C_SI);
    line(start, rate, C_TOP);
    const c = cross();
    if (c !== null) {
      ctx.fillStyle = C_BAD;
      ctx.beginPath();
      ctx.arc(X(c), Y(eff(SI_START, SI_RATE, c)), 4.5, 0, Math.PI * 2);
      ctx.fill();
      font(ctx, 10, 600);
      text(ctx, `crossover, year ${c.toFixed(1)}`, X(c) + 8, Y(eff(SI_START, SI_RATE, c)) + 16, C_BAD);
    }

    // labels and energy totals
    const lx = narrow ? 16 : px + pw + 14;
    let ly = narrow ? py + ph + 50 : py + 20;
    const eT = lifetime(start, rate);
    const eS = lifetime(SI_START, SI_RATE);
    const rows: [string, string, string][] = [
      ["tandem", `${start.toFixed(1)}% → ${eff(start, rate, YEARS).toFixed(1)}%`, C_TOP],
      ["silicon", `${SI_START}% → ${eff(SI_START, SI_RATE, YEARS).toFixed(1)}%`, C_SI],
    ];
    for (const [name, v, color] of rows) {
      font(ctx, 12, 700);
      text(ctx, name, lx, ly, color);
      font(ctx, 11, 400, true);
      text(ctx, v, narrow ? lx + 70 : lx, narrow ? ly : ly + 16, TEXT);
      ly += narrow ? 18 : 40;
    }
    font(ctx, 11);
    const msg = `25-year energy, tandem ÷ silicon: ${(eT / eS).toFixed(3)}`;
    if (narrow) text(ctx, msg, lx, ly + 4, C_KEPT);
    else wrap(ctx, msg, lx, ly + 4, W - lx - 12, 15, C_KEPT);
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
// Cost per watt

const SI_EFF = 22; // %
const SI_PRICE = 0.2; // $/W for the silicon module

export function mountCostPerWatt(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.6, 1.35);
  const { ctx, W, H, narrow, shell } = fig;
  let tEff = 26;
  let added = 30; // $/m² extra for the perovskite top cell
  let area = 70; // $/m² of racking, land, wiring, labour
  let dirty = true;

  shell.slider({
    label: "Tandem module efficiency",
    min: 22,
    max: 32,
    step: 0.1,
    value: tEff,
    format: (v) => `${v.toFixed(1)}%`,
    onInput: (v) => {
      tEff = v;
      dirty = true;
    },
  });
  shell.slider({
    label: "Extra cost of the top cell",
    min: 0,
    max: 100,
    step: 1,
    value: added,
    format: (v) => `$${v.toFixed(0)} / m²`,
    onInput: (v) => {
      added = v;
      dirty = true;
    },
  });
  shell.slider({
    label: "Area-related system cost",
    min: 10,
    max: 200,
    step: 1,
    value: area,
    format: (v) => `$${v.toFixed(0)} / m²`,
    onInput: (v) => {
      area = v;
      dirty = true;
    },
  });

  const siModule = SI_PRICE * SI_EFF * 10; // $/m²: 22% of 1,000 W/m² = 220 W
  const calc = () => {
    const siW = SI_EFF * 10;
    const tW = tEff * 10;
    const si = { module: siModule / siW, area: area / siW };
    const t = { module: (siModule + added) / tW, area: area / tW };
    const breakeven = (siModule + area) * (tW / siW - 1);
    return { si, t, breakeven, siW, tW };
  };

  shell.setInfo(() => {
    const c = calc();
    const sT = c.si.module + c.si.area;
    const tT = c.t.module + c.t.area;
    return `silicon $${sT.toFixed(3)}/W · tandem $${tT.toFixed(3)}/W · the tandem breaks even up to $${c.breakeven.toFixed(0)}/m² extra`;
  });

  const draw = (): void => {
    fig.begin();
    const c = calc();
    const bx = narrow ? 16 : 120;
    const bw = W - bx - (narrow ? 78 : 100);
    const maxW = Math.max(c.si.module + c.si.area, c.t.module + c.t.area) * 1.15;
    const X = (v: number): number => bx + (v / maxW) * bw;
    let y = 46;
    font(ctx, 11, 600);
    text(ctx, "cost per watt of the parts that scale with area", narrow ? 16 : bx, 22, TEXT);
    for (const [name, v, watts, color] of [
      ["silicon", c.si, c.siW, C_SI],
      ["tandem", c.t, c.tW, C_TOP],
    ] as const) {
      const bh = narrow ? 30 : 36;
      if (narrow) {
        font(ctx, 12, 700);
        text(ctx, `${name} · ${watts.toFixed(0)} W/m²`, bx, y, color);
        y += 8;
      } else {
        font(ctx, 12, 700);
        text(ctx, name, bx - 12, y + 16, color, "right");
        font(ctx, 10, 400, true);
        text(ctx, `${watts.toFixed(0)} W/m²`, bx - 12, y + 30, MUTED, "right");
      }
      ctx.fillStyle = rgba(color, 0.7);
      roundRect(ctx, X(0), y, X(v.module) - X(0), bh, 4);
      ctx.fill();
      ctx.fillStyle = rgba(C_HEAT, 0.45);
      roundRect(ctx, X(v.module), y, X(v.module + v.area) - X(v.module), bh, 4);
      ctx.fill();
      font(ctx, 11, 600, true);
      text(ctx, `$${v.module.toFixed(3)}`, X(0) + 6, y + bh / 2 + 4, "#0b0d14");
      text(ctx, `$${v.area.toFixed(3)}`, X(v.module) + 6, y + bh / 2 + 4, INK);
      text(ctx, `$${(v.module + v.area).toFixed(3)}/W`, X(v.module + v.area) + 6, y + bh / 2 + 4, INK);
      y += bh + (narrow ? 30 : 22);
    }
    font(ctx, 11);
    let ly = y + 4;
    ctx.fillStyle = rgba(C_SI, 0.7);
    ctx.fillRect(bx, ly - 9, 10, 10);
    text(ctx, "module", bx + 15, ly, TEXT);
    ctx.fillStyle = rgba(C_HEAT, 0.45);
    ctx.fillRect(bx + 80, ly - 9, 10, 10);
    text(ctx, "racking, land, wiring, labour", bx + 95, ly, TEXT);
    ly += 26;
    const ahead = c.t.module + c.t.area < c.si.module + c.si.area;
    font(ctx, 12);
    ly = wrap(
      ctx,
      `Silicon module at $${SI_PRICE.toFixed(2)}/W and ${SI_EFF}% (≈ $${siModule.toFixed(0)}/m²). At these settings the tandem ${ahead ? "is cheaper per watt" : "costs more per watt"}; it breaks even if its top cell adds up to $${c.breakeven.toFixed(0)}/m².`,
      narrow ? 16 : bx,
      ly,
      narrow ? W - 32 : bw,
      17,
      ahead ? C_KEPT : TEXT,
    );

    // break-even line: the most the top cell can add, for every area cost
    const gx = narrow ? 46 : bx;
    const gw = narrow ? W - 62 : bw - 20;
    const gy = ly + 26;
    const gh = H - gy - 34;
    if (gh < 60) return;
    const aMax = 200;
    const beMax = 80;
    const GX = (a: number): number => gx + (a / aMax) * gw;
    const GY = (v: number): number => gy + gh - (Math.min(v, beMax) / beMax) * gh;
    const be = (a: number): number => (siModule + a) * (tEff / SI_EFF - 1);
    // shade: below the line the tandem is cheaper per watt
    ctx.beginPath();
    ctx.moveTo(GX(0), GY(0));
    for (let a = 0; a <= aMax; a += 5) ctx.lineTo(GX(a), GY(Math.max(0, be(a))));
    ctx.lineTo(GX(aMax), GY(0));
    ctx.closePath();
    ctx.fillStyle = rgba(C_KEPT, 0.1);
    ctx.fill();
    ctx.strokeStyle = FAINT;
    ctx.strokeRect(gx + 0.5, gy + 0.5, gw, gh);
    ctx.strokeStyle = C_KEPT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let a = 0; a <= aMax; a += 5) (a ? ctx.lineTo : ctx.moveTo).call(ctx, GX(a), GY(Math.max(0, be(a))));
    ctx.stroke();
    font(ctx, 10, 400, true);
    for (const a of [0, 50, 100, 150, 200]) text(ctx, `$${a}`, GX(a), gy + gh + 13, MUTED, "center");
    for (const v of [0, 40, 80]) text(ctx, `$${v}`, gx - 4, GY(v) + 3, MUTED, "right");
    font(ctx, 10);
    text(ctx, "area-related system cost, per m²", gx + gw, gy + gh + 26, MUTED, "right");
    font(ctx, 11, 600);
    text(ctx, `most the top cell can add per m², at ${tEff.toFixed(1)}%`, gx, gy - 8, TEXT);
    font(ctx, 10);
    text(ctx, "tandem cheaper", GX(aMax) - 6, GY(0) - 6, rgba(C_KEPT, 0.9), "right");
    text(ctx, "silicon cheaper", gx + 6, gy + 14, MUTED);
    ctx.fillStyle = ahead ? C_KEPT : C_BAD;
    ctx.beginPath();
    ctx.arc(GX(area), GY(added), 5, 0, Math.PI * 2);
    ctx.fill();
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
