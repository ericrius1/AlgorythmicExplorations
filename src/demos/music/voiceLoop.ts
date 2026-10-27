// Chords in a key, as moving voices. Pick chords from C major (or play a
// preset progression) and the figure draws the four voices as threads: the
// bass takes each root, and the three upper voices each slide to the nearest
// tone of the next chord (the minimum-motion search from theory.ts). Common
// tones stay level; moving voices are labelled with how far they went.
// Under the threads, two numbers per chord: its distance from I in Lerdahl's
// tonal pitch space, and its roughness. Over the threads, the classic
// function cycle (tonic → predominant → dominant → tonic) lights up.

import { Shell, type Demo } from "../../lib/demoShell";
import { frameGuard } from "../../lib/audio";
import { PC_NAMES, chordRoughness, lerdahlDistance, midiToFreq, mod12, noteName, voiceLead } from "./harmony/theory";
import { COL, VOICE, chip, clear, figureAspect, font, glow, glowPath, line, refresh, rgba, setActive, smooth, tapToPlay, text, view2d } from "./harmony/draw";
import { Clock, bass, epiano, startAudio, strip, type Inst, soon } from "./harmony/sound";

type Fn = "T" | "P" | "D";

interface ChordDef {
  rn: string; // roman numeral
  name: string;
  root: number;
  pcs: number[]; // root, third, fifth (, seventh)
  fn: Fn;
}

const DEFS: ChordDef[] = [
  { rn: "I", name: "C", root: 0, pcs: [0, 4, 7], fn: "T" },
  { rn: "ii", name: "Dm", root: 2, pcs: [2, 5, 9], fn: "P" },
  { rn: "iii", name: "Em", root: 4, pcs: [4, 7, 11], fn: "T" },
  { rn: "IV", name: "F", root: 5, pcs: [5, 9, 0], fn: "P" },
  { rn: "V", name: "G", root: 7, pcs: [7, 11, 2], fn: "D" },
  { rn: "V7", name: "G7", root: 7, pcs: [7, 11, 2, 5], fn: "D" },
  { rn: "vi", name: "Am", root: 9, pcs: [9, 0, 4], fn: "T" },
  { rn: "vii°", name: "B°", root: 11, pcs: [11, 2, 5], fn: "D" },
];
const D = (rn: string): ChordDef => DEFS.find((d) => d.rn === rn)!;

const PRESETS: { name: string; seq: string[] }[] = [
  { name: "I–IV–V7–I", seq: ["I", "IV", "V7", "I"] },
  { name: "I–V–vi–IV", seq: ["I", "V", "vi", "IV"] },
  { name: "ii–V7–I", seq: ["ii", "V7", "I", "I"] },
  { name: "deceptive", seq: ["I", "IV", "V7", "vi"] },
  { name: "Pachelbel", seq: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"] },
];

const FN_COL: Record<Fn, string> = { T: COL.calm, P: COL.major, D: COL.tension };
const FN_NAME: Record<Fn, string> = { T: "tonic", P: "predominant", D: "dominant" };

interface Slot {
  def: ChordDef;
  bass: number;
  upper: number[];
  dist: number; // Lerdahl δ from I
  rough: number;
  at: number; // performance.now() when added
}

const SLOTS = 8;

export async function mountVoiceLoop(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, figureAspect(container, 0.66, 1.2));
  container.classList.add("mh-fig");
  const canvas = shell.canvas;
  const v = view2d(canvas);

  const I = DEFS[0];
  const slots: Slot[] = [];
  let upper = [55, 60, 64]; // G3 C4 E4: I in a comfortable spread
  let bassNote = 48;

  const realise = (def: ChordDef): Slot => {
    // upper voices: the triad; for V7 the third, the seventh and the root
    // (dropping the fifth, the usual way to fit a seventh chord in four parts)
    const pcs = def.pcs.length === 4 ? [def.pcs[1], def.pcs[3], def.pcs[0]] : def.pcs;
    upper = voiceLead(upper, pcs, 53, 74);
    let b = def.root + 12 * Math.round((bassNote - def.root) / 12);
    while (b < 40) b += 12;
    while (b > 52) b -= 12;
    bassNote = b;
    const all = [bassNote, ...upper];
    return {
      def,
      bass: bassNote,
      upper: upper.slice(),
      dist: lerdahlDistance(I.root, I.pcs, def.root, def.pcs),
      rough: chordRoughness(all.map(midiToFreq)),
      at: performance.now(),
    };
  };
  const push = (def: ChordDef): Slot => {
    const s = realise(def);
    slots.push(s);
    if (slots.length > SLOTS + 1) slots.shift();
    return s;
  };
  // start with a cadence already on screen, so the figure says something before you touch it
  for (const rn of ["I", "vi", "IV", "V", "I", "ii", "V7", "I"]) push(D(rn));
  for (const s of slots) s.at = -1e9;

  // ---- sound -----------------------------------------------------------------------------
  let keys: Inst | null = null;
  let low: Inst | null = null;
  const ensure = async (): Promise<void> => {
    await startAudio();
    if (keys) return;
    keys = epiano(strip({ db: 0, reverb: 0.25 }).input, -12);
    low = bass(strip({ db: -1 }).input, -13);
  };
  const sound = (s: Slot, t: number, vel = 0.7, len = 1.8): void => {
    if (!keys || !low) return;
    s.upper.forEach((m, k) => keys!.play(m, len, t + k * 0.009, vel * (0.85 + 0.1 * k)));
    low.play(s.bass, len * 0.9, t, vel);
  };

  // preset playback: a chord per bar, struck on 1 and lightly on 3
  let seq: ChordDef[] = [];
  let seqPos = 0;
  const clock = new Clock(84, 1, (step, time, dur) => {
    if (seq.length === 0) return;
    const beat = step % 4;
    if (beat === 0) {
      const s = push(seq[seqPos % seq.length]);
      seqPos++;
      sound(s, time, 0.72, dur * 3.6);
    } else if (beat === 2) {
      const s = slots[slots.length - 1];
      s.upper.forEach((m, k) => keys?.play(m, dur * 1.6, time + k * 0.008, 0.38));
      low?.play(s.bass, dur * 1.5, time, 0.5);
    }
  });
  const stop = (): void => {
    clock.stop();
    seq = [];
    keys?.release();
    low?.release();
    syncButtons();
  };
  const guard = frameGuard(stop);

  const tap = tapToPlay(
    container,
    "Tap to hear I–IV–V7–I",
    () => {
      void ensure().then(() => {
        tap.hide();
        startPreset(0);
      });
    },
    0.38,
  );

  // ---- controls ------------------------------------------------------------------------------
  const chordGroup = document.createElement("div");
  chordGroup.className = "mh-group";
  const lab = document.createElement("span");
  lab.className = "mh-group-label";
  lab.textContent = "next chord";
  chordGroup.appendChild(lab);
  shell.controls.appendChild(chordGroup);
  for (const d of DEFS) {
    const b = shell.button(d.rn, () => {
      void ensure().then(() => {
        tap.hide();
        if (clock.isRunning) stop();
        sound(push(d), soon());
      });
    });
    b.style.borderColor = rgba(FN_COL[d.fn], 0.5);
    chordGroup.appendChild(b);
  }

  const presetGroup = document.createElement("div");
  presetGroup.className = "mh-group";
  const lab2 = document.createElement("span");
  lab2.className = "mh-group-label";
  lab2.textContent = "loop";
  presetGroup.appendChild(lab2);
  shell.controls.appendChild(presetGroup);
  const presetBtns: HTMLButtonElement[] = [];
  let activePreset = -1;
  const syncButtons = (): void => {
    presetBtns.forEach((b, i) => setActive(b, clock.isRunning && i === activePreset));
  };
  const startPreset = (i: number): void => {
    activePreset = i;
    seq = PRESETS[i].seq.map(D);
    seqPos = 0;
    if (!clock.isRunning) clock.start();
    syncButtons();
  };
  PRESETS.forEach((p, i) => {
    const b = shell.button(p.name, () => {
      void ensure().then(() => {
        tap.hide();
        if (clock.isRunning && activePreset === i) stop();
        else startPreset(i);
      });
    });
    presetGroup.appendChild(b);
    presetBtns.push(b);
  });
  shell.slider({
    label: "tempo",
    min: 56,
    max: 132,
    step: 1,
    value: clock.bpm,
    format: (x) => `${Math.round(x)} bpm`,
    onInput: (x) => (clock.bpm = x),
  });

  shell.setInfo(() => {
    const n = slots.length;
    const cur = slots[n - 1];
    const prev = slots[n - 2];
    if (!prev) return `${cur.def.rn} (${cur.def.name})`;
    const moves: string[] = [];
    let total = 0;
    cur.upper.forEach((m, k) => {
      const d = m - prev.upper[k];
      total += Math.abs(d);
      if (d !== 0) moves.push(`${PC_NAMES[mod12(prev.upper[k])]}→${PC_NAMES[mod12(m)]} (${d > 0 ? "+" : ""}${d})`);
    });
    const held = cur.upper.filter((m, k) => m === prev.upper[k]).map((m) => PC_NAMES[mod12(m)]);
    return `${prev.def.rn} → ${cur.def.rn}: ${moves.join(", ") || "nothing moves"}${held.length ? ` · held ${held.join(", ")}` : ""} · upper voices move ${total} semitones · distance from I ${prev.dist} → ${cur.dist}`;
  });

  // ---- drawing ---------------------------------------------------------------------------------
  const draw = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    const narrow = w / px < 520;
    clear(v, "#0b0d16", "#06070b");
    const now = performance.now();

    const fnW = narrow ? 0 : 170 * px;
    const left = (narrow ? 50 : 44) * px;
    const right = w - fnW - 16 * px;
    const top = (narrow ? 96 : 22) * px;
    const metersH = (narrow ? 64 : 70) * px;
    const chipY = h - metersH - 16 * px;
    const bottom = chipY - 20 * px;
    const LO = 38;
    const HI = 76;
    const Y = (m: number): number => bottom - ((m - LO) / (HI - LO)) * (bottom - top);

    // slide animation: the newest chord eases into the rightmost slot
    const newest = slots[slots.length - 1];
    const slide = smooth((now - newest.at) / 450);
    const slotW = (right - left) / SLOTS;
    // slot k (0 = oldest shown) centre; with SLOTS+1 kept, the extra one slides out on the left
    const X = (k: number): number => left + slotW * (k - (slots.length - SLOTS) + 0.5) + slotW * (1 - slide) * (slots.length > SLOTS ? 1 : 0);

    // pitch grid: C lines
    for (let m = 36; m <= HI; m += 12) {
      const y = Y(m);
      if (y < top - 4 * px) continue;
      line(ctx, left, y, right, y, COL.grid, 1 * px);
      text(ctx, noteName(m), left - 6 * px, y, { color: COL.dim, align: "right", font: font(px, 9, 600, true) });
    }

    // the threads (clipped to the plot so old chords slide out cleanly)
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 0, right - left + 30 * px, h);
    ctx.clip();
    const voices = 4;
    for (let vv = 0; vv < voices; vv++) {
      const col = vv === 0 ? COL.major : VOICE[vv];
      const get = (s: Slot): number => (vv === 0 ? s.bass : s.upper[vv - 1]);
      for (let k = 0; k < slots.length; k++) {
        const s = slots[k];
        const x = X(k);
        const y = Y(get(s));
        const half = slotW * 0.32;
        const fresh = k === slots.length - 1 ? 1 - smooth((now - s.at) / 900) : 0;
        // held segment inside the slot
        glowPath(
          ctx,
          (c) => {
            c.moveTo(x - half, y);
            c.lineTo(x + half, y);
          },
          col,
          (vv === 0 ? 2.4 : 1.8) * px,
          0.85 + fresh * 0.3,
        );
        glow(ctx, x, y, (10 + 8 * fresh) * px, col, 0.5 + 0.5 * fresh);
        // transition to the next slot
        if (k + 1 < slots.length) {
          const n = slots[k + 1];
          const x1 = X(k + 1);
          const y1 = Y(get(n));
          const d = get(n) - get(s);
          glowPath(
            ctx,
            (c) => {
              c.moveTo(x + half, y);
              c.bezierCurveTo(x + slotW * 0.5, y, x1 - slotW * 0.5, y1, x1 - half, y1);
            },
            col,
            (d === 0 ? 1.8 : 1.3) * px,
            d === 0 ? 0.85 : 0.6,
          );
          if (d !== 0 && vv > 0 && slotW > 50 * px) {
            const mx = (x + x1) / 2;
            const my = (y + y1) / 2;
            text(ctx, `${d > 0 ? "+" : ""}${d}`, mx, my - 8 * px, { color: col, align: "center", font: font(px, 9.5, 700, true), alpha: 0.9 });
          }
        }
        // note names on the newest chord
        if (k === slots.length - 1) {
          text(ctx, PC_NAMES[mod12(get(s))], x + half + 6 * px, y, { color: col, font: font(px, 10.5, 700) });
        }
      }
    }

    // chord chips and meters
    const maxDist = 8;
    const roughs = slots.map((s) => s.rough);
    const rMax = Math.max(...roughs, 0.5);
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k];
      const x = X(k);
      if (x < left - slotW * 0.2) continue;
      const fade = Math.min(1, (x - left + slotW * 0.2) / (slotW * 0.6));
      ctx.globalAlpha = fade;
      chip(ctx, s.def.rn, x, chipY, px, FN_COL[s.def.fn], { size: narrow ? 10.5 : 12 });
      ctx.globalAlpha = 1;
      const bw = Math.min(slotW * 0.46, 40 * px);
      const my = chipY + 22 * px;
      // distance from I
      ctx.fillStyle = rgba(COL.tension, 0.18 * fade);
      ctx.fillRect(x - bw / 2, my, bw, 6 * px);
      ctx.fillStyle = rgba(COL.tension, 0.9 * fade);
      ctx.fillRect(x - bw / 2, my, (bw * s.dist) / maxDist, 6 * px);
      // roughness
      ctx.fillStyle = rgba(COL.minor, 0.18 * fade);
      ctx.fillRect(x - bw / 2, my + 13 * px, bw, 6 * px);
      ctx.fillStyle = rgba(COL.minor, 0.9 * fade);
      ctx.fillRect(x - bw / 2, my + 13 * px, (bw * s.rough) / rMax, 6 * px);
      if (!narrow) {
        text(ctx, String(s.dist), x + bw / 2 + 4 * px, my + 3 * px, { color: COL.tension, font: font(px, 9, 600, true), alpha: fade });
        text(ctx, s.rough.toFixed(2), x + bw / 2 + 4 * px, my + 16 * px, { color: COL.minor, font: font(px, 9, 600, true), alpha: fade });
      }
    }
    ctx.restore();
    text(ctx, "δ from I", left - 6 * px, chipY + 25 * px, { color: COL.tension, align: "right", font: font(px, 9, 600) });
    text(ctx, "rough", left - 6 * px, chipY + 38 * px, { color: COL.minor, align: "right", font: font(px, 9, 600) });

    // the function cycle
    const cur = slots[slots.length - 1].def.fn;
    const fx = narrow ? w / 2 : w - fnW / 2 - 8 * px;
    const fy = narrow ? 50 * px : h * 0.36;
    const R = (narrow ? 34 : 52) * px;
    const pos: Record<Fn, [number, number]> = narrow
      ? { T: [fx - R * 2.6, fy], P: [fx, fy], D: [fx + R * 2.6, fy] }
      : { T: [fx, fy - R], P: [fx + R * 0.95, fy + R * 0.6], D: [fx - R * 0.95, fy + R * 0.6] };
    const arrow = (a: Fn, b: Fn, dashed = false): void => {
      const [x0, y0] = pos[a];
      const [x1, y1] = pos[b];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const L = Math.hypot(dx, dy);
      const ux = dx / L;
      const uy = dy / L;
      const r0 = 22 * px;
      const sx = x0 + ux * r0;
      const sy = y0 + uy * r0;
      const ex = x1 - ux * r0;
      const ey = y1 - uy * r0;
      ctx.setLineDash(dashed ? [3 * px, 4 * px] : []);
      line(ctx, sx, sy, ex, ey, rgba("#c9d1ea", 0.4), 1.2 * px);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * 7 * px - uy * 4 * px, ey - uy * 7 * px + ux * 4 * px);
      ctx.lineTo(ex - ux * 7 * px + uy * 4 * px, ey - uy * 7 * px - ux * 4 * px);
      ctx.closePath();
      ctx.fillStyle = rgba("#c9d1ea", 0.55);
      ctx.fill();
    };
    if (narrow) {
      arrow("T", "P");
      arrow("P", "D");
    } else {
      arrow("T", "P");
      arrow("P", "D");
      arrow("D", "T");
    }
    for (const f of ["T", "P", "D"] as Fn[]) {
      const [x, y] = pos[f];
      const on = f === cur;
      if (on) glow(ctx, x, y, 40 * px, FN_COL[f], 0.55);
      ctx.beginPath();
      ctx.arc(x, y, 20 * px, 0, Math.PI * 2);
      ctx.fillStyle = on ? rgba(FN_COL[f], 0.9) : "rgba(16, 19, 30, 0.95)";
      ctx.fill();
      ctx.strokeStyle = rgba(FN_COL[f], 0.8);
      ctx.lineWidth = 1.4 * px;
      ctx.stroke();
      text(ctx, f, x, y + 0.5 * px, { color: on ? "#11131c" : FN_COL[f], align: "center", font: font(px, 13, 800) });
      const members = DEFS.filter((d) => d.fn === f && d.rn !== "V7")
        .map((d) => d.rn)
        .join(" ");
      const ly = narrow ? y + 31 * px : f === "T" ? y - 42 * px : y + 33 * px;
      text(ctx, FN_NAME[f], x, ly, { color: on ? FN_COL[f] : COL.muted, align: "center", font: font(px, 9.5, 700) });
      text(ctx, members, x, ly + 12 * px, { color: COL.dim, align: "center", font: font(px, 9, 600) });
    }
  };

  return {
    frame() {
      shell.tick();
      guard.pulse();
      draw();
    },
    dispose() {
      stop();
    },
  };
}
