// Euclidean rhythms. Spread k drum hits over n steps as evenly as the grid
// allows, using Bjorklund's algorithm: start with k groups holding one hit and
// n − k groups holding one rest, then keep tucking the leftover groups under
// the front ones, the way Euclid's algorithm keeps dividing by the remainder.
// The figure draws the result as a necklace (onsets joined into a polygon),
// shows every stage of the algorithm, and names the pattern when it's one of
// the traditional rhythms Toussaint (2005) lists.

import { Shell, type Demo } from "../../lib/demoShell";
import { frameGuard } from "../../lib/audio";
import { bjorklund, bjorklundStages, onsetGaps, rotate } from "./harmony/theory";
import { COL, clear, figureAspect, font, glow, glowPath, line, refresh, rgba, roundRect, setActive, tapToPlay, text, view2d } from "./harmony/draw";
import { Clock, drumKit, startAudio, strip, ticker, type Kit } from "./harmony/sound";

// Rhythms from Toussaint's paper, written the way he writes them. Matching is
// by necklace (any rotation), so E(5,16) also finds the bossa-nova pattern.
interface Named {
  k: number;
  n: number;
  name: string;
  where: string;
  canon: string; // x = hit, . = rest
}

export const WORLD: Named[] = [
  { k: 2, n: 5, name: "khafif-e-ramal", where: "Persia", canon: "x.x.." },
  { k: 3, n: 4, name: "cumbia", where: "Colombia", canon: "x.xx" },
  { k: 3, n: 7, name: "ruchenitza", where: "Bulgaria", canon: "x.x.x.." },
  { k: 3, n: 8, name: "tresillo", where: "Cuba", canon: "x..x..x." },
  { k: 4, n: 9, name: "aksak", where: "Turkey", canon: "x.x.x.x.." },
  { k: 5, n: 8, name: "cinquillo", where: "Cuba", canon: "x.xx.xx." },
  { k: 5, n: 12, name: "Venda clapping", where: "South Africa", canon: "x..x.x..x.x." },
  { k: 7, n: 12, name: "bell pattern", where: "West Africa", canon: "x.xx.x.xx.x." },
  { k: 5, n: 16, name: "bossa nova", where: "Brazil", canon: "x..x..x...x..x.." },
  { k: 7, n: 16, name: "samba", where: "Brazil", canon: "x..x.x.x..x.x.x." },
  { k: 9, n: 16, name: "rhythm necklace", where: "Central African Republic", canon: "x.xx.x.x.xx.x.x." },
];

// is this gap sequence a rotation of the major scale's 2 2 1 2 2 2 1?
function isDiatonic(g: number[]): boolean {
  const major = [2, 2, 1, 2, 2, 2, 1].join();
  return g.length === 7 && g.some((_, r) => rotate(g, r).join() === major);
}

const toStr = (p: boolean[]): string => p.map((x) => (x ? "x" : ".")).join("");

// the rotation of `p` that reads as `canon`, or -1
function rotationTo(p: boolean[], canon: string): number {
  for (let r = 0; r < p.length; r++) if (toStr(rotate(p, r)) === canon) return r;
  return -1;
}

function named(k: number, n: number): Named | null {
  const p = bjorklund(k, n);
  for (const w of WORLD) if (w.n === n && w.k === k && rotationTo(p, w.canon) >= 0) return w;
  return null;
}

// Steps per beat for the pulse under the pattern: fours for 8 and 16, threes
// for 6, 9 and 12, and just the downbeat for odd grids that have no even beat.
const beatOf = (n: number): number => (n % 4 === 0 && n !== 12 ? 4 : n % 3 === 0 ? 3 : n % 2 === 0 ? 2 : n);

export async function mountEuclid(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, figureAspect(container, 0.52, 1.6));
  container.classList.add("mh-fig");
  const canvas = shell.canvas;
  const v = view2d(canvas);

  let k = 3;
  let n = 8;
  let rot = 0;
  let pattern: boolean[] = [];
  let stages: number[][][] = [];
  const rebuild = (): void => {
    k = Math.max(0, Math.min(n, k));
    rot = ((rot % n) + n) % n;
    stages = bjorklundStages(k, n);
    pattern = rotate(bjorklund(k, n), rot);
  };
  rebuild();

  // ---- sound ------------------------------------------------------------------------------
  let kit: Kit | null = null;
  let tick: ReturnType<typeof ticker> | null = null;
  const hits: { step: number; time: number }[] = [];
  const clock = new Clock(100, 4, (step, time) => {
    const s = step % n;
    const bt = beatOf(n);
    if (s % bt === 0) tick?.tick(s === 0 ? 1760 : 1320, time, s === 0 ? 0.55 : 0.3);
    if (pattern[s]) {
      kit?.hit("conga", time, s === 0 ? 0.95 : 0.72, s === 0 ? 196 : 262);
      hits.push({ step: s, time });
      if (hits.length > 32) hits.shift();
    }
  });
  const ensure = async (): Promise<void> => {
    await startAudio();
    if (!kit) {
      kit = drumKit({}, strip({ db: 1, reverb: 0.12 }).input);
      tick = ticker(strip({ db: -10, pan: 0.2 }).input, -6);
    }
  };
  const start = async (): Promise<void> => {
    tap.hide();
    await ensure();
    clock.stepsPerBeat = 4;
    if (!clock.isRunning) clock.start(0);
    sync();
  };
  const stop = (): void => {
    clock.stop();
    tap.show();
    sync();
  };
  const guard = frameGuard(() => {
    if (clock.isRunning) stop();
  });
  const tap = tapToPlay(container, "Tap to play", () => void start(), 0.5);
  canvas.addEventListener("pointerdown", () => {
    if (clock.isRunning) stop();
    else void start();
  });

  // ---- controls ------------------------------------------------------------------------------
  const playBtn = shell.button("▶ play", () => (clock.isRunning ? stop() : void start()));
  const sync = (): void => {
    playBtn.textContent = clock.isRunning ? "■ stop" : "▶ play";
  };
  const kSlider = shell.slider({
    label: "hits k",
    min: 0,
    max: 16,
    step: 1,
    value: k,
    format: (x) => String(Math.round(x)),
    onInput: (x) => {
      k = Math.round(x);
      rebuild();
      markPreset(null);
    },
  });
  const nSlider = shell.slider({
    label: "steps n",
    min: 2,
    max: 16,
    step: 1,
    value: n,
    format: (x) => String(Math.round(x)),
    onInput: (x) => {
      n = Math.round(x);
      kSlider.max = String(n);
      if (k > n) {
        k = n;
        kSlider.value = String(k);
        kSlider.dispatchEvent(new Event("input"));
      }
      rotSlider.max = String(n - 1);
      rebuild();
      markPreset(null);
    },
  });
  const rotSlider = shell.slider({
    label: "rotate",
    min: 0,
    max: n - 1,
    step: 1,
    value: rot,
    format: (x) => String(Math.round(x)),
    onInput: (x) => {
      rot = Math.round(x);
      rebuild();
      markPreset(null);
    },
  });
  shell.slider({
    label: "tempo",
    min: 60,
    max: 150,
    step: 1,
    value: clock.bpm,
    format: (x) => `${Math.round(x)} bpm`,
    onInput: (x) => (clock.bpm = x),
  });

  const group = document.createElement("div");
  group.className = "mh-group";
  const gl = document.createElement("span");
  gl.className = "mh-group-label";
  gl.textContent = "rhythms";
  group.appendChild(gl);
  const presetBtns: HTMLButtonElement[] = [];
  const setSlider = (el: HTMLInputElement, val: number): void => {
    el.value = String(val);
    el.dispatchEvent(new Event("input"));
  };
  const markPreset = (b: HTMLButtonElement | null): void => {
    for (const x of presetBtns) setActive(x, x === b);
  };
  for (const w of WORLD.filter((x) => [3, 5, 7].includes(x.k) && [8, 12, 16].includes(x.n))) {
    const b = shell.button(`${w.name} E(${w.k},${w.n})`, () => {
      setSlider(nSlider, w.n);
      setSlider(kSlider, w.k);
      setSlider(rotSlider, Math.max(0, rotationTo(bjorklund(w.k, w.n), w.canon)));
      markPreset(b);
      void start();
    });
    group.appendChild(b);
    presetBtns.push(b);
  }
  shell.controls.appendChild(group);
  markPreset(presetBtns[0]);

  shell.setInfo(() => {
    const w = named(k, n);
    const gaps = k > 0 ? onsetGaps(pattern).join("+") : "silence";
    return `E(${k},${n})${rot ? ` rotated ${rot}` : ""} · ${toStr(pattern)} · gaps ${gaps}${w ? ` · ${w.name}, ${w.where}` : ""}`;
  });

  // ---- drawing ---------------------------------------------------------------------------------
  const draw = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    clear(v, "#0b0d16", "#05060a");
    const narrow = w / px < 560;
    const running = clock.isRunning;
    const pos = running ? clock.position() : 0;
    const head = running ? (((pos % n) + n) % n) / n : -1;
    const nowStep = running ? Math.floor(((pos % n) + n) % n) : -1;
    const frac = running ? pos - Math.floor(pos) : 0;

    // ---- the necklace ----
    const cx = narrow ? w * 0.5 : w * 0.3;
    const cy = narrow ? h * 0.235 : h * 0.5;
    const R = narrow ? Math.min(w * 0.34, h * 0.17) : Math.min(w * 0.22, h * 0.39);
    const ang = (s: number): number => -Math.PI / 2 + (s / n) * Math.PI * 2;
    const P = (s: number, r = R): [number, number] => [cx + Math.cos(ang(s)) * r, cy + Math.sin(ang(s)) * r];

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(COL.muted, 0.22);
    ctx.lineWidth = 1 * px;
    ctx.stroke();

    // beat ticks outside the ring
    const bt = beatOf(n);
    for (let s = 0; s < n; s += bt) {
      const [x0, y0] = P(s, R * 1.13);
      const [x1, y1] = P(s, R * 1.2);
      line(ctx, x0, y0, x1, y1, rgba(COL.muted, s === 0 ? 0.8 : 0.45), (s === 0 ? 2 : 1.2) * px);
    }

    // the polygon through the onsets: a regular polygon would mean perfectly even
    const on = pattern.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    if (on.length >= 2) {
      glowPath(
        ctx,
        (c) => {
          on.forEach((s, i) => {
            const [x, y] = P(s);
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
          });
          c.closePath();
        },
        COL.major,
        1.3 * px,
        0.55,
      );
      ctx.beginPath();
      on.forEach((s, i) => {
        const [x, y] = P(s);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = rgba(COL.major, 0.05);
      ctx.fill();
      // gap lengths along each edge
      on.forEach((s, i) => {
        const t = on[(i + 1) % on.length];
        const gap = (t - s + n) % n || n;
        const mid = s + gap / 2;
        const [x, y] = P(mid, R * 0.8);
        text(ctx, String(gap), x, y, { color: COL.major, align: "center", font: font(px, 11, 700), alpha: 0.75 });
      });
    }

    // sweep
    if (running) {
      const a = -Math.PI / 2 + head * Math.PI * 2;
      glowPath(
        ctx,
        (c) => {
          c.moveTo(cx + Math.cos(a) * R * 0.15, cy + Math.sin(a) * R * 0.15);
          c.lineTo(cx + Math.cos(a) * R * 1.08, cy + Math.sin(a) * R * 1.08);
        },
        COL.white,
        1 * px,
        0.45,
      );
    }

    // beads
    for (let s = 0; s < n; s++) {
      const [x, y] = P(s);
      const isNow = s === nowStep;
      if (pattern[s]) {
        const fl = isNow ? 1 - frac : 0;
        glow(ctx, x, y, (16 + 22 * fl) * px, COL.major, 0.55 + 0.45 * fl);
        ctx.beginPath();
        ctx.arc(x, y, 5.5 * px, 0, Math.PI * 2);
        ctx.fillStyle = COL.major;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, (isNow ? 3.6 : 2.6) * px, 0, Math.PI * 2);
        ctx.fillStyle = rgba(COL.muted, isNow ? 0.9 : 0.5);
        ctx.fill();
      }
    }

    // centre label
    const wn = named(k, n);
    text(ctx, `E(${k},${n})`, cx, cy - (wn ? 9 : 0) * px, { color: COL.bright, align: "center", font: font(px, narrow ? 18 : 20, 700) });
    if (wn) text(ctx, `${wn.name} · ${wn.where}`, cx, cy + 13 * px, { color: COL.calm, align: "center", font: font(px, 10.5, 650) });

    // ---- Bjorklund's stages ----
    const x0 = narrow ? 16 * px : w * 0.56;
    const x1 = w - 16 * px;
    const top = narrow ? h * 0.47 : h * 0.12;
    const bottom = h - 18 * px;
    text(ctx, "Bjorklund's algorithm", x0, top - 4 * px, { color: COL.muted, font: font(px, 10, 650) });
    const rows = stages.length;
    const rowH = Math.min(46 * px, (bottom - top - (narrow ? 120 : 26) * px) / Math.max(rows, 1));
    const cell = Math.min((x1 - x0) / n, rowH * 0.62);
    stages.forEach((st, r) => {
      const y = top + 18 * px + r * rowH;
      let x = x0;
      const last = r === rows - 1;
      st.forEach((g) => {
        const gw = g.length * cell;
        roundRect(ctx, x + 1 * px, y, gw - 2 * px, cell, 4 * px);
        const lead = g[0] === 1;
        ctx.fillStyle = rgba(lead ? COL.major : COL.muted, lead ? 0.1 : 0.06);
        ctx.fill();
        ctx.strokeStyle = rgba(lead ? COL.major : COL.muted, lead ? 0.5 : 0.3);
        ctx.lineWidth = 1 * px;
        ctx.stroke();
        g.forEach((b, bi) => {
          const bx = x + (bi + 0.5) * cell;
          const by = y + cell / 2;
          ctx.beginPath();
          ctx.arc(bx, by, (b ? 0.24 : 0.1) * cell, 0, Math.PI * 2);
          ctx.fillStyle = b ? COL.major : rgba(COL.muted, 0.6);
          ctx.fill();
        });
        x += gw;
      });
      const groups = st.length;
      const kinds = new Set(st.map((g) => g.join(""))).size;
      const note = r === 0 ? `${k} hits, ${n - k} rests` : last ? (kinds <= 2 ? "done" : "") : `${groups} groups`;
      if (!narrow || r === 0 || last) text(ctx, note, x1, y - 6 * px, { color: COL.dim, align: "right", font: font(px, 9, 600) });
    });
    // the finished pattern, rotated, with the playhead
    const yF = top + 18 * px + rows * rowH + 4 * px;
    if (yF + cell < bottom + 6 * px) {
      text(ctx, rot ? `rotated by ${rot}` : "played", x0, yF + cell / 2, { color: COL.muted, font: font(px, 9, 600) });
      const fx0 = x0 + 66 * px;
      const fc = Math.min(cell, (x1 - fx0) / n);
      for (let s = 0; s < n; s++) {
        const bx = fx0 + (s + 0.5) * fc;
        const by = yF + cell / 2;
        if (s === nowStep) glow(ctx, bx, by, fc * 0.9, COL.white, 0.35);
        ctx.beginPath();
        ctx.arc(bx, by, (pattern[s] ? 0.26 : 0.1) * fc, 0, Math.PI * 2);
        ctx.fillStyle = pattern[s] ? COL.major : rgba(COL.muted, 0.6);
        ctx.fill();
        if (s % bt === 0) line(ctx, fx0 + s * fc, by - fc * 0.5, fx0 + s * fc, by + fc * 0.5, rgba(COL.muted, 0.35), 1 * px);
      }
    }

    // what the gaps say
    const yG = Math.min(bottom - 30 * px, yF + cell + 26 * px);
    if (k > 0 && yG > yF + cell) {
      const gaps = onsetGaps(pattern);
      const sizes = [...new Set(gaps)].sort((a, b) => a - b);
      text(ctx, gaps.join(" + "), x0, yG, { color: COL.major, font: font(px, narrow ? 15 : 17, 700, true) });
      const even = sizes.length === 1;
      const note = even
        ? "every gap the same: a metronome"
        : sizes.length === 2 && sizes[1] - sizes[0] === 1
          ? narrow ? `two gap sizes, ${sizes[0]} and ${sizes[1]}: as even as it gets` : `only two gap sizes, ${sizes[0]} and ${sizes[1]}, one apart: as even as ${n} steps allow`
          : "";
      if (note) text(ctx, note, x0, yG + 20 * px, { color: COL.muted, font: font(px, 10, 600) });
      if (isDiatonic(gaps)) text(ctx, "the same gaps as the major scale's steps (part 5)", x0, yG + 36 * px, { color: COL.calm, font: font(px, 10, 650) });
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
