// The 2D ferrofluid renderer shared by Strange Matter parts one and two:
// particles → field texture → marching-squares segments → shaded fluid,
// all on the GPU, finished by PostFX (bloom + filmic tone mapping).

import renderShader from "../../shaders/ferrorender.wgsl?raw";
import { PostFX, HDR_FORMAT } from "../../lib/postfx";

export const VIEW_FINAL = 0;
export const VIEW_MESH = 1;
export const VIEW_FIELD = 2;
export const VIEW_PARTICLES = 3;
export const VIEW_MOMENTS = 4;

const MAX_SEGS = 131072;
const ARROW_STRIDE = 5; // moments view: every fifth particle draws an arrow

export interface Tray2D {
  floorY: number;
  wallX: number;
  topY: number;
}

export interface Ferro2DOptions {
  tray: Tray2D;
  spacing: number; // particle spacing at rest, world units
  center: [number, number]; // world point at the middle of the canvas
  halfWidth: number; // world units visible either side of the center
  minHalfHeight?: number; // on tall canvases, crop the sides instead
  rimY: number; // top of the dish walls, world
}

export interface Ferro2DFrame {
  buffer: number; // which of the two particle buffers is current
  count: number;
  view: number;
  mag: [number, number];
  magOn: boolean;
  time: number;
  momentScale?: number;
}

export class Ferro2DRenderer {
  segsDrawn = 0;
  readonly post: PostFX;
  readonly center: [number, number];
  readonly scale: [number, number];
  readonly pxPerWorld: number;

  private dev: GPUDevice;
  private canvas: HTMLCanvasElement;
  private opts: Ferro2DOptions;
  private textures: GPUTexture[] = [];
  private rawView: GPUTextureView;
  private tmpView: GPUTextureView;
  private fieldView: GPUTextureView;
  private fieldRes: [number, number];
  private rp: GPUBuffer;
  private segBuf: GPUBuffer;
  private segCount: GPUBuffer;
  private indirect: GPUBuffer;
  private staging: GPUBuffer;
  private stagingBusy = false;
  private msRes: [number, number];
  private msCell: number;

  private splatPipe: GPURenderPipeline;
  private blurHPipe: GPURenderPipeline;
  private blurVPipe: GPURenderPipeline;
  private blurHGroup: GPUBindGroup;
  private blurVGroup: GPUBindGroup;
  private fillPipe: GPURenderPipeline;
  private segPipe: GPURenderPipeline;
  private vertPipe: GPURenderPipeline;
  private dotsPipe: GPURenderPipeline;
  private arrowPipe: GPURenderPipeline;
  private msPipe: GPUComputePipeline;
  private indPipe: GPUComputePipeline;
  private fillGroup: GPUBindGroup;
  private msGroup: GPUBindGroup;
  private indGroup: GPUBindGroup;
  private segGroup: GPUBindGroup;
  private vertGroup: GPUBindGroup;
  private particleGroups: Record<"splat" | "dots" | "arrows", GPUBindGroup[]> = { splat: [], dots: [], arrows: [] };

  constructor(dev: GPUDevice, ctx: GPUCanvasContext, canvas: HTMLCanvasElement, opts: Ferro2DOptions) {
    this.dev = dev;
    this.canvas = canvas;
    this.opts = opts;
    this.post = new PostFX(dev, ctx);
    this.post.settings.bloom = 0.1;
    this.post.settings.vignette = 0.28;

    const W = canvas.width;
    const H = canvas.height;
    let halfW = opts.halfWidth;
    if (opts.minHalfHeight && halfW * (H / W) < opts.minHalfHeight) halfW = opts.minHalfHeight * (W / H);
    const halfH = halfW * (H / W);
    this.center = opts.center;
    this.scale = [1 / halfW, 1 / halfH];
    this.pxPerWorld = W / (2 * halfW);

    // marching-squares lattice: about 2.6 particle spacings per cell, so
    // the mesh view shows individual segments instead of a smooth curve
    this.msCell = Math.max(3, opts.spacing * 2.6 * this.pxPerWorld);
    this.msRes = [Math.floor(W / this.msCell) + 1, Math.floor(H / this.msCell) + 1];

    // the field lives at half the canvas resolution: it's smooth anyway,
    // and the blur is four times cheaper
    this.fieldRes = [Math.ceil(W / 2), Math.ceil(H / 2)];
    const fieldTexture = (): GPUTextureView => {
      const t = dev.createTexture({
        size: this.fieldRes,
        format: "rg16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.textures.push(t);
      return t.createView();
    };
    this.rawView = fieldTexture();
    this.tmpView = fieldTexture();
    this.fieldView = fieldTexture();
    const linSamp = dev.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.rp = dev.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.segBuf = dev.createBuffer({ size: MAX_SEGS * 16, usage: GPUBufferUsage.STORAGE });
    this.segCount = dev.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.indirect = dev.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT });
    this.staging = dev.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const module = dev.createShaderModule({ code: renderShader });
    const add: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
    };
    const over: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
    const render = (vs: string, fs: string, format: GPUTextureFormat, blend?: GPUBlendState): GPURenderPipeline =>
      dev.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
        primitive: { topology: "triangle-list" },
      });
    this.splatPipe = render("vsSplat", "fsSplat", "rg16float", add);
    this.blurHPipe = render("vsFull", "fsBlurH", "rg16float");
    this.blurVPipe = render("vsFull", "fsBlurV", "rg16float");
    this.fillPipe = render("vsFull", "fsFill", HDR_FORMAT);
    this.segPipe = render("vsSegs", "fsSegs", HDR_FORMAT, over);
    this.vertPipe = render("vsVerts", "fsVerts", HDR_FORMAT, over);
    this.dotsPipe = render("vsDots", "fsDots", HDR_FORMAT, add);
    this.arrowPipe = render("vsArrows", "fsArrows", HDR_FORMAT, over);
    this.msPipe = dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "msCells" } });
    this.indPipe = dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "msIndirect" } });

    const rpEntry = { binding: 0, resource: { buffer: this.rp } };
    this.blurHGroup = dev.createBindGroup({
      layout: this.blurHPipe.getBindGroupLayout(0),
      entries: [rpEntry, { binding: 8, resource: this.rawView }],
    });
    this.blurVGroup = dev.createBindGroup({
      layout: this.blurVPipe.getBindGroupLayout(0),
      entries: [rpEntry, { binding: 8, resource: this.tmpView }],
    });
    this.fillGroup = dev.createBindGroup({
      layout: this.fillPipe.getBindGroupLayout(0),
      entries: [rpEntry, { binding: 2, resource: this.fieldView }, { binding: 3, resource: linSamp }],
    });
    this.msGroup = dev.createBindGroup({
      layout: this.msPipe.getBindGroupLayout(0),
      entries: [
        rpEntry,
        { binding: 2, resource: this.fieldView },
        { binding: 3, resource: linSamp },
        { binding: 4, resource: { buffer: this.segBuf } },
        { binding: 5, resource: { buffer: this.segCount } },
      ],
    });
    this.indGroup = dev.createBindGroup({
      layout: this.indPipe.getBindGroupLayout(0),
      entries: [
        rpEntry,
        { binding: 5, resource: { buffer: this.segCount } },
        { binding: 6, resource: { buffer: this.indirect } },
      ],
    });
    this.segGroup = dev.createBindGroup({
      layout: this.segPipe.getBindGroupLayout(0),
      entries: [
        rpEntry,
        { binding: 2, resource: this.fieldView },
        { binding: 3, resource: linSamp },
        { binding: 7, resource: { buffer: this.segBuf } },
      ],
    });
    this.vertGroup = dev.createBindGroup({
      layout: this.vertPipe.getBindGroupLayout(0),
      entries: [rpEntry, { binding: 7, resource: { buffer: this.segBuf } }],
    });
  }

  // Bind the simulation's two ping-pong particle buffers.
  bindParticles(buffers: [GPUBuffer, GPUBuffer]): void {
    const groups = (pipe: GPURenderPipeline): GPUBindGroup[] =>
      buffers.map((b) =>
        this.dev.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.rp } },
            { binding: 1, resource: { buffer: b } },
          ],
        }),
      );
    this.particleGroups = {
      splat: groups(this.splatPipe),
      dots: groups(this.dotsPipe),
      arrows: groups(this.arrowPipe),
    };
  }

  // Client coordinates → world coordinates.
  toWorld(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const cx = ((clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((clientY - r.top) / r.height) * 2 - 1);
    return [cx / this.scale[0] + this.center[0], cy / this.scale[1] + this.center[1]];
  }

  get visibleTop(): number {
    return this.center[1] + 1 / this.scale[1];
  }

  private writeParams(f: Ferro2DFrame): void {
    const s = this.opts.spacing;
    const splatR = s * 3.2;
    // so a fluid packed at spacing s sums to ~1: n·∫(1−q²)² dA = (1/s²)·πR²/3
    const norm = (3 * s * s) / (Math.PI * splatR * splatR);
    const t = this.opts.tray;
    const W = this.canvas.width;
    const dpr = W / Math.max(1, this.canvas.clientWidth || W);
    const data = new Float32Array([
      this.center[0], this.center[1], this.scale[0], this.scale[1],
      W, this.canvas.height, this.msRes[0], this.msRes[1],
      splatR, norm, 0.5, f.time,
      f.mag[0], f.mag[1], f.magOn ? 1 : 0, f.view,
      s * 1.1, MAX_SEGS, f.momentScale ?? 0.1, ARROW_STRIDE,
      t.floorY, t.wallX, t.topY, 22,
      f.view === VIEW_MESH ? 1.1 * dpr : 0.85 * dpr, this.pxPerWorld, this.msCell, 1,
      this.fieldRes[0], this.fieldRes[1], (s * 1.1 * this.pxPerWorld) / 2, this.opts.rimY,
    ]);
    this.dev.queue.writeBuffer(this.rp, 0, data);
  }

  encode(enc: GPUCommandEncoder, f: Ferro2DFrame): void {
    this.writeParams(f);

    // particles → field, then a light blur
    const target = (view: GPUTextureView): GPURenderPassDescriptor => ({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    let pass = enc.beginRenderPass(target(this.rawView));
    pass.setPipeline(this.splatPipe);
    pass.setBindGroup(0, this.particleGroups.splat[f.buffer]);
    pass.draw(6, f.count);
    pass.end();
    pass = enc.beginRenderPass(target(this.tmpView));
    pass.setPipeline(this.blurHPipe);
    pass.setBindGroup(0, this.blurHGroup);
    pass.draw(3);
    pass.end();
    pass = enc.beginRenderPass(target(this.fieldView));
    pass.setPipeline(this.blurVPipe);
    pass.setBindGroup(0, this.blurVGroup);
    pass.draw(3);
    pass.end();

    // field → segments → indirect args
    enc.clearBuffer(this.segCount);
    const cpass = enc.beginComputePass();
    cpass.setPipeline(this.msPipe);
    cpass.setBindGroup(0, this.msGroup);
    cpass.dispatchWorkgroups(Math.ceil(this.msRes[0] / 8), Math.ceil(this.msRes[1] / 8));
    cpass.setPipeline(this.indPipe);
    cpass.setBindGroup(0, this.indGroup);
    cpass.dispatchWorkgroups(1);
    cpass.end();
    const sample = !this.stagingBusy;
    if (sample) enc.copyBufferToBuffer(this.segCount, 0, this.staging, 0, 4);

    // shade into the HDR scene
    pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.post.sceneView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(this.fillPipe);
    pass.setBindGroup(0, this.fillGroup);
    pass.draw(3);
    if (f.view === VIEW_FINAL || f.view === VIEW_MESH) {
      pass.setPipeline(this.segPipe);
      pass.setBindGroup(0, this.segGroup);
      pass.drawIndirect(this.indirect, 0);
    }
    if (f.view === VIEW_MESH) {
      pass.setPipeline(this.vertPipe);
      pass.setBindGroup(0, this.vertGroup);
      pass.drawIndirect(this.indirect, 16);
    }
    if (f.view === VIEW_PARTICLES) {
      pass.setPipeline(this.dotsPipe);
      pass.setBindGroup(0, this.particleGroups.dots[f.buffer]);
      pass.draw(6, f.count);
    }
    if (f.view === VIEW_MOMENTS) {
      pass.setPipeline(this.arrowPipe);
      pass.setBindGroup(0, this.particleGroups.arrows[f.buffer]);
      pass.draw(6, Math.floor(f.count / ARROW_STRIDE));
    }
    pass.end();
    this.post.encodePresent(enc);
    this.sampleCount = sample;
  }

  private sampleCount = false;

  // Call after submit: reads the segment count back for the readout, never
  // for drawing.
  afterSubmit(): void {
    if (!this.sampleCount || this.stagingBusy) return;
    this.stagingBusy = true;
    this.staging
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        this.segsDrawn = Math.min(new Uint32Array(this.staging.getMappedRange())[0], MAX_SEGS);
        this.staging.unmap();
        this.stagingBusy = false;
      })
      .catch(() => (this.stagingBusy = false));
  }

  dispose(): void {
    this.post.dispose();
    for (const t of this.textures) t.destroy();
    for (const b of [this.rp, this.segBuf, this.segCount, this.indirect, this.staging]) b.destroy();
  }
}
