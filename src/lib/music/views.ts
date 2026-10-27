// Shared audio views for the music series: oscilloscope, log-frequency
// spectrum, scrolling spectrogram and a stereo level meter.
//
// Each view is a div.music-view holding two stacked canvases: the back layer
// draws the signal (WebGPU through ShaderView, with the same glow look as the
// series' shader figures; Canvas 2D where WebGPU is missing), the front layer
// is a 2D overlay for the graticule and labels, redrawn only when its text or
// geometry changes. Both are sized in device pixels (devicePixelRatio, capped
// at 2) and follow the container width.
//
// By default a view animates itself, only while on screen and only while the
// tab is visible. Pass `auto: false` to drive it from a demo's frame() with
// view.draw(). Add `?music2d` to a page URL to force the 2D renderer.

import "../../styles/music.css";
import { ShaderView } from "../shaderCanvas";
import { getDevice } from "../gpu";
import { heatRgb } from "../palette";
import { freqLabel } from "../audio";
import { AudioProbe, masterProbe } from "./analysis";
import { CEILING_DB, limiterReduction } from "./master";

export interface ViewOptions {
  /** What to show (default: masterProbe(), the master output). */
  source?: AudioProbe;
  /** Animate itself while on screen (default true). false: call draw() yourself. */
  auto?: boolean;
  /** Height in CSS px. */
  height?: number;
  /** "2d" forces the Canvas 2D renderer. */
  renderer?: "auto" | "2d";
}

const FORCE_2D = typeof location !== "undefined" && /[?&]music2d\b/.test(location.search);
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const BG = "#06070b";
const WARM = "#ffb86b";
const TEXT_DIM = "rgba(138, 145, 165, 0.85)";
const TEXT_SOFT = "rgba(215, 219, 230, 0.62)";

// the series' speed palette (src/lib/palette.ts): deep blue → pale violet → amber
const PAL: [number, [number, number, number]][] = [
  [0, [52, 86, 235]],
  [0.5, [178, 174, 255]],
  [1, [255, 168, 92]],
];

// shared WGSL helpers appended to each scene
const WGSL_COMMON = /* wgsl */ `
fn pal(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  let c0 = vec3f(52.0, 86.0, 235.0) / 255.0;
  let c1 = vec3f(178.0, 174.0, 255.0) / 255.0;
  let c2 = vec3f(255.0, 168.0, 92.0) / 255.0;
  if (x < 0.5) { return mix(c0, c1, x * 2.0); }
  return mix(c1, c2, x * 2.0 - 1.0);
}

fn tonemap(c: vec3f) -> vec3f {
  return vec3f(1.0) - exp(-c * 1.15);
}

fn backdrop(uv: vec2f) -> vec3f {
  let q = uv - vec2f(0.5);
  return vec3f(0.018, 0.021, 0.034) * (1.15 - dot(q, q) * 0.9);
}
`;

// ---- shared animation loop ----------------------------------------------------

const autoViews = new Set<MusicView>();
let raf = 0;
let lastTick = 0;
let loopInstalled = false;

function tick(): void {
  raf = 0;
  lastTick = performance.now();
  if (document.hidden) return;
  let any = false;
  for (const v of autoViews) {
    if (!v.visible) continue;
    any = true;
    v.draw();
  }
  if (any) raf = requestAnimationFrame(tick);
}

function kick(): void {
  if (!loopInstalled) {
    loopInstalled = true;
    document.addEventListener("visibilitychange", kick);
    // some embedded browsers stop delivering rAF; keep views alive at a low rate
    window.setInterval(() => {
      if (raf && performance.now() - lastTick > 700) {
        cancelAnimationFrame(raf);
        tick();
      }
    }, 500);
  }
  if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
}

// ---- base -------------------------------------------------------------------

abstract class MusicView {
  readonly el: HTMLDivElement;
  readonly auto: boolean;
  visible = true;

  protected probe: AudioProbe;
  protected back: HTMLCanvasElement;
  protected front: HTMLCanvasElement | null = null;
  protected fctx: CanvasRenderingContext2D | null = null;
  protected bctx: CanvasRenderingContext2D | null = null;
  protected gpu: ShaderView | null = null;
  protected mode: "pending" | "gpu" | "2d" = "pending";
  /** device-pixel size of the canvases, and the ratio used */
  protected W = 0;
  protected H = 0;
  protected dpr = 1;
  /** pointer position in CSS px while hovering, else null */
  protected hover: { x: number; y: number } | null = null;

  private overlayKey = "";
  private sizeDirty = true;
  // subclass fields don't exist until super() returns, so nothing draws
  // until the microtask queued at the end of the constructor
  private ready = false;
  private lastT = 0;
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private disposed = false;

  constructor(parent: HTMLElement, opts: ViewOptions, cls: string, height: number, gpuCapable: boolean) {
    this.probe = opts.source ?? masterProbe();
    this.auto = opts.auto ?? true;
    this.el = document.createElement("div");
    this.el.className = `music-view ${cls}`;
    this.el.style.height = `${opts.height ?? height}px`;
    this.back = document.createElement("canvas");
    this.back.className = "mv-back";
    this.el.appendChild(this.back);
    if (gpuCapable) {
      this.front = document.createElement("canvas");
      this.front.className = "mv-front";
      this.el.appendChild(this.front);
      this.fctx = this.front.getContext("2d");
    }
    parent.appendChild(this.el);

    const setHover = (e: PointerEvent): void => {
      const r = this.el.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.el.addEventListener("pointermove", setHover);
    this.el.addEventListener("pointerdown", setHover);
    this.el.addEventListener("pointerleave", () => (this.hover = null));
    this.el.addEventListener("pointercancel", () => (this.hover = null));

    if (!gpuCapable || FORCE_2D || opts.renderer === "2d") {
      this.use2d();
    } else {
      void getDevice().then((dev) => {
        if (this.disposed) return;
        if (!dev) return this.use2d();
        try {
          this.gpu = new ShaderView(dev, this.back, this.scene() + WGSL_COMMON, this.dataLength());
          this.setupGpu(this.gpu);
          this.mode = "gpu";
          this.resize(true);
        } catch (err) {
          console.warn("music view: WebGPU setup failed, using 2D", err);
          this.use2d(true);
        }
      });
    }

    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.el);
    }
    queueMicrotask(() => {
      this.ready = true;
      this.resize(true);
    });

    if (this.auto) {
      autoViews.add(this);
      if (typeof IntersectionObserver !== "undefined") {
        this.visible = false;
        this.io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) this.visible = e.isIntersecting;
            if (this.visible) kick();
          },
          { rootMargin: "120px" },
        );
        this.io.observe(this.el);
      }
      kick();
    }
  }

  /** Render one frame (pulls fresh analysis data). Called for you when auto. */
  draw(): void {
    if (!this.ready || this.disposed || this.W === 0 || this.H === 0) return;
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    this.update(dt);
    if (this.mode === "gpu" && this.gpu) {
      if (this.gpu.failed) {
        this.use2d();
      } else {
        this.gpu.uniforms[1] = this.W / this.H;
        this.fillGpu(this.gpu);
        this.gpu.draw();
      }
    }
    if (this.mode === "2d" && this.bctx) this.draw2d(this.bctx);
    if (this.fctx && this.front) {
      const key = this.overlayState();
      if (key !== this.overlayKey || this.sizeDirty) {
        this.overlayKey = key;
        this.sizeDirty = false;
        this.fctx.clearRect(0, 0, this.W, this.H);
        this.overlay(this.fctx);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    autoViews.delete(this);
    this.ro?.disconnect();
    this.io?.disconnect();
    this.el.remove();
  }

  /** Which renderer is drawing the signal. */
  get renderer(): "pending" | "gpu" | "2d" {
    return this.mode;
  }

  // ---- per-view hooks
  protected scene(): string {
    return "fn scene(uv: vec2f) -> vec3f { return vec3f(0.0); }";
  }
  protected dataLength(): number {
    return 4;
  }
  protected setupGpu(_v: ShaderView): void {}
  protected abstract update(dt: number): void;
  protected fillGpu(_v: ShaderView): void {}
  protected abstract draw2d(ctx: CanvasRenderingContext2D): void;
  protected overlay(_ctx: CanvasRenderingContext2D): void {}
  protected overlayState(): string {
    return "";
  }
  protected onResize(): void {}

  // ---- helpers
  protected use2d(freshCanvas = false): void {
    if (this.mode === "2d" && this.bctx) return;
    // a canvas that ever held a webgpu context can't switch; use a fresh one
    if (freshCanvas || this.mode !== "pending" || this.gpu) {
      const c = document.createElement("canvas");
      c.className = "mv-back";
      this.back.replaceWith(c);
      this.back = c;
    }
    this.gpu = null;
    this.bctx = this.back.getContext("2d");
    this.mode = "2d";
    this.resize(true);
  }

  protected resize(force = false): void {
    const cssW = this.el.clientWidth;
    const cssH = this.el.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (!force && W === this.W && H === this.H && dpr === this.dpr && this.back.width === W) return;
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    for (const c of [this.back, this.front]) {
      if (!c) continue;
      c.width = W;
      c.height = H;
    }
    this.sizeDirty = true;
    this.onResize();
    // resizing clears the canvases; repaint now rather than on the next tick
    this.draw();
  }

  protected font(px: number, weight = 500): string {
    return `${weight} ${Math.round(px * this.dpr)}px ${MONO}`;
  }

  /** Text with a soft dark outline so it reads over bright fills. */
  protected label(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    align: CanvasTextAlign = "left",
    base: CanvasTextBaseline = "alphabetic",
  ): void {
    ctx.textAlign = align;
    ctx.textBaseline = base;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3 * this.dpr;
    ctx.strokeStyle = "rgba(6, 7, 11, 0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** Label on a small dark pill, for text that sits over busy signal. */
  protected tag(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    align: CanvasTextAlign = "left",
  ): void {
    const d = this.dpr;
    const w = ctx.measureText(text).width;
    const fs = parseFloat(ctx.font.split(" ")[1]) || 11 * d;
    const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    const px = 4 * d;
    const top = y - fs * 0.8 - 2.5 * d;
    const h = fs + 4 * d;
    ctx.fillStyle = "rgba(6, 7, 11, 0.72)";
    ctx.beginPath();
    ctx.roundRect(left - px, top, w + 2 * px, h, 4 * d);
    ctx.fill();
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}

function parseColor(c: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!c) return fallback;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return fallback;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
}

function palCss(t: number, a: number): string {
  const x = Math.min(1, Math.max(0, t));
  const [t0, c0] = x < 0.5 ? PAL[0] : PAL[1];
  const [t1, c1] = x < 0.5 ? PAL[1] : PAL[2];
  const f = (x - t0) / (t1 - t0);
  const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

function fmtHz(f: number): string {
  if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz`;
  return `${f.toFixed(f < 100 ? 1 : 0)} Hz`;
}

function fmtMs(ms: number): string {
  if (ms >= 10) return `${Math.round(ms)} ms`;
  if (ms >= 1) return `${ms.toFixed(1).replace(/\.0$/, "")} ms`;
  return `${Math.round(ms * 1000)} µs`;
}

const C_FREQS = Array.from({ length: 10 }, (_, n) => ({ name: `C${n}`, hz: 440 * Math.pow(2, (12 * (n + 1) - 69) / 12) }));

// Column→FFT-bin mapping on a log-frequency axis. Columns narrower than a bin
// interpolate between bins; wider ones take the max of the bins they cover
// (so a narrow peak never vanishes between columns).
interface FreqMap {
  lo: Int32Array;
  hi: Int32Array;
  frac: Float32Array;
  interp: Uint8Array;
}

function buildMap(n: number, minHz: number, maxHz: number, binHz: number, bins: number): FreqMap {
  const m: FreqMap = {
    lo: new Int32Array(n),
    hi: new Int32Array(n),
    frac: new Float32Array(n),
    interp: new Uint8Array(n),
  };
  const ratio = maxHz / minHz;
  for (let j = 0; j < n; j++) {
    const fLo = minHz * Math.pow(ratio, j / n);
    const fHi = minHz * Math.pow(ratio, (j + 1) / n);
    const bLo = fLo / binHz;
    const bHi = fHi / binHz;
    if (bHi - bLo < 1) {
      const c = Math.sqrt(fLo * fHi) / binHz;
      const i = Math.min(bins - 2, Math.max(0, Math.floor(c)));
      m.lo[j] = i;
      m.hi[j] = i + 1;
      m.frac[j] = Math.min(1, Math.max(0, c - i));
      m.interp[j] = 1;
    } else {
      m.lo[j] = Math.min(bins - 1, Math.max(0, Math.floor(bLo)));
      m.hi[j] = Math.min(bins - 1, Math.max(m.lo[j], Math.ceil(bHi)));
    }
  }
  return m;
}

function sampleMap(m: FreqMap, j: number, db: Float32Array): number {
  if (m.interp[j]) {
    const a = Math.max(db[m.lo[j]], -200);
    const b = Math.max(db[m.hi[j]], -200);
    return a + (b - a) * m.frac[j];
  }
  let v = -200;
  for (let i = m.lo[j]; i <= m.hi[j]; i++) if (db[i] > v) v = db[i];
  return v;
}

// ---- oscilloscope -------------------------------------------------------------

export interface ScopeOptions extends ViewOptions {
  /** Trace colour (hex). Default: the site accent #7aa2ff. */
  color?: string;
  /** Width of the window shown, in ms (default 20). */
  windowMs?: number;
  /** Vertical gain: 1 maps ±1.0 to ~85 % of the height (default 1). */
  gain?: number;
  /** Lock the trace to a rising zero crossing (default true). */
  trigger?: boolean;
  /** Show the detected pitch and bracket one cycle (default true). */
  showPitch?: boolean;
}

const SCOPE_PTS = 512;

const SCOPE_SCENE = /* wgsl */ `
fn scene(uv: vec2f) -> vec3f {
  let n = i32(uf(4u));
  let H = uf(5u);
  let W = uf(6u);
  let act = uf(7u);
  let col = vec3f(uf(8u), uf(9u), uf(10u));
  let dpr = uf(11u);
  var c = backdrop(uv);
  if (n < 2) { return c; }
  let aspect = W / H;
  let p = vec2f(uv.x * aspect, uv.y);
  let last = f32(n - 1);
  let dxPx = W / last;
  let r = min(i32(ceil(20.0 * dpr / dxPx)) + 1, 48);
  let i0 = i32(floor(uv.x * last));
  var d = 1e9;
  for (var k = i0 - r; k <= i0 + r; k = k + 1) {
    if (k < 0 || k + 1 >= n) { continue; }
    let a = vec2f(f32(k) / last * aspect, D[k]);
    let b = vec2f(f32(k + 1) / last * aspect, D[k + 1]);
    d = min(d, sdSeg(p, a, b));
  }
  let dp = d * H;
  let core = glow(dp, 1.25 * dpr);
  let bloom = glow(dp, 6.0 * dpr);
  let wide = glow(dp, 16.0 * dpr);
  let lit = mix(0.35, 1.0, act);
  c += col * (core * 1.5 + bloom * 0.42 + wide * 0.10) * lit;
  c += vec3f(1.0) * core * 0.45 * lit;
  return tonemap(c);
}
`;

export class Oscilloscope extends MusicView {
  private color: [number, number, number];
  private windowMs: number;
  private gain: number;
  private trigger: boolean;
  private showPitch: boolean;
  private pts = new Float32Array(SCOPE_PTS).fill(0.5);
  private count = SCOPE_PTS;
  private prev = new Float32Array(64);
  private havePrev = false;
  private peak = 0;
  private pitchHz = 0;
  private pitchShown = 0;

  constructor(parent: HTMLElement, opts: ScopeOptions = {}) {
    super(parent, opts, "music-scope", 180, true);
    this.color = parseColor(opts.color, [0.478, 0.635, 1.0]);
    this.windowMs = opts.windowMs ?? 20;
    this.gain = opts.gain ?? 1;
    this.trigger = opts.trigger ?? true;
    this.showPitch = opts.showPitch ?? true;
  }

  /** Change the time window (ms) live. */
  setWindow(ms: number): void {
    this.windowMs = Math.max(0.5, ms);
  }

  setGain(g: number): void {
    this.gain = g;
  }

  protected scene(): string {
    return SCOPE_SCENE;
  }
  protected dataLength(): number {
    return SCOPE_PTS;
  }

  protected update(): void {
    const x = this.probe.time();
    const sr = this.probe.sampleRate;
    const N = Math.min(x.length - 8, Math.max(16, Math.round((this.windowMs / 1000) * sr)));
    let peak = 0;
    for (let i = 0; i < x.length; i += 2) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
    }
    this.peak = peak;
    const p = this.showPitch || this.trigger ? this.probe.pitch() : null;
    this.pitchHz = p && p.clarity > 0.8 ? p.hz : 0;
    if (this.pitchHz && this.pitchShown && Math.abs(this.pitchHz / this.pitchShown - 1) < 0.004) {
      this.pitchShown += (this.pitchHz - this.pitchShown) * 0.15;
    } else {
      this.pitchShown = this.pitchHz;
    }

    const start = this.trigger && peak > 1e-4 ? this.findTrigger(x, N, sr) : x.length - N;
    const n = Math.min(SCOPE_PTS, N);
    this.count = n;
    const k = 0.425 * this.gain;
    for (let i = 0; i < n; i++) {
      const t = start + (i * (N - 1)) / (n - 1);
      const i0 = Math.floor(t);
      const f = t - i0;
      const v = x[i0] + (x[Math.min(i0 + 1, x.length - 1)] - x[i0]) * f;
      this.pts[i] = Math.min(1.02, Math.max(-0.02, 0.5 + v * k));
    }
  }

  // Rising zero crossings (with hysteresis) in the last stretch of the
  // buffer; keep the one whose window best matches the previous frame, so a
  // steady tone stands still even when its wave crosses zero several times
  // per cycle.
  private findTrigger(x: Float32Array, N: number, sr: number): number {
    const end = x.length - N - 1;
    const span = Math.min(end - 1, this.pitchHz ? Math.ceil((2.2 * sr) / this.pitchHz) : 2048);
    const lo = end - span;
    const h = Math.max(0.0015, this.peak * 0.04);
    const cands: number[] = [];
    let armed = false;
    for (let i = lo + 1; i <= end; i++) {
      if (x[i] < -h) armed = true;
      else if (armed && x[i - 1] < 0 && x[i] >= 0) {
        cands.push(i - 1 + x[i - 1] / (x[i - 1] - x[i]));
        armed = false;
      }
    }
    if (cands.length === 0) return end;
    let best = cands[cands.length - 1];
    if (this.havePrev) {
      let bestScore = -Infinity;
      for (let c = Math.max(0, cands.length - 16); c < cands.length; c++) {
        const s = cands[c];
        let dot = 0;
        let e = 0;
        for (let j = 0; j < 64; j++) {
          const v = x[Math.min(x.length - 1, Math.round(s + (j * (N - 1)) / 63))];
          dot += v * this.prev[j];
          e += v * v;
        }
        const score = dot / Math.sqrt(e + 1e-9) + c * 1e-6; // ties → newest
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
    }
    for (let j = 0; j < 64; j++) this.prev[j] = x[Math.min(x.length - 1, Math.round(best + (j * (N - 1)) / 63))];
    this.havePrev = true;
    return best;
  }

  protected fillGpu(v: ShaderView): void {
    v.data.set(this.pts.subarray(0, this.count));
    v.uniforms[4] = this.count;
    v.uniforms[5] = this.H;
    v.uniforms[6] = this.W;
    v.uniforms[7] = this.peak > 1e-4 ? 1 : 0;
    v.uniforms[8] = this.color[0];
    v.uniforms[9] = this.color[1];
    v.uniforms[10] = this.color[2];
    v.uniforms[11] = this.dpr;
  }

  protected draw2d(ctx: CanvasRenderingContext2D): void {
    const { W, H } = this;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const n = this.count;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = (1 - this.pts[i]) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const lit = this.peak > 1e-4 ? 1 : 0.4;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const passes: [number, number][] = [
      [14, 0.05],
      [6, 0.14],
      [3, 0.4],
    ];
    for (const [w, a] of passes) {
      ctx.lineWidth = w * this.dpr;
      ctx.strokeStyle = rgba(this.color, a * lit);
      ctx.stroke();
    }
    ctx.lineWidth = 1.3 * this.dpr;
    ctx.strokeStyle = `rgba(235, 240, 255, ${0.85 * lit})`;
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  protected overlayState(): string {
    const sr = this.probe.sampleRate;
    const pitch = this.showPitch && this.pitchShown ? this.pitchShown.toFixed(1) : "";
    return `${this.windowMs}|${this.gain}|${pitch}|${this.peak > 1e-4}|${sr}`;
  }

  protected overlay(ctx: CanvasRenderingContext2D): void {
    const { W, H, dpr } = this;
    // graticule: 10 × 8 divisions, brighter centre axes with minor ticks
    ctx.lineWidth = Math.max(1, dpr * 0.75);
    ctx.strokeStyle = "rgba(122, 162, 255, 0.075)";
    ctx.beginPath();
    for (let i = 1; i < 10; i++) {
      const x = Math.round((i / 10) * W) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let i = 1; i < 8; i++) {
      const y = Math.round((i / 8) * H) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(122, 162, 255, 0.17)";
    ctx.beginPath();
    const cy = Math.round(H / 2) + 0.5;
    const cx = Math.round(W / 2) + 0.5;
    ctx.moveTo(0, cy);
    ctx.lineTo(W, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    const tick = 3 * dpr;
    for (let i = 1; i < 50; i++) {
      const x = Math.round((i / 50) * W) + 0.5;
      ctx.moveTo(x, cy - tick);
      ctx.lineTo(x, cy + tick);
    }
    for (let i = 1; i < 40; i++) {
      const y = Math.round((i / 40) * H) + 0.5;
      ctx.moveTo(cx - tick, y);
      ctx.lineTo(cx + tick, y);
    }
    ctx.stroke();

    const pad = 8 * dpr;
    // where ±1.0 (digital full scale) sits at this gain
    const k = 0.425 * this.gain;
    if (k <= 0.5) {
      ctx.strokeStyle = "rgba(255, 184, 107, 0.22)";
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      for (const v of [1, -1]) {
        const y = Math.round((0.5 - v * k) * H) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = this.font(9.5);
      this.label(ctx, "+1", pad, Math.round((0.5 - k) * H) + 12 * dpr, "rgba(255, 184, 107, 0.6)");
      this.label(ctx, "−1", pad, Math.round((0.5 + k) * H) - 4 * dpr, "rgba(255, 184, 107, 0.6)");
    }
    ctx.font = this.font(10.5);
    this.label(ctx, `${fmtMs(this.windowMs / 10)}/div`, W - pad, H - pad, TEXT_DIM, "right");

    const live = this.peak > 1e-4;
    if (!live) {
      this.label(ctx, "silent", W - pad, pad + 10 * dpr, TEXT_DIM, "right");
      return;
    }
    if (!this.showPitch || !this.pitchShown) return;
    const hz = this.pitchShown;
    ctx.font = this.font(12, 600);
    this.label(ctx, `${hz.toFixed(1)} Hz · ${freqLabel(hz)}`, W - pad, pad + 11 * dpr, WARM, "right");

    // bracket one cycle from the trigger point
    if (!this.trigger) return;
    const periodFrac = 1000 / hz / this.windowMs;
    if (periodFrac > 0.98 || periodFrac * W < 14 * dpr) return;
    const x1 = periodFrac * W;
    const y = 38 * dpr;
    ctx.strokeStyle = "rgba(255, 184, 107, 0.75)";
    ctx.lineWidth = 1.25 * dpr;
    ctx.beginPath();
    ctx.moveTo(1, y + 5 * dpr);
    ctx.lineTo(1, y);
    ctx.lineTo(x1, y);
    ctx.lineTo(x1, y + 5 * dpr);
    ctx.stroke();
    // faint cycle boundaries across the window
    ctx.strokeStyle = "rgba(255, 184, 107, 0.16)";
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    ctx.beginPath();
    for (let k = 1; k * periodFrac < 1; k++) {
      const x = Math.round(k * periodFrac * W) + 0.5;
      ctx.moveTo(x, y + 7 * dpr);
      ctx.lineTo(x, H);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = this.font(10.5);
    const text = `1 cycle · ${fmtMs(1000 / hz)}`;
    const tw = ctx.measureText(text).width;
    if (tw + 12 * dpr < x1) this.label(ctx, text, x1 / 2, y - 5 * dpr, "rgba(255, 184, 107, 0.9)", "center");
    else this.label(ctx, text, x1 + 6 * dpr, y + 4 * dpr, "rgba(255, 184, 107, 0.9)", "left");
  }
}

// ---- spectrum -----------------------------------------------------------------

export interface SpectrumOptions extends ViewOptions {
  minHz?: number; // 30
  maxHz?: number; // 16000
  minDb?: number; // −96
  maxDb?: number; // −6
  /** Axis labels: C-octave note names, Hz, both, or none (default "notes"). */
  labels?: "notes" | "hz" | "both" | "none";
  /** Thin line holding recent peaks (default true). */
  peakHold?: boolean;
  /** Label the strongest peak with its note and frequency (default true). */
  showPeak?: boolean;
  /** Frequencies (Hz) to mark with dashed lines. */
  markers?: number[];
  /** How fast the curve falls, dB per second (default 60). */
  decay?: number;
}

const SPEC_COLS = 512;

const SPECTRUM_SCENE = /* wgsl */ `
fn curve(x: f32, off: u32) -> f32 {
  let k = uf(4u);
  let f = clamp(x, 0.0, 1.0) * (k - 1.0);
  let i = u32(floor(f));
  let j = min(i + 1u, u32(k) - 1u);
  return mix(D[off + i], D[off + j], fract(f));
}

fn scene(uv: vec2f) -> vec3f {
  let k = u32(uf(4u));
  let H = uf(5u);
  let W = uf(6u);
  let act = uf(7u);
  let hold = uf(8u);
  let dpr = uf(9u);
  var c = backdrop(uv);
  let y = curve(uv.x, 0u);
  let e = 1.5 / W;
  let dy = (curve(uv.x + e, 0u) - curve(uv.x - e, 0u)) / (2.0 * e);
  let slope = dy * H / W;
  let dPx = abs(uv.y - y) * H / sqrt(1.0 + slope * slope);
  let base = pal(uv.x);
  if (uv.y < y) {
    let t = uv.y / max(y, 1e-4);
    c += base * (0.06 + 0.38 * t * t * t) * (0.45 + 0.55 * smoothstep(0.0, 0.25, y));
  }
  let vis = mix(0.22, 1.0, smoothstep(0.0, 0.03, y)) * mix(0.5, 1.0, act);
  let lc = mix(base, vec3f(1.0), 0.22);
  c += lc * (glow(dPx, 0.9 * dpr) * 0.95 + glow(dPx, 4.0 * dpr) * 0.16 + glow(dPx, 12.0 * dpr) * 0.035) * vis;
  if (hold > 0.5) {
    let yh = curve(uv.x, k);
    if (yh > 0.004) {
      let dh = abs(uv.y - yh) * H;
      c += vec3f(1.0, 0.72, 0.42) * glow(dh, 0.8 * dpr) * 0.45;
    }
  }
  return tonemap(c);
}
`;

export class SpectrumView extends MusicView {
  private minHz: number;
  private maxHz: number;
  private minDb: number;
  private maxDb: number;
  private labelMode: "notes" | "hz" | "both" | "none";
  private peakHold: boolean;
  private showPeak: boolean;
  private markers: number[];
  private decay: number;
  private map: FreqMap | null = null;
  private mapKey = "";
  private cur = new Float32Array(SPEC_COLS).fill(-200);
  private hold = new Float32Array(SPEC_COLS).fill(-200);
  private holdAge = new Float32Array(SPEC_COLS);
  private y = new Float32Array(SPEC_COLS);
  private yh = new Float32Array(SPEC_COLS);
  private peakHz = 0;
  private peakDb = -200;
  private live = false;

  constructor(parent: HTMLElement, opts: SpectrumOptions = {}) {
    super(parent, opts, "music-spectrum", 200, true);
    this.minHz = opts.minHz ?? 30;
    this.maxHz = opts.maxHz ?? 16000;
    this.minDb = opts.minDb ?? -96;
    this.maxDb = opts.maxDb ?? -6;
    this.labelMode = opts.labels ?? "notes";
    this.peakHold = opts.peakHold ?? true;
    this.showPeak = opts.showPeak ?? true;
    this.markers = opts.markers ?? [];
    this.decay = opts.decay ?? 60;
  }

  /** Replace the dashed marker lines (Hz). */
  setMarkers(hz: number[]): void {
    this.markers = hz.slice();
  }

  /** Change the visible frequency range. */
  setRange(minHz: number, maxHz: number): void {
    this.minHz = minHz;
    this.maxHz = maxHz;
  }

  /** The strongest peak found this frame, or null in silence. */
  get peak(): { hz: number; db: number } | null {
    return this.peakHz > 0 ? { hz: this.peakHz, db: this.peakDb } : null;
  }

  protected scene(): string {
    return SPECTRUM_SCENE;
  }
  protected dataLength(): number {
    return SPEC_COLS * 2;
  }

  private xOf(f: number): number {
    return Math.log(f / this.minHz) / Math.log(this.maxHz / this.minHz);
  }

  private yOf(db: number): number {
    return Math.min(1, Math.max(0, (db - this.minDb) / (this.maxDb - this.minDb)));
  }

  protected update(dt: number): void {
    const probe = this.probe;
    const db = probe.freqDb();
    const binHz = probe.binHz;
    const key = `${binHz}|${this.minHz}|${this.maxHz}`;
    if (key !== this.mapKey) {
      this.map = buildMap(SPEC_COLS, this.minHz, this.maxHz, binHz, db.length);
      this.mapKey = key;
    }
    const map = this.map!;
    const fall = this.decay * dt;
    for (let j = 0; j < SPEC_COLS; j++) {
      const v = sampleMap(map, j, db);
      let c = this.cur[j];
      c = v > c ? c + (v - c) * 0.75 : Math.max(v, c - fall);
      this.cur[j] = c;
      if (c >= this.hold[j]) {
        this.hold[j] = c;
        this.holdAge[j] = 0;
      } else {
        this.holdAge[j] += dt;
        if (this.holdAge[j] > 1.2) this.hold[j] -= 20 * dt;
      }
      this.y[j] = this.yOf(c);
      this.yh[j] = this.yOf(this.hold[j]);
    }

    // strongest bin in range, refined with a parabola through its neighbours
    const lo = Math.max(1, Math.ceil(this.minHz / binHz));
    const hi = Math.min(db.length - 2, Math.floor(this.maxHz / binHz));
    let bi = -1;
    let bv = -200;
    for (let i = lo; i <= hi; i++) {
      if (db[i] > bv) {
        bv = db[i];
        bi = i;
      }
    }
    this.live = bv > this.minDb + 12 && bv > -110;
    if (bi > 0 && this.live) {
      const a = db[bi - 1];
      const b = db[bi];
      const c = db[bi + 1];
      const den = a - 2 * b + c;
      const d = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      const hz = (bi + d) * binHz;
      const pk = b - 0.25 * (a - c) * d;
      this.peakHz = this.peakHz && Math.abs(hz / this.peakHz - 1) < 0.01 ? this.peakHz + (hz - this.peakHz) * 0.3 : hz;
      this.peakDb = pk;
    } else {
      this.peakHz = 0;
      this.peakDb = -200;
    }
  }

  protected fillGpu(v: ShaderView): void {
    v.data.set(this.y, 0);
    v.data.set(this.yh, SPEC_COLS);
    v.uniforms[4] = SPEC_COLS;
    v.uniforms[5] = this.H;
    v.uniforms[6] = this.W;
    v.uniforms[7] = this.live ? 1 : 0;
    v.uniforms[8] = this.peakHold ? 1 : 0;
    v.uniforms[9] = this.dpr;
  }

  protected draw2d(ctx: CanvasRenderingContext2D): void {
    const { W, H, dpr } = this;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (const [t] of PAL) grad.addColorStop(t, palCss(t, 1));
    const path = new Path2D();
    path.moveTo(0, H);
    for (let j = 0; j < SPEC_COLS; j++) path.lineTo(((j + 0.5) / SPEC_COLS) * W, (1 - this.y[j]) * H);
    path.lineTo(W, H);
    path.closePath();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = grad;
    ctx.fill(path);
    ctx.globalAlpha = 1;
    const line = new Path2D();
    for (let j = 0; j < SPEC_COLS; j++) {
      const x = ((j + 0.5) / SPEC_COLS) * W;
      const y = (1 - this.y[j]) * H;
      if (j === 0) line.moveTo(x, y);
      else line.lineTo(x, y);
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.strokeStyle = grad;
    for (const [w, a] of [
      [9, 0.04],
      [3.5, 0.12],
      [1.3, 0.85],
    ] as [number, number][]) {
      ctx.lineWidth = w * dpr;
      ctx.globalAlpha = a * (this.live ? 1 : 0.5);
      ctx.stroke(line);
    }
    ctx.globalAlpha = 1;
    if (this.peakHold) {
      const hp = new Path2D();
      let open = false;
      for (let j = 0; j < SPEC_COLS; j++) {
        if (this.yh[j] <= 0.004) {
          open = false;
          continue;
        }
        const x = ((j + 0.5) / SPEC_COLS) * W;
        const y = (1 - this.yh[j]) * H;
        if (!open) hp.moveTo(x, y);
        else hp.lineTo(x, y);
        open = true;
      }
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = "rgba(255, 184, 107, 0.45)";
      ctx.stroke(hp);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  protected overlayState(): string {
    const h = this.hover ? `${Math.round(this.hover.x)}` : "";
    const pk = this.showPeak && this.peakHz ? `${this.peakHz.toFixed(1)}|${Math.round(this.peakDb)}` : "";
    return `${pk}|${h}|${this.live}|${this.markers.join(",")}|${this.mapKey}`;
  }

  protected overlay(ctx: CanvasRenderingContext2D): void {
    const { W, H, dpr } = this;
    const pad = 6 * dpr;
    const xs = (f: number): number => this.xOf(f) * W;

    // dB grid: lines every 12 dB, labels every 24
    ctx.lineWidth = Math.max(1, 0.75 * dpr);
    ctx.font = this.font(9.5);
    const top = Math.floor(this.maxDb / 12) * 12;
    for (let d = top; d > this.minDb; d -= 12) {
      const y = Math.round((1 - this.yOf(d)) * H) + 0.5;
      ctx.strokeStyle = "rgba(122, 162, 255, 0.07)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      if (d % 24 === 0 && y > 14 * dpr && y < H - 20 * dpr) {
        this.tag(ctx, `${d} dB`.replace("-", "−"), W - pad, y - 4 * dpr, "rgba(138, 145, 165, 0.8)", "right");
      }
    }

    // octave grid at every C, with note names along the bottom
    const showNotes = this.labelMode === "notes" || this.labelMode === "both";
    const showHz = this.labelMode === "hz" || this.labelMode === "both";
    for (const c of C_FREQS) {
      const x = xs(c.hz);
      if (x < 0 || x > W) continue;
      const xr = Math.round(x) + 0.5;
      ctx.strokeStyle = c.name === "C4" ? "rgba(255, 184, 107, 0.16)" : "rgba(122, 162, 255, 0.11)";
      ctx.beginPath();
      ctx.moveTo(xr, 0);
      ctx.lineTo(xr, H);
      ctx.stroke();
      if (showNotes && x > 4 * dpr && x < W - 22 * dpr) {
        ctx.font = this.font(10, 600);
        this.label(ctx, c.name, xr + 3 * dpr, H - pad, c.name === "C4" ? "rgba(255, 184, 107, 0.85)" : TEXT_SOFT);
      }
    }
    if (showHz) {
      ctx.font = this.font(9.5);
      let lastX = -1e9;
      for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
        const x = xs(f);
        if (x < 10 * dpr || x > W - 24 * dpr || x - lastX < 34 * dpr) continue;
        lastX = x;
        const xr = Math.round(x) + 0.5;
        ctx.strokeStyle = "rgba(138, 145, 165, 0.35)";
        ctx.beginPath();
        ctx.moveTo(xr, 0);
        ctx.lineTo(xr, 4 * dpr);
        ctx.stroke();
        this.label(ctx, f >= 1000 ? `${f / 1000}k` : `${f}`, xr, 14 * dpr, TEXT_DIM, "center");
      }
    }

    // markers
    for (const f of this.markers) {
      const x = xs(f);
      if (x < 0 || x > W) continue;
      const xr = Math.round(x) + 0.5;
      ctx.strokeStyle = "rgba(255, 184, 107, 0.55)";
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(xr, showHz ? 18 * dpr : 0);
      ctx.lineTo(xr, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = this.font(9.5);
      const right = x < W - 70 * dpr;
      this.label(ctx, freqLabel(f), xr + (right ? 4 : -4) * dpr, (showHz ? 30 : 13) * dpr, "rgba(255, 184, 107, 0.85)", right ? "left" : "right");
    }

    if (!this.live) {
      ctx.font = this.font(10.5);
      this.label(ctx, "silent", W / 2, H * 0.45, TEXT_DIM, "center");
    }

    // strongest peak
    if (this.showPeak && this.peakHz > 0) {
      const x = xs(this.peakHz);
      if (x >= 0 && x <= W) {
        const y = (1 - this.yOf(this.peakDb)) * H;
        ctx.fillStyle = WARM;
        ctx.beginPath();
        ctx.arc(x, Math.max(3 * dpr, y), 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = this.font(11, 600);
        const text = `${freqLabel(this.peakHz)} · ${fmtHz(this.peakHz)}`;
        const tw = ctx.measureText(text).width;
        const tx = Math.min(W - tw / 2 - pad, Math.max(tw / 2 + pad, x));
        const above = y > 30 * dpr;
        const ty = above ? y - 9 * dpr : y + 18 * dpr;
        this.tag(ctx, text, tx, ty, WARM, "center");
      }
    }

    // hover readout
    if (this.hover) {
      const x = this.hover.x * dpr;
      const f = this.minHz * Math.pow(this.maxHz / this.minHz, x / W);
      ctx.strokeStyle = "rgba(235, 240, 255, 0.35)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
      ctx.stroke();
      ctx.font = this.font(10.5, 600);
      const text = `${fmtHz(f)} · ${freqLabel(f)}`;
      const tw = ctx.measureText(text).width;
      const right = x + tw + 12 * dpr < W;
      this.tag(ctx, text, x + (right ? 8 : -8) * dpr, H * 0.5, "#e8ecff", right ? "left" : "right");
    }
  }
}

// ---- spectrogram --------------------------------------------------------------

export interface SpectrogramOptions extends ViewOptions {
  minHz?: number; // 40
  maxHz?: number; // 12000
  minDb?: number; // −100
  maxDb?: number; // −20
  /** Seconds of history across the width (default 6). */
  seconds?: number;
  /** Axis labels (default "notes"). */
  labels?: "notes" | "hz" | "both" | "none";
}

const SG_ROWS = 256;

const SPECTROGRAM_SCENE = /* wgsl */ `
fn heat(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 4.0;
  let s0 = vec3f(22.0, 14.0, 52.0) / 255.0;
  let s1 = vec3f(96.0, 28.0, 110.0) / 255.0;
  let s2 = vec3f(196.0, 58.0, 82.0) / 255.0;
  let s3 = vec3f(246.0, 128.0, 44.0) / 255.0;
  let s4 = vec3f(252.0, 226.0, 120.0) / 255.0;
  if (x < 1.0) { return mix(s0, s1, x); }
  if (x < 2.0) { return mix(s1, s2, x - 1.0); }
  if (x < 3.0) { return mix(s2, s3, x - 2.0); }
  return mix(s3, s4, x - 3.0);
}

fn cell(c: i32, r: i32) -> f32 {
  let C = i32(uf(4u));
  let R = i32(uf(5u));
  let cc = ((c % C) + C) % C;
  return D[cc * R + clamp(r, 0, R - 1)];
}

fn scene(uv: vec2f) -> vec3f {
  let C = uf(4u);
  let R = uf(5u);
  let head = i32(uf(6u));
  let fx = uv.x * (C - 1.0);
  let c0 = i32(floor(fx));
  let tx = fx - floor(fx);
  let fy = uv.y * (R - 1.0);
  let r0 = i32(floor(fy));
  let ty = fy - floor(fy);
  let a = mix(cell(head + c0, r0), cell(head + c0 + 1, r0), tx);
  let b = mix(cell(head + c0, r0 + 1), cell(head + c0 + 1, r0 + 1), tx);
  let v = mix(a, b, ty);
  var c = heat(pow(v, 1.08)) * (0.55 + 0.45 * smoothstep(0.0, 0.2, v));
  c += heat(v) * smoothstep(0.78, 1.0, v) * 0.35;
  return c;
}
`;

export class Spectrogram extends MusicView {
  private minHz: number;
  private maxHz: number;
  private minDb: number;
  private maxDb: number;
  private seconds: number;
  private labelMode: "notes" | "hz" | "both" | "none";
  private cols: number;
  private ring: Float32Array;
  private head = 0;
  private acc = 0;
  private map: FreqMap | null = null;
  private mapKey = "";
  private column = new Float32Array(SG_ROWS);
  private img: HTMLCanvasElement | null = null;
  private imgCtx: CanvasRenderingContext2D | null = null;
  private colImg: ImageData | null = null;
  private live = false;
  private gpuFresh = true;

  constructor(parent: HTMLElement, opts: SpectrogramOptions = {}) {
    super(parent, opts, "music-spectrogram", 220, true);
    this.minHz = opts.minHz ?? 40;
    this.maxHz = opts.maxHz ?? 12000;
    this.minDb = opts.minDb ?? -100;
    this.maxDb = opts.maxDb ?? -20;
    this.seconds = opts.seconds ?? 6;
    this.labelMode = opts.labels ?? "notes";
    this.cols = Math.max(60, Math.min(720, Math.round(this.seconds * 60)));
    this.ring = new Float32Array(this.cols * SG_ROWS);
  }

  protected scene(): string {
    return SPECTROGRAM_SCENE;
  }
  protected dataLength(): number {
    return this.cols * SG_ROWS;
  }
  protected setupGpu(v: ShaderView): void {
    v.manualUpload = true;
    this.gpuFresh = true;
  }

  private yOf(f: number): number {
    return Math.log(f / this.minHz) / Math.log(this.maxHz / this.minHz);
  }

  protected update(dt: number): void {
    const probe = this.probe;
    this.live = probe.active;
    if (!this.live) return;
    const db = probe.freqDb();
    const key = `${probe.binHz}|${this.minHz}|${this.maxHz}`;
    if (key !== this.mapKey) {
      this.map = buildMap(SG_ROWS, this.minHz, this.maxHz, probe.binHz, db.length);
      this.mapKey = key;
    }
    const range = this.maxDb - this.minDb;
    for (let r = 0; r < SG_ROWS; r++) {
      const v = (sampleMap(this.map!, r, db) - this.minDb) / range;
      this.column[r] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    this.acc += (dt * this.cols) / this.seconds;
    let n = Math.floor(this.acc);
    this.acc -= n;
    n = Math.min(n, this.cols);
    for (let i = 0; i < n; i++) this.push();
  }

  private push(): void {
    const at = this.head;
    this.ring.set(this.column, at * SG_ROWS);
    this.head = (this.head + 1) % this.cols;
    if (this.gpu) {
      this.gpu.data.set(this.column, at * SG_ROWS);
      this.gpu.markData(at * SG_ROWS, (at + 1) * SG_ROWS);
    }
    if (this.imgCtx && this.colImg) this.paintColumn(at);
  }

  protected fillGpu(v: ShaderView): void {
    if (this.gpuFresh) {
      v.data.set(this.ring);
      v.markData(0, this.ring.length);
      this.gpuFresh = false;
    }
    v.uniforms[4] = this.cols;
    v.uniforms[5] = SG_ROWS;
    v.uniforms[6] = this.head;
  }

  private paintColumn(at: number): void {
    const d = this.colImg!.data;
    for (let r = 0; r < SG_ROWS; r++) {
      const v = this.ring[at * SG_ROWS + r];
      const [R, G, B] = heatRgb(Math.pow(v, 1.08));
      const k = 0.55 + 0.45 * Math.min(1, v / 0.2);
      const o = (SG_ROWS - 1 - r) * 4;
      d[o] = R * k;
      d[o + 1] = G * k;
      d[o + 2] = B * k;
      d[o + 3] = 255;
    }
    this.imgCtx!.putImageData(this.colImg!, at, 0);
  }

  protected draw2d(ctx: CanvasRenderingContext2D): void {
    if (!this.img) {
      this.img = document.createElement("canvas");
      this.img.width = this.cols;
      this.img.height = SG_ROWS;
      this.imgCtx = this.img.getContext("2d");
      this.colImg = this.imgCtx!.createImageData(1, SG_ROWS);
      for (let c = 0; c < this.cols; c++) this.paintColumn(c);
    }
    const { W, H } = this;
    const C = this.cols;
    const h = this.head;
    ctx.imageSmoothingEnabled = true;
    // oldest columns (head..C-1) on the left, then 0..head-1
    const wA = ((C - h) / C) * W;
    if (C - h > 0) ctx.drawImage(this.img, h, 0, C - h, SG_ROWS, 0, 0, wA, H);
    if (h > 0) ctx.drawImage(this.img, 0, 0, h, SG_ROWS, wA, 0, W - wA, H);
  }

  protected overlayState(): string {
    return `${this.live}|${this.labelMode}`;
  }

  protected overlay(ctx: CanvasRenderingContext2D): void {
    const { W, H, dpr } = this;
    const pad = 6 * dpr;
    ctx.lineWidth = Math.max(1, 0.75 * dpr);
    const showNotes = this.labelMode === "notes" || this.labelMode === "both";
    const showHz = this.labelMode === "hz" || this.labelMode === "both";
    for (const c of C_FREQS) {
      const t = this.yOf(c.hz);
      if (t < 0 || t > 1) continue;
      const y = Math.round((1 - t) * H) + 0.5;
      ctx.strokeStyle = "rgba(235, 240, 255, 0.07)";
      ctx.beginPath();
      ctx.moveTo(showNotes ? 26 * dpr : 0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      if (showNotes && y > 10 * dpr && y < H - 4 * dpr) {
        ctx.font = this.font(10, 600);
        this.label(ctx, c.name, pad, y + 3.5 * dpr, TEXT_SOFT);
      }
    }
    if (showHz) {
      ctx.font = this.font(9.5);
      for (const f of [100, 1000, 10000]) {
        const t = this.yOf(f);
        if (t < 0.03 || t > 0.97) continue;
        const y = (1 - t) * H;
        this.label(ctx, f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, W - pad, y + 3.5 * dpr, TEXT_DIM, "right");
      }
    }
    // time axis: a tick per second along the bottom
    ctx.strokeStyle = "rgba(235, 240, 255, 0.25)";
    ctx.beginPath();
    for (let s = 1; s < this.seconds; s++) {
      const x = Math.round(W - (s / this.seconds) * W) + 0.5;
      ctx.moveTo(x, H);
      ctx.lineTo(x, H - 4 * dpr);
    }
    ctx.stroke();
    ctx.font = this.font(9.5);
    this.tag(ctx, `−${this.seconds} s`, showNotes ? 34 * dpr : pad + 4 * dpr, H - pad - 2 * dpr, TEXT_DIM);
    this.tag(ctx, "now", W - pad - 4 * dpr, H - pad - 2 * dpr, TEXT_DIM, "right");
    if (!this.live) {
      ctx.font = this.font(10.5);
      this.label(ctx, "silent", W / 2, H / 2, TEXT_DIM, "center");
    }
  }
}

// ---- level meter --------------------------------------------------------------

export interface MeterOptions extends ViewOptions {
  orientation?: "horizontal" | "vertical";
  /** Bottom of the scale in dBFS (default −60). */
  minDb?: number;
  /** Show the master limiter's gain reduction (default: true for the master probe). */
  showReduction?: boolean;
  /** Width in CSS px for a vertical meter (default 76). */
  width?: number;
}

export class LevelMeter extends MusicView {
  private vertical: boolean;
  private minDb: number;
  private showReduction: boolean;
  private peak = [-200, -200];
  private rmsPow = [0, 0];
  private hold = [-200, -200];
  private holdAge = [0, 0];
  private clipAge = 99;
  private maxPeak = -200;
  private gr = 0;

  constructor(parent: HTMLElement, opts: MeterOptions = {}) {
    const vertical = opts.orientation === "vertical";
    super(parent, opts, `level-meter${vertical ? " is-vertical" : ""}`, vertical ? 180 : 46, false);
    this.vertical = vertical;
    if (vertical) this.el.style.width = `${opts.width ?? 76}px`;
    this.minDb = opts.minDb ?? -60;
    this.showReduction = opts.showReduction ?? (opts.source === undefined || opts.source === masterProbe());
  }

  protected update(dt: number): void {
    const lv = this.probe.levels();
    const pk = [lv.peakL, lv.peakR];
    const rm = [lv.rmsL, lv.rmsR];
    let mx = -200;
    for (let c = 0; c < 2; c++) {
      const db = pk[c] > 1e-10 ? 20 * Math.log10(pk[c]) : -200;
      this.peak[c] = db > this.peak[c] ? db : Math.max(db, this.peak[c] - 24 * dt);
      const a = 1 - Math.exp(-dt / 0.3);
      this.rmsPow[c] += (rm[c] * rm[c] - this.rmsPow[c]) * a;
      if (this.peak[c] >= this.hold[c]) {
        this.hold[c] = this.peak[c];
        this.holdAge[c] = 0;
      } else {
        this.holdAge[c] += dt;
        if (this.holdAge[c] > 1.5) this.hold[c] -= 12 * dt;
      }
      mx = Math.max(mx, db);
    }
    this.clipAge = mx >= -0.1 ? 0 : this.clipAge + dt;
    this.maxPeak = Math.max(this.peak[0], this.peak[1]);
    if (this.showReduction) this.gr = limiterReduction();
  }

  private t(db: number): number {
    return Math.min(1, Math.max(0, (db - this.minDb) / -this.minDb));
  }

  protected draw2d(ctx: CanvasRenderingContext2D): void {
    const { W, H, dpr } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (this.vertical) this.drawVertical(ctx, W, H, dpr);
    else this.drawHorizontal(ctx, W, H, dpr);
  }

  private gradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, palCss(0, 1));
    g.addColorStop(this.t(-18), palCss(0.5, 1));
    g.addColorStop(this.t(-6), palCss(1, 1));
    g.addColorStop(1, "rgba(255, 96, 96, 1)");
    return g;
  }

  private readout(): string {
    return this.maxPeak > -150 ? `${this.maxPeak.toFixed(1)} dB`.replace("-", "−") : "−∞ dB";
  }

  private drawHorizontal(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    const gut = 16 * dpr;
    const right = 74 * dpr;
    const x0 = gut;
    const x1 = Math.max(x0 + 40 * dpr, W - right);
    const bw = x1 - x0;
    const bh = 7 * dpr;
    const gap = 3 * dpr;
    const top = Math.max(4 * dpr, Math.round((H - (2 * bh + gap + 15 * dpr)) / 2));
    const g = this.gradient(ctx, x0, 0, x1, 0);
    ctx.font = this.font(9.5, 600);
    for (let c = 0; c < 2; c++) {
      const y = top + c * (bh + gap);
      this.label(ctx, c ? "R" : "L", 5 * dpr, y + bh - 0.5 * dpr, TEXT_DIM);
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = g;
      ctx.fillRect(x0, y, bw, bh);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x0, y, bw * this.t(this.peak[c]), bh);
      ctx.globalAlpha = 1;
      const rdb = this.rmsPow[c] > 1e-12 ? 10 * Math.log10(this.rmsPow[c]) : -200;
      ctx.fillRect(x0, y + bh * 0.2, bw * this.t(rdb), bh * 0.6);
      if (this.hold[c] > this.minDb) {
        ctx.fillStyle = "rgba(240, 244, 255, 0.9)";
        ctx.fillRect(x0 + bw * this.t(this.hold[c]) - dpr, y, 2 * dpr, bh);
      }
    }
    // ceiling mark
    const xc = Math.round(x0 + bw * this.t(CEILING_DB)) + 0.5;
    ctx.strokeStyle = "rgba(255, 184, 107, 0.6)";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(xc, top - 3 * dpr);
    ctx.lineTo(xc, top + 2 * bh + gap + 3 * dpr);
    ctx.stroke();
    // ticks
    const ty = top + 2 * bh + gap + 13 * dpr;
    ctx.font = this.font(9);
    let lastX = 1e9;
    for (const d of [0, -6, -12, -18, -24, -36, -48, -60, -72, -90]) {
      if (d < this.minDb) continue;
      const x = x0 + bw * this.t(d);
      if (lastX - x < 22 * dpr) continue;
      lastX = x;
      ctx.fillStyle = "rgba(138, 145, 165, 0.45)";
      ctx.fillRect(Math.round(x), top + 2 * bh + gap + 2 * dpr, Math.max(1, dpr * 0.75), 3 * dpr);
      this.label(ctx, `${d}`.replace("-", "−"), x, ty, "rgba(138, 145, 165, 0.75)", "center");
    }
    // readouts
    const clip = this.clipAge < 2;
    ctx.font = this.font(11, 600);
    this.label(ctx, this.readout(), W - 6 * dpr, top + bh + 2 * dpr, clip ? "#ff7a7a" : WARM, "right");
    if (this.showReduction) {
      ctx.font = this.font(9.5);
      const grText = `GR ${this.gr.toFixed(1)} dB`;
      this.label(ctx, grText, W - 6 * dpr, ty, this.gr > 0.2 ? WARM : "rgba(138, 145, 165, 0.6)", "right");
    }
  }

  private drawVertical(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    const bottomPad = (this.showReduction ? 34 : 20) * dpr;
    const y0 = 8 * dpr;
    const y1 = H - bottomPad;
    const bh = y1 - y0;
    const bw = 9 * dpr;
    const gap = 3 * dpr;
    const xb = W - 2 * bw - gap - 8 * dpr;
    const g = this.gradient(ctx, 0, y1, 0, y0);
    for (let c = 0; c < 2; c++) {
      const x = xb + c * (bw + gap);
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = g;
      ctx.fillRect(x, y0, bw, bh);
      const tp = this.t(this.peak[c]);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, y1 - bh * tp, bw, bh * tp);
      ctx.globalAlpha = 1;
      const rdb = this.rmsPow[c] > 1e-12 ? 10 * Math.log10(this.rmsPow[c]) : -200;
      const tr = this.t(rdb);
      ctx.fillRect(x + bw * 0.2, y1 - bh * tr, bw * 0.6, bh * tr);
      if (this.hold[c] > this.minDb) {
        ctx.fillStyle = "rgba(240, 244, 255, 0.9)";
        ctx.fillRect(x, y1 - bh * this.t(this.hold[c]) - dpr, bw, 2 * dpr);
      }
    }
    const yc = Math.round(y1 - bh * this.t(CEILING_DB)) + 0.5;
    ctx.strokeStyle = "rgba(255, 184, 107, 0.6)";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(xb - 3 * dpr, yc);
    ctx.lineTo(xb + 2 * bw + gap + 3 * dpr, yc);
    ctx.stroke();
    ctx.font = this.font(9);
    let lastY = -1e9;
    for (const d of [0, -6, -12, -18, -24, -36, -48, -60, -72, -90]) {
      if (d < this.minDb) continue;
      const y = y1 - bh * this.t(d);
      if (y - lastY < 13 * dpr) continue;
      lastY = y;
      this.label(ctx, `${d}`.replace("-", "−"), xb - 5 * dpr, y + 3 * dpr, "rgba(138, 145, 165, 0.75)", "right");
    }
    const clip = this.clipAge < 2;
    ctx.font = this.font(10, 600);
    this.label(ctx, this.readout(), W / 2, H - (this.showReduction ? 19 : 6) * dpr, clip ? "#ff7a7a" : WARM, "center");
    if (this.showReduction) {
      ctx.font = this.font(9);
      this.label(ctx, `GR ${this.gr.toFixed(1)}`, W / 2, H - 6 * dpr, this.gr > 0.2 ? WARM : "rgba(138, 145, 165, 0.6)", "center");
    }
  }
}
