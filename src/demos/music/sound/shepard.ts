// Fig. 7 of "The Anatomy of a Note": a pitch that rises forever. Nine sine
// components an octave apart sit under a fixed bell-shaped envelope on a
// log-frequency axis (Shepard 1964). They all climb together; one fades out
// at the top while a new one fades in at the bottom. Every component is the
// same pitch class, so the helix of pitch shows them stacked on one spoke:
// the spoke turns (chroma changes) but the stack never goes anywhere
// (height doesn't). Steps is Shepard's version; glide is Risset's.

import type { Demo } from "../../../lib/demoShell";
import { ctx, dest, now, unlockAudio, NOTE, guardSound } from "./core";
import { Stage, PlayPill, playButton, choice, glowStroke, glowDot, chromaRgb, rgba, mix, text, vline, WHITE } from "./draw";

const K = 9;
const FMIN = 32.703; // C1
const STEP_S = 0.42; // seconds per semitone in steps mode
const GLIDE_OCT_S = 1 / 8; // octaves per second in glide mode

export async function mountShepard(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.56, narrowAspect: 1.25 });
  const { shell } = stage;

  let dir: "up" | "down" = "up";
  let mode: "glide" | "steps" = "steps";
  let phi = 0; // position in octaves, mod 1
  let travelled = 0; // octaves since play
  let playing = false;
  let stepClock = 0;

  const xs = (k: number): number => {
    const v = (k + phi) / K;
    return v - Math.floor(v);
  };
  const env = (x: number): number => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);

  // ---- sound ------------------------------------------------------------------------
  const c = ctx();
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(dest());
  let oscs: OscillatorNode[] = [];
  let gains: GainNode[] = [];
  const lastX = new Float64Array(K);
  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    const t = now();
    if (on) {
      travelled = 0;
      stepClock = 0;
      oscs = [];
      gains = [];
      for (let k = 0; k < K; k++) {
        const o = c.createOscillator();
        const gn = c.createGain();
        const x = xs(k);
        lastX[k] = x;
        o.frequency.value = FMIN * Math.pow(2, K * x);
        gn.gain.value = env(x) * 0.045;
        o.connect(gn).connect(out);
        o.start(t);
        oscs.push(o);
        gains.push(gn);
      }
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(1, t, 0.05);
    } else {
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, 0.05);
      const old = oscs;
      oscs = [];
      gains = [];
      window.setTimeout(() => old.forEach((o) => (o.stop(), o.disconnect())), 400);
    }
    sync(on);
    pill.show(!on);
  };
  const toggle = (): void => {
    void unlockAudio().then(() => setPlaying(!playing));
  };
  const pill = new PlayPill(stage, "Tap to play", toggle);
  const sync = playButton(stage, ["▶ play", "■ stop"], toggle);
  choice(
    stage,
    [
      { id: "steps", label: "steps (Shepard)" },
      { id: "glide", label: "glide (Risset)" },
    ],
    mode,
    (m) => (mode = m),
  );
  choice(
    stage,
    [
      { id: "up", label: "up" },
      { id: "down", label: "down" },
    ],
    dir,
    (d) => {
      dir = d;
      travelled = 0;
    },
  );

  const guard = guardSound(container, () => setPlaying(false));

  const chroma = (): number => {
    // pitch class of the components, as a fraction of an octave above C
    const v = phi - Math.floor(phi);
    return v;
  };
  const pcName = (): string => NOTE[Math.round(chroma() * 12) % 12];

  shell.setInfo(() =>
    playing
      ? `pitch class ${pcName()} · ${dir === "up" ? "climbed" : "fallen"} ${Math.abs(travelled).toFixed(1)} octaves so far · the components still span ${Math.round(FMIN)} Hz – ${(FMIN * Math.pow(2, K) / 1000).toFixed(1)} kHz`
      : `${K} sines an octave apart, under one fixed envelope`,
  );

  let lastT = performance.now() / 1000;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      const tNow = performance.now() / 1000;
      const dt = Math.min(0.1, tNow - lastT);
      lastT = tNow;
      const sgn = dir === "up" ? 1 : -1;

      // advance (slowly while silent, so the figure shows what it does)
      let instant = false;
      const speed = playing ? 1 : 0.35;
      if (mode === "glide") {
        phi += sgn * GLIDE_OCT_S * dt * speed;
        if (playing) travelled += sgn * GLIDE_OCT_S * dt;
      } else {
        stepClock += dt * speed;
        if (stepClock >= STEP_S) {
          stepClock -= STEP_S;
          phi += sgn / 12;
          if (playing) travelled += sgn / 12;
          instant = true;
        }
      }
      phi -= Math.floor(phi);
      if (playing && oscs.length) {
        const t = now();
        for (let k = 0; k < K; k++) {
          const x = xs(k);
          const f = FMIN * Math.pow(2, K * x);
          const p = oscs[k].frequency;
          if (Math.abs(x - lastX[k]) > 0.5) {
            p.cancelScheduledValues(t);
            p.setValueAtTime(f, t); // wrapped while silent
          } else {
            p.setTargetAtTime(f, t, instant ? 0.008 : 0.02);
          }
          gains[k].gain.setTargetAtTime(env(x) * 0.045, t, 0.02);
          lastX[k] = x;
        }
      }

      const g = stage.begin();
      const W = stage.w;
      const H = stage.h;
      const narrow = stage.narrow;
      const col = chromaRgb(Math.log2(FMIN) + chroma());

      // ---- the pitch helix ----
      const hx = narrow ? W / 2 : W * 0.26;
      const R = narrow ? Math.min(W * 0.3, 110) : Math.min(W * 0.17, 130);
      const hTop = narrow ? 52 : 60;
      const hBot = narrow ? H * 0.52 : H - 40;
      const turn = (hBot - hTop - R * 0.7) / K; // height per octave
      const P = (oct: number): [number, number, number] => {
        const th = 2 * Math.PI * (oct - Math.floor(oct));
        // C at the front; the spiral climbs as pitch rises
        return [hx + R * Math.sin(th), hBot - R * 0.35 - oct * turn + R * 0.32 * Math.cos(th), Math.cos(th)];
      };
      // back half first, dim; front half bright
      for (const front of [false, true]) {
        const path = new Path2D();
        let pen = false;
        for (let i = 0; i <= K * 96; i++) {
          const oct = i / 96;
          const [x, y, z] = P(oct);
          if (z >= 0 === front) {
            if (!pen) path.moveTo(x, y);
            else path.lineTo(x, y);
            pen = true;
          } else pen = false;
        }
        glowStroke(g, path, [122, 162, 255], 0.9, front ? 0.32 : 0.12);
      }
      // pitch class names around the top turn
      for (let i = 0; i < 12; i++) {
        const th = (2 * Math.PI * i) / 12;
        const x = hx + (R + 16) * Math.sin(th);
        // a ring just above the top turn, never closer than 16 px to the edge
        const y = Math.max(16, hTop + R * 0.2 + (R * 0.32 + 8) * Math.cos(th) - 14);
        const on = Math.round(chroma() * 12) % 12 === i;
        text(g, NOTE[i], x, y, {
          size: on ? 12.5 : 10,
          align: "center",
          color: on ? rgba(mix(col, WHITE, 0.3), 1) : "rgba(150,160,190,0.5)",
          weight: on ? 700 : 500,
        });
      }
      // the components, all on one spoke
      for (let k = 0; k < K; k++) {
        const x = xs(k);
        const oct = K * x;
        const [px, py, z] = P(oct);
        glowDot(g, px, py, 3 + 2.5 * env(x), col, (0.2 + 0.8 * env(x)) * (z >= 0 ? 1 : 0.55));
      }

      // ---- the spectrum ----
      const sx0 = narrow ? 18 : W * 0.52;
      const sx1 = W - 16;
      const sy1 = H - 34;
      const sy0 = narrow ? H * 0.62 : 52;
      const lx = (oct: number): number => sx0 + (oct / K) * (sx1 - sx0);
      // envelope
      const ep = new Path2D();
      for (let i = 0; i <= 120; i++) {
        const x = i / 120;
        const y = sy1 - env(x) * (sy1 - sy0 - 16);
        if (i === 0) ep.moveTo(lx(x * K), y);
        else ep.lineTo(lx(x * K), y);
      }
      g.save();
      g.setLineDash([4, 5]);
      g.strokeStyle = "rgba(122,162,255,0.45)";
      g.stroke(ep);
      g.restore();
      for (let o = 0; o <= K; o++) {
        const x = lx(o);
        vline(g, x, sy0, sy1, "rgba(122,162,255,0.06)");
        if (!narrow || o % 2 === 0) {
          const f = FMIN * Math.pow(2, o);
          text(g, f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : `${Math.round(f)}`, x, sy1 + 14, {
            size: 9,
            align: o === 0 ? "left" : o === K ? "right" : "center",
            color: "rgba(150,160,190,0.55)",
            mono: true,
          });
        }
      }
      for (let k = 0; k < K; k++) {
        const x = xs(k);
        const p = new Path2D();
        const lxx = lx(x * K);
        p.moveTo(lxx, sy1);
        p.lineTo(lxx, sy1 - env(x) * (sy1 - sy0 - 16));
        glowStroke(g, p, col, 1.3, (playing ? 0.95 : 0.6) * (0.25 + 0.75 * env(x)));
      }
      text(g, "the same note in every octave, under a fixed envelope (Hz)", sx0, sy0 - 10, { size: 10, color: "rgba(180,188,210,0.8)" });
    },
    dispose() {
      setPlaying(false);
    },
  };
}
