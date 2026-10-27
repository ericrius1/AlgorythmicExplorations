// The hero: a key compass. Outer ring, the twelve major keys around the circle
// of fifths; inner ring, their relative minors; each glows with how well it
// matches what the ear has heard. In the middle, the ear's memory of the
// twelve pitch classes, and the band's current chord drawn as a triangle.
// A stand-in player wanders around the circle of fifths until you take over:
// tap a pitch class to play it, tap a key to play its tonic chord, or type.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { Accompanist } from "./band";
import { pageNow } from "./clock";
import { C, font, rgba, ui } from "./draw";
import { Ghost } from "./ghost";
import { BandVoices } from "./instruments";
import { registerSink } from "./input";
import { FIFTHS, type Key, keyIndex, keyName, keyShort, pcOf, spell, triadPcs } from "./theory";
import { playGate, stage } from "./ui";

interface Spark {
  pc: number;
  born: number;
  col: readonly number[];
}

const MAJOR_NAMES = (k: number): string => keyShort({ root: k, minor: false });
const MINOR_NAMES = (k: number): string => keyShort({ root: k, minor: true });

export function mountAccompHero(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const g = shell.canvas.getContext("2d")!;
  const wrap = stage(shell);
  const band = new Accompanist(92);
  const ghost = new Ghost(band);
  band.onStepHook = (s, t) => ghost.onStep(s, t);
  band.onUserNote = () => ghost.yieldToPlayer(pageNow());
  band.leadLevel = 0.85;
  band.clock.start(); // silently: the picture runs before the sound does

  let voices: BandVoices | null = null;
  let soundOn = false;
  const sparks: Spark[] = [];
  const sparked = new WeakSet<object>();

  const turnOn = (): void => {
    if (!voices) voices = new BandVoices();
    voices.fader.gain.value = 0;
    voices.fadeTo(1, 0.4);
    band.attachVoices(voices);
    soundOn = true;
  };
  const gate = playGate(wrap, "Tap to play", "a stand-in plays until you join in", turnOn);

  const guard = frameGuard(() => {
    if (!soundOn) return;
    soundOn = false;
    voices?.fadeTo(0, 0.2);
    band.voices = null;
    voices?.hush();
    gate.show("Tap to resume");
  });

  // ---- geometry -------------------------------------------------------------
  const geom = (): { cx: number; cy: number; R: number } => {
    const W = shell.canvas.width;
    const H = shell.canvas.height;
    const s = ui(shell.canvas);
    const overlay = window.matchMedia("(min-width: 46rem)").matches;
    // keep clear of the fixed nav on top, and of the overlaid title below
    const top = 58 * s;
    const bottom = overlay ? H - 205 * s : H - 10 * s;
    const R = Math.max(60 * s, Math.min((bottom - top) / 2, W * (overlay ? 0.3 : 0.46)));
    return { cx: W * 0.5, cy: (top + bottom) / 2, R };
  };
  const angleOfPc = (pc: number): number => -Math.PI / 2 + FIFTHS.indexOf(pc) * (Math.PI / 6);

  // ---- input ------------------------------------------------------------------
  const ensureSound = (): void => {
    if (!soundOn) gate.el.click();
  };
  const pointerNotes = new Map<number, number[]>();
  shell.canvas.addEventListener("pointerdown", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const sx = shell.canvas.width / r.width;
    const x = (e.clientX - r.left) * sx;
    const y = (e.clientY - r.top) * sx;
    const { cx, cy, R } = geom();
    const dx = x - cx;
    const dy = y - cy;
    const rr = Math.hypot(dx, dy) / R;
    ensureSound();
    if (rr > 1.08) return;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const slot = Math.round(a / (Math.PI / 6)) % 12;
    const pc = FIFTHS[slot];
    let notes: number[];
    if (rr > 0.84) notes = triadPcs({ root: pc, q: "maj" }).map((p) => 60 + ((p - 0 + 12) % 12));
    else if (rr > 0.66) notes = triadPcs({ root: (pc + 9) % 12, q: "min" }).map((p) => 57 + ((p - 9 + 12) % 12));
    else notes = [60 + pc];
    e.preventDefault();
    shell.canvas.setPointerCapture(e.pointerId);
    pointerNotes.set(e.pointerId, notes);
    for (const m of notes) band.noteOn(m, 0.7);
  });
  const release = (e: PointerEvent): void => {
    const notes = pointerNotes.get(e.pointerId);
    if (!notes) return;
    pointerNotes.delete(e.pointerId);
    for (const m of notes) band.noteOff(m);
  };
  shell.canvas.addEventListener("pointerup", release);
  shell.canvas.addEventListener("pointercancel", release);

  registerSink({
    el: container,
    armed: () => soundOn,
    noteOn: (m, v) => band.noteOn(m, v),
    noteOff: (m) => band.noteOff(m),
  });

  shell.setInfo(() => {
    const k = band.ear.key;
    const who = ghost.active ? "stand-in playing" : "you're playing";
    if (!k) return `${who} · listening…`;
    return `${who} · hearing ${keyName(k)} · chord ${band.chordLabel() || "—"} · band: ${band.resolved}`;
  });

  // smooth display values
  const shown = new Float32Array(24);
  const histShown = new Float32Array(12);
  const tri = [0, 0, 0].map(() => ({ a: 0, on: 0 }));
  let triInit = false;
  let last = pageNow();

  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = pageNow();
      const dt = Math.min(0.1, now - last);
      last = now;
      if (!band.clock.isRunning && ghost.enabled) band.clock.start();
      band.update();

      // sparks for new notes
      for (const p of band.player) {
        if (sparked.has(p) || p.t0 > now) continue;
        sparked.add(p);
        sparks.push({ pc: pcOf(p.midi), born: now, col: p.ghost ? C.ghost : C.you });
      }
      for (const n of band.band) {
        if (sparked.has(n) || n.t > now || n.cancelled) continue;
        sparked.add(n);
        if (n.kind === "answer") sparks.push({ pc: pcOf(n.midi), born: now, col: C.answer });
        else if (n.kind === "bass") sparks.push({ pc: pcOf(n.midi), born: now, col: C.bass });
      }
      while (sparks.length && now - sparks[0].born > 1.6) sparks.shift();

      const W = shell.canvas.width;
      const H = shell.canvas.height;
      const s = ui(shell.canvas);
      const { cx, cy, R } = geom();

      // background: a dark field with a faint glow tinted by the key
      const k: Key | null = band.ear.key;
      g.globalCompositeOperation = "source-over";
      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);
      const bg = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, Math.max(W, H) * 0.7);
      bg.addColorStop(0, "rgba(40,48,90,0.55)");
      bg.addColorStop(0.45, "rgba(18,20,38,0.35)");
      bg.addColorStop(1, "rgba(9,10,16,0)");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);

      // ---- key rings ----
      const ease = 1 - Math.pow(0.02, dt);
      for (let i = 0; i < 24; i++) shown[i] += (band.ear.scores[i] - shown[i]) * ease;
      const cur = band.ear.keyIdx;
      const ch = band.ear.challengeProgress();
      const gap = 0.022;
      const ring = (minor: boolean, r0: number, r1: number): void => {
        for (let slot = 0; slot < 12; slot++) {
          const majorRoot = FIFTHS[slot];
          const root = minor ? (majorRoot + 9) % 12 : majorRoot;
          const idx = keyIndex({ root, minor });
          const a0 = -Math.PI / 2 + (slot - 0.5) * (Math.PI / 6) + gap;
          const a1 = a0 + Math.PI / 6 - 2 * gap;
          const v = Math.max(0, Math.min(1, (shown[idx] - 0.15) / 0.75));
          const b = Math.pow(v, 1.6);
          const isCur = idx === cur;
          g.beginPath();
          g.arc(cx, cy, r1 * R, a0, a1);
          g.arc(cx, cy, r0 * R, a1, a0, true);
          g.closePath();
          const base = isCur ? C.comp : C.accent;
          g.fillStyle = rgba(base, 0.05 + b * (isCur ? 0.55 : 0.42));
          if (isCur || b > 0.5) {
            g.shadowColor = rgba(base, 0.8);
            g.shadowBlur = (isCur ? 26 : 12 * b) * s;
          }
          g.fill();
          g.shadowBlur = 0;
          g.strokeStyle = rgba(base, isCur ? 0.9 : 0.12 + b * 0.35);
          g.lineWidth = (isCur ? 1.6 : 1) * s;
          g.stroke();
          if (idx === ch.idx && ch.t > 0) {
            g.beginPath();
            g.arc(cx, cy, (r1 + 0.02) * R, a0, a0 + (a1 - a0) * ch.t);
            g.strokeStyle = rgba(C.answer, 0.85);
            g.lineWidth = 2.2 * s;
            g.stroke();
          }
          // label
          const am = (a0 + a1) / 2;
          const lr = ((r0 + r1) / 2) * R;
          g.fillStyle = isCur ? "#fff4e6" : `rgba(220,228,250,${0.38 + b * 0.6})`;
          g.font = font(Math.max(10 * s, R * (minor ? 0.055 : 0.07)), isCur ? 750 : 600);
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(minor ? MINOR_NAMES(root) : MAJOR_NAMES(root), cx + Math.cos(am) * lr, cy + Math.sin(am) * lr);
        }
      };
      ring(false, 0.85, 1.0);
      ring(true, 0.68, 0.83);

      // ---- the ear's memory: one spoke per pitch class ----
      let maxH = 0.6;
      for (let i = 0; i < 12; i++) maxH = Math.max(maxH, band.ear.hist[i]);
      for (let i = 0; i < 12; i++) histShown[i] += (band.ear.hist[i] / maxH - histShown[i]) * Math.min(1, dt * 8);
      const held = new Set(band.heldPcs());
      g.globalCompositeOperation = "lighter";
      for (let pc = 0; pc < 12; pc++) {
        const a = angleOfPc(pc);
        const len = 0.1 + histShown[pc] * 0.44;
        const x1 = cx + Math.cos(a) * 0.1 * R;
        const y1 = cy + Math.sin(a) * 0.1 * R;
        const x2 = cx + Math.cos(a) * len * R;
        const y2 = cy + Math.sin(a) * len * R;
        const lit = held.has(pc);
        const grad = g.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, rgba(C.accent, 0.05));
        grad.addColorStop(1, rgba(lit ? C.you : C.accent, lit ? 0.95 : 0.25 + histShown[pc] * 0.6));
        g.strokeStyle = grad;
        g.lineCap = "round";
        g.lineWidth = (lit ? 7 : 5) * s;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        // pitch-class label
        g.globalCompositeOperation = "source-over";
        g.fillStyle = lit ? "#ffffff" : `rgba(190,200,235,${0.35 + histShown[pc] * 0.5})`;
        g.font = font(Math.max(9 * s, R * 0.045), 600);
        g.fillText(spell(pc, k), cx + Math.cos(a) * 0.6 * R, cy + Math.sin(a) * 0.6 * R);
        g.globalCompositeOperation = "lighter";
      }

      // ---- sparks: notes flying in along their spoke ----
      for (const sp of sparks) {
        const age = (now - sp.born) / 1.6;
        const a = angleOfPc(sp.pc);
        const rr = (0.64 - age * 0.5) * R;
        const alpha = Math.pow(1 - age, 1.5);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        const glow = g.createRadialGradient(x, y, 0, x, y, 14 * s);
        glow.addColorStop(0, rgba(sp.col, 0.9 * alpha));
        glow.addColorStop(1, rgba(sp.col, 0));
        g.fillStyle = glow;
        g.fillRect(x - 14 * s, y - 14 * s, 28 * s, 28 * s);
      }

      // ---- the band's chord, as a triangle on the circle of fifths ----
      if (band.chord && k) {
        const pcs = triadPcs(band.chord);
        if (!triInit) {
          pcs.forEach((pc, i) => (tri[i].a = angleOfPc(pc)));
          triInit = true;
        }
        pcs.forEach((pc, i) => {
          let target = angleOfPc(pc);
          let d = target - tri[i].a;
          d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          target = tri[i].a + d;
          tri[i].a += (target - tri[i].a) * Math.min(1, dt * 10);
          tri[i].on += (1 - tri[i].on) * Math.min(1, dt * 4);
        });
        g.beginPath();
        tri.forEach((v, i) => {
          const x = cx + Math.cos(v.a) * 0.5 * R;
          const y = cy + Math.sin(v.a) * 0.5 * R;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.closePath();
        g.fillStyle = rgba(C.comp, 0.08);
        g.fill();
        g.shadowColor = rgba(C.comp, 0.9);
        g.shadowBlur = 14 * s;
        g.strokeStyle = rgba(C.comp, 0.75);
        g.lineWidth = 2 * s;
        g.stroke();
        g.shadowBlur = 0;
        for (const v of tri) {
          const x = cx + Math.cos(v.a) * 0.5 * R;
          const y = cy + Math.sin(v.a) * 0.5 * R;
          g.fillStyle = rgba(C.comp, 0.9);
          g.beginPath();
          g.arc(x, y, 3.5 * s, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalCompositeOperation = "source-over";

      // ---- center readout ----
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(9,10,16,0.55)";
      g.beginPath();
      g.arc(cx, cy, 0.2 * R, 0, Math.PI * 2);
      g.fill();
      if (k) {
        g.fillStyle = "#f4f6ff";
        g.font = font(Math.max(13 * s, R * 0.085), 750);
        g.fillText(keyName(k), cx, cy - R * 0.045);
        g.fillStyle = "rgba(255,200,140,0.9)";
        g.font = font(Math.max(10 * s, R * 0.05), 600, true);
        const lab = band.chord ? band.chordLabel() : `r = ${band.ear.conf().toFixed(2)}`;
        g.fillText(lab, cx, cy + R * 0.06);
      } else {
        g.fillStyle = "rgba(200,210,240,0.7)";
        g.font = font(Math.max(11 * s, R * 0.06), 600);
        g.fillText("listening…", cx, cy);
      }
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
    },
    dispose() {
      band.stop();
      voices?.dispose();
    },
  };
}
