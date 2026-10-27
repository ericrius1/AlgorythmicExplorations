// Fig: bass in a box. Below a few hundred hertz a room behaves like a set of
// resonators: its standing waves, or modes. The map shows how loud a bass
// tone from the speaker is at every spot at ear height; the curve below is
// the response where the listener stands. Drag either one, change the note,
// or sweep. Computed as a modal sum (Kuttruff, Room Acoustics, ch. 3).

import { Shell, type Demo } from "../../../lib/demoShell";
import { Tone, frameGuard } from "../../../lib/audio";
import { eyring, modes, schroederFreq, volume, type Mode, type Room } from "./room";
import { rawCtx, spaceOut } from "./sound";
import { Plan, SC, dragger, drawHead, drawSource, label, playGate, roundRect, smallButton, stage, ui, type P2, narrowScreen } from "./kit";

const ROOM: Room = { L: 5.2, W: 3.8, H: 2.6, surf: ["drywall", "drywall", "drywall", "drywall", "woodfloor", "drywall"] };
const FMIN = 20;
const FMAX = 250;
const GX = 72;
const GY = 54;
const EAR = 1.2;

// Move a Shell slider from code (the Shell only updates it on input).
function setSlider(input: HTMLInputElement, raw: number, text: string): void {
  input.value = String(raw);
  const lo = Number(input.min);
  const hi = Number(input.max);
  input.style.setProperty("--fill", `${((raw - lo) / (hi - lo || 1)) * 100}%`);
  const v = input.parentElement?.querySelector(".demo-slider-value");
  if (v) v.textContent = text;
}

interface Coef {
  m: Mode;
  re: number;
  im: number;
}

export function mountModes(container: HTMLElement): Demo {
  const shell = new Shell(container, narrowScreen() ? 1.05 : 0.66);
  const cv = shell.canvas;
  const g = cv.getContext("2d")!;
  const wrap = stage(shell);
  const ms = modes(ROOM, 400);
  const T = eyring(ROOM)[0]; // the 125 Hz band stands in for the bass
  const delta = 6.91 / T; // amplitude decay rate, 1/s
  const fs = schroederFreq(T, volume(ROOM));
  let src: P2 = { x: 0.35, y: 0.35 };
  let lis: P2 = { x: 3.1, y: 1.9 };
  let freq = 64;
  let sweeping = false;
  let sweepT0 = 0;
  const plan = new Plan(ROOM.L, ROOM.W);
  const field = new Float32Array(GX * GY);
  const img = document.createElement("canvas");
  img.width = GX;
  img.height = GY;
  const ig = img.getContext("2d")!;
  const idata = ig.createImageData(GX, GY);
  let response = new Float32Array(0);
  let respMax = 1;
  let fieldDirty = true;
  let osc: OscillatorNode | null = null;
  let amp: GainNode | null = null;
  let fader: GainNode | null = null;
  let soundOn = false;

  const shape = (m: Mode, x: number, y: number, z: number): number =>
    Math.cos((m.n[0] * Math.PI * x) / ROOM.L) * Math.cos((m.n[1] * Math.PI * y) / ROOM.W) * Math.cos((m.n[2] * Math.PI * z) / ROOM.H);
  // modes with a zero index have half the norm of the others in that direction
  const norm = (m: Mode): number => m.n.reduce((a, k) => a * (k ? 0.5 : 1), 1);

  const coefs = (f: number): Coef[] => {
    const w = 2 * Math.PI * f;
    return ms.map((m) => {
      const wm = 2 * Math.PI * m.f;
      const s = shape(m, src.x, src.y, 0.3) / norm(m);
      // 1 / (ωm² − ω² + 2jδω)
      const a = wm * wm - w * w;
      const b = 2 * delta * w;
      const den = a * a + b * b;
      return { m, re: (s * a) / den, im: (-s * b) / den };
    });
  };

  const pressureAt = (cs: Coef[], x: number, y: number): number => {
    let re = 0;
    let im = 0;
    for (const c of cs) {
      const v = shape(c.m, x, y, EAR);
      re += c.re * v;
      im += c.im * v;
    }
    return Math.hypot(re, im);
  };

  const computeResponse = (): void => {
    const n = 230;
    response = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = FMIN * Math.pow(FMAX / FMIN, i / (n - 1));
      response[i] = pressureAt(coefs(f), lis.x, lis.y);
    }
    // reference: the loudest point anywhere on the curve, over the whole plan average
    respMax = Math.max(...response);
  };

  // cosine tables per axis, so the map is a sum of products
  const maxN = ms.reduce((a, m) => Math.max(a, ...m.n), 0) + 1;
  const tabX = Array.from({ length: maxN }, (_, k) => Float32Array.from({ length: GX }, (_, i) => Math.cos((k * Math.PI * ((i + 0.5) / GX) * ROOM.L) / ROOM.L)));
  const tabY = Array.from({ length: maxN }, (_, k) => Float32Array.from({ length: GY }, (_, j) => Math.cos((k * Math.PI * ((j + 0.5) / GY) * ROOM.W) / ROOM.W)));
  const fre = new Float32Array(GX * GY);
  const fim = new Float32Array(GX * GY);
  const computeField = (): void => {
    const cs = coefs(freq);
    fre.fill(0);
    fim.fill(0);
    for (const c of cs) {
      const cz = Math.cos((c.m.n[2] * Math.PI * EAR) / ROOM.H);
      const cr = c.re * cz;
      const ci = c.im * cz;
      const tx = tabX[c.m.n[0]];
      const ty = tabY[c.m.n[1]];
      for (let j = 0; j < GY; j++) {
        const yr = cr * ty[j];
        const yi = ci * ty[j];
        const row = j * GX;
        for (let i = 0; i < GX; i++) {
          fre[row + i] += yr * tx[i];
          fim[row + i] += yi * tx[i];
        }
      }
    }
    let mx = 1e-30;
    for (let k = 0; k < field.length; k++) {
      field[k] = Math.hypot(fre[k], fim[k]);
      mx = Math.max(mx, field[k]);
    }
    const data = idata.data;
    for (let k = 0; k < field.length; k++) {
      const db = 20 * Math.log10(field[k] / mx + 1e-9);
      const t = Math.max(0, 1 + db / 30); // 30 dB range
      const r = 10 + 245 * Math.pow(t, 1.6);
      const gg = 12 + 160 * Math.pow(t, 1.3) * (0.6 + 0.4 * t);
      const b = 30 + 150 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (1 - t * 0.5);
      data[k * 4] = r;
      data[k * 4 + 1] = gg;
      data[k * 4 + 2] = b;
      data[k * 4 + 3] = 255;
    }
    ig.putImageData(idata, 0, 0);
    fieldDirty = false;
  };

  const levelHere = (): number => pressureAt(coefs(freq), lis.x, lis.y) / respMax;

  const updateGain = (): void => {
    if (!amp) return;
    const t = rawCtx().currentTime;
    // keep the loudest peak at a safe level; everything else relative to it
    amp.gain.setTargetAtTime(0.5 * Math.min(1, levelHere()), t, 0.04);
    osc!.frequency.setTargetAtTime(freq, t, 0.02);
  };

  const start = (): void => {
    const ctx = rawCtx();
    if (!osc) {
      osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      amp = ctx.createGain();
      amp.gain.value = 0;
      fader = ctx.createGain();
      fader.gain.value = 0;
      osc.connect(amp);
      amp.connect(fader);
      Tone.connect(fader, spaceOut());
      osc.start();
    }
    fader!.gain.setTargetAtTime(1, ctx.currentTime, 0.08);
    soundOn = true;
    updateGain();
  };
  const gate = playGate(wrap, "Tap to play the bass note", "headphones help: laptop speakers can't play this low", start);
  const silence = (): void => {
    if (!soundOn) return;
    soundOn = false;
    sweeping = false;
    fader?.gain.setTargetAtTime(0, rawCtx().currentTime, 0.06);
    gate.show("Tap to play again");
  };
  const guard = frameGuard(silence);

  const fSlider = shell.slider({
    label: "note",
    min: 25,
    max: 200,
    step: 1,
    log: true,
    value: freq,
    format: (v) => `${Math.round(v)} Hz`,
    onInput: (v) => {
      freq = v;
      sweeping = false;
      fieldDirty = true;
      updateGain();
    },
  });
  smallButton(shell.controls, "▶ sweep 25–200 Hz", () => {
    if (!soundOn) gate.el.click();
    sweeping = true;
    sweepT0 = performance.now() / 1000;
  });
  smallButton(shell.controls, "stop", silence);

  dragger(cv, () => [
    { pos: () => plan.px(lis), move: (p) => ((lis = plan.clampIn(plan.m(p.x, p.y), 0.1)), computeResponse(), updateGain()), r: 26 },
    { pos: () => plan.px(src), move: (p) => ((src = plan.clampIn(plan.m(p.x, p.y), 0.1)), computeResponse(), (fieldDirty = true), updateGain()), r: 22 },
  ]);

  computeResponse();
  const axial = ms.filter((m) => m.kind === "axial" && m.f < FMAX);

  shell.setInfo(() => {
    const near = ms.reduce((a, m) => (Math.abs(m.f - freq) < Math.abs(a.f - freq) ? m : a), ms[0]);
    return `${Math.round(freq)} Hz · ${(20 * Math.log10(levelHere())).toFixed(0)} dB here vs the loudest peak · nearest mode (${near.n.join(",")}) ${near.f.toFixed(1)} Hz ${near.kind} · Schroeder frequency ${Math.round(fs)} Hz`;
  });

  return {
    frame() {
      guard.pulse();
      shell.tick();
      if (sweeping) {
        const t = performance.now() / 1000 - sweepT0;
        const dur = 10;
        if (t > dur) sweeping = false;
        freq = 25 * Math.pow(200 / 25, Math.min(1, t / dur));
        setSlider(fSlider, Math.log10(freq), `${Math.round(freq)} Hz`);
        fieldDirty = true;
        updateGain();
      }
      if (fieldDirty) computeField();
      const d = ui(cv);
      const Wc = cv.width;
      const Hc = cv.height;
      g.fillStyle = SC.bg;
      g.fillRect(0, 0, Wc, Hc);
      const pad = 14 * d;
      const respH = Hc * 0.36;
      plan.fit(pad + 20 * d, pad + 16 * d, Wc - pad * 2 - 40 * d, Hc - respH - pad * 3 - 16 * d);
      const a = plan.px({ x: 0, y: 0 });
      const rw = ROOM.L * plan.s;
      const rh = ROOM.W * plan.s;
      g.save();
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, a.x, a.y, rw, rh);
      g.restore();
      g.strokeStyle = "rgba(230,235,250,0.85)";
      g.lineWidth = 3 * d;
      g.strokeRect(a.x, a.y, rw, rh);
      label(g, `loudness of a ${Math.round(freq)} Hz tone at ear height (30 dB from dark to bright)`, a.x, pad + 4 * d, 10.5 * d, SC.muted);
      label(g, `${ROOM.L} m`, a.x + rw / 2, a.y + rh + 11 * d, 9.5 * d, SC.muted, "center", 500, true);
      drawSource(g, plan.px(src), 6 * d, d, 0.3);
      drawHead(g, plan.px(lis), Math.PI, 9 * d, d, 0.6);

      // ---- response at the listener ----
      const ry = Hc - respH - pad;
      g.fillStyle = "#0b0d14";
      roundRect(g, pad, ry, Wc - pad * 2, respH, 8 * d);
      g.fill();
      const px0 = pad + 40 * d;
      const py0 = ry + 22 * d;
      const pw = Wc - pad * 2 - 54 * d;
      const ph = respH - 46 * d;
      const xOf = (f: number): number => px0 + (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * pw;
      const dbMin = -40;
      g.strokeStyle = "rgba(150,160,200,0.12)";
      g.lineWidth = d;
      for (let db = 0; db >= dbMin; db -= 10) {
        const y = py0 + (db / dbMin) * ph;
        g.beginPath();
        g.moveTo(px0, y);
        g.lineTo(px0 + pw, y);
        g.stroke();
        if (db % 20 === 0) label(g, `${db} dB`, px0 - 6 * d, y, 9 * d, SC.muted, "right", 500, true);
      }
      for (const f of [20, 30, 50, 100, 200]) label(g, `${f} Hz`, xOf(f), py0 + ph + 12 * d, 9 * d, SC.muted, "center", 500, true);
      // axial modes
      for (const m of axial) {
        const x = xOf(m.f);
        g.strokeStyle = "rgba(122,162,255,0.25)";
        g.beginPath();
        g.moveTo(x, py0);
        g.lineTo(x, py0 + ph);
        g.stroke();
      }
      // Schroeder frequency
      if (fs < FMAX) {
        const x = xOf(fs);
        g.fillStyle = "rgba(125,224,176,0.06)";
        g.fillRect(x, py0, px0 + pw - x, ph);
        label(g, "above here, modes blur together", x + 6 * d, py0 + 8 * d, 9 * d, "rgba(125,224,176,0.8)", "left", 500);
      }
      g.save();
      g.shadowColor = "#ffb86b";
      g.shadowBlur = 8 * d;
      g.strokeStyle = "#ffb86b";
      g.lineWidth = 2 * d;
      g.beginPath();
      for (let i = 0; i < response.length; i++) {
        const f = FMIN * Math.pow(FMAX / FMIN, i / (response.length - 1));
        const db = Math.max(dbMin, 20 * Math.log10(response[i] / respMax));
        const x = xOf(f);
        const y = py0 + (db / dbMin) * ph;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
      g.restore();
      const fx = xOf(freq);
      const fdb = Math.max(dbMin, 20 * Math.log10(levelHere()));
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.beginPath();
      g.moveTo(fx, py0);
      g.lineTo(fx, py0 + ph);
      g.stroke();
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(fx, py0 + (fdb / dbMin) * ph, 4.5 * d, 0, Math.PI * 2);
      g.fill();
      label(g, "response where the listener stands · blue lines: axial modes", px0, ry + 11 * d, 9.5 * d, SC.muted, "left", 500);
    },
  };
}
