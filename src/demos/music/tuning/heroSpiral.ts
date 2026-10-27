// Part 4 hero: twelve pure fifths climbing the pitch spiral. The pen stacks
// one fifth at a time, lands a hair past seven octaves (the Pythagorean
// comma, drawn as the red arc), then every fifth is shaved to 700¢ and the
// gap closes. With sound on you hear each new note, then C against B♯ beating
// 3.6 times a second, and the beats slowing to nothing as the gap closes.

import { Shell, type Demo } from "../../../lib/demoShell";
import { unlockAudio, frameGuard } from "../../../lib/audio";
import { FIFTH, fifthName, folded } from "./theory";
import { Surface, approach, ease, label, signed } from "./draw";
import { PitchSpiral, type SpiralState } from "./spiral";
import { Sound, hz, type Held } from "./sound";
import { heroAspect, heroBand } from "./hero";
import { toggle } from "./ui";

// timeline (seconds)
const STEP = 1.15; // per stacked fifth
const T_STACK = 12 * STEP;
const T_COMMA = 4.5;
const T_TEMPER = 3.5;
const T_CLOSED = 4;
const T_FADE = 1.6;
const T_LOOP = T_STACK + T_COMMA + T_TEMPER + T_CLOSED + T_FADE;
const START = T_STACK + 0.6; // first frame: the comma is already showing

export function mountHeroSpiral(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const surf = new Surface(shell.canvas, heroAspect(container));
  const spiral = new PitchSpiral();
  const sound = new Sound({ level: 0.9, reverb: 0.22 });
  shell.canvas.style.cursor = "pointer";

  const state: SpiralState = {
    fifth: FIFTH,
    count: 13,
    pen: 12,
    flash: new Array(13).fill(0),
    hover: -1,
    commaAlpha: 1,
    labels: true,
    trailAlpha: 1,
  };

  let clockT = START;
  let lastNow = performance.now();
  let lastStep = 12;
  let soundOn = false;
  let dyad: Held | null = null;
  let phase = "";

  const releaseDyad = (): void => {
    dyad?.release(0.6);
    dyad = null;
  };
  const guard = frameGuard(() => {
    releaseDyad();
    sound.silence();
  });

  const playNode = (k: number, vel = 0.6): void => {
    if (!sound.ready) return;
    sound.note(hz(folded(k, state.fifth)), 0, { vel, dur: 1.8, timbre: "keys", bright: 0.45 });
  };

  const btn = toggle(shell.controls, ["▶ Play sound", "■ Mute"], (on) => {
    if (on) void unlockAudio().then(() => (soundOn = true));
    else {
      soundOn = false;
      releaseDyad();
      sound.silence();
    }
  });
  btn.el.classList.add("tn-hero-play");

  shell.canvas.addEventListener("pointermove", (e) => {
    const p = surf.local(e);
    state.hover = spiral.pick(p.x, p.y, state, 26);
  });
  shell.canvas.addEventListener("pointerleave", () => (state.hover = -1));
  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = surf.local(e);
    const k = spiral.pick(p.x, p.y, state, 30);
    void unlockAudio().then(() => {
      if (!soundOn) {
        soundOn = true;
        btn.set(true);
      }
      if (k >= 0) {
        state.flash[k] = 1;
        playNode(k, 0.75);
      }
    });
  });

  shell.setInfo(() => {
    if (phase === "stack") {
      const n = Math.min(12, Math.floor(state.pen + 0.02));
      const names = Array.from({ length: n + 1 }, (_, k) => fifthName(k));
      const tail = names.length > 6 ? "… " + names.slice(-5).join(" → ") : names.join(" → ");
      return `${tail} · ${n} fifth${n === 1 ? "" : "s"} up`;
    }
    if (phase === "comma") return "12 pure fifths = 7 octaves + 23.46¢ (the Pythagorean comma)";
    if (phase === "temper") return `shaving each fifth: ${state.fifth.toFixed(2)}¢`;
    return "every fifth 700¢ · 12 fifths = 7 octaves, no gap · tap a note";
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      clockT = (clockT + dt) % T_LOOP;
      const t = clockT;

      // ---- timeline ----
      let fifth = FIFTH;
      let pen = 12;
      let trail = 1;
      let comma = 1;
      if (t < T_STACK) {
        phase = "stack";
        const k = t / STEP;
        const whole = Math.floor(k);
        const frac = Math.min(1, (k - whole) / 0.72);
        pen = whole + ease(frac);
        comma = 0;
        trail = Math.min(1, t / 0.6);
      } else if (t < T_STACK + T_COMMA) {
        phase = "comma";
        comma = ease((t - T_STACK) / 0.5);
      } else if (t < T_STACK + T_COMMA + T_TEMPER) {
        phase = "temper";
        const u = ease((t - T_STACK - T_COMMA) / T_TEMPER);
        fifth = FIFTH + (700 - FIFTH) * u;
      } else if (t < T_STACK + T_COMMA + T_TEMPER + T_CLOSED) {
        phase = "closed";
        fifth = 700;
      } else {
        phase = "fade";
        fifth = 700;
        trail = 1 - ease((t - (T_LOOP - T_FADE)) / T_FADE);
        comma = trail;
      }

      // node arrivals: bloom + note
      const arrived = phase === "stack" ? Math.floor(pen + 0.0005) : 12;
      if (phase === "stack" && arrived !== lastStep) {
        lastStep = arrived;
        state.flash[arrived] = 1;
        if (soundOn) playNode(arrived);
      }
      if (phase !== "stack") lastStep = phase === "fade" ? -1 : 12;

      // the comma dyad: C against B♯, then glide shut
      if (soundOn && sound.ready) {
        if (phase === "comma" && !dyad && t - T_STACK > 0.4) {
          dyad = sound.hold([hz(0), hz(folded(12, FIFTH))], { timbre: "organ", level: 0.05, attack: 0.25, cutoff: 3000 });
        }
        if (dyad && phase === "temper") dyad.set([hz(0), hz(folded(12, fifth) > 600 ? folded(12, fifth) - 1200 : folded(12, fifth))]);
        if (dyad && phase === "closed" && t > T_LOOP - T_FADE - 1.2) releaseDyad();
      } else if (dyad) releaseDyad();

      state.fifth = fifth;
      state.pen = pen;
      state.count = phase === "stack" ? Math.floor(pen + 0.0005) + 1 : 13;
      state.trailAlpha = trail;
      state.commaAlpha = approach(state.commaAlpha, comma, 10, dt);
      for (let k = 0; k < state.flash.length; k++) state.flash[k] = approach(state.flash[k], 0, 2.4, dt);

      // ---- draw ----
      surf.fit();
      const { ctx, w, h } = surf;
      surf.clear("#07080d");
      const band = heroBand(shell.canvas, w, h);
      const bh = band.bottom - band.top;
      const fsPad = Math.max(16, Math.min(28, w * 0.022));
      const R = Math.max(40, Math.min(w * 0.46, bh / 2 - fsPad));
      spiral.layout(w / 2, band.top + bh / 2, R);
      const scale = Math.max(0.85, Math.min(1.25, R / 210));
      ctx.globalAlpha = 1;
      spiral.draw(ctx, state, now / 1000, scale);
      if (state.commaAlpha > 0.02) {
        const gap = 12 * state.fifth - 8400;
        const tag = Math.abs(gap) < 0.05 ? "closed" : `${signed(gap, 2)}¢`;
        spiral.commaTag(ctx, state, tag, scale);
      }
      if (state.hover >= 0) {
        const k = state.hover;
        const [x, y] = spiral.nodeAt(k, state.fifth);
        label(ctx, `${fifthName(k)} · ${k} fifth${k === 1 ? "" : "s"} · ${folded(k, state.fifth).toFixed(1)}¢ above C`, x, y - 22 * scale, {
          size: 11 * scale,
          mono: true,
          color: "#e8ebf4",
        });
      }
    },
    dispose() {
      releaseDyad();
      sound.silence();
    },
  };
}
