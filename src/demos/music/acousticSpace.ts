import { Shell, type Demo } from "../../lib/demoShell";

type Point = { x: number; y: number };
type Band = { low: number; mid: number; high: number };

const WALL = { x: 0.42, y: 0.18, w: 0.12, h: 0.64 };
const WATER = { x: 0.66, y: 0.54, w: 0.2, h: 0.24 };
const BAND_COLORS = {
  low: "#79e6b1",
  mid: "#8fb6ff",
  high: "#ffcc7a",
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rectHit(a: Point, b: Point, rect: typeof WALL): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.w - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.h - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-6) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return t1 > 0 && t0 < 1;
}

function rectLength(a: Point, b: Point, rect: typeof WALL): number {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.w - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.h - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-6) {
      if (q < 0) return 0;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return 0;
    }
  }
  return Math.max(0, t1 - t0) * Math.hypot(dx, dy);
}

function worldToCanvas(p: Point, w: number, h: number): Point {
  return { x: p.x * w, y: p.y * h };
}

function drawRoom(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#101a22");
  g.addColorStop(1, "#071014");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(180,220,230,0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = (i / 10) * w;
    const y = (i / 10) * h;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(114,166,185,0.62)";
  ctx.fillRect(WALL.x * w, WALL.y * h, WALL.w * w, WALL.h * h);
  ctx.fillStyle = "rgba(52,213,239,0.18)";
  ctx.fillRect(WATER.x * w, WATER.y * h, WATER.w * w, WATER.h * h);
  ctx.strokeStyle = "rgba(52,213,239,0.45)";
  ctx.strokeRect(WATER.x * w, WATER.y * h, WATER.w * w, WATER.h * h);
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  p: Point,
  w: number,
  h: number,
  color: string,
  label: string,
): void {
  const q = worldToCanvas(p, w, h);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(q.x, q.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f3f7fa";
  ctx.font = "700 13px ui-sans-serif, system-ui";
  ctx.fillText(label, q.x + 14, q.y - 10);
}

function bandFromPath(a: Point, b: Point, leakage: number, waterDensity: number): Band {
  const blocked = rectHit(a, b, WALL);
  const water = rectLength(a, b, WATER) * waterDensity;
  const wall = blocked
    ? { low: 0.48 * leakage, mid: 0.16 * leakage, high: 0.045 * leakage }
    : { low: 1, mid: 1, high: 1 };
  return {
    low: wall.low * Math.exp(-0.12 * water),
    mid: wall.mid * Math.exp(-0.52 * water),
    high: wall.high * Math.exp(-1.7 * water),
  };
}

function drawBandBars(ctx: CanvasRenderingContext2D, x: number, y: number, band: Band): void {
  const entries: Array<[keyof Band, number]> = [
    ["low", band.low],
    ["mid", band.mid],
    ["high", band.high],
  ];
  ctx.font = "700 12px ui-sans-serif, system-ui";
  for (const [i, [key, value]] of entries.entries()) {
    const yy = y + i * 24;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x, yy, 132, 11);
    ctx.fillStyle = BAND_COLORS[key];
    ctx.fillRect(x, yy, value * 132, 11);
    ctx.fillStyle = "#dce6ed";
    ctx.fillText(`${key} ${Math.round(value * 100)}%`, x + 142, yy + 10);
  }
}

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point, w: number, h: number, color: string, width = 2): void {
  const aa = worldToCanvas(a, w, h);
  const bb = worldToCanvas(b, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(aa.x, aa.y);
  ctx.lineTo(bb.x, bb.y);
  ctx.stroke();
}

export function mountAcousticRoom(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.58);
  const ctx = shell.canvas.getContext("2d")!;
  let source: Point = { x: 0.23, y: 0.38 };
  let listener: Point = { x: 0.78, y: 0.37 };
  let leakage = 0.62;
  let waterDensity = 0.55;
  let drag: "source" | "listener" | null = null;

  shell.slider({
    label: "wall transmittance",
    min: 0,
    max: 1,
    step: 0.01,
    value: leakage,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      leakage = v;
    },
  });
  shell.slider({
    label: "water density",
    min: 0,
    max: 1,
    step: 0.01,
    value: waterDensity,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      waterDensity = v;
    },
  });

  const toWorld = (event: PointerEvent): Point => {
    const r = shell.canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - r.left) / r.width, 0.05, 0.95),
      y: clamp((event.clientY - r.top) / r.height, 0.08, 0.92),
    };
  };
  shell.canvas.addEventListener("pointerdown", (event) => {
    const p = toWorld(event);
    drag = dist(p, source) < dist(p, listener) ? "source" : "listener";
    shell.canvas.setPointerCapture(event.pointerId);
  });
  shell.canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const p = toWorld(event);
    if (drag === "source") source = p;
    else listener = p;
  });
  shell.canvas.addEventListener("pointerup", () => {
    drag = null;
  });

  shell.setInfo(() => {
    const b = bandFromPath(source, listener, leakage, waterDensity);
    const mean = (b.low + b.mid + b.high) / 3;
    return `${rectHit(source, listener, WALL) ? "occluded" : "visible"} · ${Math.round(mean * 100)}% audibility`;
  });

  return {
    frame() {
      shell.tick();
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      drawRoom(ctx, w, h);
      const band = bandFromPath(source, listener, leakage, waterDensity);
      line(ctx, source, listener, w, h, rectHit(source, listener, WALL) ? "rgba(255,191,71,0.75)" : "rgba(120,224,143,0.9)", 3);
      drawDot(ctx, source, w, h, "#ffbf47", "emitter");
      drawDot(ctx, listener, w, h, "#5de8ff", "listener");
      drawBandBars(ctx, 22, h - 92, band);
      ctx.fillStyle = "rgba(255,255,255,0.74)";
      ctx.font = "600 13px ui-sans-serif, system-ui";
      ctx.fillText("drag either dot; the bars are the simulated low/mid/high energy", 22, 28);
    },
  };
}

type Probe = { p: Point; id: number };

function probeList(count: number): Probe[] {
  const seeds: Point[] = [
    { x: 0.18, y: 0.18 }, { x: 0.27, y: 0.42 }, { x: 0.18, y: 0.76 },
    { x: 0.38, y: 0.12 }, { x: 0.36, y: 0.86 }, { x: 0.6, y: 0.14 },
    { x: 0.62, y: 0.42 }, { x: 0.61, y: 0.79 }, { x: 0.8, y: 0.22 },
    { x: 0.84, y: 0.58 }, { x: 0.77, y: 0.86 }, { x: 0.5, y: 0.06 },
  ];
  return seeds.slice(0, count).map((p, id) => ({ p, id }));
}

function graphEdges(probes: Probe[]): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  for (const a of probes) {
    const visible = probes
      .filter((b) => b.id !== a.id && !rectHit(a.p, b.p, WALL))
      .sort((l, r) => dist(a.p, l.p) - dist(a.p, r.p))
      .slice(0, 3);
    for (const b of visible) {
      const key: [number, number] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      if (!edges.some((e) => e[0] === key[0] && e[1] === key[1])) edges.push(key);
    }
  }
  return edges;
}

function shortestPath(source: Point, listener: Point, probes: Probe[], edges: Array<[number, number]>): number[] {
  const starts = probes
    .filter((p) => !rectHit(source, p.p, WALL))
    .sort((a, b) => dist(source, a.p) - dist(source, b.p))
    .slice(0, 3);
  const ends = probes
    .filter((p) => !rectHit(listener, p.p, WALL))
    .sort((a, b) => dist(listener, a.p) - dist(listener, b.p))
    .slice(0, 3);
  const endIds = new Set(ends.map((p) => p.id));
  const score = probes.map(() => Infinity);
  const prev = probes.map<number | null>(() => null);
  const used = new Set<number>();
  for (const start of starts) score[start.id] = dist(source, start.p);
  while (used.size < probes.length) {
    let cur = -1;
    let best = Infinity;
    for (const p of probes) {
      if (!used.has(p.id) && score[p.id] < best) {
        best = score[p.id];
        cur = p.id;
      }
    }
    if (cur < 0 || endIds.has(cur)) break;
    used.add(cur);
    for (const [a, b] of edges) {
      if (a !== cur && b !== cur) continue;
      const next = a === cur ? b : a;
      const candidate = score[cur] + dist(probes[cur].p, probes[next].p);
      if (candidate < score[next]) {
        score[next] = candidate;
        prev[next] = cur;
      }
    }
  }
  let end = -1;
  let best = Infinity;
  for (const p of ends) {
    const candidate = score[p.id] + dist(listener, p.p);
    if (candidate < best) {
      best = candidate;
      end = p.id;
    }
  }
  const path: number[] = [];
  for (let cur: number | null = end; cur !== null && cur >= 0; cur = prev[cur]) path.push(cur);
  return path.reverse();
}

export function mountProbePath(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.52);
  const ctx = shell.canvas.getContext("2d")!;
  let count = 9;
  let source: Point = { x: 0.18, y: 0.42 };
  let listener: Point = { x: 0.84, y: 0.58 };
  shell.slider({
    label: "sparse probes",
    min: 5,
    max: 12,
    step: 1,
    value: count,
    format: (v) => `${v}`,
    onInput: (v) => {
      count = Math.round(v);
    },
  });
  shell.slider({
    label: "listener around corner",
    min: 0.2,
    max: 0.86,
    step: 0.01,
    value: listener.y,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      listener = { ...listener, y: v };
    },
  });
  shell.setInfo(() => {
    const probes = probeList(count);
    const path = shortestPath(source, listener, probes, graphEdges(probes));
    return `${path.length} probes visited on the chosen route`;
  });
  return {
    frame() {
      shell.tick();
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      drawRoom(ctx, w, h);
      const probes = probeList(count);
      const edges = graphEdges(probes);
      ctx.strokeStyle = "rgba(133,255,179,0.32)";
      ctx.lineWidth = 2;
      for (const [a, b] of edges) line(ctx, probes[a].p, probes[b].p, w, h, "rgba(133,255,179,0.28)", 2);
      for (const probe of probes) {
        const p = worldToCanvas(probe.p, w, h);
        ctx.fillStyle = "#5de8ff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      const path = shortestPath(source, listener, probes, edges);
      let last = source;
      for (const id of path) {
        line(ctx, last, probes[id].p, w, h, "#ff5d86", 5);
        last = probes[id].p;
      }
      if (path.length > 0) line(ctx, last, listener, w, h, "#ff5d86", 5);
      line(ctx, source, listener, w, h, rectHit(source, listener, WALL) ? "rgba(255,191,71,0.38)" : "rgba(120,224,143,0.7)", 2);
      drawDot(ctx, source, w, h, "#ffbf47", "emitter");
      drawDot(ctx, listener, w, h, "#5de8ff", "listener");
      ctx.fillStyle = "#dce6ed";
      ctx.font = "600 13px ui-sans-serif, system-ui";
      ctx.fillText("partial links keep the graph small; the route bends only through visible probes", 22, 28);
    },
  };
}

export function mountBandMaterial(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.46);
  const ctx = shell.canvas.getContext("2d")!;
  let absorption = 0.34;
  let transmittance = 0.42;
  shell.slider({
    label: "absorption",
    min: 0,
    max: 1,
    step: 0.01,
    value: absorption,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      absorption = v;
    },
  });
  shell.slider({
    label: "transmittance",
    min: 0,
    max: 1,
    step: 0.01,
    value: transmittance,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      transmittance = v;
    },
  });
  shell.setInfo(() => "low frequencies leak most; highs disappear first");
  return {
    frame() {
      shell.tick();
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      ctx.fillStyle = "#0a1015";
      ctx.fillRect(0, 0, w, h);
      const incoming: Band = { low: 1, mid: 1, high: 1 };
      const reflected: Band = {
        low: incoming.low * (1 - absorption * 0.45),
        mid: incoming.mid * (1 - absorption * 0.75),
        high: incoming.high * (1 - absorption),
      };
      const transmitted: Band = {
        low: transmittance * 0.9,
        mid: transmittance * 0.42,
        high: transmittance * 0.14,
      };
      ctx.fillStyle = "rgba(114,166,185,0.8)";
      ctx.fillRect(w * 0.47, h * 0.16, w * 0.06, h * 0.68);
      ctx.fillStyle = "#edf7fa";
      ctx.font = "700 16px ui-sans-serif, system-ui";
      ctx.fillText("incident", w * 0.11, h * 0.17);
      ctx.fillText("reflected", w * 0.58, h * 0.17);
      ctx.fillText("through wall", w * 0.58, h * 0.55);
      drawBandBars(ctx, w * 0.11, h * 0.24, incoming);
      drawBandBars(ctx, w * 0.58, h * 0.24, reflected);
      drawBandBars(ctx, w * 0.58, h * 0.62, transmitted);
      for (let i = 0; i < 6; i += 1) {
        const y = h * (0.26 + i * 0.08);
        line(ctx, { x: 0.2, y: y / h }, { x: 0.47, y: (y + Math.sin(i) * 18) / h }, w, h, "rgba(255,191,71,0.55)", 2);
      }
    },
  };
}

export function mountReflectionLobe(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  let sharpness = 4.2;
  let turn = 0.44;
  shell.slider({
    label: "spherical gaussian sharpness",
    min: 0.5,
    max: 10,
    step: 0.1,
    value: sharpness,
    format: (v) => v.toFixed(1),
    onInput: (v) => {
      sharpness = v;
    },
  });
  shell.slider({
    label: "bend angle",
    min: 0,
    max: 1,
    step: 0.01,
    value: turn,
    format: (v) => `${Math.round(v * 180)}°`,
    onInput: (v) => {
      turn = v;
    },
  });
  return {
    frame() {
      shell.tick();
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      ctx.fillStyle = "#0a1015";
      ctx.fillRect(0, 0, w, h);
      const cx = w * 0.5;
      const cy = h * 0.52;
      const maxR = Math.min(w, h) * 0.34;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      for (let r = 0.25; r <= 1; r += 0.25) {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * r, 0, Math.PI * 2);
        ctx.stroke();
      }
      const preferred = -Math.PI * 0.18;
      ctx.fillStyle = "rgba(93,232,255,0.22)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let i = 0; i <= 160; i += 1) {
        const angle = -Math.PI + (i / 160) * Math.PI * 2;
        const alignment = Math.cos(angle - preferred);
        const energy = Math.exp(sharpness * (alignment - 1));
        const r = maxR * (0.12 + energy * 0.88);
        ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.fill();
      const bendAngle = preferred + (turn - 0.5) * Math.PI;
      const alignment = Math.cos(bendAngle - preferred);
      const energy = Math.exp(sharpness * (alignment - 1));
      line(ctx, { x: 0.15, y: 0.74 }, { x: 0.5, y: 0.52 }, w, h, "#ffbf47", 4);
      line(ctx, { x: 0.5, y: 0.52 }, { x: 0.5 + Math.cos(bendAngle) * 0.34, y: 0.52 + Math.sin(bendAngle) * 0.34 }, w, h, "#ff5d86", 4);
      ctx.fillStyle = "#f3f7fa";
      ctx.font = "700 15px ui-sans-serif, system-ui";
      ctx.fillText(`baked reflection compatibility: ${Math.round(energy * 100)}%`, 22, 28);
      ctx.font = "600 13px ui-sans-serif, system-ui";
      ctx.fillText("the probe is not just a point; it stores which incoming directions can plausibly leave in which outgoing directions", 22, h - 22);
    },
  };
}

export function mountFrameBudget(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  let probes = 192;
  let emitters = 2;
  let pathing = 1;
  let linkBudget = 3;

  const estimate = (probeCount = probes) => {
    const direct = emitters * 0.1;
    const bands = emitters * 0.035;
    const anchors = pathing ? emitters * (0.08 + Math.log2(probeCount) * 0.012) : 0;
    const graph = pathing ? emitters * (0.11 + Math.sqrt(probeCount) * linkBudget * 0.012) : 0;
    const total = direct + anchors + graph + bands;
    const dense = emitters * (0.11 + probeCount * linkBudget * 0.0026);
    return { direct, bands, anchors, graph, total, dense };
  };

  shell.slider({
    label: "probe count",
    min: 32,
    max: 768,
    step: 1,
    value: probes,
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => {
      probes = Math.round(v);
    },
  });
  shell.slider({
    label: "emitters",
    min: 1,
    max: 8,
    step: 1,
    value: emitters,
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => {
      emitters = Math.round(v);
    },
  });
  shell.slider({
    label: "pathing enabled",
    min: 0,
    max: 1,
    step: 1,
    value: pathing,
    format: (v) => (v > 0.5 ? "on" : "off"),
    onInput: (v) => {
      pathing = Math.round(v);
    },
  });
  shell.slider({
    label: "partial links per probe",
    min: 1,
    max: 5,
    step: 1,
    value: linkBudget,
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => {
      linkBudget = Math.round(v);
    },
  });

  shell.setInfo(() => {
    const { total, dense } = estimate();
    return `${total.toFixed(2)}ms sparse estimate · ${dense.toFixed(2)}ms dense-neighbor estimate`;
  });

  const drawCostBar = (
    x: number,
    y: number,
    width: number,
    label: string,
    parts: Array<{ label: string; value: number; color: string }>,
    scale: number,
  ): void => {
    ctx.fillStyle = "#edf7fa";
    ctx.font = "700 14px ui-sans-serif, system-ui";
    ctx.fillText(label, x, y - 12);
    let xx = x;
    for (const part of parts) {
      const ww = Math.max(1, part.value * scale);
      ctx.fillStyle = part.color;
      ctx.fillRect(xx, y, ww, 24);
      if (ww > 46) {
        ctx.fillStyle = "#081014";
        ctx.font = "700 11px ui-sans-serif, system-ui";
        ctx.fillText(part.label, xx + 7, y + 16);
      }
      xx += ww;
    }
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.strokeRect(x, y, width, 24);
  };

  return {
    frame() {
      shell.tick();
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      const cost = estimate();
      ctx.fillStyle = "#091015";
      ctx.fillRect(0, 0, w, h);

      const pipeline = [
        { label: "emitter", x: 0.1, y: 0.18, color: "#ffbf47" },
        { label: "rays", x: 0.27, y: 0.18, color: "#79e6b1" },
        { label: "anchors", x: 0.44, y: 0.18, color: "#8fb6ff" },
        { label: "graph", x: 0.61, y: 0.18, color: "#ff5d86" },
        { label: "bands", x: 0.78, y: 0.18, color: "#ffcc7a" },
        { label: "audio", x: 0.92, y: 0.18, color: "#5de8ff" },
      ];
      for (let i = 0; i < pipeline.length - 1; i += 1) {
        const a = pipeline[i];
        const b = pipeline[i + 1];
        ctx.strokeStyle = i >= 2 && !pathing ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.32)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x * w + 20, a.y * h);
        ctx.lineTo(b.x * w - 20, b.y * h);
        ctx.stroke();
      }
      for (const node of pipeline) {
        const muted = (node.label === "anchors" || node.label === "graph") && !pathing;
        ctx.fillStyle = muted ? "rgba(255,255,255,0.12)" : node.color;
        ctx.beginPath();
        ctx.arc(node.x * w, node.y * h, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = muted ? "rgba(255,255,255,0.35)" : "#edf7fa";
        ctx.font = "700 12px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(node.label, node.x * w, node.y * h + 38);
      }
      ctx.textAlign = "left";

      const plotX = w * 0.08;
      const plotY = h * 0.42;
      const plotW = w * 0.38;
      const plotH = h * 0.36;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(plotX, plotY, plotW, plotH);
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = "700 12px ui-sans-serif, system-ui";
      ctx.fillText("cost vs probes", plotX, plotY - 12);
      const maxMs = Math.max(2.5, estimate(768).dense * 0.42);
      const plotCurve = (color: string, fn: (n: number) => number): void => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i <= 96; i += 1) {
          const n = 32 + (736 * i) / 96;
          const x = plotX + (i / 96) * plotW;
          const y = plotY + plotH - clamp(fn(n) / maxMs, 0, 1) * plotH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      plotCurve("#5de8ff", (n) => estimate(n).total);
      plotCurve("rgba(255,191,71,0.75)", (n) => estimate(n).dense);
      const markerX = plotX + ((probes - 32) / 736) * plotW;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.moveTo(markerX, plotY);
      ctx.lineTo(markerX, plotY + plotH);
      ctx.stroke();
      ctx.fillStyle = "#5de8ff";
      ctx.fillText("sparse", plotX + 12, plotY + 22);
      ctx.fillStyle = "#ffbf47";
      ctx.fillText("dense neighbor walk", plotX + 12, plotY + 42);

      const barX = w * 0.53;
      const barW = w * 0.38;
      const scale = barW / Math.max(cost.dense, cost.total, 1.2);
      drawCostBar(
        barX,
        h * 0.46,
        barW,
        "sparse frame",
        [
          { label: "direct", value: cost.direct, color: "#79e6b1" },
          { label: "anchors", value: cost.anchors, color: "#8fb6ff" },
          { label: "graph", value: cost.graph, color: "#ff5d86" },
          { label: "bands", value: cost.bands, color: "#ffcc7a" },
        ],
        scale,
      );
      drawCostBar(
        barX,
        h * 0.68,
        barW,
        "dense comparison",
        [{ label: "candidate links", value: cost.dense, color: "rgba(255,191,71,0.76)" }],
        scale,
      );
      ctx.fillStyle = "#edf7fa";
      ctx.font = "700 16px ui-sans-serif, system-ui";
      ctx.fillText(`${cost.total.toFixed(2)}ms sparse`, barX, h * 0.46 + 58);
      ctx.font = "600 13px ui-sans-serif, system-ui";
      ctx.fillStyle = "rgba(237,247,250,0.76)";
      ctx.fillText(`${Math.round(probes * linkBudget * 0.5)} partial links, ${emitters} emitter${emitters === 1 ? "" : "s"}`, barX, h * 0.46 + 80);
    },
  };
}

class HealingExample {
  private context: AudioContext;
  private lowGain: GainNode;
  private midGain: GainNode;
  private highGain: GainNode;
  private master: GainNode;

  constructor() {
    this.context = new AudioContext();
    const master = this.context.createGain();
    master.gain.value = 0.65;
    master.connect(this.context.destination);
    this.master = master;

    this.lowGain = this.band(82.41, "sine", "lowpass", 360, 0.08);
    this.midGain = this.band(164.81, "sine", "bandpass", 820, 0.055);
    this.highGain = this.band(329.63, "triangle", "bandpass", 2100, 0.025);
    this.update(0.2, 0.2, 0.4);
  }

  private band(frequency: number, type: OscillatorType, filterType: BiquadFilterType, filterFrequency: number, gain: number): GainNode {
    const osc = this.context.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const lfo = this.context.createOscillator();
    lfo.frequency.value = 0.035 + frequency * 0.00002;
    const lfoGain = this.context.createGain();
    lfoGain.gain.value = gain * 0.28;
    const voice = this.context.createGain();
    voice.gain.value = gain;
    const filter = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    filter.Q.value = 0.45;
    lfo.connect(lfoGain).connect(voice.gain);
    osc.connect(filter).connect(voice).connect(this.master);
    osc.start();
    lfo.start();
    return voice;
  }

  update(occlusion: number, water: number, distance: number): Band {
    const spread = 1 / (1 + distance * 1.4);
    const band = {
      low: spread * mix(1, 0.42, occlusion) * Math.exp(-0.1 * water),
      mid: spread * mix(1, 0.18, occlusion) * Math.exp(-0.55 * water),
      high: spread * mix(1, 0.05, occlusion) * Math.exp(-1.9 * water),
    };
    const now = this.context.currentTime;
    this.lowGain.gain.setTargetAtTime(band.low * 0.1, now, 0.18);
    this.midGain.gain.setTargetAtTime(band.mid * 0.075, now, 0.18);
    this.highGain.gain.setTargetAtTime(band.high * 0.035, now, 0.18);
    return band;
  }

  async resume(): Promise<void> {
    await this.context.resume();
  }

  silence(): void {
    this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
  }

  audible(): void {
    this.master.gain.setTargetAtTime(0.65, this.context.currentTime, 0.08);
  }
}

export function mountHealingMini(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.42);
  const ctx = shell.canvas.getContext("2d")!;
  let audio: HealingExample | null = null;
  let playing = false;
  let occlusion = 0.25;
  let water = 0.2;
  let distance = 0.35;
  const syncButton = (): void => {
    const b = shell.controls.querySelector("button");
    if (b) b.textContent = playing ? "■ soften to silence" : "▶ hear the gentle bus";
  };
  shell.button("▶ hear the gentle bus", () => {
    if (!audio) audio = new HealingExample();
    playing = !playing;
    if (playing) audio.audible();
    else audio.silence();
    syncButton();
    void audio.resume();
  });
  shell.slider({
    label: "occlusion",
    min: 0,
    max: 1,
    step: 0.01,
    value: occlusion,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      occlusion = v;
    },
  });
  shell.slider({
    label: "water",
    min: 0,
    max: 1,
    step: 0.01,
    value: water,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      water = v;
    },
  });
  shell.slider({
    label: "distance",
    min: 0,
    max: 1,
    step: 0.01,
    value: distance,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      distance = v;
    },
  });
  shell.setInfo(() => (playing ? "sound running" : "silent until you press play"));
  return {
    frame() {
      shell.tick();
      const band = audio?.update(occlusion, water, distance) ?? {
        low: 1,
        mid: 1,
        high: 1,
      };
      const w = shell.canvas.width;
      const h = shell.canvas.height;
      ctx.fillStyle = "#0a1015";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#edf7fa";
      ctx.font = "700 16px ui-sans-serif, system-ui";
      ctx.fillText("acoustic simulation becomes a mix curve", 22, 30);
      drawBandBars(ctx, 30, h * 0.35, band);
      ctx.strokeStyle = "rgba(93,232,255,0.7)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x < w; x += 4) {
        const t = x / w;
        const y =
          h * 0.74 +
          Math.sin(t * Math.PI * 8) * h * 0.035 * band.low +
          Math.sin(t * Math.PI * 19) * h * 0.024 * band.mid +
          Math.sin(t * Math.PI * 41) * h * 0.012 * band.high;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    dispose() {
      audio?.silence();
    },
  };
}
