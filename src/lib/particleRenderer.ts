import renderShader from "../shaders/render.wgsl?raw";

export class ParticleRenderer {
  private dev: GPUDevice;
  private pipeline: GPURenderPipeline;
  private params: GPUBuffer;
  private group: GPUBindGroup = null!;
  private ctx: GPUCanvasContext;

  constructor(dev: GPUDevice, ctx: GPUCanvasContext) {
    this.dev = dev;
    this.ctx = ctx;
    const module = dev.createShaderModule({ code: renderShader });
    this.pipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.params = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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

  encode(
    enc: GPUCommandEncoder,
    count: number,
    opts: { scale?: number; size?: number; colorScale?: number; load?: boolean } = {},
  ): void {
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    const f = new Float32Array([
      opts.scale ?? 0.95,
      canvas.width / canvas.height,
      opts.size ?? 0.0022,
      opts.colorScale ?? 2.0,
    ]);
    this.dev.queue.writeBuffer(this.params, 0, f);
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.024, g: 0.027, b: 0.043, a: 1 },
          loadOp: opts.load ? "load" : "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, count);
    pass.end();
  }
}
