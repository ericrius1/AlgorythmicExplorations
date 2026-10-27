// Fig: "I am sitting in a room". A voice is played into a room and recorded,
// that recording is played into the room and recorded again, and so on. Each
// pass multiplies the spectrum by the room's frequency response once more, so
// the room's strongest resonances take over. Every generation is computed
// here by convolving with the room's impulse response; the waterfall shows
// the spectrum of each one, top to bottom.

import { Shell, type Demo } from "../../../lib/demoShell";
import { Tone, frameGuard, midiName } from "../../../lib/audio";
import { buildIR } from "./ir";
import { fft } from "./fft";
import { type Room } from "./room";
import { rawCtx, sittingVoice, spaceOut } from "./sound";
import { SC, label, playGate, roundRect, segmented, smallButton, stage, ui, narrowScreen } from "./kit";

const FS = 24000; // plenty for a voice, and it halves the work
const GENS = 32;
const F_LO = 60;
const F_HI = 8000;
const NB = 220; // log-spaced spectrum bins for the waterfall

const ROOMS: Record<string, { name: string; room: Room }> = {
  living: { name: "living room", room: { L: 4.6, W: 3.6, H: 2.7, surf: ["plaster", "plaster", "glass", "plaster", "woodfloor", "plaster"] } },
  bathroom: { name: "bathroom", room: { L: 2.6, W: 2.1, H: 2.4, surf: ["tile", "tile", "tile", "tile", "tile", "plaster"] } },
  stairwell: { name: "stairwell", room: { L: 3.5, W: 3, H: 14, surf: ["concrete", "concrete", "concrete", "concrete", "concrete", "concrete"] } },
};
type RoomId = keyof typeof ROOMS;

// One pass through "loudspeaker and microphone": roll off below ~70 Hz and
// above ~7 kHz, as real ones do, so the extremes don't pile up.
function band(x: Float32Array): void {
  const hp = Math.exp((-2 * Math.PI * 70) / FS);
  const lp = Math.exp((-2 * Math.PI * 7000) / FS);
  let px = 0;
  let py = 0;
  let ly = 0;
  for (let i = 0; i < x.length; i++) {
    const y = hp * (py + x[i] - px);
    px = x[i];
    py = y;
    ly = (1 - lp) * y + lp * ly;
    x[i] = ly;
  }
}

function peakNormalize(x: Float32Array, peak: number): void {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
}

// Average power spectrum (Welch, Hann frames of 4096) on log-spaced bins, in dB.
function spectrum(x: Float32Array): Float32Array {
  const n = 4096;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const acc = new Float64Array(n / 2);
  let frames = 0;
  for (let s = 0; s + n <= x.length; s += n / 2) {
    for (let i = 0; i < n; i++) {
      re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  const out = new Float32Array(NB);
  for (let b = 0; b < NB; b++) {
    const f0 = F_LO * Math.pow(F_HI / F_LO, b / NB);
    const f1 = F_LO * Math.pow(F_HI / F_LO, (b + 1) / NB);
    const k0 = Math.floor((f0 * n) / FS);
    const k1 = Math.max(k0 + 1, Math.ceil((f1 * n) / FS));
    let p = 0;
    for (let k = k0; k < k1; k++) p = Math.max(p, acc[k]);
    out[b] = 10 * Math.log10(p / Math.max(1, frames) + 1e-14);
  }
  return out;
}

export function mountLucier(container: HTMLElement): Demo {
  const shell = new Shell(container, narrowScreen() ? 1.0 : 0.58);
  const cv = shell.canvas;
  const g = cv.getContext("2d")!;
  const wrap = stage(shell);
  const voice = sittingVoice(FS);
  const LEN = voice.length + Math.floor(FS * 1.1);
  let roomId: RoomId = "living";
  let gens: Float32Array[] = [];
  let specs: Float32Array[] = [];
  let irSpec: { re: Float64Array; im: Float64Array; n: number } | null = null;
  let pick = 12;
  let playing: { gen: number; t0: number; dur: number } | null = null;
  let queue: number[] = [];
  let fader: GainNode | null = null;
  let srcNode: AudioBufferSourceNode | null = null;
  let soundOn = false;
  let peaks: number[] = [];

  const reset = (): void => {
    const ir = buildIR(ROOMS[roomId].room, { x: 1.1, y: 1.0, z: 1.5 }, { pos: { x: ROOMS[roomId].room.L - 1.0, y: ROOMS[roomId].room.W - 0.9, z: 1.3 }, yaw: 0 }, { fs: FS, binaural: false, maxLength: 2.5 });
    const h = ir.ch[0];
    let n = 1;
    while (n < LEN + h.length) n <<= 1;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < h.length; i++) re[i] = h[i];
    fft(re, im);
    irSpec = { re, im, n };
    const g0 = new Float32Array(LEN);
    g0.set(voice);
    gens = [g0];
    specs = [spectrum(g0)];
    peaks = [];
  };

  // one generation per frame, so the page never stalls
  const step = (): void => {
    if (!irSpec || gens.length > GENS) return;
    const { re: hr, im: hi, n } = irSpec;
    const prev = gens[gens.length - 1];
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < prev.length; i++) re[i] = prev[i];
    fft(re, im);
    for (let k = 0; k < n; k++) {
      const a = re[k] * hr[k] - im[k] * hi[k];
      const b = re[k] * hi[k] + im[k] * hr[k];
      re[k] = a;
      im[k] = b;
    }
    fft(re, im, true);
    // the recorder runs as long as the original, plus a little of the tail
    const out = new Float32Array(LEN);
    for (let i = 0; i < LEN; i++) out[i] = re[i];
    band(out);
    peakNormalize(out, 0.6);
    gens.push(out);
    specs.push(spectrum(out));
    if (gens.length === GENS + 1) findPeaks();
  };

  const findPeaks = (): void => {
    const s = specs[specs.length - 1];
    const cand: { b: number; v: number }[] = [];
    for (let b = 2; b < NB - 2; b++) if (s[b] > s[b - 1] && s[b] >= s[b + 1] && s[b] > s[b - 2] && s[b] >= s[b + 2]) cand.push({ b, v: s[b] });
    cand.sort((p, q) => q.v - p.v);
    const top = cand[0]?.v ?? 0;
    peaks = cand
      .filter((c) => c.v > top - 12)
      .slice(0, 4)
      .map((c) => F_LO * Math.pow(F_HI / F_LO, (c.b + 0.5) / NB))
      .sort((a, b) => a - b);
  };

  const playGen = (k: number): void => {
    const ctx = rawCtx();
    if (!fader) {
      fader = ctx.createGain();
      fader.gain.value = 0;
      Tone.connect(fader, spaceOut());
    }
    srcNode?.stop();
    srcNode?.disconnect();
    const x = gens[Math.min(k, gens.length - 1)];
    const b = ctx.createBuffer(1, x.length, FS);
    b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(fader);
    s.start();
    s.onended = () => {
      if (srcNode !== s) return;
      srcNode = null;
      playing = null;
      const next = queue.shift();
      if (next !== undefined && soundOn) playGen(next);
    };
    srcNode = s;
    fader.gain.setTargetAtTime(0.85, ctx.currentTime, 0.02);
    playing = { gen: Math.min(k, gens.length - 1), t0: performance.now() / 1000, dur: b.duration };
  };

  const start = (): void => {
    soundOn = true;
    queue = [];
    playGen(pick);
  };
  const gate = playGate(wrap, "Tap to listen", "generation 12, then pick any other", start);
  const guard = frameGuard(() => {
    if (!soundOn) return;
    soundOn = false;
    queue = [];
    fader?.gain.setTargetAtTime(0, rawCtx().currentTime, 0.05);
    const s = srcNode;
    srcNode = null;
    playing = null;
    window.setTimeout(() => s?.stop(), 250);
    gate.show("Tap to listen again");
  });

  segmented<RoomId>(shell.controls, "room", Object.keys(ROOMS) as RoomId[], roomId, (v) => {
    roomId = v;
    srcNode?.stop();
    queue = [];
    reset();
  }, Object.fromEntries(Object.entries(ROOMS).map(([k, v]) => [k, v.name])) as Record<RoomId, string>);
  const brk = document.createElement("span");
  brk.className = "mp-break";
  shell.controls.appendChild(brk);
  shell.slider({
    label: "generation",
    min: 0,
    max: GENS,
    step: 1,
    value: pick,
    format: (v) => (v === 0 ? "0 (the dry voice)" : String(v)),
    onInput: (v) => {
      pick = v;
    },
  }).addEventListener("change", () => soundOn && (queue = [], playGen(pick)));
  smallButton(shell.controls, "▶ play it", () => {
    if (!soundOn) gate.el.click();
    else {
      queue = [];
      playGen(pick);
    }
  });
  smallButton(shell.controls, "▶ 0 → 1 → 2 → 4 → 8 → 16 → 32", () => {
    if (!soundOn) {
      soundOn = true;
      gate.hide();
    }
    queue = [1, 2, 4, 8, 16, 32];
    playGen(0);
  });

  reset();
  shell.setInfo(() => {
    if (gens.length <= GENS) return `recording generation ${gens.length} of ${GENS}…`;
    const names = peaks.map((f) => `${Math.round(f)} Hz (${midiName(Math.round(69 + 12 * Math.log2(f / 440)))})`);
    return `after ${GENS} passes the ${ROOMS[roomId].name} rings at ${names.join(", ")}`;
  });

  return {
    frame() {
      guard.pulse();
      shell.tick();
      const t0 = performance.now();
      while (gens.length <= GENS && performance.now() - t0 < 12) step();
      const d = ui(cv);
      const Wc = cv.width;
      const Hc = cv.height;
      g.fillStyle = SC.bg;
      g.fillRect(0, 0, Wc, Hc);
      const pad = 14 * d;
      const narrow = Wc / d < 560;
      const lx = pad + (narrow ? 26 : 34) * d;
      const top = pad + 22 * d;
      const ww = Wc - lx - pad;
      const wh = Hc - top - pad - 26 * d;
      g.fillStyle = "#0b0d14";
      roundRect(g, pad, pad, Wc - pad * 2, Hc - pad * 2, 8 * d);
      g.fill();
      label(g, "spectrum of each generation (top: the dry voice)", lx, pad + 11 * d, 10.5 * d, SC.muted);
      const rowH = wh / (GENS + 1);
      // dB range set by each row's own peak, so every row shows its shape
      for (let k = 0; k < specs.length; k++) {
        const s = specs[k];
        let mx = -Infinity;
        for (const v of s) mx = Math.max(mx, v);
        const y = top + k * rowH;
        for (let b = 0; b < NB; b++) {
          const t = Math.max(0, 1 + (s[b] - mx) / 42);
          const x = lx + (b / NB) * ww;
          const r = 20 + 235 * Math.pow(t, 2.2);
          const gg = 18 + 190 * Math.pow(t, 2.6);
          const bb = 40 + 150 * Math.pow(t, 1.4) * (1 - t * 0.6);
          g.fillStyle = `rgb(${r | 0},${gg | 0},${bb | 0})`;
          g.fillRect(x, y, ww / NB + 0.6 * d, rowH + 0.5 * d);
        }
      }
      // generation labels
      for (const k of [0, 8, 16, 24, 32]) label(g, String(k), lx - 6 * d, top + (k + 0.5) * rowH, 9 * d, SC.muted, "right", 500, true);
      for (const f of [100, 250, 500, 1000, 2000, 4000]) {
        const x = lx + (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * ww;
        label(g, f >= 1000 ? `${f / 1000}k` : `${f}`, x, top + wh + 15 * d, 9 * d, SC.muted, "center", 500, true);
      }
      label(g, "Hz", lx + ww, top + wh + 15 * d, 9 * d, SC.muted, "right", 500, true);
      // the chosen generation, and a playhead along it
      const show = playing ? playing.gen : pick;
      const y = top + show * rowH;
      g.strokeStyle = "rgba(255,255,255,0.8)";
      g.lineWidth = 1.5 * d;
      g.strokeRect(lx - 1 * d, y - 1 * d, ww + 2 * d, rowH + 2 * d);
      if (playing) {
        const f = Math.min(1, (performance.now() / 1000 - playing.t0) / playing.dur);
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.fillRect(lx - 10 * d, y, 4 * d, rowH);
        label(g, `▶ ${f < 1 ? "playing" : ""}`, lx + ww - 4 * d, y - 8 * d, 9 * d, "#fff", "right", 600);
      }
      for (const f of peaks) {
        const x = lx + (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * ww;
        g.fillStyle = "#7de0b0";
        g.beginPath();
        g.moveTo(x, top + wh + 1 * d);
        g.lineTo(x - 4 * d, top + wh + 7 * d);
        g.lineTo(x + 4 * d, top + wh + 7 * d);
        g.fill();
      }
    },
  };
}
