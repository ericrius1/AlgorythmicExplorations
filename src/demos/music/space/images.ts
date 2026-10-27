// Fig: the image-source method in a floor plan. The room is surrounded by
// its own mirror images; every copy of the source is one reflection path.
// Below, the echogram: when each path arrives and how loud it is. Clap to
// hear the reflections up to the chosen order (no reverb tail, so what you
// hear is only these paths).

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { buildIR } from "./ir";
import { C_SOUND, flatMaterial, imageSources, type Image, type Room } from "./room";
import { clapSamples, sampleRate } from "./sound";
import { Plan, RoomVoice, SC, dragger, drawHead, drawSource, irBuffer, label, monoBuffer, playGate, rgba, smallButton, stage, ui, type P2, narrowScreen } from "./kit";

const L = 6;
const W = 4;
const ORDER_COL = ["#ffe2b8", "#ffb86b", "#ff8f6b", "#e46fa0", "#a08cff", "#7aa2ff", "#5ad1e6", "#5ad1e6"];
const orderCol = (o: number): string => ORDER_COL[Math.min(o, ORDER_COL.length - 1)];

// Fold a point of the mirrored plane back into the real room.
function fold(v: number, size: number): number {
  const m = ((v % (2 * size)) + 2 * size) % (2 * size);
  return m <= size ? m : 2 * size - m;
}

// The real path an image stands for: the straight line from the image to the
// listener, folded back into the room at every wall it crosses.
function foldedPath(im: P2, lis: P2): P2[] {
  const ts = [0, 1];
  const dx = lis.x - im.x;
  const dy = lis.y - im.y;
  const lines = (a: number, d: number, size: number): void => {
    if (Math.abs(d) < 1e-9) return;
    const lo = Math.min(a, a + d);
    const hi = Math.max(a, a + d);
    for (let k = Math.ceil(lo / size); k * size <= hi; k++) {
      const t = (k * size - a) / d;
      if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
    }
  };
  lines(im.x, dx, L);
  lines(im.y, dy, W);
  ts.sort((a, b) => a - b);
  return ts.map((t) => ({ x: fold(im.x + dx * t, L), y: fold(im.y + dy * t, W) }));
}

export function mountImageSources(container: HTMLElement): Demo {
  const shell = new Shell(container, narrowScreen() ? 1.15 : 0.74);
  const cv = shell.canvas;
  const g = cv.getContext("2d")!;
  const wrap = stage(shell);
  let order = 3;
  let alpha = 0.2;
  let src: P2 = { x: 1.7, y: 1.3 };
  let lis: P2 = { x: 4.3, y: 2.7 };
  const room = (): Room => {
    const id = flatMaterial(alpha);
    return { L, W, H: 3, surf: [id, id, id, id, "acoustic", "acoustic"] };
  };
  let images: Image[] = [];
  let selected = -1;
  const plan = new Plan(L, W);
  let voice: RoomVoice | null = null;
  let clapBuf: AudioBuffer | null = null;
  let soundOn = false;
  let dirty = true;
  let lastClap = -10;

  const solve = (): void => {
    // floor and ceiling are skipped: this is a flat, 2D room
    images = imageSources(room(), { ...src, z: 1.5 }, { ...lis, z: 1.5 }, C_SOUND * 0.16, order, [4, 5]);
    if (selected >= images.length) selected = -1;
    if (selected < 0) {
      // park the probe on a second-order path so the figure shows one without hovering
      const i = images.findIndex((m) => m.order === Math.min(2, order));
      selected = i;
    }
  };
  solve();

  const rebuild = (): void => {
    if (!voice) return;
    const fs = sampleRate();
    const ir = buildIR(room(), { ...src, z: 1.5 }, { pos: { ...lis, z: 1.5 }, yaw: Math.PI }, { fs, binaural: true, late: false, maxOrder: order, skip: [4, 5], maxLength: 0.25 });
    voice.setIR(irBuffer(ir, fs, 1.3), 0.02);
    dirty = false;
  };

  const clap = (): void => {
    if (!voice || !clapBuf) return;
    if (dirty) rebuild();
    voice.fire(clapBuf, 0.9);
    lastClap = performance.now() / 1000;
  };

  const start = (): void => {
    if (!voice) {
      voice = new RoomVoice();
      clapBuf = monoBuffer(clapSamples(sampleRate()), sampleRate());
    }
    voice.fadeTo(1, 0.04);
    soundOn = true;
    dirty = true;
    clap();
  };
  const gate = playGate(wrap, "Tap to clap", "then drag the dots or change the order", start);
  const guard = frameGuard(() => {
    if (!soundOn) return;
    soundOn = false;
    voice?.fadeTo(0, 0.08);
    gate.show("Tap to clap again");
  });

  const changed = (replay: boolean): void => {
    solve();
    dirty = true;
    if (replay && soundOn) clap();
  };

  shell.slider({
    label: "reflection order",
    min: 0,
    max: 12,
    step: 1,
    value: order,
    format: (v) => (v === 0 ? "0 (direct only)" : String(v)),
    onInput: (v) => {
      order = v;
      selected = -1;
      changed(true);
    },
  });
  shell.slider({
    label: "wall absorption α",
    min: 0.02,
    max: 0.9,
    step: 0.01,
    value: alpha,
    format: (v) => v.toFixed(2),
    onInput: (v) => {
      alpha = v;
      changed(false);
    },
  }).addEventListener("change", () => soundOn && clap());
  smallButton(shell.controls, "clap", () => (soundOn ? clap() : gate.el.click()));

  // layout, computed per frame
  let echo = { x: 0, y: 0, w: 0, h: 0, tmax: 0.1 };

  dragger(
    cv,
    () => [
      { pos: () => plan.px(src), move: (p) => ((src = plan.clampIn(plan.m(p.x, p.y), 0.2)), changed(false)), end: () => soundOn && clap(), r: 24 },
      { pos: () => plan.px(lis), move: (p) => ((lis = plan.clampIn(plan.m(p.x, p.y), 0.25)), changed(false)), end: () => soundOn && clap(), r: 26 },
    ],
    (p) => {
      // tap an image (or an echogram bar) to see its path
      let best = -1;
      let bd = Infinity;
      if (p.y > echo.y - 8) {
        images.forEach((m, i) => {
          const x = echo.x + ((m.dist / C_SOUND) / echo.tmax) * echo.w;
          const dd = Math.abs(x - p.x);
          if (dd < bd) {
            bd = dd;
            best = i;
          }
        });
      } else {
        images.forEach((m, i) => {
          const q = plan.px(m.pos);
          const dd = Math.hypot(q.x - p.x, q.y - p.y);
          if (dd < bd) {
            bd = dd;
            best = i;
          }
        });
      }
      if (best >= 0) selected = best;
    },
  );

  shell.setInfo(() => {
    const n = images.filter((m) => m.order <= order).length;
    const d = images[0];
    const sel = images[selected];
    return `${n} paths in 160 ms · direct ${((d?.dist ?? 0) / C_SOUND * 1000).toFixed(1)} ms` + (sel ? ` · selected: order ${sel.order}, ${(sel.dist / C_SOUND * 1000).toFixed(1)} ms` : "");
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
      const echoH = (narrow ? 96 : 120) * d;
      const pad = 14 * d;
      // the view: the real room plus two mirror rooms on each side (fewer on phones)
      const span = narrow ? 3 : 5;
      plan.fit(pad, pad, Wc - pad * 2, Hc - echoH - pad * 3, L * span, W * span * 0.62);
      const a0 = plan.px({ x: 0, y: 0 });
      // mirror rooms
      const kx = Math.ceil(span / 2) + 1;
      const ky = Math.ceil((span * 0.62) / 2) + 2;
      g.lineWidth = d;
      for (let i = -kx; i <= kx; i++)
        for (let j = -ky; j <= ky; j++) {
          const x = a0.x + i * L * plan.s;
          const y = a0.y + j * W * plan.s;
          const ord = Math.abs(i) + Math.abs(j);
          g.fillStyle = i === 0 && j === 0 ? "#111521" : ord % 2 ? "#0a0c13" : "#0c0e16";
          g.fillRect(x, y, L * plan.s, W * plan.s);
          g.strokeStyle = "rgba(150,160,200,0.13)";
          g.strokeRect(x, y, L * plan.s, W * plan.s);
        }
      // the real room's walls
      g.save();
      g.shadowColor = "rgba(220,230,255,0.6)";
      g.shadowBlur = 8 * d;
      g.strokeStyle = `rgba(230,235,250,${0.35 + 0.6 * (1 - alpha)})`;
      g.lineWidth = 3 * d;
      g.strokeRect(a0.x, a0.y, L * plan.s, W * plan.s);
      g.restore();

      const sel = images[selected];
      const lp = plan.px(lis);
      if (sel) {
        // the unfolded line from the image to the listener
        const ip = plan.px(sel.pos);
        g.strokeStyle = rgba(SC.ray, 0.35);
        g.setLineDash([5 * d, 5 * d]);
        g.lineWidth = 1.4 * d;
        g.beginPath();
        g.moveTo(ip.x, ip.y);
        g.lineTo(lp.x, lp.y);
        g.stroke();
        g.setLineDash([]);
        // and the real path it stands for, inside the room
        const pts = foldedPath(sel.pos, lis).map((q) => plan.px(q));
        g.save();
        g.shadowColor = orderCol(sel.order);
        g.shadowBlur = 10 * d;
        g.strokeStyle = orderCol(sel.order);
        g.lineWidth = 2.2 * d;
        g.lineJoin = "round";
        g.beginPath();
        pts.forEach((q, k) => (k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.stroke();
        g.restore();
        for (const q of pts.slice(1, -1)) {
          g.fillStyle = "#fff";
          g.beginPath();
          g.arc(q.x, q.y, 2.6 * d, 0, Math.PI * 2);
          g.fill();
        }
      }

      // image sources: size and brightness by level, colour by order
      const ref = images[0]?.gain[3] ?? 1;
      for (let i = images.length - 1; i >= 0; i--) {
        const m = images[i];
        const q = plan.px(m.pos);
        if (q.x < -10 || q.y < -10 || q.x > Wc + 10 || q.y > Hc - echoH - pad) continue;
        if (m.order === 0) continue;
        const db = 20 * Math.log10(m.gain[3] / ref);
        const k = Math.max(0, 1 + db / 36);
        g.fillStyle = orderCol(m.order);
        g.globalAlpha = 0.25 + 0.75 * k;
        g.beginPath();
        g.arc(q.x, q.y, (1.6 + 3.2 * k) * d, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        if (i === selected) {
          g.strokeStyle = "#fff";
          g.lineWidth = 1.5 * d;
          g.beginPath();
          g.arc(q.x, q.y, 9 * d, 0, Math.PI * 2);
          g.stroke();
        }
      }
      const pulse = Math.max(0, 1 - (performance.now() / 1000 - lastClap) / 0.4);
      drawSource(g, plan.px(src), 6 * d, d, pulse);
      drawHead(g, lp, Math.PI, 9 * d, d, 0.5);
      if (!narrow) {
        label(g, "the real room", a0.x + 6 * d, a0.y + 11 * d, 11 * d, "rgba(230,235,250,0.75)");
        label(g, "mirror rooms: each copy of the source is one reflection path", pad + 4 * d, pad + 10 * d, 11 * d, SC.muted);
      }

      // ---- echogram ----
      const ex = pad + 34 * d;
      const ey = Hc - echoH - pad * 0.5;
      const ew = Wc - ex - pad;
      const eh = echoH - 26 * d;
      const tmax = 0.1;
      echo = { x: ex, y: ey, w: ew, h: eh, tmax };
      g.fillStyle = "#0b0d14";
      g.fillRect(ex, ey, ew, eh);
      g.strokeStyle = "rgba(150,160,200,0.12)";
      g.lineWidth = d;
      for (let db = 0; db >= -36; db -= 12) {
        const y = ey + (-db / 40) * eh;
        g.beginPath();
        g.moveTo(ex, y);
        g.lineTo(ex + ew, y);
        g.stroke();
        label(g, `${db}`, ex - 6 * d, y, 9.5 * d, SC.muted, "right", 500, true);
      }
      label(g, "dB", ex - 6 * d, ey - 9 * d, 9.5 * d, SC.muted, "right", 500, true);
      for (let t = 0; t <= tmax + 1e-9; t += 0.02) {
        const x = ex + (t / tmax) * ew;
        label(g, `${Math.round(t * 1000)} ms`, x, ey + eh + 12 * d, 9.5 * d, SC.muted, t === 0 ? "left" : "center", 500, true);
      }
      for (let i = images.length - 1; i >= 0; i--) {
        const m = images[i];
        const t = m.dist / C_SOUND;
        if (t > tmax) continue;
        const db = 20 * Math.log10(m.gain[3] / ref);
        const hgt = Math.max(0, (1 + db / 40) * eh);
        const x = ex + (t / tmax) * ew;
        g.strokeStyle = orderCol(m.order);
        g.globalAlpha = i === selected ? 1 : 0.8;
        g.lineWidth = (i === selected ? 3 : 1.6) * d;
        g.beginPath();
        g.moveTo(x, ey + eh);
        g.lineTo(x, ey + eh - hgt);
        g.stroke();
        g.globalAlpha = 1;
      }
      // a playhead after each clap
      const since = performance.now() / 1000 - lastClap;
      if (since < 0.6) {
        const x = ex + Math.min(1, (since / 6) / tmax) * ew; // shown at 1/6 speed
        g.strokeStyle = "rgba(255,255,255,0.35)";
        g.beginPath();
        g.moveTo(x, ey);
        g.lineTo(x, ey + eh);
        g.stroke();
      }
      // order legend
      const lx = ex + ew - 6 * d;
      let off = 0;
      for (let o = Math.min(order, 6); o >= 0; o--) {
        const txt = o === 6 && order > 6 ? "6+" : String(o);
        g.fillStyle = orderCol(o);
        g.fillRect(lx - off - 8 * d, ey + 6 * d, 8 * d, 8 * d);
        label(g, txt, lx - off - 11 * d, ey + 10 * d, 9.5 * d, SC.muted, "right", 600, true);
        off += 28 * d;
      }
      label(g, "order", lx - off - 6 * d, ey + 10 * d, 9.5 * d, SC.muted, "right");
    },
  };
}
