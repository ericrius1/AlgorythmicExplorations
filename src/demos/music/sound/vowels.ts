// Fig. 5 of "The Anatomy of a Note": a voice from a buzz and four
// resonances. The source is a harmonic buzz (every harmonic, falling 6 dB
// per octave, like vocal folds plus the lips). It runs through four resonant
// filters in series, the formants, the way Klatt's cascade synthesizer
// models the vocal tract. Move the dot around the vowel chart and only the
// resonances move; change the pitch and only the harmonics move.
// Formant values: Peterson & Barney (1952), averages for adult men.

import type { Demo } from "../../../lib/demoShell";
import { ctx, dest, now, unlockAudio, noteLabel, guardSound } from "./core";
import { Stage, PlayPill, playButton, glowStroke, glowDot, harmonicRgb, rgba, mix, text, hline, vline, roundRect, WHITE, ORANGE, BLUE } from "./draw";

interface Vowel {
  ipa: string;
  word: string;
  f: [number, number, number];
}

const VOWELS: Vowel[] = [
  { ipa: "i", word: "heed", f: [270, 2290, 3010] },
  { ipa: "ɪ", word: "hid", f: [390, 1990, 2550] },
  { ipa: "ɛ", word: "head", f: [530, 1840, 2480] },
  { ipa: "æ", word: "had", f: [660, 1720, 2410] },
  { ipa: "ʌ", word: "hud", f: [640, 1190, 2390] },
  { ipa: "ɑ", word: "father", f: [730, 1090, 2440] },
  { ipa: "ɔ", word: "hawed", f: [570, 840, 2410] },
  { ipa: "ʊ", word: "hood", f: [440, 1020, 2240] },
  { ipa: "u", word: "who'd", f: [300, 870, 2240] },
];
const F4 = 3300;
const BW = [70, 100, 140, 220]; // formant bandwidths, Hz
const HARM = 120; // source harmonics (the browser drops any above Nyquist)

// chart axes (log), with front vowels on the left and closed vowels on top
const F1R = [220, 860];
const F2R = [2550, 700];

export async function mountVowels(container: HTMLElement): Promise<Demo> {
  const stage = new Stage(container, { aspect: 0.6, narrowAspect: 1.4, touch: "none" });
  const { shell, canvas } = stage;

  let f0 = 120;
  let F1 = 730;
  let F2 = 1090;
  let F3 = 2440;
  let playing = false;

  // ---- the voice ------------------------------------------------------------------
  const c = ctx();
  const real = new Float32Array(HARM + 1);
  const imag = new Float32Array(HARM + 1);
  for (let n = 1; n <= HARM; n++) imag[n] = 1 / n;
  const buzzWave = c.createPeriodicWave(real, imag, { disableNormalization: true });
  const filters = [0, 1, 2, 3].map(() => {
    const f = c.createBiquadFilter();
    f.type = "lowpass"; // with resonance: a two-pole formant, unity gain at DC
    return f;
  });
  const out = c.createGain();
  out.gain.value = 0;
  for (let i = 0; i < 3; i++) filters[i].connect(filters[i + 1]);
  filters[3].connect(out);
  out.connect(dest());
  let src: OscillatorNode | null = null;
  let vib: OscillatorNode | null = null;
  let vibDepth: GainNode | null = null;

  const qdb = (f: number, bw: number): number => 20 * Math.log10(f / bw); // lowpass Q is in dB
  const setFormants = (glide = 0.04): void => {
    const t = now();
    const fs = [F1, F2, F3, F4];
    filters.forEach((f, i) => {
      f.frequency.cancelScheduledValues(t);
      f.Q.cancelScheduledValues(t);
      f.frequency.setTargetAtTime(fs[i], t, glide / 3);
      f.Q.setTargetAtTime(qdb(fs[i], BW[i]), t, glide / 3);
    });
    if (playing) out.gain.setTargetAtTime(levelFor(), t, glide / 3);
  };

  // response of the four formants, computed like the filters do (RBJ lowpass)
  const sr = c.sampleRate || 48000;
  const resp = (f: number, fs = [F1, F2, F3, F4]): number => {
    let mag = 1;
    for (let i = 0; i < 4; i++) {
      const w0 = (2 * Math.PI * fs[i]) / sr;
      const q = Math.pow(10, qdb(fs[i], BW[i]) / 20);
      const alpha = Math.sin(w0) / (2 * q);
      const cw = Math.cos(w0);
      const b0 = (1 - cw) / 2;
      const b1 = 1 - cw;
      const a0 = 1 + alpha;
      const a1 = -2 * cw;
      const a2 = 1 - alpha;
      const w = (2 * Math.PI * f) / sr;
      // |B(e^jw)| / |A(e^jw)|
      const br = b0 + b1 * Math.cos(w) + b0 * Math.cos(2 * w);
      const bi = -(b1 * Math.sin(w) + b0 * Math.sin(2 * w));
      const ar = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w);
      const ai = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
      mag *= Math.hypot(br, bi) / Math.hypot(ar, ai);
    }
    return mag;
  };
  // keep the loudness steady as vowel and pitch change (constant RMS)
  const levelFor = (): number => {
    let ss = 0;
    for (let n = 1; n * f0 < Math.min(8000, sr / 2); n++) {
      const a = resp(n * f0) / n;
      ss += a * a;
    }
    return 0.085 / Math.sqrt(Math.max(ss / 2, 1e-9));
  };

  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    const t = now();
    if (on) {
      src = c.createOscillator();
      src.setPeriodicWave(buzzWave);
      src.frequency.value = f0;
      vib = c.createOscillator();
      vib.frequency.value = 5.3;
      vibDepth = c.createGain();
      vibDepth.gain.value = f0 * 0.012;
      vib.connect(vibDepth).connect(src.frequency);
      src.connect(filters[0]);
      src.start(t);
      vib.start(t);
      setFormants(0);
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(levelFor(), t, 0.04);
    } else {
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, 0.05);
      const s = src;
      const v = vib;
      src = null;
      vib = null;
      window.setTimeout(() => {
        s?.stop();
        v?.stop();
        s?.disconnect();
        v?.disconnect();
      }, 400);
    }
    syncPlay(on);
    pill.show(!on);
  };
  const setPitch = (f: number): void => {
    f0 = f;
    if (src && vibDepth) {
      const t = now();
      src.frequency.setTargetAtTime(f, t, 0.02);
      vibDepth.gain.setTargetAtTime(f * 0.012, t, 0.02);
      out.gain.setTargetAtTime(levelFor(), t, 0.02);
    }
  };

  const toggle = (): void => {
    void unlockAudio().then(() => setPlaying(!playing));
  };
  const pill = new PlayPill(stage, "Tap to hear the voice", toggle, stage.narrow ? [0.5, 0.3] : [0.27, 0.5]);
  const syncPlay = playButton(stage, ["▶ voice", "■ stop"], toggle);

  // ---- "ah – ee – oo" ------------------------------------------------------------------
  let song: { t0: number; stopAfter: boolean } | null = null;
  const SONG: [string, number][] = [
    ["ɑ", 0],
    ["i", 1.1],
    ["u", 2.2],
    ["ɑ", 3.3],
  ];
  shell.button("sing ah · ee · oo", () => {
    void unlockAudio().then(() => {
      const was = playing;
      setPlaying(true);
      song = { t0: performance.now() / 1000, stopAfter: !was };
    });
  });
  shell.slider({
    label: "pitch",
    min: 80,
    max: 600,
    step: 1,
    value: f0,
    log: true,
    format: (v) => `${Math.round(v)} Hz`,
    onInput: (v) => setPitch(v),
  });

  const guard = guardSound(container, () => {
    song = null;
    setPlaying(false);
  });

  const nearest = (): Vowel => {
    let best = VOWELS[0];
    let bd = Infinity;
    for (const v of VOWELS) {
      const d = Math.hypot(Math.log(F1 / v.f[0]) * 1.4, Math.log(F2 / v.f[1]));
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  // F3 from the chart: inverse-distance blend of the nearby vowels
  const f3For = (f1: number, f2: number): number => {
    let wsum = 0;
    let acc = 0;
    for (const v of VOWELS) {
      const d = Math.hypot(Math.log(f1 / v.f[0]), Math.log(f2 / v.f[1])) + 1e-3;
      const wt = 1 / (d * d * d);
      wsum += wt;
      acc += wt * v.f[2];
    }
    return acc / wsum;
  };

  shell.setInfo(() => {
    const v = nearest();
    return `F1 ${Math.round(F1)} · F2 ${Math.round(F2)} · F3 ${Math.round(F3)} Hz · nearest vowel: ${v.ipa} as in “${v.word}” · pitch ${Math.round(f0)} Hz (${noteLabel(f0)})`;
  });

  // ---- layout + chart input ------------------------------------------------------------
  const pad = { x: 0, y: 0, w: 0, h: 0 };
  const spec = { x: 0, y: 0, w: 0, h: 0 };
  const padX = (f2: number): number => pad.x + ((Math.log(f2) - Math.log(F2R[0])) / (Math.log(F2R[1]) - Math.log(F2R[0]))) * pad.w;
  const padY = (f1: number): number => pad.y + ((Math.log(f1) - Math.log(F1R[0])) / (Math.log(F1R[1]) - Math.log(F1R[0]))) * pad.h;
  const fromPad = (x: number, y: number): [number, number] => {
    const u = Math.max(0, Math.min(1, (x - pad.x) / pad.w));
    const v = Math.max(0, Math.min(1, (y - pad.y) / pad.h));
    const f2 = Math.exp(Math.log(F2R[0]) + u * (Math.log(F2R[1]) - Math.log(F2R[0])));
    const f1 = Math.exp(Math.log(F1R[0]) + v * (Math.log(F1R[1]) - Math.log(F1R[0])));
    return [f1, f2];
  };
  const moveTo = (f1: number, f2: number, glide = 0.04): void => {
    // the tract can't make F2 lower than F1 + a little
    F1 = f1;
    F2 = Math.max(f2, f1 + 250);
    F3 = Math.max(f3For(F1, F2), F2 + 300);
    setFormants(glide);
  };
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = stage.local(e);
    if (x < pad.x - 10 || x > pad.x + pad.w + 10 || y < pad.y - 10 || y > pad.y + pad.h + 10) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    song = null;
    const [f1, f2] = fromPad(x, y);
    moveTo(f1, f2, 0.06);
    void unlockAudio().then(() => setPlaying(true));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const [x, y] = stage.local(e);
    const [f1, f2] = fromPad(x, y);
    moveTo(f1, f2, 0.03);
  });
  const up = (): void => {
    dragging = false;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  moveTo(F1, F2, 0);

  // ---- drawing ------------------------------------------------------------------------
  const vowelByIpa = (s: string): Vowel => VOWELS.find((v) => v.ipa === s)!;
  return {
    frame() {
      shell.tick();
      guard.pulse();
      if (song) {
        const t = performance.now() / 1000 - song.t0;
        let cur = SONG[0];
        for (const s of SONG) if (t >= s[1]) cur = s;
        const v = vowelByIpa(cur[0]);
        if (Math.abs(F1 - v.f[0]) > 1 || Math.abs(F2 - v.f[1]) > 1) moveTo(v.f[0], v.f[1], 0.18);
        if (t > SONG[SONG.length - 1][1] + 1.0) {
          if (song.stopAfter) setPlaying(false);
          song = null;
        }
      }

      const g = stage.begin();
      const W = stage.w;
      const H = stage.h;
      const narrow = stage.narrow;
      if (narrow) {
        pad.x = 34;
        pad.y = 30;
        pad.w = W - 52;
        pad.h = H * 0.44;
        spec.x = 14;
        spec.y = pad.y + pad.h + 52;
        spec.w = W - 28;
        spec.h = H - spec.y - 26;
      } else {
        pad.x = 44;
        pad.y = 30;
        pad.h = H - 72;
        pad.w = Math.min(W * 0.4, pad.h * 1.15);
        spec.x = pad.x + pad.w + 46;
        spec.y = 30;
        spec.w = W - spec.x - 16;
        spec.h = H - 72;
      }

      // ---- the vowel chart ----
      g.save();
      g.fillStyle = "rgba(122,162,255,0.04)";
      roundRect(g, pad.x, pad.y, pad.w, pad.h, 8);
      g.fill();
      g.strokeStyle = "rgba(122,162,255,0.14)";
      g.stroke();
      g.restore();
      text(g, "front", pad.x + 4, pad.y - 8, { size: 9.5, color: "rgba(150,160,190,0.6)" });
      text(g, "back", pad.x + pad.w - 4, pad.y - 8, { size: 9.5, align: "right", color: "rgba(150,160,190,0.6)" });
      text(g, "F2 →", pad.x + pad.w / 2, pad.y + pad.h + 15, { size: 9.5, align: "center", color: "rgba(150,160,190,0.6)", mono: true });
      g.save();
      g.translate(pad.x - 12, pad.y + pad.h / 2);
      g.rotate(-Math.PI / 2);
      text(g, "← F1 · jaw opens", 0, 0, { size: 9.5, align: "center", color: "rgba(150,160,190,0.6)", mono: true });
      g.restore();
      const near = nearest();
      for (const v of VOWELS) {
        const x = padX(v.f[1]);
        const y = padY(v.f[0]);
        const on = v === near;
        g.save();
        g.fillStyle = on ? "rgba(255,184,107,0.16)" : "rgba(122,162,255,0.07)";
        g.beginPath();
        g.arc(x, y, on ? 15 : 13, 0, Math.PI * 2);
        g.fill();
        g.restore();
        text(g, v.ipa, x, y + 5, { size: 15, align: "center", color: on ? "#ffe1bd" : "rgba(200,208,230,0.75)", weight: 600 });
        if (!narrow || on) text(g, v.word, x, y + 26, { size: 9.5, align: "center", color: on ? "rgba(255,214,170,0.9)" : "rgba(150,160,190,0.55)" });
      }
      const dx = padX(F2);
      const dy = padY(F1);
      glowDot(g, dx, dy, 4.5, ORANGE, playing ? 1 : 0.6);

      // ---- the spectrum: harmonics under the formant envelope ----
      const FMAX = 4000;
      const DB0 = -46;
      const DB1 = 6;
      const sx = (f: number): number => spec.x + (f / FMAX) * spec.w;
      // the curve the harmonic tops trace: buzz (1/n, i.e. f0/f) × resonances,
      // normalized to the loudest harmonic so the tops land on it
      let hmax = 1e-9;
      for (let n = 1; n * f0 < FMAX; n++) hmax = Math.max(hmax, resp(n * f0) / n);
      const ENV = 240;
      const fStart = f0 * 0.75;
      const envF = (i: number): number => fStart + (i / ENV) * (FMAX - fStart);
      const env = new Float64Array(ENV + 1);
      for (let i = 0; i <= ENV; i++) env[i] = (resp(envF(i)) * f0) / envF(i) / hmax;
      const sy = (db: number): number => spec.y + spec.h - ((Math.max(DB0, Math.min(DB1, db)) - DB0) / (DB1 - DB0)) * spec.h;
      for (const f of [1000, 2000, 3000]) vline(g, sx(f), spec.y, spec.y + spec.h, "rgba(122,162,255,0.07)");
      hline(g, spec.x, spec.x + spec.w, spec.y + spec.h, "rgba(122,162,255,0.2)");
      for (const f of [0, 1000, 2000, 3000, 4000]) {
        text(g, f === 0 ? "0" : `${f / 1000}k`, sx(f), spec.y + spec.h + 14, {
          size: 9.5,
          align: f === 0 ? "left" : f === 4000 ? "right" : "center",
          color: "rgba(150,160,190,0.55)",
          mono: true,
        });
      }
      text(g, "Hz", spec.x + spec.w, spec.y - 8, { size: 9.5, align: "right", color: "rgba(150,160,190,0.5)", mono: true });
      text(g, "harmonics of the buzz, shaped by the resonances", spec.x, spec.y - 8, { size: 10.5, color: "rgba(180,188,210,0.8)" });

      // envelope
      const ep = new Path2D();
      for (let i = 0; i <= ENV; i++) {
        const db = 20 * Math.log10(env[i]);
        if (i === 0) ep.moveTo(sx(envF(i)), sy(db));
        else ep.lineTo(sx(envF(i)), sy(db));
      }
      glowStroke(g, ep, BLUE, 1.3, 0.75);

      // harmonics: each line is (source 1/n) × (resonances), relative to the max
      for (let n = 1; n * f0 < FMAX; n++) {
        const f = n * f0;
        const db = 20 * Math.log10(resp(f) / n / hmax);
        const x = sx(f);
        const p = new Path2D();
        p.moveTo(x, spec.y + spec.h);
        p.lineTo(x, sy(db));
        const col = mix(harmonicRgb(n), WHITE, 0.15);
        glowStroke(g, p, col, 1.1, playing ? 0.85 : 0.5);
      }

      // formant labels at the peaks
      [F1, F2, F3].forEach((f, i) => {
        const x = sx(f);
        const db = 20 * Math.log10((resp(f) * f0) / f / hmax);
        const y = sy(db) - 10;
        text(g, `F${i + 1}`, x, Math.max(spec.y + 10, y), { size: 10.5, align: "center", color: "rgba(160,190,255,0.95)", weight: 700, mono: true });
      });
      if (!narrow) text(g, `${Math.round(f0)} Hz apart`, sx(f0 * 2) + 6, spec.y + spec.h - 8, { size: 9.5, color: rgba(ORANGE, 0.7), mono: true });
    },
    dispose() {
      setPlaying(false);
    },
  };
}
