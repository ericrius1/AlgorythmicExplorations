// Melody as a random walk with rules. Every eighth note the walker picks its
// next scale step: stay, step, or leap, with the leap slider setting the odds.
// On beats one and three the gravity slider pulls it onto a note of the
// current chord. Two optional rules come from melody research: after a leap,
// step back the other way; and repeat each two-bar idea once, refitted to the
// new chords, before writing a new one. Phrases are written two bars ahead,
// so the figure shows what's coming as well as what has played.

import { Shell, type Demo } from "../../lib/demoShell";
import { frameGuard } from "../../lib/audio";
import { mulberry32, weighted } from "./harmony/theory";
import { COL, clear, figureAspect, font, glow, line, refresh, rgba, roundRect, setActive, tapToPlay, text, view2d } from "./harmony/draw";
import { Clock, bass as makeBass, epiano, lead as makeLead, startAudio, strip, type Inst } from "./harmony/sound";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const TOP = 14; // scale degrees 0..14: C4 to C6
const CENTRE = 6;
const CHORDS = [
  { label: "C", root: 0, degs: [0, 2, 4] },
  { label: "G", root: 7, degs: [4, 6, 1] },
  { label: "Am", root: 9, degs: [5, 0, 2] },
  { label: "F", root: 5, degs: [3, 5, 0] },
];
const BAR = 8; // eighths per bar
const PHRASE = 2 * BAR;

interface Note {
  step: number; // absolute eighth
  deg: number;
  dur: number; // eighths
  strong: boolean;
  chordTone: boolean;
}

const degMidi = (d: number): number => 60 + MAJOR[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
const chordAt = (step: number): (typeof CHORDS)[number] => CHORDS[Math.floor(step / BAR) % CHORDS.length];
const isChordTone = (d: number, step: number): boolean => chordAt(step).degs.includes(((d % 7) + 7) % 7);

export async function mountMelodyWalk(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, figureAspect(container, 0.56, 1.2));
  container.classList.add("mh-fig");
  const canvas = shell.canvas;
  const v = view2d(canvas);

  let gravity = 0.8;
  let leaps = 0.25;
  let fillGaps = true;
  let motifs = true;
  const rng = mulberry32(1787);

  // ---- the walker ---------------------------------------------------------------------------
  const nearestChordTone = (d: number, step: number): number => {
    // look both ways; on a tie, toss a coin so the snapping doesn't drag the line down
    for (let r = 0; r <= 3; r++) {
      const both = rng() < 0.5 ? [d - r, d + r] : [d + r, d - r];
      for (const x of both) if (x >= 0 && x <= TOP && isChordTone(x, step)) return x;
    }
    return d;
  };
  let deg = 7;
  let lastLeap = 0;
  const nextDeg = (step: number): number => {
    let mv: number;
    if (fillGaps && lastLeap !== 0 && rng() < 0.75) mv = -Math.sign(lastLeap);
    else {
      const l = leaps;
      // a gentle pull back toward the middle of the range (B4), so the
      // line doesn't wander off and sit at one end
      const up = 1 + Math.max(-0.6, Math.min(0.6, (CENTRE - deg) * 0.12));
      const dn = 2 - up;
      mv = weighted(rng, [
        [0, 0.14],
        [1, (0.43 * (1 - l) + 0.05) * up],
        [-1, (0.43 * (1 - l) + 0.05) * dn],
        [2, 0.16 * l * up],
        [-2, 0.16 * l * dn],
        [3, 0.12 * l * up],
        [-3, 0.12 * l * dn],
        [4, 0.08 * l * up],
        [-4, 0.08 * l * dn],
        [5, 0.05 * l * up],
        [-5, 0.05 * l * dn],
      ]);
    }
    let d = deg + mv;
    if (d < 0 || d > TOP) d = deg - mv; // bounce off the ends of the range
    d = Math.max(0, Math.min(TOP, d));
    const slot = step % BAR;
    if ((slot === 0 || slot === 4) && rng() < gravity) d = nearestChordTone(d, step);
    lastLeap = Math.abs(d - deg) >= 2 ? d - deg : 0;
    deg = d;
    return d;
  };
  const mk = (step: number, d: number, dur: number): Note => {
    const slot = step % BAR;
    const strong = slot === 0 || slot === 4;
    return { step, deg: d, dur, strong, chordTone: isChordTone(d, step) };
  };
  // a fresh two-bar phrase: onsets on most eighths, a held note and a breath at the end
  const fresh = (s0: number): Note[] => {
    const out: Note[] = [];
    const onsets: number[] = [];
    for (let i = 0; i < PHRASE - 4; i++) if (i % 2 === 0 || rng() < 0.55) onsets.push(i);
    onsets.push(PHRASE - 4); // the long note
    onsets.forEach((i, k) => {
      const nxt = k + 1 < onsets.length ? onsets[k + 1] : PHRASE - 1;
      out.push(mk(s0 + i, nextDeg(s0 + i), nxt - i));
    });
    return out;
  };
  // the same rhythm and shape, moved to fit the new chords on the strong beats
  const refit = (prev: Note[], s0: number): Note[] => {
    const from = prev[0].step - (prev[0].step % PHRASE); // phrases start on multiples of PHRASE
    let offset = 0;
    return prev.map((n, i) => {
      const step = s0 + n.step - from;
      let d = n.deg + offset;
      if (n.strong && rng() < gravity) {
        const t = nearestChordTone(d, step);
        offset += t - d;
        d = t;
      }
      if (i >= prev.length - 2 && rng() < 0.5) d += rng() < 0.5 ? 1 : -1; // a new ending
      d = Math.max(0, Math.min(TOP, d));
      deg = d;
      return mk(step, d, n.dur);
    });
  };

  const notes: Note[] = [];
  let written = 0; // eighths written so far
  let lastFresh: Note[] | null = null;
  let phraseNo = 0;
  const writeAhead = (upto: number): void => {
    while (written < upto) {
      const p = motifs && lastFresh && phraseNo % 2 === 1 ? refit(lastFresh, written) : fresh(written);
      if (!(motifs && phraseNo % 2 === 1)) lastFresh = p;
      notes.push(...p);
      written += PHRASE;
      phraseNo++;
    }
    while (notes.length > 160) notes.shift();
  };
  const reset = (): void => {
    notes.length = 0;
    written = 0;
    phraseNo = 0;
    lastFresh = null;
    deg = 7;
    lastLeap = 0;
  };
  writeAhead(PHRASE * 2);

  // ---- sound --------------------------------------------------------------------------------------
  let flute: Inst | null = null;
  let keys: Inst | null = null;
  let low: Inst | null = null;
  const clock = new Clock(96, 2, (step, time, dur) => {
    writeAhead(step + PHRASE + 1);
    for (const n of notes) if (n.step === step) flute?.play(degMidi(n.deg), n.dur * dur * 0.95, time, n.strong ? 0.75 : 0.6);
    if (step % BAR === 0) {
      const c = chordAt(step);
      const r = c.root;
      const voicing = [r + 48, r + 52 + (c.label.endsWith("m") ? -1 : 0), r + 55].map((m) => (m > 57 ? m - 12 : m));
      for (const m of voicing) keys?.play(m, BAR * dur * 0.95, time, 0.4);
      low?.play(36 + r - (r > 7 ? 12 : 0), BAR * dur * 0.9, time, 0.7);
    }
  });
  const ensure = async (): Promise<void> => {
    await startAudio();
    if (!flute) {
      flute = makeLead("flute", strip({ db: -2, reverb: 0.25, delay: 0.12, pan: 0.08 }).input, -12);
      keys = epiano(strip({ db: -10, reverb: 0.25, pan: -0.12 }).input, -9);
      low = makeBass(strip({ db: -8 }).input, -10);
    }
  };
  const start = async (): Promise<void> => {
    tap.hide();
    await ensure();
    if (!clock.isRunning) {
      reset();
      writeAhead(PHRASE * 2);
      clock.start(0);
    }
    sync();
  };
  const stop = (): void => {
    clock.stop();
    for (const i of [flute, keys, low]) i?.release();
    tap.show();
    sync();
  };
  const guard = frameGuard(() => {
    if (clock.isRunning) stop();
  });
  const tap = tapToPlay(container, "Tap to hear the walker", () => void start(), 0.5);
  canvas.addEventListener("pointerdown", () => (clock.isRunning ? stop() : void start()));

  // ---- controls ------------------------------------------------------------------------------------
  const playBtn = shell.button("▶ play", () => (clock.isRunning ? stop() : void start()));
  const sync = (): void => {
    playBtn.textContent = clock.isRunning ? "■ stop" : "▶ play";
  };
  // changes apply to phrases not yet written; rewrite the preview when stopped
  const changed = (): void => {
    if (!clock.isRunning) {
      reset();
      writeAhead(PHRASE * 2);
    }
  };
  shell.slider({
    label: "gravity",
    min: 0,
    max: 1,
    step: 0.05,
    value: gravity,
    format: (x) => `${Math.round(x * 100)}%`,
    onInput: (x) => {
      gravity = x;
      changed();
    },
  });
  shell.slider({
    label: "leaps",
    min: 0,
    max: 1,
    step: 0.05,
    value: leaps,
    format: (x) => `${Math.round(x * 100)}%`,
    onInput: (x) => {
      leaps = x;
      changed();
    },
  });
  const fillBtn = shell.button("step back after a leap", () => {
    fillGaps = !fillGaps;
    setActive(fillBtn, fillGaps);
    changed();
  });
  const motifBtn = shell.button("repeat motifs", () => {
    motifs = !motifs;
    setActive(motifBtn, motifs);
    changed();
  });
  setActive(fillBtn, fillGaps);
  setActive(motifBtn, motifs);

  // statistics over the notes that have sounded (or the preview when stopped)
  const stats = (): { n: number; hist: number[]; strongCT: number } => {
    const pos = clock.isRunning ? clock.position() : Infinity;
    const played = notes.filter((n) => n.step <= pos).slice(-64);
    const hist = [0, 0, 0, 0];
    for (let i = 1; i < played.length; i++) {
      const d = Math.abs(played[i].deg - played[i - 1].deg);
      hist[Math.min(3, d)]++;
    }
    const strong = played.filter((n) => n.strong);
    const strongCT = strong.length ? strong.filter((n) => n.chordTone).length / strong.length : 0;
    return { n: Math.max(1, played.length - 1), hist, strongCT };
  };
  shell.setInfo(() => {
    const s = stats();
    const pct = (x: number): string => `${Math.round((100 * x) / s.n)}%`;
    return `I–V–vi–IV in C · last ${s.n} moves: ${pct(s.hist[0])} repeats, ${pct(s.hist[1])} steps, ${pct(s.hist[2] + s.hist[3])} leaps · ${Math.round(s.strongCT * 100)}% of strong beats on chord tones`;
  });

  // ---- drawing -------------------------------------------------------------------------------------
  const draw = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    clear(v, "#0b0d16", "#05060a");
    const narrow = w / px < 560;
    const running = clock.isRunning;
    const pos = running ? clock.position() : PHRASE * 0.5;
    const left = (narrow ? 34 : 46) * px;
    const right = w - (narrow ? 12 : 170) * px;
    const top = 44 * px;
    const bottom = h - (narrow ? 104 : 28) * px;
    const span = narrow ? 3 * BAR : 4 * BAR;
    const nowX = left + (right - left) * 0.55;
    const pps = (right - left) / span;
    const X = (s: number): number => nowX + (s - pos) * pps;
    const Y = (d: number): number => bottom - ((d + 0.5) / (TOP + 1)) * (bottom - top);
    const rowH = (bottom - top) / (TOP + 1);

    // rows: degree names on the left
    const names = ["C", "D", "E", "F", "G", "A", "B"];
    for (let d = 0; d <= TOP; d++) {
      line(ctx, left, Y(d), right, Y(d), rgba(COL.muted, d % 7 === 0 ? 0.16 : 0.06), 1 * px);
      text(ctx, `${names[d % 7]}${4 + Math.floor(d / 7)}`, left - 8 * px, Y(d), { color: d % 7 === 0 ? COL.text : COL.dim, align: "right", font: font(px, 8.5, 600) });
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top - 22 * px, right - left, bottom - top + 24 * px);
    ctx.clip();
    // bars: chord-tone rows lit for each chord
    const b0 = Math.floor((pos - span) / BAR);
    for (let b = b0; b <= b0 + Math.ceil(span / BAR) * 2 + 2; b++) {
      if (b < 0) continue;
      const xs = X(b * BAR);
      const xe = X((b + 1) * BAR);
      if (xe < left || xs > right) continue;
      const c = CHORDS[b % CHORDS.length];
      for (let d = 0; d <= TOP; d++) {
        if (!c.degs.includes(d % 7)) continue;
        ctx.fillStyle = rgba(COL.major, d % 7 === c.degs[0] ? 0.11 : 0.06);
        ctx.fillRect(xs, Y(d) - rowH * 0.42, xe - xs, rowH * 0.84);
      }
      line(ctx, xs, top - 22 * px, xs, bottom, rgba(COL.muted, 0.2), 1 * px);
      text(ctx, c.label, xs + 6 * px, top - 12 * px, { color: COL.major, font: font(px, 11, 700) });
      for (let bt = 1; bt < 4; bt++) line(ctx, X(b * BAR + bt * 2), top, X(b * BAR + bt * 2), bottom, rgba(COL.muted, bt === 2 ? 0.08 : 0.04), 1 * px);
    }
    // notes
    // notes
    let prev: Note | null = null;
    for (const n of notes) {
      const x = X(n.step);
      if (x > right + 20 * px || X(n.step + n.dur) < left - 20 * px) {
        prev = n;
        continue;
      }
      const past = n.step <= pos;
      const sounding = running && past && n.step + n.dur > pos;
      const col = n.chordTone ? COL.calm : COL.minor;
      const a = past ? 0.95 : 0.32;
      if (prev && prev.step + prev.dur >= n.step - 0.01) {
        line(ctx, X(prev.step + prev.dur) - 1 * px, Y(prev.deg), x + 1 * px, Y(n.deg), rgba(col, a * 0.55), 1.2 * px);
      }
      const wdt = Math.max(3 * px, n.dur * pps - 2 * px);
      roundRect(ctx, x, Y(n.deg) - rowH * 0.3, wdt, rowH * 0.6, rowH * 0.3);
      ctx.fillStyle = rgba(col, a);
      ctx.fill();
      if (n.strong && past) {
        ctx.strokeStyle = rgba(COL.white, n.chordTone ? 0.8 : 0.3);
        ctx.lineWidth = 1.2 * px;
        ctx.stroke();
      }
      if (sounding) glow(ctx, x + 4 * px, Y(n.deg), 22 * px, col, 0.9);
      prev = n;
    }
    ctx.restore();
    // phrase brackets: fresh vs repeated idea
    const p0 = Math.floor((pos - span) / PHRASE);
    for (let p = Math.max(0, p0); p <= p0 + 4; p++) {
      const xs = X(p * PHRASE) + 3 * px;
      const xe = X((p + 1) * PHRASE) - 3 * px;
      if (xe < left || xs > right) continue;
      const xa = Math.max(left, xs);
      const xb = Math.min(right, xe);
      const rep = motifs && p % 2 === 1;
      ctx.fillStyle = rgba(rep ? COL.calm : COL.minor, 0.5);
      ctx.fillRect(xa, bottom + 4 * px, xb - xa, 2 * px);
      if (xb - xa > 70 * px) text(ctx, rep ? "repeat, refitted" : "new idea", xa, bottom + 14 * px, { color: rep ? COL.calm : COL.minor, font: font(px, 8.5, 650), alpha: 0.8 });
    }
    // now line
    line(ctx, nowX, top - 38 * px, nowX, bottom, rgba(COL.white, running ? 0.6 : 0.25), 1.4 * px);
    text(ctx, "written ahead →", nowX + 6 * px, top - 32 * px, { color: COL.dim, font: font(px, 8.5, 600) });

    // interval histogram
    const s = stats();
    const hx0 = narrow ? left : right + 30 * px;
    const hy0 = narrow ? h - 70 * px : top + 10 * px;
    const hw = narrow ? (w - left - 12 * px) / 4 : 130 * px / 4;
    const hh = narrow ? 44 * px : 110 * px;
    if (!narrow) text(ctx, "moves played", hx0, hy0 - 4 * px, { color: COL.muted, font: font(px, 9.5, 650) });
    const labs = ["same", "step", "3rd", "4th+"];
    s.hist.forEach((c, i) => {
      const frac = c / s.n;
      const x = hx0 + i * hw;
      const bh = frac * hh;
      const yb = hy0 + 12 * px + hh;
      roundRect(ctx, x + 3 * px, yb - bh, hw - 6 * px, Math.max(1 * px, bh), 3 * px);
      ctx.fillStyle = rgba(i === 1 ? COL.calm : COL.minor, 0.75);
      ctx.fill();
      text(ctx, labs[i], x + hw / 2, yb + 10 * px, { color: COL.muted, align: "center", font: font(px, 8.5, 600) });
      text(ctx, `${Math.round(frac * 100)}%`, x + hw / 2, yb - bh - 8 * px, { color: COL.text, align: "center", font: font(px, 9, 650) });
    });
    if (!narrow) {
      const y = hy0 + hh + 56 * px;
      text(ctx, "strong beats on", hx0, y, { color: COL.muted, font: font(px, 9.5, 650) });
      text(ctx, "chord tones", hx0, y + 13 * px, { color: COL.muted, font: font(px, 9.5, 650) });
      text(ctx, `${Math.round(s.strongCT * 100)}%`, hx0, y + 36 * px, { color: COL.calm, font: font(px, 22, 700) });
      // legend
      const ly = y + 70 * px;
      roundRect(ctx, hx0, ly - 4 * px, 16 * px, 8 * px, 4 * px);
      ctx.fillStyle = COL.calm;
      ctx.fill();
      text(ctx, "chord tone", hx0 + 22 * px, ly, { color: COL.text, font: font(px, 9, 600) });
      roundRect(ctx, hx0, ly + 14 * px, 16 * px, 8 * px, 4 * px);
      ctx.fillStyle = COL.minor;
      ctx.fill();
      text(ctx, "passing note", hx0 + 22 * px, ly + 18 * px, { color: COL.text, font: font(px, 9, 600) });
    }
  };

  return {
    frame() {
      shell.tick();
      guard.pulse();
      sync();
      draw();
    },
    dispose() {
      clock.stop();
    },
  };
}
