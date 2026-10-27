// Chemical synapses onto one dendrite. A row of input boutons, each with 10
// release sites; a spike makes each docked vesicle fuse with probability p;
// fused vesicles open AMPA receptors on the dendrite; the receiving cell sums
// it all and fires if it reaches −55 mV. Model: src/lib/neuron/synapse.ts.

import { Shell, type Demo } from "../../lib/demoShell";
import { POST, SITES_PER_INPUT, SYNAPSE, Synapse } from "../../lib/neuron/synapse";
import {
  Clock,
  INK,
  Trace,
  begin,
  drawGlow,
  font,
  glow,
  plotTrace,
  refLine,
  rgb,
  rgba,
  rng,
  roundRect,
  surface,
  timeBar,
  type Box,
} from "./draw";

const DT = 0.025;
const SAMPLE = 0.25;
const WINDOW = 200;
const BURST = 5;
const BURST_GAP = 10; // ms, so 100 Hz
const V_LO = -73;
const V_HI = -49;

interface Puff {
  bouton: number;
  slot: number;
  t: number;
  seed: number;
}

export function mountSynapse(container: HTMLElement): Demo {
  const wide = (container.clientWidth || 720) >= 560;
  const shell = new Shell(container, wide ? 0.62 : 1.2);
  const sf = surface(shell.canvas);
  const { w, h } = sf;

  let inputs = SYNAPSE.sites / SITES_PER_INPUT;
  const syn = new Synapse({ ...SYNAPSE });
  const clock = new Clock(20); // 20 ms per second
  const trace = new Trace(1, WINDOW, SAMPLE);
  trace.fill(POST.rest);
  let t = 0;
  let nextSample = SAMPLE;
  const queue: number[] = []; // scheduled presynaptic spike times
  const fires: number[] = []; // postsynaptic spike times
  const arrivals: number[] = []; // presynaptic spike times
  const puffs: Puff[] = [];
  const boutonGlow = new Float32Array(20);
  let fireFlash = 0;
  const r = rng(11);

  // what the latest press did
  interface Episode {
    kind: "spike" | "burst";
    released: number[];
    docked: number[];
    peak: number;
    fired: boolean;
    start: number;
  }
  let episode: Episode | null = null;

  syn.onRelease = (released, docked) => {
    if (episode && t - episode.start < 60) {
      episode.released.push(released);
      episode.docked.push(docked);
    }
  };
  syn.onFire = () => {
    fires.push(t);
    fireFlash = 1;
    if (episode && t - episode.start < 80) episode.fired = true;
  };

  const press = (kind: "spike" | "burst"): void => {
    const n = kind === "spike" ? 1 : BURST;
    for (let k = 0; k < n; k++) queue.push(t + k * BURST_GAP);
    episode = { kind, released: [], docked: [], peak: syn.v, fired: false, start: t };
  };

  // until touched, the figure plays one spike, then a burst, then rests long
  // enough for the vesicles to come back
  let auto = true;
  let autoNext = 8;
  let autoBurst = false;

  shell.slider({
    label: "Inputs firing together",
    min: 1,
    max: 20,
    step: 1,
    value: inputs,
    format: (v) => `${v.toFixed(0)} × ${SITES_PER_INPUT} sites`,
    onInput: (v) => {
      inputs = Math.round(v);
      syn.setSites(inputs * SITES_PER_INPUT);
      auto = false;
    },
  });
  shell.slider({
    label: "Release probability",
    min: 0.05,
    max: 0.9,
    step: 0.05,
    value: SYNAPSE.p,
    format: (v) => v.toFixed(2),
    onInput: (v) => {
      syn.params.p = v;
      auto = false;
    },
  });
  shell.button("one spike", () => {
    auto = false;
    press("spike");
  });
  shell.button(`burst of ${BURST}`, () => {
    auto = false;
    press("burst");
  });
  shell.setInfo(() => {
    const e = episode;
    if (!e || e.released.length === 0) return `${inputs} inputs · ${syn.dockedCount} vesicles docked`;
    const rel = e.released.join(", ");
    const peak = (e.peak - POST.rest).toFixed(1);
    const head = e.kind === "spike" ? `released ${rel} of ${e.docked[0]} docked` : `released ${rel}`;
    return `${head} · ${e.fired ? "the cell fired" : `peak +${peak} mV, no spike`}`;
  });

  const step = (): void => {
    for (let k = queue.length - 1; k >= 0; k--) {
      if (queue[k] <= t) {
        queue.splice(k, 1);
        syn.spike();
        arrivals.push(t);
      }
    }
    const before = syn.fusions.length;
    syn.step(DT);
    t += DT;
    for (let k = before; k < syn.fusions.length; k++) {
      const f = syn.fusions[k];
      const bouton = Math.floor(f.site / SITES_PER_INPUT);
      puffs.push({ bouton, slot: f.site % SITES_PER_INPUT, t, seed: r() });
      if (bouton < boutonGlow.length) boutonGlow[bouton] += 1;
    }
    syn.fusions.length = 0;
    for (let b = 0; b < boutonGlow.length; b++) boutonGlow[b] *= Math.exp(-DT / POST.decayMs);
    if (episode) episode.peak = Math.max(episode.peak, syn.v);
    if (t >= nextSample) {
      trace.push(syn.v);
      nextSample += SAMPLE;
    }
  };

  const advance = (ms: number): void => {
    const end = t + ms;
    while (t < end - 1e-9) {
      if (auto && t >= autoNext) {
        press(autoBurst ? "burst" : "spike");
        autoNext = t + (autoBurst ? 300 : 140);
        autoBurst = !autoBurst;
      }
      step();
    }
  };
  advance(WINDOW - 6); // open with one spike and one burst on the trace

  // layout
  const diag: Box = { x: 12, y: 8, w: w - 24, h: h * (wide ? 0.42 : 0.4) };
  const tBox: Box = { x: 46, y: diag.y + diag.h + 30, w: w - 60, h: h - (diag.y + diag.h + 30) - 46 };
  const dendY = diag.y + diag.h * 0.5;
  const dendH = wide ? 18 : 14;
  const puffSprite = glow(rgb("#8ff0d0"), 0.6);
  const recSprite = glow(rgb(INK.k), 0.4);
  const fireSprite = glow(rgb(INK.spike), 0.5);

  const boutonAt = (b: number, count: number): { x: number; y: number; bw: number; bh: number; up: boolean } => {
    const rows = count > 10 ? 2 : 1;
    const perRow = Math.ceil(count / rows);
    const up = rows === 1 || b % 2 === 0;
    const idx = rows === 1 ? b : Math.floor(b / 2);
    const rowCount = rows === 1 ? count : up ? Math.ceil(count / 2) : Math.floor(count / 2);
    const span = diag.w - 30;
    const cell = span / Math.max(perRow, 4);
    const bw = Math.min(62, cell * 0.8);
    const bh = Math.min(40, bw * 0.7);
    const x0 = diag.x + 15 + (span - cell * rowCount) / 2;
    const x = x0 + cell * (idx + 0.5) + (up ? 0 : cell * 0.25);
    const gap = wide ? 9 : 7;
    const y = up ? dendY - dendH / 2 - gap - bh : dendY + dendH / 2 + gap;
    return { x, y, bw, bh, up };
  };

  return {
    frame: () => {
      advance(clock.advance());
      const ctx = begin(sf);
      const count = inputs;
      const dep = Math.max(0, (syn.v - POST.rest) / (POST.threshold - POST.rest));
      fireFlash *= 0.93;

      // dendrite
      const dx0 = diag.x + 4;
      const dx1 = diag.x + diag.w - 4;
      const grad = ctx.createLinearGradient(dx0, 0, dx1, 0);
      grad.addColorStop(0, rgba("#2a3352", 0.95));
      grad.addColorStop(1, rgba("#2a3352", 0.95));
      ctx.fillStyle = grad;
      roundRect(ctx, dx0, dendY - dendH / 2, dx1 - dx0, dendH, dendH / 2);
      ctx.fill();
      ctx.fillStyle = rgba(INK.volt, 0.12 + dep * 0.45);
      ctx.fill();
      if (fireFlash > 0.02) {
        ctx.fillStyle = rgba(INK.spike, fireFlash * 0.7);
        ctx.fill();
      }
      ctx.font = font(10, 600);
      ctx.fillStyle = INK.muted;
      ctx.textAlign = "right";
      ctx.fillText("dendrite of the receiving cell →", dx1 - 6, dendY + 3.5);
      ctx.textAlign = "left";

      // boutons, vesicle slots, receptor glow
      ctx.globalCompositeOperation = "source-over";
      for (let b = 0; b < count; b++) {
        const { x, y, bw, bh, up } = boutonAt(b, count);
        roundRect(ctx, x - bw / 2, y, bw, bh, bh * 0.45);
        ctx.fillStyle = "#1c2236";
        ctx.fill();
        ctx.strokeStyle = "rgba(170,160,230,0.45)";
        ctx.lineWidth = 1;
        ctx.stroke();
        const rad = Math.max(1.6, Math.min(3.4, bw / 15));
        for (let k = 0; k < SITES_PER_INPUT; k++) {
          const col = k % 5;
          const row = Math.floor(k / 5);
          const vx = x - bw / 2 + bw * (0.18 + col * 0.16);
          // the row nearest the dendrite is row 0
          const vy = up ? y + bh * (0.7 - row * 0.36) : y + bh * (0.3 + row * 0.36);
          const docked = syn.docked[b * SITES_PER_INPUT + k];
          ctx.beginPath();
          ctx.arc(vx, vy, rad, 0, Math.PI * 2);
          if (docked) {
            ctx.fillStyle = "#b99cff";
            ctx.fill();
          } else {
            ctx.strokeStyle = "rgba(185,156,255,0.3)";
            ctx.stroke();
          }
        }
      }
      ctx.globalCompositeOperation = "lighter";
      for (let b = 0; b < Math.min(count, boutonGlow.length); b++) {
        const g = boutonGlow[b];
        if (g < 0.02) continue;
        const { x, up } = boutonAt(b, count);
        const ry = up ? dendY - dendH / 2 : dendY + dendH / 2;
        drawGlow(ctx, recSprite, x, ry, 10 + Math.min(18, g * 4), Math.min(1, g * 0.35));
      }
      // transmitter puffs crossing the cleft
      for (let i = puffs.length - 1; i >= 0; i--) {
        const pf = puffs[i];
        const age = t - pf.t;
        if (age > 1.6 || pf.bouton >= count) {
          puffs.splice(i, 1);
          continue;
        }
        const { x, y, bw, bh, up } = boutonAt(pf.bouton, count);
        const sx = x - bw / 2 + bw * (0.18 + (pf.slot % 5) * 0.16);
        const sy = up ? y + bh : y;
        const ey = up ? dendY - dendH / 2 : dendY + dendH / 2;
        const f = Math.min(1, age / 0.5);
        const px = sx + (pf.seed - 0.5) * 10 * f;
        const py = sy + (ey - sy) * f;
        drawGlow(ctx, puffSprite, px, py, 6 + f * 4, 1 - age / 1.6);
      }
      if (fireFlash > 0.05) drawGlow(ctx, fireSprite, dx1 - 30, dendY, 60, fireFlash * 0.6);
      ctx.globalCompositeOperation = "source-over";

      // ---- postsynaptic voltage
      const toY = (v: number): number => tBox.y + tBox.h * (1 - (v - V_LO) / (V_HI - V_LO));
      ctx.font = font(10, 500, true);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const tick of [-70, -65, -60, -55, -50]) {
        const y = toY(tick);
        ctx.strokeStyle = INK.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tBox.x, Math.round(y) + 0.5);
        ctx.lineTo(tBox.x + tBox.w, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.fillStyle = INK.muted;
        ctx.fillText(String(tick), tBox.x - 6, y);
      }
      ctx.fillStyle = INK.faint;
      ctx.fillText("mV", tBox.x - 6, tBox.y - 10);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      refLine(ctx, tBox, toY(POST.threshold), INK.spike, "threshold −55 mV");

      // presynaptic spikes as ticks in a strip under the trace
      ctx.fillStyle = "#b99cff";
      for (const at of arrivals) {
        const x = tBox.x + tBox.w - ((t - at) / WINDOW) * tBox.w;
        if (x >= tBox.x) ctx.fillRect(x - 1, tBox.y + tBox.h + 6, 2, 8);
      }
      ctx.font = font(10, 600);
      ctx.textAlign = "right";
      ctx.fillText("in", tBox.x - 6, tBox.y + tBox.h + 14);
      ctx.textAlign = "left";
      while (arrivals.length && arrivals[0] < t - WINDOW) arrivals.shift();
      plotTrace(ctx, trace, 0, tBox, V_LO, V_HI, INK.volt, 2, 7);
      for (const ft of fires) {
        const x = tBox.x + tBox.w - ((t - ft) / WINDOW) * tBox.w;
        if (x < tBox.x) continue;
        ctx.strokeStyle = INK.spike;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, toY(POST.threshold));
        ctx.lineTo(x, tBox.y - 6);
        ctx.stroke();
        ctx.font = font(10, 700);
        ctx.fillStyle = INK.spike;
        ctx.textAlign = "center";
        ctx.fillText("spike", x, tBox.y - 10);
        ctx.textAlign = "left";
      }
      while (fires.length && fires[0] < t - WINDOW) fires.shift();
      timeBar(ctx, { ...tBox, h: tBox.h + 18 }, WINDOW, 20);
      ctx.font = font(10, 600);
      ctx.fillStyle = INK.muted;
      ctx.fillText("receiving cell", tBox.x + 4, tBox.y + 12);
      ctx.fillStyle = "#b99cff";
      ctx.fillText("· ticks below: input spikes", tBox.x + 82, tBox.y + 12);

      shell.tick();
    },
  };
}
