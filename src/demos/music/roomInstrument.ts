import { Shell, type Demo } from "../../lib/demoShell";
import {
  Tone,
  StepClock,
  frameGuard,
  masterBus,
  midiToFreq,
  midiName,
  soundHint,
  unlockAudio,
} from "../../lib/audio";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Bands = { low: number; mid: number; high: number };
type Drag =
  | { kind: "stone"; index: number }
  | { kind: "listener" }
  | { kind: "wall"; offset: Point }
  | { kind: "water"; offset: Point };

interface RoomState {
  listener: Point;
  stones: Point[];
  wall: Point;
  water: Point;
  scale: number;
  tempo: number;
  leakage: number;
  waterTone: number;
}

interface AcousticState {
  band: Bands;
  directBlocked: boolean;
  routeProbe: Point | null;
  directEnergy: number;
  routeEnergy: number;
  distance: number;
  pan: number;
}

const WALL_SIZE = { w: 0.12, h: 0.54 };
const WATER_SIZE = { w: 0.24, h: 0.23 };
const COLORS = ["#79e6b1", "#ffcc7a", "#8fb6ff", "#ff5d86"];
const ROLES = ["body", "pulse", "chime", "halo"];
const ROLE_PATTERNS = [
  [0, 8],
  [0, 5, 10],
  [2, 6, 11, 14],
  [0, 3, 7, 12],
];
const ROLE_DURATIONS = [1.8, 0.18, 0.34, 0.72];
const ROLE_WAVES: OscillatorType[] = ["sine", "triangle", "sine", "triangle"];

const SCALES = [
  { name: "C major pentatonic", root: 48, steps: [0, 2, 4, 7, 9] },
  { name: "D dorian", root: 50, steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: "A minor pentatonic", root: 45, steps: [0, 3, 5, 7, 10] },
  { name: "F lydian", root: 53, steps: [0, 2, 4, 6, 7, 9, 11] },
];

const DEFAULT_STATE: RoomState = {
  listener: { x: 0.56, y: 0.5 },
  stones: [
    { x: 0.18, y: 0.36 },
    { x: 0.3, y: 0.72 },
    { x: 0.78, y: 0.31 },
    { x: 0.83, y: 0.7 },
  ],
  wall: { x: 0.48, y: 0.5 },
  water: { x: 0.69, y: 0.68 },
  scale: 0,
  tempo: 78,
  leakage: 0.56,
  waterTone: 0.65,
};

function cloneDefault(): RoomState {
  return {
    listener: { ...DEFAULT_STATE.listener },
    stones: DEFAULT_STATE.stones.map((p) => ({ ...p })),
    wall: { ...DEFAULT_STATE.wall },
    water: { ...DEFAULT_STATE.water },
    scale: DEFAULT_STATE.scale,
    tempo: DEFAULT_STATE.tempo,
    leakage: DEFAULT_STATE.leakage,
    waterTone: DEFAULT_STATE.waterTone,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function wallRect(state: RoomState): Rect {
  return {
    x: state.wall.x - WALL_SIZE.w * 0.5,
    y: state.wall.y - WALL_SIZE.h * 0.5,
    w: WALL_SIZE.w,
    h: WALL_SIZE.h,
  };
}

function waterRect(state: RoomState): Rect {
  return {
    x: state.water.x - WATER_SIZE.w * 0.5,
    y: state.water.y - WATER_SIZE.h * 0.5,
    w: WATER_SIZE.w,
    h: WATER_SIZE.h,
  };
}

function contains(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

function segmentRectRange(a: Point, b: Point, rect: Rect): [number, number] | null {
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
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return null;
    }
  }
  if (t1 <= 0 || t0 >= 1) return null;
  return [clamp(t0, 0, 1), clamp(t1, 0, 1)];
}

function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  return segmentRectRange(a, b, rect) !== null;
}

function segmentRectLength(a: Point, b: Point, rect: Rect): number {
  const r = segmentRectRange(a, b, rect);
  return r ? Math.max(0, r[1] - r[0]) * distance(a, b) : 0;
}

function bestRouteProbe(source: Point, listener: Point, wall: Rect): { probe: Point; length: number } {
  const margin = 0.08;
  const probes = [
    { x: wall.x + wall.w * 0.5, y: wall.y - margin },
    { x: wall.x + wall.w * 0.5, y: wall.y + wall.h + margin },
    { x: wall.x - margin, y: wall.y + wall.h * 0.5 },
    { x: wall.x + wall.w + margin, y: wall.y + wall.h * 0.5 },
  ].map((p) => ({ x: clamp(p.x, 0.07, 0.93), y: clamp(p.y, 0.1, 0.9) }));
  let best = probes[0];
  let bestLength = Number.POSITIVE_INFINITY;
  for (const p of probes) {
    const len = distance(source, p) + distance(p, listener);
    const crosses = segmentHitsRect(source, p, wall) || segmentHitsRect(p, listener, wall);
    const cost = len + (crosses ? 0.7 : 0);
    if (cost < bestLength) {
      best = p;
      bestLength = len;
    }
  }
  return { probe: best, length: bestLength };
}

function solveAcoustics(source: Point, state: RoomState): AcousticState {
  const listener = state.listener;
  const wall = wallRect(state);
  const water = waterRect(state);
  const d = distance(source, listener);
  const blocked = segmentHitsRect(source, listener, wall);
  const waterLen = segmentRectLength(source, listener, water) * state.waterTone;
  const spread = 1 / (1 + d * 1.65);
  const wallBand = blocked
    ? {
        low: mix(0.18, 0.62, state.leakage),
        mid: mix(0.06, 0.26, state.leakage),
        high: mix(0.015, 0.08, state.leakage),
      }
    : { low: 1, mid: 1, high: 1 };
  const direct: Bands = {
    low: spread * wallBand.low * Math.exp(-0.18 * waterLen),
    mid: spread * wallBand.mid * Math.exp(-0.62 * waterLen),
    high: spread * wallBand.high * Math.exp(-2.2 * waterLen),
  };
  const route = bestRouteProbe(source, listener, wall);
  const routeBase = Math.exp(-route.length * 1.2) * (blocked ? 0.8 : 0.18);
  const routeWater =
    segmentRectLength(source, route.probe, water) * state.waterTone +
    segmentRectLength(route.probe, listener, water) * state.waterTone;
  const routed: Bands = {
    low: routeBase * 0.78 * Math.exp(-0.12 * routeWater),
    mid: routeBase * 0.48 * Math.exp(-0.45 * routeWater),
    high: routeBase * 0.2 * Math.exp(-1.4 * routeWater),
  };
  return {
    band: {
      low: clamp(direct.low + routed.low, 0, 1),
      mid: clamp(direct.mid + routed.mid, 0, 1),
      high: clamp(direct.high + routed.high, 0, 1),
    },
    directBlocked: blocked,
    routeProbe: routeBase > 0.06 ? route.probe : null,
    directEnergy: (direct.low + direct.mid + direct.high) / 3,
    routeEnergy: (routed.low + routed.mid + routed.high) / 3,
    distance: d,
    pan: clamp((source.x - listener.x) * 2.25, -1, 1),
  };
}

function currentScale(state: RoomState): (typeof SCALES)[number] {
  return SCALES[((state.scale % SCALES.length) + SCALES.length) % SCALES.length];
}

function noteForStone(stone: Point, state: RoomState, index: number): number {
  const scale = currentScale(state);
  const degree = clamp(Math.round(stone.x * (scale.steps.length - 1)), 0, scale.steps.length - 1);
  const verticalOctave = stone.y < 0.34 ? 12 : stone.y > 0.68 ? -12 : 0;
  const roleOffset = index === 0 ? -12 : index === 2 ? 12 : 0;
  return scale.root + scale.steps[degree] + verticalOctave + roleOffset;
}

function shouldPlay(stone: Point, index: number, step: number): boolean {
  const pattern = ROLE_PATTERNS[index % ROLE_PATTERNS.length];
  const shift = Math.round(stone.y * 7);
  return pattern.includes((step + shift) % 16);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  w: number,
  h: number,
  color: string,
  width = 2,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x * w, a.y * h);
  ctx.lineTo(b.x * w, b.y * h);
  ctx.stroke();
}

function drawBands(ctx: CanvasRenderingContext2D, x: number, y: number, band: Bands): void {
  const rows: Array<[keyof Bands, string]> = [
    ["low", "#79e6b1"],
    ["mid", "#8fb6ff"],
    ["high", "#ffcc7a"],
  ];
  ctx.font = "700 12px ui-sans-serif, system-ui";
  for (let i = 0; i < rows.length; i += 1) {
    const [key, color] = rows[i];
    const yy = y + i * 22;
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.fillRect(x, yy, 116, 10);
    ctx.fillStyle = color;
    ctx.fillRect(x, yy, band[key] * 116, 10);
    ctx.fillStyle = "rgba(237,247,250,0.72)";
    ctx.fillText(key, x + 126, yy + 10);
  }
}

function drawKnob(ctx: CanvasRenderingContext2D, p: Point, w: number, h: number, color: string, r: number): void {
  const x = p.x * w;
  const y = p.y * h;
  ctx.fillStyle = "rgba(5,7,11,0.72)";
  ctx.beginPath();
  ctx.arc(x, y, r + 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function quantize(v: number): number {
  return Math.round(clamp(v, 0, 1) * 1000);
}

function dequantize(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v / 1000, 0, 1) : fallback;
}

function compactState(state: RoomState): string {
  const packed = {
    v: 1,
    l: [quantize(state.listener.x), quantize(state.listener.y)],
    s: state.stones.map((p) => [quantize(p.x), quantize(p.y)]),
    w: [quantize(state.wall.x), quantize(state.wall.y)],
    a: [quantize(state.water.x), quantize(state.water.y)],
    k: state.scale,
    t: Math.round(state.tempo),
    g: quantize(state.leakage),
    d: quantize(state.waterTone),
  };
  return btoa(JSON.stringify(packed)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unpackState(raw: string | null): RoomState {
  const state = cloneDefault();
  if (!raw) return state;
  try {
    const text = atob(raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "="));
    const packed = JSON.parse(text) as Record<string, unknown>;
    const readPoint = (value: unknown, fallback: Point): Point => {
      if (!Array.isArray(value)) return fallback;
      return { x: dequantize(value[0], fallback.x), y: dequantize(value[1], fallback.y) };
    };
    state.listener = readPoint(packed.l, state.listener);
    state.wall = readPoint(packed.w, state.wall);
    state.water = readPoint(packed.a, state.water);
    const stones = packed.s;
    if (Array.isArray(stones)) {
      state.stones = state.stones.map((fallback, i) => readPoint(stones[i], fallback));
    }
    if (typeof packed.k === "number") state.scale = clamp(Math.round(packed.k), 0, SCALES.length - 1);
    if (typeof packed.t === "number") state.tempo = clamp(Math.round(packed.t), 58, 108);
    state.leakage = dequantize(packed.g, state.leakage);
    state.waterTone = dequantize(packed.d, state.waterTone);
  } catch {
    return cloneDefault();
  }
  return state;
}

function shareUrl(state: RoomState): string {
  const url = new URL("/pages/acoustic-spaces/room-instrument.html", location.href);
  url.searchParams.set("room", compactState(state));
  return url.href;
}

function syncUrl(state: RoomState): void {
  history.replaceState(null, "", shareUrl(state));
}

class RoomInstrumentAudio {
  private clock: StepClock;
  private synths: Tone.Synth[] = [];
  private filters: Tone.Filter[] = [];
  private panners: Tone.Panner[] = [];
  private gains: Tone.Gain[] = [];
  private dryBus = new Tone.Gain(0).connect(masterBus());
  private wetBus = new Tone.Gain(0);
  private delay = new Tone.FeedbackDelay("8n", 0.22);
  private reverb = new Tone.Reverb({ decay: 5.4, wet: 0.42 }).connect(masterBus());

  constructor(
    private state: RoomState,
    private onHit: (index: number) => void,
  ) {
    this.wetBus.connect(this.delay);
    this.delay.connect(this.reverb);
    for (let i = 0; i < 4; i += 1) {
      const synth = new Tone.Synth({
        oscillator: { type: ROLE_WAVES[i] },
        envelope: {
          attack: i === 0 ? 0.18 : 0.012,
          decay: i === 0 ? 0.5 : 0.18,
          sustain: i === 0 ? 0.55 : 0.12,
          release: i === 0 ? 2.2 : 1.1,
        },
        volume: i === 0 ? -12 : -9,
      });
      const filter = new Tone.Filter(1600, "lowpass");
      const panner = new Tone.Panner(0);
      const gain = new Tone.Gain(0.18);
      synth.connect(filter).connect(panner).connect(gain);
      gain.connect(this.dryBus);
      gain.connect(this.wetBus);
      this.synths.push(synth);
      this.filters.push(filter);
      this.panners.push(panner);
      this.gains.push(gain);
    }
    this.clock = new StepClock(this.state.tempo, 4, (step, time) => this.step(step, time));
  }

  get isRunning(): boolean {
    return this.clock.isRunning;
  }

  setTempo(bpm: number): void {
    this.clock.bpm = bpm;
  }

  start(): void {
    this.clock.bpm = this.state.tempo;
    this.dryBus.gain.rampTo(0.72, 0.18);
    this.wetBus.gain.rampTo(0.46, 0.22);
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
    this.dryBus.gain.rampTo(0, 0.18);
    this.wetBus.gain.rampTo(0, 0.22);
  }

  dispose(): void {
    this.stop();
    for (const synth of this.synths) synth.dispose();
    for (const filter of this.filters) filter.dispose();
    for (const panner of this.panners) panner.dispose();
    for (const gain of this.gains) gain.dispose();
    this.dryBus.dispose();
    this.wetBus.dispose();
    this.delay.dispose();
    this.reverb.dispose();
  }

  private step(step: number, time: number): void {
    for (let i = 0; i < this.state.stones.length; i += 1) {
      const stone = this.state.stones[i];
      if (!shouldPlay(stone, i, step)) continue;
      const acoustic = solveAcoustics(stone, this.state);
      const strength = clamp(
        acoustic.band.low * 0.28 + acoustic.band.mid * 0.34 + acoustic.band.high * 0.24 + acoustic.routeEnergy * 0.5,
        0,
        1,
      );
      if (strength < 0.025) continue;
      const cutoff = 360 + acoustic.band.mid * 1700 + acoustic.band.high * 5200;
      this.filters[i].frequency.rampTo(cutoff, 0.08);
      this.panners[i].pan.rampTo(acoustic.pan, 0.08);
      this.gains[i].gain.rampTo(0.08 + strength * 0.32, 0.05);
      this.wetBus.gain.rampTo(0.32 + acoustic.routeEnergy * 1.1 + acoustic.distance * 0.18, 0.12);
      this.synths[i].triggerAttackRelease(
        midiToFreq(noteForStone(stone, this.state, i)),
        ROLE_DURATIONS[i],
        time,
        0.28 + strength * 0.55,
      );
      this.onHit(i);
    }
  }
}

export function mountRoomInstrument(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const state = unpackState(new URLSearchParams(location.search).get("room"));
  const flashes = new Array(4).fill(0) as number[];
  let audio: RoomInstrumentAudio | null = null;
  let drag: Drag | null = null;
  let status = "drag the stones, listener, wall, or water";
  let scaleButton: HTMLButtonElement;
  let playButton: HTMLButtonElement;
  let shareButton: HTMLButtonElement;

  soundHint(container, "tap play");

  const toWorld = (event: PointerEvent): Point => {
    const r = shell.canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - r.left) / r.width, 0, 1),
      y: clamp((event.clientY - r.top) / r.height, 0, 1),
    };
  };

  const commit = (): void => {
    syncUrl(state);
  };

  const ensureAudio = async (): Promise<RoomInstrumentAudio> => {
    await unlockAudio();
    if (!audio) audio = new RoomInstrumentAudio(state, (i) => (flashes[i] = 1));
    return audio;
  };

  const syncPlayButton = (): void => {
    if (playButton) playButton.textContent = audio?.isRunning ? "■ stop" : "▶ play";
  };

  shell.button("▶ play", () => {
    void ensureAudio().then((engine) => {
      if (engine.isRunning) engine.stop();
      else engine.start();
      syncPlayButton();
    });
  });
  playButton = shell.controls.lastElementChild as HTMLButtonElement;

  shell.button(`scale: ${currentScale(state).name}`, () => {
    state.scale = (state.scale + 1) % SCALES.length;
    scaleButton.textContent = `scale: ${currentScale(state).name}`;
    commit();
  });
  scaleButton = shell.controls.lastElementChild as HTMLButtonElement;

  shell.button("random room", () => {
    for (const stone of state.stones) {
      stone.x = 0.1 + Math.random() * 0.8;
      stone.y = 0.16 + Math.random() * 0.68;
    }
    state.listener.x = 0.18 + Math.random() * 0.64;
    state.listener.y = 0.18 + Math.random() * 0.64;
    state.wall.x = 0.24 + Math.random() * 0.52;
    state.wall.y = 0.32 + Math.random() * 0.36;
    state.water.x = 0.26 + Math.random() * 0.58;
    state.water.y = 0.28 + Math.random() * 0.52;
    commit();
    status = "new room written into the URL";
    void ensureAudio().then((engine) => {
      if (!engine.isRunning) engine.start();
      syncPlayButton();
    });
  });

  shell.button("copy share link", () => {
    const url = shareUrl(state);
    syncUrl(state);
    const copied = navigator.clipboard?.writeText(url);
    if (copied) {
      void copied.then(
        () => {
          status = "share link copied";
          shareButton.textContent = "copied";
          window.setTimeout(() => (shareButton.textContent = "copy share link"), 1100);
        },
        () => {
          status = "share link is in the address bar";
        },
      );
    } else {
      status = "share link is in the address bar";
    }
  });
  shareButton = shell.controls.lastElementChild as HTMLButtonElement;

  shell.slider({
    label: "tempo",
    min: 58,
    max: 108,
    step: 1,
    value: state.tempo,
    format: (v) => `${Math.round(v)} bpm`,
    onInput: (v) => {
      state.tempo = Math.round(v);
      audio?.setTempo(state.tempo);
      commit();
    },
  });
  shell.slider({
    label: "wall leak",
    min: 0,
    max: 1,
    step: 0.01,
    value: state.leakage,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      state.leakage = v;
      commit();
    },
  });
  shell.slider({
    label: "water tone",
    min: 0,
    max: 1,
    step: 0.01,
    value: state.waterTone,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      state.waterTone = v;
      commit();
    },
  });

  const pickDrag = (p: Point): Drag => {
    let bestStone = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < state.stones.length; i += 1) {
      const d = distance(p, state.stones[i]);
      if (d < bestDist) {
        bestStone = i;
        bestDist = d;
      }
    }
    if (bestDist < 0.08) return { kind: "stone", index: bestStone };
    if (distance(p, state.listener) < 0.085) return { kind: "listener" };
    if (contains(wallRect(state), p)) return { kind: "wall", offset: { x: state.wall.x - p.x, y: state.wall.y - p.y } };
    if (contains(waterRect(state), p)) return { kind: "water", offset: { x: state.water.x - p.x, y: state.water.y - p.y } };
    return { kind: "stone", index: bestStone };
  };

  const moveDrag = (p: Point): void => {
    if (!drag) return;
    if (drag.kind === "stone") {
      state.stones[drag.index] = { x: clamp(p.x, 0.06, 0.94), y: clamp(p.y, 0.1, 0.9) };
    } else if (drag.kind === "listener") {
      state.listener = { x: clamp(p.x, 0.06, 0.94), y: clamp(p.y, 0.1, 0.9) };
    } else if (drag.kind === "wall") {
      state.wall = {
        x: clamp(p.x + drag.offset.x, WALL_SIZE.w * 0.5 + 0.04, 1 - WALL_SIZE.w * 0.5 - 0.04),
        y: clamp(p.y + drag.offset.y, WALL_SIZE.h * 0.5 + 0.04, 1 - WALL_SIZE.h * 0.5 - 0.04),
      };
    } else {
      state.water = {
        x: clamp(p.x + drag.offset.x, WATER_SIZE.w * 0.5 + 0.04, 1 - WATER_SIZE.w * 0.5 - 0.04),
        y: clamp(p.y + drag.offset.y, WATER_SIZE.h * 0.5 + 0.04, 1 - WATER_SIZE.h * 0.5 - 0.04),
      };
    }
  };

  shell.canvas.addEventListener("pointerdown", (event) => {
    const p = toWorld(event);
    drag = pickDrag(p);
    moveDrag(p);
    shell.canvas.setPointerCapture(event.pointerId);
    void ensureAudio().then((engine) => {
      if (!engine.isRunning) {
        engine.start();
        syncPlayButton();
      }
    });
  });
  shell.canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    moveDrag(toWorld(event));
  });
  const release = (): void => {
    if (drag) commit();
    drag = null;
  };
  shell.canvas.addEventListener("pointerup", release);
  shell.canvas.addEventListener("pointercancel", release);

  const guard = frameGuard(() => {
    audio?.stop();
    syncPlayButton();
  });

  shell.setInfo(() => {
    const running = audio?.isRunning ? "playing" : "stopped";
    return `${running} · ${currentScale(state).name} · ${status}`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();

      const w = shell.canvas.width;
      const h = shell.canvas.height;
      const wall = wallRect(state);
      const water = waterRect(state);
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "#071018");
      bg.addColorStop(0.55, "#111827");
      bg.addColorStop(1, "#08090d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(237,247,250,0.08)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 12; i += 1) {
        const x = (i / 12) * w;
        const y = (i / 12) * h;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(61, 211, 238, 0.15)";
      ctx.fillRect(water.x * w, water.y * h, water.w * w, water.h * h);
      ctx.strokeStyle = "rgba(93,232,255,0.42)";
      ctx.strokeRect(water.x * w, water.y * h, water.w * w, water.h * h);
      ctx.fillStyle = "rgba(93,232,255,0.82)";
      ctx.font = "700 12px ui-sans-serif, system-ui";
      ctx.fillText("water", water.x * w + 10, water.y * h + 20);

      ctx.fillStyle = "rgba(150,170,188,0.7)";
      ctx.fillRect(wall.x * w, wall.y * h, wall.w * w, wall.h * h);
      ctx.fillStyle = "rgba(9,16,22,0.35)";
      ctx.fillRect((wall.x + wall.w * 0.4) * w, wall.y * h, wall.w * w * 0.2, wall.h * h);
      ctx.fillStyle = "rgba(237,247,250,0.8)";
      ctx.fillText("wall", wall.x * w + 9, wall.y * h + 20);

      const acoustics = state.stones.map((stone) => solveAcoustics(stone, state));
      for (let i = 0; i < state.stones.length; i += 1) {
        const stone = state.stones[i];
        const acoustic = acoustics[i];
        if (acoustic.routeProbe) {
          drawLine(ctx, stone, acoustic.routeProbe, w, h, `rgba(255,204,122,${0.18 + acoustic.routeEnergy * 2})`, 2);
          drawLine(ctx, acoustic.routeProbe, state.listener, w, h, `rgba(255,204,122,${0.18 + acoustic.routeEnergy * 2})`, 2);
          drawKnob(ctx, acoustic.routeProbe, w, h, "rgba(255,204,122,0.72)", 5);
        }
        ctx.setLineDash(acoustic.directBlocked ? [8, 8] : []);
        drawLine(
          ctx,
          stone,
          state.listener,
          w,
          h,
          acoustic.directBlocked ? "rgba(255,93,134,0.38)" : `rgba(121,230,177,${0.26 + acoustic.directEnergy * 1.4})`,
          acoustic.directBlocked ? 1.4 : 2.4,
        );
        ctx.setLineDash([]);
      }

      drawKnob(ctx, state.listener, w, h, "#f2f7ff", 13);
      ctx.fillStyle = "#edf7fa";
      ctx.font = "800 12px ui-sans-serif, system-ui";
      ctx.fillText("listener", state.listener.x * w + 17, state.listener.y * h - 12);

      for (let i = 0; i < state.stones.length; i += 1) {
        flashes[i] *= 0.9;
        const stone = state.stones[i];
        const acoustic = acoustics[i];
        const pulse = 14 + flashes[i] * 22 + (acoustic.band.low + acoustic.band.mid + acoustic.band.high) * 4;
        ctx.fillStyle = COLORS[i] + "22";
        ctx.beginPath();
        ctx.arc(stone.x * w, stone.y * h, pulse, 0, Math.PI * 2);
        ctx.fill();
        drawKnob(ctx, stone, w, h, COLORS[i], 12 + flashes[i] * 4);
        ctx.fillStyle = "#edf7fa";
        ctx.font = "800 12px ui-sans-serif, system-ui";
        ctx.fillText(ROLES[i], stone.x * w + 17, stone.y * h - 11);
        ctx.font = "700 11px ui-monospace, Menlo, monospace";
        ctx.fillStyle = "rgba(237,247,250,0.72)";
        ctx.fillText(midiName(noteForStone(stone, state, i)), stone.x * w + 17, stone.y * h + 5);
      }

      const band = acoustics.reduce(
        (sum, acoustic) => ({
          low: sum.low + acoustic.band.low / acoustics.length,
          mid: sum.mid + acoustic.band.mid / acoustics.length,
          high: sum.high + acoustic.band.high / acoustics.length,
        }),
        { low: 0, mid: 0, high: 0 },
      );
      const panelX = 40;
      ctx.fillStyle = "rgba(5,7,11,0.52)";
      ctx.fillRect(panelX - 16, 20, 230, 124);
      ctx.fillStyle = "#edf7fa";
      ctx.font = "800 14px ui-sans-serif, system-ui";
      ctx.fillText("room buses", panelX, 44);
      drawBands(ctx, panelX, 68, band);
    },
    dispose() {
      audio?.dispose();
    },
  };
}
