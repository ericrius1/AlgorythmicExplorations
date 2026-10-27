// Swing and microtiming. One bar of sixteenth-note hi-hats over a kick and a
// backbeat. Swing delays every second sixteenth; the humanizer then nudges
// every hit by a few milliseconds, drawn either from white noise (each nudge
// independent of the last) or from 1/f noise (each nudge close to the last,
// so the timing drifts the way a person's does). The top panel shows the bar
// as played against the straight grid; the bottom panel is the hi-hat's
// timing error over the last 64 hits.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { COL, clear, figureAspect, font, glow, line, refresh, rgba, setActive, tapToPlay, text, view2d } from "./draw";
import { Clock, audioTime, drumKit, startAudio, strip, type DrumName, type Kit } from "./sound";
import { PinkNoise, gaussian, mulberry32 } from "./theory";

type Noise = "off" | "white" | "pink";

const PATTERN: Record<"kick" | "snare", number[]> = {
  kick: [0, 7, 10],
  snare: [4, 12],
};

interface Hit {
  bar: number;
  step: number;
  drum: DrumName;
  grid: number; // straight-grid time
  time: number; // played time
  jitter: number; // seconds, humanizer only
}

export async function mountSwing(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, figureAspect(container, 0.5, 1.05));
  container.classList.add("mh-fig");
  const canvas = shell.canvas;
  const v = view2d(canvas);

  let swing = 0.58;
  let sigmaMs = 8;
  let noise: Noise = "pink";
  const rng = mulberry32(2011);
  const streams = new Map<DrumName, PinkNoise>();
  const nudge = (d: DrumName): number => {
    if (noise === "off" || sigmaMs === 0) return 0;
    let p = streams.get(d);
    if (!p) streams.set(d, (p = new PinkNoise(rng, 7)));
    const z = noise === "pink" ? p.next() : gaussian(rng);
    return Math.max(-3, Math.min(3, z)) * (sigmaMs / 1000);
  };

  // ---- sound --------------------------------------------------------------------------------
  let kit: Kit | null = null;
  const hits: Hit[] = [];
  const hatErr: number[] = [];
  const clock = new Clock(92, 4, (step, time, dur) => {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const late = s % 2 === 1 ? (2 * swing - 1) * dur : 0;
    const play = (d: DrumName, vel: number): void => {
      const j = nudge(d);
      const t = Math.max(audioTime() + 0.005, time + late + j);
      kit?.hit(d, t, vel);
      hits.push({ bar, step: s, drum: d, grid: time, time: t, jitter: j });
      if (d === "hat") {
        hatErr.push(j * 1000);
        if (hatErr.length > 64) hatErr.shift();
      }
    };
    play("hat", s % 4 === 0 ? 0.62 : s % 2 === 0 ? 0.46 : 0.3);
    if (PATTERN.kick.includes(s)) play("kick", s === 0 ? 0.95 : 0.75);
    if (PATTERN.snare.includes(s)) play("snare", 0.85);
    while (hits.length > 120) hits.shift();
  });
  const ensure = async (): Promise<void> => {
    await startAudio();
    if (!kit) {
      const sk = strip({ db: 0 });
      const ss = strip({ db: -3, reverb: 0.12, pan: 0.04 });
      const sh = strip({ db: -6, pan: 0.25 });
      kit = drumKit({ kick: sk.input, snare: ss.input, hat: sh.input }, sk.input);
    }
  };
  const start = async (): Promise<void> => {
    tap.hide();
    await ensure();
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
  const tap = tapToPlay(container, "Tap to play the groove", () => void start(), 0.36);
  canvas.addEventListener("pointerdown", () => (clock.isRunning ? stop() : void start()));

  // ---- controls ---------------------------------------------------------------------------------
  const playBtn = shell.button("▶ play", () => (clock.isRunning ? stop() : void start()));
  const sync = (): void => {
    playBtn.textContent = clock.isRunning ? "■ stop" : "▶ play";
  };
  const swingS = shell.slider({
    label: "swing",
    min: 50,
    max: 75,
    step: 1,
    value: swing * 100,
    format: (x) => `${Math.round(x)}% · ${(x / (100 - x)).toFixed(2)} : 1`,
    onInput: (x) => (swing = x / 100),
  });
  const sigS = shell.slider({
    label: "humanize",
    min: 0,
    max: 30,
    step: 1,
    value: sigmaMs,
    format: (x) => (x === 0 ? "off" : `σ ${Math.round(x)} ms`),
    onInput: (x) => (sigmaMs = x),
  });
  shell.slider({
    label: "tempo",
    min: 60,
    max: 140,
    step: 1,
    value: clock.bpm,
    format: (x) => `${Math.round(x)} bpm`,
    onInput: (x) => (clock.bpm = x),
  });
  const g = document.createElement("div");
  g.className = "mh-group";
  const gl = document.createElement("span");
  gl.className = "mh-group-label";
  gl.textContent = "jitter";
  g.appendChild(gl);
  const nBtns = new Map<Noise, HTMLButtonElement>();
  for (const [k, lab] of [
    ["white", "random"],
    ["pink", "1/f"],
  ] as [Noise, string][]) {
    const b = shell.button(lab, () => {
      noise = k;
      for (const [kk, bb] of nBtns) setActive(bb, kk === noise);
      hatErr.length = 0;
      if (sigmaMs === 0) setSlider(sigS, 12);
    });
    g.appendChild(b);
    nBtns.set(k, b);
  }
  setActive(nBtns.get(noise)!, true);
  shell.controls.appendChild(g);
  const g2 = document.createElement("div");
  g2.className = "mh-group";
  const gl2 = document.createElement("span");
  gl2.className = "mh-group-label";
  gl2.textContent = "feel";
  g2.appendChild(gl2);
  const setSlider = (el: HTMLInputElement, x: number): void => {
    el.value = String(x);
    el.dispatchEvent(new Event("input"));
  };
  for (const [lab, sw, sg] of [
    ["machine", 50, 0],
    ["light swing", 58, 6],
    ["triplet swing", 67, 8],
    ["sloppy", 50, 25],
  ] as [string, number, number][]) {
    g2.appendChild(
      shell.button(lab, () => {
        setSlider(swingS, sw);
        setSlider(sigS, sg);
        void start();
      }),
    );
  }
  shell.controls.appendChild(g2);

  shell.setInfo(() => {
    const step = clock.stepDur;
    const lateMs = (2 * swing - 1) * step * 1000;
    const rms = hatErr.length ? Math.sqrt(hatErr.reduce((s, x) => s + x * x, 0) / hatErr.length) : 0;
    return `every second sixteenth ${lateMs.toFixed(0)} ms late (a sixteenth is ${(step * 1000).toFixed(0)} ms)${sigmaMs && hatErr.length ? ` · hat timing error ${rms.toFixed(1)} ms rms, ${noise === "pink" ? "1/f" : "random"}` : ""}`;
  });

  // ---- drawing ------------------------------------------------------------------------------------
  const ROWS: { drum: DrumName; col: string; label: string }[] = [
    { drum: "hat", col: COL.calm, label: "hi-hat" },
    { drum: "snare", col: COL.minor, label: "snare" },
    { drum: "kick", col: COL.major, label: "kick" },
  ];

  const draw = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    clear(v, "#0b0d16", "#05060a");
    const narrow = w / px < 560;
    const now = audioTime();
    const running = clock.isRunning;
    const stepDur = clock.stepDur;
    const pos = running ? clock.position() : 0;
    const curBar = Math.floor(pos / 16);
    const curStep = pos - curBar * 16;

    // ---- the bar ----
    const x0 = (narrow ? 16 : 70) * px;
    const x1 = w - 16 * px;
    const cw = (x1 - x0) / 16;
    const top = 22 * px;
    const barH = h * (narrow ? 0.5 : 0.52);
    const rowY = ROWS.map((_, i) => top + barH * (0.2 + i * 0.32));
    for (let s = 0; s <= 16; s++) {
      const x = x0 + s * cw;
      line(ctx, x, top, x, top + barH, rgba(COL.muted, s % 4 === 0 ? 0.3 : 0.09), 1 * px);
      if (s < 16 && s % 4 === 0) text(ctx, String(s / 4 + 1), x + 4 * px, top + 4 * px, { color: COL.dim, font: font(px, 9, 650) });
    }
    ROWS.forEach((r, i) => {
      if (!narrow) text(ctx, r.label, x0 - 12 * px, rowY[i], { color: r.col, align: "right", font: font(px, 10, 650) });
      else text(ctx, r.label, x0 + 2 * px, rowY[i] - 14 * px, { color: r.col, font: font(px, 8.5, 650), alpha: 0.8 });
    });
    // what to show for each step: this bar's hit once its step has played, else last bar's
    const show = (d: DrumName, s: number): Hit | undefined => {
      const mine = hits.filter((x) => x.drum === d && x.step === s);
      const cur = mine.find((x) => x.bar === curBar && x.time <= now + 0.002);
      return cur ?? mine.find((x) => x.bar === curBar - 1);
    };
    ROWS.forEach((r, i) => {
      const y = rowY[i];
      const steps = r.drum === "hat" ? [...Array(16).keys()] : PATTERN[r.drum as "kick" | "snare"];
      for (const s of steps) {
        const gx = x0 + s * cw;
        const hit = running ? show(r.drum, s) : undefined;
        // when stopped, preview the current settings with no jitter
        const off = hit ? (hit.time - hit.grid) / stepDur : s % 2 === 1 ? 2 * swing - 1 : 0;
        const x = gx + off * cw;
        // straight-grid ghost
        ctx.beginPath();
        ctx.arc(gx, y, 2 * px, 0, Math.PI * 2);
        ctx.fillStyle = rgba(COL.muted, 0.5);
        ctx.fill();
        if (Math.abs(x - gx) > 0.5 * px) line(ctx, gx, y, x, y, rgba(r.col, 0.55), 1.5 * px);
        const age = hit ? now - hit.time : 9;
        const fl = age >= 0 && age < 0.25 ? 1 - age / 0.25 : 0;
        const big = r.drum === "hat" ? (s % 2 === 0 ? 5 : 3.6) : 6.5;
        glow(ctx, x, y, (big * 2.4 + 18 * fl) * px, r.col, 0.4 + 0.6 * fl);
        ctx.beginPath();
        ctx.arc(x, y, big * px, 0, Math.PI * 2);
        ctx.fillStyle = r.col;
        ctx.fill();
      }
    });
    if (running) {
      const x = x0 + curStep * cw;
      line(ctx, x, top, x, top + barH, rgba(COL.white, 0.5), 1.4 * px);
    }

    // ---- the hi-hat's timing error ----
    const pTop = top + barH + 34 * px;
    const pBot = h - 18 * px;
    const pMid = (pTop + pBot) / 2;
    const span = 40; // ms each way
    const Y = (ms: number): number => pMid - (ms / span) * (pBot - pTop) * 0.5;
    text(ctx, "hi-hat timing error, last 64 hits", x0, pTop - 14 * px, { color: COL.muted, font: font(px, 9.5, 650) });
    for (const ms of [-30, -15, 0, 15, 30]) {
      line(ctx, x0, Y(ms), x1, Y(ms), rgba(COL.muted, ms === 0 ? 0.3 : 0.08), 1 * px);
      if (!narrow || ms === 30 || ms === -30) text(ctx, `${ms > 0 ? "+" : ""}${ms} ms`, x1, Y(ms) - 6 * px, { color: COL.dim, align: "right", font: font(px, 8.5, 600) });
    }
    if (sigmaMs > 0) {
      ctx.fillStyle = rgba(COL.calm, 0.06);
      ctx.fillRect(x0, Y(sigmaMs), x1 - x0, Y(-sigmaMs) - Y(sigmaMs));
    }
    if (hatErr.length > 1) {
      const dx = (x1 - x0) / 63;
      const start = 64 - hatErr.length;
      ctx.beginPath();
      hatErr.forEach((ms, i) => {
        const x = x0 + (start + i) * dx;
        const y = Y(Math.max(-span, Math.min(span, ms)));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = rgba(COL.calm, 0.9);
      ctx.lineWidth = 1.6 * px;
      ctx.stroke();
      hatErr.forEach((ms, i) => {
        const x = x0 + (start + i) * dx;
        ctx.beginPath();
        ctx.arc(x, Y(Math.max(-span, Math.min(span, ms))), 2 * px, 0, Math.PI * 2);
        ctx.fillStyle = COL.calm;
        ctx.fill();
      });
      const last = hatErr[hatErr.length - 1];
      glow(ctx, x1, Y(Math.max(-span, Math.min(span, last))), 14 * px, COL.calm, 0.8);
    } else {
      text(ctx, sigmaMs ? "play to see the drift" : "humanize is off: every hit lands on the grid", (x0 + x1) / 2, pMid - 12 * px, {
        color: COL.dim,
        align: "center",
        font: font(px, 10, 600),
      });
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
