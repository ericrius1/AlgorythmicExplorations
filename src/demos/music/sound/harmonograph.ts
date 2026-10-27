// Hero for "Consonance and Roughness": two tones as a harmonograph. Tone A
// (220 Hz) drives the pen sideways, tone B drives it up and down, and the
// trace slowly dies away like a pendulum drawing. Simple ratios close into
// knots; everything else weaves. Across the top runs the roughness of the
// same two tones (seven harmonics each, Plomp–Levelt/Sethares) for every
// interval in the octave: drag along it to choose the interval.

import type { Demo } from "../../../lib/demoShell";
import { Partials, unlockAudio, dyadRoughness, justNear, etNear, withArticle, guardSound } from "./core";
import { Stage, PlayPill, glowStroke, glowDot, rgba, mix, text, BLUE, ORANGE, RED } from "./draw";

const F1 = 220;
const P = 7;
const AMPS = Array.from({ length: P }, (_, i) => Math.pow(0.88, i));
const CURVE = 360;
const GLIDE_S = 2.6;
const TOUR = [1, 2, 3 / 2, 4 / 3, 5 / 3, 5 / 4, 6 / 5, 45 / 32, 8 / 5, 9 / 8, 7 / 4, 15 / 8];

export async function mountHarmonograph(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.5, narrowAspect: 1.05, touch: "pan-y" });
  const { shell, canvas } = stage;
  const overlay = !container.closest(".hero-title-below") && window.matchMedia("(min-width: 46rem)").matches;
  const navH = Math.min(stage.navCover(), stage.h * 0.3);

  // the roughness landscape over one octave (log-spaced ratios)
  const fa = AMPS.map((_, i) => F1 * (i + 1));
  const curve = new Float64Array(CURVE);
  let peak = 1e-9;
  for (let i = 0; i < CURVE; i++) {
    const r = Math.pow(2, i / (CURVE - 1));
    curve[i] = dyadRoughness(fa, AMPS, fa.map((f) => f * r), AMPS);
    peak = Math.max(peak, curve[i]);
  }
  for (let i = 0; i < CURVE; i++) curve[i] /= peak;
  const roughAt = (r: number): number => {
    const u = Math.log2(r) * (CURVE - 1);
    const i = Math.max(0, Math.min(CURVE - 2, Math.floor(u)));
    return curve[i] + (curve[i + 1] - curve[i]) * (u - i);
  };
  // named valleys: local minima that sit on a just ratio
  const valleys: { r: number; label: string }[] = [];
  for (let i = 1; i < CURVE - 1; i++) {
    if (curve[i] <= curve[i - 1] && curve[i] <= curve[i + 1]) {
      const r = Math.pow(2, i / (CURVE - 1));
      const j = justNear(r, 12);
      if (j) valleys.push({ r: j.p / j.q, label: `${j.p}:${j.q}` });
    }
  }
  valleys.push({ r: 1, label: "1:1" }, { r: 2, label: "2:1" });

  // ---- sound -------------------------------------------------------------------
  const lo = new Partials(P, { level: 1 });
  const hi = new Partials(P, { level: 1 });
  const GAIN = 0.045;
  lo.set(fa, AMPS.map((a) => a * GAIN), 0);
  let ratio = 3 / 2;
  let shown = ratio;
  const tune = (glide: number): void => hi.set(fa.map((f) => f * ratio), AMPS.map((a) => a * GAIN), glide);
  tune(0);
  let sounding = false;
  const setSound = (on: boolean): void => {
    sounding = on;
    if (on) {
      lo.start(0.4);
      hi.start(0.4);
    } else {
      lo.stop(0.4);
      hi.stop(0.4);
    }
    syncBtn();
    pill.show(!on);
  };
  const btn = shell.button("▶ sound", () => {
    void unlockAudio().then(() => setSound(!sounding));
  });
  btn.classList.add("ms-play");
  const syncBtn = (): void => {
    btn.textContent = sounding ? "■ sound" : "▶ sound";
    btn.classList.toggle("is-on", sounding);
  };
  const pill = new PlayPill(stage, "Tap to play · drag along the curve", () => {
    void unlockAudio().then(() => setSound(true));
  });
  pill.el.classList.add("ms-hero-pill");

  const guard = guardSound(container, () => {
    if (sounding) {
      lo.stop(0.2);
      hi.stop(0.2);
      sounding = false;
      syncBtn();
      pill.show(true);
    }
  });

  // ---- layout ------------------------------------------------------------------
  const lay = { x0: 0, x1: 0, cy0: 0, cy1: 0, fx: 0, fy: 0, R: 0 };
  const layout = (): void => {
    const { w, h } = stage;
    lay.x0 = w * (stage.narrow ? 0.07 : 0.14);
    lay.x1 = w - lay.x0;
    lay.cy0 = navH + (stage.narrow ? 34 : 40);
    lay.cy1 = lay.cy0 + Math.max(46, h * (stage.narrow ? 0.14 : 0.13));
    const bottom = overlay ? h * 0.66 : h - 16;
    const top = lay.cy1 + 28;
    lay.R = Math.max(30, Math.min((bottom - top) / 2, w * 0.36));
    lay.fx = w / 2;
    lay.fy = top + (bottom - top) / 2;
  };
  layout();
  const xOf = (r: number): number => lay.x0 + Math.log2(r) * (lay.x1 - lay.x0);
  const rOf = (x: number): number => Math.pow(2, Math.max(0, Math.min(1, (x - lay.x0) / (lay.x1 - lay.x0))));

  // ---- input: drag sets the interval; release snaps to a named one nearby ------
  let lastHuman = -1e9;
  let dragging = false;
  const clock = (): number => performance.now() / 1000;
  const setRatio = (r: number, glide: number): void => {
    ratio = r;
    tune(glide);
  };
  canvas.addEventListener("pointerdown", (e) => {
    const [x] = stage.local(e);
    dragging = true;
    lastHuman = clock();
    tourFrom = -1;
    setRatio(rOf(x), 0.05);
    void unlockAudio().then(() => {
      if (!sounding) setSound(true);
    });
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging || !stage.pointer.down) return;
    const [x] = stage.local(e);
    lastHuman = clock();
    setRatio(rOf(x), 0.04);
  });
  const release = (): void => {
    if (!dragging) return;
    dragging = false;
    const j = justNear(ratio, 14);
    if (j) setRatio(j.p / j.q, 0.12);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // ---- the tour: glide from interval to interval until someone drags -----------
  let tourIdx = 2; // TOUR[2] is 3:2: hold it first, then glide on
  let tourFrom = ratio; // ratio at the start of the current glide
  let tourT = clock() - GLIDE_S;
  const GLIDE = GLIDE_S;
  const HOLD = 4.2;
  const tour = (t: number): void => {
    if (t - lastHuman < 9) return;
    const target = TOUR[tourIdx];
    if (tourFrom < 0) {
      tourFrom = ratio;
      tourT = t;
    }
    const u = Math.min(1, (t - tourT) / GLIDE);
    const e = u * u * (3 - 2 * u);
    const r = Math.pow(2, Math.log2(tourFrom) + (Math.log2(target) - Math.log2(tourFrom)) * e);
    if (Math.abs(r - ratio) > 1e-6) setRatio(r, 0.05);
    if (t - tourT > GLIDE + HOLD) {
      tourIdx = (tourIdx + 1) % TOUR.length;
      tourFrom = ratio;
      tourT = t;
    }
  };

  shell.setInfo(() => {
    const j = justNear(ratio, 3);
    const et = etNear(ratio);
    const name = j ? `${j.p}:${j.q}, ${withArticle(j.name)}` : `${ratio.toFixed(3)}, near ${withArticle(et.name)}`;
    return `${F1} Hz and ${(F1 * ratio).toFixed(1)} Hz · ${name} · roughness ${Math.round(roughAt(ratio) * 100)}% of the worst`;
  });

  // ---- drawing -----------------------------------------------------------------
  const N = 2600;
  const CYC = 18; // cycles of tone A drawn
  const DAMP = 0.028;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const t = clock();
      tour(t);
      shown += (ratio - shown) * 0.12;
      layout();
      const g = stage.begin();
      const { w, h } = stage;

      // backdrop glow
      const bg = g.createRadialGradient(lay.fx, lay.fy, 0, lay.fx, lay.fy, Math.max(w, h) * 0.6);
      bg.addColorStop(0, "rgba(36, 30, 64, 0.5)");
      bg.addColorStop(1, "rgba(6, 7, 11, 0)");
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);

      // ---- the roughness curve ----
      const cy = (v: number): number => lay.cy1 - v * (lay.cy1 - lay.cy0);
      const cp = new Path2D();
      const fill = new Path2D();
      fill.moveTo(lay.x0, lay.cy1);
      for (let i = 0; i < CURVE; i++) {
        const x = lay.x0 + (i / (CURVE - 1)) * (lay.x1 - lay.x0);
        const y = cy(curve[i]);
        if (i === 0) cp.moveTo(x, y);
        else cp.lineTo(x, y);
        fill.lineTo(x, y);
      }
      fill.lineTo(lay.x1, lay.cy1);
      fill.closePath();
      const fg = g.createLinearGradient(0, lay.cy0, 0, lay.cy1);
      fg.addColorStop(0, "rgba(255, 92, 84, 0.16)");
      fg.addColorStop(1, "rgba(255, 92, 84, 0.0)");
      g.fillStyle = fg;
      g.fill(fill);
      glowStroke(g, cp, mix(RED, ORANGE, 0.35), 1.1, 0.7);
      const small = stage.narrow ? 9 : 10;
      for (const v of valleys) {
        const x = xOf(v.r);
        const near = Math.abs(1200 * Math.log2(shown / v.r)) < 10;
        if (stage.narrow && !near && ["7:6", "7:5", "7:4"].includes(v.label)) continue;
        text(g, v.label, x, lay.cy1 + 14, {
          size: small,
          align: "center",
          color: near ? "rgba(255,236,200,1)" : "rgba(170,178,200,0.6)",
          weight: near ? 700 : 500,
          mono: true,
        });
      }
      const mx = xOf(shown);
      const my = cy(roughAt(shown));
      g.save();
      g.strokeStyle = "rgba(255,236,200,0.35)";
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(mx, lay.cy0 - 6);
      g.lineTo(mx, lay.cy1 + 2);
      g.stroke();
      g.restore();
      glowDot(g, mx, my, 3.4, [255, 236, 200], 1);

      // ---- the harmonograph ----
      const phi = t * 0.22;
      const pts = new Float32Array((N + 1) * 2);
      for (let i = 0; i <= N; i++) {
        const s = (i / N) * CYC;
        const d = Math.exp(-DAMP * s);
        pts[i * 2] = lay.fx + lay.R * Math.sin(2 * Math.PI * s + phi) * d;
        pts[i * 2 + 1] = lay.fy - lay.R * Math.sin(2 * Math.PI * shown * s) * d;
      }
      const CH = 10;
      for (let c = CH - 1; c >= 0; c--) {
        const a = Math.floor((c * N) / CH);
        const b = Math.floor(((c + 1) * N) / CH);
        const p = new Path2D();
        p.moveTo(pts[a * 2], pts[a * 2 + 1]);
        for (let i = a + 1; i <= b; i++) p.lineTo(pts[i * 2], pts[i * 2 + 1]);
        const u = c / (CH - 1);
        const col = mix(mix([255, 226, 180], ORANGE, Math.min(1, u * 2)), BLUE, Math.max(0, u * 1.4 - 0.4));
        glowStroke(g, p, col, 1.05, (1 - u * 0.72) * (sounding ? 0.95 : 0.8));
      }
      glowDot(g, pts[0], pts[1], 3, [255, 240, 220], 0.9);

      // which tone moves which way
      const lab = "rgba(170,178,200,0.55)";
      if (!stage.narrow || !overlay) {
        text(g, `${F1} Hz ↔`, lay.fx, lay.fy + lay.R + 18, { size: small, align: "center", color: rgba(BLUE, 0.7), mono: true });
        text(g, `${(F1 * shown).toFixed(0)} Hz ↕`, lay.fx + lay.R + 12, lay.fy + 4, { size: small, color: rgba(ORANGE, 0.75), mono: true });
      }
      text(g, "roughness, unison → octave", lay.x0, lay.cy0 - 8, { size: small, color: lab });
    },
    dispose() {
      lo.stop();
      hi.stop();
    },
  };
}
