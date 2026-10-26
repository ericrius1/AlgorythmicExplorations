import renderShader from "../shaders/render.wgsl?raw";
import { PostFX, HDR_FORMAT } from "./postfx";

export interface ParticleDrawOptions {
  scale?: number;
  size?: number;
  colorScale?: number;
  intensity?: number;
  palette?: "speed" | "galaxy" | "water"; // all keyed to speed; default "speed"
  offsetY?: number; // shift the scene up, in clip units
  load?: boolean; // draw on top of what's already in the HDR target
  present?: boolean; // finish the frame (bloom + tone map); false when another renderer draws after
}

export class ParticleRenderer {
  // Shared with any renderer that draws into the same frame (see accretionGpu).
  readonly post: PostFX;

  private dev: GPUDevice;
  private pipeline: GPURenderPipeline;
  private params: GPUBuffer;
  private group: GPUBindGroup = null!;
  private ctx: GPUCanvasContext;

  constructor(dev: GPUDevice, ctx: GPUCanvasContext, opts: { post?: PostFX } = {}) {
    this.dev = dev;
    this.ctx = ctx;
    this.post = opts.post ?? new PostFX(dev, ctx);
    const module = dev.createShaderModule({ code: renderShader });
    this.pipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format: HDR_FORMAT,
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.params = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  bind(bodies: GPUBuffer): void {
    this.group = this.dev.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: bodies } },
      ],
    });
  }

  encode(enc: GPUCommandEncoder, count: number, opts: ParticleDrawOptions = {}): void {
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    const f = new Float32Array([
      opts.scale ?? 0.95,
      canvas.width / canvas.height,
      opts.size ?? 0.0022,
      opts.colorScale ?? 2.0,
      opts.intensity ?? 1.0,
      2.2 / canvas.height, // ~1.1 px minimum radius
      opts.palette === "water" ? 2 : opts.palette === "galaxy" ? 1 : 0,
      opts.offsetY ?? 0,
    ]);
    this.dev.queue.writeBuffer(this.params, 0, f);
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.post.sceneView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: opts.load ? "load" : "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, count);
    pass.end();
    if (opts.present ?? true) this.post.encodePresent(enc);
  }
}
