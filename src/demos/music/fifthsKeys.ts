// Fig. 4 of Part 5: the circle of fifths as a map of keys. Major keys round
// the outside, their relative minors (same notes, different home) inside.
// Every key is marked with how many of its seven notes it shares with the
// selected one, so distance on the map is how much changes when you move.
// Click another key to hear a modulation: the old tonic chord, the new key's
// dominant seventh, the new tonic.

import { Shell, type Demo } from "../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../lib/audio";
import { mod } from "./tuning/theory";
import { COL, Surface, approach, clock, clockArc, glow, glowStroke, hex, heat, mixRgb, rgba, text, type RGB } from "./tuning/draw";
import { Sound } from "./tuning/sound";
import { tapBadge, button } from "./tuning/ui";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const KEYS = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
const MINORS = ["a", "e", "b", "f♯", "c♯", "g♯", "d♯", "b♭", "f", "c", "g", "d"];
const SIGS = ["no ♯ or ♭", "1♯", "2♯", "3♯", "4♯", "5♯", "6♯", "5♭", "4♭", "3♭", "2♭", "1♭"];
// spelled scale notes for each key, for the readout
const SPELL: Record<string, string> = {
  C: "C D E F G A B",
  G: "G A B C D E F♯",
  D: "D E F♯ G A B C♯",
  A: "A B C♯ D E F♯ G♯",
  E: "E F♯ G♯ A B C♯ D♯",
  B: "B C♯ D♯ E F♯ G♯ A♯",
  "F♯": "F♯ G♯ A♯ B C♯ D♯ E♯",
  "D♭": "D♭ E♭ F G♭ A♭ B♭ C",
  "A♭": "A♭ B♭ C D♭ E♭ F G",
  "E♭": "E♭ F G A♭ B♭ C D",
  "B♭": "B♭ C D E♭ F G A",
  F: "F G A B♭ C D E",
};

const tonicPc = (k: number): number => mod(k * 7, 12);
const keyPcs = (k: number): Set<number> => new Set(MAJOR.map((s) => mod(tonicPc(k) + s, 12)));
const shared = (a: number, b: number): number => {
  const A = keyPcs(a);
  let n = 0;
  for (const pc of keyPcs(b)) if (A.has(pc)) n++;
  return n;
};

export function mountFifthsKeys(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.66);
  const surf = new Surface(shell.canvas, (w) => (w < 600 ? 1.12 : 0.6));
  const sound = new Sound({ level: 1, reverb: 0.18 });
  const badge = tapBadge(container, "tap a key");

  let sel = 0;
  let from = -1; // last modulation's starting key, for the path
  let pathT = 0;
  let minorView = false;
  const flash = new Array(12).fill(0);
  const shownShare = new Array(12).fill(0).map((_, k) => shared(0, k));
  let geo = { cx: 0, cy: 0, R: 1, r: 1 };
  let hover = -1;
  let lastChord: number[] = [];

  const guard = frameGuard(() => sound.silence());

  // voice a chord near the previous one: each pitch class goes to the octave
  // closest to the last chord's average, plus the root in the bass
  const voice = (pcs: number[], rootPc: number): number[] => {
    const center = lastChord.length ? lastChord.reduce((a, b) => a + b, 0) / lastChord.length : 64;
    const upper = pcs.map((pc) => {
      let m = 60 + pc;
      while (m - center > 6) m -= 12;
      while (center - m > 6) m += 12;
      return m;
    });
    lastChord = upper;
    let bass = 36 + rootPc;
    if (bass > 47) bass -= 12;
    return [bass, ...upper];
  };
  const chordAt = (midis: number[], at: number, dur: number): void => {
    midis.forEach((m, i) =>
      sound.note(440 * Math.pow(2, (m - 69) / 12), at, { vel: i === 0 ? 0.5 : 0.42, dur, timbre: "keys", bright: 0.35 }),
    );
  };
  const triad = (rootPc: number, minor = false): number[] => [rootPc, rootPc + (minor ? 3 : 4), rootPc + 7].map((x) => mod(x, 12));

  const playKey = (k: number): void => {
    const t0 = sound.now() + 0.05;
    sound.silence(0.03);
    const tonic = tonicPc(k);
    const base = minorView ? mod(tonic + 9, 12) : tonic;
    const scale = minorView ? [0, 2, 3, 5, 7, 8, 10, 12] : [...MAJOR, 12];
    const startMidi = 60 + base - (base > 6 ? 12 : 0);
    scale.forEach((s, i) => sound.note(440 * Math.pow(2, (startMidi + s - 69) / 12), t0 + i * 0.17, { vel: 0.55, dur: 0.6, timbre: "keys" }));
    lastChord = [];
    chordAt(voice(triad(base, minorView), base), t0 + scale.length * 0.17 + 0.1, 1.6);
  };
  const modulate = (a: number, b: number): void => {
    const t0 = sound.now() + 0.05;
    sound.silence(0.03);
    lastChord = [];
    const ta = tonicPc(a);
    const tb = tonicPc(b);
    const ra = minorView ? mod(ta + 9, 12) : ta;
    const rb = minorView ? mod(tb + 9, 12) : tb;
    chordAt(voice(triad(ra, minorView), ra), t0, 0.95);
    // the new key's dominant seventh (the V7 of a minor key is major too)
    const dom = mod(rb + 7, 12);
    chordAt(voice([dom, dom + 4, dom + 7, dom + 10].map((x) => mod(x, 12)), dom), t0 + 0.9, 0.95);
    chordAt(voice(triad(rb, minorView), rb), t0 + 1.8, 1.8);
  };

  const pick = (x: number, y: number): number => {
    const { cx, cy, R } = geo;
    let best = -1;
    let bd = Math.max(26, R * 0.17);
    for (let k = 0; k < 12; k++) {
      for (const rr of [R, geo.r]) {
        const [px, py] = clock(cx, cy, rr, k / 12);
        const d = Math.hypot(px - x, py - y);
        if (d < bd) {
          bd = d;
          best = k + (rr === geo.r ? 100 : 0);
        }
      }
    }
    return best;
  };
  shell.canvas.addEventListener("pointermove", (e) => {
    const p = surf.local(e);
    hover = pick(p.x, p.y);
    shell.canvas.style.cursor = hover >= 0 ? "pointer" : "default";
  });
  shell.canvas.addEventListener("pointerleave", () => (hover = -1));
  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    const hit = pick(p.x, p.y);
    if (hit < 0) return;
    const k = hit % 100;
    const wantMinor = hit >= 100;
    badge.hide();
    void unlockAudio().then(() => {
      if (wantMinor !== minorView) {
        minorView = wantMinor;
        from = -1;
        sel = k;
        flash[k] = 1;
        playKey(k);
        return;
      }
      if (k === sel) {
        flash[k] = 1;
        playKey(k);
      } else {
        from = sel;
        pathT = 0;
        sel = k;
        flash[k] = 1;
        modulate(from, k);
      }
    });
  });
  button(shell.controls, "◀ a fifth down", () => {
    badge.hide();
    const k = mod(sel - 1, 12);
    void unlockAudio().then(() => {
      from = sel;
      pathT = 0;
      sel = k;
      flash[k] = 1;
      modulate(from, k);
    });
  });
  button(shell.controls, "a fifth up ▶", () => {
    badge.hide();
    const k = mod(sel + 1, 12);
    void unlockAudio().then(() => {
      from = sel;
      pathT = 0;
      sel = k;
      flash[k] = 1;
      modulate(from, k);
    });
  });
  button(shell.controls, "▶ play this key", () => {
    badge.hide();
    void unlockAudio().then(() => {
      flash[sel] = 1;
      playKey(sel);
    });
  });

  shell.setInfo(() => {
    const name = minorView ? `${MINORS[sel]} minor` : `${KEYS[sel]} major`;
    const steps = from >= 0 ? Math.min(mod(sel - from, 12), mod(from - sel, 12)) : 0;
    const move =
      from >= 0
        ? ` · from ${minorView ? MINORS[from] + " minor" : KEYS[from] + " major"}: ${steps} step${steps === 1 ? "" : "s"} round the circle, ${shared(from, sel)} notes in common`
        : "";
    const notes = SPELL[KEYS[sel]].split(" ");
    const spelled = minorView ? [...notes.slice(5), ...notes.slice(0, 5)] : notes;
    return `${name} · ${SIGS[sel]} · ${spelled.join(" ")}${move}`;
  });

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      pathT = Math.min(1, pathT + dt / 1.8);
      for (let k = 0; k < 12; k++) {
        shownShare[k] = approach(shownShare[k], shared(sel, k), 8, dt);
        flash[k] = approach(flash[k], 0, 2.5, dt);
      }

      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear();
      const narrow = w < 600;
      const R = narrow ? Math.min(w * 0.38, h * 0.36) : Math.min(w * 0.27, h * 0.38);
      const r = R * 0.62;
      const cx = narrow ? w / 2 : w * 0.36;
      const cy = narrow ? R + 44 : h * 0.5;
      geo = { cx, cy, R, r };
      const fs = narrow ? 11 : 13;

      glow(ctx, cx, cy, R * 1.25, [40, 52, 96], 0.2);
      ctx.strokeStyle = "rgba(122, 140, 200, 0.14)";
      ctx.lineWidth = 1;
      for (const rr of [R, r]) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }

      // modulation path along the rim
      if (from >= 0 && pathT < 1) {
        const d = mod(sel - from, 12) <= 6 ? mod(sel - from, 12) : mod(sel - from, 12) - 12;
        const t0 = from / 12;
        const t1 = (from + d * Math.min(1, pathT * 1.6)) / 12;
        clockArc(ctx, cx, cy, minorView ? r : R, Math.min(t0, t1), Math.max(t0, t1));
        glowStroke(ctx, hex("#ffd9a0"), 0.9 * (1 - pathT * 0.6), 3);
      }

      for (let k = 0; k < 12; k++) {
        const s = shownShare[k];
        const isSel = k === sel;
        // 7 shared = home, 6 = neighbour … 2 = far side
        const warmth = (s - 2) / 5;
        const col: RGB = isSel ? [255, 214, 150] : mixRgb(hex("#5a6fd6"), hex("#ffb86b"), warmth);
        for (const [rr, lab, isMinor] of [
          [R, KEYS[k], false],
          [r, MINORS[k], true],
        ] as [number, string, boolean][]) {
          const [x, y] = clock(cx, cy, rr, k / 12);
          const active = isMinor === minorView;
          const rad = (isMinor ? 0.75 : 1) * (narrow ? 15 : 19) * (1 + 0.15 * (isSel && active ? flash[k] : 0));
          const hov = hover === k + (isMinor ? 100 : 0);
          glow(ctx, x, y, rad * 2.6, col, (active ? 0.18 + 0.32 * warmth : 0.05) + (isSel && active ? 0.25 : 0));
          ctx.fillStyle = rgba(mixRgb(col, [8, 9, 14], active ? 0.55 : 0.8), 1);
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = rgba(mixRgb(col, [255, 255, 255], 0.3), active ? (isSel ? 1 : hov ? 0.9 : 0.55) : 0.25);
          ctx.lineWidth = isSel && active ? 2.2 : 1;
          ctx.stroke();
          text(ctx, lab, x, y + 0.5, {
            size: (isMinor ? 0.85 : 1) * fs,
            color: active ? "#f4f6fc" : "#7a8199",
            align: "center",
            base: "middle",
            weight: 700,
          });
        }
        // shared-note count outside the rim
        const [nx, ny] = clock(cx, cy, R + (narrow ? 26 : 34), k / 12);
        const n = Math.round(s);
        text(ctx, isSel ? "home" : `${n}`, nx, ny, {
          size: isSel ? fs * 0.8 : fs,
          color: isSel ? "#ffd9a0" : rgba(mixRgb(heat(1 - (n - 2) / 5), [255, 255, 255], 0.2), 1),
          align: "center",
          base: "middle",
          weight: 700,
          mono: !isSel,
        });
      }
      text(ctx, "notes shared with", cx, cy - 8, { size: 10, color: COL.dim, align: "center" });
      text(ctx, minorView ? `${MINORS[sel]} minor` : `${KEYS[sel]} major`, cx, cy + 9, { size: fs, color: "#ffd9a0", align: "center", weight: 700 });

      // ---- side panel: the selected key's notes and its neighbours ----
      if (!narrow) {
        const px = w * 0.7;
        let py = h * 0.2;
        text(ctx, minorView ? `${MINORS[sel]} minor` : `${KEYS[sel]} major`, px, py, { size: 18, color: "#f4f6fc", weight: 700 });
        py += 22;
        text(ctx, SIGS[sel], px, py, { size: 11, color: COL.dim });
        py += 30;
        const rows: [string, number][] = [
          ["a fifth up", mod(sel + 1, 12)],
          ["a fifth down", mod(sel - 1, 12)],
          ["across the circle", mod(sel + 6, 12)],
        ];
        for (const [lab, k] of rows) {
          const n = shared(sel, k);
          text(ctx, lab, px, py, { size: 11, color: COL.dim });
          text(ctx, `${minorView ? MINORS[k] : KEYS[k]}: ${n} of 7`, px + 112, py, { size: 11, color: COL.text, mono: true });
          py += 20;
        }
        py += 16;
        text(ctx, "click another key to modulate:", px, py, { size: 10.5, color: COL.dim });
        py += 16;
        text(ctx, "home chord → new V7 → new home", px, py, { size: 10.5, color: "#f0c08a" });
        py += 16;
        text(ctx, "inner ring: relative minors", px, py, { size: 10.5, color: COL.dim });
      }
    },
    dispose() {
      sound.silence();
    },
  };
}
