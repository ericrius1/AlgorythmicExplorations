// Two figures on one Hodgkin–Huxley membrane patch.
//
// mountMembranePotential: the resting potential as a tug of war between a K⁺
// leak and a Na⁺ leak, with ions crossing a patch of membrane.
// mountSpike: a current pulse, the voltage it produces, and the Na⁺ and K⁺
// conductances that make the spike.

import { Shell, type Demo } from "../../lib/demoShell";
import { E_K, E_NA, HH, currents, restingState, restingVoltage, stepHH, type HHParams } from "../../lib/neuron/membrane";
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
  voltAxis,
  type Box,
} from "./draw";

const DT = 0.01; // ms, integration step
const SAMPLE = 0.1; // ms between trace samples
const V_LO = -90;
const V_HI = 55;
const V_TICKS = [-80, -60, -40, -20, 0, 20, 40];

// Advance the model `ms` of simulated time, pushing trace samples as it goes.
function runFor(
  ms: number,
  state: { t: number; nextSample: number },
  step: (dt: number) => void,
  sample: () => void,
): void {
  const end = state.t + ms;
  while (state.t + DT <= end + 1e-9) {
    step(DT);
    state.t += DT;
    if (state.t >= state.nextSample) {
      sample();
      state.nextSample += SAMPLE;
    }
  }
}

// ---------------------------------------------------------------------------
// Fig: the resting membrane

interface Ion {
  x: number; // 0..1 across the patch, at the pore
  drift: number; // sideways spread once clear of the pore
  y: number; // 0 = outside edge, 1 = inside edge
  vy: number;
  kind: 0 | 1; // 0 = K⁺ (leaving), 1 = Na⁺ (entering)
  life: number;
}

export function mountMembranePotential(container: HTMLElement): Demo {
  const wide = (container.clientWidth || 720) >= 560;
  const shell = new Shell(container, wide ? 0.52 : 1.42);
  const sf = surface(shell.canvas);
  const { w, h } = sf;

  const p: HHParams = { ...HH };
  const s = restingState(p);
  const clock = new Clock(10); // 10 ms of membrane time per second
  const trace = new Trace(1, 50, SAMPLE);
  trace.fill(s.v);
  const sim = { t: 0, nextSample: SAMPLE };
  let rest = restingVoltage(p);
  let target = 0;
  const spikeTimes: number[] = [];
  let above = false;

  shell.slider({
    label: "K⁺ leak",
    min: 0.05,
    max: 1,
    step: 0.001,
    value: p.gLeakK,
    format: (v) => `${v.toFixed(3)} mS/cm²`,
    onInput: (v) => {
      p.gLeakK = v;
      rest = restingVoltage(p);
    },
  });
  shell.slider({
    label: "Na⁺ leak",
    min: 0,
    max: 0.25,
    step: 0.001,
    value: p.gLeakNa,
    format: (v) => `${v.toFixed(3)} mS/cm²`,
    onInput: (v) => {
      p.gLeakNa = v;
      rest = restingVoltage(p);
    },
  });
  const firingRate = (): number => {
    const recent = spikeTimes.filter((t) => t > sim.t - 1000);
    return recent.length > 1 ? (1000 * (recent.length - 1)) / (recent[recent.length - 1] - recent[0]) : 0;
  };
  shell.setInfo(() => {
    const rate = firingRate();
    if (rate > 0 && spikeTimes[spikeTimes.length - 1] > sim.t - 200) {
      return `no stable rest · firing on its own at ${rate.toFixed(0)} spikes/s`;
    }
    return `resting at ${s.v.toFixed(1)} mV`;
  });

  // layout
  const trBox: Box = wide
    ? { x: 46, y: 26, w: w * 0.6 - 46, h: h - 58 }
    : { x: 46, y: 26, w: w - 60, h: h * 0.42 - 34 };
  const patch: Box = wide
    ? { x: w * 0.64, y: 22, w: w * 0.36 - 14, h: h - 44 }
    : { x: 14, y: h * 0.42 + 14, w: w - 28, h: h * 0.58 - 24 };

  // membrane patch geometry: a bilayer band with pores of each kind
  const r = rng(7);
  const bandY = patch.y + patch.h * (wide ? 0.42 : 0.34);
  const bandH = Math.min(38, patch.h * 0.16);
  const ions: Ion[] = [];
  let spawnK = 0;
  let spawnNa = 0;
  const kPores = [0.14, 0.38, 0.62, 0.86];
  const naPores = [0.26, 0.74];
  const kSprite = glow(rgb(INK.k), 0.5);
  const dots: { x: number; y: number; na: boolean }[] = [];
  {
    const outTop = patch.y + 24;
    const outBot = bandY - 10;
    const inTop = bandY + bandH + 28;
    const inBot = patch.y + patch.h - (wide ? 84 : 64);
    const area = (patch.w - 20) * Math.max(0, outBot - outTop);
    const n = Math.min(60, Math.floor(area / 420));
    for (let i = 0; i < n; i++) {
      dots.push({ x: patch.x + 10 + r() * (patch.w - 20), y: outTop + r() * (outBot - outTop), na: r() < 0.9 });
      if (inBot > inTop) dots.push({ x: patch.x + 10 + r() * (patch.w - 20), y: inTop + r() * (inBot - inTop), na: r() < 0.1 });
    }
  }
  const naSprite = glow(rgb(INK.na), 0.5);

  const drawPatch = (ctx: CanvasRenderingContext2D, realDt: number): void => {
    const c = currents(s, p);
    const iK = c.iK + c.iLeakK; // outward positive
    const iNa = c.iNa + c.iLeakNa; // inward negative
    const gKtot = c.gK + p.gLeakK;
    const gNaTot = c.gNa + p.gLeakNa;

    // panel
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    roundRect(ctx, patch.x, patch.y, patch.w, patch.h, 10);
    ctx.fill();

    // the concentration gradients: Na⁺ crowds the outside, K⁺ the inside
    for (const d of dots) {
      ctx.fillStyle = d.na ? rgba(INK.na, 0.32) : rgba(INK.k, 0.32);
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = font(10, 600);
    ctx.fillStyle = INK.muted;
    ctx.fillText("OUTSIDE", patch.x + 10, patch.y + 16);
    ctx.fillText("INSIDE", patch.x + 10, bandY + bandH + 20);

    // bilayer
    const px0 = patch.x + 8;
    const pw = patch.w - 16;
    ctx.fillStyle = "rgba(122,162,255,0.08)";
    ctx.fillRect(px0, bandY, pw, bandH);
    const heads = Math.floor(pw / 7);
    for (let i = 0; i < heads; i++) {
      const x = px0 + (i + 0.5) * (pw / heads);
      ctx.fillStyle = "rgba(160,180,230,0.35)";
      ctx.beginPath();
      ctx.arc(x, bandY + 2.5, 2.4, 0, Math.PI * 2);
      ctx.arc(x, bandY + bandH - 2.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // pores: width shows how open that ion's pathway is
    const pore = (fx: number, color: string, open: number): void => {
      const x = px0 + fx * pw;
      const half = 3 + Math.min(1, open) * 5;
      ctx.fillStyle = INK.bg;
      ctx.fillRect(x - half, bandY - 1, half * 2, bandH + 2);
      ctx.fillStyle = rgba(color, 0.85);
      ctx.fillRect(x - half - 4, bandY - 2, 4, bandH + 4);
      ctx.fillRect(x + half, bandY - 2, 4, bandH + 4);
    };
    for (const fx of kPores) pore(fx, INK.k, gKtot / 1.2);
    for (const fx of naPores) pore(fx, INK.na, gNaTot / 0.4);

    // ions: K⁺ leaves through K⁺ pores, Na⁺ enters through Na⁺ pores, at a
    // rate that grows with the current (compressed, so a spike doesn't flood)
    const rate = (i: number): number => 5 * Math.pow(Math.abs(i), 0.55);
    spawnK += rate(iK) * realDt;
    spawnNa += rate(iNa) * realDt;
    while (spawnK >= 1 && ions.length < 220) {
      spawnK -= 1;
      const fx = kPores[Math.floor(r() * kPores.length)];
      ions.push({ x: fx, drift: r() * 2 - 1, y: 1.35, vy: -(0.7 + r() * 0.4) * Math.sign(iK || 1), kind: 0, life: 1 });
    }
    while (spawnNa >= 1 && ions.length < 220) {
      spawnNa -= 1;
      const fx = naPores[Math.floor(r() * naPores.length)];
      ions.push({ x: fx, drift: r() * 2 - 1, y: -0.35, vy: (0.7 + r() * 0.4) * Math.sign(-iNa || 1), kind: 1, life: 1 });
    }
    spawnK = Math.min(spawnK, 3);
    spawnNa = Math.min(spawnNa, 3);

    ctx.globalCompositeOperation = "lighter";
    for (let i = ions.length - 1; i >= 0; i--) {
      const ion = ions[i];
      ion.y += ion.vy * realDt * 1.1;
      const outside = ion.y < -0.6 || ion.y > 1.6;
      if (outside) {
        ions.splice(i, 1);
        continue;
      }
      // fan out once clear of the pore
      const spread = Math.max(0, ion.kind === 0 ? -ion.y : ion.y - 1);
      const x = px0 + (ion.x + ion.drift * spread * 0.09) * pw;
      const y = bandY + ion.y * bandH;
      const fade = 1 - Math.min(1, Math.max(0, ion.kind === 0 ? -ion.y - 0.1 : ion.y - 1.1) / 0.5);
      drawGlow(ctx, ion.kind === 0 ? kSprite : naSprite, x, y, 7, 0.9 * fade);
    }
    ctx.globalCompositeOperation = "source-over";

    // readout of the balance
    const ly = patch.y + patch.h - (wide ? 66 : 46);
    ctx.font = font(11, 600);
    ctx.fillStyle = INK.k;
    ctx.fillText("K⁺ out", patch.x + 12, ly);
    ctx.fillStyle = INK.na;
    ctx.fillText("Na⁺ in", patch.x + patch.w / 2 + 4, ly);
    ctx.font = font(10, 500, true);
    ctx.fillStyle = INK.text;
    ctx.fillText(`g ${gKtot.toFixed(2)} mS/cm²`, patch.x + 12, ly + 15);
    ctx.fillText(`g ${gNaTot.toFixed(3)} mS/cm²`, patch.x + patch.w / 2 + 4, ly + 15);
    ctx.fillText(`I ${fmtI(iK)} µA/cm²`, patch.x + 12, ly + 29);
    ctx.fillText(`I ${fmtI(iNa)} µA/cm²`, patch.x + patch.w / 2 + 4, ly + 29);
  };

  return {
    frame: () => {
      const simMs = clock.advance();
      runFor(
        target + simMs - sim.t,
        sim,
        (dt) => {
          stepHH(s, dt, p, 0);
          if (!above && s.v > 0) {
            above = true;
            spikeTimes.push(sim.t);
            if (spikeTimes.length > 200) spikeTimes.shift();
          } else if (above && s.v < -30) above = false;
        },
        () => trace.push(s.v),
      );
      target += simMs;

      const ctx = begin(sf);
      voltAxis(ctx, trBox, V_LO, V_HI, V_TICKS);
      const toY = (v: number): number => trBox.y + trBox.h * (1 - (v - V_LO) / (V_HI - V_LO));
      refLine(ctx, trBox, toY(E_NA), INK.na, `E_Na ${E_NA > 0 ? "+" : ""}${E_NA} mV`, false);
      refLine(ctx, trBox, toY(E_K), INK.k, `E_K ${E_K} mV`, false);
      const firing = spikeTimes.length > 0 && spikeTimes[spikeTimes.length - 1] > sim.t - 200;
      if (rest > V_LO && rest < E_NA) {
        ctx.font = font(10, 600);
        ctx.fillStyle = rgba(INK.volt, 0.8);
        const label = firing ? `balance point ${rest.toFixed(1)} mV, unstable` : `rest ${rest.toFixed(1)} mV`;
        ctx.fillText(label, trBox.x + 6, toY(rest) - 8);
      }
      plotTrace(ctx, trace, 0, trBox, V_LO, V_HI, INK.volt, 2, 7);
      // live dot at the newest sample
      ctx.globalCompositeOperation = "lighter";
      drawGlow(ctx, glow(rgb(INK.volt), 0.6), trBox.x + trBox.w, toY(s.v), 9, 0.9);
      ctx.globalCompositeOperation = "source-over";
      timeBar(ctx, trBox, trace.windowMs, 10);

      drawPatch(ctx, simMs / clock.msPerSecond);
      shell.tick();
    },
  };
}

function fmtI(i: number): string {
  const a = Math.abs(i);
  const v = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
  return `${i >= 0 ? "+" : "−"}${v}`;
}

// ---------------------------------------------------------------------------
// Fig: firing a spike

const PULSE_MS = 1;

export function mountSpike(container: HTMLElement): Demo {
  const wide = (container.clientWidth || 720) >= 560;
  const shell = new Shell(container, wide ? 0.6 : 1.2);
  const sf = surface(shell.canvas);
  const { w, h } = sf;

  const p: HHParams = { ...HH };
  const s = restingState(p);
  const clock = new Clock(8);
  const WINDOW = 40;
  const trace = new Trace(4, WINDOW, SAMPLE); // v, gNa, gK, stimulus
  trace.fill(s.v, 0, 0, 0);
  const sim = { t: 0, nextSample: SAMPLE };

  let amp = 10;
  let pulseEnd = -1;
  let pulseAmp = 0;
  let auto = true;
  let autoNext = 4;
  let autoBig = false;

  // what the last pulse did, for the caption and the labels on the trace
  interface Shot {
    t: number;
    amp: number;
    peak: number;
    peakT: number;
    trough: number;
    troughT: number;
    spiked: boolean;
    done: boolean;
    sincePrev: number; // ms since the previous spike, when the pulse began
  }
  const shots: Shot[] = [];

  const fire = (a: number): void => {
    pulseAmp = a;
    pulseEnd = sim.t + PULSE_MS;
    const prev = [...shots].reverse().find((sh) => sh.spiked);
    const sincePrev = prev ? sim.t - prev.peakT : Infinity;
    shots.push({ t: sim.t, amp: a, peak: s.v, peakT: sim.t, trough: s.v, troughT: sim.t, spiked: false, done: false, sincePrev });
    if (shots.length > 6) shots.shift();
  };

  shell.slider({
    label: "Pulse",
    min: 0,
    max: 20,
    step: 0.5,
    value: amp,
    format: (v) => `${v.toFixed(1)} µA/cm² × 1 ms`,
    onInput: (v) => {
      amp = v;
      auto = false;
    },
  });
  shell.button("stimulate", () => {
    auto = false;
    fire(amp);
  });
  shell.setInfo(() => {
    const last = shots[shots.length - 1];
    if (!last) return "";
    const what = last.spiked
      ? `spike, peak ${last.peak > 0 ? "+" : ""}${last.peak.toFixed(1)} mV`
      : `no spike, peak ${last.peak.toFixed(1)} mV`;
    const after = last.sincePrev < 40 ? ` · ${last.sincePrev.toFixed(0)} ms after the last spike` : "";
    return `${last.amp.toFixed(1)} µA/cm² pulse → ${what}${after}`;
  });

  const step = (dt: number): void => {
    const iExt = sim.t < pulseEnd ? pulseAmp : 0;
    stepHH(s, dt, p, iExt);
    for (const sh of shots) {
      if (sh.done) continue;
      if (s.v > sh.peak) {
        sh.peak = s.v;
        sh.peakT = sim.t;
      }
      if (s.v > 0) sh.spiked = true;
      if (sh.spiked && s.v < sh.trough && sim.t > sh.peakT) {
        sh.trough = s.v;
        sh.troughT = sim.t;
      }
      if (sim.t - sh.t > 18) sh.done = true;
    }
  };
  const sample = (): void => {
    const c = currents(s, p);
    trace.push(s.v, c.gNa, c.gK, sim.t < pulseEnd ? pulseAmp : 0);
  };

  // the auto demo alternates a pulse below threshold and one above it
  const autoTick = (): void => {
    if (!auto || sim.t < autoNext) return;
    fire(autoBig ? 10 : 4);
    autoBig = !autoBig;
    autoNext = sim.t + 20;
  };
  // start with both already on the trace
  while (sim.t < WINDOW - 2) {
    autoTick();
    runFor(0.5, sim, step, sample);
  }
  let target = sim.t;

  const vBox: Box = wide
    ? { x: 48, y: 24, w: w - 64, h: (h - 104) * 0.66 }
    : { x: 46, y: 24, w: w - 58, h: (h - 108) * 0.62 };
  const strip: Box = { x: vBox.x, y: vBox.y + vBox.h + 10, w: vBox.w, h: 14 };
  const gBox: Box = { x: vBox.x, y: strip.y + strip.h + 30, w: vBox.w, h: h - (strip.y + strip.h + 30) - 30 };
  const G_HI = 36;

  return {
    frame: () => {
      target += clock.advance();
      while (target - sim.t >= DT) {
        autoTick();
        runFor(Math.min(0.5, target - sim.t), sim, step, sample);
      }

      const ctx = begin(sf);
      const toX = (t: number): number => vBox.x + vBox.w - ((sim.t - t) / WINDOW) * vBox.w;
      const toY = (v: number): number => vBox.y + vBox.h * (1 - (v - V_LO) / (V_HI - V_LO));

      voltAxis(ctx, vBox, V_LO, V_HI, V_TICKS);
      refLine(ctx, vBox, toY(E_NA), INK.na, `E_Na +${E_NA}`, false);
      refLine(ctx, vBox, toY(E_K), INK.k, `E_K ${E_K}`, true);

      // the injected current, as a step trace in its own strip
      const stimBase = strip.y + strip.h;
      ctx.beginPath();
      for (let k = 0; k < trace.count; k++) {
        const x = strip.x + strip.w - (k / (trace.size - 1)) * strip.w;
        const y = stimBase - (trace.get(3, k) / 20) * strip.h;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(INK.spike, 0.85);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = font(10, 600);
      ctx.fillStyle = rgba(INK.spike, 0.8);
      ctx.textAlign = "right";
      ctx.fillText("pulse", strip.x - 6, stimBase - 2);
      ctx.textAlign = "left";

      plotTrace(ctx, trace, 0, vBox, V_LO, V_HI, INK.volt, 2, 7);

      // labels computed from each pulse's own response
      ctx.font = font(10, 600, true);
      for (const sh of shots) {
        const x = toX(sh.peakT);
        if (x < vBox.x + 10 || x > vBox.x + vBox.w) continue;
        if (sh.spiked) {
          ctx.fillStyle = INK.spike;
          ctx.textAlign = "left";
          ctx.fillText(`peak ${sh.peak > 0 ? "+" : ""}${sh.peak.toFixed(0)} mV`, x + 8, toY(sh.peak) + 4);
          if (sh.done || sim.t - sh.troughT > 3) {
            const tx = toX(sh.troughT);
            if (tx > vBox.x + 40) {
              ctx.fillStyle = INK.k;
              ctx.textAlign = "center";
              ctx.fillText(`${sh.trough.toFixed(0)} mV`, tx, toY(sh.trough) + 16);
            }
          }
        } else if (sh.done) {
          ctx.fillStyle = INK.muted;
          ctx.textAlign = "center";
          ctx.fillText(`${sh.peak.toFixed(1)} mV`, x, toY(sh.peak) - 10);
        }
        ctx.textAlign = "left";
      }
      timeBar(ctx, gBox, WINDOW, 5);

      // conductance panel
      ctx.font = font(10, 500, true);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const g of [0, 10, 20, 30]) {
        const y = gBox.y + gBox.h * (1 - g / G_HI);
        ctx.strokeStyle = g === 0 ? INK.axis : INK.grid;
        ctx.beginPath();
        ctx.moveTo(gBox.x, Math.round(y) + 0.5);
        ctx.lineTo(gBox.x + gBox.w, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.fillStyle = INK.muted;
        ctx.fillText(String(g), gBox.x - 6, y);
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      plotTrace(ctx, trace, 1, gBox, 0, G_HI, INK.na, 1.8, 6);
      plotTrace(ctx, trace, 2, gBox, 0, G_HI, INK.k, 1.8, 6);
      ctx.font = font(10, 600);
      ctx.fillStyle = INK.na;
      ctx.fillText("Na⁺ channels open", gBox.x + 6, gBox.y + 2);
      ctx.fillStyle = INK.k;
      ctx.fillText("K⁺ channels open", gBox.x + 118, gBox.y + 2);
      ctx.fillStyle = INK.faint;
      ctx.textAlign = "right";
      ctx.fillText("mS/cm²", gBox.x - 6, gBox.y - 8);
      ctx.textAlign = "left";

      ctx.globalCompositeOperation = "lighter";
      drawGlow(ctx, glow(rgb(INK.volt), 0.6), vBox.x + vBox.w, toY(s.v), 9, 0.9);
      ctx.globalCompositeOperation = "source-over";

      shell.tick();
    },
  };
}
