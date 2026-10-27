// Figs. 3 and 4 of "Consonance and Roughness": two tones with real
// harmonics. Top: both tones' partials on a log-frequency axis; pairs that
// land on top of each other flare white, pairs that land close enough to
// beat glow red, as bright as their roughness. Bottom: the total roughness
// for every interval (every pair of partials through the Plomp–Levelt
// curve, summed; Sethares' model). The valleys are found in that curve and
// labelled from it. Drag along the curve to choose the interval.
//
// "harmonic" mode varies the number of harmonics and the register; "timbre"
// mode swaps the tones for inharmonic spectra and the valleys move.

import type { Demo } from "../../lib/demoShell";
import { Partials, unlockAudio, roughness, dyadRoughness, justNear, etNear, withArticle, guardSound } from "./sound/core";
import { Stage, PlayPill, playButton, choice, glowStroke, glowDot, rgba, mix, text, hline, vline, BLUE, ORANGE, RED } from "./sound/draw";

interface Timbre {
  id: string;
  label: string;
  ratios: number[];
  amps: number[];
  grid?: number; // equal division whose steps to mark (e.g. 10)
}

const decay = (n: number): number => Math.pow(0.88, n);

function harmonic(P: number): Timbre {
  const ratios = Array.from({ length: P }, (_, i) => i + 1);
  return { id: "harmonic", label: "harmonic", ratios, amps: ratios.map((_, i) => decay(i)) };
}

const P7 = Array.from({ length: 7 }, (_, i) => i + 1);
export const TIMBRES: Timbre[] = [
  harmonic(7),
  // pseudo-octave of 2.1: partial n sits at 2.1^log2(n) (Sethares' stretched timbres)
  { id: "stretched", label: "stretched", ratios: P7.map((n) => Math.pow(2.1, Math.log2(n))), amps: P7.map((_, i) => decay(i)) },
  // a stiff string: f_n = n f √(1 + B n²), with B = 0.002 (piano treble territory)
  {
    id: "stiff",
    label: "stiff string",
    ratios: P7.map((n) => (n * Math.sqrt(1 + 0.002 * n * n)) / Math.sqrt(1.002)),
    amps: P7.map((_, i) => decay(i)),
  },
  // a uniform metal bar, free at both ends: modes at (βL)² ratios
  { id: "bar", label: "metal bar", ratios: [1, 2.756, 5.404, 8.933, 13.345], amps: [1, 0.7, 0.5, 0.35, 0.25] },
  // harmonics nudged to the nearest step of 10 equal divisions of the octave
  {
    id: "tet10",
    label: "10-TET spectrum",
    ratios: P7.map((n) => Math.pow(2, Math.round(10 * Math.log2(n)) / 10)),
    amps: P7.map((_, i) => decay(i)),
    grid: 10,
  },
];

export interface DissOpts {
  mode: "harmonic" | "timbre";
}

const CURVE = 480;

export async function mountComb(container: HTMLElement, opts: DissOpts = { mode: "harmonic" }): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.7, narrowAspect: 1.35, touch: "pan-y" });
  const { shell, canvas } = stage;
  const timbreMode = opts.mode === "timbre";

  let base = 220;
  let partials = 7;
  let timbre: Timbre = timbreMode ? TIMBRES[1] : harmonic(partials);
  const RMAX = timbreMode ? 2.2 : 2.08;
  let ratio = timbreMode ? 2.1 : 3 / 2;
  let playing = false;

  // ---- the landscape ------------------------------------------------------------
  const curve = new Float64Array(CURVE);
  let valleys: { r: number; depth: number }[] = [];
  const ratioAt = (i: number): number => Math.pow(RMAX, i / (CURVE - 1));
  const rough = (r: number): number => {
    const fa = timbre.ratios.map((x) => x * base);
    return dyadRoughness(fa, timbre.amps, fa.map((f) => f * r), timbre.amps);
  };
  let peak = 1;
  const rebuild = (): void => {
    peak = 1e-12;
    for (let i = 0; i < CURVE; i++) {
      curve[i] = rough(ratioAt(i));
      peak = Math.max(peak, curve[i]);
    }
    for (let i = 0; i < CURVE; i++) curve[i] /= peak;
    // valleys: local minima at least 2% of the peak below their surroundings
    valleys = [];
    const win = Math.round((CURVE * 0.4) / (12 * Math.log2(RMAX))); // ~40 cents
    for (let i = 1; i < CURVE - 1; i++) {
      if (!(curve[i] < curve[i - 1] && curve[i] <= curve[i + 1])) continue;
      let l = 0;
      let r = 0;
      for (let k = Math.max(0, i - win); k < i; k++) l = Math.max(l, curve[k]);
      for (let k = i + 1; k <= Math.min(CURVE - 1, i + win); k++) r = Math.max(r, curve[k]);
      const depth = Math.min(l, r) - curve[i];
      if (depth > 0.02) {
        // refine on a fine grid around the sample
        let best = ratioAt(i);
        let bv = Infinity;
        for (let s = -20; s <= 20; s++) {
          const rr = ratioAt(i) * Math.pow(2, s / 2400);
          const v = rough(rr);
          if (v < bv) {
            bv = v;
            best = rr;
          }
        }
        valleys.push({ r: best, depth });
      }
    }
    if (curve[CURVE - 1] < curve[CURVE - 2] && RMAX < 2.1) valleys.push({ r: RMAX, depth: 0 });
  };
  rebuild();
  const curveAt = (r: number): number => {
    const u = (Math.log(r) / Math.log(RMAX)) * (CURVE - 1);
    const i = Math.max(0, Math.min(CURVE - 2, Math.floor(u)));
    return curve[i] + (curve[i + 1] - curve[i]) * (u - i);
  };

  // ---- sound ---------------------------------------------------------------------
  const MAXP = 12;
  const ta = new Partials(MAXP, { level: 1 });
  const tb = new Partials(MAXP, { level: 1 });
  const voice = (glide: number): void => {
    let ss = 0;
    for (const a of timbre.amps) ss += a * a;
    const k = 0.055 / Math.sqrt(ss / 2);
    const fa: number[] = [];
    const fb: number[] = [];
    const am: number[] = [];
    for (let i = 0; i < MAXP; i++) {
      const rr = timbre.ratios[i] ?? 1;
      fa.push(base * rr);
      fb.push(base * rr * ratio);
      am.push(i < timbre.ratios.length && base * rr * ratio < 12000 ? timbre.amps[i] * k : 0);
    }
    ta.set(fa, am, glide);
    tb.set(fb, am, glide);
  };
  voice(0);
  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    if (on) {
      voice(0);
      ta.start(0.12);
      tb.start(0.12);
    } else {
      ta.stop(0.15);
      tb.stop(0.15);
    }
    sync(on);
    pill.show(!on);
  };
  const toggle = (): void => {
    void unlockAudio().then(() => setPlaying(!playing));
  };
  const pill = new PlayPill(stage, "Tap to play the two tones", toggle, "top");
  const sync = playButton(stage, ["▶ play", "■ stop"], toggle);
  const setRatio = (r: number, glide = 0.04): void => {
    ratio = Math.max(1, Math.min(RMAX, r));
    voice(glide);
  };

  if (timbreMode) {
    choice(
      stage,
      TIMBRES.map((t) => ({ id: t.id, label: t.label })),
      timbre.id,
      (id) => {
        timbre = TIMBRES.find((t) => t.id === id)!;
        rebuild();
        // land in the deepest valley that isn't the unison
        const v = valleys.filter((x) => x.r > 1.03).sort((a, b) => b.depth - a.depth)[0];
        if (v) setRatio(v.r, 0.08);
        else voice(0.05);
      },
    );
  } else {
    shell.slider({
      label: "harmonics per tone",
      min: 1,
      max: 12,
      step: 1,
      value: partials,
      format: (v) => (v === 1 ? "1 (pure sine)" : String(v)),
      onInput: (v) => {
        partials = v;
        timbre = harmonic(v);
        rebuild();
        voice(0.05);
      },
    });
    choice(
      stage,
      [
        { id: "131", label: "low (C3)" },
        { id: "220", label: "middle (A3)" },
        { id: "440", label: "high (A4)" },
      ],
      "220",
      (id) => {
        base = id === "131" ? 130.81 : Number(id);
        rebuild();
        voice(0.05);
      },
    );
  }

  const guard = guardSound(container, () => setPlaying(false));

  // ---- input on the curve ------------------------------------------------------------
  const geo = { x0: 0, x1: 0, cy0: 0, cy1: 0 };
  const rOf = (x: number): number => Math.pow(RMAX, Math.max(0, Math.min(1, (x - geo.x0) / (geo.x1 - geo.x0))));
  const xOf = (r: number): number => geo.x0 + (Math.log(r) / Math.log(RMAX)) * (geo.x1 - geo.x0);
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = stage.local(e);
    if (y < geo.cy0 - 30) return;
    dragging = true;
    setRatio(rOf(x));
    void unlockAudio().then(() => setPlaying(true));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging || !stage.pointer.down) return;
    const [x] = stage.local(e);
    setRatio(rOf(x));
  });
  const release = (): void => {
    if (!dragging) return;
    dragging = false;
    let best: number | null = null;
    for (const v of valleys) if (Math.abs(1200 * Math.log2(ratio / v.r)) < 18 && (best === null || Math.abs(v.r - ratio) < Math.abs(best - ratio))) best = v.r;
    if (best !== null) setRatio(best, 0.08);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  const nameOf = (r: number, tol = 10): string => {
    const j = justNear(r, tol);
    if (j && timbre.id === "harmonic") return `${j.p}:${j.q}`;
    if (timbre.grid) {
      const k = Math.round(timbre.grid * Math.log2(r));
      if (Math.abs(1200 * Math.log2(r) - (1200 * k) / timbre.grid) < 8) return `${k}\\${timbre.grid}`;
    }
    if (j && timbre.id !== "stretched") return `${j.p}:${j.q}`;
    return r.toFixed(3);
  };

  shell.setInfo(() => {
    const cents = 1200 * Math.log2(ratio);
    const j = justNear(ratio, 4);
    const et = etNear(ratio);
    const what = j ? `${j.p}:${j.q}, ${j.name}` : `${ratio.toFixed(3)}, near ${withArticle(et.name)}`;
    return `${timbre.label} tones on ${Math.round(base)} Hz · ${what} · ${Math.round(cents)}¢ · roughness ${Math.round(curveAt(ratio) * 100)}% of the worst`;
  });

  // ---- drawing -----------------------------------------------------------------------
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const g = stage.begin();
      const W = stage.w;
      const H = stage.h;
      const narrow = stage.narrow;
      const t = performance.now() / 1000;
      const x0 = 16;
      const x1 = W - 16;

      // ---- the two combs ----
      const top0 = 26;
      const top1 = H * (narrow ? 0.38 : 0.4);
      const mid = (top0 + top1) / 2 + 4;
      const reach = (top1 - top0) / 2 - 6;
      const maxR = Math.max(...timbre.ratios) * RMAX;
      const span = Math.log2(maxR) + 0.15;
      const fx = (rel: number): number => x0 + 6 + (Math.log2(rel) / span) * (x1 - x0 - 12);
      hline(g, x0, x1, mid, "rgba(122,162,255,0.12)");
      text(g, `tone A, ${Math.round(base)} Hz`, x0, top0 - 8, { size: 10, color: rgba(BLUE, 0.85) });
      text(g, `tone B, ${(base * ratio).toFixed(1)} Hz`, x1, top0 - 8, { size: 10, align: "right", color: rgba(ORANGE, 0.9) });
      const n = timbre.ratios.length;
      for (let i = 0; i < n; i++) {
        const a = timbre.amps[i];
        const pa = new Path2D();
        const xa = fx(timbre.ratios[i]);
        pa.moveTo(xa, mid - 3);
        pa.lineTo(xa, mid - 3 - reach * (0.25 + 0.75 * a));
        glowStroke(g, pa, BLUE, 1.2, 0.85);
        const pb = new Path2D();
        const xb = fx(timbre.ratios[i] * ratio);
        pb.moveTo(xb, mid + 3);
        pb.lineTo(xb, mid + 3 + reach * (0.25 + 0.75 * a));
        glowStroke(g, pb, ORANGE, 1.2, 0.85);
      }
      // verdicts on every pair
      // the worst a single pair can be (same height at any pitch)
      const pairMax = Math.exp(-3.51 * 0.2203) - Math.exp(-5.75 * 0.2203);
      let coincide = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const fa = timbre.ratios[i] * base;
          const fb = timbre.ratios[j] * base * ratio;
          const cents = Math.abs(1200 * Math.log2(fb / fa));
          const xm = (fx(timbre.ratios[i]) + fx(timbre.ratios[j] * ratio)) / 2;
          const w = Math.min(timbre.amps[i], timbre.amps[j]);
          if (cents < 4) {
            coincide++;
            glowDot(g, xm, mid, 3 + 3 * w, [255, 250, 235], 0.8 + 0.2 * w);
          } else {
            const r = roughness(fa, timbre.amps[i], fb, timbre.amps[j]) / pairMax;
            if (r > 0.04) glowDot(g, xm, mid, 3 + 5 * r, RED, Math.min(1, r * 1.6) * (0.75 + 0.25 * Math.sin(t * 9 + i + j)));
          }
        }
      }

      // ---- the curve ----
      geo.x0 = x0 + 6;
      geo.x1 = x1 - 6;
      geo.cy0 = top1 + 40;
      geo.cy1 = H - 36;
      const cy = (v: number): number => geo.cy1 - v * (geo.cy1 - geo.cy0 - 8);
      // semitone grid
      for (let s = 0; s <= Math.floor(1200 * Math.log2(RMAX)); s += 100) {
        const x = xOf(Math.pow(2, s / 1200));
        vline(g, x, geo.cy0, geo.cy1, s % 1200 === 0 ? "rgba(122,162,255,0.16)" : "rgba(122,162,255,0.06)");
        if (s % 200 === 0 && (!narrow || s % 400 === 0)) {
          text(g, `${s}¢`, x, geo.cy1 + 13, { size: 9, align: s === 0 ? "left" : "center", color: "rgba(150,160,190,0.5)", mono: true });
        }
      }
      if (timbre.grid) {
        for (let k = 0; k <= Math.floor(timbre.grid * Math.log2(RMAX)); k++) {
          const x = xOf(Math.pow(2, k / timbre.grid));
          vline(g, x, geo.cy1 - 8, geo.cy1, rgba(ORANGE, 0.75), 1.5);
        }
      }
      const cp = new Path2D();
      const fill = new Path2D();
      fill.moveTo(geo.x0, geo.cy1);
      for (let i = 0; i < CURVE; i++) {
        const x = geo.x0 + (i / (CURVE - 1)) * (geo.x1 - geo.x0);
        const y = cy(curve[i]);
        if (i === 0) cp.moveTo(x, y);
        else cp.lineTo(x, y);
        fill.lineTo(x, y);
      }
      fill.lineTo(geo.x1, geo.cy1);
      fill.closePath();
      const fg = g.createLinearGradient(0, geo.cy0, 0, geo.cy1);
      fg.addColorStop(0, "rgba(255, 92, 84, 0.22)");
      fg.addColorStop(1, "rgba(255, 92, 84, 0.02)");
      g.fillStyle = fg;
      g.fill(fill);
      glowStroke(g, cp, mix(RED, ORANGE, 0.3), 1.3, 0.9);
      // valleys, labelled from the curve, in a row above the axis
      const placed: number[] = [];
      for (const v of [...valleys].sort((a, b) => b.depth - a.depth)) {
        const x = xOf(v.r);
        if (placed.some((p) => Math.abs(p - x) < (narrow ? 30 : 36))) continue;
        placed.push(x);
        const y = cy(curveAt(v.r));
        const on = Math.abs(1200 * Math.log2(ratio / v.r)) < 3;
        vline(g, x, y + 5, geo.cy1 - 16, on ? "rgba(255,236,200,0.55)" : "rgba(160,190,255,0.28)", 1, [2, 3]);
        glowDot(g, x, y, 1.6, on ? [255, 236, 200] : [160, 190, 255], 0.7);
        text(g, nameOf(v.r), x, geo.cy1 - 5, {
          size: narrow ? 9 : 10,
          align: "center",
          color: on ? "rgba(255,236,200,1)" : "rgba(170,190,240,0.85)",
          weight: on ? 700 : 600,
          mono: true,
        });
      }
      glowDot(g, xOf(ratio), cy(curveAt(ratio)), 3.6, [255, 240, 220], 1);
      vline(g, xOf(ratio), geo.cy0 - 4, geo.cy1, "rgba(255,236,200,0.25)");
      text(g, "total roughness for every interval · drag along it", geo.x0, geo.cy0 - 14, { size: 10.5, color: "rgba(180,188,210,0.8)" });
      if (!narrow) text(g, `${coincide} pair${coincide === 1 ? "" : "s"} of partials coincide`, x1, geo.cy0 - 14, { size: 10, align: "right", color: "rgba(255,240,220,0.75)" });
    },
    dispose() {
      setPlaying(false);
    },
  };
}
