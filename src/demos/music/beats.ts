// Fig. 1 of "Consonance and Roughness": two sine waves a few hertz apart.
// Left: 20 ms of both waves and their sum, sliding in and out of step.
// Right: the last second of the sum, whose outline swells and collapses
// |f2 − f1| times a second. Below: how rough the pair sounds as the gap
// grows (Plomp & Levelt's curve, in Sethares' fit), for the register you
// pick. The zones are read off that curve, not placed by hand.

import type { Demo } from "../../lib/demoShell";
import { ctx, dest, now, unlockAudio, roughness, noteLabel, guardSound } from "./sound/core";
import { Stage, PlayPill, playButton, choice, glowStroke, glowDot, rgba, mix, text, hline, vline, BLUE, ORANGE, RED, WHITE } from "./sound/draw";

const DMAX = 160; // Hz shown on the roughness axis

export async function mountBeats(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.68, narrowAspect: 1.3 });
  const { shell } = stage;

  let f1 = 220;
  let delta = 3;
  let playing = false;

  // ---- sound -------------------------------------------------------------------
  const c = ctx();
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(dest());
  let oa: OscillatorNode | null = null;
  let ob: OscillatorNode | null = null;
  let psi = 0; // phase of tone B relative to tone A, radians
  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    const t = now();
    if (on) {
      oa = c.createOscillator();
      ob = c.createOscillator();
      oa.frequency.value = f1;
      ob.frequency.value = f1 + delta;
      oa.connect(gain);
      ob.connect(gain);
      oa.start(t);
      ob.start(t);
      psi = 0; // both start in step
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.11, t, 0.04);
    } else {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, 0.04);
      const a = oa;
      const b = ob;
      oa = ob = null;
      window.setTimeout(() => {
        a?.stop();
        b?.stop();
        a?.disconnect();
        b?.disconnect();
      }, 300);
    }
    sync(on);
    pill.show(!on);
  };
  const retune = (): void => {
    const t = now();
    oa?.frequency.setTargetAtTime(f1, t, 0.01);
    ob?.frequency.setTargetAtTime(f1 + delta, t, 0.01);
  };
  const toggle = (): void => {
    void unlockAudio().then(() => setPlaying(!playing));
  };
  const pill = new PlayPill(stage, "Tap to play both tones", toggle, "top");
  const sync = playButton(stage, ["▶ play both", "■ stop"], toggle);
  shell.slider({
    label: "second tone, above the first",
    min: 0.1,
    max: DMAX,
    step: 0.1,
    value: delta,
    log: true,
    format: (v) => `+${v < 10 ? v.toFixed(1) : Math.round(v)} Hz`,
    onInput: (v) => {
      delta = v;
      retune();
    },
  });
  choice(
    stage,
    [
      { id: "110", label: "A2" },
      { id: "220", label: "A3" },
      { id: "440", label: "A4" },
      { id: "880", label: "A5" },
    ],
    "220",
    (id) => {
      f1 = Number(id);
      retune();
    },
  );

  const guard = guardSound(container, () => setPlaying(false));

  // the pair-roughness curve for this register, and the zones read off it
  const curveAt = (d: number): number => roughness(f1, 1, f1 + d, 1);
  const PEAK = curveAt(0.2203 / (0.24 / (0.0207 * 220 + 18.96))); // same height in every register
  const zones = (): { peakD: number; a: number; b: number } => {
    let peakD = 0;
    let best = -1;
    for (let d = 0.5; d <= 400; d += 0.5) {
      const v = curveAt(d);
      if (v > best) {
        best = v;
        peakD = d;
      }
    }
    let a = 0;
    let b = 0;
    for (let d = 0.5; d <= 400; d += 0.5) {
      if (!a && curveAt(d) > best * 0.5) a = d;
      if (a && !b && d > peakD && curveAt(d) < best * 0.5) b = d;
    }
    return { peakD, a, b };
  };

  shell.setInfo(() => {
    const cents = 1200 * Math.log2((f1 + delta) / f1);
    const z = zones();
    const zone = delta < 0.25 ? "unison: one steady tone" : delta < 10 ? `${delta.toFixed(1)} beats per second` : delta <= z.b ? "too fast to count: rough" : "smooth again: two notes";
    return `${noteLabel(f1)} ${f1} Hz + ${(f1 + delta).toFixed(1)} Hz · ${cents.toFixed(0)}¢ apart · ${zone}`;
  });

  let lastT = performance.now() / 1000;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const t = performance.now() / 1000;
      const dt = Math.min(0.1, t - lastT);
      lastT = t;
      psi = (psi + 2 * Math.PI * delta * dt) % (2 * Math.PI * 1000);

      const g = stage.begin();
      const W = stage.w;
      const H = stage.h;
      const narrow = stage.narrow;
      const pad = 14;
      const label = "rgba(180,188,210,0.8)";

      // ---- panels ----
      const topY0 = 30;
      const topY1 = H * (narrow ? 0.5 : 0.48);
      let zx0: number, zx1: number, zy0: number, zy1: number, sx0: number, sx1: number, sy0: number, sy1: number;
      if (narrow) {
        sx0 = pad;
        sx1 = W - pad;
        sy0 = topY0;
        sy1 = topY0 + (topY1 - topY0) * 0.48;
        zx0 = pad;
        zx1 = W - pad;
        zy0 = sy1 + 34;
        zy1 = topY1;
      } else {
        zx0 = pad;
        zx1 = W * 0.3;
        zy0 = topY0;
        zy1 = topY1;
        sx0 = W * 0.34;
        sx1 = W - pad;
        sy0 = topY0;
        sy1 = topY1;
      }

      // 20 ms: both waves and their sum
      {
        const mid = (zy0 + zy1) / 2;
        const half = (zy1 - zy0) / 2 - 4;
        hline(g, zx0, zx1, mid, "rgba(122,162,255,0.14)");
        text(g, "20 ms", zx0, zy0 - 10, { size: 10.5, color: label });
        const NPT = 260;
        const pa = new Path2D();
        const pb = new Path2D();
        const ps = new Path2D();
        for (let i = 0; i <= NPT; i++) {
          const tau = (i / NPT) * 0.02;
          const a = Math.sin(2 * Math.PI * f1 * tau);
          const b = Math.sin(2 * Math.PI * (f1 + delta) * tau + psi);
          const x = zx0 + (i / NPT) * (zx1 - zx0);
          const ya = mid - a * half * 0.42;
          const yb = mid - b * half * 0.42;
          const ys = mid - ((a + b) / 2) * half * 0.95;
          if (i === 0) {
            pa.moveTo(x, ya);
            pb.moveTo(x, yb);
            ps.moveTo(x, ys);
          } else {
            pa.lineTo(x, ya);
            pb.lineTo(x, yb);
            ps.lineTo(x, ys);
          }
        }
        g.save();
        g.globalCompositeOperation = "lighter";
        g.lineWidth = 1;
        g.strokeStyle = rgba(BLUE, 0.55);
        g.stroke(pa);
        g.strokeStyle = rgba(ORANGE, 0.55);
        g.stroke(pb);
        g.restore();
        glowStroke(g, ps, [255, 240, 220], 1.2, 0.85);
        const inStep = Math.cos(psi % (2 * Math.PI));
        text(g, inStep > 0.7 ? "in step: they add" : inStep < -0.7 ? "out of step: they cancel" : "", (zx0 + zx1) / 2, zy1 + 14, {
          size: 10,
          align: "center",
          color: rgba(inStep > 0 ? WHITE : MUTE, 0.75),
        });
      }

      // 1 second: the outline of the sum, |2 cos(πΔt)|
      {
        const mid = (sy0 + sy1) / 2;
        const half = (sy1 - sy0) / 2 - 4;
        text(g, "the last second of the sum", sx0, sy0 - 10, { size: 10.5, color: label });
        const beats = delta;
        text(g, delta < 0.25 ? "no beats" : `${beats < 10 ? beats.toFixed(1) : Math.round(beats)} swells per second`, sx1, sy0 - 10, {
          size: 10.5,
          align: "right",
          color: rgba(ORANGE, 0.9),
          weight: 600,
        });
        const cols = Math.max(80, Math.round(sx1 - sx0));
        const top = new Path2D();
        const env: number[] = [];
        for (let i = 0; i <= cols; i++) {
          const age = 1 - i / cols; // seconds ago
          env.push(Math.abs(Math.cos(psi / 2 - Math.PI * delta * age)));
        }
        const band = new Path2D();
        for (let i = 0; i <= cols; i++) {
          const x = sx0 + (i / cols) * (sx1 - sx0);
          const y = mid - env[i] * half;
          if (i === 0) {
            band.moveTo(x, y);
            top.moveTo(x, y);
          } else {
            band.lineTo(x, y);
            top.lineTo(x, y);
          }
        }
        const bot = new Path2D();
        for (let i = cols; i >= 0; i--) {
          const x = sx0 + (i / cols) * (sx1 - sx0);
          const y = mid + env[i] * half;
          band.lineTo(x, y);
          if (i === cols) bot.moveTo(x, y);
          else bot.lineTo(x, y);
        }
        band.closePath();
        const grd = g.createLinearGradient(0, sy0, 0, sy1);
        grd.addColorStop(0, "rgba(255, 220, 170, 0.32)");
        grd.addColorStop(0.5, "rgba(255, 220, 170, 0.08)");
        grd.addColorStop(1, "rgba(255, 220, 170, 0.32)");
        g.fillStyle = grd;
        g.fill(band);
        glowStroke(g, top, ORANGE, 1.1, 0.75);
        glowStroke(g, bot, ORANGE, 1.1, 0.75);
        hline(g, sx0, sx1, mid, "rgba(122,162,255,0.1)");
        for (let s = 0; s <= 4; s++) {
          const x = sx0 + (s / 4) * (sx1 - sx0);
          vline(g, x, sy1 + 2, sy1 + 6, "rgba(150,160,190,0.5)");
        }
        text(g, "−1 s", sx0, sy1 + 17, { size: 9.5, color: "rgba(150,160,190,0.55)", mono: true });
        text(g, "now", sx1, sy1 + 17, { size: 9.5, align: "right", color: "rgba(150,160,190,0.55)", mono: true });
      }

      // ---- the roughness of the pair, against the gap ----
      const rx0 = pad + 4;
      const rx1 = W - pad;
      const ry0 = topY1 + 52;
      const ry1 = H - 26;
      const dx = (d: number): number => rx0 + (d / DMAX) * (rx1 - rx0);
      const ry = (v: number): number => ry1 - (v / PEAK) * (ry1 - ry0 - 10);
      const z = zones();
      // zones
      const zoneFill = (a: number, b: number, col: string): void => {
        g.fillStyle = col;
        g.fillRect(dx(a), ry0, Math.max(0, dx(Math.min(b, DMAX)) - dx(a)), ry1 - ry0);
      };
      const beatsEnd = 10; // throbs you can count
      zoneFill(0, beatsEnd, "rgba(122,162,255,0.06)");
      zoneFill(beatsEnd, z.b, "rgba(255,92,84,0.07)");
      zoneFill(z.b, DMAX, "rgba(125,214,160,0.05)");
      const zl = (s: string, a: number, b: number, col: string): void => {
        const x = (dx(a) + dx(Math.min(b, DMAX))) / 2;
        if (dx(Math.min(b, DMAX)) - dx(a) < 40) return;
        text(g, s, x, ry1 - 8, { size: 10, align: "center", color: col, weight: 600 });
      };
      zl("beats", 0, beatsEnd, "rgba(160,190,255,0.85)");
      zl("rough", beatsEnd, z.b, "rgba(255,140,130,0.9)");
      zl("smooth: two notes", z.b, DMAX, "rgba(140,220,170,0.85)");
      hline(g, rx0, rx1, ry1, "rgba(122,162,255,0.2)");
      for (let d = 0; d < DMAX; d += 20) {
        text(g, `${d}`, dx(d), ry1 + 13, { size: 9.5, align: d === 0 ? "left" : "center", color: "rgba(150,160,190,0.55)", mono: true });
      }
      text(g, "Hz apart", rx1, ry1 + 13, { size: 9.5, align: "right", color: "rgba(150,160,190,0.55)", mono: true });
      const cp = new Path2D();
      for (let i = 0; i <= 240; i++) {
        const d = (i / 240) * DMAX;
        const x = dx(d);
        const y = ry(curveAt(d));
        if (i === 0) cp.moveTo(x, y);
        else cp.lineTo(x, y);
      }
      glowStroke(g, cp, mix(RED, ORANGE, 0.3), 1.3, 0.85);
      // the peak, a quarter of a critical band
      vline(g, dx(z.peakD), ry(PEAK) + 2, ry1, "rgba(255,140,130,0.35)", 1, [2, 4]);
      if (!narrow)
        text(g, `worst at ${Math.round(z.peakD)} Hz apart`, dx(z.peakD) + 6, ry(PEAK) + 12, { size: 9.5, color: "rgba(255,170,160,0.85)" });
      const md = Math.min(delta, DMAX);
      glowDot(g, dx(md), ry(curveAt(md)), 3.6, [255, 240, 220], 1);
      text(g, `roughness of two sines near ${f1} Hz`, rx0, ry0 - 10, { size: 10.5, color: label });
    },
    dispose() {
      setPlaying(false);
    },
  };
}

const MUTE: [number, number, number] = [150, 160, 190];
