// The hero: a landscape of spectra. Each ridge is the sound's spectrum at one
// moment, newest in front, on a log-frequency axis. The same axis is the
// instrument: touch at a frequency to play the scale note nearest it, so the
// fundamental's ridge rises under your finger and its harmonics run off to
// the right. Height on the screen opens the filter.
//
// Before anyone plays, a silent "ghost" performs a slow phrase and the ridges
// are computed from the patch itself (harmonics × the ladder's response ×
// the envelope), so the first screen is never empty.

import type { Demo } from "../../../lib/demoShell";
import { makeFigure, runFigure, drag, ramp, TEXT } from "./figure";
import { midiHz, hzMidi, logX, logF, ladderMag, noteName, fmtHz, clamp } from "./dsp";

const FLO = 55;
const FHI = 7040;
const ROWS = 40;
const POINTS = 240;
const ROW_RATE = 14; // ridges per second
const SCALE = [0, 3, 5, 7, 10]; // C minor pentatonic
const NOTE_LO = 36; // C2
const NOTE_HI = 84; // C6
const DB_FLOOR = -96;
const DB_RANGE = 74;
const DLN = Math.log(FHI / FLO) / (POINTS - 1); // ln-frequency step between points

function scaleNotes(): number[] {
  const out: number[] = [];
  for (let m = NOTE_LO; m <= NOTE_HI; m++) if (SCALE.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

export async function mountHero(container: HTMLElement): Promise<Demo> {
  const notes = scaleNotes();
  let cutoff = 1400;
  const fig = await makeFigure(container, {
    aspect: 0.62,
    patch: {
      mode: 0,
      poly: 6,
      glide: 0.05,
      o1: { wave: 2, lvl: 0.85, det: 3 },
      o2: { wave: 3, pw: 0.4, oct: -1, lvl: 0.45, det: -4 },
      flt: { on: 1, cut: cutoff, res: 1.5, poles: 4, env: 1.3, key: 0.25 },
      e1: { a: 0.015, d: 0.6, s: 0.75, r: 1.1 },
      e2: { a: 0.01, d: 0.7, s: 0.25, r: 0.8 },
      lfo: { wave: 0, rate: 4.8, pitch: 7 },
      velAmt: 0.3,
      gain: 0.85,
    },
    host: { fft: 8192, smoothing: 0.55, reverb: 0.3 },
    glow: { bloom: 0.2, vignette: 0.3 },
    base: 48,
    strip: false,
    grabby: true,
    playLabel: "Tap or drag anywhere to play",
    demo: () => phrase(),
  });
  const { glow: g, host, shell } = fig;

  // ---- geometry ----
  const geom = () => {
    const W = g.w;
    const H = g.h;
    const wide = W > 700;
    const mx = W * (wide ? 0.07 : 0.05);
    return {
      W,
      H,
      mx,
      yFront: H * (wide ? 0.63 : 0.8),
      yHor: H * (wide ? 0.25 : 0.24),
      amp: H * (wide ? 0.3 : 0.4),
      cx: W / 2,
    };
  };
  const xOf = (f: number): number => {
    const { W, mx } = geom();
    return mx + logX(f, FLO, FHI) * (W - 2 * mx);
  };
  const noteAtX = (x: number): number => {
    const { W, mx } = geom();
    const f = logF(clamp((x - mx) / (W - 2 * mx), 0, 1), FLO, FHI);
    const m = clamp(hzMidi(f), NOTE_LO, NOTE_HI);
    let best = notes[0];
    for (const n of notes) if (Math.abs(n - m) < Math.abs(best - m)) best = n;
    return best;
  };
  const cutAtY = (y: number): number => {
    const { H } = geom();
    return 180 * Math.pow(2, 5.6 * clamp(1 - y / H, 0, 1));
  };

  // ---- ridge history ----
  const rows: Float32Array[] = [];
  for (let i = 0; i < ROWS + 1; i++) rows.push(new Float32Array(POINTS));
  let head = 0; // index of the newest row
  let phase = 0; // fraction of a row interval since the newest row
  let last = performance.now();
  const freqs = new Float32Array(POINTS);
  for (let i = 0; i < POINTS; i++) freqs[i] = logF(i / (POINTS - 1), FLO, FHI);

  // ---- ghost performer ----
  let ghostOn = true;
  let lastUser = -1e9;
  let ghostT = 0;
  const ghostSeq: { note: number; start: number; dur: number }[] = [];
  let seqTime = 0;
  let walk = notes.indexOf(60);
  const extendGhost = (until: number): void => {
    while (seqTime < until) {
      walk = clamp(walk + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)], 2, notes.length - 6);
      const dur = [1.1, 1.4, 1.8, 0.7][Math.floor(Math.random() * 4)];
      ghostSeq.push({ note: notes[walk], start: seqTime, dur });
      seqTime += dur + 0.25;
    }
    while (ghostSeq.length > 8 && ghostSeq[0].start + ghostSeq[0].dur + 2 < ghostT) ghostSeq.shift();
  };
  const ghostCut = (t: number): number => 220 * Math.pow(2, 2.3 + 1.3 * Math.sin(t * 0.31) + 0.4 * Math.sin(t * 0.97));

  // synthetic spectrum of the patch: harmonics × ladder × envelopes
  const synthRow = (out: Float32Array, t: number): void => {
    out.fill(0);
    const p = host.patch;
    const cutBase = ghostCut(t);
    for (const n of ghostSeq) {
      const age = t - n.start;
      if (age < 0) continue;
      const rel = age - n.dur;
      let env = Math.min(1, age / Math.max(p.e1.a, 0.01));
      env *= p.e1.s + (1 - p.e1.s) * Math.exp(-age * 5);
      if (rel > 0) env *= Math.exp((-6.9 * rel) / p.e1.r);
      if (env < 1e-3) continue;
      const fenv = p.e2.s + (1 - p.e2.s) * Math.exp(-age * 4);
      const fc = clamp(cutBase * Math.pow(2, p.flt.env * fenv + p.flt.key * ((n.note - 60) / 12)), 30, 20000);
      const f0 = midiHz(n.note);
      const comps: [number, number][] = [];
      for (let k = 1; k * f0 < FHI * 1.1; k++) comps.push([k * f0, (p.o1.lvl * 0.64) / k]);
      for (let k = 1; k * f0 * 0.5 < FHI * 1.1; k++) comps.push([k * f0 * 0.5, (p.o2.lvl * 0.5 * Math.abs(Math.sin(Math.PI * k * 0.4))) / k]);
      for (const [f, a0] of comps) {
        const a = a0 * env * ladderMag(f, fc, p.flt.res, 4, 48000) * 0.25;
        const d = 20 * Math.log10(Math.max(a, 1e-9));
        const h = Math.pow(clamp((d - DB_FLOOR) / DB_RANGE, 0, 1), 1.6);
        if (h <= 0) continue;
        const width = Math.max(16 / f, DLN * 1.4); // bump width in ln(f), like an 8k FFT's main lobe
        const lf = Math.log(f);
        // only touch nearby points
        const xi = logX(f, FLO, FHI) * (POINTS - 1);
        const span = Math.ceil((width * 3 * (POINTS - 1)) / Math.log(FHI / FLO)) + 2;
        for (let i = Math.max(0, Math.floor(xi - span)); i <= Math.min(POINTS - 1, Math.ceil(xi + span)); i++) {
          const q = (Math.log(freqs[i]) - lf) / width;
          const v = h * Math.exp(-q * q);
          if (v > out[i]) out[i] = v;
        }
      }
    }
    // a faint, living noise floor
    for (let i = 0; i < POINTS; i++) out[i] = Math.max(out[i], 0.035 + 0.02 * Math.sin(i * 0.37 + t * 3.1) * Math.sin(i * 0.11 - t * 1.3));
  };

  // live spectrum from the analyser
  const fbuf = new Float32Array(4096);
  const liveRow = (out: Float32Array): void => {
    host.freqData(fbuf);
    const binHz = host.sampleRate / 8192;
    for (let i = 0; i < POINTS; i++) {
      const fa = freqs[Math.max(0, i - 1)];
      const fb = freqs[Math.min(POINTS - 1, i + 1)];
      const lo = Math.floor(Math.sqrt(fa * freqs[i]) / binHz);
      const hi = Math.max(lo, Math.ceil(Math.sqrt(fb * freqs[i]) / binHz));
      let m = -200;
      for (let k = lo; k <= hi && k < fbuf.length; k++) m = Math.max(m, fbuf[k]);
      out[i] = Math.pow(clamp((m - DB_FLOOR) / DB_RANGE, 0, 1), 1.6);
    }
  };

  // prefill so the landscape is already there on load
  extendGhost(8);
  for (let r = ROWS; r >= 0; r--) {
    head = (head + 1) % rows.length;
    ghostT = 2.4 - r / ROW_RATE + 3;
    synthRow(rows[head], ghostT);
  }
  ghostT = 5.4;

  // ---- playing ----
  const pointers = new Map<number, number>(); // pointerId → note
  let ptrNote = -1;
  let ptrX = -1;
  const userPlayed = (): void => {
    ghostOn = false;
    lastUser = performance.now();
  };
  const phrase = (): void => {
    userPlayed();
    const seq = [60, 63, 67, 70];
    seq.forEach((n, i) => window.setTimeout(() => fig.tap(n, 0.5, 0.75), i * 180));
  };
  drag(fig, {
    down(x, y, e) {
      userPlayed();
      const n = noteAtX(x);
      cutoff = cutAtY(y);
      host.set({ flt: { cut: cutoff } });
      const id = 1000 + e.pointerId;
      pointers.set(e.pointerId, n);
      host.noteOn(id, n, 0.8);
      fig.hidePlay();
      ptrNote = n;
      ptrX = x;
    },
    move(x, y, e, dragging) {
      if (!dragging) return;
      const n = noteAtX(x);
      cutoff = cutAtY(y);
      host.set({ flt: { cut: cutoff } });
      const prev = pointers.get(e.pointerId);
      if (prev !== n) {
        pointers.set(e.pointerId, n);
        host.pitch(1000 + e.pointerId, n);
      }
      ptrNote = n;
      ptrX = x;
      lastUser = performance.now();
    },
    up(e) {
      pointers.delete(e.pointerId);
      host.noteOff(1000 + e.pointerId);
      if (pointers.size === 0) ptrX = -1;
    },
  });
  const prevOn = fig.target.on;
  fig.target.on = (n, v) => {
    userPlayed();
    prevOn(n, v);
  };

  shell.setInfo(() => {
    const v = host.voices()[0];
    if (v && host.live) return `${noteName(v.note)} · ${fmtHz(midiHz(v.note))} · filter ${fmtHz(v.cut)}`;
    return "C minor pentatonic · across = pitch · up = brighter";
  });

  // ---- draw ----
  const pts = new Float32Array(POINTS * 2);
  const area = new Float32Array(POINTS * 2);
  const cols = new Float32Array(POINTS * 4);

  return runFigure(fig, () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const G = geom();
    const { W, H } = G;

    // the ghost comes back after a quiet spell
    const sounding = host.live && (host.tele?.voices.length ?? 0) > 0;
    if (!ghostOn && !sounding && now - lastUser > 9000) {
      ghostOn = true;
      ghostSeq.length = 0;
      seqTime = ghostT + 0.5;
    }
    ghostT += dt;
    if (ghostOn) extendGhost(ghostT + 6);

    phase += dt * ROW_RATE;
    while (phase >= 1) {
      phase -= 1;
      head = (head + 1) % rows.length;
      if (ghostOn) synthRow(rows[head], ghostT);
      else if (host.live) liveRow(rows[head]);
      else rows[head].fill(0.03);
    }

    // backdrop: a faint glow along the horizon
    g.blend("add");
    const hz = H * 0.16;
    g.rect(0, G.yHor - hz, W, hz, [0.05, 0.06, 0.16], 0.0, [0.05, 0.06, 0.16], 0.3);
    g.rect(0, G.yHor, W, hz * 1.6, [0.05, 0.06, 0.16], 0.3, [0.05, 0.06, 0.16], 0.0);
    g.blend("over");

    const zk = 0.075;
    const sMin = 1 / (1 + ROWS * zk);
    for (let r = ROWS; r >= 0; r--) {
      const d = r + phase;
      if (d > ROWS) continue;
      const s = 1 / (1 + d * zk);
      const u = (s - sMin) / (1 - sMin); // 1 front … 0 back
      const base = G.yHor + (G.yFront - G.yHor) * u;
      const conv = 0.6 + 0.4 * u;
      const a = G.amp * (0.28 + 0.72 * u);
      const row = rows[(head - r + rows.length * 2) % rows.length];
      const fade = clamp((ROWS - d) / 3, 0, 1) * (0.25 + 0.75 * Math.pow(u, 1.2));
      for (let i = 0; i < POINTS; i++) {
        const x0 = xOf(freqs[i]);
        const x = G.cx + (x0 - G.cx) * conv;
        const h = row[i];
        const y = base - h * a;
        pts[i * 2] = x;
        pts[i * 2 + 1] = y;
        area[i * 2] = x;
        area[i * 2 + 1] = y;
        const c = ramp(i / (POINTS - 1));
        const k = (0.18 + 1.6 * h * h + 0.5 * h) * fade;
        cols[i * 4] = c[0] * k;
        cols[i * 4 + 1] = c[1] * k;
        cols[i * 4 + 2] = c[2] * k;
        cols[i * 4 + 3] = 1;
      }
      // occlude the ridges behind, then draw this one
      g.area(area, base + 2, [0.006, 0.007, 0.014], 1, [0.006, 0.007, 0.014], 1);
      if (r <= 1) g.glowLine(pts, 1.8, [1, 1, 1], 1, 0.45, { colors: cols });
      else g.line(pts, 1.1 + u * 0.6, [1, 1, 1], 1, { colors: cols });
    }

    // the front baseline doubles as the instrument: scale notes as ticks
    const yb = G.yFront + 10;
    for (const n of notes) {
      const x = xOf(midiHz(n));
      const isC = n % 12 === 0;
      g.seg(x, yb, x, yb + (isC ? 9 : 5), 1, [0.35, 0.42, 0.7], isC ? 0.9 : 0.5);
      if (isC) g.text(noteName(n), x, yb + 21, { size: 10, align: "center", color: TEXT.dim, mono: true });
    }
    const xEnd = xOf(midiHz(NOTE_HI));
    g.text("harmonics →", Math.min(xEnd + 18, W - 70), yb + 21, { size: 10, color: "rgba(138,145,165,0.55)" });

    // where you're touching, and what's sounding
    const live = host.live ? host.voices() : [];
    for (const v of live) {
      const x = xOf(midiHz(v.note));
      const lvl = clamp(v.e1 * 1.2, 0, 1);
      g.blend("add");
      g.rect(x - 1, G.yHor, 2, G.yFront - G.yHor, [1, 0.6, 0.25], 0, [1, 0.6, 0.25], 0.25 * lvl);
      g.blend("over");
      g.dot(x, yb, 3.5, [1.6, 0.9, 0.4], lvl);
    }
    if (ghostOn) {
      // the ghost's current note, as a soft marker
      const cur = ghostSeq.find((n) => ghostT >= n.start && ghostT < n.start + n.dur);
      if (cur) {
        const x = xOf(midiHz(cur.note));
        g.dot(x, yb, 9, [0.5, 0.6, 1.2], 0.35, true);
        g.dot(x, yb, 2.5, [0.8, 0.85, 1.3], 0.8);
      }
    } else if (ptrX >= 0 && ptrNote >= 0) {
      g.dot(xOf(midiHz(ptrNote)), yb, 12, [1.2, 0.7, 0.3], 0.35, true);
    }
  });
}
