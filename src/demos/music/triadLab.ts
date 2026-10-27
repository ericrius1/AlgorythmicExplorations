// The chord microscope. Each note of a chord is drawn as its ladder of
// harmonics on a log-frequency axis, one row per note. Where partials from
// two notes land together the figure joins them: white when they coincide,
// amber-to-red when they're close enough to beat, labelled with the beat
// rate. Underneath sits the chord's implied fundamental, the note whose
// harmonic series the chord is a slice of (C2 for C major's 4:5:6; A♭ far
// below for C minor's 10:12:15), with its harmonics drawn as a faint comb.
// Switch to just intonation and the near-misses snap onto the comb.

import { Shell, type Demo } from "../../lib/demoShell";
import { frameGuard, pairRoughness } from "../../lib/audio";
import { Piano } from "../../lib/piano";
import { PC_NAMES, chordRoughness, midiToFreq, mod12, noteName } from "./harmony/theory";
import { COL, VOICE, clear, figureAspect, font, glow, glowPath, line, refresh, rgba, setActive, smooth, tapToPlay, text, view2d } from "./harmony/draw";
import { harmonicTone, startAudio, strip, soon } from "./harmony/sound";

const PARTIALS = 8;
const F_LO = 16;
const F_HI = 8000;

interface Quality {
  name: string;
  short: string;
  iv: number[]; // semitones above the root
  ratio: number[]; // just-intonation version, as harmonic numbers of one fundamental
}

const QUALITIES: Quality[] = [
  { name: "major", short: "maj", iv: [0, 4, 7], ratio: [4, 5, 6] },
  { name: "minor", short: "min", iv: [0, 3, 7], ratio: [10, 12, 15] },
  { name: "diminished", short: "dim", iv: [0, 3, 6], ratio: [25, 30, 36] },
  { name: "augmented", short: "aug", iv: [0, 4, 8], ratio: [16, 20, 25] },
  { name: "sus4", short: "sus4", iv: [0, 5, 7], ratio: [6, 8, 9] },
  { name: "dominant 7", short: "7", iv: [0, 4, 7, 10], ratio: [4, 5, 6, 7] },
  { name: "major 7", short: "maj7", iv: [0, 4, 7, 11], ratio: [8, 10, 12, 15] },
  { name: "minor 7", short: "m7", iv: [0, 3, 7, 10], ratio: [10, 12, 15, 18] },
];

export async function mountTriadLab(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, figureAspect(container, 0.66, 1.15));
  container.classList.add("mh-fig");
  const canvas = shell.canvas;
  const v = view2d(canvas);

  let root = 60; // C4
  let q = QUALITIES[0];
  let just = false;
  let struck = performance.now() - 5000;

  // ---- sound ----------------------------------------------------------------------
  let tone: ReturnType<typeof harmonicTone> | null = null;
  const freqs = (): number[] =>
    just ? q.ratio.map((r) => (midiToFreq(root) * r) / q.ratio[0]) : q.iv.map((s) => midiToFreq(root + s));

  const strike = (): void => {
    struck = performance.now();
    tap.hide();
    piano.setHeld(q.iv.map((s) => root + s), root);
    void startAudio().then(() => {
      if (!tone) tone = harmonicTone(strip({ db: -2, reverb: 0.16 }).input, PARTIALS);
      tone.release();
      const t = soon();
      freqs().forEach((f, k) => tone!.playHz(f, 2.6, t + k * 0.004, 0.75));
    });
  };
  const guard = frameGuard(() => tone?.release());
  const tap = tapToPlay(container, "Tap to hear C major", () => strike(), 0.42);

  // ---- controls ---------------------------------------------------------------------
  const piano = new Piano({
    low: 48,
    high: 71,
    onPress: (m) => {
      root = m;
      strike();
    },
  });
  shell.controls.before(piano.el);
  piano.setHeld(q.iv.map((s) => root + s), root);

  const group = document.createElement("div");
  group.className = "mh-group";
  shell.controls.appendChild(group);
  const qBtns = QUALITIES.map((qq) => {
    const b = shell.button(qq.name, () => {
      q = qq;
      qBtns.forEach((x, i) => setActive(x, QUALITIES[i] === q));
      strike();
    });
    group.appendChild(b);
    return b;
  });
  setActive(qBtns[0], true);
  const tuneBtn = shell.button("tuning: equal", () => {
    just = !just;
    tuneBtn.textContent = just ? "tuning: just" : "tuning: equal";
    setActive(tuneBtn, just);
    strike();
  });
  shell.button("▶ play", strike);

  // ---- analysis (recomputed only when the chord changes) -------------------------------
  interface Pair {
    a: number;
    b: number;
    i: number;
    j: number;
    fa: number;
    fb: number;
    beat: number; // |fa − fb| in Hz
    rough: number;
  }
  let key = "";
  let pairs: Pair[] = [];
  let rough = 0;
  let table: { q: Quality; r: number }[] = [];

  const freqsOf = (qq: Quality): number[] =>
    just ? qq.ratio.map((r) => (midiToFreq(root) * r) / qq.ratio[0]) : qq.iv.map((s) => midiToFreq(root + s));

  const analyse = (): void => {
    const k = `${root}|${q.name}|${just}`;
    if (k === key) return;
    key = k;
    const fs = freqs();
    pairs = [];
    for (let a = 0; a < fs.length; a++) {
      for (let b = a + 1; b < fs.length; b++) {
        for (let i = 1; i <= PARTIALS; i++) {
          for (let j = 1; j <= PARTIALS; j++) {
            const fa = fs[a] * i;
            const fb = fs[b] * j;
            if (fa > F_HI || fb > F_HI) continue;
            if (Math.abs(1200 * Math.log2(fb / fa)) > 120) continue;
            pairs.push({ a, b, i, j, fa, fb, beat: Math.abs(fa - fb), rough: pairRoughness(fa, 1 / i, fb, 1 / j) });
          }
        }
      }
    }
    rough = chordRoughness(fs, PARTIALS);
    table = QUALITIES.slice(0, 5).map((qq) => ({ q: qq, r: chordRoughness(freqsOf(qq), PARTIALS) }));
  };

  // slow beats (a near-unison, a few per second) vs fast roughness
  const SLOW = 20;
  const slowest = (): Pair | undefined =>
    pairs
      .filter((p) => p.beat >= 0.3 && p.beat < SLOW)
      .sort((x, y) => 1 / (y.i * y.j) - 1 / (x.i * x.j))[0];

  shell.setInfo(() => {
    const names = q.iv.map((s) => PC_NAMES[mod12(root + s)]).join("–");
    const f0 = midiToFreq(root) / q.ratio[0];
    const sb = slowest();
    const beat = sb
      ? ` · beating ${sb.beat.toFixed(1)}×/s (${noteName(root + q.iv[sb.a])}×${sb.i} vs ${noteName(root + q.iv[sb.b])}×${sb.j})`
      : " · nothing beats slowly";
    return `${PC_NAMES[mod12(root)]} ${q.name} (${names}) · harmonics ${q.ratio.join(":")} of ${f0.toFixed(1)} Hz${beat} · roughness ${rough.toFixed(2)}`;
  });

  // ---- drawing ---------------------------------------------------------------------------
  const draw = (): void => {
    refresh(v, canvas);
    analyse();
    const { ctx, w, h, px } = v;
    const narrow = w / px < 520;
    clear(v, "#0b0d16", "#06070b");
    const fs = freqs();
    const n = fs.length;
    const now = performance.now();
    const strikeK = 1 - smooth((now - struck) / 1400);

    const left = (narrow ? 50 : 78) * px;
    const right = w - 14 * px;
    const tableH = (narrow ? 62 : 58) * px;
    const laneY = tableH + 26 * px;
    const top = laneY + 22 * px;
    const axisY = h - 24 * px;
    const fundH = (narrow ? 46 : 56) * px;
    const rowsBottom = axisY - fundH - 6 * px;
    const rowH = (rowsBottom - top) / n;
    const X = (f: number): number => left + ((Math.log2(f) - Math.log2(F_LO)) / (Math.log2(F_HI) - Math.log2(F_LO))) * (right - left);
    const base = (a: number): number => top + rowH * (a + 1) - 4 * px;
    const barH = (k: number): number => (rowH - 16 * px) * (0.2 + 0.8 / k);

    // octave grid
    for (let m = 24; m <= 108; m += 12) {
      const f = midiToFreq(m);
      if (f < F_LO || f > F_HI) continue;
      const x = X(f);
      line(ctx, x, laneY - 10 * px, x, axisY, COL.grid, 1 * px);
      text(ctx, noteName(m), x, axisY + 12 * px, { color: COL.dim, align: "center", font: font(px, narrow ? 9 : 10, 500, true) });
    }
    line(ctx, left, axisY, right, axisY, rgba("#8a91a5", 0.3), 1 * px);

    // the implied fundamental's harmonic comb, behind everything
    const f0 = midiToFreq(root) / q.ratio[0];
    for (let m = 1; m * f0 <= F_HI; m++) {
      const f = m * f0;
      if (f < F_LO) continue;
      const x = X(f);
      const isNote = q.ratio.includes(m);
      ctx.setLineDash(isNote ? [] : [2 * px, 5 * px]);
      line(ctx, x, top - 4 * px, x, axisY - fundH * 0.2, rgba(isNote ? COL.white : "#8a91a5", isNote ? 0.2 : 0.12), 1 * px);
      ctx.setLineDash([]);
    }

    // the collision lane
    text(ctx, narrow ? "meet" : "collisions", left - 10 * px, laneY, {
      color: COL.muted,
      align: "right",
      font: font(px, narrow ? 8.5 : 9.5, 600),
    });
    line(ctx, left, laneY, right, laneY, rgba("#8a91a5", 0.12), 1 * px);
    const maxRough = Math.max(1e-6, ...pairs.map((p) => p.rough));
    const labels: number[] = [];
    const byWeight = pairs.slice().sort((x, y) => 1 / (y.i * y.j) - 1 / (x.i * x.j));
    for (const p of byWeight) {
      const x = X(Math.sqrt(p.fa * p.fb));
      const weight = Math.min(1, 1.6 / Math.sqrt(p.i * p.j));
      let col: string;
      let alpha: number;
      if (p.beat < 0.3) {
        col = COL.white;
        alpha = 0.95 * weight;
        glow(ctx, x, laneY, (8 + 10 * weight) * px, col, alpha);
      } else if (p.beat < SLOW) {
        col = COL.major;
        const flick = 0.55 + 0.45 * Math.sin((now / 1000) * Math.min(p.beat, 6) * Math.PI * 2);
        alpha = weight * flick;
        glow(ctx, x, laneY, (8 + 10 * weight) * px, col, alpha);
        if (labels.every((lx) => Math.abs(lx - x) > 46 * px) && labels.length < 3) {
          labels.push(x);
          text(ctx, `${p.beat.toFixed(1)} Hz`, x, laneY - 12 * px, { color: col, align: "center", font: font(px, narrow ? 8.5 : 9.5, 650, true) });
        }
      } else {
        col = COL.tension;
        alpha = 0.25 + 0.75 * (p.rough / maxRough);
        glow(ctx, x, laneY, (5 + 9 * (p.rough / maxRough)) * px, col, alpha);
      }
      // a guide down through the two partials that meet here
      const y0 = Math.min(base(p.a) - barH(p.i), base(p.b) - barH(p.j));
      ctx.setLineDash([3 * px, 3 * px]);
      line(ctx, x, laneY + 4 * px, x, y0, rgba(col, 0.28 * alpha), 1 * px);
      ctx.setLineDash([]);
    }

    // voice rows: each note's harmonic ladder
    for (let a = 0; a < n; a++) {
      const b0 = base(a);
      const col = VOICE[a];
      line(ctx, left, b0, right, b0, rgba(col, 0.2), 1 * px);
      const m = root + q.iv[a];
      text(ctx, noteName(m), left - 10 * px, b0 - rowH * 0.45, { color: col, align: "right", font: font(px, narrow ? 11 : 13, 700) });
      text(ctx, `${fs[a].toFixed(1)} Hz`, left - 10 * px, b0 - rowH * 0.45 + (narrow ? 13 : 16) * px, {
        color: COL.muted,
        align: "right",
        font: font(px, narrow ? 8 : 9.5, 500, true),
      });
      for (let k = 1; k <= PARTIALS; k++) {
        const f = fs[a] * k;
        if (f > F_HI) break;
        const x = X(f);
        const hh = barH(k);
        glowPath(
          ctx,
          (c) => {
            c.moveTo(x, b0);
            c.lineTo(x, b0 - hh);
          },
          col,
          (k === 1 ? 2.2 : 1.6) * px,
          0.5 + 0.45 / k + 0.35 * strikeK,
        );
        if (k <= 6 && !narrow) text(ctx, String(k), x, b0 - hh - 8 * px, { color: col, align: "center", font: font(px, 8.5, 600), alpha: 0.55 });
      }
    }

    // the implied root row
    const fy = axisY - fundH * 0.5;
    text(ctx, "implied", left - 10 * px, fy - 7 * px, { color: COL.white, align: "right", font: font(px, narrow ? 9 : 11, 700), alpha: 0.85 });
    text(ctx, "root", left - 10 * px, fy + 7 * px, { color: COL.white, align: "right", font: font(px, narrow ? 9 : 11, 700), alpha: 0.85 });
    const f0m = Math.round(69 + 12 * Math.log2(f0 / 440));
    const f0Name = `${PC_NAMES[mod12(f0m)]}${Math.floor(f0m / 12) - 1}`;
    if (f0 >= F_LO) {
      const x = X(f0);
      glow(ctx, x, fy, 16 * px, COL.white, 0.7);
      ctx.beginPath();
      ctx.arc(x, fy, 4 * px, 0, Math.PI * 2);
      ctx.fillStyle = COL.white;
      ctx.fill();
      text(ctx, `${f0Name} · ${f0.toFixed(1)} Hz`, x + 10 * px, fy, { color: COL.white, font: font(px, narrow ? 10 : 11.5, 650) });
    } else {
      text(ctx, `◀ ${f0Name}, ${f0.toFixed(1)} Hz (off the chart)`, left + 4 * px, fy, { color: COL.white, font: font(px, narrow ? 9.5 : 11.5, 650), alpha: 0.85 });
    }
    let lastX = -1e9;
    q.ratio.forEach((r, k) => {
      const x = X(r * f0);
      if (x - lastX < 17 * px) return;
      lastX = x;
      text(ctx, `×${r}`, x, axisY - 9 * px, { color: VOICE[k], align: "center", font: font(px, narrow ? 8.5 : 10, 700) });
    });

    // comparison band: roughness and harmonic numbers for the five triads
    const bx0 = 12 * px;
    const colW = (w - 24 * px) / table.length;
    const maxR = Math.max(...table.map((r) => r.r));
    const fsz = narrow ? 9 : 10.5;
    ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
    ctx.fillRect(0, 0, w, tableH);
    line(ctx, 0, tableH, w, tableH, rgba("#8a91a5", 0.14), 1 * px);
    table.forEach((r, k) => {
      const x = bx0 + k * colW + (narrow ? 2 : 10) * px;
      const isCur = r.q === q;
      const c = isCur ? COL.bright : COL.muted;
      const bw = (colW - (narrow ? 34 : 40) * px) * (r.r / maxR);
      if (narrow) {
        text(ctx, r.q.short, x, 12 * px, { color: isCur ? COL.major : c, font: font(px, fsz, 700) });
        text(ctx, r.q.ratio.join(":"), x, 26 * px, { color: c, font: font(px, fsz - 1.5, 600, true) });
        ctx.fillStyle = rgba(isCur ? COL.major : "#8a91a5", isCur ? 0.9 : 0.3);
        ctx.fillRect(x, 40 * px, bw, 6 * px);
        text(ctx, r.r.toFixed(2), x + bw + 3 * px, 43 * px, { color: c, font: font(px, fsz - 2, 500, true) });
        return;
      }
      text(ctx, r.q.name, x, 14 * px, { color: isCur ? COL.major : c, font: font(px, fsz, 700) });
      text(ctx, r.q.ratio.join(":"), x + colW - 26 * px, 14 * px, { color: c, align: "right", font: font(px, fsz - 1, 600, true) });
      ctx.fillStyle = rgba(isCur ? COL.major : "#8a91a5", isCur ? 0.9 : 0.3);
      ctx.fillRect(x, 28 * px, bw, 7 * px);
      text(ctx, `roughness ${r.r.toFixed(2)}`, x, 46 * px, { color: c, font: font(px, fsz - 1.5, 500, true), alpha: 0.9 });
    });
  };

  return {
    frame() {
      shell.tick();
      guard.pulse();
      draw();
    },
    dispose() {
      tone?.release();
    },
  };
}
