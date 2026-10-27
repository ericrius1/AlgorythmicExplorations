// Seven integrate-and-fire cells wired as in src/lib/neuron/circuit.ts. Click
// a cell to make it fire. Spikes travel the edges as dots; a raster below
// shows every spike in the last 150 ms of circuit time.

import { Shell, type Demo } from "../../lib/demoShell";
import { LIF } from "../../lib/neuron/membrane";
import { CIRCUIT_EDGES, Circuit, INHIBITORY_CELL } from "../../lib/neuron/circuit";
import { Clock, INK, begin, drawGlow, font, glow, rgb, rgba, rng, surface, timeBar, type Box } from "./draw";

const DT = 0.05;
const WINDOW = 150;
const NAMES = ["A", "B", "C", "D", "E", "F", "G"];
const ROLE = ["input", "", "", "", "", "inhibitory", "output"];
const LAYOUT: [number, number][] = [
  [0.07, 0.5],
  [0.27, 0.2],
  [0.27, 0.8],
  [0.48, 0.5],
  [0.7, 0.2],
  [0.7, 0.8],
  [0.92, 0.2],
];
// sideways bulge of each edge's curve, as a fraction of its length
const BEND = [0, 0, 0, 0, 0.16, 0.16, 0.16, 0.16, 0];

export function mountNeuronNetwork(container: HTMLElement): Demo {
  const wide = (container.clientWidth || 720) >= 560;
  const shell = new Shell(container, wide ? 0.62 : 1.1);
  const sf = surface(shell.canvas);
  const { w, h } = sf;

  const circ = new Circuit(7, rng(5));
  const clock = new Clock(15);
  const flash = new Float32Array(7);
  const hit = new Float32Array(7); // recent inhibitory kick, for the pink ring
  let auto = true;
  let autoNext = 0;
  let lastInput = -1e9;
  let prevInput = -1e9;
  circ.onSpike = (i) => {
    flash[i] = 1;
  };

  shell.slider({
    label: "Inhibition (F → D)",
    min: 0,
    max: 30,
    step: 0.5,
    value: circ.inhibition,
    format: (v) => (v === 0 ? "0 mV" : `−${v.toFixed(1)} mV`),
    onInput: (v) => (circ.inhibition = v),
  });
  shell.slider({
    label: "Background noise",
    min: 0,
    max: 6,
    step: 0.1,
    value: circ.noise,
    format: (v) => `${v.toFixed(1)} mV`,
    onInput: (v) => (circ.noise = v),
  });
  const markInput = (): void => {
    prevInput = lastInput;
    lastInput = circ.t;
  };
  shell.button("stimulate A", () => {
    markInput();
    circ.force(0);
  });
  const autoBtn = shell.button("auto input: on", () => {
    auto = !auto;
    autoBtn.textContent = `auto input: ${auto ? "on" : "off"}`;
    autoNext = circ.t + 10;
  });

  shell.setInfo(() => {
    const dTimes = circ.spikes.filter((s) => s.cell === 3 && s.t >= circ.t - 100).map((s) => s.t);
    if (dTimes.length >= 5) {
      const isi = (dTimes[dTimes.length - 1] - dTimes[0]) / (dTimes.length - 1);
      return `D and E are echoing: D fires every ${isi.toFixed(0)} ms, ${(1000 / isi).toFixed(0)} times a second`;
    }
    // report the last input whose wave has finished
    const from = circ.t - lastInput > 30 ? lastInput : prevInput;
    const to = from === lastInput ? circ.t : lastInput;
    const dCount = circ.spikes.filter((s) => s.cell === 3 && s.t > from && s.t <= to).length;
    if (circ.t - from > 120) return "click a cell to fire it";
    return dCount === 0 ? "D didn't fire after the last input" : `D fired ${dCount === 1 ? "once" : `${dCount} times`} after the last input`;
  });

  const advance = (ms: number): void => {
    const end = circ.t + ms;
    while (circ.t < end - 1e-9) {
      if (auto && circ.t >= autoNext) {
        markInput();
        circ.force(0);
        autoNext = circ.t + 60;
      }
      const kicksBefore = circ.kicks.length;
      circ.step(DT);
      for (let k = kicksBefore; k < circ.kicks.length; k++) if (circ.kicks[k].w < 0) hit[circ.kicks[k].cell] = 1;
    }
  };
  advance(15); // open with the first cascade under way

  // layout
  const graph: Box = { x: 26, y: 18, w: w - 52, h: h * (wide ? 0.56 : 0.5) };
  const raster: Box = { x: 30, y: graph.y + graph.h + 34, w: w - 44, h: h - (graph.y + graph.h + 34) - 28 };
  const R = wide ? 17 : 14;
  const pos = LAYOUT.map(([x, y]) => [graph.x + x * graph.w, graph.y + y * graph.h] as [number, number]);
  const curve = (k: number): { ax: number; ay: number; cx: number; cy: number; bx: number; by: number } => {
    const e = CIRCUIT_EDGES[k];
    const [x0, y0] = pos[e.from];
    const [x1, y1] = pos[e.to];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const b = BEND[k] * len;
    const cx = (x0 + x1) / 2 + nx * b;
    const cy = (y0 + y1) / 2 + ny * b;
    // start and end on the circles' rims
    const sx = x0 + ((cx - x0) / Math.hypot(cx - x0, cy - y0)) * R;
    const sy = y0 + ((cy - y0) / Math.hypot(cx - x0, cy - y0)) * R;
    const ex = x1 + ((cx - x1) / Math.hypot(cx - x1, cy - y1)) * (R + 3);
    const ey = y1 + ((cy - y1) / Math.hypot(cx - x1, cy - y1)) * (R + 3);
    return { ax: sx, ay: sy, cx, cy, bx: ex, by: ey };
  };
  const curves = CIRCUIT_EDGES.map((_, k) => curve(k));
  const at = (k: number, f: number): [number, number] => {
    const c = curves[k];
    const u = 1 - f;
    return [u * u * c.ax + 2 * u * f * c.cx + f * f * c.bx, u * u * c.ay + 2 * u * f * c.cy + f * f * c.by];
  };
  const excite = glow([255, 214, 150], 0.7);
  const inhibit = glow(rgb(INK.inhib), 0.6);
  const cellGlow = glow(rgb(INK.spike), 0.6);

  shell.canvas.addEventListener("pointerdown", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const y = ((e.clientY - r.top) / r.height) * h;
    let best = -1;
    let bestD = (R + 14) ** 2;
    pos.forEach(([px, py], i) => {
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      if (best === 0) markInput();
      circ.force(best);
    }
  });
  shell.canvas.style.cursor = "pointer";

  return {
    frame: () => {
      const simMs = clock.advance();
      advance(simMs);
      const decay = Math.exp(-simMs / 4);
      for (let i = 0; i < 7; i++) {
        flash[i] *= decay;
        hit[i] *= decay;
      }
      const ctx = begin(sf);

      // edges
      CIRCUIT_EDGES.forEach((e, k) => {
        const c = curves[k];
        const inh = e.w < 0;
        const strength = inh ? circ.inhibition / 30 : e.w / 18;
        ctx.strokeStyle = inh ? rgba(INK.inhib, 0.25 + strength * 0.4) : rgba(INK.accent, 0.3);
        ctx.lineWidth = inh ? 1 + strength * 2.5 : e.w >= 18 ? 2.2 : 1.3;
        ctx.beginPath();
        ctx.moveTo(c.ax, c.ay);
        ctx.quadraticCurveTo(c.cx, c.cy, c.bx, c.by);
        ctx.stroke();
        // arrowhead (excitatory) or bar (inhibitory)
        const [px, py] = at(k, 0.94);
        const ang = Math.atan2(c.by - py, c.bx - px);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.save();
        ctx.translate(c.bx, c.by);
        ctx.rotate(ang);
        if (inh) {
          ctx.fillRect(-2, -6, 3, 12);
        } else {
          ctx.beginPath();
          ctx.moveTo(1, 0);
          ctx.lineTo(-7, -4);
          ctx.lineTo(-7, 4);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        // weight label at the curve's middle (only the inhibitory one on phones)
        if (!wide && !inh) return;
        const [mx, my] = at(k, 0.5);
        ctx.font = font(9, 600, true);
        ctx.fillStyle = inh ? rgba(INK.inhib, 0.85) : rgba(INK.text, 0.55);
        ctx.textAlign = "center";
        const wv = circ.weight(e);
        const lab = `${wv > 0 ? "+" : wv < 0 ? "−" : ""}${Math.abs(wv).toFixed(0)}`;
        const off = BEND[k] !== 0 ? 0 : -6;
        ctx.fillText(lab, mx, my + off);
        ctx.textAlign = "left";
      });

      // spikes in flight
      ctx.globalCompositeOperation = "lighter";
      for (const f of circ.flights) {
        const e = CIRCUIT_EDGES[f.edge];
        const frac = Math.min(1, (circ.t - f.t0) / e.delay);
        const [x, y] = at(f.edge, frac);
        drawGlow(ctx, e.w < 0 ? inhibit : excite, x, y, 9, 1);
        const [tx, ty] = at(f.edge, Math.max(0, frac - 0.08));
        drawGlow(ctx, e.w < 0 ? inhibit : excite, tx, ty, 6, 0.4);
      }
      ctx.globalCompositeOperation = "source-over";

      // cells
      for (let i = 0; i < 7; i++) {
        const [x, y] = pos[i];
        const c = circ.cells[i];
        const dep = Math.max(0, Math.min(1, (c.v - LIF.rest) / (LIF.threshold - LIF.rest)));
        const inhCell = i === INHIBITORY_CELL;
        if (flash[i] > 0.02) {
          ctx.globalCompositeOperation = "lighter";
          drawGlow(ctx, cellGlow, x, y, R * 3.2, flash[i]);
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${24 + dep * 50 + flash[i] * 200}, ${30 + dep * 60 + flash[i] * 170}, ${52 + dep * 90 + flash[i] * 80})`;
        ctx.fill();
        ctx.strokeStyle = inhCell ? rgba(INK.inhib, 0.8) : "rgba(150,170,220,0.55)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // voltage gauge: how far from rest to threshold
        if (dep > 0.01) {
          ctx.strokeStyle = INK.spike;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, R + 4, -Math.PI / 2, -Math.PI / 2 + dep * Math.PI * 2);
          ctx.stroke();
        }
        if (hit[i] > 0.05) {
          ctx.strokeStyle = rgba(INK.inhib, hit[i]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, R + 8 + (1 - hit[i]) * 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.font = font(12, 700);
        ctx.fillStyle = "#eef1f8";
        ctx.textAlign = "center";
        ctx.fillText(NAMES[i], x, y + 4);
        if (ROLE[i]) {
          ctx.font = font(10, 600);
          ctx.fillStyle = inhCell ? rgba(INK.inhib, 0.85) : INK.muted;
          const below = LAYOUT[i][1] > 0.5;
          ctx.fillText(ROLE[i], x, below ? y + R + 18 : y - R - 10);
        }
        ctx.textAlign = "left";
      }

      // raster
      ctx.font = font(10, 700);
      const rowH = raster.h / 7;
      for (let i = 0; i < 7; i++) {
        const y = raster.y + rowH * (i + 0.5);
        ctx.fillStyle = i === INHIBITORY_CELL ? rgba(INK.inhib, 0.9) : INK.muted;
        ctx.textAlign = "right";
        ctx.fillText(NAMES[i], raster.x - 8, y + 3.5);
        ctx.strokeStyle = INK.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(raster.x, Math.round(y) + 0.5);
        ctx.lineTo(raster.x + raster.w, Math.round(y) + 0.5);
        ctx.stroke();
      }
      ctx.textAlign = "left";
      for (const s of circ.spikes) {
        const age = circ.t - s.t;
        if (age > WINDOW) continue;
        const x = raster.x + raster.w - (age / WINDOW) * raster.w;
        const y = raster.y + rowH * (s.cell + 0.5);
        ctx.fillStyle = s.cell === INHIBITORY_CELL ? INK.inhib : INK.spike;
        ctx.fillRect(x - 1, y - rowH * 0.36, 2, rowH * 0.72);
      }
      timeBar(ctx, raster, WINDOW, 20);

      shell.tick();
    },
  };
}
