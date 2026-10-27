// An action potential travelling down a 10 cm unmyelinated axon, simulated as
// 200 Hodgkin–Huxley compartments (src/lib/neuron/cable.ts). Click anywhere on
// the axon to stimulate there. Two probes time the pulse and report the
// conduction speed the simulation actually produced.

import { Shell, type Demo } from "../../lib/demoShell";
import { heatRgb } from "../../lib/palette";
import { Cable } from "../../lib/neuron/cable";
import { restingState } from "../../lib/neuron/membrane";
import { Clock, INK, begin, drawGlow, font, glow, rgba, roundRect, surface, type Box } from "./draw";

const N = 200;
const LENGTH_CM = 10;
const DT = 0.01;
const V_LO = -90;
const V_HI = 55;
const PROBE_A = 60; // compartments, 3 cm
const PROBE_B = 140; // 7 cm
const STIM_AMP = 300; // µA/cm², over 3 compartments
const STIM_MS = 0.5;
const { h: H_REST, n: N_REST } = restingState();

export function mountActionPotential(container: HTMLElement): Demo {
  const wide = (container.clientWidth || 720) >= 560;
  const shell = new Shell(container, wide ? 0.48 : 0.95);
  const sf = surface(shell.canvas);
  const { w, h } = sf;

  let diameter = 476;
  const cable = new Cable(N, LENGTH_CM, diameter);
  const clock = new Clock(3); // 3 ms of axon time per second
  let t = 0;
  const stims: { i: number; until: number }[] = [];
  let auto = true;
  let autoNext = 0;

  // probe timing: when each probe last saw a pulse pass going right (→) or
  // left (←). The direction comes from which side of the probe is already up.
  const crossed = { A: { r: -1e9, l: -1e9 }, B: { r: -1e9, l: -1e9 } };
  let aboveA = false;
  let aboveB = false;
  const MAX_TRANSIT = 12; // ms; slower than any diameter on the slider
  let speed = 0;
  let speedDir = 0;

  const stimulate = (i: number): void => {
    stims.push({ i, until: t + STIM_MS });
  };

  shell.slider({
    label: "Axon diameter",
    min: 100,
    max: 1000,
    step: 2,
    value: diameter,
    format: (v) => `${v.toFixed(0)} µm`,
    onInput: (v) => {
      diameter = v;
      cable.setDiameter(v);
      speed = 0;
      crossed.A.r = crossed.A.l = crossed.B.r = crossed.B.l = -1e9;
    },
  });
  // The buttons wait for the membrane they need to have recovered, so a
  // press never lands in a refractory wake by accident (clicks don't wait).
  let pending: "soma" | "both" | null = null;
  const recovered = (i0: number, i1: number): boolean => {
    for (let i = i0; i <= i1; i++) if (cable.h[i] < H_REST * 0.8 || cable.v[i] > -60) return false;
    return true;
  };
  const quiet = (): boolean => {
    for (let i = 0; i < N; i++) if (cable.v[i] > -40) return false;
    return true;
  };
  shell.button("fire from the cell body", () => {
    auto = false;
    pending = "soma";
  });
  shell.button("fire both ends", () => {
    auto = false;
    pending = "both";
  });
  shell.setInfo(() => {
    if (pending) return "waiting for the axon to recover…";
    const lam = cable.lengthConstant() * 10;
    const sp = speed > 0 ? `measured ${speed.toFixed(1)} m/s` : "waiting for a pulse to pass both probes";
    return `${diameter.toFixed(0)} µm axon · length constant ${lam.toFixed(1)} mm · ${sp}`;
  });

  const step = (): void => {
    cable.clearInjection();
    for (let k = stims.length - 1; k >= 0; k--) {
      const s = stims[k];
      if (t >= s.until) {
        stims.splice(k, 1);
        continue;
      }
      cable.inject(s.i - 1, s.i + 1, STIM_AMP);
    }
    cable.step(DT);
    t += DT;
    const gap = (PROBE_B - PROBE_A) * cable.dx * 10; // mm
    const dirAt = (i: number): number => Math.sign(cable.v[i - 4] - cable.v[i + 4]); // +1 = moving right
    const va = cable.v[PROBE_A];
    const vb = cable.v[PROBE_B];
    if (!aboveA && va > 0) {
      aboveA = true;
      if (dirAt(PROBE_A) > 0) crossed.A.r = t;
      else {
        crossed.A.l = t;
        if (t - crossed.B.l < MAX_TRANSIT) {
          speed = gap / (t - crossed.B.l); // mm/ms = m/s
          speedDir = -1;
        }
      }
    } else if (aboveA && va < -40) aboveA = false;
    if (!aboveB && vb > 0) {
      aboveB = true;
      if (dirAt(PROBE_B) < 0) crossed.B.l = t;
      else {
        crossed.B.r = t;
        if (t - crossed.A.r < MAX_TRANSIT) {
          speed = gap / (t - crossed.A.r);
          speedDir = 1;
        }
      }
    } else if (aboveB && vb < -40) aboveB = false;
  };

  const advance = (ms: number): void => {
    const end = t + ms;
    while (t < end - 1e-9) {
      if (pending === "soma" && recovered(0, 12)) {
        stimulate(1);
        pending = null;
      } else if (pending === "both" && quiet() && recovered(0, 12) && recovered(N - 13, N - 1)) {
        stimulate(1);
        stimulate(N - 2);
        pending = null;
      }
      if (auto && t >= autoNext) {
        stimulate(1);
        autoNext = t + 24; // long enough for the axon to recover fully
      }
      step();
    }
  };
  // open with a pulse already most of the way down the axon
  advance(6.2);

  // layout
  const pad = wide ? 50 : 44;
  const plot: Box = { x: pad, y: 22, w: w - pad - 16, h: h * (wide ? 0.58 : 0.52) };
  const axonY = plot.y + plot.h + (wide ? 40 : 32);
  const axonH = wide ? 16 : 13;
  const axon = { x0: plot.x + 14, x1: plot.x + plot.w };
  const xOf = (i: number): number => axon.x0 + ((i + 0.5) / N) * (axon.x1 - axon.x0);
  const toY = (v: number): number => plot.y + plot.h * (1 - (v - V_LO) / (V_HI - V_LO));
  const hot = glow([255, 196, 120], 0.55);

  shell.canvas.addEventListener("pointerdown", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.round(((x - axon.x0) / (axon.x1 - axon.x0)) * N - 0.5);
    if (i < 0 || i >= N) return;
    auto = false;
    stimulate(Math.min(N - 2, Math.max(1, i)));
  });
  shell.canvas.style.cursor = "crosshair";

  return {
    frame: () => {
      advance(clock.advance());
      const ctx = begin(sf);
      const v = cable.v;

      // ---- voltage along the axon, right now
      ctx.font = font(10, 500, true);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const tick of [-80, -40, 0, 40]) {
        const y = toY(tick);
        ctx.strokeStyle = tick === 0 ? INK.axis : INK.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plot.x, Math.round(y) + 0.5);
        ctx.lineTo(plot.x + plot.w, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.fillStyle = INK.muted;
        ctx.fillText(`${tick > 0 ? "+" : ""}${tick}`, plot.x - 6, y);
      }
      ctx.fillStyle = INK.faint;
      ctx.fillText("mV", plot.x - 6, plot.y - 10);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";

      // refractory wake: Na⁺ channels still inactivated, K⁺ channels still open
      const refr = (i: number): number =>
        Math.max(0, Math.min(1, (H_REST - cable.h[i]) / H_REST)) * 0.6 +
        Math.max(0, Math.min(1, (cable.nk[i] - N_REST) / (1 - N_REST))) * 0.4;
      const wake = ctx.createLinearGradient(axon.x0, 0, axon.x1, 0);
      let runStart = -1;
      for (let i = 0; i <= N; i++) {
        const a = i < N ? refr(i) : 0;
        if (i < N) wake.addColorStop((i + 0.5) / N, `rgba(255,111,145,${(a * 0.16).toFixed(3)})`);
        const on = a > 0.15;
        if (on && runStart < 0) runStart = i;
        if (!on && runStart >= 0) {
          const x0 = xOf(runStart);
          const x1 = xOf(i - 1);
          if (x1 - x0 > 70) {
            ctx.font = font(10, 600);
            ctx.fillStyle = rgba(INK.inhib, 0.8);
            ctx.textAlign = "center";
            ctx.fillText("refractory", (x0 + x1) / 2, plot.y + 12);
            ctx.textAlign = "left";
          }
          runStart = -1;
        }
      }
      ctx.fillStyle = wake;
      ctx.fillRect(axon.x0, plot.y, axon.x1 - axon.x0, axonY + axonH - plot.y);

      // profile: filled area plus a glowing line
      ctx.beginPath();
      ctx.moveTo(xOf(0), toY(V_LO));
      for (let i = 0; i < N; i++) ctx.lineTo(xOf(i), toY(v[i]));
      ctx.lineTo(xOf(N - 1), toY(V_LO));
      ctx.closePath();
      const fillGrad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
      fillGrad.addColorStop(0, "rgba(255,196,120,0.22)");
      fillGrad.addColorStop(0.6, "rgba(122,162,255,0.06)");
      fillGrad.addColorStop(1, "rgba(122,162,255,0)");
      ctx.fillStyle = fillGrad;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (i === 0) ctx.moveTo(xOf(i), toY(v[i]));
        else ctx.lineTo(xOf(i), toY(v[i]));
      }
      ctx.lineJoin = "round";
      ctx.strokeStyle = rgba(INK.volt, 0.18);
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = INK.volt;
      ctx.lineWidth = 2;
      ctx.stroke();

      // ---- the axon itself, coloured by voltage
      ctx.save();
      roundRect(ctx, axon.x0, axonY, axon.x1 - axon.x0, axonH, axonH / 2);
      ctx.clip();
      ctx.fillStyle = "#121726";
      ctx.fillRect(axon.x0, axonY, axon.x1 - axon.x0, axonH);
      const segW = (axon.x1 - axon.x0) / N;
      for (let i = 0; i < N; i++) {
        const f = Math.min(1, Math.max(0, (v[i] + 65) / 105));
        if (f < 0.03) continue;
        const [r, g, b] = heatRgb(0.2 + f * 0.8);
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.25 + f * 0.75})`;
        ctx.fillRect(axon.x0 + i * segW, axonY, segW + 0.6, axonH);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(160,180,230,0.35)";
      ctx.lineWidth = 1;
      roundRect(ctx, axon.x0, axonY, axon.x1 - axon.x0, axonH, axonH / 2);
      ctx.stroke();
      // glow where the membrane is firing
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < N; i += 2) {
        const f = (v[i] + 20) / 60;
        if (f > 0) drawGlow(ctx, hot, xOf(i), axonY + axonH / 2, axonH * 1.6, Math.min(1, f) * 0.35);
      }
      ctx.globalCompositeOperation = "source-over";

      // cell body at the left end
      ctx.fillStyle = "#1b2238";
      ctx.strokeStyle = "rgba(160,180,230,0.55)";
      ctx.beginPath();
      ctx.arc(axon.x0 - 4, axonY + axonH / 2, axonH * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // probes
      for (const [i, label] of [
        [PROBE_A, "A"],
        [PROBE_B, "B"],
      ] as const) {
        const x = xOf(i);
        ctx.strokeStyle = rgba(INK.spike, 0.5);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, axonY - 3);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = INK.spike;
        ctx.font = font(10, 700);
        ctx.textAlign = "center";
        ctx.fillText(label, x, axonY - 6);
        ctx.textAlign = "left";
      }

      // position scale
      const sy = axonY + axonH + 16;
      ctx.font = font(10, 500, true);
      ctx.fillStyle = INK.muted;
      for (let cm = 0; cm <= LENGTH_CM; cm += 2) {
        const x = axon.x0 + (cm / LENGTH_CM) * (axon.x1 - axon.x0);
        ctx.fillRect(x - 0.5, axonY + axonH + 3, 1, 4);
        ctx.textAlign = cm === LENGTH_CM ? "right" : "center";
        ctx.fillText(cm === LENGTH_CM ? `${cm} cm` : String(cm), cm === LENGTH_CM ? x + 3 : x, sy);
      }
      ctx.textAlign = "left";

      // the measured speed, between the probes
      if (speed > 0) {
        const xm = (xOf(PROBE_A) + xOf(PROBE_B)) / 2;
        ctx.font = font(11, 700);
        ctx.fillStyle = INK.spike;
        ctx.textAlign = "center";
        const arrow = speedDir > 0 ? "→" : "←";
        ctx.fillText(`${arrow} ${speed.toFixed(1)} m/s`, xm, sy + (wide ? 20 : 18));
        ctx.textAlign = "left";
      }

      shell.tick();
    },
  };
}
