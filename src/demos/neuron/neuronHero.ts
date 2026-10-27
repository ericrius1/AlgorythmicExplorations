// Hero: a few neurons wired to each other, running live. Each cell is a leaky
// integrate-and-fire neuron fed by random background input. When one fires,
// a pulse runs down its axon at constant brightness (an action potential
// doesn't fade), splits at the branch point, and at each synapse starts a
// dim graded potential that spreads along the target's dendrite to its cell
// body and adds to the voltage there. Slowed down a lot, so it reads calmly.

import { Shell, type Demo } from "../../lib/demoShell";
import { begin, drawGlow, glow, rng, surface } from "./draw";

interface Path {
  pts: Float32Array; // x, y pairs
  cum: Float32Array; // arc length at each point
  len: number;
}

function makePath(xy: number[]): Path {
  const n = xy.length / 2;
  const pts = new Float32Array(xy);
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]);
  }
  return { pts, cum, len: cum[n - 1] };
}

function pointAt(p: Path, s: number): [number, number] {
  const d = Math.max(0, Math.min(p.len, s));
  let lo = 0;
  let hi = p.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] < d) lo = mid;
    else hi = mid;
  }
  const seg = p.cum[hi] - p.cum[lo] || 1;
  const f = (d - p.cum[lo]) / seg;
  return [p.pts[2 * lo] + (p.pts[2 * hi] - p.pts[2 * lo]) * f, p.pts[2 * lo + 1] + (p.pts[2 * hi + 1] - p.pts[2 * lo + 1]) * f];
}

interface Branch {
  xy: number[];
  w0: number;
  w1: number;
}

interface Cell {
  x: number;
  y: number;
  r: number;
  branches: Branch[]; // dendrites, for drawing
  leaves: Path[]; // tip → soma, for graded potentials
  trunk: Path | null;
  axonBranches: { path: Path; target: number; leaf: number }[];
  v: number; // mV above rest
  refractory: number; // s
  flash: number;
  spikes: number[]; // recent spike times, s
}

interface Pulse {
  path: Path;
  s: number;
  then: (() => void) | null;
}

interface Graded {
  path: Path;
  s: number;
  cell: number;
}

const THRESHOLD = 15; // mV above rest
const TAU = 0.9; // s (the model's 20 ms, slowed down)
const EPSP = 6.5; // mV per synaptic arrival
const BG_RATE = 5; // background kicks per second
const BG_KICK = 2.4; // mV

export function mountNeuronHero(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const sf = surface(shell.canvas);
  const { w, h } = sf;
  const r = rng(20251026);

  // the title covers the bottom of the frame on wide screens
  const overlay = window.matchMedia("(min-width: 46rem)").matches && !container.closest(".hero-title-below");
  const yMax = overlay ? 0.6 : 0.82;
  const u = Math.max(3.2, Math.min(w, h * 1.9) / 100);
  const count = w > 1000 ? 7 : w > 640 ? 6 : 4;

  // ---- place cell bodies, spread out
  const cells: Cell[] = [];
  for (let attempt = 0; cells.length < count && attempt < 4000; attempt++) {
    const x = w * (0.07 + r() * 0.86);
    const y = h * (0.14 + r() * (yMax - 0.14));
    const minD = Math.min(w, h * 2.2) * (count > 5 ? 0.2 : 0.3);
    if (cells.some((c) => Math.hypot(c.x - x, (c.y - y) * 1.3) < minD)) continue;
    cells.push({
      x,
      y,
      r: u * (1.05 + r() * 0.4),
      branches: [],
      leaves: [],
      trunk: null,
      axonBranches: [],
      v: r() * THRESHOLD * 0.7,
      refractory: 0,
      flash: 0,
      spikes: [],
    });
  }
  cells.sort((a, b) => a.x - b.x);

  // ---- dendrites: a few primaries that wander and fork
  const grow = (cell: Cell, x: number, y: number, ang: number, len: number, width: number, depth: number, trail: number[]): void => {
    const xy = [x, y];
    const steps = Math.max(3, Math.round(len / (0.8 * u)));
    let a = ang;
    let px = x;
    let py = y;
    for (let i = 0; i < steps; i++) {
      a += (r() - 0.5) * 0.32;
      px += (Math.cos(a) * len) / steps;
      py += (Math.sin(a) * len) / steps;
      xy.push(px, py);
    }
    cell.branches.push({ xy, w0: width, w1: width * 0.6 });
    const full = trail.concat(xy.slice(2));
    if (depth === 0) {
      const rev: number[] = [];
      for (let i = full.length - 2; i >= 0; i -= 2) rev.push(full[i], full[i + 1]);
      cell.leaves.push(makePath(rev));
      return;
    }
    const spread = 0.35 + r() * 0.35;
    grow(cell, px, py, a - spread, len * (0.6 + r() * 0.2), width * 0.6, depth - 1, full);
    grow(cell, px, py, a + spread, len * (0.6 + r() * 0.2), width * 0.6, depth - 1, full);
  };

  // ---- connections: each cell sends its axon to the one or two nearest cells
  //      ahead of it (left to right, wrapping), so activity tends to flow
  const targetsOf = (i: number): number[] => {
    const others = cells
      .map((c, j) => ({ j, d: Math.hypot(c.x - cells[i].x, c.y - cells[i].y) + (c.x < cells[i].x ? w * 0.35 : 0) }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d);
    const n = r() < 0.55 ? 2 : 1;
    return others.slice(0, n).map((o) => o.j);
  };
  const plan = cells.map((_, i) => targetsOf(i));

  cells.forEach((cell, i) => {
    // average direction the axon will leave in
    let ax = 0;
    let ay = 0;
    for (const j of plan[i]) {
      ax += cells[j].x - cell.x;
      ay += cells[j].y - cell.y;
    }
    const axonAng = Math.atan2(ay, ax);
    const prim = 4 + Math.floor(r() * 3);
    for (let k = 0; k < prim; k++) {
      // leave a gap around the axon hillock
      const a = axonAng + 0.7 + ((Math.PI * 2 - 1.4) * (k + 0.2 + r() * 0.6)) / prim;
      const len = u * (4.5 + r() * 4);
      grow(cell, cell.x + Math.cos(a) * cell.r * 0.9, cell.y + Math.sin(a) * cell.r * 0.9, a, len, u * 0.42, 2, [cell.x, cell.y]);
    }
  });

  // axons, built once every cell has its dendrites
  const curveXY = (x0: number, y0: number, a0: number, x1: number, y1: number, wobble: number): number[] => {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const c1x = x0 + Math.cos(a0) * d * 0.4;
    const c1y = y0 + Math.sin(a0) * d * 0.4;
    const c2x = x1 - (x1 - x0) * 0.3 + (r() - 0.5) * d * 0.3;
    const c2y = y1 - (y1 - y0) * 0.3 + (r() - 0.5) * d * 0.3;
    const n = Math.max(8, Math.round(d / (0.9 * u)));
    const out: number[] = [];
    const ph = r() * 6;
    // gentle meander: about one wave per 12 units of length, never more than
    // a few percent of the path's length sideways
    const waves = Math.max(0.5, d / (12 * u));
    const amp = Math.min(wobble, d * 0.035);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const it = 1 - t;
      let x = it * it * it * x0 + 3 * it * it * t * c1x + 3 * it * t * t * c2x + t * t * t * x1;
      let y = it * it * it * y0 + 3 * it * it * t * c1y + 3 * it * t * t * c2y + t * t * t * y1;
      const wob = Math.sin(t * Math.PI) * Math.sin(t * waves * Math.PI * 2 + ph) * amp;
      x += -Math.sin(a0) * wob;
      y += Math.cos(a0) * wob;
      out.push(x, y);
    }
    return out;
  };
  const nearestLeaf = (target: Cell, x: number, y: number): number => {
    let best = 0;
    let bd = Infinity;
    target.leaves.forEach((p, k) => {
      const d = Math.hypot(p.pts[0] - x, p.pts[1] - y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  };
  cells.forEach((cell, i) => {
    let ax = 0;
    let ay = 0;
    for (const j of plan[i]) {
      ax += cells[j].x - cell.x;
      ay += cells[j].y - cell.y;
    }
    const a0 = Math.atan2(ay, ax);
    const sx = cell.x + Math.cos(a0) * cell.r;
    const sy = cell.y + Math.sin(a0) * cell.r;
    const mean = Math.hypot(ax, ay) / plan[i].length;
    const bx = sx + Math.cos(a0) * mean * 0.38;
    const by = sy + Math.sin(a0) * mean * 0.38;
    cell.trunk = makePath(curveXY(sx, sy, a0, bx, by, u * 0.5));
    for (const j of plan[i]) {
      const leaf = nearestLeaf(cells[j], bx, by);
      const tip = cells[j].leaves[leaf];
      const ex = tip.pts[0];
      const ey = tip.pts[1];
      const xy = curveXY(bx, by, Math.atan2(ey - by, ex - bx) + (r() - 0.5) * 0.6, ex, ey, u * 0.9);
      cell.axonBranches.push({ path: makePath(xy), target: j, leaf });
    }
  });

  // inputs from off-screen, so the network isn't feeding only on itself
  const externals: { path: Path; target: number; leaf: number; rate: number }[] = [];
  const edgeTargets = [0, cells.length - 1, Math.floor(cells.length / 2)];
  for (const j of edgeTargets.slice(0, cells.length > 4 ? 3 : 2)) {
    const t = cells[j];
    const fromLeft = t.x < w / 2;
    const sx = fromLeft ? -20 : w + 20;
    const sy = h * (0.1 + r() * 0.7);
    const leaf = nearestLeaf(t, sx, sy);
    const tip = t.leaves[leaf];
    const xy = curveXY(sx, sy, fromLeft ? 0.2 : Math.PI - 0.2, tip.pts[0], tip.pts[1], u * 1.2);
    externals.push({ path: makePath(xy), target: j, leaf, rate: 0.22 });
  }

  // ---- background: faint out-of-focus cells for depth
  const bgCells: Branch[] = [];
  for (let k = 0; k < (count > 5 ? 12 : 6); k++) {
    const x = r() * w;
    const y = r() * h;
    const prim = 4 + Math.floor(r() * 3);
    for (let p = 0; p < prim; p++) {
      const a = (Math.PI * 2 * (p + r() * 0.6)) / prim;
      const len = u * (3 + r() * 4) * 0.8;
      const xy = [x, y];
      let px = x;
      let py = y;
      let aa = a;
      for (let s = 0; s < 6; s++) {
        aa += (r() - 0.5) * 0.4;
        px += (Math.cos(aa) * len) / 6;
        py += (Math.sin(aa) * len) / 6;
        xy.push(px, py);
      }
      bgCells.push({ xy, w0: u * 0.35, w1: u * 0.12 });
    }
  }

  // ---- static layer: everything that doesn't move
  const layer = document.createElement("canvas");
  layer.width = shell.canvas.width;
  layer.height = shell.canvas.height;
  {
    const g = layer.getContext("2d")!;
    g.setTransform(sf.s, 0, 0, sf.s, 0, 0);
    const bg = g.createRadialGradient(w * 0.55, h * 0.35, 0, w * 0.55, h * 0.35, Math.max(w, h) * 0.8);
    bg.addColorStop(0, "#0d1120");
    bg.addColorStop(1, "#06070b");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    const stroke = (b: Branch, color: string): void => {
      const n = b.xy.length / 2;
      for (let i = 1; i < n; i++) {
        const f = i / (n - 1);
        g.lineWidth = b.w0 + (b.w1 - b.w0) * f;
        g.strokeStyle = color;
        g.beginPath();
        g.moveTo(b.xy[2 * i - 2], b.xy[2 * i - 1]);
        g.lineTo(b.xy[2 * i], b.xy[2 * i + 1]);
        g.stroke();
      }
    };
    g.lineCap = "round";
    for (const b of bgCells) stroke(b, "#10152a");

    g.shadowColor = "rgba(90,125,255,0.55)";
    g.shadowBlur = 8;
    const axonColor = "#5b6596";
    for (const c of cells) {
      if (c.trunk) stroke({ xy: Array.from(c.trunk.pts), w0: u * 0.32, w1: u * 0.26 }, axonColor);
      for (const ab of c.axonBranches) stroke({ xy: Array.from(ab.path.pts), w0: u * 0.24, w1: u * 0.14 }, axonColor);
    }
    for (const e of externals) stroke({ xy: Array.from(e.path.pts), w0: u * 0.2, w1: u * 0.14 }, "#3a4268");
    for (const c of cells) for (const b of c.branches) stroke(b, "#4c5fa8");
    for (const c of cells) {
      const sg = g.createRadialGradient(c.x - c.r * 0.3, c.y - c.r * 0.3, 0, c.x, c.y, c.r * 1.2);
      sg.addColorStop(0, "#5d6fb0");
      sg.addColorStop(1, "#232b4f");
      g.fillStyle = sg;
      g.beginPath();
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;
    // synaptic boutons
    g.fillStyle = "rgba(200,190,255,0.7)";
    for (const c of cells) {
      for (const ab of c.axonBranches) {
        const [x, y] = pointAt(ab.path, ab.path.len);
        g.beginPath();
        g.arc(x, y, u * 0.38, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const e of externals) {
      const [x, y] = pointAt(e.path, e.path.len);
      g.beginPath();
      g.arc(x, y, u * 0.32, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ---- model
  const pulses: Pulse[] = [];
  const graded: Graded[] = [];
  const boutonFlash = new Map<Path, number>();
  const AXON_SPEED = 14 * u; // CSS px per second
  const DEND_TIME = 0.55; // s for a graded potential to reach the soma
  let t = 0;
  let spikeCount = 0;

  const arrive = (target: number, leaf: number, via: Path): void => {
    boutonFlash.set(via, 1);
    graded.push({ path: cells[target].leaves[leaf], s: 0, cell: target });
  };
  const fire = (i: number): void => {
    const c = cells[i];
    c.v = 0;
    c.refractory = 0.25;
    c.flash = 1;
    c.spikes.push(t);
    spikeCount++;
    if (!c.trunk) return;
    pulses.push({
      path: c.trunk,
      s: 0,
      then: () => {
        for (const ab of c.axonBranches) {
          pulses.push({ path: ab.path, s: 0, then: () => arrive(ab.target, ab.leaf, ab.path) });
        }
      },
    });
  };

  const step = (dt: number): void => {
    t += dt;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      c.flash *= Math.exp(-dt / 0.35);
      if (c.refractory > 0) {
        c.refractory -= dt;
        continue;
      }
      c.v -= (c.v / TAU) * dt;
      if (r() < BG_RATE * dt) c.v += BG_KICK * (0.5 + r());
      if (c.v >= THRESHOLD) fire(i);
    }
    for (const e of externals) {
      if (r() < e.rate * dt) {
        pulses.push({ path: e.path, s: 0, then: () => arrive(e.target, e.leaf, e.path) });
      }
    }
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k];
      p.s += AXON_SPEED * dt;
      if (p.s >= p.path.len) {
        pulses.splice(k, 1);
        p.then?.();
      }
    }
    for (let k = graded.length - 1; k >= 0; k--) {
      const g = graded[k];
      g.s += (g.path.len / DEND_TIME) * dt;
      if (g.s >= g.path.len) {
        graded.splice(k, 1);
        const c = cells[g.cell];
        if (c.refractory <= 0) {
          c.v += EPSP;
          if (c.v >= THRESHOLD) fire(g.cell);
        }
      }
    }
    for (const [k, v] of boutonFlash) {
      const nv = v * Math.exp(-dt / 0.3);
      if (nv < 0.02) boutonFlash.delete(k);
      else boutonFlash.set(k, nv);
    }
  };

  // run it for a while first, so the first frame is already mid-conversation
  for (let k = 0; k < 40 * 60; k++) step(1 / 60);
  for (const c of cells) c.spikes = c.spikes.filter((s) => s > t - 10);

  shell.setInfo(() => {
    let n = 0;
    for (const c of cells) n += c.spikes.filter((s) => s > t - 20).length;
    return `${cells.length} cells · ${(n / 20).toFixed(1)} spikes/s`;
  });

  const head = glow([255, 205, 140], 0.85);
  const tail = glow([255, 170, 90], 0.3);
  const soft = glow([110, 160, 255], 0.25);
  const soma = glow([150, 180, 255], 0.5);
  const hot = glow([255, 214, 160], 0.7);
  let last = performance.now();

  return {
    frame: () => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      step(dt);
      for (const c of cells) while (c.spikes.length && c.spikes[0] < t - 20) c.spikes.shift();

      const ctx = begin(sf);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.setTransform(sf.s, 0, 0, sf.s, 0, 0);
      ctx.globalCompositeOperation = "lighter";

      // graded potentials: dim, spreading, fading toward the cell body
      for (const g of graded) {
        const f = g.s / g.path.len;
        const [x, y] = pointAt(g.path, g.s);
        drawGlow(ctx, soft, x, y, u * (1.4 + f * 1.6), 0.55 * (1 - f * 0.55));
      }
      // action potentials: a bright head with a short tail, same size the whole way
      for (const p of pulses) {
        for (let k = 1; k <= 6; k++) {
          const [x, y] = pointAt(p.path, p.s - k * u * 0.55);
          drawGlow(ctx, tail, x, y, u * (1.5 - k * 0.12), 0.5 - k * 0.07);
        }
        const [x, y] = pointAt(p.path, p.s);
        drawGlow(ctx, head, x, y, u * 2.1, 1);
      }
      for (const [path, v] of boutonFlash) {
        const [x, y] = pointAt(path, path.len);
        drawGlow(ctx, hot, x, y, u * 2.4, v * 0.8);
      }
      // cell bodies glow with their voltage and flash when they fire
      for (const c of cells) {
        const dep = Math.max(0, Math.min(1, c.v / THRESHOLD));
        drawGlow(ctx, soma, c.x, c.y, c.r * 3.2, 0.12 + dep * 0.45);
        if (c.flash > 0.02) drawGlow(ctx, hot, c.x, c.y, c.r * (3 + 4 * c.flash), c.flash * 0.9);
      }
      ctx.globalCompositeOperation = "source-over";
      shell.tick();
    },
  };
}
