// Device-level figures: silicon cell generations, the layer stack of a
// record-style tandem, contact alignment, the series J–V curve, and coating a
// textured wafer.

import type { Demo } from "../../lib/demoShell";
import { KT, SI_GAP, cellVoltage, j0rad, seriesMpp, topCellSplit, type Diode } from "./physics";
import {
  C_BAD,
  C_ELEC,
  C_HEAT,
  C_HOLE,
  C_KEPT,
  C_SI,
  C_TOP,
  FAINT,
  INK,
  MUTED,
  TEXT,
  figureCanvas,
  font,
  pointerPos,
  rgba,
  roundRect,
  text,
  wrap,
} from "./draw";

// ---------------------------------------------------------------------------
// Silicon generations

interface Surface {
  // fraction of carriers that recombine when they touch this stretch of surface
  kill: number;
  color: string;
  label: string;
}

interface SiArch {
  name: string;
  era: string;
  eff: number; // typical production cell efficiency, %
  voc: number; // typical production Voc, V
  wafer: string;
  front: (x: number) => Surface; // x in 0..1 across the drawing
  rear: (x: number) => Surface;
  frontLayers: [string, string][]; // [label, color], top to bottom
  rearLayers: [string, string][];
  note: string;
}

const METAL = "#c9ccd6";
const PASSIVE = "#5fe0a8";
const finger = (x: number): boolean => ((x * 5) % 1) < 0.07; // five fingers across
const localContact = (x: number): boolean => ((x * 9 + 0.5) % 1) < 0.12;

const OK_FRONT: Surface = { kill: 0.03, color: PASSIVE, label: "SiNx passivated" };
const METAL_CONTACT: Surface = { kill: 0.9, color: C_BAD, label: "metal on silicon" };

const SI_ARCHS: SiArch[] = [
  {
    name: "Al-BSF",
    era: "1980s–2016",
    eff: 20,
    voc: 0.64,
    wafer: "p-type",
    front: (x) => (finger(x) ? METAL_CONTACT : OK_FRONT),
    rear: () => ({ kill: 0.35, color: "#ffb86b", label: "aluminium alloyed into the whole rear" }),
    frontLayers: [["SiNx anti-reflection", "#7c8cc4"], ["n+ emitter", "#9ab0ff"]],
    rearLayers: [["Al back-surface field", "#ffb86b"], ["aluminium", METAL]],
    note: "The whole rear is aluminium alloyed into the wafer. Cheap and tough, but the rear eats carriers.",
  },
  {
    name: "PERC",
    era: "2016–2023",
    eff: 23,
    voc: 0.68,
    wafer: "p-type",
    front: (x) => (finger(x) ? METAL_CONTACT : OK_FRONT),
    rear: (x) => (localContact(x) ? METAL_CONTACT : { kill: 0.02, color: PASSIVE, label: "AlOx/SiNx passivated" }),
    frontLayers: [["SiNx anti-reflection", "#7c8cc4"], ["n+ emitter", "#9ab0ff"]],
    rearLayers: [["AlOx / SiNx, opened locally", PASSIVE], ["aluminium", METAL]],
    note: "A dielectric covers the rear and the metal only touches through small openings.",
  },
  {
    name: "TOPCon",
    era: "2023–",
    eff: 25,
    voc: 0.71,
    wafer: "n-type",
    front: (x) => (finger(x) ? METAL_CONTACT : OK_FRONT),
    rear: () => ({ kill: 0.03, color: PASSIVE, label: "tunnel oxide + doped poly-Si" }),
    frontLayers: [["AlOx / SiNx", "#7c8cc4"], ["p+ emitter", "#9ab0ff"]],
    rearLayers: [["1.5 nm oxide + n+ poly-Si", PASSIVE], ["silver fingers", METAL]],
    note: "A 1.5 nm oxide under doped polysilicon passivates the whole rear and still conducts. The front fingers still touch silicon.",
  },
  {
    name: "HJT",
    era: "1990s–",
    eff: 25,
    voc: 0.74,
    wafer: "n-type",
    front: () => ({ kill: 0.02, color: PASSIVE, label: "amorphous Si passivated" }),
    rear: () => ({ kill: 0.02, color: PASSIVE, label: "amorphous Si passivated" }),
    frontLayers: [["ITO", "#64d8ff"], ["a-Si:H (i) + (n)", PASSIVE]],
    rearLayers: [["a-Si:H (i) + (p)", PASSIVE], ["ITO + silver", METAL]],
    note: "Thin amorphous silicon covers both faces, and the metal never touches the wafer. This is the usual tandem bottom cell.",
  },
];

export function mountSiliconArchitecture(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.58, 1.3);
  const { ctx, W, H, narrow, shell } = fig;
  let stage = 0;
  const buttons: HTMLButtonElement[] = [];
  SI_ARCHS.forEach((a, i) => {
    const b = shell.button(a.name, () => {
      stage = i;
      buttons.forEach((bb, j) => bb.classList.toggle("is-active", j === i));
      recent.length = 0;
    });
    buttons.push(b);
  });
  buttons[stage].classList.add("is-active");

  shell.setInfo(() => {
    const a = SI_ARCHS[stage];
    return `${a.name} (${a.era}) · typical production cell ≈ ${a.eff}% · Voc ≈ ${a.voc.toFixed(2)} V · ${a.wafer} wafer`;
  });

  // cross-section geometry
  const sx = 18;
  const sw = narrow ? W - 36 : W * 0.58;
  const sy = 40;
  const sh = narrow ? H * 0.42 : H - 80;
  const layerH = 12;
  const wTop = sy + layerH * 2 + 8;
  const wBot = sy + sh - layerH * 2;

  interface Walker {
    x: number;
    y: number;
    vx: number;
    vy: number;
  }
  const walkers: Walker[] = [];
  const spawn = (): Walker => ({
    x: Math.random(),
    y: wTop + 6 + Math.random() * (wBot - wTop - 12),
    vx: 0,
    vy: 0,
  });
  for (let i = 0; i < (narrow ? 70 : 110); i++) walkers.push(spawn());
  const flashes: { x: number; y: number; age: number; kill: boolean }[] = [];
  const recent: number[] = []; // timestamps of recombination events

  let last = performance.now();

  const drawSection = (a: SiArch, t: number): void => {
    // front stack
    let y = sy;
    for (const [, color] of a.frontLayers) {
      ctx.fillStyle = rgba(color, 0.4);
      ctx.fillRect(sx, y, sw, layerH);
      y += layerH;
    }
    // wafer
    const g = ctx.createLinearGradient(0, wTop, 0, wBot);
    g.addColorStop(0, "rgba(70, 100, 200, 0.30)");
    g.addColorStop(1, "rgba(40, 60, 140, 0.22)");
    ctx.fillStyle = g;
    ctx.fillRect(sx, wTop - 8, sw, wBot - wTop + 8);
    font(ctx, 11, 600);
    text(ctx, `${a.wafer} silicon wafer, ~160 µm`, sx + sw / 2, (wTop + wBot) / 2 + 4, "rgba(170,190,255,0.35)", "center");
    // rear stack
    y = wBot;
    for (const [, color] of a.rearLayers) {
      ctx.fillStyle = rgba(color, 0.4);
      ctx.fillRect(sx, y, sw, layerH);
      y += layerH;
    }
    // surfaces of the wafer, coloured by what they do to carriers
    for (let px = 0; px < sw; px += 2) {
      const f = a.front(px / sw);
      const r = a.rear(px / sw);
      ctx.fillStyle = rgba(f.color, f.kill > 0.5 ? 0.95 : 0.7);
      ctx.fillRect(sx + px, wTop - 9, 2, 3);
      ctx.fillStyle = rgba(r.color, r.kill > 0.5 ? 0.95 : 0.7);
      ctx.fillRect(sx + px, wBot - 2, 2, 3);
    }
    // front fingers
    if (a.name !== "HJT") {
      for (let px = 0; px < sw; px++) {
        if (finger(px / sw) && !finger((px - 1) / sw)) {
          ctx.fillStyle = METAL;
          ctx.fillRect(sx + px, sy - 8, sw * 0.07, layerH * 2 + 12);
        }
      }
    } else {
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = METAL;
        ctx.fillRect(sx + sw * (k / 5 + 0.02), sy - 8, sw * 0.04, 8);
      }
    }
    // layer names, on a backing so the fingers don't hide them
    const label = (s2: string, yy: number): void => {
      font(ctx, 10);
      const tw = ctx.measureText(s2).width;
      const lx = sx + sw - tw - 10;
      ctx.fillStyle = "rgba(6,7,11,0.72)";
      ctx.fillRect(lx - 4, yy + 1, tw + 8, layerH - 2);
      text(ctx, s2, lx, yy + 9.5, INK);
    };
    a.frontLayers.forEach(([s2], i) => label(s2, sy + i * layerH));
    a.rearLayers.forEach(([s2], i) => label(s2, wBot + i * layerH));
    // carriers
    ctx.globalCompositeOperation = "lighter";
    for (const w of walkers) {
      ctx.fillStyle = "rgba(120, 200, 255, 0.75)";
      ctx.beginPath();
      ctx.arc(sx + w.x * sw, w.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const f of flashes) {
      const k = 1 - f.age / 0.6;
      const rad = 3 + f.age * 18;
      const grd = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
      grd.addColorStop(0, `rgba(255, 120, 90, ${0.9 * k})`);
      grd.addColorStop(1, "rgba(255, 120, 90, 0)");
      ctx.fillStyle = grd;
      ctx.fillRect(f.x - rad, f.y - rad, rad * 2, rad * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    void t;
  };

  const drawChart = (): void => {
    const cx = narrow ? 44 : W * 0.66 + 22;
    const cw = narrow ? W - 62 : W * 0.34 - 36;
    const cy = narrow ? sy + sh + 92 : 56;
    const ch = narrow ? H - cy - 40 : H - 128;
    const Y = (v: number): number => cy + ch - (v / 32) * ch;
    font(ctx, 11, 600);
    text(ctx, "typical production cell, % (and Voc)", cx - 30, cy - 14, TEXT);
    font(ctx, 10, 400, true);
    for (let v = 0; v <= 30; v += 10) {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(cx, Y(v), cw, 1);
      text(ctx, `${v}`, cx - 5, Y(v) + 3, MUTED, "right");
    }
    // silicon's own ceiling
    ctx.strokeStyle = rgba(C_HEAT, 0.8);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, Y(29.4));
    ctx.lineTo(cx + cw, Y(29.4));
    ctx.stroke();
    ctx.setLineDash([]);
    font(ctx, 10);
    text(ctx, "silicon limit 29.4%", cx + cw, Y(29.4) - 4, C_HEAT, "right");
    const bw = cw / SI_ARCHS.length;
    SI_ARCHS.forEach((a, i) => {
      const x = cx + i * bw + bw * 0.18;
      const w = bw * 0.64;
      ctx.fillStyle = i === stage ? rgba(C_SI, 0.85) : rgba(C_SI, 0.28);
      roundRect(ctx, x, Y(a.eff), w, Y(0) - Y(a.eff), 3);
      ctx.fill();
      font(ctx, 10, i === stage ? 700 : 400);
      text(ctx, a.name, x + w / 2, Y(0) + 13, i === stage ? INK : MUTED, "center");
      font(ctx, 9, 400, true);
      text(ctx, `${a.voc.toFixed(2)} V`, x + w / 2, Y(0) + 25, i === stage ? C_KEPT : MUTED, "center");
      font(ctx, 10, 600, true);
      text(ctx, `${a.eff}`, x + w / 2, Y(a.eff) - 4, i === stage ? INK : MUTED, "center");
    });
  };

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const a = SI_ARCHS[stage];
      // random walk: carriers diffuse until they reach a surface that eats them
      for (let i = 0; i < walkers.length; i++) {
        const w = walkers[i];
        // a correlated random walk, scaled to the frame time
        const f = dt * 60;
        w.vx = w.vx * 0.8 + (Math.random() - 0.5) * 0.012 * f;
        w.vy = w.vy * 0.8 + (Math.random() - 0.5) * 6 * f;
        w.x += w.vx * f;
        w.y += w.vy * f;
        if (w.x < 0) w.x += 1;
        if (w.x > 1) w.x -= 1;
        const hitTop = w.y < wTop - 6;
        const hitBot = w.y > wBot - 2;
        if (hitTop || hitBot) {
          const s = hitTop ? a.front(w.x) : a.rear(w.x);
          if (Math.random() < s.kill) {
            flashes.push({ x: sx + w.x * sw, y: w.y, age: 0, kill: true });
            recent.push(now);
            walkers[i] = spawn();
            continue;
          }
          w.y = hitTop ? wTop - 6 : wBot - 2;
          w.vy = -w.vy;
        }
      }
      for (const f of flashes) f.age += dt;
      while (flashes.length && flashes[0].age > 0.6) flashes.shift();
      while (recent.length && now - recent[0] > 3000) recent.shift();

      fig.begin();
      drawSection(a, now);
      font(ctx, 11);
      wrap(ctx, a.note, sx, sy + sh + 18, sw, 15, MUTED);
      font(ctx, 10, 400, true);
      text(ctx, `surface recombination flashes: ${(recent.length / 3).toFixed(0)} /s`, sx + sw, sy - 14, C_BAD, "right");
      drawChart();
      shell.tick();
    },
  };
}

// ---------------------------------------------------------------------------
// The layer stack

interface Layer {
  name: string;
  nm: number;
  color: string;
  job: string;
  cost: string;
}

const STACK: Layer[] = [
  { name: "MgF₂", nm: 100, color: "#a6b4d8", job: "Anti-reflection coating. Cuts the light the front bounces away.", cost: "One more vacuum step." },
  { name: "IZO", nm: 70, color: "#64d8ff", job: "Transparent conductor. Carries current sideways to the silver grid.", cost: "Absorbs some infrared, and sputtering it can damage the soft layers below." },
  { name: "SnOₓ", nm: 20, color: "#7fb0c8", job: "Buffer grown atom by atom (ALD). Shields the layers below from sputter damage.", cost: "A slow deposition step." },
  { name: "C₆₀", nm: 18, color: "#4fd8ff", job: "Electron contact. Lets electrons out of the perovskite and blocks holes.", cost: "Absorbs blue light, and its interface with the perovskite is one of the biggest voltage losses." },
  { name: "LiF", nm: 1, color: "#d0e4ff", job: "Interlayer about a nanometre thick. Reduces recombination at the C₆₀ contact.", cost: "So thin that uniformity over a whole wafer is hard to control." },
  { name: "perovskite", nm: 500, color: C_TOP, job: "Top absorber, about 1.68 eV. Takes the photons above its gap.", cost: "Sensitive to moisture, heat and light; mixed halides can separate." },
  { name: "SAM", nm: 1.5, color: C_HOLE, job: "Hole contact, one molecule thick (e.g. Me-4PACz). Takes holes, blocks electrons.", cost: "Has to cover every facet of the textured surface." },
  { name: "ITO", nm: 20, color: "#ffcf62", job: "Recombination layer. Holes from the perovskite meet electrons from the silicon here.", cost: "Spreads current sideways, so one local shunt can drain a wider area." },
  { name: "nc-Si (n) / a-Si (i)", nm: 25, color: PASSIVE, job: "Passivates the silicon's front surface and forms its electron contact.", cost: "Damaged above about 200 °C, which limits every later process step." },
  { name: "c-Si wafer", nm: 160000, color: C_SI, job: "Bottom absorber, 1.12 eV. Takes the red and near-infrared light the top passes on.", cost: "About 320× thicker than the perovskite; most of the stack's material." },
  { name: "a-Si (i) / a-Si (p)", nm: 15, color: PASSIVE, job: "Passivates the rear surface and forms the hole contact.", cost: "Same temperature limit as the front." },
  { name: "ITO + silver", nm: 300, color: METAL, job: "Rear electrode and mirror. Sends unabsorbed infrared back through the wafer.", cost: "Silver is a large share of the cell's material cost." },
];

export function mountLayerStack(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.66, 1.75);
  const { ctx, W, H, narrow, shell } = fig;
  let sel = 5;
  let dirty = true;

  const slider = shell.slider({
    label: "Layer",
    min: 0,
    max: STACK.length - 1,
    step: 1,
    value: sel,
    format: (v) => STACK[Math.round(v)].name,
    onInput: (v) => {
      sel = Math.round(v);
      dirty = true;
    },
  });
  shell.setInfo(() => {
    const total = STACK.reduce((a, l) => a + l.nm, 0);
    const thin = STACK.filter((l) => l.name !== "c-Si wafer").reduce((a, l) => a + l.nm, 0);
    return `${STACK.length} layers · ${(total / 1000).toFixed(1)} µm in all · everything but the wafer is ${(thin / 1000).toFixed(2)} µm`;
  });

  // log-scaled heights so nanometre layers are visible next to the wafer
  const x0 = narrow ? 16 : 26;
  const sw = narrow ? W * 0.5 : W * 0.38;
  const y0 = 36;
  const avail = narrow ? H * 0.6 : H - 64;
  const raw = STACK.map((l) => 7 + Math.log10(l.nm + 1) * 6);
  const scale = avail / raw.reduce((a, b) => a + b, 0);
  const heights = raw.map((r) => r * scale);
  const tops: number[] = [];
  {
    let y = y0;
    for (const h of heights) {
      tops.push(y);
      y += h;
    }
  }

  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = pointerPos(shell.canvas, e, W);
    if (p.x < x0 || p.x > x0 + sw + 170) return;
    for (let i = 0; i < STACK.length; i++) {
      if (p.y >= tops[i] && p.y < tops[i] + heights[i]) {
        sel = i;
        slider.value = String(i);
        slider.dispatchEvent(new Event("input"));
      }
    }
  });

  const draw = (): void => {
    fig.begin();
    font(ctx, 11, 600);
    text(ctx, "sunlight", x0, 18, TEXT);
    ctx.fillStyle = "rgba(255, 224, 138, 0.7)";
    for (let k = 0; k < 6; k++) {
      const x = x0 + 70 + k * ((sw - 80) / 5);
      ctx.fillRect(x, 10, 1.5, 16);
      ctx.beginPath();
      ctx.moveTo(x - 3, 23);
      ctx.lineTo(x + 4.5, 23);
      ctx.lineTo(x + 0.75, 29);
      ctx.fill();
    }
    STACK.forEach((l, i) => {
      const y = tops[i];
      const h = heights[i] - 1;
      const on = i === sel;
      ctx.fillStyle = rgba(l.color, on ? 0.75 : 0.32);
      ctx.fillRect(x0, y, sw, h);
      if (on) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 0.75, y + 0.75, sw - 1.5, h - 1.5);
      }
      font(ctx, 11, on ? 700 : 400);
      text(ctx, l.name, x0 + sw + 10, y + h / 2 + 4, on ? INK : TEXT);
      const nmText = l.nm >= 1000 ? `${(l.nm / 1000).toFixed(0)} µm` : `${l.nm} nm`;
      font(ctx, 10, 400, true);
      text(ctx, nmText, x0 + sw - 6, y + h / 2 + 3.5, on ? "#0b0d14" : MUTED, "right");
    });
    // brackets for the two cells
    const bracket = (a: number, b: number, label: string, color: string): void => {
      const x = x0 - 8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, tops[a]);
      ctx.lineTo(x, tops[a]);
      ctx.lineTo(x, tops[b] + heights[b]);
      ctx.lineTo(x + 4, tops[b] + heights[b]);
      ctx.stroke();
      ctx.save();
      ctx.translate(x - 5, (tops[a] + tops[b] + heights[b]) / 2);
      ctx.rotate(-Math.PI / 2);
      font(ctx, 10, 600);
      text(ctx, label, 0, 0, color, "center");
      ctx.restore();
    };
    if (!narrow) {
      bracket(3, 6, "top cell", C_TOP);
      bracket(8, 10, "bottom cell", C_SI);
    }
    font(ctx, 10);
    text(ctx, "heights on a log scale", x0, y0 + avail + 18, MUTED);

    // details for the selected layer
    const l = STACK[sel];
    const dx = narrow ? 16 : x0 + sw + 160;
    const dw = narrow ? W - 32 : W - dx - 18;
    let dy = narrow ? y0 + avail + 44 : 64;
    ctx.fillStyle = rgba(l.color, 0.9);
    ctx.fillRect(dx, dy - 12, 4, 16);
    font(ctx, 15, 700);
    text(ctx, l.name, dx + 12, dy + 2, INK);
    dy += 22;
    font(ctx, 11, 600, true);
    text(ctx, l.nm >= 1000 ? `${l.nm / 1000} µm thick` : `${l.nm} nm thick`, dx, dy, C_KEPT);
    dy += 22;
    font(ctx, 10, 700);
    text(ctx, "JOB", dx, dy, MUTED);
    dy += 16;
    font(ctx, 13);
    dy = wrap(ctx, l.job, dx, dy, dw, 18, TEXT) + 8;
    font(ctx, 10, 700);
    text(ctx, "SIDE EFFECT", dx, dy, MUTED);
    dy += 16;
    font(ctx, 13);
    dy = wrap(ctx, l.cost, dx, dy, dw, 18, TEXT) + 22;

    // the same stack to scale, as one bar: the thin films are a sliver
    const total = STACK.reduce((a, x) => a + x.nm, 0);
    if (dy + 50 < H) {
      font(ctx, 10, 700);
      text(ctx, "TO SCALE", dx, dy, MUTED);
      dy += 10;
      let bx = dx;
      for (const x of STACK) {
        const w = (x.nm / total) * dw;
        ctx.fillStyle = rgba(x.color, x === l ? 0.95 : 0.55);
        ctx.fillRect(bx, dy, Math.max(w, x === l ? 1.5 : 0), 14);
        bx += w;
      }
      font(ctx, 11);
      const thin = total - 160000;
      wrap(ctx, `Everything except the wafer is the ${((thin / total) * 100).toFixed(1)}% sliver at the left end.`, dx, dy + 30, dw, 16, MUTED);
    }
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
// Contact alignment

export function mountBandAlignment(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.56, 1.35);
  const { ctx, W, H, narrow, shell } = fig;
  let offset = 0.0; // hole-contact level minus perovskite valence band, eV (positive = shallower)
  const VOC0 = 1.25; // V, a good 1.68 eV top cell with a well-aligned contact
  const JSC = 20; // mA/cm²
  const JX = 2e4; // mA/cm², extraction current scale for the Boltzmann barrier

  shell.slider({
    label: "Hole contact offset",
    min: -0.35,
    max: 0.35,
    step: 0.01,
    value: offset,
    format: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} eV`,
    onInput: (v) => (offset = v),
  });

  const model = (): { voc: number; barrier: number; jlim: number; ff: number; pmax: number; curve: [number, number][] } => {
    const loss = Math.max(0, offset);
    const barrier = Math.max(0, -offset);
    const voc = VOC0 - loss;
    const j0 = JSC / Math.expm1(voc / (1.3 * KT));
    // a barrier only lets holes over at a Boltzmann rate: J_lim = J_x · exp(−b/kT)
    const jlim = JX * Math.exp(-barrier / KT);
    const curve: [number, number][] = [];
    let pmax = 0;
    for (let k = 0; k <= 160; k++) {
      const v = (k / 160) * voc;
      const jd = JSC - j0 * Math.expm1(v / (1.3 * KT));
      const j = jd > 0 ? (jd * jlim) / (jd + jlim) : jd;
      curve.push([v, j]);
      pmax = Math.max(pmax, v * j);
    }
    const jsc = curve[0][1];
    return { voc, barrier, jlim, ff: pmax / (voc * jsc), pmax, curve };
  };

  const aligned = (() => {
    const keep = offset;
    offset = 0;
    const p = model().pmax;
    offset = keep;
    return p;
  })();

  shell.setInfo(() => {
    const m = model();
    const what =
      offset > 0.02
        ? `holes drop ${offset.toFixed(2)} eV into the contact, Voc ${m.voc.toFixed(2)} V`
        : offset < -0.02
          ? `holes climb a ${m.barrier.toFixed(2)} eV step, current ${m.curve[0][1].toFixed(1)} of ${JSC} mA/cm²`
          : "aligned";
    return `${what} · top cell ${m.pmax.toFixed(1)} mW/cm² (aligned: ${aligned.toFixed(1)})`;
  });

  // animated holes heading for the contact
  const holes: { x: number; y: number; v: number; stuck: number }[] = [];
  let last = performance.now();

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = model();
      fig.begin();

      const dx = 46;
      const dw = narrow ? W - 64 : W * 0.6 - 46;
      const top = 40;
      const dh = narrow ? H * 0.5 : H - 80;
      // regions: electron contact | perovskite | hole contact
      const r0 = dx;
      const r1 = dx + dw * 0.2;
      const r2 = dx + dw * 0.8;
      const r3 = dx + dw;
      const E = (ev: number): number => top + dh * 0.5 - ev * dh * 0.32; // 0 = mid-gap of the perovskite
      const cb = 0.84;
      const vb = -0.84;
      ctx.fillStyle = rgba(C_ELEC, 0.07);
      ctx.fillRect(r0, top, r1 - r0, dh);
      ctx.fillStyle = rgba(C_TOP, 0.07);
      ctx.fillRect(r1, top, r2 - r1, dh);
      ctx.fillStyle = rgba(C_HOLE, 0.07);
      ctx.fillRect(r2, top, r3 - r2, dh);
      font(ctx, 11, 600);
      text(ctx, "C₆₀", (r0 + r1) / 2, top + dh + 16, C_ELEC, "center");
      text(ctx, "perovskite, 1.68 eV", (r1 + r2) / 2, top + dh + 16, C_TOP, "center");
      text(ctx, "SAM", (r2 + r3) / 2, top + dh + 16, C_HOLE, "center");

      const level = (x0: number, x1: number, ev: number, color: string, w = 2): void => {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x0, E(ev));
        ctx.lineTo(x1, E(ev));
        ctx.stroke();
      };
      // perovskite bands
      level(r1, r2, cb, INK);
      level(r1, r2, vb, INK);
      font(ctx, 10);
      text(ctx, "conduction band", r1 + 6, E(cb) - 6, MUTED);
      text(ctx, "valence band", r1 + 6, E(vb) + 14, MUTED);
      // contact transport levels: electron level fixed slightly below the CB,
      // hole level set by the slider (positive = above the VB)
      const eLevel = cb - 0.1;
      const hLevel = vb + offset;
      level(r0, r1, eLevel, C_ELEC, 3);
      level(r2, r3, hLevel, C_HOLE, 3);
      // quasi-Fermi levels at the contacts set the voltage
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = rgba(C_KEPT, 0.8);
      ctx.lineWidth = 1.2;
      // quasi-Fermi levels sit inside the gap; the hole one can't go below the
      // contact's level, so a drop pulls it (and the voltage) up with it
      const margin = (cb - vb - VOC0) / 2;
      const efn = cb - margin;
      const efp = Math.max(vb, hLevel) + margin;
      ctx.beginPath();
      ctx.moveTo(r0, E(efn) + 0.5);
      ctx.lineTo(r2 - 20, E(efn) + 0.5);
      ctx.moveTo(r1 + 20, E(efp));
      ctx.lineTo(r3, E(efp));
      ctx.stroke();
      ctx.setLineDash([]);
      font(ctx, 10);
      text(ctx, "quasi-Fermi levels", r1 + 24, E(efn) + 14, rgba(C_KEPT, 0.8));
      text(ctx, "contact level", r3 - 4, E(hLevel) + 14, C_HOLE, "right");
      text(ctx, "contact", r0 + 4, E(eLevel) + 14, C_ELEC);
      // voltage arrow
      const ax = r2 + (r3 - r2) * 0.5;
      ctx.strokeStyle = C_KEPT;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, E(efn) + 4);
      ctx.lineTo(ax, E(efp) - 4);
      ctx.stroke();
      font(ctx, 11, 600, true);
      text(ctx, `${m.voc.toFixed(2)} V`, ax + 6, (E(efn) + E(efp)) / 2, C_KEPT);
      // highlight the offset
      if (Math.abs(offset) > 0.02) {
        const yA = E(vb);
        const yB = E(hLevel);
        ctx.fillStyle = offset > 0 ? rgba(C_HEAT, 0.25) : rgba(C_BAD, 0.25);
        ctx.fillRect(r2 - 3, Math.min(yA, yB), 6, Math.abs(yB - yA));
        font(ctx, 10, 600);
        text(ctx, offset > 0 ? `holes lose ${offset.toFixed(2)} eV` : `barrier ${(-offset).toFixed(2)} eV`, r2 - 8, E(vb) + (offset > 0 ? -28 : 30), offset > 0 ? C_HEAT : C_BAD, "right");
      }

      // holes: drift toward the hole contact along the valence band
      if (holes.length < 14 && Math.random() < dt * 5) holes.push({ x: r1 + 8 + Math.random() * (r2 - r1) * 0.6, y: E(vb), v: 45 + Math.random() * 25, stuck: 0 });
      const pass = Math.min(1, m.jlim / JSC);
      for (let i = holes.length - 1; i >= 0; i--) {
        const h = holes[i];
        if (h.x < r2 - 4) {
          h.x += h.v * dt;
          h.y = E(vb);
        } else if (h.x < r2 + 2) {
          // at the interface: a barrier holds most holes back, an offset lets them drop
          if (Math.random() < pass * dt * 20 + (offset >= 0 ? 1 : 0)) h.x = r2 + 3;
          else h.stuck += dt;
          if (h.stuck > 2.5) {
            holes.splice(i, 1);
            continue;
          }
        } else {
          h.x += h.v * dt * 1.4;
          h.y += (E(hLevel) - h.y) * Math.min(1, dt * 10);
          if (h.x > r3 - 6) {
            holes.splice(i, 1);
            continue;
          }
        }
        ctx.fillStyle = h.stuck > 0.3 ? "rgba(255,106,90,0.9)" : rgba(C_HOLE, 0.95);
        ctx.beginPath();
        ctx.arc(h.x - (h.stuck > 0 ? (i % 4) * 5 : 0), h.y + (h.stuck > 0 ? Math.sin(now * 0.02 + i) * 1.5 : 0), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // J–V curve of the top cell
      const px = narrow ? 50 : W * 0.66 + 26;
      const pw = narrow ? W - 66 : W * 0.34 - 40;
      const py = narrow ? top + dh + 52 : 52;
      const ph = narrow ? H - py - 34 : H - 110;
      const X = (v: number): number => px + (v / 1.4) * pw;
      const Y = (j: number): number => py + ph - (j / 22) * ph;
      ctx.strokeStyle = FAINT;
      ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
      font(ctx, 10, 400, true);
      for (const v of [0, 0.5, 1.0]) text(ctx, v.toFixed(1), X(v), py + ph + 13, MUTED, "center");
      for (const j of [0, 10, 20]) text(ctx, `${j}`, px - 4, Y(j) + 3, MUTED, "right");
      font(ctx, 11, 600);
      text(ctx, "top-cell J–V", px, py - 8, TEXT);
      font(ctx, 10);
      text(ctx, "volts", px + pw, py + ph + 26, MUTED, "right");
      // the aligned reference
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      {
        const j0 = JSC / Math.expm1(VOC0 / (1.3 * KT));
        for (let k = 0; k <= 80; k++) {
          const v = (k / 80) * VOC0;
          const j = JSC - j0 * Math.expm1(v / (1.3 * KT));
          k ? ctx.lineTo(X(v), Y(j)) : ctx.moveTo(X(v), Y(j));
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = C_TOP;
      ctx.lineWidth = 2;
      ctx.beginPath();
      m.curve.forEach(([v, j], k) => (k ? ctx.lineTo(X(v), Y(Math.max(0, j))) : ctx.moveTo(X(v), Y(Math.max(0, j)))));
      ctx.stroke();
      shell.tick();
    },
  };
}

// ---------------------------------------------------------------------------
// The series J–V curve

export const TOP_GAP = 1.68;
const BOTTOM_LOSS = 0.13; // V of non-radiative loss in a good HJT bottom cell

export function tandemCells(thicknessNm: number, topLossV: number, rs: number): { top: Diode; bot: Diode } {
  const split = topCellSplit(TOP_GAP, thicknessNm);
  const top: Diode = { jsc: split.jTop, j0: j0rad(TOP_GAP) * Math.exp(topLossV / KT), rs, rsh: 5000 };
  const bot: Diode = { jsc: split.jPass, j0: j0rad(SI_GAP) * Math.exp(BOTTOM_LOSS / KT), rs: 0, rsh: 20000 };
  return { top, bot };
}

export function mountTandemJV(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.6, 1.2);
  const { ctx, W, H, narrow, shell } = fig;
  let thick = 500;
  let topLoss = 0.15;
  let rs = 2;
  let dirty = true;

  shell.slider({
    label: "Perovskite thickness",
    min: 200,
    max: 1000,
    step: 10,
    value: thick,
    format: (v) => `${v.toFixed(0)} nm`,
    onInput: (v) => {
      thick = v;
      dirty = true;
    },
  });
  shell.slider({
    label: "Top-cell voltage loss",
    min: 0.05,
    max: 0.4,
    step: 0.01,
    value: topLoss,
    format: (v) => `${Math.round(v * 1000)} mV`,
    onInput: (v) => {
      topLoss = v;
      dirty = true;
    },
  });
  shell.slider({
    label: "Series resistance",
    min: 0,
    max: 8,
    step: 0.1,
    value: rs,
    format: (v) => `${v.toFixed(1)} Ω·cm²`,
    onInput: (v) => {
      rs = v;
      dirty = true;
    },
  });

  const solve = () => {
    const { top, bot } = tandemCells(thick, topLoss, rs);
    const stack = seriesMpp([top, bot]);
    return { top, bot, stack, mTop: seriesMpp([top]), mBot: seriesMpp([bot]) };
  };

  shell.setInfo(() => {
    const s = solve();
    const lim = Math.abs(s.top.jsc - s.bot.jsc) < 0.25 ? "matched" : s.top.jsc < s.bot.jsc ? "perovskite-limited" : "silicon-limited";
    return `perovskite ${s.mTop.jsc.toFixed(1)} / silicon ${s.mBot.jsc.toFixed(1)} mA/cm² (${lim}) · stack Voc ${s.stack.voc.toFixed(2)} V · FF ${(s.stack.ff * 100).toFixed(0)}% · ${s.stack.pmax.toFixed(1)}%`;
  });

  const draw = (): void => {
    fig.begin();
    const s = solve();
    const px = 48;
    const pw = narrow ? W - 64 : W * 0.64 - 48;
    const py = 30;
    const ph = narrow ? H * 0.55 : H - 76;
    const vMax = 2.1;
    const jMax = 24;
    const X = (v: number): number => px + (v / vMax) * pw;
    const Y = (j: number): number => py + ph - (j / jMax) * ph;
    ctx.strokeStyle = FAINT;
    ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
    font(ctx, 10, 400, true);
    for (let v = 0; v <= 2.0001; v += 0.5) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(X(v), py, 1, ph);
      text(ctx, v.toFixed(1), X(v), py + ph + 14, MUTED, "center");
    }
    for (let j = 0; j <= 20; j += 5) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(px, Y(j), pw, 1);
      text(ctx, `${j}`, px - 5, Y(j) + 3, MUTED, "right");
    }
    font(ctx, 10);
    text(ctx, "voltage, V", px + pw, py + ph + 28, MUTED, "right");
    ctx.save();
    ctx.translate(14, py + ph / 2);
    ctx.rotate(-Math.PI / 2);
    text(ctx, "current, mA/cm²", 0, 0, MUTED, "center");
    ctx.restore();

    const curve = (cells: Diode[], color: string, width: number): void => {
      const jTop = Math.max(...cells.map((c) => c.jsc)) * 1.05;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let prevV = 0;
      let prevJ = 0;
      for (let k = 0; k <= 400; k++) {
        const j = (k / 400) * jTop;
        const v = cells.reduce((a, c) => a + cellVoltage(c, j), 0);
        if (v < 0) {
          // finish the curve on the current axis, interpolating where V crosses zero
          const jz = prevJ + ((j - prevJ) * prevV) / (prevV - v || 1);
          ctx.lineTo(X(0), Y(jz));
          break;
        }
        k ? ctx.lineTo(X(v), Y(j)) : ctx.moveTo(X(v), Y(j));
        prevV = v;
        prevJ = j;
      }
      ctx.stroke();
    };
    curve([s.bot], rgba(C_SI, 0.9), 1.6);
    curve([s.top], rgba(C_TOP, 0.9), 1.6);
    ctx.shadowColor = "rgba(255,255,255,0.6)";
    ctx.shadowBlur = 6;
    curve([s.top, s.bot], INK, 2.4);
    ctx.shadowBlur = 0;

    // max power rectangle
    const m = s.stack;
    ctx.fillStyle = rgba(C_KEPT, 0.12);
    ctx.fillRect(X(0), Y(m.jmp), X(m.vmp) - X(0), Y(0) - Y(m.jmp));
    ctx.strokeStyle = rgba(C_KEPT, 0.7);
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(X(0), Y(m.jmp), X(m.vmp) - X(0), Y(0) - Y(m.jmp));
    ctx.setLineDash([]);
    ctx.fillStyle = C_KEPT;
    ctx.beginPath();
    ctx.arc(X(m.vmp), Y(m.jmp), 4, 0, Math.PI * 2);
    ctx.fill();

    // labels at each curve's open-circuit end
    font(ctx, 11, 600);
    text(ctx, "silicon", X(s.mBot.voc) - 4, Y(s.bot.jsc * 0.35), C_SI, "right");
    text(ctx, "perovskite", X(s.mTop.voc) - 4, Y(s.top.jsc * 0.2), C_TOP, "right");
    text(ctx, "stack", X(m.voc) - 4, Y(m.jsc * 0.45), INK, "right");

    // a small table of the three cells
    const tx = narrow ? 16 : W * 0.68;
    let ty = narrow ? py + ph + 52 : 48;
    const cols = narrow ? [tx, tx + 92, tx + 152, tx + 212, tx + 262] : [tx, tx + 80, tx + 132, tx + 176, tx + 214];
    font(ctx, 10, 700);
    ["", "Jsc", "Voc", "FF", "η"].forEach((h, i) => text(ctx, h, cols[i], ty, MUTED));
    ty += 20;
    for (const [name, mm, color] of [
      ["perovskite", s.mTop, C_TOP],
      ["silicon", s.mBot, C_SI],
      ["stack", m, INK],
    ] as const) {
      font(ctx, 11, 600);
      text(ctx, name, cols[0], ty, color);
      font(ctx, 11, 400, true);
      text(ctx, mm.jsc.toFixed(1), cols[1], ty, TEXT);
      text(ctx, mm.voc.toFixed(2), cols[2], ty, TEXT);
      text(ctx, `${Math.round(mm.ff * 100)}`, cols[3], ty, TEXT);
      text(ctx, `${mm.pmax.toFixed(1)}`, cols[4], ty, name === "stack" ? C_KEPT : TEXT);
      ty += 19;
    }
    font(ctx, 10);
    ty = wrap(ctx, "subcells measured alone, under the light each gets in the stack", tx, ty + 4, W - tx - 16, 13, MUTED) + 10;
    const gap = s.mTop.jsc - s.mBot.jsc;
    font(ctx, 12);
    const msg =
      Math.abs(gap) < 0.25
        ? "The currents match, so neither cell is pushed off its best operating point."
        : gap < 0
          ? `The perovskite makes ${(-gap).toFixed(1)} mA/cm² less than the silicon, and the whole stack runs at its current. A thicker top cell would take more light.`
          : `The perovskite is taking ${gap.toFixed(1)} mA/cm² more than the silicon gets, so the silicon sets the current. A thinner top cell would pass more light down.`;
    if (!narrow) wrap(ctx, msg, tx, ty, W - tx - 16, 17, TEXT);
    else wrap(ctx, msg, tx, ty, W - 32, 16, TEXT);
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
// Coating a textured wafer

export function mountTextureCoating(container: HTMLElement): Demo {
  const fig = figureCanvas(container, 0.52, 1.1);
  const { ctx, W, H, narrow, shell } = fig;
  let pyramidUm = 2;
  let filmNm = 600;
  let conformal = false;
  let dirty = true;

  shell.slider({
    label: "Pyramid height",
    min: 0,
    max: 4,
    step: 0.1,
    value: pyramidUm,
    format: (v) => (v < 0.05 ? "flat (polished)" : `${v.toFixed(1)} µm`),
    onInput: (v) => {
      pyramidUm = v;
      dirty = true;
    },
  });
  shell.slider({
    label: "Film thickness",
    min: 300,
    max: 1200,
    step: 10,
    value: filmNm,
    format: (v) => `${v.toFixed(0)} nm`,
    onInput: (v) => {
      filmNm = v;
      dirty = true;
    },
  });
  const methodBtn = shell.button("solution (spin / slot-die)", () => {
    conformal = !conformal;
    methodBtn.textContent = conformal ? "conformal (evaporated)" : "solution (spin / slot-die)";
    dirty = true;
  });

  // a fixed random row of pyramids; heights scale with the slider. Alkaline
  // etching exposes {111} facets at 54.7° to the wafer surface.
  const FACET = (54.7 * Math.PI) / 180;
  const SLOPE = Math.tan(FACET);
  const sizes: number[] = [];
  {
    let seed = 11;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) sizes.push(0.45 + rnd() * 0.75);
  }
  const N = 600;
  const profile = new Float64Array(N); // silicon surface height, µm, over a span in µm
  const film = new Float64Array(N); // film top surface, µm

  // layout: equal vertical and horizontal scale so the facet angles are true;
  // the span of wafer shown is whatever fits the width at that scale
  const gx = 20;
  const gw = W - 40;
  const top = narrow ? 70 : 60;
  const base = narrow ? H - 70 : H - 56;
  const layout = (): { s: number; L: number } => {
    const zMax = pyramidUm + filmNm / 1000 + 0.6;
    const s = Math.min(gw / 10, (base - top) / Math.max(zMax, 1.5));
    return { s, L: gw / s };
  };
  const span = (): number => layout().L;

  const build = (): { bare: number; minT: number; maxT: number } => {
    const L = span();
    // pyramids of random size side by side
    let x = 0;
    let k = 0;
    const peaks: [number, number][] = []; // [center, height]
    while (x < L + 4) {
      const h = pyramidUm * sizes[k++ % sizes.length];
      const half = h / SLOPE;
      peaks.push([x + half, h]);
      x += 2 * half + 0.01;
      if (pyramidUm < 0.05) break;
    }
    for (let i = 0; i < N; i++) {
      const xi = (i / (N - 1)) * L;
      let s = 0;
      for (const [c, h] of peaks) s = Math.max(s, h - Math.abs(xi - c) * SLOPE);
      profile[i] = pyramidUm < 0.05 ? 0 : s;
    }
    const d = filmNm / 1000;
    if (conformal) {
      // same thickness measured normal to the surface everywhere: the film's top
      // is the silicon surface grown outward by d (a Minkowski sum with a disc)
      const dx = L / (N - 1);
      const win = Math.ceil(d / dx);
      for (let i = 0; i < N; i++) {
        let top = profile[i] + d;
        for (let k = -win; k <= win; k++) {
          const j = i + k;
          if (j < 0 || j >= N) continue;
          const off = k * dx;
          const h = d * d - off * off;
          if (h > 0) top = Math.max(top, profile[j] + Math.sqrt(h));
        }
        film[i] = top;
      }
    } else {
      // a wet film levels out: find the flat surface level that holds the same volume
      let lo = 0;
      let hi = pyramidUm + d + 1;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2;
        let vol = 0;
        for (let i = 0; i < N; i++) vol += Math.max(0, mid - profile[i]);
        if (vol / N > d) hi = mid;
        else lo = mid;
      }
      for (let i = 0; i < N; i++) film[i] = Math.max(profile[i], lo);
    }
    let bare = 0;
    let minT = Infinity;
    let maxT = 0;
    for (let i = 0; i < N; i++) {
      const t = film[i] - profile[i];
      if (t < 0.05) bare++;
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }
    return { bare: bare / N, minT, maxT };
  };

  shell.setInfo(() => {
    const r = build();
    if (r.bare > 0) return `${Math.round(r.bare * 100)}% of the surface left uncoated: shunt paths at the pyramid tips · thickest point ${(r.maxT * 1000).toFixed(0)} nm`;
    return `fully covered · film ${(r.minT * 1000).toFixed(0)}–${(r.maxT * 1000).toFixed(0)} nm thick (vertical)`;
  });

  const draw = (): void => {
    const r = build();
    fig.begin();
    const { s, L } = layout();
    const X = (um: number): number => gx + um * s;
    const Z = (um: number): number => base - um * s;

    // silicon
    ctx.beginPath();
    ctx.moveTo(X(0), H);
    for (let i = 0; i < N; i++) ctx.lineTo(X((i / (N - 1)) * L), Z(profile[i]));
    ctx.lineTo(X(L), H);
    ctx.closePath();
    const gs = ctx.createLinearGradient(0, Z(pyramidUm), 0, H);
    gs.addColorStop(0, "rgba(90, 120, 220, 0.55)");
    gs.addColorStop(1, "rgba(40, 60, 140, 0.35)");
    ctx.fillStyle = gs;
    ctx.fill();

    // perovskite film between the silicon and its own top surface
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = X((i / (N - 1)) * L);
      i ? ctx.lineTo(x, Z(film[i])) : ctx.moveTo(x, Z(film[i]));
    }
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(X((i / (N - 1)) * L), Z(profile[i]));
    ctx.closePath();
    ctx.fillStyle = rgba(C_TOP, 0.55);
    ctx.fill();
    ctx.strokeStyle = rgba(C_TOP, 0.95);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = X((i / (N - 1)) * L);
      i ? ctx.lineTo(x, Z(film[i])) : ctx.moveTo(x, Z(film[i]));
    }
    ctx.stroke();

    // bare tips: where the top contact would land straight on silicon
    for (let i = 0; i < N; i++) {
      if (film[i] - profile[i] < 0.05) {
        const x = X((i / (N - 1)) * L);
        ctx.fillStyle = "rgba(255, 106, 90, 0.95)";
        ctx.fillRect(x - 1, Z(profile[i]) - 3, 2.5, 5);
      }
    }

    // a few light rays. A vertical ray meets a 54.7° facet, part of it refracts
    // into the silicon and part reflects down and sideways into the next pyramid.
    if (pyramidUm >= 0.05) {
      const dxu = L / (N - 1);
      const surf = (xu: number): number => {
        const i = Math.max(0, Math.min(N - 1, Math.round(xu / dxu)));
        return profile[i];
      };
      for (let k = 0; k < 6; k++) {
        const xr = L * (0.1 + k * 0.155);
        const i = Math.round(xr / dxu);
        const zHit = profile[i];
        const slope = (profile[Math.min(N - 1, i + 1)] - profile[Math.max(0, i - 1)]) / (2 * dxu);
        const th = Math.atan(slope);
        // outward normal of the facet and the vertical incoming direction
        const nx = -Math.sin(th);
        const nz = Math.cos(th);
        const dX = 0;
        const dZ = -1;
        const cosi = -(dX * nx + dZ * nz);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "rgba(255, 224, 138, 0.8)";
        ctx.beginPath();
        ctx.moveTo(X(xr), top - 24);
        ctx.lineTo(X(xr), Z(zHit));
        ctx.stroke();
        // refracted into silicon (perovskite n ≈ 2.4 → silicon n ≈ 3.6)
        const eta = 2.4 / 3.6;
        const k2 = 1 - eta * eta * (1 - cosi * cosi);
        const tX = eta * dX + (eta * cosi - Math.sqrt(k2)) * nx;
        const tZ = eta * dZ + (eta * cosi - Math.sqrt(k2)) * nz;
        ctx.strokeStyle = "rgba(255, 224, 138, 0.45)";
        ctx.beginPath();
        ctx.moveTo(X(xr), Z(zHit));
        ctx.lineTo(X(xr + tX * pyramidUm * 0.6), Z(zHit + tZ * pyramidUm * 0.6));
        ctx.stroke();
        // reflected: march until it meets the surface again
        const rX = dX - 2 * (dX * nx + dZ * nz) * nx;
        const rZ = dZ - 2 * (dX * nx + dZ * nz) * nz;
        let px = xr;
        let pz = zHit;
        const stepU = dxu * 0.5;
        for (let m = 0; m < 4000; m++) {
          px += rX * stepU;
          pz += rZ * stepU;
          if (px < 0 || px > L || pz < surf(px) || pz > pyramidUm + 2) break;
        }
        ctx.strokeStyle = "rgba(255, 224, 138, 0.6)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(X(xr), Z(zHit));
        ctx.lineTo(X(px), Z(pz));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // scale bar
    font(ctx, 10, 400, true);
    ctx.fillStyle = MUTED;
    const sbY = narrow ? top - 12 : top - 30;
    ctx.fillRect(X(L) - s * 2, sbY, s * 2, 2);
    text(ctx, "2 µm", X(L) - s, sbY - 5, MUTED, "center");
    font(ctx, 11, 600);
    text(ctx, conformal ? (narrow ? "conformal: even on every facet" : "conformal film: same thickness on every facet") : narrow ? "solution: fills valleys, levels out" : "solution film: liquid fills the valleys and levels out", gx, top - 36, TEXT);
    font(ctx, 10);
    text(ctx, "perovskite", gx + 4, base + 22, C_TOP);
    text(ctx, "silicon (facets at 54.7°)", gx + 80, base + 22, C_SI);
    if (r.bare > 0) text(ctx, "red: bare tips", gx + (narrow ? 4 : 240), base + (narrow ? 38 : 22), C_BAD);
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
