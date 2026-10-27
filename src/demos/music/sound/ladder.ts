// Fig. 3 of "The Anatomy of a Note": the harmonics of one A2, laid on a
// keyboard. Every rung is a sine at n × 110 Hz; together they make one note.
// Tap a rung and that harmonic swells for a moment: once you've heard it
// alone, you can keep hearing it inside the tone (Helmholtz did this with
// glass resonators held to his ear). "Climb" walks up the ladder, which is
// roughly what an overtone singer does with their mouth.

import type { Demo } from "../../../lib/demoShell";
import { Partials, unlockAudio, now, nearestNote, noteLabel, NOTE, guardSound } from "./core";
import { Stage, PlayPill, playButton, glowStroke, glowDot, harmonicRgb, rgba, mix, text, vline, WHITE, roundRect } from "./draw";

const F0 = 110;
const N = 16;
const BASE = 0.065; // gain of harmonic 1
const tilt = (n: number): number => Math.pow(n, -0.85);

export async function mountLadder(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.56, narrowAspect: 1.0 });
  const { shell, canvas } = stage;

  const bank = new Partials(N, { level: 1 });
  const freqs = Array.from({ length: N }, (_, i) => (i + 1) * F0);
  const gains = new Float64Array(N);
  const boost = new Float64Array(N + 1); // 0..1 spotlight per harmonic (drawn)
  const until = new Float64Array(N + 1); // when each spotlight ends (perf time)
  const base = (): void => {
    for (let i = 0; i < N; i++) gains[i] = BASE * tilt(i + 1);
    bank.set(freqs, gains, 0.02);
  };
  base();
  let playing = false;
  let focus = 0; // last spotlighted harmonic

  const setPlaying = (on: boolean): void => {
    playing = on;
    if (on) bank.start(0.25);
    else bank.stop(0.3);
    sync(on);
    pill.show(!on);
    if (!on) climbAt = -1;
  };

  // one harmonic up by ~9 dB for a moment, then back into the blend
  const spotlight = (n: number, hold = 1.1): void => {
    focus = n;
    until[n] = performance.now() / 1000 + hold;
    if (!playing) return;
    const t = now();
    const g = BASE * tilt(n);
    const p = bank.gainParam(n - 1);
    if (!p) return;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(Math.min(0.12, g * 2.8), t, 0.03);
    p.setTargetAtTime(g, t + hold, 0.2);
  };

  const pill = new PlayPill(stage, "Tap to play the note", () => {
    void unlockAudio().then(() => setPlaying(true));
  }, "top");
  const sync = playButton(stage, ["▶ play A2", "■ stop"], () => {
    void unlockAudio().then(() => setPlaying(!playing));
  });
  let climbAt = -1; // perf time the climb started
  shell.button("climb the ladder", () => {
    void unlockAudio().then(() => {
      if (!playing) setPlaying(true);
      climbAt = performance.now() / 1000 + 0.4;
      climbStep = 0;
    });
  });
  let climbStep = 0;

  const guard = guardSound(container, () => setPlaying(false));

  // ---- geometry ---------------------------------------------------------------
  const lo = Math.log2(F0) - 0.12;
  const hi = Math.log2(F0 * N) + 0.12;
  let x0 = 0;
  let x1 = 0;
  const fx = (f: number): number => x0 + ((Math.log2(f) - lo) / (hi - lo)) * (x1 - x0);

  canvas.addEventListener("pointerdown", (e) => {
    const [x] = stage.local(e);
    let best = 0;
    let bd = Infinity;
    for (let n = 1; n <= N; n++) {
      const d = Math.abs(fx(n * F0) - x);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (best && bd < 40) {
      void unlockAudio().then(() => {
        if (!playing) setPlaying(true);
        climbAt = -1;
        window.setTimeout(() => spotlight(best), playing ? 0 : 250);
      });
    }
  });

  shell.setInfo(() => {
    const n = focus || 1;
    const f = n * F0;
    const nn = nearestNote(f);
    const key = 440 * Math.pow(2, (nn.midi - 69) / 12);
    const ratioName = n === 1 ? "the fundamental" : `${n} × 110`;
    return `harmonic ${n} · ${f} Hz = ${ratioName} · ${noteLabel(f)}${nn.cents ? ` (the piano's ${nn.name} is ${key.toFixed(0)} Hz)` : ""}`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      const tNow = performance.now() / 1000;
      if (climbAt > 0 && playing) {
        const step = Math.floor((tNow - climbAt) / 0.6);
        if (step >= climbStep && step < N) {
          spotlight(step + 1, 0.55);
          climbStep = step + 1;
        }
        if (step >= N) climbAt = -1;
      }
      for (let n = 1; n <= N; n++) {
        const target = tNow < until[n] && playing ? 1 : 0;
        boost[n] += (target - boost[n]) * (target ? 0.25 : 0.06);
      }

      const g = stage.begin();
      const W = stage.w;
      const H = stage.h;
      const narrow = stage.narrow;
      x0 = 18;
      x1 = W - 18;
      const ky0 = H - 52;
      const ky1 = H - 18;
      const top = 54;

      // octave guides on the A's
      for (let o = 0; o <= 4; o++) {
        const f = F0 * Math.pow(2, o);
        const x = fx(f);
        vline(g, x, top - 20, ky0, "rgba(122,162,255,0.07)", 1, [2, 5]);
      }

      // the keyboard, one slot per semitone so it lines up with the pitch axis
      const m0 = Math.ceil(12 * (lo - Math.log2(440)) + 69 - 0.5);
      const m1 = Math.floor(12 * (hi - Math.log2(440)) + 69 + 0.5);
      const slot = (x1 - x0) / ((hi - lo) * 12);
      const lit = new Map<number, number>(); // midi → harmonic lighting it
      for (let n = 1; n <= N; n++) lit.set(nearestNote(n * F0).midi, n);
      for (let m = m0; m <= m1; m++) {
        const f = 440 * Math.pow(2, (m - 69) / 12);
        const cx = fx(f);
        const black = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
        const hn = lit.get(m);
        const glowK = hn ? 0.25 + 0.75 * boost[hn] : 0;
        g.save();
        const base = black ? [28, 31, 44] : [196, 201, 216];
        const col = hn ? mix(base as [number, number, number], harmonicRgb(hn), black ? 0.55 : 0.35 + 0.4 * boost[hn]) : base;
        g.fillStyle = rgba(col as [number, number, number], black ? 0.95 : 0.16 + 0.5 * glowK);
        roundRect(g, cx - slot / 2 + 0.5, black ? ky0 : ky0, slot - 1, black ? (ky1 - ky0) * 0.62 : ky1 - ky0, 2);
        g.fill();
        g.restore();
        if (((m % 12) + 12) % 12 === 0 && !narrow) {
          text(g, `C${Math.floor(m / 12) - 1}`, cx, ky1 + 12, { size: 9, align: "center", color: "rgba(150,160,190,0.55)", mono: true });
        }
      }
      for (let o = 0; o <= 4; o++) {
        const x = fx(F0 * Math.pow(2, o));
        text(g, `A${2 + o}`, x, ky1 + 12, { size: 9, align: "center", color: "rgba(255,214,140,0.7)", mono: true, weight: 600 });
      }

      // the rungs
      const room = ky0 - top - 34;
      for (let n = 1; n <= N; n++) {
        const f = n * F0;
        const x = fx(f);
        const c = harmonicRgb(n);
        const db = 20 * Math.log10(tilt(n)) + boost[n] * 9;
        const hgt = Math.max(0.12, (db + 30) / 41) * room;
        const yTop = ky0 - 6 - hgt;
        const p = new Path2D();
        p.moveTo(x, ky0 - 4);
        p.lineTo(x, yTop);
        const k = playing ? 0.75 + 0.25 * boost[n] : 0.45;
        glowStroke(g, p, c, 1.4 + boost[n] * 1.6, k);
        glowDot(g, x, yTop, 2.4 + boost[n] * 2.5, c, 0.6 + 0.4 * boost[n]);

        // labels: number always; note name where there's room
        const sp = n < N ? fx((n + 1) * F0) - x : 99;
        const lc = mix(harmonicRgb(n, 0.78), WHITE, 0.2 + 0.4 * boost[n]);
        text(g, String(n), x, yTop - 9, { size: narrow ? 10 : 11.5, align: "center", color: rgba(lc, 0.95), weight: 700, mono: true });
        const nn = nearestNote(f);
        const showName = sp > (narrow ? 34 : 44) || boost[n] > 0.3;
        if (showName) {
          const nm = `${NOTE[((nn.midi % 12) + 12) % 12]}${Math.floor(nn.midi / 12) - 1}`;
          text(g, nm, x, yTop - 23, { size: narrow ? 9 : 10, align: "center", color: rgba(lc, 0.75) });
          if (nn.cents !== 0 && sp > (narrow ? 34 : 50)) {
            text(g, `${nn.cents > 0 ? "+" : "−"}${Math.abs(nn.cents)}¢`, x, yTop - 35, {
              size: narrow ? 8.5 : 9.5,
              align: "center",
              color: rgba(lc, Math.abs(nn.cents) > 20 ? 0.9 : 0.55),
              mono: true,
            });
          }
        }
      }

    },
    dispose() {
      setPlaying(false);
    },
  };
}
