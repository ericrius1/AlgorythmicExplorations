// Hero for Acoustic Spaces part 1: a floor plan with a live wave simulation.
// Tap anywhere in the room to clap there. The ripple shows the sound
// spreading and bouncing (slowed down a lot), and you hear the clap the way
// the head in the room would, through a binaural impulse response built for
// that spot. Drag the head to move the listener.

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { Wave2D } from "./wave2d";
import { buildIR } from "./ir";
import { C_SOUND, material, meanAlpha, eyring, type Room } from "./room";
import { clapSamples, sampleRate } from "./sound";
import { Plan, RoomVoice, SC, dragger, drawHead, irBuffer, label, monoBuffer, playGate, rgba, stage, ui, type P2, narrowScreen } from "./kit";

const ROOM: Room = { L: 12, W: 7, H: 4, surf: ["brick", "glass", "wood", "plaster", "woodfloor", "plaster"] };
const CELL = 0.03; // metres per wave cell
const WAVE_SPEED = Math.sqrt(0.42); // cells per step
const STEPS_PER_S = 270; // simulation steps per second of page time

interface Clap {
  at: P2;
  t0: number; // page seconds
  paths: { pts: P2[]; len: number }[];
}

// Direct path plus the four first-order wall reflections, in the plan.
function firstPaths(s: P2, l: P2): { pts: P2[]; len: number }[] {
  const out = [{ pts: [s, l], len: Math.hypot(s.x - l.x, s.y - l.y) }];
  const imgs: [P2, (a: P2, b: P2) => P2][] = [
    [{ x: -s.x, y: s.y }, (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) })],
    [{ x: 2 * ROOM.L - s.x, y: s.y }, (a, b) => ({ x: ROOM.L, y: a.y + ((b.y - a.y) * (ROOM.L - a.x)) / (b.x - a.x) })],
    [{ x: s.x, y: -s.y }, (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y), y: 0 })],
    [{ x: s.x, y: 2 * ROOM.W - s.y }, (a, b) => ({ x: a.x + ((b.x - a.x) * (ROOM.W - a.y)) / (b.y - a.y), y: ROOM.W })],
  ];
  for (const [im, hit] of imgs) {
    const h = hit(im, l);
    out.push({ pts: [s, h, l], len: Math.hypot(im.x - l.x, im.y - l.y) });
  }
  return out;
}

export function mountSpaceHero(container: HTMLElement): Demo {
  const shell = new Shell(container, narrowScreen() ? 0.8 : 0.6);
  const cv = shell.canvas;
  const g = cv.getContext("2d")!;
  const wrap = stage(shell);
  const gw = Math.round(ROOM.L / CELL) + 4;
  const gh = Math.round(ROOM.W / CELL) + 4;
  const wave = new Wave2D(gw, gh);
  const ma = meanAlpha(ROOM);
  const wallAbs = ROOM.surf.slice(0, 4).map((id) => {
    const a = material(id).alpha;
    return Math.min(0.5, (a[2] + a[3]) * 0.6);
  }) as [number, number, number, number];
  wave.setRoom(2, 2, gw - 2, gh - 2, wallAbs);
  wave.baseDamp = 0.0009 + ma[3] * 0.002;
  const plan = new Plan(ROOM.L, ROOM.W);
  let lis: P2 = { x: 8.4, y: 4.6 };
  const yaw = Math.PI; // facing the top wall
  const claps: Clap[] = [];
  let voice: RoomVoice | null = null;
  let clapBuf: AudioBuffer | null = null;
  let soundOn = false;
  const irCache = new Map<string, AudioBuffer>();
  const T = eyring(ROOM);

  const irFor = (p: P2): AudioBuffer => {
    const key = `${p.x.toFixed(1)},${p.y.toFixed(1)},${lis.x.toFixed(1)},${lis.y.toFixed(1)}`;
    let b = irCache.get(key);
    if (!b) {
      const fs = sampleRate();
      const ir = buildIR(ROOM, { x: p.x, y: p.y, z: 1.4 }, { pos: { x: lis.x, y: lis.y, z: 1.6 }, yaw }, { fs, binaural: true, maxLength: 3 });
      b = irBuffer(ir, fs, 1);
      if (irCache.size > 40) irCache.clear();
      irCache.set(key, b);
    }
    return b;
  };

  const clap = (p: P2, audible: boolean): void => {
    const now = performance.now() / 1000;
    wave.pulse(2 + p.x / CELL, 2 + p.y / CELL, audible ? 1.6 : 1.0, 2.8);
    claps.push({ at: p, t0: now, paths: firstPaths(p, lis) });
    if (claps.length > 6) claps.shift();
    if (audible && voice && clapBuf) {
      voice.setIR(irFor(p), 0.01);
      voice.fire(clapBuf, 0.9);
    }
  };

  const start = (): void => {
    if (!voice) {
      voice = new RoomVoice();
      clapBuf = monoBuffer(clapSamples(sampleRate()), sampleRate());
    }
    voice.fadeTo(1, 0.05);
    soundOn = true;
    clap({ x: 3.2, y: 2.6 }, true);
  };
  const gate = playGate(wrap, "Tap to clap", "then tap anywhere in the room", start);

  const guard = frameGuard(() => {
    if (!soundOn) return;
    soundOn = false;
    voice?.fadeTo(0, 0.08);
    gate.show("Tap to clap again");
  });

  dragger(
    cv,
    () => [
      {
        pos: () => plan.px(lis),
        move: (p) => {
          lis = plan.clampIn(plan.m(p.x, p.y), 0.4);
        },
        r: 30,
      },
    ],
    (p) => {
      const m = plan.m(p.x, p.y);
      if (m.x < 0 || m.y < 0 || m.x > ROOM.L || m.y > ROOM.W) return;
      if (!soundOn) {
        gate.el.click();
        return;
      }
      clap(plan.clampIn(m, 0.15), true);
    },
  );

  // a slow, silent rain of claps until the reader takes over
  let nextAmbient = 0.6;
  let seed = 11;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let simT = performance.now() / 1000;
  const t0 = simT;

  shell.setInfo(() => `RT60 ${T[3].toFixed(1)} s at 1 kHz · ${ROOM.L} × ${ROOM.W} × ${ROOM.H} m · sound slowed ${Math.round((C_SOUND / CELL) / (WAVE_SPEED * STEPS_PER_S))}×`);

  return {
    frame() {
      guard.pulse();
      shell.tick();
      const now = performance.now() / 1000;
      if (!soundOn && now - t0 > nextAmbient) {
        nextAmbient = now - t0 + 3.4;
        clap({ x: 1 + rnd() * (ROOM.L - 2), y: 0.8 + rnd() * (ROOM.W - 1.6) }, false);
      }
      // advance the simulation at a fixed rate of steps per second
      const want = Math.min(10, Math.round((now - simT) * STEPS_PER_S));
      if (want > 0) {
        wave.step(want);
        simT += want / STEPS_PER_S;
      }
      if (now - simT > 0.5) simT = now;

      const d = ui(cv);
      const W = cv.width;
      const H = cv.height;
      g.fillStyle = SC.bg;
      g.fillRect(0, 0, W, H);
      const narrow = W / d < 640;
      const top = (narrow ? 84 : 92) * d; // clear of the site nav and the readout
      const side = (narrow ? 22 : 64) * d;
      plan.fit(side, top, W - side * 2, H - top - 30 * d);
      const a = plan.px({ x: 0, y: 0 });
      const rw = ROOM.L * plan.s;
      const rh = ROOM.W * plan.s;

      // the wave field, one cell per texel, smoothed up to the room's size
      wave.render(7);
      g.save();
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(wave.canvas, 2, 2, gw - 4, gh - 4, a.x, a.y, rw, rh);
      g.restore();
      g.strokeStyle = "rgba(140,150,190,0.06)";
      g.lineWidth = d;
      g.beginPath();
      for (let x = 1; x < ROOM.L; x++) {
        g.moveTo(a.x + x * plan.s, a.y);
        g.lineTo(a.x + x * plan.s, a.y + rh);
      }
      for (let y = 1; y < ROOM.W; y++) {
        g.moveTo(a.x, a.y + y * plan.s);
        g.lineTo(a.x + rw, a.y + y * plan.s);
      }
      g.stroke();

      // walls, coloured by material
      const walls: [number, number, number, number, string][] = [
        [a.x, a.y, a.x, a.y + rh, ROOM.surf[0]],
        [a.x + rw, a.y, a.x + rw, a.y + rh, ROOM.surf[1]],
        [a.x, a.y, a.x + rw, a.y, ROOM.surf[2]],
        [a.x, a.y + rh, a.x + rw, a.y + rh, ROOM.surf[3]],
      ];
      for (const [x0, y0, x1, y1, id] of walls) {
        const col = material(id).color;
        g.save();
        g.shadowColor = col;
        g.shadowBlur = 12 * d;
        g.strokeStyle = col;
        g.lineWidth = 4 * d;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
        g.restore();
      }
      const fs = (narrow ? 10 : 11) * d;
      label(g, material(ROOM.surf[2]).name, a.x + rw / 2, a.y - 12 * d, fs, "rgba(200,170,130,0.8)", "center");
      label(g, material(ROOM.surf[3]).name, a.x + rw / 2, a.y + rh + 13 * d, fs, "rgba(220,215,205,0.7)", "center");
      g.save();
      g.translate(a.x - 13 * d, a.y + rh / 2);
      g.rotate(-Math.PI / 2);
      label(g, material(ROOM.surf[0]).name, 0, 0, fs, "rgba(220,150,120,0.8)", "center");
      g.restore();
      g.save();
      g.translate(a.x + rw + 13 * d, a.y + rh / 2);
      g.rotate(Math.PI / 2);
      label(g, material(ROOM.surf[1]).name, 0, 0, fs, "rgba(150,215,235,0.8)", "center");
      g.restore();

      // the first few paths of each clap light up as the slowed wavefront reaches them
      const metresPerS = WAVE_SPEED * STEPS_PER_S * CELL;
      for (const c of claps) {
        const r = (now - c.t0) * metresPerS;
        for (let i = 0; i < c.paths.length; i++) {
          const p = c.paths[i];
          const since = (r - p.len) / metresPerS;
          if (since < 0 || since > 1.6) continue;
          const alpha = Math.exp(-since * 2.2) * (i === 0 ? 0.9 : 0.6);
          g.strokeStyle = rgba(SC.ray, alpha);
          g.lineWidth = (i === 0 ? 2 : 1.4) * d;
          g.setLineDash(i === 0 ? [] : [5 * d, 4 * d]);
          g.beginPath();
          p.pts.forEach((q, k) => {
            const s = plan.px(q);
            if (k) g.lineTo(s.x, s.y);
            else g.moveTo(s.x, s.y);
          });
          g.stroke();
          g.setLineDash([]);
        }
        const age = now - c.t0;
        if (age < 1.2) {
          const s = plan.px(c.at);
          g.fillStyle = rgba(SC.src, 1 - age / 1.2);
          g.beginPath();
          g.arc(s.x, s.y, (4 + age * 6) * d, 0, Math.PI * 2);
          g.fill();
        }
      }
      while (claps.length && now - claps[0].t0 > 8) claps.shift();

      // listener, with a ring when any wavefront passes the ears
      let hit = 0;
      for (const c of claps) {
        const r = (now - c.t0) * metresPerS;
        for (const p of c.paths) {
          const since = (r - p.len) / metresPerS;
          if (since >= 0 && since < 0.25) hit = Math.max(hit, 1 - since / 0.25);
        }
      }
      const lp = plan.px(lis);
      const hr = Math.max(9 * d, Math.min(15 * d, plan.s * 0.28)) * (1 + 0.08 * hit);
      drawHead(g, lp, yaw, hr, d, 0.5 + hit);
    },
  };
}
