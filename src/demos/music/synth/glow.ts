// A small immediate-mode renderer for the synthesizer figures: anti-aliased
// polylines, fills and dots drawn as light into an HDR target, finished by
// the site's PostFX (bloom + filmic tone map), with a Canvas 2D overlay on top
// for crisp text. Coordinates are CSS pixels, y down.
//
// Without WebGPU the same calls draw straight to a 2D canvas (no bloom), so
// every figure still works.

import { PostFX, HDR_FORMAT } from "../../../lib/postfx";
import { configureContext } from "../../../lib/gpu";
import { pixelRatio } from "../../../lib/palette";

export type RGB = readonly [number, number, number];

// vertex: x, y (device px) · r, g, b, a (premultiplied, HDR) · dist, halfWidth, soft
const FLOATS = 9;

const SHADER = /* wgsl */ `
struct U { size: vec2f, pad: vec2f }
@group(0) @binding(0) var<uniform> u: U;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) edge: vec3f,
}

@vertex
fn vs(@location(0) p: vec2f, @location(1) c: vec4f, @location(2) e: vec3f) -> VOut {
  var o: VOut;
  o.pos = vec4f(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0);
  o.col = c;
  o.edge = e;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let d = abs(i.edge.x);
  let hw = i.edge.y;
  // hard: a one-pixel anti-aliased edge; soft: a gaussian falloff (halos)
  let hard = clamp(hw - d + 0.5, 0.0, 1.0);
  let q = d / max(hw, 0.001);
  let soft = exp(-q * q * 3.0);
  let a = mix(hard, soft, i.edge.z);
  return i.col * a;
}

// ---- images (spectrograms): a quad sampling an rgba8 texture ----
struct IU { rect: vec4f, size: vec2f, offset: f32, gain: f32, alpha: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> iu: IU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct IOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn ivs(@builtin(vertex_index) vi: u32) -> IOut {
  let c = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u));
  let p = iu.rect.xy + c * iu.rect.zw;
  var o: IOut;
  o.pos = vec4f(p.x / iu.size.x * 2.0 - 1.0, 1.0 - p.y / iu.size.y * 2.0, 0.0, 1.0);
  o.uv = c;
  return o;
}

@fragment
fn ifs(i: IOut) -> @location(0) vec4f {
  let uv = vec2f(fract(i.uv.x + iu.offset), i.uv.y);
  let c = textureSampleLevel(tex, samp, uv, 0.0);
  return vec4f(c.rgb * iu.gain, 1.0) * iu.alpha;
}
`;

type Mode = "over" | "add";

interface Batch {
  kind: "tri";
  mode: Mode;
  start: number; // vertex index
  count: number;
}
interface ImageCmd {
  kind: "img";
  img: GlowImage;
  rect: [number, number, number, number];
  gain: number;
  alpha: number;
}

/** A scrolling image (e.g. a spectrogram): columns written one at a time. */
export class GlowImage {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  head = 0; // next column to write; the oldest column on screen
  dirty = new Set<number>();
  tex: GPUTexture | null = null;
  canvas: HTMLCanvasElement | null = null;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  }
  /** Write column x from rgba bytes listed top → bottom. */
  setColumn(x: number, rgba: Uint8ClampedArray): void {
    for (let y = 0; y < this.h; y++) {
      const o = (y * this.w + x) * 4;
      this.data[o] = rgba[y * 4];
      this.data[o + 1] = rgba[y * 4 + 1];
      this.data[o + 2] = rgba[y * 4 + 2];
      this.data[o + 3] = 255;
    }
    this.dirty.add(x);
  }
  push(rgba: Uint8ClampedArray): void {
    this.setColumn(this.head, rgba);
    this.head = (this.head + 1) % this.w;
  }
  markAll(): void {
    for (let x = 0; x < this.w; x++) this.dirty.add(x);
  }
}

export interface GlowOpts {
  bloom?: number;
  exposure?: number;
  vignette?: number;
}

export class Glow {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly ui: CanvasRenderingContext2D;
  readonly stage: HTMLDivElement;
  readonly gpu: boolean;
  /** CSS px size of the drawing area. */
  w = 0;
  h = 0;
  /** device px per CSS px */
  s = 1;

  private dev: GPUDevice | null;
  private post: PostFX | null = null;
  private pipeOver: GPURenderPipeline | null = null;
  private pipeAdd: GPURenderPipeline | null = null;
  private pipeImg: GPURenderPipeline | null = null;
  private ubuf: GPUBuffer | null = null;
  private ugroup: GPUBindGroup | null = null;
  private vbuf: GPUBuffer | null = null;
  private vcap = 0;
  private sampler: GPUSampler | null = null;
  private imgUbufs: GPUBuffer[] = [];
  private c2d: CanvasRenderingContext2D | null = null;

  private v = new Float32Array(FLOATS * 4096);
  private nv = 0;
  private cmds: (Batch | ImageCmd)[] = [];
  private mode: Mode = "over";

  constructor(canvas: HTMLCanvasElement, dev: GPUDevice | null, opts: GlowOpts = {}) {
    this.canvas = canvas;
    this.dev = dev;
    // stage wrapper: the GPU canvas plus a 2D overlay for text
    this.stage = document.createElement("div");
    this.stage.className = "glow-stage";
    canvas.parentElement!.insertBefore(this.stage, canvas);
    this.stage.appendChild(canvas);
    this.overlay = document.createElement("canvas");
    this.overlay.className = "glow-overlay";
    this.overlay.width = canvas.width;
    this.overlay.height = canvas.height;
    this.stage.appendChild(this.overlay);
    this.ui = this.overlay.getContext("2d")!;

    if (dev) {
      try {
        const ctx = configureContext(canvas, dev);
        this.post = new PostFX(dev, ctx);
        this.post.settings.bloom = opts.bloom ?? 0.16;
        this.post.settings.exposure = opts.exposure ?? 1;
        this.post.settings.vignette = opts.vignette ?? 0.25;
        this.post.settings.radius = 1;
        this.initPipelines(dev);
      } catch (err) {
        console.error("glow: WebGPU setup failed, drawing in 2D", err);
        this.dev = null;
        this.post = null;
      }
    }
    this.gpu = !!this.post;
    if (!this.gpu) this.c2d = canvas.getContext("2d");
    this.measure();
  }

  private initPipelines(dev: GPUDevice): void {
    const module = dev.createShaderModule({ code: SHADER });
    const over: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
    const add: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
    };
    const layout = dev.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    const pl = dev.createPipelineLayout({ bindGroupLayouts: [layout] });
    const vbl: GPUVertexBufferLayout = {
      arrayStride: FLOATS * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x4" },
        { shaderLocation: 2, offset: 24, format: "float32x3" },
      ],
    };
    const mk = (blend: GPUBlendState): GPURenderPipeline =>
      dev.createRenderPipeline({
        layout: pl,
        vertex: { module, entryPoint: "vs", buffers: [vbl] },
        fragment: { module, entryPoint: "fs", targets: [{ format: HDR_FORMAT, blend }] },
        primitive: { topology: "triangle-list" },
      });
    this.pipeOver = mk(over);
    this.pipeAdd = mk(add);
    this.ubuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.ugroup = dev.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.ubuf } }] });

    const ilayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.pipeImg = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [ilayout] }),
      vertex: { module, entryPoint: "ivs" },
      fragment: { module, entryPoint: "ifs", targets: [{ format: HDR_FORMAT, blend: over }] },
      primitive: { topology: "triangle-strip" },
    });
    this.sampler = dev.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
    });
  }

  private measure(): void {
    this.s = pixelRatio(this.canvas);
    this.w = this.canvas.width / this.s;
    this.h = this.canvas.height / this.s;
  }

  // ------------------------------------------------------------ frame

  begin(): void {
    this.measure();
    this.nv = 0;
    this.cmds.length = 0;
    this.mode = "over";
    const u = this.ui;
    u.setTransform(1, 0, 0, 1, 0, 0);
    u.clearRect(0, 0, this.overlay.width, this.overlay.height);
    u.setTransform(this.s, 0, 0, this.s, 0, 0);
    if (!this.gpu) {
      this.frameNo++;
      this.ctx2();
    }
  }

  /** Subsequent shapes add light ("add") or paint over ("over", default). */
  blend(mode: Mode): void {
    this.mode = mode;
  }

  private push(n: number): number {
    const need = (this.nv + n) * FLOATS;
    if (need > this.v.length) {
      const bigger = new Float32Array(Math.max(need, this.v.length * 2));
      bigger.set(this.v);
      this.v = bigger;
    }
    const last = this.cmds[this.cmds.length - 1];
    if (last && last.kind === "tri" && last.mode === this.mode) last.count += n;
    else this.cmds.push({ kind: "tri", mode: this.mode, start: this.nv, count: n });
    const at = this.nv;
    this.nv += n;
    return at;
  }

  private vert(i: number, x: number, y: number, r: number, g: number, b: number, a: number, d: number, hw: number, soft: number): void {
    const o = i * FLOATS;
    const v = this.v;
    const s = this.s;
    v[o] = x * s;
    v[o + 1] = y * s;
    v[o + 2] = r * a;
    v[o + 3] = g * a;
    v[o + 4] = b * a;
    v[o + 5] = this.mode === "add" ? 0 : a;
    v[o + 6] = d;
    v[o + 7] = hw;
    v[o + 8] = soft;
  }

  // ------------------------------------------------------------ shapes

  /**
   * A polyline through pts = [x0, y0, x1, y1, …]. `width` in CSS px; colour
   * may exceed 1 for HDR glow. `colors` (r,g,b,a per point) overrides colour.
   */
  line(
    pts: ArrayLike<number>,
    width: number,
    color: RGB,
    alpha = 1,
    opts: { closed?: boolean; soft?: boolean; colors?: ArrayLike<number> } = {},
  ): void {
    const n = pts.length >> 1;
    if (n < 2) return;
    if (!this.gpu) return this.line2d(pts, width, color, alpha, opts);
    const s = this.s;
    const soft = opts.soft ? 1 : 0;
    const hwPx = Math.max(width * s * 0.5, 0.5);
    const ext = soft ? hwPx : hwPx + 1; // geometry half-width, device px
    const closed = !!opts.closed;
    const segs = closed ? n : n - 1;
    const at = this.push(segs * 6);
    // per-point offset normals with a capped miter
    const nx = new Float32Array(n);
    const ny = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ip = closed ? (i - 1 + n) % n : Math.max(i - 1, 0);
      const inx = closed ? (i + 1) % n : Math.min(i + 1, n - 1);
      let ax = pts[i * 2] - pts[ip * 2];
      let ay = pts[i * 2 + 1] - pts[ip * 2 + 1];
      let bx = pts[inx * 2] - pts[i * 2];
      let by = pts[inx * 2 + 1] - pts[i * 2 + 1];
      let la = Math.hypot(ax, ay);
      let lb = Math.hypot(bx, by);
      if (la < 1e-6) {
        ax = bx;
        ay = by;
        la = lb;
      }
      if (lb < 1e-6) {
        bx = ax;
        by = ay;
        lb = la;
      }
      if (la < 1e-6) {
        nx[i] = 0;
        ny[i] = 1;
        continue;
      }
      ax /= la;
      ay /= la;
      bx /= lb;
      by /= lb;
      let mx = -(ay + by);
      let my = ax + bx;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-4) {
        mx = -ay;
        my = ax;
      } else {
        mx /= ml;
        my /= ml;
      }
      // miter scale = 1 / cos(half angle), capped so spikes don't explode
      const c = mx * -ay + my * ax;
      const k = Math.min(1 / Math.max(Math.abs(c), 0.25), 4);
      nx[i] = mx * k;
      ny[i] = my * k;
    }
    const cols = opts.colors;
    let vi = at;
    const e = ext / s; // CSS px
    for (let sgi = 0; sgi < segs; sgi++) {
      const i0 = sgi;
      const i1 = (sgi + 1) % n;
      const x0 = pts[i0 * 2];
      const y0 = pts[i0 * 2 + 1];
      const x1 = pts[i1 * 2];
      const y1 = pts[i1 * 2 + 1];
      let r0 = color[0], g0 = color[1], b0 = color[2], a0 = alpha;
      let r1 = r0, g1 = g0, b1 = b0, a1 = a0;
      if (cols) {
        r0 = cols[i0 * 4];
        g0 = cols[i0 * 4 + 1];
        b0 = cols[i0 * 4 + 2];
        a0 = cols[i0 * 4 + 3] * alpha;
        r1 = cols[i1 * 4];
        g1 = cols[i1 * 4 + 1];
        b1 = cols[i1 * 4 + 2];
        a1 = cols[i1 * 4 + 3] * alpha;
      }
      const lx0 = x0 + nx[i0] * e, ly0 = y0 + ny[i0] * e;
      const rx0 = x0 - nx[i0] * e, ry0 = y0 - ny[i0] * e;
      const lx1 = x1 + nx[i1] * e, ly1 = y1 + ny[i1] * e;
      const rx1 = x1 - nx[i1] * e, ry1 = y1 - ny[i1] * e;
      this.vert(vi++, lx0, ly0, r0, g0, b0, a0, ext, hwPx, soft);
      this.vert(vi++, rx0, ry0, r0, g0, b0, a0, -ext, hwPx, soft);
      this.vert(vi++, lx1, ly1, r1, g1, b1, a1, ext, hwPx, soft);
      this.vert(vi++, rx0, ry0, r0, g0, b0, a0, -ext, hwPx, soft);
      this.vert(vi++, rx1, ry1, r1, g1, b1, a1, -ext, hwPx, soft);
      this.vert(vi++, lx1, ly1, r1, g1, b1, a1, ext, hwPx, soft);
    }
  }

  /** A bright line with a soft halo around it. */
  glowLine(pts: ArrayLike<number>, width: number, color: RGB, alpha = 1, halo = 0.35, opts: { closed?: boolean; colors?: ArrayLike<number> } = {}): void {
    if (this.gpu && halo > 0) {
      const m = this.mode;
      this.blend("add");
      this.line(pts, width * 7, color, alpha * halo * 0.5, { ...opts, soft: true });
      this.blend(m);
    }
    this.line(pts, width, color, alpha, opts);
  }

  seg(x0: number, y0: number, x1: number, y1: number, width: number, color: RGB, alpha = 1, soft = false): void {
    this.line([x0, y0, x1, y1], width, color, alpha, { soft });
  }

  /** Filled disc of radius r (soft = gaussian glow). */
  dot(x: number, y: number, r: number, color: RGB, alpha = 1, soft = false): void {
    if (!this.gpu) return this.dot2d(x, y, r, color, alpha, soft);
    const s = this.s;
    const hw = Math.max(r * s, 0.5);
    const ext = soft ? hw : hw + 1;
    const segs = 24;
    const at = this.push(segs * 3);
    const R = (ext / s) / Math.cos(Math.PI / segs);
    let vi = at;
    const sf = soft ? 1 : 0;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      this.vert(vi++, x, y, color[0], color[1], color[2], alpha, 0, hw, sf);
      this.vert(vi++, x + Math.cos(a0) * R, y + Math.sin(a0) * R, color[0], color[1], color[2], alpha, ext / Math.cos(Math.PI / segs), hw, sf);
      this.vert(vi++, x + Math.cos(a1) * R, y + Math.sin(a1) * R, color[0], color[1], color[2], alpha, ext / Math.cos(Math.PI / segs), hw, sf);
    }
  }

  /** Axis-aligned rectangle with a vertical colour/alpha gradient. */
  rect(x: number, y: number, w: number, h: number, top: RGB, aTop: number, bottom: RGB = top, aBottom = aTop): void {
    if (w <= 0 || h <= 0) return;
    if (!this.gpu) return this.rect2d(x, y, w, h, top, aTop, bottom, aBottom);
    const at = this.push(6);
    const big = 1e4;
    let vi = at;
    const T = (xx: number, yy: number, c: RGB, a: number): void => this.vert(vi++, xx, yy, c[0], c[1], c[2], a, 0, big, 0);
    T(x, y, top, aTop);
    T(x + w, y, top, aTop);
    T(x, y + h, bottom, aBottom);
    T(x + w, y, top, aTop);
    T(x + w, y + h, bottom, aBottom);
    T(x, y + h, bottom, aBottom);
  }

  /**
   * Fill between a polyline and the horizontal line y = base, fading from
   * (top, aTop) at the curve to (bottom, aBottom) at the base.
   */
  area(pts: ArrayLike<number>, base: number, top: RGB, aTop: number, bottom: RGB = top, aBottom = 0): void {
    const n = pts.length >> 1;
    if (n < 2) return;
    if (!this.gpu) return this.area2d(pts, base, top, aTop, bottom, aBottom);
    const at = this.push((n - 1) * 6);
    let vi = at;
    const big = 1e4;
    // gradient runs from the curve's highest point to the base
    let ymin = Infinity;
    for (let i = 0; i < n; i++) ymin = Math.min(ymin, pts[i * 2 + 1]);
    const span = Math.max(Math.abs(base - ymin), 1);
    const P = (x: number, y: number): void => {
      const t = Math.min(1, Math.abs(y - ymin) / span);
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      const a = aTop + (aBottom - aTop) * t;
      this.vert(vi++, x, y, r, g, b, a, 0, big, 0);
    };
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[i * 2];
      const y0 = pts[i * 2 + 1];
      const x1 = pts[i * 2 + 2];
      const y1 = pts[i * 2 + 3];
      P(x0, y0);
      P(x1, y1);
      P(x0, base);
      P(x1, y1);
      P(x1, base);
      P(x0, base);
    }
  }

  image(img: GlowImage, x: number, y: number, w: number, h: number, gain = 1, alpha = 1): void {
    const cmd: ImageCmd = { kind: "img", img, rect: [x, y, w, h], gain, alpha };
    if (this.gpu) this.cmds.push(cmd);
    else this.image2d(cmd);
  }

  // ------------------------------------------------------------ text

  text(
    str: string,
    x: number,
    y: number,
    opts: { color?: string; size?: number; align?: CanvasTextAlign; base?: CanvasTextBaseline; weight?: number; mono?: boolean; alpha?: number } = {},
  ): void {
    const u = this.ui;
    u.globalAlpha = opts.alpha ?? 1;
    u.fillStyle = opts.color ?? "rgba(170, 178, 200, 0.85)";
    const size = opts.size ?? 11;
    u.font = opts.mono
      ? `${opts.weight ?? 500} ${size}px ui-monospace, "SF Mono", Menlo, monospace`
      : `${opts.weight ?? 500} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    u.textAlign = opts.align ?? "left";
    u.textBaseline = opts.base ?? "alphabetic";
    u.fillText(str, x, y);
    u.globalAlpha = 1;
  }

  textWidth(str: string, size = 11, weight = 500): number {
    this.ui.font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    return this.ui.measureText(str).width;
  }

  // ------------------------------------------------------------ submit

  end(): void {
    if (!this.gpu) return;
    const dev = this.dev!;
    const post = this.post!;
    const view = post.sceneView();
    // vertices
    const bytes = this.nv * FLOATS * 4;
    if (bytes > this.vcap) {
      this.vbuf?.destroy();
      this.vcap = Math.max(bytes, this.vcap * 2, 1 << 16);
      this.vbuf = dev.createBuffer({ size: this.vcap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (bytes > 0) dev.queue.writeBuffer(this.vbuf!, 0, this.v.buffer, 0, bytes);
    dev.queue.writeBuffer(this.ubuf!, 0, new Float32Array([this.canvas.width, this.canvas.height, 0, 0]));

    // image uploads + per-draw uniforms
    let imgIdx = 0;
    const imgGroups: GPUBindGroup[] = [];
    for (const c of this.cmds) {
      if (c.kind !== "img") continue;
      const img = c.img;
      if (!img.tex) {
        img.tex = dev.createTexture({
          size: [img.w, img.h],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        img.markAll();
      }
      if (img.dirty.size > 0) {
        if (img.dirty.size > 8) {
          dev.queue.writeTexture({ texture: img.tex }, img.data as BufferSource, { bytesPerRow: img.w * 4 }, [img.w, img.h]);
        } else {
          const col = new Uint8Array(img.h * 4);
          for (const x of img.dirty) {
            for (let y = 0; y < img.h; y++) {
              const o = (y * img.w + x) * 4;
              col[y * 4] = img.data[o];
              col[y * 4 + 1] = img.data[o + 1];
              col[y * 4 + 2] = img.data[o + 2];
              col[y * 4 + 3] = 255;
            }
            dev.queue.writeTexture({ texture: img.tex, origin: [x, 0] }, col, { bytesPerRow: 4 }, [1, img.h]);
          }
        }
        img.dirty.clear();
      }
      if (!this.imgUbufs[imgIdx]) {
        this.imgUbufs[imgIdx] = dev.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      }
      const ub = this.imgUbufs[imgIdx];
      const s = this.s;
      dev.queue.writeBuffer(
        ub,
        0,
        new Float32Array([
          c.rect[0] * s,
          c.rect[1] * s,
          c.rect[2] * s,
          c.rect[3] * s,
          this.canvas.width,
          this.canvas.height,
          img.head / img.w,
          c.gain,
          c.alpha,
          0,
          0,
          0,
        ]),
      );
      imgGroups.push(
        dev.createBindGroup({
          layout: this.pipeImg!.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: ub } },
            { binding: 1, resource: this.sampler! },
            { binding: 2, resource: img.tex.createView() },
          ],
        }),
      );
      imgIdx++;
    }

    const enc = dev.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
    });
    let gi = 0;
    for (const c of this.cmds) {
      if (c.kind === "img") {
        pass.setPipeline(this.pipeImg!);
        pass.setBindGroup(0, imgGroups[gi++]);
        pass.draw(4);
      } else if (c.count > 0) {
        pass.setPipeline(c.mode === "add" ? this.pipeAdd! : this.pipeOver!);
        pass.setBindGroup(0, this.ugroup!);
        pass.setVertexBuffer(0, this.vbuf!);
        pass.draw(c.count, 1, c.start, 0);
      }
    }
    pass.end();
    post.encodePresent(enc);
    dev.queue.submit([enc.finish()]);
  }

  // ------------------------------------------------------------ 2D fallback
  // Drawn immediately, in call order. The canvas is cleared on first use per frame.

  private cleared = -1;
  private frameNo = 0;
  private ctx2(): CanvasRenderingContext2D {
    const c = this.c2d!;
    if (this.cleared !== this.frameNo) {
      this.cleared = this.frameNo;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = "#06070b";
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
      c.setTransform(this.s, 0, 0, this.s, 0, 0);
    }
    c.globalCompositeOperation = this.mode === "add" ? "lighter" : "source-over";
    return c;
  }
  private css(c: RGB, a: number): string {
    const f = (v: number): number => Math.round(Math.min(1, Math.max(0, Math.pow(Math.min(v, 1.6) / 1.6, 1 / 2.2))) * 255);
    return `rgba(${f(c[0])}, ${f(c[1])}, ${f(c[2])}, ${Math.min(1, Math.max(0, a))})`;
  }
  private line2d(pts: ArrayLike<number>, width: number, color: RGB, alpha: number, opts: { closed?: boolean; soft?: boolean; colors?: ArrayLike<number> }): void {
    const c = this.ctx2();
    c.lineJoin = "round";
    c.lineCap = "round";
    c.lineWidth = opts.soft ? width * 0.6 : width;
    const a = opts.soft ? alpha * 0.25 : alpha;
    const col = opts.colors ? ([opts.colors[0], opts.colors[1], opts.colors[2]] as const) : color;
    c.strokeStyle = this.css(col, a);
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    if (opts.closed) c.closePath();
    c.stroke();
  }
  private dot2d(x: number, y: number, r: number, color: RGB, alpha: number, soft: boolean): void {
    const c = this.ctx2();
    c.fillStyle = this.css(color, soft ? alpha * 0.3 : alpha);
    c.beginPath();
    c.arc(x, y, soft ? r * 0.7 : r, 0, Math.PI * 2);
    c.fill();
  }
  private rect2d(x: number, y: number, w: number, h: number, top: RGB, aTop: number, bottom: RGB, aBottom: number): void {
    const c = this.ctx2();
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, this.css(top, aTop));
    g.addColorStop(1, this.css(bottom, aBottom));
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
  }
  private area2d(pts: ArrayLike<number>, base: number, top: RGB, aTop: number, bottom: RGB, aBottom: number): void {
    const c = this.ctx2();
    let ymin = Infinity;
    for (let i = 1; i < pts.length; i += 2) ymin = Math.min(ymin, pts[i]);
    const g = c.createLinearGradient(0, ymin, 0, base);
    g.addColorStop(0, this.css(top, aTop));
    g.addColorStop(1, this.css(bottom, aBottom));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(pts[0], base);
    for (let i = 0; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.lineTo(pts[pts.length - 2], base);
    c.closePath();
    c.fill();
  }
  /** For the 2D path, images are drawn via an offscreen canvas. */
  private image2d(cmd: ImageCmd): void {
    const img = cmd.img;
    if (!img.canvas) {
      img.canvas = document.createElement("canvas");
      img.canvas.width = img.w;
      img.canvas.height = img.h;
      img.markAll();
    }
    const ic = img.canvas.getContext("2d")!;
    if (img.dirty.size) {
      ic.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
      img.dirty.clear();
    }
    const c = this.ctx2();
    c.globalAlpha = cmd.alpha;
    const [x, y, w, h] = cmd.rect;
    // ring buffer: oldest column (head) on the left
    const split = img.head;
    const wa = ((img.w - split) / img.w) * w;
    if (img.w - split > 0) c.drawImage(img.canvas, split, 0, img.w - split, img.h, x, y, wa, h);
    if (split > 0) c.drawImage(img.canvas, 0, 0, split, img.h, x + wa, y, w - wa, h);
    c.globalAlpha = 1;
  }

}
