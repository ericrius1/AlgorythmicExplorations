// Fig. 2 of "The Anatomy of a Note": one string, plucked or bowed. The
// picture and the sound come from the same modal model. A string fixed at
// both ends can only hold the standing waves sin(nπx), each ringing at n·f;
// any motion is a sum of them. A pluck is a triangle, which projects onto
// mode n as sin(nπp)/n² (p = where you plucked); the bridge feels the
// string's slope, which adds a factor of n, so the heard recipe is
// sin(nπp)/n. Bowing sets up Helmholtz motion: a sharp corner racing around
// the string inside a parabola, every harmonic at 1/n.

import type { Demo } from "../../lib/demoShell";
import { strike, damp, Partials, unlockAudio, audioOn, noteLabel, type Mode, guardSound } from "./sound/core";
import { Stage, PlayPill, choice, glowStroke, glowDot, harmonicRgb, rgba, mix, text, hline, vline, WHITE, GOLD, ORANGE, roundRect } from "./sound/draw";

const MODES = 24; // modes drawn
const BARS = 16; // harmonics shown in the recipe
const VIS_HZ = 1.25; // the drawn fundamental, whatever the pitch

type Mode2 = "pluck" | "bow";

export async function mountPluckString(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.6, narrowAspect: 1.05, touch: "none" });
  const { shell, canvas } = stage;

  let f0 = 110;
  let mode: Mode2 = "pluck";
  const decay = (f: number): number => Math.min(3.2, Math.max(0.12, 2.6 * Math.pow(110 / f, 0.6)));

  // complex mode amplitudes in units of the panel half-height
  const cr = new Float64Array(MODES + 1);
  const ci = new Float64Array(MODES + 1);
  // the sound's recipe right now (for the bars), and how it decays
  const recipe = new Float64Array(BARS + 1);
  let lastP = -1;
  let bowP = 0.12;
  let bowing = false;
  let bowAmp = 0; // Helmholtz amplitude, eases in while bowing
  let grab: { p: number; y: number } | null = null;
  const t = (): number => performance.now() / 1000;
  const w = (n: number): number => 2 * Math.PI * n * VIS_HZ;

  // ---- sound ------------------------------------------------------------------
  const bow = new Partials(20, { level: 0.08 });
  const bowRecipe = (): void => {
    const fr: number[] = [];
    const am: number[] = [];
    for (let n = 1; n <= 20; n++) {
      fr.push(n * f0);
      am.push(n * f0 < 9000 ? 1 / n : 0);
    }
    bow.set(fr, am, 0.02);
  };
  bowRecipe();

  const heard = (p: number, n: number): number => Math.sin(n * Math.PI * p) / n;

  let touched = false; // until someone plays, the string plucks itself (silently)
  const pluck = (p: number, h: number, audible = true): void => {
    p = Math.min(0.97, Math.max(0.03, p));
    const t0 = t();
    // a hand on the string stops what it was doing
    for (let n = 1; n <= MODES; n++) {
      cr[n] *= 0.1;
      ci[n] *= 0.1;
    }
    for (let n = 1; n <= MODES; n++) {
      const b = (2 * h * Math.sin(n * Math.PI * p)) / (n * n * Math.PI * Math.PI * p * (1 - p));
      cr[n] += b * Math.cos(-w(n) * t0);
      ci[n] += b * Math.sin(-w(n) * t0);
    }
    lastP = p;
    let peak = 1e-9;
    for (let n = 1; n <= BARS; n++) peak = Math.max(peak, Math.abs(heard(p, n)));
    for (let n = 1; n <= BARS; n++) recipe[n] = Math.abs(heard(p, n)) / peak;

    if (!audible || !audioOn()) return;
    damp(0.03);
    const modes: Mode[] = [];
    let sum = 0;
    for (let n = 1; n <= 30 && n * f0 < 9000; n++) {
      const a = heard(p, n);
      modes.push({ f: n * f0, a, tau: decay(n * f0) });
      sum += Math.abs(a);
    }
    const level = (0.26 * Math.min(1, Math.abs(h) / 0.5 + 0.3)) / Math.max(sum, 0.8);
    for (const m of modes) m.a *= level;
    strike(modes, { attack: 0.002 });
  };

  const startBow = (p: number): void => {
    bowP = Math.min(0.4, Math.max(0.04, p));
    bowing = true;
    for (let n = 1; n <= BARS; n++) recipe[n] = 1 / n;
    lastP = -1;
    if (audioOn()) {
      damp(0.05);
      bowRecipe();
      bow.start(0.12);
    }
  };
  const stopBow = (): void => {
    if (!bowing) return;
    bowing = false;
    // the string keeps ringing after the bow leaves: hand the sustained
    // motion to the free decay, and the sound to a ring-out
    if (audioOn() && bow.playing) {
      const modes: Mode[] = [];
      for (let n = 1; n <= 20 && n * f0 < 9000; n++) modes.push({ f: n * f0, a: (0.08 * 0.62) / n, tau: decay(n * f0) * 0.8 });
      strike(modes, { attack: 0.03 });
      bow.stop(0.06);
    }
  };

  // ---- input ------------------------------------------------------------------
  const geom = { xa: 0, xb: 0, ys: 0, amp: 0 };
  const pOf = (x: number): number => (x - geom.xa) / (geom.xb - geom.xa);
  const pill = new PlayPill(stage, "Drag the string and let go", () => {
    touched = true;
    void unlockAudio().then(() => {
      pill.show(false);
      if (mode === "pluck") pluck(0.5, 0.7);
    });
  }, "top");

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    touched = true;
    canvas.setPointerCapture(e.pointerId);
    pill.show(false);
    const [x, y] = stage.local(e);
    void unlockAudio().then(() => {
      if (mode === "bow") startBow(pOf(x));
    });
    if (mode === "pluck") grab = { p: Math.min(0.97, Math.max(0.03, pOf(x))), y: (geom.ys - y) / geom.amp };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!grab) return;
    const [, y] = stage.local(e);
    grab.y = Math.max(-1, Math.min(1, (geom.ys - y) / geom.amp));
  });
  const release = (): void => {
    if (grab) {
      const h = Math.abs(grab.y) < 0.06 ? 0.7 : grab.y;
      const p = grab.p;
      grab = null;
      void unlockAudio().then(() => pluck(p, h));
    }
    stopBow();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  let pluckBtns: HTMLButtonElement[] = [];
  choice(
    stage,
    [
      { id: "pluck", label: "pluck" },
      { id: "bow", label: "bow (hold)" },
    ],
    mode,
    (m) => {
      mode = m;
      stopBow();
      for (const b of pluckBtns) b.disabled = m === "bow";
      pill.setText(m === "bow" ? "Press and hold to bow" : "Drag the string and let go");
    },
  );
  const at = (label: string, p: number): void => {
    pluckBtns.push(
      shell.button(label, () => {
        touched = true;
        void unlockAudio().then(() => {
          pill.show(false);
          pluck(p, 0.7);
        });
      }),
    );
  };
  at("pluck at ½", 1 / 2);
  at("at ⅕", 1 / 5);
  at("near the end", 1 / 14);
  pluckBtns = pluckBtns.filter(Boolean);
  shell.slider({
    label: "pitch",
    min: 65,
    max: 330,
    step: 1,
    value: f0,
    log: true,
    format: (v) => `${Math.round(v)} Hz`,
    onInput: (v) => {
      f0 = v;
      bowRecipe();
    },
  });

  const guard = guardSound(container, () => {
    damp(0.1);
    bow.stop(0.1);
    bowing = false;
    grab = null;
  });

  // harmonics a pluck at p (nearly) removes: those with a node there
  const missing = (p: number): number[] => {
    const out: number[] = [];
    for (let n = 2; n <= BARS; n++) if (Math.abs(Math.sin(n * Math.PI * p)) < 0.07) out.push(n);
    return out;
  };
  const fracName = (p: number): string => {
    for (let q = 2; q <= 16; q++) {
      const k = Math.round(p * q);
      if (k > 0 && Math.abs(p - k / q) < 0.004) return k === 1 ? `1/${q}` : `${k}/${q}`;
    }
    return p.toFixed(2);
  };

  shell.setInfo(() => `${noteLabel(f0)} · ${Math.round(f0)} Hz · drawn ${Math.round(f0 / VIS_HZ)}× slower than it sounds`);

  // ---- drawing ------------------------------------------------------------------
  const PTS = 220;
  let lastT = t();
  const AUTO = [1 / 2, 1 / 5, 1 / 14, 1 / 3];
  let autoAt = t() + 0.4;
  let autoIdx = 0;

  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = t();
      const dt = Math.min(0.1, now - lastT);
      lastT = now;
      if (!touched && mode === "pluck" && now > autoAt) {
        pluck(AUTO[autoIdx++ % AUTO.length], 0.55, false);
        autoAt = now + 4.5;
      }

      const g = stage.begin();
      const W = stage.w;
      const H = stage.h;
      geom.xa = W * 0.05;
      geom.xb = W * 0.95;
      geom.ys = H * (stage.narrow ? 0.3 : 0.32);
      geom.amp = H * (stage.narrow ? 0.17 : 0.2);
      const { xa, xb, ys, amp } = geom;

      // bowing: Helmholtz motion, Σ sin(nπx) sin(nθ)/n², eased in
      if (bowing) bowAmp += (0.62 - bowAmp) * Math.min(1, dt * 6);
      else bowAmp = 0;
      if (bowing) {
        const scale = (8 / (Math.PI * Math.PI)) * bowAmp;
        for (let n = 1; n <= MODES; n++) {
          // sin(nθ) = Re[e^{i(nθ − π/2)}]
          cr[n] = 0;
          ci[n] = -scale / (n * n);
        }
      } else {
        for (let n = 1; n <= MODES; n++) {
          const k = Math.exp(-dt / decay(n * f0));
          cr[n] *= k;
          ci[n] *= k;
        }
        for (let n = 1; n <= BARS; n++) recipe[n] *= Math.exp(-dt / decay(n * f0));
      }

      // the shape now
      const ys2 = new Float32Array(PTS);
      let energy = 0;
      if (grab) {
        for (let j = 0; j < PTS; j++) {
          const x = j / (PTS - 1);
          ys2[j] = grab.y * (x <= grab.p ? x / grab.p : (1 - x) / (1 - grab.p));
        }
        energy = Math.abs(grab.y);
      } else {
        for (let n = 1; n <= MODES; n++) energy += cr[n] * cr[n] + ci[n] * ci[n];
        energy = Math.sqrt(energy);
        const y = ys2;
        // the string now: every mode swinging at its own rate, n × the fundamental
        for (let n = 1; n <= MODES; n++) {
          const swing = cr[n] * Math.cos(w(n) * now) - ci[n] * Math.sin(w(n) * now);
          for (let j = 0; j < PTS; j++) y[j] += swing * Math.sin((n * Math.PI * j) / (PTS - 1));
        }
      }

      // envelope of the bowed motion: the parabola the corner runs around
      if (bowing) {
        const env = new Path2D();
        const env2 = new Path2D();
        for (let j = 0; j < PTS; j++) {
          const x = j / (PTS - 1);
          const e = 4 * x * (1 - x) * bowAmp * 0.5 * 2;
          const px = xa + x * (xb - xa);
          if (j === 0) {
            env.moveTo(px, ys - e * amp);
            env2.moveTo(px, ys + e * amp);
          } else {
            env.lineTo(px, ys - e * amp);
            env2.lineTo(px, ys + e * amp);
          }
        }
        g.save();
        g.setLineDash([3, 5]);
        g.strokeStyle = rgba(ORANGE, 0.35);
        g.lineWidth = 1;
        g.stroke(env);
        g.stroke(env2);
        g.restore();
      }

      // ghost of the first missing harmonic: its node sits where you plucked
      const miss = lastP > 0 && !bowing ? missing(lastP) : [];
      if (miss.length && !grab) {
        const n = miss[0];
        const c = harmonicRgb(n);
        const ghost = new Path2D();
        for (let j = 0; j < PTS; j++) {
          const px = xa + (j / (PTS - 1)) * (xb - xa);
          const py = ys - Math.sin((n * Math.PI * j) / (PTS - 1)) * amp * 0.32;
          if (j === 0) ghost.moveTo(px, py);
          else ghost.lineTo(px, py);
        }
        g.save();
        g.setLineDash([2, 4]);
        g.strokeStyle = rgba(c, 0.4);
        g.lineWidth = 1;
        g.stroke(ghost);
        g.restore();
        for (let k = 1; k < n; k++) glowDot(g, xa + (k / n) * (xb - xa), ys, 1.6, c, 0.6);
      }

      // posts at both ends
      for (const x of [xa, xb]) {
        g.save();
        g.fillStyle = "rgba(255, 214, 140, 0.22)";
        roundRect(g, x - 3, ys - amp * 0.55, 6, amp * 1.1, 3);
        g.fill();
        g.restore();
      }
      hline(g, xa, xb, ys, "rgba(122,162,255,0.08)");

      // the string
      const path = new Path2D();
      for (let j = 0; j < PTS; j++) {
        const px = xa + (j / (PTS - 1)) * (xb - xa);
        const py = ys - ys2[j] * amp;
        if (j === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
      }
      const hot = Math.min(1, energy * 1.4);
      glowStroke(g, path, mix(GOLD, [255, 236, 200], hot * 0.5), 1.6 + hot * 0.6, 0.65 + 0.35 * hot);

      // where the finger / bow is
      const markP = grab ? grab.p : bowing ? bowP : lastP;
      if (markP > 0) {
        const mx = xa + markP * (xb - xa);
        vline(g, mx, ys - amp * 1.12, ys - amp * 1.02, rgba(ORANGE, 0.8), 1.4);
        text(g, bowing ? "bow" : grab ? "finger" : `plucked at ${fracName(markP)}`, mx, ys - amp * 1.12 - 5, {
          size: 10.5,
          align: mx < W * 0.15 ? "left" : mx > W * 0.85 ? "right" : "center",
          color: rgba(ORANGE, 0.9),
          weight: 600,
        });
      }

      // ---- the recipe: one bar per harmonic ----
      const by1 = H - 30;
      const by0 = H * (stage.narrow ? 0.62 : 0.64);
      const bw = (xb - xa) / BARS;
      text(g, bowing ? "what you hear: every harmonic, falling as 1/n" : "what you hear: harmonic n at sin(nπp)/n", xa, by0 - 10, {
        size: 10.5,
        color: "rgba(180,188,210,0.8)",
      });
      if (miss.length && !grab) {
        const list = miss.slice(0, 4).join(", ") + (miss.length > 4 ? " …" : "");
        text(g, `missing: ${list}`, xb, by0 - 10, { size: 10.5, align: "right", color: rgba(harmonicRgb(miss[0], 0.75), 0.95), weight: 600 });
      }
      hline(g, xa, xb, by1, "rgba(122,162,255,0.18)");
      for (let n = 1; n <= BARS; n++) {
        const cx = xa + (n - 0.5) * bw;
        const v = Math.min(1, recipe[n]);
        const c = harmonicRgb(n);
        const bh = v * (by1 - by0 - 6);
        if (bh > 0.5) {
          g.save();
          g.globalCompositeOperation = "lighter";
          const grd = g.createLinearGradient(0, by1 - bh, 0, by1);
          grd.addColorStop(0, rgba(mix(c, WHITE, 0.25), 0.95));
          grd.addColorStop(1, rgba(c, 0.35));
          g.fillStyle = grd;
          roundRect(g, cx - bw * 0.3, by1 - bh, bw * 0.6, bh, 2);
          g.fill();
          g.restore();
        }
        const isMiss = miss.includes(n);
        text(g, String(n), cx, by1 + 14, {
          size: stage.narrow ? 9 : 10.5,
          align: "center",
          color: isMiss ? rgba(harmonicRgb(n, 0.75), 0.95) : "rgba(150,160,190,0.6)",
          weight: isMiss ? 700 : 500,
          mono: true,
        });
        if (isMiss) {
          g.save();
          g.strokeStyle = rgba(c, 0.5);
          g.setLineDash([2, 3]);
          g.strokeRect(cx - bw * 0.3, by0 + 4, bw * 0.6, by1 - by0 - 4);
          g.restore();
        }
      }
    },
    dispose() {
      damp(0.1);
      bow.stop();
    },
  };
}
