// Hero for "The Anatomy of a Note": a harp of eight strings tuned to the
// harmonic series of A2 (110, 220, 330 … 880 Hz). Same tension and gauge,
// lengths 1, 1/2, 1/3 … 1/8 (Mersenne: frequency goes as 1/length), so the
// lower ends trace the curve of a harp's neck. Drag across the strings to
// strum. Each string's motion and sound come from one modal model: the pluck
// position sets the recipe of harmonics, each harmonic rings at m·f and
// decays at its own rate. Below each string a falling trace shows how much
// sound is at that string's frequency right now; pluck the long string and
// traces appear under all the others, because its harmonics are their notes.

import type { Demo } from "../../lib/demoShell";
import { strike, damp, unlockAudio, audioOn, noteLabel, type Mode, guardSound } from "./sound/core";
import { Stage, PlayPill, glowStroke, glowDot, harmonicRgb, rgba, mix, text, WHITE, GOLD } from "./sound/draw";

const F0 = 110;
const STRINGS = 8;
const SLOWMO = 100; // the drawn motion runs this many times slower than the sound
const VIS_MAX_HZ = 14; // highest drawn mode frequency, so 60 fps never aliases
const FALL = 64; // px per second the traces fall
const HIST = 720; // samples of trace history (~12 s at 60 fps)

interface Str {
  n: number;
  f: number;
  // complex mode amplitudes (re, im), drawn displacement in px
  cr: Float64Array;
  ci: Float64Array;
  modes: number; // modes drawn
  tau: Float64Array; // decay time constant per mode, s
  flash: number; // brightness kick on pluck
}

interface Ring {
  k: number; // harmonic number this sound lands on (string k's frequency)
  a: number; // amplitude
  tau: number;
  t0: number; // performance.now() / 1000
}

export async function mountNoteHero(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.5, narrowAspect: 1.02, touch: "pan-y" });
  const { shell, canvas } = stage;
  const overlay = !container.closest(".hero-title-below") && window.matchMedia("(min-width: 46rem)").matches;

  const decay = (f: number): number => Math.min(2.4, Math.max(0.08, 1.7 * Math.sqrt(F0 / f)));

  const strings: Str[] = [];
  for (let n = 1; n <= STRINGS; n++) {
    const f = n * F0;
    const modes = Math.max(1, Math.floor((VIS_MAX_HZ * SLOWMO) / f));
    const tau = new Float64Array(modes);
    for (let m = 1; m <= modes; m++) tau[m - 1] = decay(m * f);
    strings.push({ n, f, cr: new Float64Array(modes), ci: new Float64Array(modes), modes, tau, flash: 0 });
  }

  // ---- layout ----------------------------------------------------------------
  let top = 0;
  let lmax = 0;
  let x0 = 0;
  let x1 = 0;
  const xs = new Float64Array(STRINGS);
  // measured once at the top of the page (the nav is fixed, so it only
  // covers the hero while the hero is at the top)
  const navH = Math.min(stage.navCover(), stage.h * 0.3);
  const layout = (): void => {
    const { w, h } = stage;
    top = Math.max(overlay ? h * 0.16 : h * 0.1, navH + (overlay ? 48 : 34));
    const bottom = overlay ? h * 0.64 : h * 0.86;
    lmax = bottom - top;
    x0 = w * (stage.narrow ? 0.1 : 0.16);
    x1 = w * (stage.narrow ? 0.9 : 0.84);
    for (let i = 0; i < STRINGS; i++) xs[i] = x0 + (Math.log2(i + 1) / Math.log2(STRINGS)) * (x1 - x0);
  };
  layout();
  const len = (i: number): number => lmax / (i + 1);
  const gap = (i: number): number => {
    const l = i > 0 ? xs[i] - xs[i - 1] : Infinity;
    const r = i < STRINGS - 1 ? xs[i + 1] - xs[i] : Infinity;
    return Math.min(l, r);
  };

  // ---- sound + motion from one pluck -----------------------------------------
  const rings: Ring[] = [];
  let lastPluck = -1;
  let lastP = 0.3;
  const clock = (): number => performance.now() / 1000;

  const pluck = (i: number, p: number, vel: number, audible: boolean): void => {
    const s = strings[i];
    p = Math.min(0.92, Math.max(0.08, p));
    const t0 = clock();
    // the finger touching a ringing string damps it first
    for (let m = 0; m < s.modes; m++) {
      s.cr[m] *= 0.35;
      s.ci[m] *= 0.35;
    }
    // drawn shape: a triangle with its corner at p, as a sum of sin(mπx)
    const h = Math.min(gap(i) * 0.42, 30) * (0.5 + 0.5 * vel);
    for (let m = 1; m <= s.modes; m++) {
      const b = (2 * h * Math.sin(m * Math.PI * p)) / (m * m * Math.PI * Math.PI * p * (1 - p));
      // phasor for cos(ω(t − t0)): rotate back by ω t0
      const ph = -2 * Math.PI * ((m * s.f) / SLOWMO) * t0;
      s.cr[m - 1] += b * Math.cos(ph);
      s.ci[m - 1] += b * Math.sin(ph);
    }
    s.flash = 1;

    // heard recipe: the bridge feels the string's slope, so harmonic m comes
    // through as sin(mπp)/m; a fingertip isn't a point, so the top rolls off
    const modes: Mode[] = [];
    let sum = 0;
    for (let m = 1; m <= 16 && m * s.f < 7000; m++) {
      const a = (Math.sin(m * Math.PI * p) / m) * Math.exp((-m * s.f) / 3200);
      modes.push({ f: m * s.f, a, tau: decay(m * s.f) });
      sum += Math.abs(a);
    }
    const level = (0.13 * vel) / Math.max(sum, 0.6);
    for (const md of modes) md.a *= level;
    if (audible && audioOn()) strike(modes, { attack: 0.003 });

    // the falling traces, and the sympathetic shimmer of strings that share
    // a frequency with one of this string's harmonics
    for (const md of modes) {
      const k = Math.round(md.f / F0);
      if (k > STRINGS) continue;
      rings.push({ k, a: Math.abs(md.a) / Math.max(vel, 0.3), tau: md.tau, t0 });
      if (k !== s.n) {
        const o = strings[k - 1];
        const amp = Math.min(0.5, (Math.abs(md.a) / level) * 1.2) * Math.min(gap(k - 1) * 0.3, 10);
        const ph = -2 * Math.PI * (o.f / SLOWMO) * t0;
        o.cr[0] += amp * Math.cos(ph);
        o.ci[0] += amp * Math.sin(ph);
        o.flash = Math.max(o.flash, 0.35);
      }
    }
    lastPluck = i;
    lastP = p;
  };

  // ---- input -----------------------------------------------------------------
  let sounding = false; // audio unlocked by a gesture here
  let lastHuman = -1e9;
  const pill = new PlayPill(stage, "Tap to play · drag across the strings", () => {
    void start().then(() => roll([0, 1, 2, 3, 4, 5, 7], 0.11, 0.7));
  });
  pill.el.classList.add("ms-hero-pill");

  const start = async (): Promise<void> => {
    await unlockAudio();
    sounding = true;
    pill.show(false);
    lastHuman = clock();
  };

  const hitString = (x: number, y: number): number => {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < STRINGS; i++) {
      const d = Math.abs(x - xs[i]);
      if (d < Math.max(12, gap(i) * 0.5) && d < bd && y > top - 30 && y < top + len(i) + 40) {
        best = i;
        bd = d;
      }
    }
    return best;
  };

  let prev: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = stage.local(e);
    prev = { x, y, t: performance.now() };
    const first = !sounding;
    void start().then(() => {
      const i = hitString(x, y);
      if (i >= 0) pluck(i, (y - top) / len(i), 0.75, true);
      else if (first) roll([0, 2, 4, 7], 0.12, 0.6);
    });
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!stage.pointer.down || !prev) return;
    const [x, y] = stage.local(e);
    const t = performance.now();
    const dt = Math.max(1, t - prev.t) / 1000;
    const speed = Math.hypot(x - prev.x, y - prev.y) / dt;
    const vel = Math.min(1, Math.max(0.3, speed / 1400));
    for (let i = 0; i < STRINGS; i++) {
      const a = prev.x - xs[i];
      const b = x - xs[i];
      if (a === 0 || a * b > 0) continue; // didn't cross this string
      const yc = prev.y + ((y - prev.y) * a) / (a - b);
      if (yc < top - 20 || yc > top + len(i) + 30) continue;
      pluck(i, (yc - top) / len(i), vel, true);
      lastHuman = clock();
    }
    prev = { x, y, t };
  });
  const end = (): void => {
    prev = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  let visible = false;
  window.addEventListener("keydown", (e) => {
    if (!visible || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = Number(e.key);
    if (k >= 1 && k <= STRINGS && !e.repeat) {
      void start().then(() => pluck(k - 1, 0.28, 0.7, true));
      lastHuman = clock();
    }
  });

  // a rolled chord, low to high
  const timers: number[] = [];
  const roll = (idx: number[], step: number, vel: number): void => {
    idx.forEach((i, j) => timers.push(window.setTimeout(() => pluck(i, 0.22 + 0.05 * (j % 3), vel, true), j * step * 1000)));
  };

  // ---- the idle player: slow phrases until someone plays -----------------------
  const PHRASES: [number, number][][] = [
    [[0, 0], [2, 0.5], [4, 1.0], [7, 1.5], [5, 2.3], [3, 2.8]],
    [[1, 0], [3, 0.45], [5, 0.9], [6, 1.6], [4, 2.2]],
    [[0, 0], [1, 0.3], [2, 0.6], [3, 0.9], [4, 1.2], [5, 1.5], [6, 1.8], [7, 2.1]],
    [[7, 0], [5, 0.5], [3, 1.0], [2, 1.6], [0, 2.4]],
  ];
  let phrase = 0;
  let phraseStart = clock() - 1.2;
  let phraseIdx = 0;
  const idle = (t: number): void => {
    // the idle player only makes sound if you turned it on and can see it
    const audible = sounding && guard.visible() >= 0.4;
    if (audible && t - lastHuman < 9) {
      phraseStart = t + 0.5;
      phraseIdx = 0;
      return;
    }
    const notes = PHRASES[phrase];
    while (phraseIdx < notes.length && t - phraseStart >= notes[phraseIdx][1]) {
      const [i] = notes[phraseIdx];
      pluck(i, 0.2 + 0.1 * ((phraseIdx * 7) % 4), audible ? 0.42 : 0.6, audible);
      phraseIdx++;
    }
    if (phraseIdx >= notes.length && t - phraseStart > notes[notes.length - 1][1] + 3.2) {
      phrase = (phrase + 1) % PHRASES.length;
      phraseStart = t;
      phraseIdx = 0;
    }
  };

  const guard = guardSound(container, () => {
    visible = false;
    damp(0.25);
    for (const id of timers.splice(0)) window.clearTimeout(id);
  });

  shell.setInfo(() => {
    if (lastPluck < 0) return `8 strings tuned to the harmonics of A2 · ${F0} Hz × 1, 2, 3 … 8`;
    const s = strings[lastPluck];
    return `string ${s.n} · ${s.f} Hz = ${s.n} × ${F0} · ${noteLabel(s.f)} · plucked at ${lastP.toFixed(2)} of its length`;
  });

  // ---- drawing -----------------------------------------------------------------
  const hist = Array.from({ length: STRINGS }, () => new Float32Array(HIST));
  let head = 0;
  let lastT = clock();
  const PTS = 64;
  const sinTab = (() => {
    // sin(mπs) for s in [0,1], per mode, shared by all strings
    const maxM = strings[0].modes;
    const t = new Float32Array(maxM * PTS);
    for (let m = 1; m <= maxM; m++) for (let j = 0; j < PTS; j++) t[(m - 1) * PTS + j] = Math.sin((m * Math.PI * j) / (PTS - 1));
    return t;
  })();
  const level = new Float32Array(STRINGS + 1);

  return {
    frame() {
      shell.tick();
      guard.pulse();
      visible = true;
      const t = clock();
      const dt = Math.min(0.1, t - lastT);
      lastT = t;
      idle(t);

      // decay the drawn motion in real time, like the sound
      for (const s of strings) {
        for (let m = 0; m < s.modes; m++) {
          const k = Math.exp(-dt / s.tau[m]);
          s.cr[m] *= k;
          s.ci[m] *= k;
        }
        s.flash *= Math.exp(-dt / 0.5);
      }
      // sound level at each string's frequency
      level.fill(0);
      for (let r = rings.length - 1; r >= 0; r--) {
        const e = rings[r].a * Math.exp(-(t - rings[r].t0) / rings[r].tau);
        if (e < 2e-4) rings.splice(r, 1);
        else level[rings[r].k] += e;
      }
      head = (head + 1) % HIST;
      for (let k = 1; k <= STRINGS; k++) {
        // −40 dB … 0 dB → 0 … 1
        const db = 20 * Math.log10(Math.max(level[k] / 0.16, 1e-6));
        hist[k - 1][head] = Math.max(0, Math.min(1, (db + 40) / 40));
      }

      layout();
      const g = stage.begin();
      const { w, h } = stage;

      // backdrop: a faint warm glow behind the strings
      const bgGrad = g.createRadialGradient(w * 0.5, top + lmax * 0.35, 0, w * 0.5, top + lmax * 0.35, Math.max(w, h) * 0.65);
      bgGrad.addColorStop(0, "rgba(40, 34, 60, 0.55)");
      bgGrad.addColorStop(1, "rgba(6, 7, 11, 0)");
      g.fillStyle = bgGrad;
      g.fillRect(0, 0, w, h);

      // falling ribbons: sound at each string's frequency, newest at the top.
      // Width and brightness follow the level, so a pluck falls as a comet.
      const K = 56;
      const vs = new Float32Array(K + 1);
      for (let i = 0; i < STRINGS; i++) {
        const y0 = top + len(i) + 24;
        const span = h - y0;
        if (span < 10) continue;
        let any = false;
        for (let j = 0; j <= K; j++) {
          const age = ((j / K) * span) / FALL; // seconds ago
          const back = Math.min(HIST - 1, Math.round(age * 60));
          const taper = Math.min(1, j / 3); // round off the newest end
          vs[j] = hist[i][(head - back + HIST) % HIST] * (1 - 0.55 * (j / K)) * (0.35 + 0.65 * taper);
          if (vs[j] > 0.02) any = true;
        }
        if (!any) continue;
        const c = harmonicRgb(i + 1);
        const grad = g.createLinearGradient(0, y0, 0, h);
        for (let j = 0; j <= K; j += 4) grad.addColorStop(j / K, rgba(c, Math.min(1, vs[j] * 1.1)));
        const ribbon = (wid: number, base: number): Path2D => {
          const p = new Path2D();
          for (let j = 0; j <= K; j++) p.lineTo(xs[i] - base - wid * vs[j], y0 + (j / K) * span);
          for (let j = K; j >= 0; j--) p.lineTo(xs[i] + base + wid * vs[j], y0 + (j / K) * span);
          p.closePath();
          return p;
        };
        g.save();
        g.globalCompositeOperation = "lighter";
        g.fillStyle = grad;
        g.globalAlpha = 0.14;
        g.fill(ribbon(16, 2));
        g.globalAlpha = 0.32;
        g.fill(ribbon(6, 0.5));
        g.globalAlpha = 0.85;
        g.fill(ribbon(1.6, 0.25));
        g.restore();
      }

      // the neck and the curved lower rail through the string ends
      const neck = new Path2D();
      neck.moveTo(x0 - 26, top);
      neck.lineTo(x1 + 26, top);
      glowStroke(g, neck, GOLD, 1.3, 0.38);
      const rail = new Path2D();
      for (let j = 0; j <= 80; j++) {
        const u = -0.04 + (j / 80) * 1.08; // a little past both ends
        const x = x0 + u * (x1 - x0);
        const y = top + lmax * Math.pow(2, -u * Math.log2(STRINGS));
        if (j === 0) rail.moveTo(x, y);
        else rail.lineTo(x, y);
      }
      glowStroke(g, rail, GOLD, 1.0, 0.22);

      // the strings
      const tw = (2 * Math.PI) / SLOWMO;
      for (let i = 0; i < STRINGS; i++) {
        const s = strings[i];
        const L = len(i);
        let energy = 0;
        const cosw = new Float64Array(s.modes);
        for (let m = 0; m < s.modes; m++) {
          // Re[c e^{iωt}]
          const ph = tw * (m + 1) * s.f * t;
          cosw[m] = s.cr[m] * Math.cos(ph) - s.ci[m] * Math.sin(ph);
          energy += s.cr[m] * s.cr[m] + s.ci[m] * s.ci[m];
        }
        const path = new Path2D();
        for (let j = 0; j < PTS; j++) {
          let u = 0;
          for (let m = 0; m < s.modes; m++) u += cosw[m] * sinTab[m * PTS + j];
          const x = xs[i] + u;
          const y = top + (j / (PTS - 1)) * L;
          if (j === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        }
        const amp = Math.min(1, Math.sqrt(energy) / 12);
        const c = harmonicRgb(i + 1);
        glowStroke(g, path, c, 1.25 + amp * 0.8, 0.42 + 0.45 * amp + 0.25 * s.flash);
        glowDot(g, xs[i], top, 2.2, c, 0.5);
        glowDot(g, xs[i], top + L, 2.2, c, 0.45 + 0.4 * s.flash);
      }

      // labels: harmonic number above the neck, note under each string end
      const small = stage.narrow ? 9.5 : 11;
      for (let i = 0; i < STRINGS; i++) {
        const s = strings[i];
        const c = mix(harmonicRgb(i + 1, 0.74), WHITE, 0.15);
        text(g, `×${s.n}`, xs[i], top - 12, { size: small, align: "center", color: rgba(c, 0.55 + 0.4 * s.flash), weight: 600, mono: true });
        if (!stage.narrow || i < 6 || i === 7) {
          const name = noteLabel(s.f).split(" ")[0];
          text(g, name, xs[i], top + len(i) + 16, { size: small, align: "center", color: rgba(c, 0.5 + 0.45 * s.flash) });
        }
      }
    },
    dispose() {
      damp(0.2);
    },
  };
}
