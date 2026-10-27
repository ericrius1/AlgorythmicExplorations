// Fig. 2 of Part 4: where a tuning error becomes audible. Each note is drawn
// as its ladder of harmonics on a log-frequency axis. Wherever a harmonic of
// one note lands near a harmonic of another, the two beat at the difference
// of their frequencies; the lamps pulse at that rate (gently) and the strip
// at the bottom draws the loudness envelope of the strongest collision over
// one second. Pure ratios line the harmonics up exactly. Equal temperament
// leaves the fifth beating about once a second and the major third about ten.

import { Shell, type Demo } from "../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../lib/audio";
import { COL, Surface, dot, glow, hex, label, mixRgb, rgba, text, type RGB } from "./tuning/draw";
import { Sound, type Held } from "./tuning/sound";
import { chips, range, tapBadge, toggle } from "./tuning/ui";

interface Chord {
  id: string;
  name: string;
  just: number[]; // ratios to the root
  et: number[]; // semitones above the root
  names: string[];
}

const CHORDS: Chord[] = [
  { id: "p5", name: "fifth", just: [1, 3 / 2], et: [0, 7], names: ["C", "G"] },
  { id: "p4", name: "fourth", just: [1, 4 / 3], et: [0, 5], names: ["C", "F"] },
  { id: "M3", name: "major third", just: [1, 5 / 4], et: [0, 4], names: ["C", "E"] },
  { id: "m3", name: "minor third", just: [1, 6 / 5], et: [0, 3], names: ["C", "E♭"] },
  { id: "triad", name: "major triad", just: [1, 5 / 4, 3 / 2], et: [0, 4, 7], names: ["C", "E", "G"] },
];

const NOTE_COLORS: RGB[] = [hex("#ffc27a"), hex("#7fb0ff"), hex("#c79bff")];
const PARTIALS = 8;

interface Hit {
  a: number;
  b: number;
  i: number; // partial number on note a
  j: number; // partial number on note b
  fa: number;
  fb: number;
  rate: number;
}

const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function mountCommaLab(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.05 : 0.54));
  const sound = new Sound({ level: 1 });
  const badge = tapBadge(container, "tap for sound");

  let chord = CHORDS[4];
  let tuning: "just" | "et" = "et";
  let rootMidi = 60;
  let held: Held | null = null;
  let ab = 0;
  // which collision the envelope strip shows: clicked, or the most audible
  let pinned: { a: number; b: number; i: number; j: number } | null = null;
  let lamps: { x: number; y: number; hit: Hit }[] = [];

  const rootHz = (): number => 440 * Math.pow(2, (rootMidi - 69) / 12);
  const freqs = (): number[] =>
    tuning === "just" ? chord.just.map((r) => rootHz() * r) : chord.et.map((s) => rootHz() * Math.pow(2, s / 12));

  const hits = (): Hit[] => {
    const f = freqs();
    const out: Hit[] = [];
    for (let a = 0; a < f.length; a++) {
      for (let b = a + 1; b < f.length; b++) {
        for (let i = 1; i <= PARTIALS; i++) {
          for (let j = 1; j <= PARTIALS; j++) {
            const fa = f[a] * i;
            const fb = f[b] * j;
            if (Math.abs(1200 * Math.log2(fb / fa)) < 45) out.push({ a, b, i, j, fa, fb, rate: Math.abs(fa - fb) });
          }
        }
      }
    }
    return out.sort((x, y) => x.i + x.j - (y.i + y.j));
  };

  const stopAB = (): void => {
    clearInterval(ab);
    ab = 0;
    abBtn.set(false);
  };
  const silence = (): void => {
    stopAB();
    held?.release(0.3);
    held = null;
    play.set(false);
  };
  const guard = frameGuard(silence);

  const retune = (glide = 0.18): void => {
    if (held) held.set(freqs(), glide);
  };
  const start = (): void => {
    badge.hide();
    void unlockAudio().then(() => {
      held?.release(0.1);
      held = sound.hold(freqs(), { timbre: "organ", level: 0.05, attack: 0.15, cutoff: 4500 });
      play.set(true);
    });
  };

  chips(shell.controls, {
    label: "interval",
    options: CHORDS.map((c) => ({ value: c.id, text: c.name })),
    value: chord.id,
    onChange: (id) => {
      chord = CHORDS.find((c) => c.id === id)!;
      pinned = null;
      if (held) {
        // voice count may change: restart the held chord
        held.release(0.08);
        held = sound.hold(freqs(), { timbre: "organ", level: 0.05, attack: 0.08, cutoff: 4500 });
      }
    },
  });
  const tuneChips = chips<"just" | "et">(shell.controls, {
    label: "tuning",
    options: [
      { value: "just", text: "pure ratios" },
      { value: "et", text: "equal temperament" },
    ],
    value: tuning,
    onChange: (v) => {
      tuning = v;
      retune();
    },
  });
  const br = document.createElement("div");
  br.className = "tn-break";
  shell.controls.appendChild(br);
  const play = toggle(shell.controls, ["▶ hold the chord", "■ stop"], (on) => {
    if (on) start();
    else silence();
  });
  const abBtn = toggle(shell.controls, ["A/B every 2 s", "A/B on"], (on) => {
    if (!on) {
      stopAB();
      return;
    }
    if (!held) start();
    ab = window.setInterval(() => {
      tuning = tuning === "just" ? "et" : "just";
      tuneChips.set(tuning);
      retune(0.12);
    }, 2000);
  });
  range(shell.controls, {
    label: "root note",
    min: 48,
    max: 72,
    step: 1,
    value: rootMidi,
    format: (v) => `${PITCH_NAMES[v % 12]}${Math.floor(v / 12) - 1} · ${(440 * Math.pow(2, (v - 69) / 12)).toFixed(1)} Hz`,
    onInput: (v) => {
      rootMidi = v;
      retune(0.08);
    },
  });

  shell.setInfo(() => {
    const hs = hits().filter((h) => h.i + h.j <= 12);
    if (!hs.length) return "no harmonics close enough to beat";
    const main = hs.slice(0, 3).map((h) => {
      const n = noteNames();
      const r = h.rate < 0.01 ? "locked, 0 beats/s" : `${h.rate.toFixed(h.rate < 2 ? 2 : 1)} beats/s`;
      return `${n[h.a]}×${h.i} vs ${n[h.b]}×${h.j}: ${r}`;
    });
    return main.join(" · ");
  });

  const mainHit = (hs: Hit[], fMax: number): Hit | null => {
    const vis = hs.filter((x) => x.fa <= fMax && x.fb <= fMax);
    if (pinned) {
      const p = pinned;
      const m = vis.find((x) => x.a === p.a && x.b === p.b && x.i === p.i && x.j === p.j);
      if (m) return m;
    }
    // loudest beating: the weaker partial's level times the rate (fast beats
    // above ~12/s blur into roughness, so cap there)
    let best: Hit | null = null;
    let score = -1;
    for (const x of vis) {
      const s = Math.min(1 / x.i, 1 / x.j) * Math.min(x.rate, 12);
      if (s > score + 1e-9) {
        score = s;
        best = x;
      }
    }
    return best;
  };

  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    let best: Hit | null = null;
    let bd = 22;
    for (const l of lamps) {
      const d = Math.hypot(l.x - p.x, l.y - p.y);
      if (d < bd) {
        bd = d;
        best = l.hit;
      }
    }
    if (best) pinned = { a: best.a, b: best.b, i: best.i, j: best.j };
  });

  const noteNames = (): string[] => {
    const shift = rootMidi % 12;
    return chord.et.map((s) => PITCH_NAMES[(shift + s) % 12]);
  };

  const t0 = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const t = (performance.now() - t0) / 1000;
      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const f = freqs();
      const names = noteNames();
      const hs = hits();

      // ---- harmonic ladders ----
      const padL = narrow ? 34 : 64;
      const padR = 18;
      const top = 34;
      const ladderH = h * (narrow ? 0.5 : 0.56);
      const fMin = rootHz() * 0.88;
      const fMax = rootHz() * 8.6;
      const X = (hz: number): number => padL + ((w - padL - padR) * Math.log(hz / fMin)) / Math.log(fMax / fMin);
      const rows = f.length;
      const rowH = (ladderH - top) / rows;
      const rowY = (r: number): number => top + rowH * (r + 0.5);

      // octave gridlines with Hz labels
      for (let o = 0; o < 4; o++) {
        const hz = rootHz() * Math.pow(2, o);
        const x = X(hz);
        ctx.strokeStyle = "rgba(122, 140, 200, 0.10)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top - 8);
        ctx.lineTo(x, ladderH + 4);
        ctx.stroke();
        text(ctx, `${Math.round(hz)} Hz`, x + 3, top - 12, { size: 9.5, color: COL.dim, mono: true, alpha: 0.7 });
      }

      for (let r = 0; r < rows; r++) {
        const col = NOTE_COLORS[r];
        const y = rowY(r);
        text(ctx, names[r], narrow ? 6 : 14, y + 4, { size: narrow ? 12 : 14, color: rgba(col, 1), weight: 700 });
        if (!narrow)
          text(ctx, `${f[r].toFixed(1)}`, 14, y + 18, { size: 9, color: COL.dim, mono: true });
        ctx.strokeStyle = rgba(col, 0.12);
        ctx.beginPath();
        ctx.moveTo(padL - 6, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        for (let k = 1; k <= PARTIALS; k++) {
          const hz = f[r] * k;
          if (hz > fMax) break;
          const x = X(hz);
          const amp = 1 / k;
          const hh = rowH * 0.36 * (0.35 + 0.65 * amp);
          ctx.strokeStyle = rgba(col, 0.85);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y - hh);
          ctx.lineTo(x, y + hh);
          ctx.stroke();
          glow(ctx, x, y, hh * 1.6, col, 0.18);
          if (rowH > 34 || k <= 3)
            text(ctx, String(k), x, y + hh + 11, { size: 9, color: rgba(col, 0.7), align: "center", mono: true });
        }
      }

      // collisions: connectors and beat lamps
      lamps = [];
      for (const hit of hs) {
        if (hit.fa > fMax || hit.fb > fMax) continue;
        const xa = X(hit.fa);
        const xb = X(hit.fb);
        const ya = rowY(hit.a);
        const yb = rowY(hit.b);
        const locked = hit.rate < 0.01;
        const col: RGB = locked ? hex("#7dd6a0") : hit.rate < 2 ? hex("#e8d27a") : hex("#ff6b6b");
        ctx.strokeStyle = rgba(col, 0.55);
        ctx.lineWidth = 1.2;
        ctx.setLineDash(locked ? [] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(xa, ya);
        ctx.lineTo(xb, yb);
        ctx.stroke();
        ctx.setLineDash([]);
        const mx = (xa + xb) / 2;
        const my = (ya + yb) / 2;
        const pulse = locked ? 1 : 0.72 + 0.28 * Math.cos(2 * Math.PI * hit.rate * t);
        dot(ctx, mx, my, 3.2, col, pulse, 4.5);
        lamps.push({ x: mx, y: my, hit });
        if (hit.i + hit.j <= 9 || rows === 2) {
          const s = locked ? "0" : hit.rate.toFixed(hit.rate < 2 ? 2 : 1);
          label(ctx, `${s}/s`, mx, my - 13, { size: 9.5, mono: true, color: rgba(mixRgb(col, [255, 255, 255], 0.4), 1) });
        }
      }

      // ---- the strongest collision as a loudness envelope over one second ----
      const main = mainHit(hs, fMax);
      if (main) {
        // ring the collision the strip is showing
        const mx = (X(main.fa) + X(main.fb)) / 2;
        const my = (rowY(main.a) + rowY(main.b)) / 2;
        ctx.strokeStyle = "rgba(255, 220, 190, 0.6)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(mx, my, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      const ey0 = ladderH + (narrow ? 44 : 40);
      const ey1 = h - 22;
      const eh = ey1 - ey0;
      const ex0 = padL;
      const ex1 = w - padR;
      ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
      ctx.fillRect(ex0, ey0, ex1 - ex0, eh);
      if (main) {
        const a1 = 1 / main.i;
        const a2 = 1 / main.j;
        const locked = main.rate < 0.01;
        const col: RGB = locked ? hex("#7dd6a0") : hex("#ff8a6e");
        const mid = ey0 + eh / 2;
        const scale = (eh / 2 - 6) / (a1 + a2);
        ctx.beginPath();
        const cols = Math.max(60, Math.floor(ex1 - ex0));
        for (let i = 0; i <= cols; i++) {
          const tt = i / cols; // seconds, one-second window
          const env = Math.sqrt(a1 * a1 + a2 * a2 + 2 * a1 * a2 * Math.cos(2 * Math.PI * main.rate * (tt - t * 0.25)));
          const x = ex0 + (ex1 - ex0) * tt;
          const y = mid - env * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = cols; i >= 0; i--) {
          const tt = i / cols;
          const env = Math.sqrt(a1 * a1 + a2 * a2 + 2 * a1 * a2 * Math.cos(2 * Math.PI * main.rate * (tt - t * 0.25)));
          ctx.lineTo(ex0 + (ex1 - ex0) * tt, mid + env * scale);
        }
        ctx.closePath();
        ctx.fillStyle = rgba(col, 0.22);
        ctx.fill();
        ctx.strokeStyle = rgba(col, 0.85);
        ctx.lineWidth = 1.3;
        ctx.stroke();
        const desc = locked
          ? `${names[main.a]}×${main.i} and ${names[main.b]}×${main.j} coincide: steady`
          : `${names[main.a]}×${main.i} vs ${names[main.b]}×${main.j}: ${main.rate.toFixed(main.rate < 2 ? 2 : 1)} swells per second`;
        text(ctx, desc, ex0, ey0 - 8, { size: 10.5, color: rgba(mixRgb(col, [255, 255, 255], 0.35), 1), mono: true });
        text(ctx, "one second →", ex1, ey1 + 14, { size: 9.5, color: COL.dim, align: "right" });
        text(ctx, "click a lamp to show a different pair", ex0, ey1 + 14, { size: 9.5, color: COL.dim });
      }
    },
    dispose() {
      silence();
    },
  };
}
