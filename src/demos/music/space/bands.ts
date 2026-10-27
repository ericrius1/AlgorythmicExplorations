// Fig: six bands, six clocks. Pick a room and its materials; each octave band
// decays at its own rate, set by how much those materials absorb at that
// frequency. Top: absorption coefficients of the chosen surfaces. Bottom
// left: the decay of each band in the room's impulse response. Bottom right:
// reverberation time per band, predicted (Eyring) and measured.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { buildIR, decayCurve } from "./ir";
import { BAND_NAMES, MATERIALS, eyring, material, volume, type Room } from "./room";
import { clapSamples, malletPhrase, sampleRate, sittingVoice } from "./sound";
import { RoomVoice, SC, irBuffer, label, monoBuffer, playGate, roundRect, segmented, smallButton, stage, ui, narrowScreen } from "./kit";

interface Preset {
  name: string;
  L: number;
  W: number;
  H: number;
  walls: string;
  floor: string;
  ceiling: string;
}

export const ROOM_PRESETS: Record<string, Preset> = {
  bathroom: { name: "tiled bathroom", L: 2.6, W: 2, H: 2.4, walls: "tile", floor: "tile", ceiling: "drywall" },
  living: { name: "living room", L: 5.5, W: 4, H: 2.6, walls: "drywall", floor: "carpet", ceiling: "drywall" },
  booth: { name: "vocal booth", L: 2.4, W: 2, H: 2.4, walls: "acoustic", floor: "carpet", ceiling: "acoustic" },
  stairwell: { name: "stairwell", L: 3.5, W: 3, H: 14, walls: "concrete", floor: "concrete", ceiling: "concrete" },
  hall: { name: "concert hall", L: 42, W: 26, H: 18, walls: "wood", floor: "audience", ceiling: "plaster" },
  cathedral: { name: "stone church", L: 70, W: 28, H: 26, walls: "brick", floor: "wood", ceiling: "plaster" },
};
type PresetId = keyof typeof ROOM_PRESETS;

function select(parent: HTMLElement, text: string, value: string, onPick: (v: string) => void): HTMLSelectElement {
  const wrap = document.createElement("label");
  wrap.className = "mp-select";
  const cap = document.createElement("span");
  cap.textContent = text;
  const s = document.createElement("select");
  for (const m of MATERIALS) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name;
    s.appendChild(o);
  }
  s.value = value;
  s.addEventListener("change", () => onPick(s.value));
  wrap.append(cap, s);
  parent.appendChild(wrap);
  return s;
}

export function mountBands(container: HTMLElement): Demo {
  const shell = new Shell(container, narrowScreen() ? 1.4 : 0.6);
  const cv = shell.canvas;
  const g = cv.getContext("2d")!;
  const wrap = stage(shell);
  let preset: PresetId = "living";
  let p = { ...ROOM_PRESETS[preset] };
  const room = (): Room => ({ L: p.L, W: p.W, H: p.H, surf: [p.walls, p.walls, p.walls, p.walls, p.floor, p.ceiling] });
  let curves: Float32Array[] = [];
  let measured: number[] = [];
  const step = 0.005;
  let voice: RoomVoice | null = null;
  const bufs: Record<string, AudioBuffer> = {};
  let soundOn = false;
  let irDirty = true;
  let lastSound: "clap" | "voice" | "mallet" = "clap";

  const rebuild = (): void => {
    const fs = voice ? sampleRate() : 48000;
    const r = room();
    const ir = buildIR(r, { x: r.L * 0.25, y: r.W * 0.4, z: Math.min(1.5, r.H * 0.5) }, { pos: { x: r.L * 0.7, y: r.W * 0.6, z: Math.min(1.6, r.H * 0.55) }, yaw: 0 }, { fs, binaural: !!voice, maxLength: 9 });
    curves = [0, 1, 2, 3, 4, 5].map((b) => decayCurve(ir.ch[0], fs, b, step));
    // T30: the slope between −5 and −35 dB, extended to 60 dB
    measured = curves.map((c) => {
      let i5 = -1;
      let i35 = -1;
      for (let i = 0; i < c.length; i++) {
        if (i5 < 0 && c[i] < -5) i5 = i;
        if (i35 < 0 && c[i] < -35) {
          i35 = i;
          break;
        }
      }
      return i5 >= 0 && i35 > i5 ? (i35 - i5) * step * 2 : NaN;
    });
    if (voice) {
      voice.setIR(irBuffer(ir, fs, 1), 0.08);
      irDirty = false;
    }
  };

  const play = (which: "clap" | "voice" | "mallet"): void => {
    if (!voice) return;
    if (irDirty) rebuild();
    lastSound = which;
    voice.fire(bufs[which], which === "clap" ? 0.9 : 0.75);
  };

  const start = (): void => {
    if (!voice) {
      voice = new RoomVoice();
      const fs = sampleRate();
      bufs.clap = monoBuffer(clapSamples(fs), fs);
      bufs.voice = monoBuffer(sittingVoice(fs), fs);
      bufs.mallet = monoBuffer(malletPhrase(fs), fs);
      irDirty = true;
    }
    voice.fadeTo(1, 0.04);
    soundOn = true;
    play(lastSound);
  };
  const gate = playGate(wrap, "Tap to listen", "a clap in this room, then try the others", start);
  const guard = frameGuard(() => {
    if (!soundOn) return;
    soundOn = false;
    voice?.fadeTo(0, 0.1);
    gate.show("Tap to listen again");
  });

  const changed = (): void => {
    irDirty = true;
    rebuild();
    if (soundOn) play(lastSound);
  };
  const names = Object.fromEntries(Object.entries(ROOM_PRESETS).map(([k, v]) => [k, v.name])) as Record<PresetId, string>;
  segmented<PresetId>(shell.controls, "room", Object.keys(ROOM_PRESETS) as PresetId[], preset, (v) => {
    preset = v;
    p = { ...ROOM_PRESETS[v] };
    sw.value = p.walls;
    sf.value = p.floor;
    sc.value = p.ceiling;
    changed();
  }, names);
  const brk = document.createElement("span");
  brk.className = "mp-break";
  shell.controls.appendChild(brk);
  const sw = select(shell.controls, "walls", p.walls, (v) => ((p.walls = v), changed()));
  const sf = select(shell.controls, "floor", p.floor, (v) => ((p.floor = v), changed()));
  const sc = select(shell.controls, "ceiling", p.ceiling, (v) => ((p.ceiling = v), changed()));
  const brk2 = document.createElement("span");
  brk2.className = "mp-break";
  shell.controls.appendChild(brk2);
  for (const k of ["clap", "voice", "mallet"] as const)
    smallButton(shell.controls, `▶ ${k}`, () => {
      lastSound = k;
      if (!soundOn) gate.el.click();
      else play(k);
    });

  rebuild();
  shell.setInfo(() => `${p.L} × ${p.W} × ${p.H} m · ${Math.round(volume(room())).toLocaleString("en-US")} m³ · T at 500 Hz ${eyring(room())[2].toFixed(2)} s, at 4 kHz ${eyring(room())[5].toFixed(2)} s`);

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
      const pad = 14 * d;
      const r = room();
      const T = eyring(r);

      // ---- absorption of each surface group ----
      const topH = (narrow ? 86 : 96) * d;
      const groups: [string, string][] = [
        ["walls", p.walls],
        ["floor", p.floor],
        ["ceiling", p.ceiling],
      ];
      const gw = (Wc - pad * 4) / 3;
      groups.forEach(([name, id], k) => {
        const x = pad + k * (gw + pad);
        const y = pad;
        g.fillStyle = "#0b0d14";
        roundRect(g, x, y, gw, topH, 8 * d);
        g.fill();
        const m = material(id);
        g.fillStyle = m.color;
        g.fillRect(x + 10 * d, y + 10 * d, 8 * d, 8 * d);
        label(g, narrow ? m.name : `${name}: ${m.name}`, x + 24 * d, y + 14 * d, (narrow ? 9.5 : 11) * d, SC.text, "left", 600);
        const bx = x + 10 * d;
        const by = y + 28 * d;
        const bw = gw - 20 * d;
        const bh = topH - 50 * d;
        const one = bw / 6;
        for (let b = 0; b < 6; b++) {
          const a = m.alpha[b];
          g.fillStyle = "rgba(150,160,200,0.08)";
          g.fillRect(bx + b * one + one * 0.15, by, one * 0.7, bh);
          g.fillStyle = SC.bands[b];
          g.fillRect(bx + b * one + one * 0.15, by + bh * (1 - a), one * 0.7, bh * a);
          if (!narrow || b === 0 || b === 5) label(g, BAND_NAMES[b], bx + b * one + one / 2, by + bh + 10 * d, 8.5 * d, SC.muted, "center", 500, true);
        }
        if (k === 0) label(g, "absorbed", bx + bw, by - 6 * d, 8.5 * d, SC.muted, "right", 500);
      });

      // ---- decay curves ----
      const cy = pad * 2 + topH;
      const ch = Hc - cy - pad;
      const cw = narrow ? Wc - pad * 2 : Wc * 0.64;
      const plotH = narrow ? ch * 0.56 : ch;
      g.fillStyle = "#0b0d14";
      roundRect(g, pad, cy, cw, plotH, 8 * d);
      g.fill();
      const px0 = pad + 44 * d;
      const py0 = cy + 24 * d;
      const pw = cw - 56 * d;
      const ph = plotH - 48 * d;
      const Tm = Math.max(...T);
      const tSpan = Tm < 0.4 ? 0.5 : Tm < 0.9 ? 1 : Tm < 1.8 ? 2 : Tm < 4 ? 4 : Tm < 8 ? 8 : 12;
      const dbMin = -60;
      label(g, "how each band dies away", pad + 12 * d, cy + 12 * d, 10.5 * d, SC.muted);
      g.strokeStyle = "rgba(150,160,200,0.12)";
      g.lineWidth = d;
      for (let db = 0; db >= dbMin; db -= 20) {
        const y = py0 + (db / dbMin) * ph;
        g.beginPath();
        g.moveTo(px0, y);
        g.lineTo(px0 + pw, y);
        g.stroke();
        label(g, `${db} dB`, px0 - 6 * d, y, 9 * d, SC.muted, "right", 500, true);
      }
      for (let i = 0; i <= 4; i++) {
        const t = (tSpan * i) / 4;
        label(g, `${t < 1 ? Math.round(t * 1000) + " ms" : t + " s"}`, px0 + (i / 4) * pw, py0 + ph + 12 * d, 9 * d, SC.muted, "center", 500, true);
      }
      curves.forEach((c, b) => {
        g.strokeStyle = SC.bands[b];
        g.lineWidth = 1.8 * d;
        g.beginPath();
        for (let i = 0; i < c.length; i++) {
          const t = i * step;
          if (t > tSpan) break;
          const v = Math.max(dbMin, c[i]);
          const x = px0 + (t / tSpan) * pw;
          const y = py0 + (v / dbMin) * ph;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
          if (v <= dbMin) break;
        }
        g.stroke();
      });

      // ---- reverberation time per band ----
      const bx0 = narrow ? pad : pad * 2 + cw;
      const by0 = narrow ? cy + plotH + pad : cy;
      const bw = narrow ? Wc - pad * 2 : Wc - bx0 - pad;
      const bh = narrow ? ch - plotH - pad : ch;
      g.fillStyle = "#0b0d14";
      roundRect(g, bx0, by0, bw, bh, 8 * d);
      g.fill();
      label(g, "T60 per band", bx0 + 12 * d, by0 + 12 * d, 10.5 * d, SC.muted);
      const tTop = Math.max(...T, ...measured.filter((v) => isFinite(v))) * 1.15;
      const one = (bw - 24 * d) / 6;
      const baseY = by0 + bh - 20 * d;
      const hh = bh - 56 * d;
      for (let b = 0; b < 6; b++) {
        const x = bx0 + 12 * d + b * one;
        const h = (T[b] / tTop) * hh;
        g.fillStyle = SC.bands[b];
        g.globalAlpha = 0.85;
        g.fillRect(x + one * 0.18, baseY - h, one * 0.64, h);
        g.globalAlpha = 1;
        const m = measured[b];
        if (isFinite(m)) {
          const y = baseY - (m / tTop) * hh;
          g.strokeStyle = "#fff";
          g.lineWidth = 2 * d;
          g.beginPath();
          g.moveTo(x + one * 0.1, y);
          g.lineTo(x + one * 0.9, y);
          g.stroke();
        }
        label(g, T[b].toFixed(T[b] < 1 ? 2 : 1), x + one / 2, baseY - h - 9 * d, 9 * d, SC.text, "center", 600, true);
        label(g, BAND_NAMES[b], x + one / 2, baseY + 10 * d, 9 * d, SC.muted, "center", 500, true);
      }
      label(g, "bars: Eyring  ·  white: measured", bx0 + bw - 10 * d, by0 + 12 * d, 9 * d, SC.muted, "right", 500);
      label(g, "seconds", bx0 + 12 * d, by0 + 28 * d, 9 * d, SC.muted, "left", 500, true);
    },
  };
}
