// Part 5 hero: a ring of the twelve notes with seven of them lit, and a
// melody improvising inside the current mode, its path drawn as glowing
// chords across the ring. Every few phrases the mode darkens by one step
// (Lydian → Ionian → … → Locrian and back up), and you can watch the one
// note that moves slide a semitone. With sound on, a drone holds C so each
// mode's colour is audible. Tap a note to play it.

import { Shell, type Demo } from "../../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../../lib/audio";
import { PC_NAMES, mod } from "./theory";
import { COL, Surface, approach, clock, dot, glow, glowStroke, mixRgb, pcColor, rgba, text, type RGB } from "./draw";
import { Sound, type Held } from "./sound";
import { heroAspect, heroBand } from "./hero";
import { toggle } from "./ui";

// modes on C, brightest to darkest; each differs from the last by one note
const MODES: { name: string; pcs: number[]; formula: string }[] = [
  { name: "Lydian", pcs: [0, 2, 4, 6, 7, 9, 11], formula: "1 2 3 ♯4 5 6 7" },
  { name: "Ionian", pcs: [0, 2, 4, 5, 7, 9, 11], formula: "1 2 3 4 5 6 7" },
  { name: "Mixolydian", pcs: [0, 2, 4, 5, 7, 9, 10], formula: "1 2 3 4 5 6 ♭7" },
  { name: "Dorian", pcs: [0, 2, 3, 5, 7, 9, 10], formula: "1 2 ♭3 4 5 6 ♭7" },
  { name: "Aeolian", pcs: [0, 2, 3, 5, 7, 8, 10], formula: "1 2 ♭3 4 5 ♭6 ♭7" },
  { name: "Phrygian", pcs: [0, 1, 3, 5, 7, 8, 10], formula: "1 ♭2 ♭3 4 5 ♭6 ♭7" },
  { name: "Locrian", pcs: [0, 1, 3, 5, 6, 8, 10], formula: "1 ♭2 ♭3 4 ♭5 ♭6 ♭7" },
];

const BEAT = 0.34; // seconds per melody note
const MODE_SECONDS = 13;

interface Trail {
  from: number; // pc
  to: number;
  born: number;
}

export function mountHeroRing(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const surf = new Surface(shell.canvas, heroAspect(container));
  const sound = new Sound({ level: 0.85, reverb: 0.25 });

  let modeIdx = 3; // start on Dorian
  let dir = 1;
  let modeT = 0;
  const beadPos: number[] = new Array(12).fill(0).map((_, pc) => (MODES[modeIdx].pcs.includes(pc) ? 1 : 0));
  const flash = new Array(12).fill(0);
  let trails: Trail[] = [];
  let soundOn = false;
  let drone: Held | null = null;
  let hover = -1;
  let geo = { cx: 0, cy: 0, R: 1 };

  // melody state: a degree index into the mode, with octave
  let deg = 0;
  let lastPc = 0;
  let nextAt = 0.6;
  let phraseLeft = 8;
  let rest = 0;
  let clockT = 0;
  // seeded random so the opening looks the same each visit
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const stopDrone = (): void => {
    drone?.release(0.8);
    drone = null;
  };
  const guard = frameGuard(() => {
    stopDrone();
    sound.silence();
  });

  const pitchOf = (d: number): number => {
    const pcs = MODES[modeIdx].pcs;
    const oct = Math.floor(d / 7);
    return 60 + pcs[mod(d, 7)] + 12 * oct;
  };
  const playMidi = (m: number, vel = 0.55): void => {
    if (!soundOn || !sound.ready) return;
    sound.note(440 * Math.pow(2, (m - 69) / 12), 0, { vel, dur: 1.5, timbre: "keys", bright: 0.4 });
  };

  const stepMelody = (): void => {
    if (rest > 0) {
      rest--;
      return;
    }
    // random walk on scale degrees, leaning back toward the middle
    const r = rand();
    let move = r < 0.36 ? 1 : r < 0.72 ? -1 : r < 0.84 ? 2 : r < 0.94 ? -2 : r < 0.97 ? 4 : -3;
    if (deg > 9) move = -Math.abs(move);
    if (deg < -2) move = Math.abs(move);
    phraseLeft--;
    if (phraseLeft <= 0) {
      // end the phrase on the tonic or the fifth
      const targets = [0, 4, 7];
      deg = targets.reduce((a, b) => (Math.abs(b - deg) < Math.abs(a - deg) ? b : a));
      phraseLeft = 6 + Math.floor(rand() * 7);
      rest = 2 + Math.floor(rand() * 2);
    } else deg += move;
    const m = pitchOf(deg);
    const pc = mod(m, 12);
    trails.push({ from: lastPc, to: pc, born: clockT });
    lastPc = pc;
    flash[pc] = 1;
    playMidi(m, phraseLeft === 6 ? 0.62 : 0.5);
  };

  const btn = toggle(shell.controls, ["▶ Play sound", "■ Mute"], (on) => {
    if (on) {
      void unlockAudio().then(() => {
        soundOn = true;
        startDrone();
      });
    } else {
      soundOn = false;
      stopDrone();
      sound.silence();
    }
  });
  btn.el.classList.add("tn-hero-play");
  const startDrone = (): void => {
    if (drone || !sound.ready) return;
    drone = sound.hold([65.41, 130.81, 196.0], { timbre: "soft", level: 0.035, attack: 1.2, cutoff: 1400 });
  };

  const pick = (x: number, y: number): number => {
    let best = -1;
    let bd = Math.max(24, geo.R * 0.14);
    for (let pc = 0; pc < 12; pc++) {
      const [bx, by] = clock(geo.cx, geo.cy, geo.R, pc / 12);
      const d = Math.hypot(bx - x, by - y);
      if (d < bd) {
        bd = d;
        best = pc;
      }
    }
    return best;
  };
  shell.canvas.addEventListener("pointermove", (e) => {
    const p = surf.local(e);
    hover = pick(p.x, p.y);
  });
  shell.canvas.addEventListener("pointerleave", () => (hover = -1));
  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    const pc = pick(p.x, p.y);
    void unlockAudio().then(() => {
      if (!soundOn) {
        soundOn = true;
        btn.set(true);
        startDrone();
      }
      if (pc >= 0) {
        flash[pc] = 1;
        trails.push({ from: lastPc, to: pc, born: clockT });
        lastPc = pc;
        playMidi(60 + pc, 0.7);
      }
    });
  });

  shell.setInfo(() => {
    const m = MODES[modeIdx];
    return `${m.name} on C · ${m.pcs.map((pc) => PC_NAMES[pc]).join(" ")} · tap a note`;
  });

  // run the melody for a few seconds before the first frame, silently, so
  // the ring opens with trails already drawn
  clockT = 3.2;
  while (nextAt <= clockT) {
    stepMelody();
    nextAt += BEAT;
  }

  let last = performance.now();
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clockT += dt;
      modeT += dt;

      if (modeT > MODE_SECONDS) {
        modeT = 0;
        if (modeIdx + dir < 0 || modeIdx + dir >= MODES.length) dir = -dir;
        modeIdx += dir;
      }
      while (clockT >= nextAt) {
        stepMelody();
        nextAt += BEAT;
      }
      const lit = MODES[modeIdx].pcs;
      for (let pc = 0; pc < 12; pc++) {
        beadPos[pc] = approach(beadPos[pc], lit.includes(pc) ? 1 : 0, 3.5, dt);
        flash[pc] = approach(flash[pc], 0, 3, dt);
      }
      trails = trails.filter((t) => clockT - t.born < 4.5);

      // ---- draw ----
      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear("#07080d");
      const band = heroBand(shell.canvas, w, h);
      const bh = band.bottom - band.top;
      const R = Math.max(50, Math.min(w * 0.4, bh / 2 - 30));
      const cx = w / 2;
      const cy = band.top + bh / 2;
      geo = { cx, cy, R };
      const fs = Math.max(11, Math.min(16, R * 0.075));

      // brightness tint: warm for bright modes, violet for dark
      const bright = 1 - modeIdx / 6;
      const tint: RGB = mixRgb([150, 110, 255], [255, 190, 110], bright);
      glow(ctx, cx, cy, R * 1.5, tint, 0.16);
      glow(ctx, cx, cy, R * 0.55, tint, 0.1);

      // faint ring
      ctx.strokeStyle = rgba(tint, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // the scale's outline: chords between consecutive lit notes
      const litSorted = [...lit].sort((a, b) => a - b);
      ctx.beginPath();
      litSorted.forEach((pc, i) => {
        const [x, y] = clock(cx, cy, R, pc / 12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = rgba(tint, 0.18);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // half steps glow warm: that's where the mode's character lives
      for (let i = 0; i < litSorted.length; i++) {
        const a = litSorted[i];
        const b = litSorted[(i + 1) % litSorted.length];
        if (mod(b - a, 12) === 1) {
          const [x0, y0] = clock(cx, cy, R, a / 12);
          const [x1, y1] = clock(cx, cy, R, b / 12);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          glowStroke(ctx, [255, 150, 90], 0.55, 1.6);
        }
      }

      // melody trails: curved chords bowing toward the centre
      for (const t of trails) {
        const age = (clockT - t.born) / 4.5;
        if (t.from === t.to) continue;
        const [x0, y0] = clock(cx, cy, R, t.from / 12);
        const [x1, y1] = clock(cx, cy, R, t.to / 12);
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const qx = cx + (mx - cx) * 0.35;
        const qy = cy + (my - cy) * 0.35;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(qx, qy, x1, y1);
        const col = mixRgb(pcColor(t.from), pcColor(t.to), 0.5);
        glowStroke(ctx, col, 0.55 * (1 - age) * (1 - age), 1.3);
      }

      // beads
      for (let pc = 0; pc < 12; pc++) {
        const [x, y] = clock(cx, cy, R, pc / 12);
        const on = beadPos[pc];
        const col = pcColor(pc);
        const f = flash[pc];
        const hov = hover === pc ? 1 : 0;
        ctx.fillStyle = "rgba(120, 130, 170, 0.25)";
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        if (on > 0.02) dot(ctx, x, y, (4 + 3 * f + 1.5 * hov) * (0.4 + 0.6 * on), pc === 0 ? [255, 214, 150] : col, on, 3.5 + 3 * f);
        const [lx, ly] = clock(cx, cy, R + fs * 1.5, pc / 12);
        text(ctx, PC_NAMES[pc], lx, ly, {
          size: fs * 0.92,
          color: on > 0.5 ? rgba(mixRgb(col, [255, 255, 255], 0.55), 1) : COL.faint,
          align: "center",
          base: "middle",
          weight: on > 0.5 ? 700 : 500,
          alpha: 0.4 + 0.6 * Math.max(on, hov),
        });
      }

      // centre: mode name
      const m = MODES[modeIdx];
      const fade = Math.min(1, modeT / 0.8, (MODE_SECONDS - modeT) / 0.8);
      text(ctx, m.name, cx, cy - fs * 0.2, { size: fs * 1.6, color: "#f4f6fc", align: "center", base: "middle", weight: 700, alpha: 0.35 + 0.65 * fade });
      text(ctx, m.formula, cx, cy + fs * 1.3, { size: fs * 0.82, color: COL.dim, align: "center", base: "middle", mono: true, alpha: 0.3 + 0.7 * fade });
    },
    dispose() {
      stopDrone();
      sound.silence();
    },
  };
}
