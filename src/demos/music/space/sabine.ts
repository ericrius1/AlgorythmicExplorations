// Fig: Sabine's experiment. A plaster hall whose floor you can cover with
// seated audience; its reverberation time at 500 Hz from Sabine's and
// Eyring's formulas, and the measured decay of the impulse response the
// figure builds. Sound an organ pipe at 512 Hz (Sabine's test tone), stop it,
// and time the room to −60 dB.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { buildIR, decayCurve } from "./ir";
import { absorption, blendMaterial, eyring, sabine, surfaceArea, volume, type Room } from "./room";
import { clapSamples, sampleRate } from "./sound";
import { RoomVoice, SC, irBuffer, label, monoBuffer, playGate, roundRect, smallButton, stage, ui, narrowScreen } from "./kit";

const BAND = 2; // 500 Hz, the octave nearest Sabine's 512 Hz pipe

function hall(V: number, cover: number): Room {
  // proportions 2 : 1.4 : 1, like a long lecture hall
  const H = Math.cbrt(V / 2.8);
  const floor = blendMaterial("woodfloor", "audience", cover);
  return { L: 2 * H, W: 1.4 * H, H, surf: ["plaster", "plaster", "plaster", "plaster", floor, "plaster"] };
}

// A 512 Hz organ-pipe-ish tone: a few harmonics with a soft attack, held,
// then cut, so the room's decay is all you hear after it stops.
function pipe(fs: number, hold: number): Float32Array {
  const n = Math.floor((hold + 0.02) * fs);
  const x = new Float32Array(n);
  const f = 512;
  const amps = [1, 0.45, 0.22, 0.1];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const env = Math.min(1, t / 0.05) * Math.min(1, (hold + 0.02 - t) / 0.012);
    let v = 0;
    for (let k = 0; k < amps.length; k++) v += amps[k] * Math.sin(2 * Math.PI * f * (k + 1) * t);
    x[i] = 0.32 * env * v;
  }
  return x;
}

export function mountSabine(container: HTMLElement): Demo {
  const shell = new Shell(container, narrowScreen() ? 1.3 : 0.56);
  const cv = shell.canvas;
  const g = cv.getContext("2d")!;
  const wrap = stage(shell);
  let V = 1200;
  let cover = 0;
  let room = hall(V, cover);
  let curve: Float32Array | null = null;
  let curveStep = 0.005;
  let voice: RoomVoice | null = null;
  let pipeBuf: AudioBuffer | null = null;
  let clapBuf: AudioBuffer | null = null;
  let soundOn = false;
  let irDirty = true;
  let stopAt = -1; // page time (s) when the tone stopped, for the stopwatch
  let pending = 0;
  const HOLD = 1.2;

  const rebuild = (): void => {
    const fs = voice ? sampleRate() : 48000;
    const ir = buildIR(room, { x: room.L * 0.2, y: room.W * 0.5, z: 1.6 }, { pos: { x: room.L * 0.7, y: room.W * 0.42, z: 1.2 }, yaw: 0 }, { fs, binaural: false, maxLength: 7 });
    curve = decayCurve(ir.ch[0], fs, BAND, curveStep);
    if (voice) {
      voice.setIR(irBuffer(ir, fs, 0.9), 0.05);
      irDirty = false;
    }
  };
  const schedule = (): void => {
    clearTimeout(pending);
    pending = window.setTimeout(() => {
      rebuild();
    }, 120);
  };

  const sound = (which: "pipe" | "clap"): void => {
    if (!voice || !pipeBuf || !clapBuf) return;
    if (irDirty) rebuild();
    const now = performance.now() / 1000;
    if (which === "pipe") {
      voice.fire(pipeBuf, 0.8);
      stopAt = now + HOLD + 0.01;
    } else {
      voice.fire(clapBuf, 0.9);
      stopAt = now + 0.02;
    }
  };

  const start = (): void => {
    if (!voice) {
      voice = new RoomVoice();
      const fs = sampleRate();
      pipeBuf = monoBuffer(pipe(fs, HOLD), fs);
      clapBuf = monoBuffer(clapSamples(fs), fs);
      irDirty = true;
    }
    voice.fadeTo(1, 0.04);
    soundOn = true;
    sound("pipe");
  };
  const gate = playGate(wrap, "Tap to sound the pipe", "a 512 Hz organ pipe, held, then stopped", start);
  const guard = frameGuard(() => {
    if (!soundOn) return;
    soundOn = false;
    voice?.fadeTo(0, 0.1);
    stopAt = -1;
    gate.show("Tap to listen again");
  });

  shell.slider({
    label: "hall volume",
    min: 60,
    max: 20000,
    step: 10,
    log: true,
    value: V,
    format: (v) => `${Math.round(v).toLocaleString("en-US")} m³`,
    onInput: (v) => {
      V = v;
      room = hall(V, cover);
      irDirty = true;
      schedule();
    },
  });
  shell.slider({
    label: "floor covered by audience",
    min: 0,
    max: 1,
    step: 0.01,
    value: cover,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      cover = v;
      room = hall(V, cover);
      irDirty = true;
      schedule();
    },
  });
  smallButton(shell.controls, "▶ organ pipe", () => (soundOn ? sound("pipe") : gate.el.click()));
  smallButton(shell.controls, "▶ clap", () => {
    if (!soundOn) gate.el.click();
    else sound("clap");
  });

  rebuild();

  shell.setInfo(() => {
    const A = absorption(room)[BAND];
    return `V = ${Math.round(volume(room))} m³ · S = ${Math.round(surfaceArea(room))} m² · A = ${A.toFixed(1)} m² at 500 Hz · ${room.L.toFixed(1)} × ${room.W.toFixed(1)} × ${room.H.toFixed(1)} m`;
  });

  return {
    frame() {
      guard.pulse();
      shell.tick();
      const d = ui(cv);
      const Wc = cv.width;
      const Hc = cv.height;
      g.fillStyle = SC.bg;
      g.fillRect(0, 0, Wc, Hc);
      const narrow = Wc / d < 560;
      const pad = 16 * d;
      const Ts = sabine(room)[BAND];
      const Te = eyring(room)[BAND];

      // ---- left: T against coverage, for this volume ----
      const lw = narrow ? Wc - pad * 2 : Wc * 0.4;
      const lh = narrow ? Hc * 0.42 : Hc - pad * 2;
      const gx = pad + 34 * d;
      const gy = pad + 34 * d;
      const gwid = lw - 44 * d;
      const ght = lh - 70 * d;
      const Tmax = Math.max(2, Math.ceil(sabine(hall(V, 0))[BAND] * 1.1));
      g.fillStyle = "#0b0d14";
      roundRect(g, pad, pad, lw, lh, 8 * d);
      g.fill();
      label(g, "reverberation time at 500 Hz", pad + 12 * d, pad + 15 * d, 11 * d, SC.muted);
      g.strokeStyle = "rgba(150,160,200,0.12)";
      g.lineWidth = d;
      const tStep = Tmax > 6 ? 2 : 1;
      for (let t = 0; t <= Tmax; t += tStep) {
        const y = gy + ght - (t / Tmax) * ght;
        g.beginPath();
        g.moveTo(gx, y);
        g.lineTo(gx + gwid, y);
        g.stroke();
        label(g, `${t} s`, gx - 6 * d, y, 9.5 * d, SC.muted, "right", 500, true);
      }
      for (const c of [0, 0.5, 1]) label(g, `${Math.round(c * 100)}%`, gx + c * gwid, gy + ght + 12 * d, 9.5 * d, SC.muted, c === 0 ? "left" : c === 1 ? "right" : "center", 500, true);
      label(g, "floor covered by audience", gx + gwid / 2, gy + ght + 27 * d, 10 * d, SC.muted, "center");
      const plot = (fn: (r: Room) => number[], col: string, dash: number[]): void => {
        g.strokeStyle = col;
        g.lineWidth = 2 * d;
        g.setLineDash(dash.map((v) => v * d));
        g.beginPath();
        for (let i = 0; i <= 50; i++) {
          const c = i / 50;
          const t = fn(hall(V, c))[BAND];
          const x = gx + c * gwid;
          const y = gy + ght - Math.min(1.05, t / Tmax) * ght;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
        g.setLineDash([]);
      };
      plot(sabine, "#ffb86b", []);
      plot(eyring, "#7aa2ff", [5, 4]);
      const cx = gx + cover * gwid;
      const cy = gy + ght - Math.min(1.05, Ts / Tmax) * ght;
      g.save();
      g.shadowColor = "#ffb86b";
      g.shadowBlur = 12 * d;
      g.fillStyle = "#ffd9a8";
      g.beginPath();
      g.arc(cx, cy, 5 * d, 0, Math.PI * 2);
      g.fill();
      g.restore();
      label(g, "Sabine", gx + gwid - 4 * d, gy + 4 * d, 10 * d, "#ffb86b", "right");
      label(g, "Eyring", gx + gwid - 4 * d, gy + 18 * d, 10 * d, "#7aa2ff", "right");

      // ---- right: the measured decay and a stopwatch ----
      const rx = narrow ? pad : pad * 2 + lw;
      const ry = narrow ? pad * 2 + lh : pad;
      const rw = Wc - rx - pad;
      const rh = Hc - ry - pad;
      g.fillStyle = "#0b0d14";
      roundRect(g, rx, ry, rw, rh, 8 * d);
      g.fill();
      const big = narrow ? 22 : 30;
      label(g, `T = ${Ts.toFixed(2)} s`, rx + 14 * d, ry + 24 * d, big * d, "#ffe2c2", "left", 700);
      label(g, `Sabine: 0.161 V / A  ·  Eyring: ${Te.toFixed(2)} s`, rx + 14 * d, ry + (big + 24) * d, 10.5 * d, SC.muted, "left", 500, true);
      const px0 = rx + 40 * d;
      const py0 = ry + (big + 46) * d;
      const pw = rw - 54 * d;
      const ph = rh - (big + 46) * d - 30 * d;
      const tSpan = Math.max(1, Math.ceil(Math.max(Ts, Te) * 1.25));
      const dbMin = -70;
      g.strokeStyle = "rgba(150,160,200,0.12)";
      g.lineWidth = d;
      for (let db = 0; db >= dbMin; db -= 20) {
        const y = py0 + (db / dbMin) * ph;
        g.beginPath();
        g.moveTo(px0, y);
        g.lineTo(px0 + pw, y);
        g.stroke();
        label(g, `${db} dB`, px0 - 6 * d, y, 9.5 * d, SC.muted, "right", 500, true);
      }
      const ts = tSpan > 4 ? 2 : tSpan > 2 ? 1 : 0.5;
      for (let t = 0; t <= tSpan + 1e-6; t += ts) label(g, `${t} s`, px0 + (t / tSpan) * pw, py0 + ph + 12 * d, 9.5 * d, SC.muted, "center", 500, true);
      // −60 dB line
      const y60 = py0 + (-60 / dbMin) * ph;
      g.strokeStyle = "rgba(255,143,107,0.5)";
      g.setLineDash([4 * d, 4 * d]);
      g.beginPath();
      g.moveTo(px0, y60);
      g.lineTo(px0 + pw, y60);
      g.stroke();
      g.setLineDash([]);
      label(g, "−60 dB", px0 + pw - 2 * d, y60 - 8 * d, 9.5 * d, "rgba(255,160,130,0.85)", "right", 600, true);
      // Sabine's straight-line prediction
      g.strokeStyle = "rgba(255,184,107,0.45)";
      g.lineWidth = 1.5 * d;
      g.beginPath();
      g.moveTo(px0, py0);
      g.lineTo(px0 + Math.min(1, (Ts * (-dbMin / 60)) / tSpan) * pw, py0 + Math.min(1, tSpan / (Ts * (-dbMin / 60))) * ph);
      g.stroke();
      // the impulse response's measured decay (Schroeder integration)
      if (curve) {
        g.save();
        g.shadowColor = "#7de0b0";
        g.shadowBlur = 8 * d;
        g.strokeStyle = "#7de0b0";
        g.lineWidth = 2 * d;
        g.beginPath();
        for (let i = 0; i < curve.length; i++) {
          const t = i * curveStep;
          if (t > tSpan) break;
          const v = Math.max(dbMin, curve[i]);
          const x = px0 + (t / tSpan) * pw;
          const y = py0 + (v / dbMin) * ph;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
          if (v <= dbMin) break;
        }
        g.stroke();
        g.restore();
      }
      label(g, "measured decay of the room's impulse response", px0 + 6 * d, py0 + ph - 10 * d, 9.5 * d, "rgba(125,224,176,0.8)", "left");
      // stopwatch
      const now = performance.now() / 1000;
      if (soundOn && stopAt > 0) {
        const t = now - stopAt;
        if (t < 0) {
          label(g, "pipe sounding…", rx + rw - 14 * d, ry + 24 * d, 12 * d, "#ffd9a8", "right", 600);
        } else {
          const shown = Math.min(t, Ts);
          const x = px0 + Math.min(1, shown / tSpan) * pw;
          const db = Math.max(dbMin, (-60 * shown) / Ts);
          g.fillStyle = "#fff";
          g.beginPath();
          g.arc(x, py0 + (db / dbMin) * ph, 4.5 * d, 0, Math.PI * 2);
          g.fill();
          label(g, `⏱ ${shown.toFixed(2)} s${t >= Ts ? "  (−60 dB)" : ""}`, rx + rw - 14 * d, ry + 24 * d, 13 * d, t >= Ts ? "#ff9f7a" : "#ffe2c2", "right", 700, true);
          if (t > Ts + 2.5) stopAt = -1;
        }
      }
    },
  };
}
