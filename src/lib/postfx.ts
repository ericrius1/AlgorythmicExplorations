// HDR target + bloom + tone mapping for the particle renderers. Particles
// draw into `sceneView` (rgba16float, so dense regions keep counting up
// instead of clipping), then present() blurs and tone maps onto the canvas.

import shader from "../shaders/postfx.wgsl?raw";

export const HDR_FORMAT: GPUTextureFormat = "rgba16float";

export interface PostSettings {
  exposure: number;
  bloom: number; // 0 = none, ~0.1 subtle, ~0.3 dreamy
  radius: number; // upsample spread
  vignette: number;
}

// Page background (#06070b), the colour light gets added on top of.
const BG = [6 / 255, 7 / 255, 11 / 255];

export class PostFX {
  readonly settings: PostSettings = { exposure: 1, bloom: 0.18, radius: 1, vignette: 0.35 };

  private dev: GPUDevice;
  private ctx: GPUCanvasContext;
  private layout: GPUBindGroupLayout;
  private pDown: GPURenderPipeline;
  private pUp: GPURenderPipeline;
  private pPresent: GPURenderPipeline;
  private sampler: GPUSampler;

  private tex: GPUTexture | null = null;
  private mips: GPUTextureView[] = [];
  private passes: { buf: GPUBuffer; group: GPUBindGroup; target: GPUTextureView; texel: [number, number] }[] = [];
  private present: { buf: GPUBuffer; group: GPUBindGroup } | null = null;
  private width = 0;
  private height = 0;
  private frame = 0;

  constructor(dev: GPUDevice, ctx: GPUCanvasContext) {
    this.dev = dev;
    this.ctx = ctx;
    const module = dev.createShaderModule({ code: shader });
    this.layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    const layout = dev.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const pipe = (entryPoint: string, format: GPUTextureFormat, blend?: GPUBlendState): GPURenderPipeline =>
      dev.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint, targets: [{ format, blend }] },
        primitive: { topology: "triangle-list" },
      });
    const add: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
    };
    this.pDown = pipe("down", HDR_FORMAT);
    this.pUp = pipe("up", HDR_FORMAT, add);
    this.pPresent = pipe("present", navigator.gpu.getPreferredCanvasFormat());
    this.sampler = dev.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  // The HDR view particles render into. Call once per frame, before drawing.
  sceneView(): GPUTextureView {
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    if (canvas.width !== this.width || canvas.height !== this.height || !this.tex) {
      this.resize(canvas.width, canvas.height);
    }
    return this.mips[0];
  }

  private resize(w: number, h: number): void {
    this.tex?.destroy();
    for (const p of this.passes) p.buf.destroy();
    this.present?.buf.destroy();
    this.width = w;
    this.height = h;
    const levels = Math.max(3, Math.min(8, Math.floor(Math.log2(Math.max(1, Math.min(w, h)))) - 2));
    this.tex = this.dev.createTexture({
      size: [w, h],
      format: HDR_FORMAT,
      mipLevelCount: levels,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.mips = [];
    for (let i = 0; i < levels; i++) {
      this.mips.push(this.tex.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    }
    const size = (i: number): [number, number] => [Math.max(1, w >> i), Math.max(1, h >> i)];
    const group = (buf: GPUBuffer, src: GPUTextureView, bloom: GPUTextureView): GPUBindGroup =>
      this.dev.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: buf } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: src },
          { binding: 3, resource: bloom },
        ],
      });
    const ubo = (): GPUBuffer =>
      this.dev.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Down the chain: level i from level i-1. Then back up: level i-1 += blur(level i).
    // The bloom texture slot is unused by these passes; any other level fills it.
    this.passes = [];
    for (let i = 1; i < levels; i++) {
      const [sw, sh] = size(i - 1);
      const buf = ubo();
      const other = this.mips[i === 1 ? levels - 1 : 0];
      this.passes.push({ buf, group: group(buf, this.mips[i - 1], other), target: this.mips[i], texel: [1 / sw, 1 / sh] });
    }
    for (let i = levels - 1; i >= 2; i--) {
      const [sw, sh] = size(i);
      const buf = ubo();
      this.passes.push({ buf, group: group(buf, this.mips[i], this.mips[0]), target: this.mips[i - 1], texel: [1 / sw, 1 / sh] });
    }
    const buf = ubo();
    this.present = { buf, group: group(buf, this.mips[0], this.mips[1]) };
  }

  private writeUniform(buf: GPUBuffer, texel: [number, number]): void {
    const s = this.settings;
    const levels = this.tex ? this.tex.mipLevelCount - 1 : 1;
    const f = new Float32Array([
      texel[0], texel[1], s.radius, s.exposure,
      s.bloom, levels, s.vignette, this.frame % 64,
      BG[0], BG[1], BG[2], 1,
    ]);
    this.dev.queue.writeBuffer(buf, 0, f);
  }

  // Blur, tone map, and write the finished frame to the canvas.
  encodePresent(enc: GPUCommandEncoder): void {
    if (!this.tex || !this.present) return;
    this.frame++;
    const downCount = this.tex.mipLevelCount - 1;
    this.passes.forEach((p, idx) => {
      this.writeUniform(p.buf, p.texel);
      const isUp = idx >= downCount;
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: p.target,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: isUp ? "load" : "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(isUp ? this.pUp : this.pDown);
      pass.setBindGroup(0, p.group);
      pass.draw(3);
      pass.end();
    });
    this.writeUniform(this.present.buf, [1 / this.width, 1 / this.height]);
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: BG[0], g: BG[1], b: BG[2], a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pPresent);
    pass.setBindGroup(0, this.present.group);
    pass.draw(3);
    pass.end();
  }

  dispose(): void {
    this.tex?.destroy();
    for (const p of this.passes) p.buf.destroy();
    this.present?.buf.destroy();
  }
}
