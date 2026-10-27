// Fig. 4 of "The Anatomy of a Note": additive synthesis. Sixteen sine
// harmonics, one bar each; draw on the bars to set the recipe. The trace is
// two periods of the sum, computed from the same amplitudes and phases the
// oscillators play. The level is held at a constant RMS, so changing the
// recipe changes the colour of the sound, not its loudness. "Scramble
// phases" shifts every harmonic in time: the trace changes completely, the
// sound barely does.

import type { Demo } from "../../lib/demoShell";
import { Partials, unlockAudio, noteLabel, guardSound } from "./sound/core";
import { Stage, PlayPill, playButton, choice, glowStroke, harmonicRgb, rgba, mix, text, hline, roundRect, WHITE } from "./sound/draw";

const H = 16;
const RMS = 0.075; // output RMS, whatever the recipe

type Preset = "sine" | "sawtooth" | "square" | "triangle" | "organ" | "custom";

export async function mountHarmonics(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.62, narrowAspect: 1.15, touch: "none" });
  const { shell, canvas } = stage;

  let f0 = 110;
  const amps = new Float64Array(H); // 0..1 per harmonic, as drawn
  const phases = new Float64Array(H);
  amps[0] = 1;
  let scrambled = false;
  let playing = false;

  const bank = new Partials(H, { level: 1, phases: true });
  const scale = (): number => {
    let ss = 0;
    for (let i = 0; i < H; i++) ss += amps[i] * amps[i];
    return ss > 1e-6 ? RMS / Math.sqrt(ss / 2) : 0;
  };
  const push = (glide = 0.04): void => {
    const k = scale();
    const fr: number[] = [];
    const am: number[] = [];
    for (let i = 0; i < H; i++) {
      const f = (i + 1) * f0;
      fr.push(f);
      am.push(f < 16000 ? amps[i] * k : 0);
    }
    bank.set(fr, am, glide);
  };
  push();

  const setPlaying = (on: boolean): void => {
    playing = on;
    if (on) {
      push(0);
      bank.start(0.1);
    } else bank.stop(0.15);
    syncPlay(on);
    pill.show(!on);
  };
  const toggle = (): void => {
    void unlockAudio().then(() => setPlaying(!playing));
  };
  const pill = new PlayPill(stage, "Tap to play", toggle, "top");
  const syncPlay = playButton(stage, ["▶ play", "■ stop"], toggle);

  const PRESETS: Record<Exclude<Preset, "custom">, (n: number) => [number, number]> = {
    sine: (n) => [n === 1 ? 1 : 0, 0],
    // classic shapes need their signs: a negative coefficient is a phase of π
    sawtooth: (n) => [1 / n, n % 2 ? 0 : Math.PI],
    square: (n) => [n % 2 ? 1 / n : 0, 0],
    triangle: (n) => [n % 2 ? 1 / (n * n) : 0, (n - 1) % 4 === 2 ? Math.PI : 0],
    // a drawbar organ registration: 8′ 4′ 2⅔′ 2′ 1⅗′ 1′ (harmonics 1 2 3 4 5 8)
    organ: (n) => [[1, 2, 3, 4, 5, 8].includes(n) ? [1, 0.7, 0.55, 0.5, 0.35, 0.3][[1, 2, 3, 4, 5, 8].indexOf(n)] : 0, 0],
  };
  let preset: Preset = "sine";
  const setPreset = choice(
    stage,
    [
      { id: "sine", label: "sine" },
      { id: "sawtooth", label: "sawtooth" },
      { id: "square", label: "square" },
      { id: "triangle", label: "triangle" },
      { id: "organ", label: "organ" },
    ] as { id: Preset; label: string }[],
    preset,
    (p) => {
      if (p === "custom") return;
      preset = p;
      for (let n = 1; n <= H; n++) [amps[n - 1], phases[n - 1]] = PRESETS[p](n);
      scrambled = false;
      bank.setPhases(phases);
      push();
    },
  );
  shell.button("scramble phases", () => {
    for (let i = 0; i < H; i++) phases[i] = Math.random() * 2 * Math.PI;
    scrambled = true;
    bank.setPhases(phases);
  });
  shell.button("drop the fundamental", () => {
    amps[0] = 0;
    preset = "custom";
    setPreset("custom");
    push();
  });
  shell.slider({
    label: "pitch",
    min: 55,
    max: 440,
    step: 1,
    value: f0,
    log: true,
    format: (v) => `${Math.round(v)} Hz`,
    onInput: (v) => {
      f0 = v;
      push(0.03);
    },
  });

  const guard = guardSound(container, () => setPlaying(false));

  shell.setInfo(() => {
    const active = amps.reduce((c, a) => c + (a > 0.005 ? 1 : 0), 0);
    return `${noteLabel(f0)} · ${active} harmonic${active === 1 ? "" : "s"} · repeats every ${(1000 / f0).toFixed(2)} ms · phases ${scrambled ? "scrambled" : "lined up"}`;
  });

  // ---- drawing on the bars ------------------------------------------------------
  const geom = { bx0: 0, bx1: 0, by0: 0, by1: 0 };
  let drawing = false;
  const paint = (x: number, y: number): void => {
    const { bx0, bx1, by0, by1 } = geom;
    const i = Math.floor(((x - bx0) / (bx1 - bx0)) * H);
    if (i < 0 || i >= H) return;
    const v = Math.max(0, Math.min(1, (by1 - y) / (by1 - by0)));
    amps[i] = v < 0.03 ? 0 : v;
    if (preset !== "custom") {
      preset = "custom";
      setPreset("custom");
    }
    push(0.03);
  };
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = stage.local(e);
    if (y < geom.by0 - 24) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    paint(x, y);
    void unlockAudio().then(() => {
      if (!playing) setPlaying(true);
    });
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const [x, y] = stage.local(e);
    paint(x, y);
  });
  const up = (): void => {
    drawing = false;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  const shown = Float64Array.from(amps);
  return {
    frame() {
      shell.tick();
      guard.pulse();
      for (let i = 0; i < H; i++) shown[i] += (amps[i] - shown[i]) * 0.3;

      const g = stage.begin();
      const W = stage.w;
      const Hh = stage.h;
      const narrow = stage.narrow;
      const x0 = 16;
      const x1 = W - 16;

      // ---- the sum: two periods ----
      const wy0 = 30;
      const wy1 = Hh * (narrow ? 0.44 : 0.46);
      const mid = (wy0 + wy1) / 2;
      const half = (wy1 - wy0) / 2;
      hline(g, x0, x1, mid, "rgba(122,162,255,0.14)");
      const xm = (x0 + x1) / 2;
      g.save();
      g.setLineDash([2, 5]);
      g.strokeStyle = "rgba(122,162,255,0.16)";
      g.beginPath();
      g.moveTo(xm, wy0);
      g.lineTo(xm, wy1);
      g.stroke();
      g.restore();
      text(g, "two periods of the sum", x0, 18, { size: 10.5, color: "rgba(180,188,210,0.8)" });
      text(g, `${(2000 / f0).toFixed(1)} ms`, x1, 18, { size: 10, align: "right", color: "rgba(150,160,190,0.6)", mono: true });

      const k = scale();
      const NPT = Math.round((x1 - x0) * 1.2);
      // faint ingredients, then the bright sum
      const PEAK = 0.34; // amplitude at the panel edge
      for (let i = 0; i < H; i++) {
        if (shown[i] < 0.01) continue;
        const p = new Path2D();
        for (let j = 0; j <= NPT; j++) {
          const u = (j / NPT) * 2;
          const y = mid - ((shown[i] * k * Math.sin(2 * Math.PI * (i + 1) * u + phases[i])) / PEAK) * half;
          const x = x0 + (j / NPT) * (x1 - x0);
          if (j === 0) p.moveTo(x, y);
          else p.lineTo(x, y);
        }
        g.save();
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = rgba(harmonicRgb(i + 1), 0.28);
        g.lineWidth = 1;
        g.stroke(p);
        g.restore();
      }
      const sum = new Path2D();
      for (let j = 0; j <= NPT; j++) {
        const u = (j / NPT) * 2;
        let y = 0;
        for (let i = 0; i < H; i++) if (shown[i] > 0.001) y += shown[i] * Math.sin(2 * Math.PI * (i + 1) * u + phases[i]);
        const py = mid - Math.max(-1.08, Math.min(1.08, (y * k) / PEAK)) * half;
        const x = x0 + (j / NPT) * (x1 - x0);
        if (j === 0) sum.moveTo(x, py);
        else sum.lineTo(x, py);
      }
      glowStroke(g, sum, [255, 236, 200], 1.6, playing ? 1 : 0.7);

      // ---- the recipe bars ----
      const by0 = Hh * (narrow ? 0.55 : 0.56);
      const by1 = Hh - 46;
      geom.bx0 = x0;
      geom.bx1 = x1;
      geom.by0 = by0;
      geom.by1 = by1;
      const bw = (x1 - x0) / H;
      text(g, "the recipe · drag on the bars to draw your own", x0, by0 - 12, { size: 10.5, color: "rgba(180,188,210,0.8)" });
      hline(g, x0, x1, by1, "rgba(122,162,255,0.2)");
      for (let i = 0; i < H; i++) {
        const cx = x0 + (i + 0.5) * bw;
        const c = harmonicRgb(i + 1);
        g.save();
        g.fillStyle = "rgba(122,162,255,0.04)";
        roundRect(g, cx - bw * 0.34, by0, bw * 0.68, by1 - by0, 3);
        g.fill();
        const bh = shown[i] * (by1 - by0);
        if (bh > 0.5) {
          g.globalCompositeOperation = "lighter";
          const grd = g.createLinearGradient(0, by1 - bh, 0, by1);
          grd.addColorStop(0, rgba(mix(c, WHITE, 0.3), 0.95));
          grd.addColorStop(1, rgba(c, 0.3));
          g.fillStyle = grd;
          roundRect(g, cx - bw * 0.34, by1 - bh, bw * 0.68, bh, 3);
          g.fill();
        }
        g.restore();
        text(g, String(i + 1), cx, by1 + 13, { size: narrow ? 9 : 10.5, align: "center", color: "rgba(150,160,190,0.65)", mono: true });
        // phase dial: where in its cycle this harmonic starts
        const r = Math.min(7, bw * 0.28);
        const dy = by1 + 27;
        g.save();
        g.strokeStyle = "rgba(122,162,255,0.25)";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, dy, r, 0, Math.PI * 2);
        g.stroke();
        if (shown[i] > 0.01) {
          g.strokeStyle = rgba(c, 0.9);
          g.lineWidth = 1.4;
          g.beginPath();
          g.moveTo(cx, dy);
          g.lineTo(cx + Math.cos(-phases[i]) * r, dy + Math.sin(-phases[i]) * r);
          g.stroke();
        }
        g.restore();
      }
    },
    dispose() {
      setPlaying(false);
    },
  };
}
