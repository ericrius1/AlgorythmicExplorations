// Fig. 1 of "The Anatomy of a Note": an oscilloscope you can play. One
// oscillator; the trace is the waveform it plays, 20 ms of it, triggered so
// it stands still. Frequency squeezes the shape, level scales it, the shape
// buttons change it without changing the pitch. The strip underneath puts
// the same sound on a log-frequency axis spanning human hearing, one bar per
// harmonic, so the shapes already show their recipes.

import type { Demo } from "../../lib/demoShell";
import { ctx, dest, now, unlockAudio, noteLabel, fmtHz, dbToGain, guardSound } from "./sound/core";
import { Stage, PlayPill, playButton, choice, glowStroke, harmonicRgb, rgba, text, hline, vline, ORANGE, WHITE, mix } from "./sound/draw";

type Shape = "sine" | "triangle" | "square" | "sawtooth";
const WINDOW_MS = 20;

// Fourier sine coefficient of harmonic n for the browser's built-in shapes
// (as the Web Audio spec defines them), before the browser scales the
// band-limited result to a peak of 1.
function coef(shape: Shape, n: number): number {
  switch (shape) {
    case "sine":
      return n === 1 ? 1 : 0;
    case "square":
      return n % 2 ? 4 / (n * Math.PI) : 0;
    case "sawtooth":
      return ((n % 2 ? 1 : -1) * 2) / (n * Math.PI);
    case "triangle":
      return (8 * Math.sin((n * Math.PI) / 2)) / (n * n * Math.PI * Math.PI);
  }
}

export async function mountOscillo(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.56, narrowAspect: 0.95 });
  const { shell } = stage;

  let freq = 220;
  let levelDb = -20;
  let shape: Shape = "sine";
  let playing = false;

  // ---- sound -----------------------------------------------------------------
  let osc: OscillatorNode | null = null;
  const gain = ctx().createGain();
  gain.gain.value = 0;
  gain.connect(dest());

  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    const t = now();
    if (on) {
      if (!osc) {
        osc = ctx().createOscillator();
        osc.type = shape;
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(t);
      }
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(dbToGain(levelDb), t, 0.02);
    } else {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, 0.03);
      const o = osc;
      osc = null;
      window.setTimeout(() => {
        o?.stop();
        o?.disconnect();
      }, 300);
    }
    syncPlay(playing);
    pill.show(!playing);
  };
  const toggle = (): void => {
    void unlockAudio().then(() => setPlaying(!playing));
  };

  const pill = new PlayPill(stage, "Tap to play", toggle);
  const syncPlay = playButton(stage, ["▶ play", "■ stop"], toggle);
  choice(
    stage,
    [
      { id: "sine", label: "sine" },
      { id: "triangle", label: "triangle" },
      { id: "square", label: "square" },
      { id: "sawtooth", label: "sawtooth" },
    ],
    shape,
    (s) => {
      shape = s;
      if (osc) osc.type = s;
    },
  );
  shell.slider({
    label: "frequency",
    min: 55,
    max: 1760,
    step: 1,
    value: freq,
    log: true,
    format: (v) => `${Math.round(v)} Hz`,
    onInput: (v) => {
      freq = v;
      osc?.frequency.setTargetAtTime(v, now(), 0.012);
    },
  });
  shell.slider({
    label: "level",
    min: -50,
    max: -10,
    step: 1,
    value: levelDb,
    format: (v) => `${v} dB`,
    onInput: (v) => {
      levelDb = v;
      if (playing) gain.gain.setTargetAtTime(dbToGain(v), now(), 0.02);
    },
  });

  const guard = guardSound(container, () => setPlaying(false));

  shell.setInfo(() => {
    const amp = dbToGain(levelDb);
    return `${noteLabel(freq)} · ${Math.round(freq)} Hz · one period = ${(1000 / freq).toFixed(2)} ms · ${levelDb} dB = amplitude ${amp.toFixed(amp < 0.01 ? 4 : 3)}`;
  });

  // ---- drawing ------------------------------------------------------------------
  // One period of what the oscillator plays: harmonics below Nyquist, scaled
  // to a peak of 1. Rebuilt only when the shape or pitch changes.
  const sr = ctx().sampleRate || 48000;
  const TAB = 1024;
  const table = new Float32Array(TAB + 1);
  const amps = new Float32Array(401); // output amplitude per harmonic at 0 dB
  let tabKey = "";
  const rebuild = (): void => {
    const key = `${shape}:${Math.round(freq)}`;
    if (key === tabKey) return;
    tabKey = key;
    const top = Math.min(400, Math.floor(sr / 2 / freq));
    table.fill(0);
    for (let n = 1; n <= top; n++) {
      const b = coef(shape, n);
      if (!b) continue;
      for (let i = 0; i <= TAB; i++) table[i] += b * Math.sin((2 * Math.PI * n * i) / TAB);
    }
    let peak = 1e-9;
    for (let i = 0; i <= TAB; i++) peak = Math.max(peak, Math.abs(table[i]));
    for (let i = 0; i <= TAB; i++) table[i] /= peak;
    amps.fill(0);
    for (let n = 1; n <= top; n++) amps[n] = Math.abs(coef(shape, n)) / peak;
  };
  const wave = (x: number): number => {
    const f = (x - Math.floor(x)) * TAB;
    const i = Math.floor(f);
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  };

  let glowLevel = 0;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      glowLevel += ((playing ? 1 : 0) - glowLevel) * 0.1;
      rebuild();
      const g = stage.begin();
      const { w, h } = stage;
      const narrow = stage.narrow;

      // ---- scope panel ----
      const sx0 = 14;
      const sx1 = w - 14;
      const sy0 = 14;
      const sy1 = h * (narrow ? 0.6 : 0.64);
      const mid = (sy0 + sy1) / 2;
      const half = (sy1 - sy0) / 2 - 6;
      // graticule: 1 ms columns, amplitude rows at ±0.1, ±0.2, ±0.3
      for (let ms = 0; ms <= WINDOW_MS; ms++) {
        const x = sx0 + (ms / WINDOW_MS) * (sx1 - sx0);
        vline(g, x, sy0, sy1, ms % 5 === 0 ? "rgba(122,162,255,0.13)" : "rgba(122,162,255,0.05)");
      }
      const FULL = 0.32; // amplitude at the panel edge
      for (const a of [-0.3, -0.2, -0.1, 0.1, 0.2, 0.3]) {
        const y = mid - (a / FULL) * half;
        hline(g, sx0, sx1, y, "rgba(122,162,255,0.05)");
      }
      hline(g, sx0, sx1, mid, "rgba(122,162,255,0.16)");
      for (const ms of [0, 5, 10, 15, 20]) {
        const x = sx0 + (ms / WINDOW_MS) * (sx1 - sx0);
        text(g, `${ms} ms`, Math.min(sx1 - 2, Math.max(sx0 + 2, x)), sy1 + 13, {
          size: 10,
          align: ms === 0 ? "left" : ms === 20 ? "right" : "center",
          color: "rgba(150,160,190,0.6)",
          mono: true,
        });
      }
      for (const a of [0.3, -0.3]) {
        text(g, a > 0 ? "+0.3" : "−0.3", sx1 - 4, mid - (a / FULL) * half - 4, { size: 9.5, align: "right", color: "rgba(150,160,190,0.45)", mono: true });
      }

      // one period, bracketed
      const periodMs = 1000 / freq;
      const px = ((sx1 - sx0) * periodMs) / WINDOW_MS;
      if (px < sx1 - sx0) {
        const bx0 = sx0;
        const bx1 = sx0 + px;
        const by = sy0 + 10;
        g.save();
        g.strokeStyle = rgba(ORANGE, 0.75);
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(bx0, by + 6);
        g.lineTo(bx0, by);
        g.lineTo(bx1, by);
        g.lineTo(bx1, by + 6);
        g.stroke();
        g.restore();
        vline(g, bx1, by, sy1, rgba(ORANGE, 0.25), 1, [3, 4]);
        const lab = `one period · ${periodMs.toFixed(2)} ms`;
        const right = bx1 + 6;
        if (px > 150) text(g, lab, (bx0 + bx1) / 2, by - 3, { size: 10.5, align: "center", color: rgba(ORANGE, 0.95), weight: 600 });
        else text(g, lab, right, by + 4, { size: 10.5, color: rgba(ORANGE, 0.95), weight: 600 });
      }

      // the trace
      const amp = dbToGain(levelDb);
      const path = new Path2D();
      const N = Math.min(1400, Math.max(400, Math.round((sx1 - sx0) * 1.5)));
      const cycles = (freq * WINDOW_MS) / 1000;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const y = mid - ((wave(u * cycles) * amp) / FULL) * half;
        const x = sx0 + u * (sx1 - sx0);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      const col = mix([140, 200, 255], [150, 255, 190], glowLevel);
      glowStroke(g, path, col, 1.5, 0.75 + 0.25 * glowLevel);

      // ---- spectrum strip: harmonics on the hearing range ----
      const ty0 = sy1 + 34;
      const ty1 = h - 22;
      const lo = Math.log10(20);
      const hi = Math.log10(20000);
      const fx = (f: number): number => sx0 + ((Math.log10(f) - lo) / (hi - lo)) * (sx1 - sx0);
      g.save();
      g.fillStyle = "rgba(122,162,255,0.035)";
      g.fillRect(sx0, ty0, sx1 - sx0, ty1 - ty0);
      g.restore();
      for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
        const x = fx(f);
        vline(g, x, ty0, ty1, "rgba(122,162,255,0.08)");
        if (narrow && (f === 50 || f === 200 || f === 2000)) continue;
        text(g, f >= 1000 ? `${f / 1000}k` : `${f}`, x, ty1 + 13, {
          size: 9.5,
          align: f === 20 ? "left" : f === 20000 ? "right" : "center",
          color: "rgba(150,160,190,0.55)",
          mono: true,
        });
      }
      text(g, "Hz", sx1, ty0 - 5, { size: 9.5, align: "right", color: "rgba(150,160,190,0.5)", mono: true });
      text(g, "harmonics, on the range of human hearing (dB)", sx0, ty0 - 5, { size: 10, color: "rgba(170,178,200,0.7)" });
      const DB_RANGE = 80;
      for (let n = 1; n * freq < 20000 && n <= 400; n++) {
        if (!amps[n]) continue;
        const db = levelDb + 20 * Math.log10(amps[n]);
        const t = Math.max(0, (db + DB_RANGE) / DB_RANGE);
        if (t <= 0) continue;
        const x = fx(n * freq);
        const y = ty1 - t * (ty1 - ty0 - 4);
        const c = harmonicRgb(n);
        const p = new Path2D();
        p.moveTo(x, ty1);
        p.lineTo(x, y);
        glowStroke(g, p, c, n === 1 ? 1.6 : 1.1, (0.5 + 0.5 * glowLevel) * (n === 1 ? 1 : 0.85));
      }
      text(g, `${fmtHz(freq)}`, fx(freq), ty0 + 12, { size: 10, align: "center", color: rgba(mix(harmonicRgb(1), WHITE, 0.3), 0.9), mono: true });
    },
    dispose() {
      setPlaying(false);
    },
  };
}
