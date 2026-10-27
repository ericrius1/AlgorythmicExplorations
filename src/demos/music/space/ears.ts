// Fig: two ears. A sound circles your head (or drag it). The far ear hears it
// later, because the sound has to bend around the head (Woodworth's path),
// and quieter at high frequencies, because the head is in the way (Brown and
// Duda's head-shadow filter). Switch each cue on and off, or compare with a
// plain stereo pan. Headphones needed.

import { Shell, type Demo } from "../../../lib/demoShell";
import { Tone, frameGuard } from "../../../lib/audio";
import { BinauralPanner, HEAD_RADIUS, headShadowMag, itdSeconds } from "./binaural";
import { malletPhrase, rawCtx, sampleRate, sittingVoice, spaceOut } from "./sound";
import { SC, dragger, label, playGate, rgba, roundRect, segmented, smallButton, stage, ui, type P2, narrowScreen } from "./kit";

type Mode = "both" | "itd" | "ild" | "pan";
type Snd = "taps" | "voice" | "mallet";

// Broadband taps (the easiest kind of sound to place): short noise bursts in
// an uneven rhythm, two seconds long, looped.
function taps(fs: number): Float32Array {
  const n = Math.floor(fs * 2);
  const x = new Float32Array(n);
  let s = 77;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const times = [0, 0.25, 0.5, 0.625, 0.75, 1, 1.25, 1.5, 1.75, 1.875];
  times.forEach((t0, k) => {
    const a = k % 4 === 0 ? 0.9 : 0.55;
    const tau = k % 4 === 0 ? 0.03 : 0.012;
    const i0 = Math.floor(t0 * fs);
    for (let i = 0; i < fs * 0.15 && i0 + i < n; i++) x[i0 + i] += a * rnd() * Math.exp(-i / fs / tau);
  });
  return x;
}

export function mountEars(container: HTMLElement): Demo {
  const shell = new Shell(container, narrowScreen() ? 1.25 : 0.56);
  const cv = shell.canvas;
  const g = cv.getContext("2d")!;
  const wrap = stage(shell);
  let az = 0.9;
  let orbit = true;
  let mode: Mode = "both";
  let snd: Snd = "taps";
  let panner: BinauralPanner | null = null;
  let fader: GainNode | null = null;
  let srcNode: AudioBufferSourceNode | null = null;
  const bufs: Partial<Record<Snd, AudioBuffer>> = {};
  let soundOn = false;
  let last = performance.now();
  let center: P2 = { x: 0, y: 0 };

  const buffer = (k: Snd): AudioBuffer => {
    if (!bufs[k]) {
      const fs = sampleRate();
      const x = k === "taps" ? taps(fs) : k === "voice" ? sittingVoice(fs) : malletPhrase(fs);
      const b = rawCtx().createBuffer(1, x.length, fs);
      b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
      bufs[k] = b;
    }
    return bufs[k]!;
  };

  const startSource = (): void => {
    if (!panner) return;
    srcNode?.stop();
    srcNode?.disconnect();
    const s = rawCtx().createBufferSource();
    s.buffer = buffer(snd);
    s.loop = true;
    s.connect(panner.input);
    s.start();
    srcNode = s;
  };

  const start = (): void => {
    const ctx = rawCtx();
    if (!panner) {
      panner = new BinauralPanner(ctx);
      fader = ctx.createGain();
      fader.gain.value = 0;
      panner.output.connect(fader);
      Tone.connect(fader, spaceOut());
    }
    panner.set(az, mode, 0.001);
    startSource();
    fader!.gain.setTargetAtTime(0.8, ctx.currentTime, 0.05);
    soundOn = true;
  };
  const gate = playGate(wrap, "Tap to listen (headphones)", "a sound circles your head", start);
  const silence = (): void => {
    if (!soundOn) return;
    soundOn = false;
    fader?.gain.setTargetAtTime(0, rawCtx().currentTime, 0.05);
    const s = srcNode;
    srcNode = null;
    window.setTimeout(() => {
      s?.stop();
      s?.disconnect();
    }, 300);
    gate.show("Tap to listen again");
  };
  const guard = frameGuard(silence);

  segmented<Mode>(shell.controls, "cues", ["both", "itd", "ild", "pan"], mode, (v) => {
    mode = v;
    panner?.set(az, mode);
  }, { both: "both", itd: "timing only", ild: "level only", pan: "plain pan" });
  segmented<Snd>(shell.controls, "sound", ["taps", "voice", "mallet"], snd, (v) => {
    snd = v;
    if (soundOn) startSource();
  });
  const orbitBtn = smallButton(shell.controls, "orbit: on", () => {
    orbit = !orbit;
    orbitBtn.textContent = `orbit: ${orbit ? "on" : "off"}`;
  });

  dragger(
    cv,
    () => [
      {
        pos: () => {
          const r = Math.min(cv.width * 0.2, cv.height * 0.36);
          return { x: center.x + r * Math.sin(az), y: center.y - r * Math.cos(az) };
        },
        move: (p) => {
          az = Math.atan2(p.x - center.x, -(p.y - center.y));
          if (orbit) {
            orbit = false;
            orbitBtn.textContent = "orbit: off";
          }
          panner?.set(az, mode, 0.02);
        },
        r: 30,
      },
    ],
    (p) => {
      // tapping anywhere on the left side puts the source there
      if (p.x < cv.width * 0.5 || cv.width / ui(cv) < 560) {
        az = Math.atan2(p.x - center.x, -(p.y - center.y));
        orbit = false;
        orbitBtn.textContent = "orbit: off";
        panner?.set(az, mode, 0.02);
      }
    },
  );

  const deg = (): number => {
    let a = (az * 180) / Math.PI;
    a = ((a + 540) % 360) - 180;
    return a;
  };
  shell.setInfo(() => {
    const itd = itdSeconds(Math.sin(az)) * 1e6;
    const ild = 20 * Math.log10(headShadowMag(4000, Math.acos(Math.sin(az))) / headShadowMag(4000, Math.acos(-Math.sin(az))));
    return `azimuth ${deg().toFixed(0)}° · time difference ${Math.abs(itd).toFixed(0)} µs · level difference at 4 kHz ${Math.abs(ild).toFixed(1)} dB`;
  });

  return {
    frame() {
      guard.pulse();
      shell.tick();
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (orbit) {
        az += dt * ((2 * Math.PI) / 14);
        if (az > Math.PI) az -= 2 * Math.PI;
        if (soundOn) panner?.set(az, mode, 0.05);
      }
      const d = ui(cv);
      const Wc = cv.width;
      const Hc = cv.height;
      g.fillStyle = SC.bg;
      g.fillRect(0, 0, Wc, Hc);
      const narrow = Wc / d < 560;
      const pad = 14 * d;
      const leftW = narrow ? Wc : Wc * 0.5;
      const topH = narrow ? Hc * 0.58 : Hc;
      center = { x: leftW / 2, y: topH / 2 + 6 * d };
      const R = Math.min(leftW * 0.4, topH * 0.36);
      const a = R * 0.34; // drawn head radius
      const s = Math.sin(az);
      const u = { x: Math.sin(az), y: -Math.cos(az) }; // toward the source, on screen

      // orbit circle and the ghost: the mirror position that gives the same cues
      g.strokeStyle = "rgba(150,160,200,0.14)";
      g.lineWidth = d;
      g.setLineDash([3 * d, 5 * d]);
      g.beginPath();
      g.arc(center.x, center.y, R, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      label(g, "ahead", center.x, center.y - R - 12 * d, 9.5 * d, SC.muted, "center");
      const ghostAz = Math.PI - az;
      const ghost = { x: center.x + R * Math.sin(ghostAz), y: center.y - R * Math.cos(ghostAz) };
      if (Math.abs(Math.cos(az)) > 0.12) {
        g.strokeStyle = rgba(SC.src, 0.45);
        g.setLineDash([3 * d, 3 * d]);
        g.beginPath();
        g.arc(ghost.x, ghost.y, 8 * d, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        const gx = ghost.x + (ghost.x >= center.x ? 14 : -14) * d;
        label(g, "same cues", gx, ghost.y, 9 * d, rgba(SC.src, 0.75), ghost.x >= center.x ? "left" : "right");
      }

      // rays: straight to the near ear; to the far ear, tangent to the head and around it
      const ears = [
        { x: center.x - a, y: center.y },
        { x: center.x + a, y: center.y },
      ];
      const nearIdx = s >= 0 ? 1 : 0;
      const far = ears[1 - nearIdx];
      const near = ears[nearIdx];
      const sp0 = { x: center.x + R * u.x, y: center.y + R * u.y };
      g.lineWidth = 1.6 * d;
      g.strokeStyle = rgba(SC.ray, 0.8);
      g.beginPath();
      g.moveTo(sp0.x, sp0.y);
      g.lineTo(near.x, near.y);
      g.stroke();
      // to the far ear: from the source to where its line just grazes the
      // head, then around the head (Woodworth's path)
      const phiS = Math.atan2(u.y, u.x);
      const off = Math.acos(Math.min(1, a / R));
      const cands = [phiS + off, phiS - off].map((p) => ({ x: center.x + a * Math.cos(p), y: center.y + a * Math.sin(p), p }));
      const tp = cands.sort((p, q) => Math.hypot(p.x - far.x, p.y - far.y) - Math.hypot(q.x - far.x, q.y - far.y))[0];
      g.strokeStyle = rgba([255, 179, 200], 0.8);
      g.beginPath();
      g.moveTo(sp0.x, sp0.y);
      g.lineTo(tp.x, tp.y);
      const a1 = Math.atan2(far.y - center.y, far.x - center.x);
      let da = a1 - tp.p;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      g.arc(center.x, center.y, a, tp.p, tp.p + da, da < 0);
      g.stroke();

      // the head, nose up
      g.save();
      g.shadowColor = rgba(SC.lis, 0.7);
      g.shadowBlur = 16 * d;
      g.fillStyle = "#161d2e";
      g.strokeStyle = rgba(SC.lis, 0.9);
      g.lineWidth = 2 * d;
      g.beginPath();
      g.moveTo(center.x, center.y - a * 1.32);
      g.lineTo(center.x - a * 0.28, center.y - a * 0.9);
      g.lineTo(center.x + a * 0.28, center.y - a * 0.9);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(center.x, center.y, a, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
      ears.forEach((e, i) => {
        g.fillStyle = i === 0 ? "#9fd0ff" : "#ffb3c8";
        g.beginPath();
        g.ellipse(e.x, e.y, a * 0.14, a * 0.3, 0, 0, Math.PI * 2);
        g.fill();
      });
      label(g, "L", ears[0].x - a * 0.4, center.y, 11 * d, "#9fd0ff", "center", 700);
      label(g, "R", ears[1].x + a * 0.4, center.y, 11 * d, "#ffb3c8", "center", 700);
      // the source
      const sp = { x: center.x + R * u.x, y: center.y + R * u.y };
      g.save();
      g.shadowColor = rgba(SC.src, 0.9);
      g.shadowBlur = 16 * d;
      g.fillStyle = rgba(SC.src, 1);
      g.beginPath();
      g.arc(sp.x, sp.y, 8 * d, 0, Math.PI * 2);
      g.fill();
      g.restore();

      // ---- right: the two cues, in numbers ----
      const rx = narrow ? pad : leftW + pad * 0.5;
      const ry = narrow ? topH + pad * 0.2 : pad;
      const rw = Wc - rx - pad;
      const rh = Hc - ry - pad;
      g.fillStyle = "#0b0d14";
      roundRect(g, rx, ry, rw, rh, 8 * d);
      g.fill();
      const itd = itdSeconds(s);
      const maxItd = itdSeconds(1);
      const useT = mode === "both" || mode === "itd";
      const useL = mode === "both" || mode === "ild";
      label(g, "time difference", rx + 12 * d, ry + 16 * d, 10.5 * d, SC.muted);
      label(g, `${Math.abs(itd * 1e6).toFixed(0)} µs`, rx + rw - 12 * d, ry + 16 * d, 13 * d, useT ? "#ffe2c2" : SC.muted, "right", 700, true);
      const bx = rx + 12 * d;
      const bw = rw - 24 * d;
      const by = ry + 30 * d;
      g.fillStyle = "rgba(150,160,200,0.1)";
      g.fillRect(bx, by, bw, 8 * d);
      g.fillStyle = useT ? "#ffb86b" : "rgba(150,160,200,0.3)";
      const mid = bx + bw / 2;
      const len = (itd / maxItd) * (bw / 2);
      g.fillRect(Math.min(mid, mid + len), by, Math.abs(len), 8 * d);
      g.fillStyle = "#fff";
      g.fillRect(mid - d, by - 3 * d, 2 * d, 14 * d);
      label(g, "left ear first", bx, by + 20 * d, 9 * d, SC.muted, "left", 500);
      label(g, "right ear first", bx + bw, by + 20 * d, 9 * d, SC.muted, "right", 500);
      label(g, `(max ${(maxItd * 1e6).toFixed(0)} µs)`, mid, by + 20 * d, 9 * d, SC.muted, "center", 500, true);

      // level per ear against frequency
      const py0 = by + 48 * d;
      label(g, "level at each ear", rx + 12 * d, py0, 10.5 * d, SC.muted);
      const gx0 = rx + 40 * d;
      const gy0 = py0 + 14 * d;
      const gw = rw - 54 * d;
      const gh = Math.max(40 * d, ry + rh - gy0 - 26 * d);
      const dbTop = 8;
      const dbBot = -22;
      const yOf = (db: number): number => gy0 + ((dbTop - db) / (dbTop - dbBot)) * gh;
      const xOf = (f: number): number => gx0 + (Math.log(f / 100) / Math.log(16000 / 100)) * gw;
      g.strokeStyle = "rgba(150,160,200,0.12)";
      g.lineWidth = d;
      for (const db of [6, 0, -10, -20]) {
        g.beginPath();
        g.moveTo(gx0, yOf(db));
        g.lineTo(gx0 + gw, yOf(db));
        g.stroke();
        label(g, `${db > 0 ? "+" : ""}${db}`, gx0 - 6 * d, yOf(db), 9 * d, SC.muted, "right", 500, true);
      }
      for (const f of [100, 1000, 10000]) label(g, f >= 1000 ? `${f / 1000}k` : `${f}`, xOf(f), gy0 + gh + 11 * d, 9 * d, SC.muted, "center", 500, true);
      label(g, "Hz", gx0 + gw, gy0 + gh + 11 * d, 9 * d, SC.muted, "right", 500, true);
      for (const e of [0, 1]) {
        const side = e === 0 ? -1 : 1;
        const inc = Math.acos(Math.max(-1, Math.min(1, side * s)));
        g.strokeStyle = e === 0 ? "#9fd0ff" : "#ffb3c8";
        g.globalAlpha = useL ? 1 : 0.3;
        g.lineWidth = 2 * d;
        g.beginPath();
        for (let i = 0; i <= 80; i++) {
          const f = 100 * Math.pow(160, i / 80);
          const db = useL ? 20 * Math.log10(headShadowMag(f, inc)) : 0;
          const x = xOf(f);
          const y = yOf(Math.max(dbBot, db));
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
        g.globalAlpha = 1;
      }
      label(g, mode === "pan" ? "plain pan: only the level changes, the same at every frequency" : `head radius ${(HEAD_RADIUS * 100).toFixed(2)} cm`, gx0 + gw, gy0 + 6 * d, 9 * d, SC.muted, "right", 500);
    },
  };
}
