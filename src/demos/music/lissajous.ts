// Fig. 2 of "Consonance and Roughness": an interval as a repeating pattern.
// Left: tone A drives the dot sideways, tone B up and down (a Lissajous
// figure), drawn from the real signals over the last few milliseconds. At an
// exact ratio p:q the path closes and stands still; a hair off, it turns, at
// exactly the rate the pattern slips (|q·f2 − p·f1| times a second). Right:
// the same two waves on a time line, with the stretch after which their sum
// repeats.

import type { Demo } from "../../lib/demoShell";
import { ctx, dest, now, unlockAudio, simpleRatio, justNear, etNear, guardSound } from "./sound/core";
import { Stage, PlayPill, playButton, glowStroke, glowDot, rgba, mix, text, hline, roundRect, BLUE, ORANGE } from "./sound/draw";

const F1 = 220;
const SNAPS: [number, number][] = [
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 3],
  [5, 4],
  [6, 5],
  [5, 3],
  [45, 32],
];

export async function mountLissajous(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.56, narrowAspect: 1.3 });
  const { shell } = stage;

  let ratio = 3 / 2;
  let playing = false;

  // ---- sound -------------------------------------------------------------------
  const c = ctx();
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(dest());
  let oa: OscillatorNode | null = null;
  let ob: OscillatorNode | null = null;
  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    const t = now();
    if (on) {
      oa = c.createOscillator();
      ob = c.createOscillator();
      oa.frequency.value = F1;
      ob.frequency.value = F1 * ratio;
      oa.connect(gain);
      ob.connect(gain);
      oa.start(t);
      ob.start(t);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.1, t, 0.04);
    } else {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, 0.04);
      const a = oa;
      const b = ob;
      oa = ob = null;
      window.setTimeout(() => {
        a?.stop();
        b?.stop();
        a?.disconnect();
        b?.disconnect();
      }, 300);
    }
    sync(on);
    pill.show(!on);
  };
  const toggle = (): void => {
    void unlockAudio().then(() => setPlaying(!playing));
  };
  const pill = new PlayPill(stage, "Tap to play the interval", toggle, stage.narrow ? [0.5, 0.2] : [0.25, 0.5]);
  const sync = playButton(stage, ["▶ play", "■ stop"], toggle);
  const setRatio = (r: number): void => {
    ratio = r;
    ob?.frequency.setTargetAtTime(F1 * r, now(), 0.01);
  };
  const slider = shell.slider({
    label: "frequency ratio",
    min: 1,
    max: 2.05,
    step: 0.0005,
    value: ratio,
    format: (v) => v.toFixed(4),
    onInput: (v) => setRatio(v),
  });
  const row = document.createElement("div");
  row.className = "ms-choice";
  for (const [p, q] of SNAPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "demo-button";
    b.textContent = `${p}:${q}`;
    b.addEventListener("click", () => {
      slider.value = String(p / q);
      slider.dispatchEvent(new Event("input"));
      setRatio(p / q);
    });
    row.appendChild(b);
  }
  shell.controls.appendChild(row);

  const guard = guardSound(container, () => setPlaying(false));

  // what the pattern does at this ratio
  const describe = (): { exact: { p: number; q: number } | null; text: string } => {
    const f2 = F1 * ratio;
    const exact = simpleRatio(ratio, 32, 0.05);
    if (exact) {
      const rep = F1 / exact.q;
      const name = justNear(ratio, 1)?.name ?? etNear(ratio).name;
      const below = Math.log2(F1 / rep);
      const where =
        exact.q === 1
          ? "the same as the lower tone"
          : Number.isInteger(below)
            ? `${below === 1 ? "an octave" : `${below} octaves`} below the lower tone`
            : rep < 20
              ? "too slow to hear as a pitch"
              : "below both tones";
      return {
        exact,
        text: `${exact.p}:${exact.q} (${name}) · the sum repeats every ${((1000 * exact.q) / F1).toFixed(2)} ms, ${rep < 20 ? rep.toFixed(1) : Math.round(rep)} times a second, ${where}`,
      };
    }
    const near = simpleRatio(ratio, 8, 40);
    if (near) {
      const slip = Math.abs(near.q * f2 - near.p * F1);
      return { exact: null, text: `${ratio.toFixed(4)}: ${Math.abs(near.off).toFixed(1)}¢ off ${near.p}:${near.q} · the pattern slips ${slip < 10 ? slip.toFixed(1) : Math.round(slip)} times a second` };
    }
    return { exact: null, text: `${ratio.toFixed(4)}: no short repeating pattern` };
  };
  shell.setInfo(() => `${F1} Hz and ${(F1 * ratio).toFixed(1)} Hz · ${describe().text}`);

  let phA = 0;
  let phB = 0;
  let lastT = performance.now() / 1000;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const t = performance.now() / 1000;
      const dt = Math.min(0.1, t - lastT);
      lastT = t;
      const f2 = F1 * ratio;
      phA = (phA + 2 * Math.PI * F1 * dt) % (2 * Math.PI * 1e4);
      phB = (phB + 2 * Math.PI * f2 * dt) % (2 * Math.PI * 1e4);
      const d = describe();

      const g = stage.begin();
      const W = stage.w;
      const H = stage.h;
      const narrow = stage.narrow;

      // ---- the Lissajous figure ----
      const side = narrow ? Math.min(W - 40, H * 0.46) : Math.min(H - 56, W * 0.38);
      const lx = narrow ? W / 2 : 20 + side / 2;
      const ly = narrow ? 26 + side / 2 : H / 2 + 6;
      const R = side / 2 - 8;
      g.save();
      g.fillStyle = "rgba(122,162,255,0.035)";
      roundRect(g, lx - side / 2, ly - side / 2, side, side, 10);
      g.fill();
      g.restore();
      hline(g, lx - side / 2 + 6, lx + side / 2 - 6, ly, "rgba(122,162,255,0.08)");
      const WINDOW = 8 / F1; // eight periods of the lower tone
      const N = 900;
      const path = new Path2D();
      for (let i = 0; i <= N; i++) {
        const back = (1 - i / N) * WINDOW;
        const x = lx + R * Math.sin(phA - 2 * Math.PI * F1 * back);
        const y = ly - R * Math.sin(phB - 2 * Math.PI * f2 * back);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      glowStroke(g, path, d.exact ? [190, 220, 255] : mix(BLUE, ORANGE, 0.5), 1.15, 0.9);
      glowDot(g, lx + R * Math.sin(phA), ly - R * Math.sin(phB), 3.4, [255, 240, 220], 1);
      text(g, `${F1} Hz →`, lx, ly + side / 2 + 14, { size: 9.5, align: "center", color: rgba(BLUE, 0.85), mono: true });
      if (!narrow) {
        g.save();
        g.translate(lx - side / 2 - 8, ly);
        g.rotate(-Math.PI / 2);
        text(g, `${f2.toFixed(0)} Hz →`, 0, 0, { size: 9.5, align: "center", color: rgba(ORANGE, 0.85), mono: true });
        g.restore();
      }

      // ---- the time line ----
      const tx0 = narrow ? 16 : lx + side / 2 + 34;
      const tx1 = W - 14;
      const ty0 = narrow ? ly + side / 2 + 40 : 34;
      const ty1 = H - 24;
      const rowH = (ty1 - ty0) / 3;
      const span = d.exact ? Math.min(0.06, Math.max(0.012, (2.2 * d.exact.q) / F1)) : 0.03;
      const NPT = Math.round((tx1 - tx0) * 1.3);
      const rows: [string, (tau: number) => number, readonly [number, number, number], number][] = [
        [`${F1} Hz`, (tau) => Math.sin(2 * Math.PI * F1 * tau), BLUE, 0.85],
        [`${f2.toFixed(1)} Hz`, (tau) => Math.sin(2 * Math.PI * f2 * tau), ORANGE, 0.85],
        ["sum", (tau) => 0.5 * (Math.sin(2 * Math.PI * F1 * tau) + Math.sin(2 * Math.PI * f2 * tau)), [255, 240, 220], 1],
      ];
      rows.forEach(([name, fn, col, k], ri) => {
        const mid = ty0 + rowH * (ri + 0.5);
        const half = rowH * 0.36;
        hline(g, tx0, tx1, mid, "rgba(122,162,255,0.08)");
        const p = new Path2D();
        for (let i = 0; i <= NPT; i++) {
          const tau = (i / NPT) * span;
          const y = mid - fn(tau) * half;
          const x = tx0 + (i / NPT) * (tx1 - tx0);
          if (i === 0) p.moveTo(x, y);
          else p.lineTo(x, y);
        }
        glowStroke(g, p, col, ri === 2 ? 1.3 : 1, k * (ri === 2 ? 0.95 : 0.7));
        text(g, name, tx0, mid - half - 5, { size: 9.5, color: rgba(col, 0.75), mono: true });
      });
      // repeat brackets on the sum
      if (d.exact) {
        const T = d.exact.q / F1;
        const yb = ty0 + rowH * 2 + rowH * 0.06;
        for (let k = 0; k * T <= span + 1e-9; k++) {
          const x = tx0 + ((k * T) / span) * (tx1 - tx0);
          g.save();
          g.strokeStyle = rgba(ORANGE, 0.55);
          g.setLineDash([3, 4]);
          g.beginPath();
          g.moveTo(x, ty0 + rowH * 2 + 4);
          g.lineTo(x, ty1);
          g.stroke();
          g.restore();
        }
        const x1 = tx0 + (T / span) * (tx1 - tx0);
        if (x1 <= tx1 + 1) {
          g.save();
          g.strokeStyle = rgba(ORANGE, 0.9);
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(tx0, yb + 5);
          g.lineTo(tx0, yb);
          g.lineTo(x1, yb);
          g.lineTo(x1, yb + 5);
          g.stroke();
          g.restore();
          text(g, `repeats every ${((1000 * d.exact.q) / F1).toFixed(2)} ms`, (tx0 + x1) / 2, yb - 4, {
            size: 10,
            align: x1 - tx0 > 140 ? "center" : "left",
            color: rgba(ORANGE, 1),
            weight: 600,
          });
        }
      }
      text(g, `${(span * 1000).toFixed(span < 0.02 ? 1 : 0)} ms`, tx1, ty1 + 14, { size: 9.5, align: "right", color: "rgba(150,160,190,0.55)", mono: true });
    },
    dispose() {
      setPlaying(false);
    },
  };
}
