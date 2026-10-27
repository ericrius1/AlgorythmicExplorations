// Fig. 6 of "The Anatomy of a Note": the missing fundamental. A melody whose
// notes are each twelve harmonics. Raise the slider and the lowest harmonics
// disappear, the fundamental first; the level stays the same (constant RMS).
// The melody keeps its pitch: the ear reads the spacing of what's left.
// The picture is a scrolling score made of harmonics: every note is a stack
// of bars at n × f0, and the dashed line marks the pitch you hear.

import type { Demo } from "../../../lib/demoShell";
import { Partials, ctx, now, unlockAudio, NOTE, guardSound } from "./core";
import { Stage, PlayPill, playButton, harmonicRgb, rgba, mix, text, hline, vline, WHITE, ORANGE } from "./draw";

const H = 12;
const BEAT = 0.5; // seconds per quarter note
// Beethoven, "Ode to Joy" (the opening phrase), in C: [midi, beats]
const TUNE: [number, number][] = [
  [52, 1], [52, 1], [53, 1], [55, 1],
  [55, 1], [53, 1], [52, 1], [50, 1],
  [48, 1], [48, 1], [50, 1], [52, 1],
  [52, 1.5], [50, 0.5], [50, 2],
];
const REST = 1; // beats of silence before it repeats
const RMS = 0.07;

const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export async function mountMissing(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.56, narrowAspect: 1.0 });
  const { shell } = stage;

  let lowest = 1;
  let playing = false;
  const bank = new Partials(H, { level: 0 });
  const amps = (): number[] => {
    const a: number[] = [];
    let ss = 0;
    for (let n = 1; n <= H; n++) {
      const v = n >= lowest ? Math.pow(n, -0.7) : 0;
      a.push(v);
      ss += v * v;
    }
    const k = RMS / Math.sqrt(ss / 2);
    return a.map((v) => v * k);
  };

  // ---- the tune, scheduled a little ahead on the audio clock ------------------------
  const starts: number[] = [];
  let acc = 0;
  for (const [, b] of TUNE) {
    starts.push(acc);
    acc += b;
  }
  const LOOP = (acc + REST) * BEAT;
  let t0 = 0; // audio time the current run started
  let nextIdx = 0;
  let nextLoop = 0;
  let pump = 0;
  const schedule = (): void => {
    const horizon = ctx().currentTime + 0.35;
    for (;;) {
      const at = t0 + nextLoop * LOOP + starts[nextIdx] * BEAT;
      if (at > horizon) break;
      const [m, b] = TUNE[nextIdx];
      const f = hz(m);
      bank.setAt(
        at,
        Array.from({ length: H }, (_, i) => (i + 1) * f),
        amps(),
      );
      bank.envAt(at, 1, 0.02, b * BEAT - 0.07, 0.06);
      nextIdx++;
      if (nextIdx >= TUNE.length) {
        nextIdx = 0;
        nextLoop++;
      }
    }
  };
  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    if (on) {
      const f = hz(TUNE[0][0]);
      bank.set(Array.from({ length: H }, (_, i) => (i + 1) * f), amps(), 0);
      bank.start(0.01);
      t0 = now() + 0.12;
      nextIdx = 0;
      nextLoop = 0;
      schedule();
      pump = window.setInterval(schedule, 60);
    } else {
      window.clearInterval(pump);
      bank.stop(0.08);
    }
    sync(on);
    pill.show(!on);
  };
  const toggle = (): void => {
    void unlockAudio().then(() => setPlaying(!playing));
  };
  const pill = new PlayPill(stage, "Tap to play the tune", toggle);
  const sync = playButton(stage, ["▶ play", "■ stop"], toggle);
  shell.slider({
    label: "lowest harmonic kept",
    min: 1,
    max: 7,
    step: 1,
    value: lowest,
    format: (v) => (v === 1 ? "1 (all of them)" : `${v} (1–${v - 1} removed)`),
    onInput: (v) => {
      lowest = v;
      if (playing) bank.set(null, amps(), 0.05);
    },
  });

  const guard = guardSound(container, () => setPlaying(false));

  shell.setInfo(() => {
    const lo = hz(48) * lowest;
    return lowest === 1
      ? "all twelve harmonics · the lowest sound in the tune is C3, 131 Hz"
      : `harmonics ${lowest}–12 only · nothing below ${Math.round(lo)} Hz is playing · the tune still bottoms out at C3, 131 Hz`;
  });

  // ---- drawing ------------------------------------------------------------------------
  const FLO = 110;
  const FHI = 2600;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const g = stage.begin();
      const W = stage.w;
      const Hh = stage.h;
      const narrow = stage.narrow;
      const x0 = narrow ? 34 : 44;
      const x1 = W - 12;
      const y0 = 30;
      const y1 = Hh - 26;
      const fy = (f: number): number => y1 - ((Math.log2(f) - Math.log2(FLO)) / (Math.log2(FHI) - Math.log2(FLO))) * (y1 - y0);

      // time: playhead at 22% of the width, 9 beats visible ahead
      const pos = playing ? Math.max(0, ctx().currentTime - t0) % LOOP : 0;
      const pxPerSec = (x1 - x0) / (narrow ? 4.2 : 6.5);
      const head = x0 + (x1 - x0) * 0.2;
      const tx = (sec: number): number => head + (sec - pos) * pxPerSec;

      // pitch guides on the C's
      for (const m of [48, 60, 72, 84, 96]) {
        const y = fy(hz(m));
        if (y < y0 || y > y1) continue;
        hline(g, x0, x1, y, "rgba(122,162,255,0.07)", 1, [2, 5]);
        text(g, `C${m / 12 - 1}`, x0 - 6, y + 3, { size: 9.5, align: "right", color: "rgba(150,160,190,0.6)", mono: true });
      }

      // notes, two loops' worth so the wrap is seamless
      for (let loop = -1; loop <= 1; loop++) {
        TUNE.forEach(([m, b], i) => {
          const s = loop * LOOP + starts[i] * BEAT;
          const xa = tx(s) + 1.5;
          const xb = tx(s + b * BEAT) - 1.5;
          if (xb < x0 || xa > x1) return;
          const ca = Math.max(x0, xa);
          const cb = Math.min(x1, xb);
          const f = hz(m);
          const now2 = playing && pos >= s && pos < s + b * BEAT;
          for (let n = 1; n <= H; n++) {
            const y = fy(n * f);
            if (y < y0 - 2) break;
            const c = harmonicRgb(n);
            if (n >= lowest) {
              const k = (now2 ? 1 : 0.55) * Math.pow(n, -0.35);
              g.save();
              g.globalCompositeOperation = "lighter";
              g.fillStyle = rgba(c, 0.18 * k);
              g.fillRect(ca, y - 3.5, cb - ca, 7);
              g.fillStyle = rgba(mix(c, WHITE, now2 ? 0.45 : 0.15), 0.9 * k);
              g.fillRect(ca, y - 1, cb - ca, 2);
              g.restore();
            } else {
              g.save();
              g.strokeStyle = rgba(c, 0.32);
              g.setLineDash([2, 3]);
              g.strokeRect(ca, y - 2.5, cb - ca, 5);
              g.restore();
            }
          }
          // the pitch you hear
          const yf = fy(f);
          if (lowest > 1) {
            g.save();
            g.strokeStyle = rgba(ORANGE, now2 ? 0.95 : 0.55);
            g.lineWidth = 1.6;
            g.setLineDash([5, 4]);
            g.beginPath();
            g.moveTo(ca, yf);
            g.lineTo(cb, yf);
            g.stroke();
            g.restore();
          }
          if (xa > x0 && xb - xa > 18) {
            text(g, `${NOTE[m % 12]}${Math.floor(m / 12) - 1}`, xa + 2, yf + 14, { size: 9.5, color: rgba(ORANGE, now2 ? 1 : 0.6), weight: 600, mono: true });
          }
        });
      }

      // playhead
      vline(g, head, y0 - 8, y1, playing ? "rgba(255,236,200,0.5)" : "rgba(255,236,200,0.2)", 1);
      text(g, "now", head, y0 - 12, { size: 9.5, align: "center", color: "rgba(255,236,200,0.6)" });
      text(g, lowest > 1 ? "dashed: the pitch you hear, where no sound is" : "each note is a stack of harmonics at n × f", x1, y0 - 12, {
        size: 10,
        align: "right",
        color: lowest > 1 ? rgba(ORANGE, 0.85) : "rgba(180,188,210,0.75)",
      });
      text(g, "Hz", x0 - 6, y1 + 14, { size: 9, align: "right", color: "rgba(150,160,190,0.4)", mono: true });
    },
    dispose() {
      setPlaying(false);
    },
  };
}
