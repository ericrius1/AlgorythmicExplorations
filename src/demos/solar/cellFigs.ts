// The Solar Stack figures that run on the photon engine (lib/solar/cellEngine.ts): the hero, one gap against the
// sun (Step 1), two gaps (Step 2) and the series stack (Step 6). Every number in their readouts is a tally of
// photons and carriers on the GPU; the detailed-balance model (physics.ts) is drawn beside it to check against.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { NeuronStage, hudLabel } from "../../lib/neuron/stage";
import { CellEngine, HIST_BINS, type LayerSpec } from "../../lib/solar/cellEngine";
import { histogram, hudScale, miniCurve, stackBar, text } from "../../lib/solar/lab";
import {
  E_MAX,
  E_MIN,
  KT,
  PHOTON_FLUX,
  SQ_CURVE,
  SI_GAP,
  TANDEM_CURVE,
  cellVoltage,
  energyAt,
  idealTandem,
  j0rad,
  jph,
  powerBetween,
  seriesMpp,
  N_E,
  type Diode,
} from "./physics";

const PVK: [number, number, number] = [0.37, 0.88, 0.66];
const SI: [number, number, number] = [0.48, 0.64, 1.0];

/** the sun's power per energy bin of the histograms (the reference curve) */
function sunPowerBins(): [number, number][] {
  const out: [number, number][] = [];
  const bw = (E_MAX - E_MIN) / HIST_BINS;
  for (let b = 0; b < HIST_BINS; b++) {
    let p = 0;
    for (let i = 0; i < N_E; i++) {
      const e = energyAt(i);
      if (e >= E_MIN + b * bw && e < E_MIN + (b + 1) * bw) p += PHOTON_FLUX[i] * e;
    }
    out.push([E_MIN + (b + 0.5) * bw, p]);
  }
  return out;
}

/** a depth ruler down the left edge of a layer drawn on a log scale */
function depthRuler(stage: NeuronStage, layer: LayerSpec, x: number, y: number, ticks: [number, string][]): void {
  const g = stage.g;
  const s = stage.px;
  const u = hudScale(stage);
  const T = layer.thickNm;
  const d0 = 1000; // nm (the engine's log scale: 1 µm)
  const zAt = (nm: number): number => {
    const f = layer.log ? Math.log(1 + nm / d0) / Math.log(1 + T / d0) : nm / T;
    return layer.z0 + (layer.z1 - layer.z0) * f;
  };
  const a = stage.project([x, y, layer.z0]);
  const b = stage.project([x, y, layer.z1]);
  if (!a || !b) return;
  g.strokeStyle = "rgba(170, 185, 220, 0.3)";
  g.lineWidth = 1 * s;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  g.font = `${8.5 * u}px ui-monospace, "SF Mono", Menlo, monospace`;
  g.fillStyle = "rgba(170, 185, 220, 0.6)";
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (const [nm, label] of ticks) {
    const p = stage.project([x, y, zAt(nm)]);
    if (!p) continue;
    g.beginPath();
    g.moveTo(p[0] - 4 * s, p[1]);
    g.lineTo(p[0], p[1]);
    g.stroke();
    g.fillText(label, p[0] - 6 * s, p[1]);
  }
  g.textAlign = "left";
}

// ---- the hero ------------------------------------------------------------------

export async function mountTandemHero(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.56,
    post: { bloom: 0.3, exposure: 1.15, vignette: 0.45, radius: 1.2 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2;
      o.elevation = 0.26;
      o.distance = 3.5;
      o.target = [0, 0, -0.72];
      o.sway = 0.22;
      o.swaySpeed = 0.03;
    },
  });
  if (!stage) return gpuMissing(container);
  const narrow = stage.aspect < 1.4;
  if (narrow) {
    stage.orbit.distance *= Math.min(2.2, 1.6 / stage.aspect);
    stage.orbit.target = [0, 0, -0.25];
  }
  const top: LayerSpec = { material: "pvk", gap: 1.68, thickNm: 500, z0: 0, z1: -0.16, recomb: 0.12, color: PVK };
  const bot: LayerSpec = { material: "si", gap: SI_GAP, thickNm: 160_000, z0: -0.2, z1: -1.0, log: true, trap: 30, recomb: 0.05, color: SI };
  const pixels = stage.canvas.width * stage.canvas.height;
  const engine = new CellEngine(stage, {
    count: Math.round(Math.min(150_000, Math.max(60_000, pixels * 0.035))),
    carriers: 0.4,
    halfX: narrow ? 1.25 : 2.3,
    halfY: 0.7,
    layers: [top, bot],
    lattice: 16_000,
    bright: 0.85,
  });
  const share = (n: number): string => (engine.settled ? `${((n / engine.settled) * 100).toFixed(0)}` : "—");
  stage.shell.setInfo(() => {
    const t = engine.tally;
    return `of ${engine.settled.toLocaleString()} sunlight photons: ${share(t.absorbed[0])}% stop in the perovskite · ${share(t.absorbed[1])}% reach the silicon · ${share(t.passed)}% are below both gaps`;
  });
  return {
    frame() {
      stage.begin();
      engine.update();
      stage.render(
        (enc) => engine.compute(enc),
        (pass) => engine.draw(pass),
        (enc) => engine.copyCounters(enc),
      );
      stage.clearHud();
      if (!stage.compact) {
        const hx = narrow ? 1.25 : 2.3;
        hudLabel(stage, [hx * 0.62, -0.7, -0.08], "perovskite · 1.68 eV · 500 nm", [18, -14], "rgba(150, 240, 200, 0.85)");
        hudLabel(stage, [hx * 0.62, -0.7, -0.55], "silicon · 1.12 eV · 160 µm", [18, 10], "rgba(160, 190, 255, 0.85)");
        depthRuler(stage, bot, -hx * 0.66, -0.7, [
          [1000, "1 µm"],
          [10_000, "10 µm"],
          [100_000, "100 µm"],
        ]);
      }
      stage.shell.tick();
    },
  };
}

// ---- Step 1: one gap against the sun ------------------------------------------------

/** the model's split of the sunlight for one gap: passes, heat, voltage and emission, electrical power (shares) */
function modelSplit(gap: number): number[] {
  const pass = powerBetween(E_MIN, gap) / 100;
  const absorbed = powerBetween(gap) / 100;
  const kept = (gap * jph(gap)) / 100;
  const power = seriesMpp([{ jsc: jph(gap), j0: j0rad(gap) }], 200).pmax / 100;
  return [power, kept - power, absorbed - kept, pass];
}

export async function mountPhotonSorter(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.66,
    post: { bloom: 0.26, exposure: 1.1, vignette: 0.4 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.32;
      o.elevation = 0.2;
      o.distance = 3.0;
      o.target = [0.42, 0, -0.08];
      o.sway = 0.25;
      o.swaySpeed = 0.035;
    },
  });
  if (!stage) return gpuMissing(container);
  const { shell } = stage;
  let gap = SI_GAP;
  const layer = (): LayerSpec => ({ material: "step", gap, thickNm: 4000, z0: 0, z1: -0.62, recomb: 0, color: [0.62, 0.66, 0.95] });
  const engine = new CellEngine(stage, { count: 70_000, halfX: 1.1, halfY: 0.55, layers: [layer()], lattice: 9000, spawnTop: 0.95, carriers: 0.45 });
  const sun = sunPowerBins();
  let model = modelSplit(gap);
  const gapInput = shell.slider({
    label: "Bandgap",
    min: 0.6,
    max: 2.6,
    step: 0.01,
    value: gap,
    format: (v) => `${v.toFixed(2)} eV (${Math.round(1239.84 / v)} nm)`,
    onInput: (v) => {
      gap = v;
      model = modelSplit(gap);
      engine.setLayers([layer()]);
    },
  });
  shell.button("silicon", () => {
    gap = SI_GAP;
    model = modelSplit(gap);
    engine.setLayers([layer()]);
    gapInput.value = String(gap);
    gapInput.dispatchEvent(new Event("input"));
  });

  // the tallied split: energy that passed, heat, and the kept part (the gap's worth per absorbed photon), shared
  // between power and the cell's voltage loss by the diode equation at the tallied current
  const tallied = (): { shares: number[]; jsc: number; eff: number } | null => {
    const t = engine.tally;
    if (engine.settled < 500) return null;
    const absorbedE = t.heat[0] + gap * t.absorbed[0];
    const total = t.passedEnergy + absorbedE;
    const jsc = engine.jAbsorbed(0);
    const pmax = seriesMpp([{ jsc, j0: j0rad(gap) }], 200).pmax;
    const kept = (gap * t.absorbed[0]) / total;
    const power = Math.min(kept, pmax / 100);
    return { shares: [power, kept - power, t.heat[0] / total, t.passedEnergy / total], jsc, eff: power * 100 };
  };
  shell.setInfo(() => {
    const r = tallied();
    return r
      ? `${engine.settled.toLocaleString()} photons · Jsc ${r.jsc.toFixed(1)} mA/cm² (model ${jph(gap).toFixed(1)}) · ${r.eff.toFixed(1)}% to power (model ${(model[0] * 100).toFixed(1)}%)`
      : "counting…";
  });

  const COLORS = ["#ffe08a", "#c48cff", "#ffaa5c", "#5b6a9a"];
  return {
    frame() {
      stage.begin();
      engine.update();
      stage.render(
        (enc) => engine.compute(enc),
        (pass) => engine.draw(pass),
        (enc) => engine.copyCounters(enc),
      );
      stage.clearHud();
      const s = stage.px;
      const u = hudScale(stage);
      const W = stage.hud.width;
      const H = stage.hud.height;
      const c = stage.compact;
      const r = tallied();
      // the headline: what this gap turns into power, counted
      text(stage, "ELECTRICAL POWER", 14 * s, 22 * u, 10, "rgba(160, 175, 210, 0.7)");
      text(stage, r ? `${r.eff.toFixed(1)}%` : "counting…", 14 * s, 52 * u, 28, "#ffe08a", 700);
      text(stage, `of the sunlight, at a ${gap.toFixed(2)} eV gap`, 14 * s, 70 * u, 10.5, "rgba(190, 200, 225, 0.75)", 500);
      // the four-way split, with the model's boundaries as ticks
      if (r) {
        const bw = Math.min(W * (c ? 0.9 : 0.46), 420 * s);
        stackBar(
          stage,
          { x: 14 * s, y: 84 * u, w: bw, h: 9 * u },
          [
            { value: r.shares[0], color: COLORS[0], label: "power" },
            { value: r.shares[1], color: COLORS[1], label: "voltage" },
            { value: r.shares[2], color: COLORS[2], label: "heat" },
            { value: r.shares[3], color: COLORS[3], label: "passes" },
          ],
          model.slice(0, 3),
        );
      }
      // the spectrum, built up photon by photon: each bin's sunlight power, split by what became of it
      const t = engine.tally;
      const bw = (E_MAX - E_MIN) / HIST_BINS;
      const jsc = r?.jsc ?? 0;
      const vRatio = r && gap * jsc > 0 ? r.shares[0] / (r.shares[0] + r.shares[1]) : 0;
      const bins = t.hist.map((h, b) => {
        const e = E_MIN + (b + 0.5) * bw;
        const pass = h[0] * e;
        const abs = h[1] * e;
        const heat = h[1] * Math.max(0, e - gap);
        const kept = abs - heat;
        return [kept * vRatio, kept * (1 - vRatio), heat, pass];
      });
      const total = bins.reduce((a, q) => a + q.reduce((x, y) => x + y, 0), 0);
      const sunTotal = sun.reduce((a, [, p]) => a + p, 0);
      const curve = sun.map(([e, p]) => [e, (p / sunTotal) * total] as [number, number]);
      const box = stage.corner(330, 150);
      if (c) box.y = H - box.h - 10 * s;
      histogram(stage, box, bins, COLORS, [E_MIN, 3.6 + bw * 12], {
        title: "sunlight power by photon energy, counted",
        curve,
        line: { x: gap, label: `gap ${gap.toFixed(2)} eV`, color: "#ffffff" },
        xTicks: [0.5, 1, 1.5, 2, 2.5, 3, 3.5],
      });
      if (!c) {
        const cb = { x: box.x, y: box.y - 104 * s, w: box.w, h: 94 * s };
        miniCurve(stage, cb, SQ_CURVE.map((q) => [q.eg, q.eff] as [number, number]), [0.5, 2.6], [0, 36], {
          title: "power vs gap: the model, and this gap counted",
          marker: [gap, r?.eff ?? 0],
          xTicks: [0.5, 1, 1.5, 2, 2.5],
        });
      }
      shell.tick();
    },
  };
}

// ---- Step 2: two gaps, one sun -------------------------------------------------------

/** two current bars (the cells' tallied currents), the series current drawn across them */
function currentBars(stage: NeuronStage, x: number, y: number, w: number, rows: { label: string; j: number; color: string }[], series: number | null, scale: number): void {
  const g = stage.g;
  const s = stage.px;
  const u = hudScale(stage);
  rows.forEach((r, k) => {
    const yy = y + k * 26 * u;
    text(stage, r.label, x, yy + 9 * u, 9.5, "rgba(200, 210, 235, 0.8)");
    const bx = x + 74 * u;
    const bw = w - 74 * u - 70 * u;
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fillRect(bx, yy, bw, 11 * u);
    const used = series === null ? r.j : Math.min(r.j, series);
    g.fillStyle = r.color;
    g.fillRect(bx, yy, (used / scale) * bw, 11 * u);
    if (series !== null && r.j > series) {
      // the part this cell makes but the stack can't carry
      g.strokeStyle = r.color;
      g.setLineDash([3 * s, 3 * s]);
      g.lineWidth = 1.2 * s;
      g.strokeRect(bx + (series / scale) * bw, yy + 0.5 * s, ((r.j - series) / scale) * bw, 10 * u);
      g.setLineDash([]);
    }
    text(stage, `${r.j.toFixed(1)} mA/cm²`, bx + bw + 6 * u, yy + 9 * u, 9.5, "rgba(220, 226, 245, 0.9)", 600);
  });
  if (series !== null) {
    const bx = x + 74 * u;
    const bw = w - 74 * u - 70 * u;
    const lx = bx + (series / scale) * bw;
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 1.4 * s;
    g.beginPath();
    g.moveTo(lx, y - 4 * u);
    g.lineTo(lx, y + rows.length * 26 * u - 10 * u);
    g.stroke();
  }
}

export async function mountTwoGaps(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.66,
    post: { bloom: 0.26, exposure: 1.1, vignette: 0.4 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.3;
      o.elevation = 0.2;
      o.distance = 3.0;
      o.target = [0.42, 0, -0.2];
      o.sway = 0.25;
      o.swaySpeed = 0.035;
    },
  });
  if (!stage) return gpuMissing(container);
  const { shell } = stage;
  let top = 1.68;
  const layers = (): LayerSpec[] => [
    { material: "step", gap: top, thickNm: 4000, z0: 0, z1: -0.3, recomb: 0, color: PVK },
    { material: "step", gap: SI_GAP, thickNm: 4000, z0: -0.36, z1: -0.86, recomb: 0, color: SI },
  ];
  const engine = new CellEngine(stage, { count: 80_000, halfX: 1.1, halfY: 0.55, layers: layers(), lattice: 10_000, spawnTop: 0.9, carriers: 0.45 });
  let model = idealTandem(top);
  shell.slider({
    label: "Top-cell bandgap",
    min: 1.3,
    max: 2.3,
    step: 0.01,
    value: top,
    format: (v) => `${v.toFixed(2)} eV`,
    onInput: (v) => {
      top = v;
      model = idealTandem(top);
      engine.setLayers(layers());
    },
  });
  const measured = (): { jTop: number; jBot: number; twoT: number; fourT: number } | null => {
    if (engine.settled < 800) return null;
    const jTop = engine.jAbsorbed(0);
    const jBot = engine.jAbsorbed(1);
    const a: Diode = { jsc: jTop, j0: j0rad(top) };
    const b: Diode = { jsc: jBot, j0: j0rad(SI_GAP) };
    return { jTop, jBot, twoT: seriesMpp([a, b], 240).pmax, fourT: seriesMpp([a], 160).pmax + seriesMpp([b], 160).pmax };
  };
  shell.setInfo(() => {
    const m = measured();
    return m
      ? `${engine.settled.toLocaleString()} photons · top ${m.jTop.toFixed(1)} / silicon ${m.jBot.toFixed(1)} mA/cm² (model ${model.jTop.toFixed(1)} / ${model.jBot.toFixed(1)}) · 2-terminal ${m.twoT.toFixed(1)}% · 4-terminal ${m.fourT.toFixed(1)}%`
      : "counting…";
  });
  return {
    frame() {
      stage.begin();
      engine.update();
      stage.render(
        (enc) => engine.compute(enc),
        (pass) => engine.draw(pass),
        (enc) => engine.copyCounters(enc),
      );
      stage.clearHud();
      const s = stage.px;
      const u = hudScale(stage);
      const W = stage.hud.width;
      const c = stage.compact;
      const m = measured();
      text(stage, "TWO TERMINALS (IN SERIES)", 14 * s, 22 * u, 10, "rgba(160, 175, 210, 0.7)");
      text(stage, m ? `${m.twoT.toFixed(1)}%` : "counting…", 14 * s, 52 * u, 28, "#ffe08a", 700);
      text(stage, m ? `four terminals: ${m.fourT.toFixed(1)}%` : "", 14 * s, 70 * u, 10.5, "rgba(190, 200, 225, 0.75)", 500);
      if (m) {
        currentBars(
          stage,
          14 * s,
          88 * u,
          Math.min(W * (c ? 0.92 : 0.5), 430 * s),
          [
            { label: `top ${top.toFixed(2)} eV`, j: m.jTop, color: "#5fe0a8" },
            { label: "silicon", j: m.jBot, color: "#7aa2ff" },
          ],
          Math.min(m.jTop, m.jBot),
          36,
        );
      }
      if (!c) {
        const box = stage.corner(300, 120);
        miniCurve(
          stage,
          box,
          TANDEM_CURVE.map((q) => [q.eg, q.twoT] as [number, number]),
          [1.3, 2.3],
          [20, 46],
          {
            title: "efficiency vs top gap (solid 2T, dashed 4T)",
            dashed: [TANDEM_CURVE.map((q) => [q.eg, q.fourT] as [number, number])],
            marker: [top, m?.twoT ?? model.twoT.pmax],
            xTicks: [1.4, 1.6, 1.8, 2.0, 2.2],
          },
        );
        hudLabel(stage, [1.1, -0.55, -0.15], "top cell: takes everything above its gap", [16, -10], "rgba(150, 240, 200, 0.8)");
        hudLabel(stage, [1.1, -0.55, -0.6], "silicon: what's left above 1.12 eV", [16, 10], "rgba(160, 190, 255, 0.8)");
      }
      shell.tick();
    },
  };
}

// ---- Step 6: two cells, one current -------------------------------------------------------

const BOTTOM_LOSS = 0.13;

export async function mountSeriesStack(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.66,
    post: { bloom: 0.26, exposure: 1.1, vignette: 0.4 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.3;
      o.elevation = 0.22;
      o.distance = 3.0;
      o.target = [0.42, 0, -0.32];
      o.sway = 0.25;
      o.swaySpeed = 0.035;
    },
  });
  if (!stage) return gpuMissing(container);
  const { shell } = stage;
  let thick = 500;
  let topLoss = 0.15;
  let rs = 2;
  const layers = (): LayerSpec[] => [
    { material: "pvk", gap: 1.68, thickNm: thick, z0: 0, z1: -0.24, recomb: 0.04, color: PVK },
    { material: "si", gap: SI_GAP, thickNm: 160_000, z0: -0.29, z1: -0.95, log: true, trap: 30, recomb: 0.03, color: SI },
  ];
  const engine = new CellEngine(stage, { count: 80_000, halfX: 1.1, halfY: 0.55, layers: layers(), series: true, lattice: 10_000, spawnTop: 0.85, carriers: 0.5 });
  shell.slider({
    label: "Perovskite thickness",
    min: 200,
    max: 1000,
    step: 10,
    value: thick,
    format: (v) => `${v.toFixed(0)} nm`,
    onInput: (v) => {
      thick = v;
      engine.setLayers(layers());
    },
  });
  shell.slider({
    label: "Top-cell voltage loss",
    min: 0.05,
    max: 0.4,
    step: 0.01,
    value: topLoss,
    format: (v) => `${(v * 1000).toFixed(0)} mV`,
    onInput: (v) => (topLoss = v),
  });
  shell.slider({
    label: "Series resistance",
    min: 0,
    max: 10,
    step: 0.5,
    value: rs,
    format: (v) => `${v.toFixed(1)} Ω·cm²`,
    onInput: (v) => (rs = v),
  });
  // the two cells as diodes, their photocurrents the tallied ones
  const solve = (): { top: Diode; bot: Diode; stack: ReturnType<typeof seriesMpp> } | null => {
    if (engine.settled < 800) return null;
    const top: Diode = { jsc: engine.jAbsorbed(0), j0: j0rad(1.68) * Math.exp(topLoss / KT), rs, rsh: 5000 };
    const bot: Diode = { jsc: engine.jAbsorbed(1), j0: j0rad(SI_GAP) * Math.exp(BOTTOM_LOSS / KT), rs: 0, rsh: 20000 };
    return { top, bot, stack: seriesMpp([top, bot]) };
  };
  shell.setInfo(() => {
    const r = solve();
    const t = engine.tally;
    const park = t.collected[0] + t.collected[1] + t.recombined[0] + t.recombined[1];
    return r
      ? `${engine.settled.toLocaleString()} photons · perovskite ${r.top.jsc.toFixed(1)} / silicon ${r.bot.jsc.toFixed(1)} mA/cm² · ${park ? (((t.parked[0] + t.parked[1]) / park) * 100).toFixed(1) : "0"}% of carriers found no partner · stack ${r.stack.voc.toFixed(2)} V, FF ${(r.stack.ff * 100).toFixed(0)}%`
      : "counting…";
  });
  return {
    frame() {
      stage.begin();
      engine.update();
      // the junction: a top-cell hole and a bottom-cell electron recombine there in pairs, so the cell making more
      // current has carriers that find no partner (their share, from the tallied photocurrents)
      const jt = engine.jAbsorbed(0);
      const jb = engine.jAbsorbed(1);
      if (jt > 0 && jb > 0) engine.surplus = [Math.max(0, 1 - jb / jt), Math.max(0, 1 - jt / jb)];
      stage.render(
        (enc) => engine.compute(enc),
        (pass) => engine.draw(pass),
        (enc) => engine.copyCounters(enc),
      );
      stage.clearHud();
      const s = stage.px;
      const u = hudScale(stage);
      const W = stage.hud.width;
      const c = stage.compact;
      const r = solve();
      text(stage, "THE STACK", 14 * s, 22 * u, 10, "rgba(160, 175, 210, 0.7)");
      text(stage, r ? `${r.stack.pmax.toFixed(1)}%` : "counting…", 14 * s, 52 * u, 28, "#ffe08a", 700);
      if (r) {
        text(stage, `${r.stack.vmp.toFixed(2)} V at ${r.stack.jmp.toFixed(1)} mA/cm²`, 14 * s, 70 * u, 10.5, "rgba(190, 200, 225, 0.75)", 500);
        currentBars(
          stage,
          14 * s,
          88 * u,
          Math.min(W * (c ? 0.92 : 0.5), 430 * s),
          [
            { label: "perovskite", j: r.top.jsc, color: "#5fe0a8" },
            { label: "silicon", j: r.bot.jsc, color: "#7aa2ff" },
          ],
          Math.min(r.top.jsc, r.bot.jsc),
          28,
        );
      }
      if (r && !c) {
        // the J–V curves: each cell, and the stack (same current, voltages add)
        const box = stage.corner(300, 140);
        const curve = (cells: Diode[]): [number, number][] => {
          const pts: [number, number][] = [];
          const jmax = Math.max(...cells.map((q) => q.jsc)) * 1.05;
          for (let k = 0; k <= 160; k++) {
            const j = (k / 160) * jmax;
            const v = cells.reduce((a, q) => a + cellVoltage(q, j), 0);
            if (v < 0) break;
            pts.push([v, j]);
          }
          // (down to zero volts: the curve's flat top runs out at the short-circuit current)
          pts.push([0, seriesMpp(cells, 200).jsc]);
          return pts;
        };
        miniCurve(stage, box, curve([r.top, r.bot]), [0, 2.1], [0, 25], {
          title: "current vs voltage: each cell, and the stack",
          dashed: [curve([r.top]), curve([r.bot])],
          color: "#ffffff",
          marker: [r.stack.vmp, r.stack.jmp],
          xTicks: [0, 0.5, 1, 1.5, 2],
        });
        hudLabel(stage, [1.1, -0.55, -0.265], "the junction: holes from above meet electrons from below", [16, -12], "rgba(220, 200, 255, 0.85)");
      }
      shell.tick();
    },
  };
}
